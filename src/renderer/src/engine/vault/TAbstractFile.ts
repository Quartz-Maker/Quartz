// obsidian.d.ts TAbstractFile / TFile / TFolder.
import type { Vault } from './Vault'
import { basename, extname, joinExt, stem } from './path'

export interface FileStats {
  ctime: number
  mtime: number
  size: number
}

export abstract class TAbstractFile {
  vault: Vault
  path = ''
  name = ''
  parent: TFolder | null = null
  deleted = false

  constructor(vault: Vault, path: string) {
    this.vault = vault
    this.setPath(path)
  }

  setPath(path: string): void {
    this.path = path
    this.name = basename(path)
  }

  /** Path this item would have after renaming it to `name` within its folder. */
  getNewPathAfterRename(name: string): string {
    name = name.replace(/[\x00-\x1F]/g, ' ').trim()
    if (!this.parent) return ''
    return this.parent.isRoot() ? name : this.parent.path + '/' + name
  }
}

/** Text cache for small files (keeps ≤ cacheLimit chars per file). */
const contentCache = new WeakMap<TFile, string>()

export class TFile extends TAbstractFile {
  stat: FileStats = null as unknown as FileStats
  declare basename: string
  declare extension: string
  saving = 0

  setPath(path: string): void {
    super.setPath(path)
    this.basename = stem(this.name)
    this.extension = extname(this.name)
  }

  /** The name shown in the UI: basename for markdown, full name otherwise. */
  getShortName(): string {
    return this.extension === 'md' ? this.basename : this.name
  }

  getNewPathAfterRename(name: string): string {
    return super.getNewPathAfterRename(joinExt(name, this.extension))
  }

  /** @internal */
  cache(content: string | null | undefined): void {
    if (content != null && content.length <= this.vault.cacheLimit) contentCache.set(this, content)
    else contentCache.delete(this)
  }
  /** @internal */
  getCached(): string | undefined {
    return contentCache.get(this)
  }
  /** @internal */
  updateCacheLimit(): void {
    const c = contentCache.get(this)
    if (c !== undefined && c.length > this.vault.cacheLimit) contentCache.delete(this)
  }

  toString(): string {
    return this.path
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = []

  isRoot(): boolean {
    return this.path === '/'
  }
  /** "" for the root, else "path/". */
  getParentPrefix(): string {
    return this.isRoot() ? '' : this.path + '/'
  }
  getFileCount(): number {
    let n = 0
    for (const c of this.children) n += c instanceof TFolder ? c.getFileCount() : 1
    return n
  }
  getFolderCount(): number {
    let n = 0
    for (const c of this.children) if (c instanceof TFolder) n += 1 + c.getFolderCount()
    return n
  }
}

