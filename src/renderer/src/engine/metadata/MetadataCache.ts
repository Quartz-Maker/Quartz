/* eslint-disable @typescript-eslint/no-explicit-any */
// Plugin API `MetadataCache`:
// files are parsed off-thread (worker) into CachedMetadata keyed by SHA-256 content
// hash, persisted in IndexedDB "<appId>-cache" (stores `file`, `metadata`), links are
// resolved by a cooperative queue into resolvedLinks/unresolvedLinks, and the events
// changed / deleted / resolve / resolved / finished are emitted.
import type { CachedMetadata } from 'obsidian'
import { Events, type EventRef } from '../core/Events'
import { TAbstractFile, TFile } from '../vault/TAbstractFile'
import type { Vault } from '../vault/Vault'
import { basename, dirname, extname, stripExtension } from '../vault/path'
import { debounce } from '../vault/debounce'
import { computeMetadata } from './parser/computeMetadata'
import { getLinkpath } from './linktext'
import { CustomArrayDict, getAllTags, iterateRefs, isValidTag, parseFrontMatterAliases } from './helpers'
import { applyLinkChanges, type LinkChange } from './linkUpdate'
import { CanvasLinkUpdater } from './CanvasLinkUpdater'

export interface FileCacheEntry {
  mtime: number
  size: number
  hash: string
}
export interface LinkSuggestion {
  file: TFile | null
  path: string
  alias?: string
}
/** Pluggable link updater for non-markdown formats (e.g. canvas). */
export interface LinkUpdater {
  iterateReferences(cb: (path: string, ref: any) => void): void
  iterateReferencesForFile(path: string, cb: (ref: any) => void): void
  applyUpdates(file: TFile, changes: LinkChange[]): Promise<void>
  renameSubpath?(file: TFile, oldSubpath: string, newSubpath: string): Promise<void>
}
export interface MetadataCacheOptions {
  appId?: string
  /** Run the parser in a Web Worker (default: when Worker exists). */
  useWorker?: boolean
  /** Persist parsed metadata in IndexedDB (default: when indexedDB exists). */
  persist?: boolean
  /** Extensions treated as supported files (stand-in for the view registry). */
  isExtensionRegistered?: (ext: string) => boolean
}

const DEFAULT_EXTENSIONS = new Set(['md', 'canvas', 'base', 'pdf', 'bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus', 'mp4', 'webm', 'ogv', 'mov', 'mkv'])
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const byPathLength = (a: TFile, b: TFile): number => a.path.length - b.path.length
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
}

/** Sequential promise queue. */
class WorkQueue {
  private p: Promise<unknown> = Promise.resolve()
  queue<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.p.then(fn, fn)
    this.p = r.catch(() => undefined)
    return r
  }
}

export class MetadataCache extends Events {
  vault: Vault
  appId: string
  fileCache: Record<string, FileCacheEntry> = {}
  metadataCache: Record<string, CachedMetadata> = {}
  uniqueFileLookup = new CustomArrayDict<TFile>()
  resolvedLinks: Record<string, Record<string, number>> = {}
  unresolvedLinks: Record<string, Record<string, number>> = {}
  linkUpdaters: Record<string, LinkUpdater> = {}
  canvasLinks: CanvasLinkUpdater
  initialized = false
  inProgressTaskCount = 0
  userIgnoreFilters: RegExp[] | null = null
  private userIgnoreFiltersString = ''
  private userIgnoreFilterCache: Record<string, boolean> = {}
  private workQueue = new WorkQueue()
  private worker: Worker | null = null
  private workerResolve: ((v: any) => void) | null = null
  private resolveQueue: (TFile | null)[] = []
  private resolving = false
  private onCleanCacheCallbacks: (() => void)[] = []
  private db: IDBDatabase | null = null
  private preloadPromise: Promise<void> | null = null
  private options: MetadataCacheOptions
  private didFinish = debounce(() => this.trigger('finished'), 10, true)

  constructor(vault: Vault, options: MetadataCacheOptions = {}) {
    super()
    this.vault = vault
    this.options = options
    this.appId = options.appId ?? 'quartz'
    const useWorker = options.useWorker ?? typeof Worker !== 'undefined'
    if (useWorker) {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'Metadata Cache Worker' })
        this.worker.onmessage = e => {
          if (this.workerResolve) {
            const r = this.workerResolve
            this.workerResolve = null
            r(e.data)
          }
        }
      } catch (e) {
        console.error('Metadata worker unavailable, parsing on the main thread', e)
        this.worker = null
      }
    }
    this.linkUpdaters.canvas = this.canvasLinks = new CanvasLinkUpdater(this)
    this.on('finished', () => this.checkCleanCache())
    this.on('resolved', () => this.checkCleanCache())
  }

  // ---- parsing ---------------------------------------------------------------------------
  /** Parse bytes → CachedMetadata (worker or synchronous fallback). Sequential. */
  private work(buf: ArrayBuffer): Promise<CachedMetadata | null> {
    if (!this.worker) {
      try {
        return Promise.resolve(computeMetadata(new TextDecoder().decode(buf)))
      } catch (e) {
        console.error(e)
        return Promise.resolve(null)
      }
    }
    if (this.workerResolve) throw new Error('Work queue must be sequential!')
    return new Promise(resolve => {
      this.workerResolve = resolve
      this.worker!.postMessage({ metadataCache: buf }, [buf])
    })
  }
  /** Parse arbitrary bytes without touching the cache. */
  computeMetadataAsync(buf: ArrayBuffer): Promise<CachedMetadata | null> {
    return this.workQueue.queue(async () => {
      try {
        return await this.work(buf)
      } catch (e) {
        console.error(e)
        return null
      }
    })
  }

  // ---- persistence ---------------------------------------------------------------------
  preload(): Promise<void> | undefined {
    if (this.initialized) return
    if (!this.preloadPromise) this.preloadPromise = this._preload()
    return this.preloadPromise
  }
  private async _preload(): Promise<void> {
    const persist = this.options.persist ?? typeof indexedDB !== 'undefined'
    if (!persist) return
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(this.appId + '-cache', 19)
        req.onupgradeneeded = () => {
          const db = req.result
          if (db.objectStoreNames.contains('file')) db.deleteObjectStore('file')
          if (db.objectStoreNames.contains('metadata')) db.deleteObjectStore('metadata')
          db.createObjectStore('file')
          db.createObjectStore('metadata')
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    } catch (e) {
      console.error('Failed to load cache, unable to open IndexedDB', e)
      return
    }
    try {
      const tx = this.db.transaction(['file', 'metadata'], 'readonly')
      const all = <T>(store: string, keys: boolean): Promise<T[]> =>
        new Promise((resolve, reject) => {
          const s = tx.objectStore(store)
          const r = keys ? s.getAllKeys() : s.getAll()
          r.onsuccess = () => resolve(r.result as T[])
          r.onerror = () => reject(r.error)
        })
      const [fk, fv, mk, mv] = await Promise.all([all<string>('file', true), all<FileCacheEntry>('file', false), all<string>('metadata', true), all<CachedMetadata>('metadata', false)])
      fk.forEach((k, i) => k && fv[i] && (this.fileCache[k] = fv[i]))
      mk.forEach((k, i) => k && mv[i] && (this.metadataCache[k] = mv[i]))
    } catch (e) {
      console.error('Failed to load cache', e)
    }
  }
  private pendingTx: IDBTransaction | null = null
  private save(store: 'file' | 'metadata', key: string, value: unknown): void {
    if (!this.db) return
    try {
      if (!this.pendingTx) {
        const tx = (this.pendingTx = this.db.transaction(['file', 'metadata'], 'readwrite', { durability: 'relaxed' } as any))
        queueMicrotask(() => {
          if (this.pendingTx === tx) this.pendingTx = null
        })
      }
      const s = this.pendingTx.objectStore(store)
      if (value) s.put(value, key)
      else s.delete(key)
    } catch {
      this.pendingTx = null
    }
  }
  private saveFileCache(path: string, entry: FileCacheEntry | null): void {
    if (entry) this.fileCache[path] = entry
    else delete this.fileCache[path]
    this.save('file', path, entry)
  }
  private saveMetaCache(hash: string, data: CachedMetadata | null): void {
    if (data) this.metadataCache[hash] = data
    else delete this.metadataCache[hash]
    this.save('metadata', hash, data)
  }
  async clear(): Promise<void> {
    if (!this.db) return
    const tx = this.db.transaction(['file', 'metadata'], 'readwrite')
    tx.objectStore('metadata').clear()
    tx.objectStore('file').clear()
  }
  cleanupDeletedCache(): void {
    const used: Record<string, boolean> = {}
    for (const k in this.fileCache) used[this.fileCache[k].hash] = true
    for (const h in this.metadataCache) if (!used[h]) this.saveMetaCache(h, null)
  }

  // ---- lifecycle -------------------------------------------------------------------------
  async initialize(): Promise<void> {
    await this.preload()
    this.preloadPromise = null
    const byPath: Record<string, TFile> = {}
    for (const f of this.vault.getAllLoadedFiles()) {
      if (f instanceof TFile) {
        this.uniqueFileLookup.add(f.name.toLowerCase(), f)
        byPath[f.path] = f
      }
    }
    for (const p in this.fileCache) {
      const f = byPath[p]
      const e = this.fileCache[p]
      if (!f) this.deletePath(p)
      else if (hasOwn(this.metadataCache, e.hash) && f.stat.mtime === e.mtime && f.stat.size === e.size) this.queueFileForLinkResolution(f)
      else this.computeFileMetadataAsync(f)
    }
    for (const p in byPath) if (!hasOwn(this.fileCache, p)) this.computeFileMetadataAsync(byPath[p])
    this.initialized = true
    this.watchVaultChanges()
    this.updateUserIgnoreFilters()
    this.trigger('finished')
    if (typeof window !== 'undefined') {
      window.setTimeout(() => this.cleanupDeletedCache(), 60000)
      window.setInterval(() => this.cleanupDeletedCache(), 600000)
    }
  }
  private watchVaultChanges(): void {
    const v = this.vault
    v.on('create', f => this.onCreate(f))
    v.on('modify', f => this.computeFileMetadataAsync(f))
    v.on('delete', f => this.onDelete(f))
    v.on('rename', (f, old) => this.onRename(f, old))
    v.on('config-changed', (k: string) => k === 'userIgnoreFilters' && this.updateUserIgnoreFilters())
  }
  private onCreate(f: TAbstractFile): void {
    this.computeFileMetadataAsync(f)
    if (f instanceof TFile) this.updateRelatedLinks([f.name])
  }
  /** Index a file: reuse cached metadata when stat+hash match, else parse. */
  computeFileMetadataAsync(f: TAbstractFile): void {
    if (!(f instanceof TFile)) return
    this.uniqueFileLookup.add(f.name.toLowerCase(), f)
    const stat = f.stat
    const path = f.path
    if (f.extension !== 'md') {
      this.saveFileCache(path, { mtime: stat.mtime, size: stat.size, hash: '' })
      if (f.extension === 'canvas' && this.linkUpdaters.canvas === this.canvasLinks) {
        this.inProgressTaskCount++
        this.workQueue
          .queue(async () => {
            try {
              this.canvasLinks.index(path, await this.vault.cachedRead(f))
              this.queueFileForLinkResolution(f)
            } catch (err) {
              console.error(err)
            }
          })
          .finally(() => {
            this.inProgressTaskCount--
            if (this.inProgressTaskCount === 0) this.didFinish()
          })
      }
      return
    }
    let entry: FileCacheEntry | null = hasOwn(this.fileCache, path) ? this.fileCache[path] : null
    let upToDate = false
    if (entry) upToDate = entry.mtime === stat.mtime && entry.size === stat.size && !!entry.hash && hasOwn(this.metadataCache, entry.hash)
    else {
      entry = { mtime: 0, size: 0, hash: '' }
      this.saveFileCache(path, entry)
    }
    if (upToDate) {
      this.queueFileForLinkResolution(f)
      return
    }
    const e = entry
    this.inProgressTaskCount++
    this.workQueue
      .queue(async () => {
        try {
          const buf = await this.vault.readBinary(f)
          const text = new TextDecoder().decode(buf)
          const hash = await sha256(buf)
          e.mtime = stat.mtime
          e.size = stat.size
          e.hash = hash
          this.saveFileCache(path, e)
          let meta: CachedMetadata | null = this.metadataCache[hash]
          if (meta) {
            this.queueFileForLinkResolution(f)
            this.trigger('changed', f, text, meta)
            return
          }
          const slow = setTimeout(() => console.warn('Indexing taking a long time for ' + f.path), 10000)
          try {
            meta = await this.work(buf)
          } finally {
            clearTimeout(slow)
          }
          if (!meta) {
            console.log('Metadata failed to parse', f)
            return
          }
          this.saveMetaCache(hash, meta)
          this.queueFileForLinkResolution(f)
          this.trigger('changed', f, text, meta)
        } catch (err) {
          console.error(err)
        }
      })
      .finally(() => {
        this.inProgressTaskCount--
        if (this.inProgressTaskCount === 0) this.didFinish()
      })
  }
  private onDelete(f: TAbstractFile): void {
    if (!(f instanceof TFile)) return
    this.uniqueFileLookup.remove(f.name.toLowerCase(), f)
    this.trigger('deleted', f, this.getFileCache(f))
    this.canvasLinks.forget(f.path)
    this.deletePath(f.path)
  }
  private deletePath(p: string): void {
    delete this.resolvedLinks[p]
    delete this.unresolvedLinks[p]
    this.saveFileCache(p, null)
    this.updateRelatedLinks([basename(p)])
    this.queueFileForLinkResolution(null)
    if (this.inProgressTaskCount === 0) this.didFinish()
  }
  private onRename(f: TAbstractFile, oldPath: string): void {
    if (!(f instanceof TFile)) return
    const p = f.path
    this.canvasLinks.rename(oldPath, p)
    this.uniqueFileLookup.remove(basename(oldPath).toLowerCase(), f)
    this.uniqueFileLookup.add(f.name.toLowerCase(), f)
    if (hasOwn(this.resolvedLinks, oldPath)) {
      this.resolvedLinks[p] = this.resolvedLinks[oldPath]
      delete this.resolvedLinks[oldPath]
    }
    if (hasOwn(this.unresolvedLinks, oldPath)) {
      this.unresolvedLinks[p] = this.unresolvedLinks[oldPath]
      delete this.unresolvedLinks[oldPath]
    }
    if (hasOwn(this.fileCache, oldPath)) {
      this.saveFileCache(p, this.fileCache[oldPath])
      this.saveFileCache(oldPath, null)
    }
    const oldName = basename(oldPath)
    const newName = basename(p)
    this.updateRelatedLinks(newName !== oldName ? [oldName, newName] : [oldName])
    this.queueFileForLinkResolution(null)
  }
  /** Re-resolve every file whose links mention one of these file names. */
  private updateRelatedLinks(names: string[]): void {
    names = names.map(n => n.toLowerCase())
    const noExt: string[] = []
    for (const n of names) {
      if (n.endsWith('.md')) noExt.push(n.substring(0, n.length - 3))
      noExt.push(n)
    }
    const mentions = (list: string[], links: Record<string, number> | undefined): boolean => {
      if (!links) return false
      for (const k of Object.keys(links)) if (list.includes(basename(k).toLowerCase())) return true
      return false
    }
    for (const p of this.getCachedFiles()) {
      if (mentions(names, this.resolvedLinks[p]) || mentions(noExt, this.unresolvedLinks[p])) {
        const f = this.vault.getFileByPath(p)
        if (f) this.queueFileForLinkResolution(f)
      }
    }
  }

  // ---- link resolution queue -------------------------------------------------------------
  queueFileForLinkResolution(f: TFile | null): void {
    this.resolveQueue.push(f)
    if (!this.resolving) {
      this.resolving = true
      setTimeout(() => this.runResolver(), 0)
    }
  }
  private runResolver(): void {
    const start = Date.now()
    while (this.resolveQueue.length) {
      const f = this.resolveQueue.shift()
      if (f) {
        this.resolveLinks(f.path)
        this.trigger('resolve', f)
      }
      if (Date.now() - start > 100) {
        setTimeout(() => this.runResolver(), 0)
        return
      }
    }
    this.resolving = false
    this.trigger('resolved')
  }
  /** Fill resolvedLinks/unresolvedLinks for one file. */
  resolveLinks(path: string): void {
    if (!this.getCache(path)) return
    const resolved: Record<string, number> = {}
    const unresolved: Record<string, number> = {}
    const file = this.vault.getFileByPath(path)
    if (!file) return
    this.iterateRefsForFile(file, ref => {
      const link = getLinkpath(ref.link)
      const dest = this.getFirstLinkpathDest(link, path)
      if (dest) resolved[dest.path] = (resolved[dest.path] || 0) + 1
      else {
        const key = extname(basename(link)) === 'md' ? link.substring(0, link.length - 3) : link
        unresolved[key] = (unresolved[key] || 0) + 1
      }
    })
    this.resolvedLinks[path] = resolved
    this.unresolvedLinks[path] = unresolved
  }
  isCacheClean(): boolean {
    return this.inProgressTaskCount === 0 && this.resolveQueue.length === 0 && !this.resolving
  }
  onCleanCache(cb: () => void): void {
    if (this.isCacheClean()) cb()
    else this.onCleanCacheCallbacks.push(cb)
  }
  private checkCleanCache(): void {
    while (this.onCleanCacheCallbacks.length > 0 && this.isCacheClean()) {
      const cb = this.onCleanCacheCallbacks.shift()!
      try {
        cb()
      } catch (e) {
        console.error(e)
      }
    }
  }

  // ---- queries ---------------------------------------------------------------------------
  getFileCache(file: TFile): CachedMetadata | null {
    return this.getCache(file.path)
  }
  getCache(path: string): CachedMetadata | null {
    if (!hasOwn(this.fileCache, path)) return null
    if (extname(basename(path)) !== 'md') return {} as CachedMetadata
    return this.metadataCache[this.fileCache[path].hash] || null
  }
  getFileInfo(path: string): FileCacheEntry | undefined {
    return this.fileCache[path]
  }
  getCachedFiles(): string[] {
    return Object.keys(this.fileCache)
  }
  isUnresolved(link: string, source: string): boolean {
    return this.initialized && !this.getFirstLinkpathDest(link, source)
  }
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const r = this.getLinkpathDest(linkpath, sourcePath)
    return r.length > 0 ? r[0] : null
  }
  /** All candidates for a link, best first. */
  getLinkpathDest(linkpath: string, sourcePath: string): TFile[] {
    if (linkpath === '' && sourcePath) {
      const self = this.vault.getFileByPath(sourcePath)
      if (self) return [self]
    }
    let lower = linkpath.toLowerCase()
    let name = basename(lower)
    let candidates: TFile[] | null = null
    if (name.includes('.')) candidates = this.uniqueFileLookup.get(name)
    if (!candidates) {
      lower = (linkpath + '.md').toLowerCase()
      name = basename(lower)
      candidates = this.uniqueFileLookup.get(name)
    }
    if (!candidates) return []
    if (name === lower && candidates.length === 1) return candidates.slice()
    let dir = dirname(sourcePath).toLowerCase()
    if (lower.startsWith('./') || lower.startsWith('../')) {
      if (lower.startsWith('./../')) lower = lower.substr(2)
      if (lower.startsWith('./')) {
        if (dir !== '') dir += '/'
        lower = dir + lower.substring(2)
      } else {
        while (lower.startsWith('../')) {
          lower = lower.substr(3)
          dir = dirname(dir)
        }
        if (dir !== '') dir += '/'
        lower = dir + lower
      }
      for (const f of candidates) if (f.path.toLowerCase() === lower) return [f]
    }
    if (lower.startsWith('/')) lower = lower.substr(1)
    for (const f of candidates) if (f.path.toLowerCase() === lower) return [f]
    if (linkpath.startsWith('/')) return []
    const near: TFile[] = []
    const far: TFile[] = []
    // `dir` is the source folder, possibly moved by ./ ../ handling above
    for (const f of candidates) {
      const p = f.path.toLowerCase()
      if (p.endsWith(lower)) (p.startsWith(dir) ? near : far).push(f)
    }
    near.sort(byPathLength)
    far.sort(byPathLength)
    return near.concat(far)
  }
  /** Link text for `file` from `sourcePath` per `newLinkFormat`. */
  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension = true): string {
    const format = this.vault.getConfig('newLinkFormat')
    const full = file.extension === 'md' && omitMdExtension ? stripExtension(file.path) : file.path
    if (format === 'absolute') return full
    if (format === 'relative') {
      let up = ''
      let dir = dirname(sourcePath)
      while (dir !== '' && dir !== '/' && full.indexOf(dir + '/') !== 0) {
        up = '../' + up
        dir = dirname(dir)
      }
      return full.indexOf(dir + '/') === 0 ? up + full.substr(dir.length + 1) : up + full
    }
    const short = file.extension === 'md' && omitMdExtension ? file.basename : file.name
    const dest = this.getLinkpathDest(getLinkpath(short), sourcePath)
    return dest && dest.length === 1 && dest[0] === file ? short : full
  }
  getLinks(): Record<string, any[]> {
    const out: Record<string, any[]> = {}
    for (const p in this.fileCache) {
      let refs: any[] = []
      const m = this.metadataCache[this.fileCache[p].hash]
      if (m) {
        if (m.links) refs = refs.concat(m.links)
        if (m.embeds) refs = refs.concat(m.embeds)
      }
      out[p] = refs
    }
    return out
  }
  iterateAllRefs(cb: (path: string, ref: any) => unknown): void {
    for (const p in this.fileCache) {
      if (!hasOwn(this.fileCache, p)) continue
      const m = this.metadataCache[this.fileCache[p].hash]
      if (m) iterateRefs(m, ref => cb(p, ref) as any)
    }
    for (const u of Object.values(this.linkUpdaters)) u.iterateReferences(cb)
  }
  iterateRefsForFile(file: TFile, cb: (ref: any) => unknown): void {
    const u = this.linkUpdaters[file.extension]
    if (u) u.iterateReferencesForFile(file.path, cb)
    else {
      const c = this.getFileCache(file)
      if (c) iterateRefs(c, cb as any)
    }
  }
  /** Map of source path → references in it that resolve to `file`. */
  getBacklinksForFile(file: TFile): CustomArrayDict<any> {
    const out = new CustomArrayDict<any>()
    this.iterateAllRefs((src, ref) => {
      const dest = this.getFirstLinkpathDest(getLinkpath(ref.link), src)
      if (dest && dest === file) out.add(src, ref)
    })
    return out
  }
  /** Apply link changes grouped by source file (used by FileManager). */
  async updateInternalLinks(changes: CustomArrayDict<LinkChange>): Promise<void> {
    for (const p of changes.keys()) {
      const f = this.vault.getAbstractFileByPath(p)
      if (!(f instanceof TFile)) continue
      const list = changes.get(p)!
      const u = this.linkUpdaters[f.extension]
      if (u) await u.applyUpdates(f, list)
      else await this.vault.process(f, text => applyLinkChanges(text, list))
    }
  }
  /** Tag → count across the vault (case-insensitively merged, nested parents counted). */
  getTags(): Record<string, number> {
    const counts: Record<string, number> = {}
    const add = (tag: string): void => {
      if (tag.endsWith('/')) tag = tag.slice(0, -1)
      if (!isValidTag(tag)) return
      const last = tag.split('/').pop()!
      counts[tag] = (counts[tag] || 0) + 1
      if (last !== tag) add(tag.substr(0, tag.length - last.length - 1))
    }
    this.iterateFileCache((_p, m) => {
      const tags = getAllTags(m)
      if (tags) for (const t of tags) add(t)
    })
    const merged: Record<string, { tag: string; count: number; max: number }> = {}
    for (const t in counts) {
      const k = t.toLowerCase()
      const c = counts[t]
      if (hasOwn(merged, k)) {
        const m = merged[k]
        m.count += c
        if (c > m.max) {
          m.max = c
          m.tag = t
        }
      } else merged[k] = { tag: t, count: c, max: c }
    }
    const out: Record<string, number> = {}
    for (const k in merged) out[merged[k].tag] = merged[k].count
    return out
  }
  iterateFileCache(cb: (path: string, meta: CachedMetadata) => void): void {
    for (const p in this.fileCache) {
      if (!hasOwn(this.fileCache, p) || this.isUserIgnored(p)) continue
      const m = this.metadataCache[this.fileCache[p].hash]
      if (m) cb(p, m)
    }
  }
  isSupportedFile(file: TFile): boolean {
    if (this.vault.getConfig('showUnsupportedFiles')) return true
    return this.options.isExtensionRegistered ? this.options.isExtensionRegistered(file.extension) : DEFAULT_EXTENSIONS.has(file.extension)
  }
  getLinkSuggestions(): LinkSuggestion[] {
    const out: LinkSuggestion[] = []
    const seen: Record<string, boolean> = {}
    for (const f of this.vault.getFiles()) {
      if (!this.isSupportedFile(f)) continue
      const path = f.extension === 'md' ? stripExtension(f.path) : f.path
      seen[path] = true
      out.push({ file: f, path })
      const c = this.getFileCache(f)
      const aliases = c && parseFrontMatterAliases(c.frontmatter)
      if (aliases) for (const alias of aliases) out.push({ file: f, path, alias })
    }
    for (const src in this.unresolvedLinks) {
      for (let link in this.unresolvedLinks[src]) {
        if (link.length > 500) link = link.substring(0, 500)
        if (!seen[link]) {
          seen[link] = true
          out.push({ file: null, path: link })
        }
      }
    }
    return out
  }
  getFrontmatterPropertyValuesForKey(key: string): string[] {
    if (!key) return []
    const ok = (s: string): boolean => s.trim().length !== 0 && !s.includes('\n') && !(s.length > 100 && s.includes(' '))
    const vals = new Set<string>()
    this.iterateFileCache((_p, m) => {
      const fm: any = m.frontmatter
      if (!fm || !hasOwn(fm, key)) return
      const v = fm[key]
      if (Array.isArray(v)) {
        for (const x of v) if (typeof x === 'string' && ok(x)) vals.add(x)
      } else if (typeof v === 'string' && ok(v)) vals.add(v)
    })
    return Array.from(vals).sort((a, b) => a.localeCompare(b))
  }
  updateUserIgnoreFilters(): void {
    const filters = this.vault.getConfig('userIgnoreFilters') as string[] | null
    const s = JSON.stringify(filters)
    if (this.userIgnoreFiltersString === s) return
    this.userIgnoreFiltersString = s
    this.userIgnoreFilterCache = {}
    if (!filters) {
      this.userIgnoreFilters = null
      return
    }
    const list: RegExp[] = (this.userIgnoreFilters = [])
    for (const raw of filters) {
      const f = raw.trim()
      if (f.length === 0) continue
      try {
        if (f.length > 2 && f.startsWith('/') && f.endsWith('/')) list.push(new RegExp(f.substring(1, f.length - 1), 'i'))
        else list.push(new RegExp('^' + escapeRe(f), 'i'))
      } catch (e) {
        console.error('Bad regex for user ignore filter', e)
      }
    }
  }
  isUserIgnored(path: string): boolean {
    const filters = this.userIgnoreFilters
    if (!filters) return false
    if (hasOwn(this.userIgnoreFilterCache, path)) return this.userIgnoreFilterCache[path]
    const r = filters.some(re => re.test(path))
    this.userIgnoreFilterCache[path] = r
    return r
  }

  on(name: 'changed', callback: (file: TFile, data: string, cache: CachedMetadata) => any, ctx?: any): EventRef
  on(name: 'deleted', callback: (file: TFile, prevCache: CachedMetadata | null) => any, ctx?: any): EventRef
  on(name: 'resolve', callback: (file: TFile) => any, ctx?: any): EventRef
  on(name: 'resolved' | 'finished', callback: () => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    return super.on(name, callback, ctx)
  }
}

