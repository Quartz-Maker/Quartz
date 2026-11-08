/* eslint-disable @typescript-eslint/no-explicit-any */
// Plugin API `FileManager`: new-file placement, link
// generation honouring newLinkFormat/useMarkdownLinks, and renames that update links
// *by resolution*: snapshot every reference's resolution, rename, re-resolve, and
// rewrite only references whose resolution changed (alwaysUpdateLinks or a prompt).
import { isAttachmentPath } from './views/graph/data'
import { parse as parseYaml } from 'yaml'
import type { App } from './App'
import type { Vault } from './vault/Vault'
import { TAbstractFile, TFile, TFolder } from './vault/TAbstractFile'
import { basename, dirname, extname, isValidPath, ILLEGAL_FILE_CHARS_DISPLAY, normalizePath, stem, stripExtension } from './vault/path'
import { CustomArrayDict } from './metadata/helpers'
import { encodeLinkDestination, getLinkpath, parseLinktext, WIKILINK_FULL } from './metadata/linktext'
import { replaceReference, getFrontMatterInfo, stringifyFrontmatterYaml, type LinkChange } from './metadata/linkUpdate'
import type { MetadataCache } from './metadata/MetadataCache'
import { ConfirmationModal } from './ui/Modal'
import { Notice } from './ui/Notice'
import { t } from './settings/i18n'

export interface LinkResolutionSnapshot {
  sourceFile: TFile
  reference: any
  resolvedFile: TFile
  resolvedPaths: string[]
}
export type UpdateLinksChoice = 'always' | 'once' | 'no'

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many).replace('{{count}}', String(n))
export const linkCountText = (n: number): string => plural(n, '{{count}} link', '{{count}} links')
export const fileCountText = (n: number): string => plural(n, '{{count}} file', '{{count}} files')

/** The "Update links" confirmation (Always update / Just once / Do not update; closing = do not update). */
function promptWithModal(app: any, links: string, files: string): Promise<UpdateLinksChoice> {
  if (typeof (globalThis as any).createDiv !== 'function') return Promise.resolve('once')
  return new Promise(resolve => {
    const modal = new ConfirmationModal(app)
    modal.titleEl.setText('Update links')
    modal.contentEl.createEl('p', { text: 'Do you want to update internal links that link to this file?' })
    modal.contentEl.createEl('p', { text: `This will affect ${links} in ${files}.` })
    modal.setCloseCallback(() => resolve('no'))
    const pick = (c: UpdateLinksChoice): void => {
      modal.setCloseCallback(() => undefined)
      modal.close()
      resolve(c)
    }
    const bar = modal.buttonContainerEl
    bar.createEl('button', { text: 'Always update' }).addEventListener('click', () => pick('always'))
    bar.createEl('button', { text: 'Just once' }).addEventListener('click', () => pick('once'))
    bar.createEl('button', { text: 'Do not update' }).addEventListener('click', () => {
      modal.close()
    })
    modal.open()
  })
}

/** Sequential promise queue. */
class UpdateQueue {
  private p: Promise<unknown> = Promise.resolve()
  queue<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.p.then(fn, fn)
    this.p = r.catch(() => undefined)
    return r
  }
}

export class FileManager {
  app: App
  vault: Vault
  fileParentCreatorByType: Record<string, (sourcePath: string) => TFolder> = {}
  inProgressUpdates: ((snap: LinkResolutionSnapshot[]) => Promise<unknown>)[] | null = null
  updateQueue = new UpdateQueue()
  /** UI hooks (replaceable): link-update prompt and notices. */
  promptUpdateLinks: (links: string, files: string) => Promise<UpdateLinksChoice> = (l, f) => promptWithModal(this.app, l, f)
  notify: (message: string) => void = msg => (typeof (globalThis as any).createDiv === 'function' ? void new Notice(msg) : console.info(msg))

  constructor(app: App) {
    this.app = app
    this.vault = app.vault
    this.registerFileParentCreator('md', this.getMarkdownNewFileParent.bind(this))
  }
  private get metadataCache(): MetadataCache {
    return this.app.metadataCache
  }

  // ---- new files -----------------------------------------------------------------------
  getMarkdownNewFileParent(sourcePath: string): TFolder {
    const v = this.vault
    const loc = v.getConfig('newFileLocation')
    if (loc === 'folder') {
      const f = v.getAbstractFileByPath(v.getConfig('newFileFolderPath'))
      if (f instanceof TFolder) return f
    } else if (loc === 'current') {
      const f = v.getAbstractFileByPath(dirname(sourcePath))
      if (f instanceof TFolder) return f
    }
    return v.getRoot()
  }
  /** Folder a new file should go in, per `newFileLocation`. */
  getNewFileParent(sourcePath: string, newFilePath?: string): TFolder {
    const ext = (newFilePath && extname(newFilePath)) || 'md'
    let creator = this.fileParentCreatorByType[ext]
    if (!creator) {
      console.error('No file creator assigned to create file with extension ' + ext + '. Falling back to Markdown file creator.')
      creator = this.fileParentCreatorByType.md
    }
    return creator(sourcePath)
  }
  registerFileParentCreator(ext: string, fn: (sourcePath: string) => TFolder): void {
    this.fileParentCreatorByType[ext] = fn
  }
  unregisterFileCreator(ext: string): void {
    delete this.fileParentCreatorByType[ext]
  }
  canCreateFileWithExt(ext: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.fileParentCreatorByType, ext || 'md')
  }
  async createNewMarkdownFileFromLinktext(linktext: string, sourcePath: string): Promise<TFile> {
    if (!isValidPath(linktext)) throw new Error('File name cannot contain any of these characters: ' + ILLEGAL_FILE_CHARS_DISPLAY)
    const parent = linktext.includes('/') ? null : this.getNewFileParent(sourcePath, linktext)
    return this.createNewMarkdownFile(parent, linktext)
  }
  createNewMarkdownFile(parent: TFolder | null, name?: string, content?: string): Promise<TFile> {
    return this.createNewFile(parent, name, 'md', content)
  }
  async createNewFile(parent: TFolder | null, name?: string, ext?: string, content?: string): Promise<TFile> {
    const v = this.vault
    if (!parent) parent = v.getRoot()
    if (!ext) ext = (name && extname(name)) || 'md'
    if (!this.canCreateFileWithExt(ext)) ext = 'md'
    const prefix = parent.getParentPrefix()
    let path: string
    if (name) {
      name = name.trim()
      if (extname(name) === ext) name = stripExtension(name)
      name = normalizePath(name)
      path = v.getAvailablePath(prefix + name, ext)
    } else path = v.getAvailablePath(prefix + 'Untitled', ext)
    const folder = await this.getOrCreateFolder(dirname(path))
    return v.create(folder.getParentPrefix() + basename(path), content || '')
  }
  async getOrCreateFolder(path: string): Promise<TFolder> {
    if (!path || path === '/') return this.vault.getRoot()
    const f = this.vault.getAbstractFileByPathInsensitive(path)
    return f instanceof TFolder ? f : this.vault.createFolder(path)
  }
  async createNewFolder(parent: TFolder | null): Promise<TFolder | null> {
    const prefix = !parent || parent.isRoot() ? '' : parent.path + '/'
    const path = this.vault.getAvailablePath(prefix + 'Untitled', '')
    await this.vault.createFolder(path)
    const f = this.vault.getAbstractFileByPath(path)
    return f instanceof TFolder ? f : null
  }

  // ---- links -----------------------------------------------------------------------------
  /** `[[link|alias]]` or `[alias](path)` per settings. */
  generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string): string {
    const useMd = this.vault.getConfig('useMarkdownLinks')
    let link = this.metadataCache.fileToLinktext(file, sourcePath, !useMd) + (subpath || '')
    if (file.path === sourcePath && subpath) link = subpath
    if (useMd) {
      const dest = encodeLinkDestination(link)
      return file.extension === 'md' ? `[${alias || file.basename}](${dest})` : `[${alias || ''}](${dest})`
    }
    if (alias && alias.toLowerCase() === link.toLowerCase()) {
      link = alias
      alias = undefined
    }
    return alias ? `[[${link}|${alias}]]` : `[[${link}]]`
  }
  /** Where a new attachment named `filename` should be saved. */
  async getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string> {
    let source: TFile | null = null
    if (sourcePath) {
      const f = this.vault.getAbstractFileByPath(sourcePath)
      if (f instanceof TFile) source = f
    } else source = (this.app as any).workspace?.getActiveFile?.() ?? null
    return this.vault.getAvailablePathForAttachments(stem(filename), extname(filename), source)
  }

  // ---- rename / delete ------------------------------------------------------------------
  /** Rename or move, updating every link that resolved to the moved file(s). */
  /** Rename prompt for `file` (reference `promptForFileRename`). */
  async promptForFileRename(file: TAbstractFile): Promise<void> {
    const { RenameFileModal } = await import('./ui/RenameFileModal')
    new RenameFileModal(this.app, file).open()
  }

  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    await this.runAsyncLinkUpdate(() => this.vault.rename(file, newPath))
  }
  async runAsyncLinkUpdate(fn: (snapshot: LinkResolutionSnapshot[]) => Promise<unknown>): Promise<void> {
    if (this.inProgressUpdates) {
      this.inProgressUpdates.push(fn)
      return
    }
    return this.updateQueue.queue(async () => {
      const mc = this.metadataCache
      await new Promise<void>(r => mc.onCleanCache(r))
      const snapshot: LinkResolutionSnapshot[] = []
      mc.iterateAllRefs((src, ref) => {
        const link = getLinkpath(ref.link)
        if (!link) return
        const sourceFile = this.vault.getAbstractFileByPath(src)
        if (!(sourceFile instanceof TFile)) return
        const dest = mc.getLinkpathDest(link, src)
        if (dest.length > 0) snapshot.push({ sourceFile, reference: ref, resolvedFile: dest[0], resolvedPaths: dest.map(f => f.path) })
      })
      try {
        this.inProgressUpdates = []
        await fn(snapshot)
        while (this.inProgressUpdates.length > 0) {
          const more = this.inProgressUpdates
          this.inProgressUpdates = []
          await Promise.all(more.map(f => f(snapshot)))
        }
      } finally {
        this.inProgressUpdates = null
      }
      await this.updateAllLinks(snapshot)
    })
  }
  /** Change for one snapshot entry, or undefined when its resolution is unchanged. */
  computeLinkChange(entry: LinkResolutionSnapshot): LinkChange | undefined {
    const mc = this.metadataCache
    const { reference: ref, sourceFile, resolvedPaths } = entry
    const src = sourceFile.path
    const { path, subpath } = parseLinktext(ref.link)
    const now = mc.getLinkpathDest(path, src).map(f => f.path)
    const same = now.length === resolvedPaths.length && now.every((p, i) => p === resolvedPaths[i])
    if (now.length !== 0 && same) return
    const isWiki = WIKILINK_FULL.test(ref.original)
    const link = mc.fileToLinktext(entry.resolvedFile, src, isWiki) + subpath
    if (ref.link !== link) return { sourcePath: src, reference: ref, change: replaceReference(ref, link) }
  }
  async updateAllLinks(snapshot: LinkResolutionSnapshot[]): Promise<void> {
    const changes = new CustomArrayDict<LinkChange>()
    for (const e of snapshot) {
      const c = this.computeLinkChange(e)
      if (c) changes.add(c.sourcePath, c)
    }
    const count = changes.count()
    if (count === 0) return
    const links = linkCountText(count)
    const files = fileCountText(changes.data.size)
    const apply = async (): Promise<void> => {
      await this.metadataCache.updateInternalLinks(changes)
      this.notify(`Updated ${links} in ${files}.`)
    }
    if (this.vault.getConfig('alwaysUpdateLinks')) return apply()
    const choice = await this.promptUpdateLinks(links, files)
    if (choice === 'no') return
    if (choice === 'always') this.vault.setConfig('alwaysUpdateLinks', true)
    return apply()
  }
  /** Delete per `trashOption` ("system" → OS trash, "local" → .trash, "none" → permanent). */
  /** `FileManager.promptForDeletion`: asks for confirmation (unless disabled) and trashes `file`; resolves true when it was deleted. */
  async promptForDeletion(file: TAbstractFile): Promise<boolean> {
    const app: any = this.app
    const doDelete = async (): Promise<boolean> => {
      // Attachments only this note links to (collected before the note's links leave the cache).
      const resolved: Record<string, Record<string, number>> = (this.metadataCache as any).resolvedLinks ?? {}
      const candidates = new Map<string, TFile>()
      if (file instanceof TFile)
        for (const dest of Object.keys(resolved[file.path] ?? {})) {
          const f = app.vault.getFileByPath?.(dest)
          if (f instanceof TFile && isAttachmentPath(dest)) candidates.set(dest, f)
        }
      await this.trashFile(file)
      await this.deleteOrphanAttachments(candidates)
      return true
    }
    if (app.vault.getConfig?.('promptDelete') === false) return doDelete()
    const { FE_STRINGS: S } = await import('./views/file-explorer/FileExplorerView')
    const opt = app.vault.getConfig?.('trashOption') ?? 'system'
    return new Promise<boolean>(resolve => {
      const modal: any = new ConfirmationModal(app)
      let done = false
      modal.setTitle(file instanceof TFolder ? S.deleteFolder : S.deleteFile)
      modal.setContent(
        createFragment(f => {
          f.createEl('p', { cls: 'u-break-word', text: S.confirmDelete(file.name) })
          f.createEl('p', { text: opt === 'local' ? S.trashLocal : opt === 'none' ? S.trashNone : S.trashSystem })
          const links = file instanceof TFile ? this.countBacklinks(file.path) : 0
          if (links > 0) f.createEl('p', { cls: 'mod-warning', text: t('dialogue.labelExistingBacklink', { count: links }) })
        })
      )
      modal.addCheckbox(S.dontAskAgain, (v: boolean) => app.vault.setConfig?.('promptDelete', !v))
      modal.addCancelButton(S.cancel)
      modal.addButton((b: any) =>
        b
          .setButtonText(S.delete)
          .setWarning()
          .onClick(() => {
            done = true
            void doDelete().then(resolve)
          })
      )
      const close = modal.onClose?.bind(modal)
      modal.onClose = () => {
        close?.()
        if (!done) resolve(false)
      }
      modal.open()
    })
  }

  /** Append/prepend `text` to a note, merging the inserted text's properties into the note's
   *  (`insertIntoFile`, used by the `new` URI action and Daily notes). */
  async insertIntoFile(file: TFile, text: string, mode: 'append' | 'prepend' = 'append'): Promise<void> {
    const split = (s: string): { content: string; fm: any } => {
      const info = getFrontMatterInfo(s)
      if (!info.exists) return { content: s, fm: {} }
      try {
        return { content: s.slice(info.contentStart), fm: (parseYaml(info.frontmatter) as any) ?? {} }
      } catch {
        new Notice(t('properties.msgInvalidProperties'))
        return { content: s, fm: {} }
      }
    }
    const merge = (into: any, from: any): void => {
      for (const k of Object.keys(from)) {
        const a = into[k], b = from[k]
        if (a === undefined || a === null || a === '' || a === false || a === 0) into[k] = b
        else if (Array.isArray(a) && Array.isArray(b)) into[k] = [...new Set([...a, ...b])]
        else if (typeof a === 'object' && b !== null && typeof b === 'object') merge(a, b)
        else if (b !== null) into[k] = b
      }
    }
    await this.vault.process(file, data => {
      const ins = split(text)
      const cur = split(data)
      const first = mode === 'prepend' ? ins.content : cur.content
      const second = mode === 'prepend' ? cur.content : ins.content
      let body: string
      if (first && second && !(first.slice(-2) + second.slice(0, 2)).includes('\n\n'))
        body = first.endsWith('\n') || second.startsWith('\n') ? first + '\n' + second : first + '\n\n' + second
      else body = first + second
      merge(cur.fm, ins.fm)
      if (Object.keys(cur.fm).length > 0) body = '---\n' + stringifyFrontmatterYaml(cur.fm).trim() + '\n---\n' + body
      return body
    })
  }

  /** "Delete attachments when deleting files": always / ask (file-browser modal) / never. */
  private async deleteOrphanAttachments(candidates: Map<string, TFile>): Promise<void> {
    const mode = (this.app as any).vault.getConfig?.('deleteUnlinkedAttachments') ?? 'ask'
    if (mode === 'never' || candidates.size === 0) return
    const resolved: Record<string, Record<string, number>> = (this.metadataCache as any).resolvedLinks ?? {}
    for (const dests of Object.values(resolved)) for (const d of Object.keys(dests)) candidates.delete(d)
    const orphans = [...candidates.values()]
    if (orphans.length === 0) return
    if (mode === 'always') {
      for (const f of orphans) await this.trashFile(f)
      return
    }
    const { OrphanAttachmentsModal } = await import('./ui/OrphanAttachmentsModal')
    const modal = new OrphanAttachmentsModal(this.app, orphans)
    if (await modal.prompt()) for (const f of modal.getCheckedFiles()) await this.trashFile(f)
  }

  /** Number of resolved links (from other files) pointing at `path`. */
  private countBacklinks(path: string): number {
    const resolved = (this.metadataCache as any).resolvedLinks as Record<string, Record<string, number>> | undefined
    let n = 0
    for (const [src, dests] of Object.entries(resolved ?? {})) if (src !== path && dests[path]) n += dests[path]
    return n
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    const opt = this.vault.getConfig('trashOption')
    if (opt === 'system') await this.vault.trash(file, true)
    else if (opt === 'local') await this.vault.trash(file, false)
    else if (opt === 'none') await this.vault.delete(file, true)
  }

  // ---- frontmatter -----------------------------------------------------------------------
  /** Atomically edit a note's frontmatter object (`processFrontMatter`). */
  async processFrontMatter(file: TFile, fn: (frontmatter: any) => void, options?: any): Promise<void> {
    await this.vault.process(
      file,
      text => {
        const info = getFrontMatterInfo(text)
        const fm = info.exists ? parseYaml(info.frontmatter) || {} : {}
        fn(fm)
        let yaml = ''
        if (fm && Object.keys(fm).length > 0) yaml = '---\n' + stringifyFrontmatterYaml(fm).trim() + '\n---\n'
        return yaml + text.slice(info.contentStart)
      },
      options
    )
  }
}
