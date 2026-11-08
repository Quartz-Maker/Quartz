// RecentFileTracker — `lastOpenFiles` MRU: newest path plus up to 25 md, 10 canvas, 10 image,
// 10 other. Updated on file-open and create, follows renames.
import { CANVAS_EXTENSIONS, IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, extnameOf } from './util'
import type { VaultLike } from './AppLike'
import type { Workspace } from './Workspace'

export const RECENT_CAPS = { md: 25, canvas: 10, image: 10, other: 10 }

export interface RecentFilesOptions {
  showMarkdown?: boolean
  showCanvas?: boolean
  showNonImageAttachments?: boolean
  showImages?: boolean
  showNonAttachments?: boolean
  maxCount?: number
}

export class RecentFileTracker {
  lastOpenFiles: string[] = []

  constructor(public workspace: Workspace, public vault: VaultLike) {
    vault.on('create', this.addRecentFile, this)
    vault.on('rename', this.onRename, this)
  }

  load(files: string[]): void {
    this.lastOpenFiles = Array.isArray(files) ? files : []
  }

  serialize(): string[] {
    return this.lastOpenFiles
  }

  collect(file: { path: string }): void {
    if (this.lastOpenFiles[0] === file.path) return
    const caps: Record<string, number> = { ...RECENT_CAPS }
    const out = [file.path]
    for (const p of this.lastOpenFiles) {
      if (p === file.path) continue
      const ext = extnameOf(p)
      let kind = 'other'
      if (MARKDOWN_EXTENSIONS.includes(ext)) kind = 'md'
      if (CANVAS_EXTENSIONS.includes(ext)) kind = 'canvas'
      if (IMAGE_EXTENSIONS.includes(ext)) kind = 'image'
      const left = caps[kind]
      if (left <= 0) continue
      out.push(p)
      caps[kind] = left - 1
    }
    this.lastOpenFiles = out
  }

  // Quirk: called as onFileOpen(current, previous) and collects the
  // PREVIOUS active file, so the currently open file is not in the MRU until it is left.
  onFileOpen(_current: any, previous: any): void {
    if (this.workspace.layoutReady && previous) {
      this.collect(previous)
      this.workspace.requestSaveLayout()
    }
  }

  addRecentFile(file: any): void {
    if (this.workspace.layoutReady) {
      this.collect(file)
      this.workspace.requestSaveLayout()
    }
  }

  onRename(file: { path: string }, oldPath: string): void {
    if (!this.workspace.layoutReady) return
    this.lastOpenFiles = this.lastOpenFiles.map(p => (p === oldPath ? file.path : p))
    this.workspace.requestSaveLayout()
  }

  getLastOpenFiles(): string[] {
    return this.getRecentFiles({ showMarkdown: true, showNonAttachments: true, showNonImageAttachments: true, showImages: true })
  }

  getRecentFiles(opts?: RecentFilesOptions): string[] {
    const o = Object.assign({ showMarkdown: true, showNonAttachments: true, showNonImageAttachments: false, showImages: false, maxCount: 10 }, opts)
    const out: string[] = []
    for (const p of this.lastOpenFiles) {
      const ext = extnameOf(p)
      if (ext === 'md') {
        if (o.showMarkdown) out.push(p)
      } else if (ext === 'canvas' || ext === 'base') {
        if (o.showNonAttachments) out.push(p)
      } else if (IMAGE_EXTENSIONS.includes(ext)) {
        if (o.showImages) out.push(p)
      } else if (o.showNonImageAttachments) out.push(p)
      if (out.length >= o.maxCount) break
    }
    return out
  }
}
