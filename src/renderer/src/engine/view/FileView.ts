// FileView / EditableFileView / TextFileView — obsidian.d.ts semantics.
import { ItemView, type ViewStateResult } from './View'
import { notice } from '../workspace/AppLike'
import { t } from '../workspace/strings'
import { Menu } from '../ui/Menu'
import { Keymap } from '../keymap/Keymap'
import { debounce, isTFileLike } from '../workspace/util'
import type { WorkspaceLeaf } from '../workspace/WorkspaceLeaf'

type TFileLike = { path: string; name: string; basename: string; extension: string; parent?: { path: string } | null; deleted?: boolean; saving?: boolean }

export abstract class FileView extends ItemView {
  allowNoFile = false
  file: TFileLike | null = null
  navigation = true

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  /** `.view-header-title-parent` breadcrumbs: `span.view-header-breadcrumb` + `span.view-header-breadcrumb-separator`. */
  renderBreadcrumbs(): void {
    this.titleParentEl.empty()
    const f = this.file
    if (!f) return
    const parentPath = f.parent?.path
    if (!parentPath || parentPath === '/') return
    const parts = parentPath.split('/')
    parts.forEach((part, i) => {
      const folderPath = parts.slice(0, i + 1).join('/')
      const el = this.createBreadcrumb(part)
      const app: any = this.app
      const folder = (): any => app.vault.getFolderByPath?.(folderPath) ?? app.vault.getAbstractFileByPath(folderPath)
      // Click reveals the folder in the file explorer; right-click opens the folder menu; drag moves the folder.
      el.addEventListener('click', () => {
        const fe = app.internalPlugins?.getEnabledPluginById?.('file-explorer')
        const target = folder()
        if (fe && target) void fe.revealInFolder(target)
      })
      el.addEventListener('contextmenu', (evt: MouseEvent) => {
        const target = folder()
        if (!target) return
        const menu = Menu.forEvent(evt).addSections(['title', 'open', 'action-primary', 'action', 'info', 'info.copy', 'view', 'system', '', 'danger'])
        menu.addItem(i =>
          i.setSection('action-primary').setTitle(t.newNote).setIcon('lucide-edit').onClick(async (e: any) => {
            const file = await app.fileManager.createNewMarkdownFile(target)
            await app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(file, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } })
          })
        )
        const fe = app.internalPlugins?.getEnabledPluginById?.('file-explorer')
        if (fe) {
          menu.addItem(i =>
            i.setSection('action-primary').setTitle(t.newFolder).setIcon('lucide-folder-open').onClick(async () => {
              const nf = await app.fileManager.createNewFolder(target)
              if (nf) void app.workspace.ensureSideLeaf('file-explorer', 'left', { active: true, reveal: true, state: { newFile: nf.path } })
            })
          )
          menu.addItem(i => i.setSection('system').setTitle(t.revealInNav).setIcon('lucide-folder-open').onClick(() => void fe.revealInFolder(target)))
        }
        menu.setParentElement(el)
        app.workspace.trigger('file-menu', menu, target, 'file-explorer-context-menu')
        menu.showAtMouseEvent(evt)
      })
      app.dragManager?.handleDrag?.(el, (e: DragEvent) => {
        const target = folder()
        if (!target) return null
        app.dragManager.updateSource([el], 'is-being-dragged')
        return app.dragManager.dragFolder(e, target)
      })
    })
  }

  createBreadcrumb(text: string): HTMLElement {
    const el = this.titleParentEl.createSpan({ cls: 'view-header-breadcrumb', text })
    el.setAttribute('aria-label', text)
    this.titleParentEl.createSpan({ cls: 'view-header-breadcrumb-separator', text: '/' })
    return el
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : t.noFile
  }

  onload(): void {
    super.onload()
    const vault = this.app.vault
    this.registerEvent(vault.on('rename', this.onRename.bind(this)))
    this.registerEvent(vault.on('delete', this.onDelete.bind(this)))
  }

  getState(): Record<string, unknown> {
    const s = super.getState()
    if (this.file) s.file = this.file.path
    return s
  }

  syncState(): void {
    const leaf = this.leaf
    if (!leaf.group) return
    for (const other of this.app.workspace.getGroupLeaves(leaf.group)) {
      if (other !== leaf && other.view instanceof FileView) other.view.receiveSyncState(this)
    }
  }

  receiveSyncState(src: FileView): void {
    if (src.file !== this.file && src.file) void this.leaf.openFile(src.file)
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    let changed = false
    if (state && Object.prototype.hasOwnProperty.call(state, 'file')) {
      const f = this.app.vault.getAbstractFileByPath(state.file)
      changed = isTFileLike(f) ? await this.loadFile(f) : await this.loadFile(null)
    }
    if (!this.file && !this.allowNoFile) result.close = true
    if (changed) {
      result.layout = true
      result.history = true
    }
    await super.setState(state, result)
    if (!state?.sync && (result.layout || result.history)) result.done = () => this.syncState()
  }

  protected async onClose(): Promise<void> {
    this.contentEl.empty()
    await this.loadFile(null)
  }

  /** Returns true when the file changed. */
  async loadFile(file: TFileLike | null): Promise<boolean> {
    const old = this.file
    if (old === file) return false
    if (old) await this.onUnloadFile(old)
    this.file = null
    if (file) {
      try {
        this.file = file
        await this.onLoadFile(file)
      } catch (e) {
        this.file = null
        notice(this.app, t.msgFailedToLoadFile(file.path))
        console.error(e)
      }
    }
    this.renderBreadcrumbs()
    this.titleEl.setText(this.getDisplayText())
    const ws = this.leaf.workspace
    if (ws.activeLeaf === this.leaf) ws.requestActiveLeafEvents()
    this.leaf.updateHeader()
    return true
  }

  async onLoadFile(_file: TFileLike): Promise<void> {}
  async onUnloadFile(_file: TFileLike): Promise<void> {}

  async onRename(file: TFileLike): Promise<void> {
    if (file !== this.file) return
    this.renderBreadcrumbs()
    this.titleEl.setText(file.basename)
    this.app.workspace.onLayoutChange()
    this.leaf.updateHeader()
  }

  async onDelete(file: TFileLike): Promise<void> {
    if (file !== this.file) return
    if (this.allowNoFile) await this.loadFile(null)
    else {
      const leaf = this.leaf
      if (leaf.history.backHistory.length > 0) await leaf.history.back()
      else await leaf.open(null)
      if (leaf.view.getViewType() === 'empty' && (leaf.parent as any)?.children.length > 1) leaf.detach()
    }
    this.app.workspace.onLayoutChange()
  }

  canAcceptExtension(_extension: string): boolean {
    return false
  }
}

/** Validates a new base name and renames `file` (same folder); returns an error message, or null on success. */
export async function renameFromTitle(app: any, file: TFileLike, name: string): Promise<string | null> {
  if (!name || name === file.basename) return null
  if (/[\\/:]/.test(name)) return 'File name cannot contain any of the following characters: * " \\ / < > : | ?'
  const parent = file.parent && file.parent.path !== '/' ? file.parent.path + '/' : ''
  try {
    await app.fileManager.renameFile(file, `${parent}${name}.${file.extension}`)
    return null
  } catch (e: any) {
    return String(e?.message ?? e)
  }
}

export abstract class EditableFileView extends FileView {
  fileBeingRenamed: TFileLike | null = null

  /** The view header title is editable: renaming it renames the file (`onOpen` of editable file views). */
  protected async onOpen(): Promise<void> {
    await super.onOpen()
    const el = this.titleEl
    if (!el) return
    el.tabIndex = -1
    el.contentEditable = 'true'
    el.addEventListener('focus', () => {
      this.fileBeingRenamed = this.file
      el.spellcheck = !!(this.app as any).vault?.getConfig?.('spellcheck')
      this.titleParentEl.detach()
    })
    el.addEventListener('blur', () => void this.saveTitle().then(() => {
      el.ownerDocument.getSelection()?.removeAllRanges()
      this.fileBeingRenamed = null
      el.spellcheck = false
      if (this.file) el.setText(this.file.basename)
      this.titleContainerEl.prepend(this.titleParentEl)
      el.scrollTo({ left: 0 })
    }))
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.isComposing) return
      const leave = (): void => {
        el.blur()
        ;(this as any).setEphemeralState?.({ focus: true })
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        this.fileBeingRenamed = null
        if (this.file) el.setText(this.file.basename)
        leave()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void this.saveTitle().then(ok => ok && leave())
      } else if (e.key === 'Tab') {
        e.preventDefault()
        leave()
      }
    })
  }

  /** `rename: 'all' | 'start' | 'end'` focuses the header title (selection per mode), else opens the rename prompt. */
  setEphemeralState(state: any): void {
    super.setEphemeralState(state)
    const mode = state?.rename
    if (!mode) return
    const el = this.titleEl
    if (el && el.isShown()) {
      el.focus()
      const sel = el.ownerDocument.getSelection()
      const r = el.ownerDocument.createRange()
      r.selectNodeContents(el)
      if (mode === 'start') r.collapse(true)
      else if (mode === 'end') r.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(r)
    } else if (this.file) void (this.app as any).fileManager.promptForFileRename(this.file)
  }

  /** Renames the file from the header title; false (and a notice) when the name is invalid. */
  async saveTitle(): Promise<boolean> {
    const file = this.file
    if (!file || file !== this.fileBeingRenamed || file.deleted) return true
    const err = await renameFromTitle(this.app, file, (this.titleEl.textContent || '').trim())
    if (err) notice(this.app as any, err)
    return !err
  }
}

export abstract class TextFileView extends EditableFileView {
  data = ''
  lastSavedData: string | null = null
  saving = false
  saveAgain = false
  isPlaintext = true
  dirty = false
  requestSave: () => void

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const d = debounce(() => this.save(), 2000)
    this.requestSave = () => {
      this.dirty = true
      d()
    }
  }

  onload(): void {
    super.onload()
    this.registerEvent(this.app.vault.on('modify', this.onModify, this))
  }

  async onUnloadFile(file: TFileLike): Promise<void> {
    await this.save(true)
    await super.onUnloadFile(file)
  }

  async onLoadFile(file: TFileLike): Promise<void> {
    await super.onLoadFile(file)
    await this.loadFileInternal(file, true)
  }

  saveImmediately(): Promise<void> | void {
    if (this.dirty) return this.save(false)
  }

  async save(clear?: boolean): Promise<void> {
    this.dirty = false
    const file = this.file
    const vault = this.app.vault as any
    if (!file || file.deleted) return
    if (this.saving) {
      if (!clear) this.saveAgain = true
      return
    }
    this.saveAgain = false
    const data = this.getViewData()
    if (this.lastSavedData === data || this.lastSavedData === null) return
    const prev = this.lastSavedData
    if (clear) {
      this.data = ''
      this.lastSavedData = null
      this.clear()
    } else {
      this.data = data
      this.lastSavedData = data
    }
    this.saving = true
    try {
      await vault.modify(file, data)
    } catch (e: any) {
      this.lastSavedData = prev
      console.error(e)
      throw e
    } finally {
      this.saving = false
      if (this.saveAgain && !clear) void this.save()
    }
  }

  onModify(file: TFileLike): void {
    if (!this.saving && file === this.file) void this.loadFileInternal(file, false)
  }

  async loadFileInternal(file: TFileLike, clear: boolean): Promise<void> {
    const vault = this.app.vault as any
    let data: string = file.saving ? await vault.cachedRead(file) : await vault.read(file)
    const prev = this.lastSavedData
    this.lastSavedData = data
    if (!clear && prev) {
      if (prev === data) return
      if (this.dirty && this.getViewData() === data) return
    }
    this.setData(data, clear)
  }

  setData(data: string, clear: boolean): void {
    if (this.data !== data || clear) {
      this.data = data
      this.setViewData(data, clear)
    }
  }

  abstract getViewData(): string
  abstract setViewData(data: string, clear: boolean): void
  abstract clear(): void
}
