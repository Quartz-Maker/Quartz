/* eslint-disable @typescript-eslint/no-explicit-any */
// obsidian.d.ts `FileSystemAdapter` (DataAdapter) — desktop file access: one serialised
// operation queue with a 60 s watchdog, a vault-relative `files` map, fs watchers whose
// changes are *reconciled* against that map (modify only when mtime/size changed, so our own writes never echo), deletions
// from the watcher re-checked after 100 ms, and synchronous reconcile after each write
// so vault events fire before the write promise resolves.
import { fs as nodeFs, path as nodePath, nodeRequire, electron } from '../node'
import { debounce } from './debounce'
import { basename, dirname, isHiddenPath, normalizePath, normalizeSlashes, isMac, isWindows } from './path'

export interface Stat {
  type: 'file' | 'folder'
  ctime: number
  mtime: number
  size: number
}
export interface ListedFiles {
  files: string[]
  folders: string[]
}
export interface DataWriteOptions {
  ctime?: number
  mtime?: number
  /** @internal called right after the bytes are on disk, before reconcile */
  immediate?: () => void
}
type FileEntry = { type: 'file'; realpath: string; ctime: number; mtime: number; size: number } | { type: 'folder'; realpath: string }
export type AdapterEvent = 'raw' | 'file-created' | 'folder-created' | 'modified' | 'file-removed' | 'folder-removed' | 'renamed' | 'closed'
export type AdapterHandler = (type: AdapterEvent, path: string, oldPath?: string, stat?: Omit<Stat, 'type'>) => void

const NBSP_LIKE = / | /g
const nfc = (p: string): string => p.replace(NBSP_LIKE, ' ').normalize('NFC')
const recursiveWatch = isMac || isWindows
const toStat = (s: any) => ({ ctime: Math.round(s.birthtimeMs), mtime: Math.round(s.mtimeMs), size: s.size })

export class FileSystemAdapter {
  basePath: string
  resourcePathPrefix: string
  insensitive: boolean
  files: Record<string, FileEntry> = {}
  watchers: Record<string, { watcher: any; resolvedPath: string }> = {}
  handler: AdapterHandler | null = null
  private promise: Promise<unknown> = Promise.resolve()
  private killLastAction: ((e: Error) => void) | null = null
  private thingsHappening = debounce(() => this.kill(), 60000, true)
  fs = nodeFs()
  fsPromises = nodeFs().promises
  path = nodePath()

  /** Temp vault: vault paths under `dir` live in `target`, outside the vault folder. */
  configRedirect: { dir: string; target: string } | null = null

  constructor(basePath: string, resourcePathPrefix = 'quartz-asset://q', configRedirect: { dir: string; target: string } | null = null) {
    this.basePath = basePath
    this.resourcePathPrefix = resourcePathPrefix
    this.configRedirect = configRedirect
    this.insensitive = isMac || isWindows
    try {
      // A temp vault must not write anything into the folder, not even the case-sensitivity probe.
      if (!configRedirect) this.testInsensitive()
    } catch (e) {
      console.error(e)
    }
  }

  private testInsensitive(): void {
    const p = this.path.join(this.basePath, '.QUARTZTEST')
    const lower = this.path.join(this.basePath, '.quartztest')
    if (this.fs.existsSync(p)) this.fs.unlinkSync(p)
    this.fs.writeFileSync(p, '', 'utf8')
    this.insensitive = this.fs.existsSync(lower)
    this.fs.unlinkSync(p)
  }

  getName(): string {
    return this.path.basename(this.basePath)
  }
  getBasePath(): string {
    return this.basePath
  }

  // ---- queue -----------------------------------------------------------------------
  private kill(): void {
    if (this.killLastAction) {
      this.killLastAction(new Error('File system operation timed out.'))
      this.killLastAction = null
    }
  }
  queue<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = (): Promise<T> => {
      const killed = new Promise<never>((_, reject) => (this.killLastAction = reject))
      this.thingsHappening()
      return Promise.race([killed, Promise.resolve().then(fn)])
    }
    const p = this.promise.then(run, run)
    this.promise = p.catch(() => undefined)
    return p
  }

  // ---- paths -----------------------------------------------------------------------
  getRealPath(p: string): string {
    let t = p
    while (t) {
      if (Object.prototype.hasOwnProperty.call(this.files, t)) return this.files[t].realpath + p.substr(t.length)
      t = dirname(t)
    }
    return p
  }
  getFullRealPath(realPath: string): string {
    const r = this.configRedirect
    if (r) {
      const p = realPath.replace(/^\/+/, '')
      if (p === r.dir || p.startsWith(r.dir + '/')) return this.path.join(r.target, p.slice(r.dir.length))
    }
    return this.path.join(this.basePath, realPath)
  }
  /** Absolute OS path of a vault path. */
  getFullPath(p: string): string {
    if (p.startsWith('file:')) return p.substring(5)
    return this.getFullRealPath(this.getRealPath(p))
  }
  getFilePath(p: string): string {
    return nodeRequire('url').pathToFileURL(this.getFullPath(p)).toString()
  }
  /** URL usable in <img src> etc.; cache-busted by mtime. */
  getResourcePath(p: string): string {
    const full = this.getFullPath(p)
    let mtime = 0
    const e = this.files[p]
    if (e && e.type === 'file') mtime = e.mtime
    if (!mtime) mtime = Date.now()
    // Prefix + file URL without the scheme (file:///C:/… → C:/…, UNC → %5C%5C…), so '#', '?' and '%'
    // in names are encoded.
    let href: string
    try {
      href = (window as any).require('url').pathToFileURL(full).href
    } catch {
      href = 'file://' + encodeURI(full).replace(/[?#]/g, c => encodeURIComponent(c))
    }
    if (href.startsWith('file:///')) href = href.substring(8)
    else if (href.startsWith('file://')) href = '%5C%5C' + href.substring(7)
    return this.resourcePathPrefix + href + '?' + mtime
  }

  // ---- listing & watching ------------------------------------------------------------
  async listAll(): Promise<void> {
    this.files = {}
    this.files['/'] = { type: 'folder', realpath: '/' }
    await this.listRecursive('')
  }
  private async listRecursive(realDir: string): Promise<void> {
    const names = await this.fsPromises.readdir(this.getFullRealPath(realDir))
    this.thingsHappening()
    await Promise.all(names.map(n => this.listRecursiveChild(realDir, n)))
  }
  private async listRecursiveChild(realDir: string, name: string): Promise<void> {
    const real = normalizeSlashes(realDir === '' ? name : realDir + '/' + name)
    const p = nfc(real)
    this.trigger('raw', p)
    if (isHiddenPath(p)) return this.reconcileDeletion(real, p)
    try {
      await this.reconcileFileInternal(real, p)
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e
      await this.reconcileDeletion(real, p, true)
    }
  }

  /** Start watching and list everything (fires create events for every item). */
  async watch(handler: AdapterHandler): Promise<void> {
    this.stopWatch()
    this.handler = handler
    await this.startWatchPath('/')
    return this.queue(() => this.listAll())
  }
  /** Watch a hidden folder (the config dir) recursively on Linux. */
  async watchHiddenRecursive(p: string): Promise<void> {
    if (recursiveWatch) return
    try {
      const names = await this.fsPromises.readdir(this.getFullRealPath(p))
      await this.startWatchPath(p)
      for (const n of names) {
        try {
          const child = normalizeSlashes(p === '' ? n : p + '/' + n)
          if ((await this.fsPromises.lstat(this.getFullRealPath(child))).isDirectory()) await this.watchHiddenRecursive(child)
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  stopWatch(): void {
    for (const k of Object.keys(this.watchers)) this.stopWatchPath(k)
    this.handler = null
  }
  private async startWatchPath(p: string): Promise<void> {
    const real = this.getRealPath(p)
    if (this.watchers[p]) return
    const full = this.getFullPath(p)
    let resolved = full
    try {
      resolved = await this.fsPromises.realpath(full)
    } catch (e: any) {
      if (e.code !== 'ENOENT') console.error(e)
    }
    let watcher: any
    try {
      watcher = this.fs.watch(full, { persistent: false, encoding: 'utf8', recursive: recursiveWatch })
    } catch (e) {
      console.error(e)
      return
    }
    watcher.on('change', (_evt: string, name: string) => this.onFileChange(real === '/' ? name : real + '/' + name))
    watcher.on('error', () => this.onFileChange(real))
    this.watchers[p] = { watcher, resolvedPath: resolved }
  }
  private stopWatchPath(p: string): void {
    const w = this.watchers[p]
    if (w) {
      try {
        w.watcher.close()
      } catch {
        /* ignore */
      }
      delete this.watchers[p]
    }
  }
  private onFileChange(real: string): void {
    if (!real) return
    real = normalizeSlashes(real)
    setTimeout(() => {
      const p = nfc(real)
      this.queue(() => this.reconcileFile(real, p, false))
    }, 0)
  }

  // ---- reconcile ---------------------------------------------------------------------
  async reconcileInternalFile(p: string): Promise<void> {
    return this.reconcileFile(this.getRealPath(p), p)
  }
  private async reconcileFile(real: string, p: string, immediateDelete = true): Promise<void> {
    this.trigger('raw', p)
    if (isHiddenPath(p)) return this.reconcileDeletion(real, p, immediateDelete)
    const parent = dirname(p)
    if (parent && parent !== '/' && !this.files[p]) await this.reconcileFile(dirname(real), parent, immediateDelete)
    try {
      const full = this.getFullRealPath(real)
      if (this.insensitive && real !== '/') {
        const names = (await this.fsPromises.readdir(this.path.dirname(full))).map((n: string) => nfc(n))
        if (names.indexOf(basename(p)) === -1) return this.reconcileDeletion(real, p, immediateDelete)
      }
      await this.reconcileFileInternal(real, p)
    } catch (e: any) {
      if (e.code === 'ENOENT') await this.reconcileDeletion(real, p, immediateDelete)
      else console.error(e)
    }
  }
  private async reconcileFileInternal(real: string, p: string): Promise<void> {
    const st = await this.fsPromises.lstat(this.getFullRealPath(real))
    if (st.isFile()) await this.reconcileFileCreation(real, p, st)
    else if (st.isDirectory()) await this.reconcileFolderCreation(real, p)
    else if (st.isSymbolicLink()) await this.reconcileSymbolicLinkCreation(real, p)
  }
  private async reconcileFileCreation(real: string, p: string, st: any): Promise<void> {
    const stat = toStat(st)
    const existing = this.files[p]
    if (existing) {
      existing.realpath = real
      if (existing.type === 'file') {
        if (existing.mtime !== Math.round(st.mtimeMs) || existing.size !== st.size) {
          existing.mtime = Math.round(st.mtimeMs)
          existing.size = st.size
          this.trigger('raw', p, p, stat)
          this.trigger('modified', p, p, stat)
        }
        return
      }
      this.removeFile(p)
    }
    this.files[p] = { type: 'file', realpath: real, ...stat }
    this.trigger('file-created', p, p, stat)
  }
  private async reconcileFolderCreation(real: string, p: string): Promise<void> {
    if (!Object.prototype.hasOwnProperty.call(this.files, p)) {
      this.files[p] = { type: 'folder', realpath: real }
      this.trigger('folder-created', p)
      if (!recursiveWatch) await this.startWatchPath(p)
      await this.listRecursive(real)
    } else {
      this.files[p].realpath = real
    }
  }
  private async reconcileSymbolicLinkCreation(real: string, p: string): Promise<void> {
    const full = this.getFullRealPath(real)
    let resolved: string
    try {
      resolved = await this.fsPromises.realpath(full)
    } catch {
      return
    }
    const sep = this.path.sep
    if (Object.prototype.hasOwnProperty.call(this.watchers, p)) this.watchers[p].resolvedPath = resolved
    else
      for (const k of Object.keys(this.watchers)) {
        if (k === p) continue
        const r = this.watchers[k].resolvedPath
        if (resolved === r || r.startsWith(resolved + sep) || resolved.startsWith(r + sep)) return
      }
    const st = await this.fsPromises.stat(full)
    if (st.isFile()) await this.reconcileFileCreation(real, p, st)
    else if (st.isDirectory()) {
      if (recursiveWatch) await this.startWatchPath(p)
      await this.reconcileFolderCreation(real, p)
    }
  }
  private async reconcileDeletion(real: string, p: string, immediate = true): Promise<void> {
    if (p === '/') {
      this.trigger('closed', p)
      return
    }
    this.stopWatchPath(p)
    const entry = this.files[p]
    if (!entry) return
    if (!immediate) {
      setTimeout(() => this.queue(() => this.reconcileFile(real, p)), 100)
      return
    }
    if (entry.type === 'folder') for (const k of Object.keys(this.files)) if (k.startsWith(p + '/')) this.removeFile(k)
    this.removeFile(p)
  }
  private removeFile(p: string): void {
    const e = this.files[p]
    delete this.files[p]
    if (e) this.trigger(e.type === 'file' ? 'file-removed' : 'folder-removed', p)
  }
  private trigger(type: AdapterEvent, p: string, oldPath?: string, stat?: Omit<Stat, 'type'>): void {
    if (this.handler) this.handler(type, p, oldPath, stat)
  }

  // ---- DataAdapter API -----------------------------------------------------------------
  private async applyWriteOptions(full: string, options?: DataWriteOptions): Promise<void> {
    if (!options) return
    const { mtime, immediate } = options
    // (Node cannot set the birth time, so ctime is ignored.)
    if (mtime) await this.fsPromises.utimes(full, mtime / 1000, mtime / 1000)
    if (immediate) immediate()
  }

  async exists(p: string, sensitive?: boolean): Promise<boolean> {
    return this.queue(() => this._exists(this.getFullPath(p), sensitive))
  }
  private async _exists(full: string, sensitive?: boolean): Promise<boolean> {
    try {
      await this.fsPromises.access(full)
    } catch {
      return false
    }
    if (sensitive && this.insensitive) {
      const names = await this.fsPromises.readdir(this.path.dirname(full))
      if (names.indexOf(this.path.basename(full)) === -1) return false
    }
    return true
  }
  async stat(p: string): Promise<Stat | null> {
    return this.queue(async () => {
      try {
        const s = await this.fsPromises.stat(this.getFullPath(p))
        if (s.isFile()) return { type: 'file' as const, ...toStat(s) }
        if (s.isDirectory()) return { type: 'folder' as const, ...toStat(s) }
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e
      }
      return null
    })
  }
  async list(p: string): Promise<ListedFiles> {
    return this.queue(async () => {
      const names = await this.fsPromises.readdir(this.getFullPath(p))
      const out: ListedFiles = { folders: [], files: [] }
      for (const n of names) {
        const real = normalizeSlashes(p === '' || p === '/' ? n : p + '/' + n)
        const vp = normalizePath(real)
        const s = await this.fsPromises.stat(this.getFullRealPath(real))
        if (s.isFile()) out.files.push(vp)
        if (s.isDirectory()) out.folders.push(vp)
      }
      return out
    })
  }
  async read(p: string): Promise<string> {
    return this.queue(async () => {
      try {
        return await this.fsPromises.readFile(this.getFullPath(p), 'utf8')
      } catch (e) {
        this.queue(() => this.reconcileInternalFile(p))
        throw e
      }
    })
  }
  async readBinary(p: string): Promise<ArrayBuffer> {
    return this.queue(async () => {
      try {
        const b: Uint8Array = await this.fsPromises.readFile(this.getFullPath(p))
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      } catch (e) {
        this.queue(() => this.reconcileInternalFile(p))
        throw e
      }
    })
  }
  private writeOp(p: string, op: (full: string) => Promise<unknown>, options?: DataWriteOptions): Promise<void> {
    return this.queue(async () => {
      const full = this.getFullPath(p)
      try {
        await op(full)
        await this.applyWriteOptions(full, options)
      } finally {
        await this.reconcileInternalFile(p)
      }
    })
  }
  write(p: string, data: string, options?: DataWriteOptions): Promise<void> {
    return this.writeOp(p, full => this.fsPromises.writeFile(full, data, 'utf8'), options)
  }
  writeBinary(p: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    return this.writeOp(p, full => this.fsPromises.writeFile(full, Buffer.from(data)), options)
  }
  append(p: string, data: string, options?: DataWriteOptions): Promise<void> {
    return this.writeOp(p, full => this.fsPromises.appendFile(full, data, 'utf8'), options)
  }
  appendBinary(p: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    return this.writeOp(p, full => this.fsPromises.appendFile(full, Buffer.from(data)), options)
  }
  /** Atomically read, transform and write a text file; returns the new text. */
  process(p: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
    return this.queue(async () => {
      const full = this.getFullPath(p)
      const before = await this.fsPromises.readFile(full, 'utf8')
      const after = fn(before)
      if (after === before) return before
      try {
        await this.fsPromises.writeFile(full, after, 'utf8')
        await this.applyWriteOptions(full, options)
      } finally {
        await this.reconcileInternalFile(p)
      }
      return after
    })
  }
  mkdir(p: string): Promise<void> {
    return this.queue(async () => {
      await this.fsPromises.mkdir(this.getFullPath(p), { recursive: true })
      await this.reconcileInternalFile(p)
    })
  }
  rmdir(p: string, recursive: boolean): Promise<void> {
    return this.queue(async () => {
      await this.fsPromises.rm(this.getFullPath(p), { maxRetries: 5, recursive })
      await this.reconcileInternalFile(p)
    })
  }
  remove(p: string): Promise<void> {
    return this.queue(async () => {
      await this.fsPromises.unlink(this.getFullPath(p))
      await this.reconcileInternalFile(p)
    })
  }
  /** Move to the OS trash. Resolves false when that is unavailable. */
  trashSystem(p: string): Promise<boolean> {
    return this.queue(async () => {
      const full = this.getFullPath(p)
      try {
        const shell = (electron() as any).shell
        if (!shell?.trashItem) return false
        await shell.trashItem(full)
      } catch {
        return false
      }
      await this.reconcileInternalFile(p)
      return true
    })
  }
  /** Move into <vault>/.trash (flat; "name 2.ext", "name 3.ext"… on collision). */
  trashLocal(p: string): Promise<void> {
    return this.queue(async () => {
      const full = this.getFullPath(p)
      const dir = this.getFullPath('.trash')
      await this.fsPromises.mkdir(dir, { recursive: true })
      const ext = this.path.extname(full)
      const base = this.path.basename(full, ext)
      let target = this.path.join(dir, base + ext)
      for (let n = 2; await this._exists(target); n++) target = this.path.join(dir, base + ' ' + n + ext)
      await this.fsPromises.rename(full, target)
      await this.reconcileInternalFile(p)
    })
  }
  async rename(from: string, to: string): Promise<void> {
    if (from === to) return
    await this.queue(async () => {
      const fullFrom = this.getFullPath(from)
      const fullTo = this.getFullPath(to)
      if ((await this._exists(fullTo, false)) && (!this.insensitive || from.toLowerCase() !== to.toLowerCase()))
        throw new Error('Destination file already exists!')
      const entry = this.files[from]
      const oldReal = entry ? entry.realpath : null
      await this.fsPromises.rename(fullFrom, fullTo)
      if (!entry) return
      delete this.files[from]
      const newReal = this.getRealPath(to)
      entry.realpath = newReal
      this.files[to] = entry
      this.trigger('renamed', to, from)
      if (entry.type === 'folder' && Object.prototype.hasOwnProperty.call(this.watchers, from)) {
        this.stopWatchPath(from)
        await this.startWatchPath(to)
      }
      if (entry.type === 'folder') {
        for (const k of Object.keys(this.files)) {
          if (!k.startsWith(from + '/')) continue
          const nk = to + k.slice(from.length)
          const child = this.files[k]
          delete this.files[k]
          child.realpath = newReal + child.realpath.slice(oldReal!.length)
          this.files[nk] = child
          this.trigger('renamed', nk, k)
        }
      }
    })
  }
  private async copyRecursive(from: string, to: string): Promise<void> {
    const s = await this.fsPromises.stat(from)
    if (s.isFile()) await this.fsPromises.copyFile(from, to, this.fs.constants.COPYFILE_EXCL)
    if (s.isDirectory()) {
      await this.fsPromises.mkdir(to, { recursive: true })
      for (const n of await this.fsPromises.readdir(from)) await this.copyRecursive(this.path.join(from, n), this.path.join(to, n))
    }
  }
  async copy(from: string, to: string): Promise<void> {
    await this.queue(async () => {
      await this.copyRecursive(this.getFullPath(from), this.getFullPath(to))
      await this.reconcileInternalFile(to)
    })
  }
  /** Reconcile one path now (e.g. after an out-of-band change). */
  update(p: string): Promise<void> {
    return this.queue(() => this.reconcileInternalFile(p))
  }
}
