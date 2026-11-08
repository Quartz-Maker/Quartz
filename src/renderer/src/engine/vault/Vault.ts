/* eslint-disable @typescript-eslint/no-explicit-any */
// obsidian.d.ts `Vault`: in-memory tree of every vault item (attachments included),
// fed by the adapter's reconciled events, plus the config store (app.json +
// appearance.json, sparse: only non-default keys are written).
import { Events, type EventRef } from '../core/Events'
import { TAbstractFile, TFile, TFolder } from './TAbstractFile'
import { FileSystemAdapter, type AdapterEvent, type DataWriteOptions, type Stat } from './FileSystemAdapter'
import { debounce } from './debounce'
import { APPEARANCE_KEYS, CONFIG_DEFAULTS, DEFAULT_CONFIG_DIR, validateConfigDir } from './config'
import { ILLEGAL_FILE_RE, checkPath, joinExt, normalizePath } from './path'
import { stripHeadingForLink } from '../metadata/linktext'

const removeFrom = <T>(a: T[], x: T): void => {
  const i = a.indexOf(x)
  if (i !== -1) a.splice(i, 1)
}
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const clone = <T>(v: T): T => (Array.isArray(v) || (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v)

export class Vault extends Events {
  adapter: FileSystemAdapter
  configDir = DEFAULT_CONFIG_DIR
  config: Record<string, unknown> = {}
  configTs = 0
  cacheLimit = 65536
  fileMap: Record<string, TAbstractFile> = {}
  root: TFolder
  requestSaveConfig = debounce(() => this.saveConfig(), 1000, true)
  reloadConfig = debounce(() => this._reloadConfig(), 500, true)
  /** Resolves once setupConfig() has read app.json/appearance.json. */
  configReady: Promise<void>
  private markConfigReady!: () => void

  constructor(adapter: FileSystemAdapter) {
    super()
    this.configReady = new Promise(r => (this.markConfigReady = r))
    this.adapter = adapter
    this.root = new TFolder(this, '')
    this.onChange('folder-created', '/')
    this.root = this.fileMap['/'] as TFolder
  }

  static validateConfigDir(dir: string): boolean {
    return validateConfigDir(dir, ILLEGAL_FILE_RE)
  }
  setConfigDir(dir: string): void {
    this.configDir = Vault.validateConfigDir(dir) ? dir : DEFAULT_CONFIG_DIR
  }
  getName(): string {
    return this.adapter.getName()
  }
  setFileCacheLimit(limit: number): void {
    this.cacheLimit = limit
    for (const f of Object.values(this.fileMap)) if (f instanceof TFile) f.updateCacheLimit()
  }

  // ---- config ------------------------------------------------------------------------
  getConfigFile(name: string): string {
    return this.configDir + '/' + name + '.json'
  }
  async readJson(p: string): Promise<any> {
    try {
      return JSON.parse(await this.adapter.read(normalizePath(p)))
    } catch (e: any) {
      if (e.code === 'ENOENT') return null
      console.error('failed to read JSON', p, e)
    }
    return undefined
  }
  async writeJson(p: string, data: unknown, options?: DataWriteOptions): Promise<void> {
    try {
      await this.adapter.write(normalizePath(p), JSON.stringify(data, undefined, 2), options)
    } catch {
      /* ignored */
    }
  }
  readConfigJson(name: string): Promise<any> {
    return this.readJson(this.getConfigFile(name))
  }
  writeConfigJson(name: string, data: unknown, options?: DataWriteOptions): Promise<void> {
    return this.writeJson(this.getConfigFile(name), data, options)
  }
  readPluginData(dir: string): Promise<any> {
    return this.readJson(normalizePath(dir + '/data.json'))
  }
  writePluginData(dir: string, data: unknown, options?: DataWriteOptions): Promise<void> {
    return this.writeJson(normalizePath(dir + '/data.json'), data, options)
  }
  async setupConfig(): Promise<void> {
    if (!(await this.adapter.exists(this.configDir))) await this.adapter.mkdir(this.configDir)
    this.configTs = Date.now()
    const app = await this.readConfigJson('app')
    const appearance = await this.readConfigJson('appearance')
    const config = (this.config = Object.assign({}, appearance, app))
    const renames: Record<string, string> = { editorFontFamily: 'textFontFamily' }
    for (const from in renames) {
      if (has(renames, from) && has(config, from)) {
        const to = renames[from]
        const v = config[from]
        delete config[from]
        if (!has(config, to) && v) config[to] = v
      }
    }
    this.requestSaveConfig()
    this.markConfigReady()
  }
  async saveConfig(): Promise<void> {
    if (!(await this.adapter.exists(this.configDir))) await this.adapter.mkdir(this.configDir)
    const app: Record<string, unknown> = {}
    const appearance: Record<string, unknown> = {}
    for (const k in this.config) if (has(this.config, k)) (APPEARANCE_KEYS.includes(k) ? appearance : app)[k] = this.config[k]
    await this.writeConfigJson('app', app)
    await this.writeConfigJson('appearance', appearance)
    this.configTs = Date.now()
  }
  private async _reloadConfig(): Promise<void> {
    let changed = false
    for (const name of ['app', 'appearance']) {
      try {
        const s = await this.adapter.stat(this.getConfigFile(name))
        if (!s || s.mtime > this.configTs) changed = true
      } catch {
        changed = true
      }
    }
    if (!changed) return
    this.configTs = Date.now()
    const app = await this.readConfigJson('app')
    const appearance = await this.readConfigJson('appearance')
    const next: Record<string, unknown> = Object.assign({}, appearance, app)
    const cur = this.config
    for (const k in next) {
      if (has(next, k) && !(has(cur, k) && JSON.stringify(cur[k]) === JSON.stringify(next[k]))) {
        cur[k] = next[k]
        this.trigger('config-changed', k)
      }
    }
    for (const k in cur) {
      if (has(cur, k) && !has(next, k)) {
        delete cur[k]
        this.trigger('config-changed', k)
      }
    }
  }
  getConfig(key: string): any {
    let v = this.config[key]
    if (v === undefined) v = CONFIG_DEFAULTS[key]
    return clone(v)
  }
  setConfig(key: string, value: unknown): void {
    if (this.config[key] === value) return
    if (value !== undefined) this.config[key] = value
    else delete this.config[key]
    this.requestSaveConfig()
    this.trigger('config-changed', key)
  }

  // ---- loading -------------------------------------------------------------------------
  async load(): Promise<void> {
    await this.adapter.watch(this.onChange.bind(this))
    await this.adapter.watchHiddenRecursive(this.configDir)
  }

  /** Adapter event → tree update → vault event. */
  onChange(type: AdapterEvent, path: string, oldPath?: string, stat?: Omit<Stat, 'type'>): void {
    const map = this.fileMap
    if (type === 'folder-created') {
      const f = new TFolder(this, path)
      map[path] = f
      this.addChild(f)
      this.trigger('create', f)
    } else if (type === 'file-created') {
      const f = new TFile(this, path)
      f.stat = stat!
      map[path] = f
      this.addChild(f)
      this.trigger('create', f)
    } else if (type === 'modified') {
      if (!has(map, path)) return
      const f = map[path]
      if (f instanceof TFile) {
        f.stat = stat!
        if (!f.saving) f.cache(null)
      }
      this.trigger('modify', f)
    } else if (type === 'file-removed' || type === 'folder-removed') {
      if (has(map, path)) {
        const f = map[path]
        this.removeChild(f)
        delete map[path]
        f.deleted = true
        this.trigger('delete', f)
      }
    } else if (type === 'renamed') {
      if (oldPath !== undefined && has(map, oldPath)) {
        const f = map[oldPath]
        this.removeChild(f)
        f.setPath(path)
        this.addChild(f)
        map[path] = f
        delete map[oldPath]
        this.trigger('rename', f, oldPath)
      }
    } else if (type === 'closed') {
      this.trigger('closed')
    } else if (type === 'raw') {
      this.trigger('raw', path)
      if (path.startsWith(this.configDir + '/')) this.adapter.watchHiddenRecursive(path)
      if (path === this.getConfigFile('app') || path === this.getConfigFile('appearance')) this.reloadConfig()
    }
  }
  private getDirectParent(f: TAbstractFile): TFolder | null {
    const i = f.path.lastIndexOf('/')
    if (i === -1) return this.fileMap['/'] as TFolder
    const p = this.fileMap[f.path.slice(0, i)]
    return p instanceof TFolder ? p : null
  }
  private addChild(f: TAbstractFile): void {
    const old = f.parent
    const parent = this.getDirectParent(f)
    if (parent && parent !== old) {
      if (old) removeFrom(old.children, f)
      parent.children.push(f)
      f.parent = parent
    }
  }
  private removeChild(f: TAbstractFile): void {
    const p = f.parent
    if (p) {
      removeFrom(p.children, f)
      f.parent = null
    }
  }

  // ---- lookup --------------------------------------------------------------------------
  getRoot(): TFolder {
    return this.root
  }
  getAbstractFileByPath(path: string): TAbstractFile | null {
    return has(this.fileMap, path) ? this.fileMap[path] : null
  }
  getFileByPath(path: string): TFile | null {
    const f = has(this.fileMap, path) ? this.fileMap[path] : null
    return f instanceof TFile ? f : null
  }
  getFolderByPath(path: string): TFolder | null {
    const f = has(this.fileMap, path) ? this.fileMap[path] : null
    return f instanceof TFolder ? f : null
  }
  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    if (has(this.fileMap, path)) return this.fileMap[path]
    const lower = path.toLowerCase()
    for (const k in this.fileMap) if (k.length === lower.length && k.toLowerCase() === lower) return this.fileMap[k]
    return null
  }
  isEmpty(): boolean {
    return Object.keys(this.fileMap).length === 1
  }
  getAllLoadedFiles(): TAbstractFile[] {
    return Object.values(this.fileMap)
  }
  getAllFolders(includeRoot = false): TFolder[] {
    return Object.values(this.fileMap).filter((f): f is TFolder => f instanceof TFolder && (includeRoot || !f.isRoot()))
  }
  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => unknown): void {
    let stack: TAbstractFile[] = [root]
    while (stack.length > 0) {
      const f = stack.pop()
      if (!f) continue
      cb(f)
      if (f instanceof TFolder) stack = stack.concat(f.children)
    }
  }
  getMarkdownFiles(): TFile[] {
    const out: TFile[] = []
    Vault.recurseChildren(this.root, f => f instanceof TFile && f.extension === 'md' && out.push(f))
    return out
  }
  getFiles(): TFile[] {
    const out: TFile[] = []
    Vault.recurseChildren(this.root, f => f instanceof TFile && out.push(f))
    return out
  }
  checkForDuplicate(file: TAbstractFile, newName: string): boolean {
    const p = file.getNewPathAfterRename(newName)
    const existing = this.fileMap[p]
    return !!existing && existing !== file
  }
  checkPath(path: string): void {
    checkPath(path)
  }

  // ---- operations ------------------------------------------------------------------------
  exists(path: string, sensitive?: boolean): Promise<boolean> {
    return this.adapter.exists(normalizePath(path), sensitive)
  }
  async create(path: string, data: string, options?: DataWriteOptions): Promise<TFile> {
    path = normalizePath(path)
    this.checkPath(path)
    if (await this.adapter.exists(path)) throw new Error('File already exists.')
    await this.adapter.write(path, data, options)
    return this.getAbstractFileByPath(path) as TFile
  }
  /** Absolute OS path inside this (local) vault -> its TFile, else null. */
  resolveFilePath(absPath: string): TFile | null {
    const a: any = this.adapter
    if (typeof a.getBasePath !== 'function') return null
    const base: string = a.getBasePath()
    if (!absPath.startsWith(base)) return null
    const f = this.getAbstractFileByPath(normalizePath(absPath.substring(base.length)))
    return f instanceof TFile ? f : null
  }
  /** `file://` (or app resource) URL inside this vault -> its TFile, else null. */
  resolveFileUrl(url: string): TFile | null {
    const prefix = 'app://local/'
    if (url.startsWith(prefix)) url = 'file:///' + url.substring(prefix.length).split('?')[0]
    if (!url.startsWith('file://')) return null
    try {
      return this.resolveFilePath(decodeURIComponent(url.replace(/^file:\/\/(?=\/[A-Za-z]:|\/)/, '').replace(/^\/([A-Za-z]:)/, '$1')))
    } catch {
      return null
    }
  }
  async createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
    path = normalizePath(path)
    this.checkPath(path)
    if (await this.adapter.exists(path)) throw new Error('File already exists.')
    await this.adapter.writeBinary(path, data, options)
    return this.getAbstractFileByPath(path) as TFile
  }
  async createFolder(path: string): Promise<TFolder> {
    path = normalizePath(path)
    this.checkPath(path)
    if (await this.adapter.exists(path)) throw new Error('Folder already exists.')
    await this.adapter.mkdir(path)
    return this.getAbstractFileByPath(path) as TFolder
  }
  async read(file: TFile): Promise<string> {
    let t = await this.adapter.read(file.path)
    if (t.charCodeAt(0) === 0xfeff) t = t.substring(1)
    file.cache(t)
    return t
  }
  async cachedRead(file: TFile): Promise<string> {
    const c = file.getCached()
    return c !== undefined ? c : this.read(file)
  }
  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const b = await this.adapter.readBinary(file.path)
    try {
      if (file.extension === 'md' && b.byteLength <= this.cacheLimit) file.cache(new TextDecoder().decode(b))
    } catch {
      /* ignore */
    }
    return b
  }
  readRaw(path: string): Promise<string> {
    return this.adapter.read(normalizePath(path))
  }
  getResourcePath(file: TFile): string {
    return this.adapter.getResourcePath(file.path)
  }
  async delete(file: TAbstractFile, force = false): Promise<void> {
    if (!file || file === this.root) return
    if (file instanceof TFile) await this.adapter.remove(file.path)
    else if (file instanceof TFolder) await this.adapter.rmdir(file.path, force)
  }
  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    if (!file || file === this.root) return
    if (system && (await this.adapter.trashSystem(file.path))) return
    await this.adapter.trashLocal(file.path)
  }
  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const p = normalizePath(newPath)
    if (file.path === p) return
    this.checkPath(p)
    await this.adapter.rename(file.path, p)
  }
  async modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
    file.saving++
    try {
      options = { ...(options || {}), immediate: () => file.cache(data) }
      await this.adapter.write(file.path, data, options)
    } catch (e) {
      file.cache(null)
      throw e
    } finally {
      file.saving--
    }
  }
  async modifyBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    file.saving++
    try {
      await this.adapter.writeBinary(file.path, data, { ...(options || {}), immediate: () => file.cache(null) })
    } finally {
      file.saving--
    }
  }
  async append(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
    file.saving++
    try {
      await this.adapter.append(file.path, data, { ...(options || {}), immediate: () => file.cache(null) })
    } finally {
      file.saving--
    }
  }
  async appendBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    file.saving++
    try {
      await this.adapter.appendBinary(file.path, data, { ...(options || {}), immediate: () => file.cache(null) })
    } finally {
      file.saving--
    }
  }
  async process(file: TFile, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
    file.saving++
    try {
      const out = await this.adapter.process(file.path, fn, { ...(options || {}), immediate: () => file.cache(null) })
      file.cache(out)
      return out
    } finally {
      file.saving--
    }
  }
  async copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T> {
    const p = normalizePath(newPath).normalize('NFC')
    this.checkPath(p)
    await this.adapter.copy(file.path, p)
    return this.getAbstractFileByPath(p) as T
  }
  /** First free "base.ext", "base 1.ext", "base 2.ext"… (case-insensitive). */
  getAvailablePath(base: string, ext: string): string {
    let n = 1
    let p = joinExt(base, ext)
    while (this.getAbstractFileByPathInsensitive(p)) {
      p = joinExt(base + ' ' + n, ext)
      n++
    }
    return p
  }
  /** Path for a new attachment per `attachmentFolderPath` ("/", "./", "./sub", "folder"). */
  async getAvailablePathForAttachments(name: string, ext: string, sourceFile: TFile | null): Promise<string> {
    let folder: string = this.getConfig('attachmentFolderPath')
    const sameFolder = folder === '.' || folder === './'
    let sub: string | null = null
    if (folder.startsWith('./')) sub = folder.slice(2)
    if (sameFolder) folder = sourceFile ? sourceFile.parent!.path : ''
    else if (sub) folder = (sourceFile ? sourceFile.parent!.getParentPrefix() : '') + sub
    folder = normalizePath(folder)
    name = stripHeadingForLink(normalizePath(name)).slice(0, 250)
    let dir = this.getAbstractFileByPathInsensitive(folder)
    if (!dir) dir = await this.createFolder(folder)
    return dir instanceof TFolder ? this.getAvailablePath(dir.getParentPrefix() + name, ext) : this.getAvailablePath(name, ext)
  }

  // typed overloads of Events
  on(name: 'create' | 'modify' | 'delete', callback: (file: TAbstractFile) => any, ctx?: any): EventRef
  on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => any, ctx?: any): EventRef
  on(name: 'closed', callback: () => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    return super.on(name, callback, ctx)
  }
}

