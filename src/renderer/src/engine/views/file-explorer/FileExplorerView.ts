/* eslint-disable @typescript-eslint/no-explicit-any */
// File explorer (core plugin `file-explorer`, view type "file-explorer").
// It extends the plain View (no view header / view content):
//
//   .workspace-leaf-content[data-type=file-explorer]
//     > .nav-header > .nav-buttons-container > .clickable-icon.nav-action-button ×6  + .search-input-container
//     > .nav-files-container[style=position: relative] > div > div(spacer) + .tree-item…
//   folder: .tree-item.nav-folder(.is-collapsed)
//             > .tree-item-self.nav-folder-title.is-clickable.mod-collapsible[data-path][draggable]
//                 > .tree-item-icon.collapse-icon(.is-collapsed) > svg.right-triangle  + .tree-item-inner.nav-folder-title-content
//             > .tree-item-children.nav-folder-children > div(spacer) + children   (absent while collapsed)
//   file:   .tree-item.nav-file > .tree-item-self.nav-file-title.tappable.is-clickable(.is-active)[data-path][draggable]
//             > .tree-item-inner.nav-file-title-content [+ .nav-file-tag (non-md extension)]
//
// Leaf state {sortOrder, autoReveal, showSearch, searchQuery}; expanded folders persist in
// localStorage `<appId>-file-explorer-unfold` (array of paths, saved 200 ms after a change).
import { View } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { setIcon, setTooltip } from '../../workspace/dom'
import { Menu } from '../../ui/Menu'
import { displayTooltip, hideTooltip } from '../../ui/tooltip'
import { ILLEGAL_FILE_RE, ILLEGAL_FILE_CHARS_DISPLAY, ILLEGAL_LINK_CHARS } from '../../vault/path'
import { ConfirmationModal } from '../../ui/Modal'
import { Keymap } from '../../keymap/Keymap'
import { MoveFileModal } from './MoveFileModal'

export const VIEW_TYPE_FILE_EXPLORER = 'file-explorer'

export type FileExplorerSortOrder = 'alphabetical' | 'alphabeticalReverse' | 'byModifiedTime' | 'byModifiedTimeReverse' | 'byCreatedTime' | 'byCreatedTimeReverse'

export const FE_STRINGS = {
  title: 'Files',
  newNote: 'New note',
  newFolder: 'New folder',
  newCanvas: 'New canvas',
  newBase: 'New base',
  changeSort: 'Change sort order',
  autoReveal: 'Auto-reveal current file',
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  showSearch: 'Show search filter',
  clearSearch: 'Clear search',
  openNewTab: 'Open in new tab',
  openRight: 'Open to the right',
  makeCopy: 'Make a copy',
  copyPath: 'Copy path',
  openDefault: 'Open in default app',
  showInExplorer: 'Show in system explorer',
  rename: 'Rename...',
  delete: 'Delete',
  deleteFile: 'Delete file',
  deleteFolder: 'Delete folder',
  confirmDelete: (n: string) => `Are you sure you want to delete “${n}”?`,
  trashSystem: 'It will be moved to your system trash.',
  trashLocal: 'It will be moved to your Quartz trash, which is located in the “.trash” hidden folder in your vault.',
  trashNone: 'It will be permanently deleted.',
  dontAskAgain: "Don't ask again",
  cancel: 'Cancel',
  msgInvalidCharacters: 'File name cannot contain any of these characters:',
  msgFileAlreadyExists: "There's already a file with the same name",
  msgEmptyFileName: 'File name cannot be empty.',
  msgBadDotfile: 'File name must not start with a dot.'
}

export const SORT_ORDER_LABELS: [FileExplorerSortOrder, string][][] = [
  [
    ['alphabetical', 'File name (A to Z)'],
    ['alphabeticalReverse', 'File name (Z to A)']
  ],
  [
    ['byModifiedTime', 'Modified time (new to old)'],
    ['byModifiedTimeReverse', 'Modified time (old to new)']
  ],
  [
    ['byCreatedTime', 'Created time (new to old)'],
    ['byCreatedTimeReverse', 'Created time (old to new)']
  ]
]
const SORT_ORDERS = SORT_ORDER_LABELS.flat().map(x => x[0])

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const INDENT = 17
const BASE_PAD = 24

const isFolder = (f: any): boolean => !!f && Array.isArray(f.children)
const basenameOf = (f: any): string => (isFolder(f) ? f.name : f.basename ?? f.name)

/** Folders first (always A→Z by name); files by the chosen order (ties by name). */
export function compareFiles(order: FileExplorerSortOrder, a: any, b: any): number {
  const fa = isFolder(a)
  const fb = isFolder(b)
  if (fa !== fb) return fa ? -1 : 1
  if (fa) return collator.compare(a.name, b.name)
  const byName = collator.compare(basenameOf(a), basenameOf(b))
  switch (order) {
    case 'alphabeticalReverse':
      return -byName
    case 'byModifiedTime':
      return (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0) || byName
    case 'byModifiedTimeReverse':
      return (a.stat?.mtime ?? 0) - (b.stat?.mtime ?? 0) || byName
    case 'byCreatedTime':
      return (b.stat?.ctime ?? 0) - (a.stat?.ctime ?? 0) || byName
    case 'byCreatedTimeReverse':
      return (a.stat?.ctime ?? 0) - (b.stat?.ctime ?? 0) || byName
    default:
      return byName
  }
}

interface ItemDom {
  file: any
  el: HTMLElement
  selfEl: HTMLElement
  innerEl: HTMLElement
  childrenEl?: HTMLElement
  collapseEl?: HTMLElement
}

export class FileExplorerView extends View {
  icon = 'lucide-folder-closed'
  sortOrder: FileExplorerSortOrder = 'alphabetical'
  autoReveal = false
  showSearchFilter = false
  searchQuery = ''
  /** Expanded folder paths (the expanded ones are stored: `prefersCollapsed`). */
  expanded = new Set<string>()
  fileItems: Record<string, ItemDom> = {}
  activePath: string | null = null
  renaming: { file: any; item: ItemDom } | null = null
  /** Multi-selection (shift-click range); rendered as `.is-selected`. */
  selected = new Set<string>()

  navHeaderEl: HTMLElement
  navButtonsEl: HTMLElement
  newNoteButtonEl: HTMLElement
  newFolderButtonEl: HTMLElement
  sortButtonEl: HTMLElement
  autoRevealButtonEl: HTMLElement
  collapseButtonEl: HTMLElement
  searchButtonEl: HTMLElement
  searchContainerEl: HTMLElement
  searchInputEl: HTMLInputElement
  navFilesContainer: HTMLElement
  private rootEl: HTMLElement
  private renderTimer: any = null
  private saveFoldTimer: any = null
  private dragFile: any = null
  private dragHoverTimer: any = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const S = FE_STRINGS
    this.navHeaderEl = this.containerEl.createDiv('nav-header')
    this.navButtonsEl = this.navHeaderEl.createDiv('nav-buttons-container')
    this.newNoteButtonEl = this.navButton('lucide-edit', S.newNote, evt => void this.onCreateNewNoteClick(evt))
    this.newFolderButtonEl = this.navButton('lucide-folder-plus', S.newFolder, () => void this.onCreateNewFolderClick())
    this.sortButtonEl = this.navButton('lucide-sort-asc', S.changeSort, evt => this.openSortMenu(evt))
    this.autoRevealButtonEl = this.navButton('lucide-gallery-vertical', S.autoReveal, () => this.onToggleAutoReveal())
    this.collapseButtonEl = this.navButton('lucide-chevrons-up-down', S.expandAll, () => this.setIsAllCollapsed(this.expanded.size > 0))
    this.searchButtonEl = this.navButton('lucide-search', S.showSearch, () => this.showSearch(!this.showSearchFilter))
    this.searchButtonEl.hide()
    this.searchContainerEl = this.navHeaderEl.createDiv('search-input-container')
    this.searchInputEl = this.searchContainerEl.createEl('input', { attr: { enterkeyhint: 'search', type: 'search', spellcheck: 'false', placeholder: 'Search...' } }) as HTMLInputElement
    const clear = this.searchContainerEl.createDiv({ cls: 'search-input-clear-button', attr: { 'aria-label': S.clearSearch } })
    clear.addEventListener('click', () => {
      this.searchInputEl.value = ''
      this.onSearchChanged()
    })
    this.searchInputEl.addEventListener('input', () => this.onSearchChanged())
    this.searchContainerEl.hide()

    this.navFilesContainer = this.containerEl.createDiv('nav-files-container node-insert-event')
    this.navFilesContainer.setAttribute('style', 'position: relative;')
    this.rootEl = this.navFilesContainer.createDiv()
    this.navFilesContainer.addEventListener('contextmenu', evt => {
      if (evt.defaultPrevented) return
      const t = evt.target as HTMLElement
      if (t.closest('.tree-item-self')) return
      evt.preventDefault()
      this.openFileContextMenu(evt, this.app.vault.getRoot?.() ?? null)
    })
    this.attachDropHandler(this.navFilesContainer, () => this.app.vault.getRoot?.() ?? null)
    this.registerDomEvent(this.containerEl, 'keydown', (evt: KeyboardEvent) => {
      if (this.renaming) return
      if (evt.key === 'F2' && this.activePath) {
        const f = this.app.vault.getAbstractFileByPath(this.activePath)
        if (f) {
          evt.preventDefault()
          void this.startRenameFile(f)
        }
      }
    })
    if (!(this.app.workspace as any).layoutReady) this.loadFolds()
  }

  private navButton(icon: string, label: string, cb: (evt: MouseEvent) => any): HTMLElement {
    const b = this.navButtonsEl.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': label } })
    setIcon(b, icon)
    setTooltip(b, label)
    b.addEventListener('click', cb)
    return b
  }

  getViewType(): string {
    return VIEW_TYPE_FILE_EXPLORER
  }
  getDisplayText(): string {
    return FE_STRINGS.title
  }

  getState(): Record<string, unknown> {
    return { sortOrder: this.sortOrder, autoReveal: this.autoReveal, showSearch: this.showSearchFilter, searchQuery: this.searchQuery }
  }

  async setState(state: any, result: any): Promise<void> {
    if (state && typeof state === 'object') {
      if (SORT_ORDERS.includes(state.sortOrder)) this.sortOrder = state.sortOrder
      if (typeof state.autoReveal === 'boolean') this.autoReveal = state.autoReveal
      if (typeof state.searchQuery === 'string') {
        this.searchQuery = state.searchQuery
        this.searchInputEl.value = state.searchQuery
      }
      if (typeof state.showSearch === 'boolean') this.showSearchFilter = state.showSearch
    }
    this.searchContainerEl.toggle(this.showSearchFilter)
    this.autoRevealButtonEl.toggleClass('is-active', this.autoReveal)
    this.requestRender()
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const vault: any = this.app.vault
    const ws: any = this.app.workspace
    this.registerEvent(vault.on('create', () => this.requestRender()))
    this.registerEvent(vault.on('delete', (f: any) => this.onDelete(f)))
    this.registerEvent(vault.on('rename', (f: any, old: string) => this.onRename(f, old)))
    this.registerEvent(vault.on('modify', () => this.onModify()))
    this.registerEvent(vault.on('config-changed', (k: string) => k === 'showUnsupportedFiles' && this.requestRender()))
    this.registerEvent(ws.on('file-open', (f: any) => this.onFileOpen(f)))
    const reg: any = (this.app as any).viewRegistry
    if (reg?.on) this.registerEvent(reg.on('extensions-updated', () => this.requestRender()))
    this.activePath = ws.getActiveFile?.()?.path ?? null
    this.render()
  }

  onunload(): void {
    clearTimeout(this.renderTimer)
    if (this.saveFoldTimer) {
      clearTimeout(this.saveFoldTimer)
      this.saveFolds()
    }
    super.onunload()
  }

  // ------------------------------------------------------------------ folds

  private loadFolds(): void {
    const v = (this.app as any).loadLocalStorage?.('file-explorer-unfold')
    if (Array.isArray(v)) for (const p of v) if (typeof p === 'string') this.expanded.add(p)
  }
  private saveFolds(): void {
    this.saveFoldTimer = null
    // Save the expanded folders in tree order (only folders that currently exist).
    const out: string[] = []
    const walk = (f: any): void => {
      for (const c of this.getSortedFolderItems(f)) {
        if (!isFolder(c)) continue
        if (this.expanded.has(c.path)) out.push(c.path)
        walk(c)
      }
    }
    const root = this.app.vault.getRoot?.()
    if (root) walk(root)
    ;(this.app as any).saveLocalStorage?.('file-explorer-unfold', out)
  }
  private requestSaveFolds(): void {
    clearTimeout(this.saveFoldTimer)
    this.saveFoldTimer = setTimeout(() => this.saveFolds(), 200)
  }

  isCollapsed(path: string): boolean {
    return !this.expanded.has(path)
  }

  setCollapsed(path: string, collapsed: boolean): void {
    if (collapsed) this.expanded.delete(path)
    else this.expanded.add(path)
    this.requestSaveFolds()
    this.render()
  }

  setIsAllCollapsed(collapsed: boolean): void {
    if (collapsed) this.expanded.clear()
    else for (const f of this.allFolders()) this.expanded.add(f.path)
    this.requestSaveFolds()
    this.render()
  }

  private allFolders(): any[] {
    const out: any[] = []
    const walk = (f: any) => {
      for (const c of f.children || []) if (isFolder(c)) out.push(c), walk(c)
    }
    const root = this.app.vault.getRoot?.()
    if (root) walk(root)
    return out
  }

  private updateCollapseButton(): void {
    const any = this.expanded.size > 0 && this.allFolders().some(f => this.expanded.has(f.path))
    const label = any ? FE_STRINGS.collapseAll : FE_STRINGS.expandAll
    this.collapseButtonEl.empty()
    setIcon(this.collapseButtonEl, any ? 'lucide-chevrons-down-up' : 'lucide-chevrons-up-down')
    this.collapseButtonEl.setAttribute('aria-label', label)
    setTooltip(this.collapseButtonEl, label)
  }

  // ------------------------------------------------------------------ rendering

  requestRender(): void {
    if (this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null
      this.render()
    }, 0)
  }

  private isShown(f: any): boolean {
    if (f.name?.startsWith('.')) return false
    const cfgDir = (this.app.vault as any).configDir
    if (f.path === cfgDir) return false
    if (isFolder(f)) return true
    if (f.extension === 'md') return true
    return true // unsupported files stay in the DOM (`.is-unsupported`); CSS hides them unless `.show-unsupported`
  }

  private isSupported(f: any): boolean {
    const reg: any = (this.app as any).viewRegistry
    return !reg?.isExtensionRegistered || reg.isExtensionRegistered(f.extension)
  }

  getSortedFolderItems(folder: any): any[] {
    return (folder.children || []).filter((c: any) => this.isShown(c)).sort((a: any, b: any) => compareFiles(this.sortOrder, a, b))
  }

  /** Files matching the search filter (path contains every space-separated term, case-insensitive). */
  private matchesFilter(f: any): boolean {
    const q = this.searchQuery.trim().toLowerCase()
    if (!q || isFolder(f)) return true
    const p = f.path.toLowerCase()
    return q.split(/\s+/).every(t => p.includes(t))
  }

  private folderHasMatch(folder: any): boolean {
    for (const c of folder.children || []) {
      if (!this.isShown(c)) continue
      if (isFolder(c) ? this.folderHasMatch(c) : this.matchesFilter(c)) return true
    }
    return false
  }

  render(): void {
    if (this.renaming) return
    const root = this.app.vault.getRoot?.()
    this.fileItems = {}
    const container = this.rootEl
    this.navFilesContainer.toggleClass('show-unsupported', !!(this.app.vault as any).getConfig?.('showUnsupportedFiles'))
    container.empty()
    container.createDiv().setAttribute('style', 'width: 0px; height: 0.1px; margin-bottom: 0px;')
    if (root) this.renderChildren(root, container, 0)
    this.updateCollapseButton()
  }

  private renderChildren(folder: any, parentEl: HTMLElement, depth: number): void {
    const filtering = !!this.searchQuery.trim()
    for (const child of this.getSortedFolderItems(folder)) {
      if (filtering && (isFolder(child) ? !this.folderHasMatch(child) : !this.matchesFilter(child))) continue
      if (isFolder(child)) this.renderFolder(child, parentEl, depth, filtering)
      else this.renderFile(child, parentEl, depth)
    }
  }

  private indent(el: HTMLElement, depth: number): void {
    el.setAttribute('style', `margin-inline-start: ${-INDENT * depth}px !important; padding-inline-start: ${BASE_PAD + INDENT * depth}px !important;`)
  }

  private renderFolder(folder: any, parentEl: HTMLElement, depth: number, filtering: boolean): void {
    const collapsed = !filtering && this.isCollapsed(folder.path)
    const el = parentEl.createDiv('tree-item nav-folder')
    el.toggleClass('is-collapsed', collapsed)
    const selfEl = el.createDiv({ cls: 'tree-item-self nav-folder-title is-clickable mod-collapsible', attr: { 'data-path': folder.path, draggable: 'true' } })
    this.indent(selfEl, depth)
    const collapseEl = selfEl.createDiv('tree-item-icon collapse-icon')
    collapseEl.toggleClass('is-collapsed', collapsed)
    setIcon(collapseEl, 'right-triangle')
    const innerEl = selfEl.createDiv({ cls: 'tree-item-inner nav-folder-title-content', text: folder.name })
    const item: ItemDom = { file: folder, el, selfEl, innerEl, collapseEl }
    this.fileItems[folder.path] = item
    if (!collapsed) {
      item.childrenEl = el.createDiv('tree-item-children nav-folder-children')
      if (this.getSortedFolderItems(folder).length) item.childrenEl.createDiv().setAttribute('style', 'width: 0px; height: 0.1px; margin-bottom: 0px;')
      this.renderChildren(folder, item.childrenEl, depth + 1)
    }
    if (this.selected.has(folder.path)) selfEl.addClass('is-selected')
    selfEl.addEventListener('click', evt => {
      if (this.renaming?.item === item) return
      evt.preventDefault()
      if (this.handleItemSelection(evt, folder.path)) return
      this.setCollapsed(folder.path, !this.isCollapsed(folder.path))
    })
    selfEl.addEventListener('contextmenu', evt => {
      evt.preventDefault()
      this.openFileContextMenu(evt, folder)
    })
    this.attachDragSource(selfEl, folder)
    this.attachDropHandler(selfEl, () => folder, item)
  }

  private renderFile(file: any, parentEl: HTMLElement, depth: number): void {
    const el = parentEl.createDiv('tree-item nav-file')
    const selfEl = el.createDiv({ cls: 'tree-item-self nav-file-title tappable is-clickable', attr: { 'data-path': file.path, draggable: 'true' } })
    this.indent(selfEl, depth)
    if (file.path === this.activePath) selfEl.addClass('is-active')
    if (!this.isSupported(file)) selfEl.addClass('is-unsupported')
    if (this.selected.has(file.path)) selfEl.addClass('is-selected')
    const innerEl = selfEl.createDiv({ cls: 'tree-item-inner nav-file-title-content', text: file.basename })
    if (file.extension !== 'md') selfEl.createDiv({ cls: 'nav-file-tag', text: file.extension })
    const item: ItemDom = { file, el, selfEl, innerEl }
    this.fileItems[file.path] = item
    selfEl.addEventListener('click', evt => {
      if (this.renaming?.item === item) return
      void this.onFileClick(evt, file)
    })
    selfEl.addEventListener('auxclick', evt => {
      if (evt.button === 1) void this.onFileClick(evt, file)
    })
    selfEl.addEventListener('contextmenu', evt => {
      evt.preventDefault()
      this.openFileContextMenu(evt, file)
    })
    this.attachDragSource(selfEl, file)
    // A file row accepts drops into its parent folder.
    this.attachDropHandler(selfEl, () => file.parent ?? this.app.vault.getRoot?.())
  }

  // ------------------------------------------------------------------ events

  onRename(file: any, oldPath: string): void {
    if (this.expanded.has(oldPath) || [...this.expanded].some(p => p.startsWith(oldPath + '/'))) {
      const next = new Set<string>()
      for (const p of this.expanded) next.add(p === oldPath ? file.path : p.startsWith(oldPath + '/') ? file.path + p.slice(oldPath.length) : p)
      this.expanded = next
      this.requestSaveFolds()
    }
    if (this.activePath === oldPath) this.activePath = file.path
    this.requestRender()
  }

  onDelete(file: any): void {
    if (this.expanded.delete(file.path)) this.requestSaveFolds()
    this.requestRender()
  }

  onModify(): void {
    if (this.sortOrder.startsWith('byModifiedTime')) this.requestRender()
  }

  onFileOpen(file: any): void {
    const prev = this.activePath ? this.fileItems[this.activePath] : null
    prev?.selfEl.removeClass('is-active')
    this.activePath = file?.path ?? null
    if (!file) return
    if (this.autoReveal) this.revealInFolder(file)
    else this.fileItems[file.path]?.selfEl.addClass('is-active')
  }

  clearSelection(): void {
    for (const p of this.selected) this.fileItems[p]?.selfEl.removeClass('is-selected')
    this.selected.clear()
  }

  /** Shift-click selects the range between the active item and the clicked one (returns true when handled). */
  handleItemSelection(evt: MouseEvent, path: string): boolean {
    if (!evt.shiftKey) {
      this.clearSelection()
      return false
    }
    const showAll = this.navFilesContainer.hasClass('show-unsupported')
    const titles = Array.from(this.navFilesContainer.querySelectorAll<HTMLElement>('.nav-file-title, .nav-folder-title')).filter(
      el => showAll || !el.hasClass('is-unsupported')
    )
    const paths = titles.map(el => el.getAttribute('data-path') as string)
    const to = paths.indexOf(path)
    const from = this.activePath ? paths.indexOf(this.activePath) : -1
    if (to < 0 || from < 0) return false
    this.clearSelection()
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      this.selected.add(paths[i])
      titles[i].addClass('is-selected')
    }
    return true
  }

  async onFileClick(evt: MouseEvent, file: any): Promise<void> {
    if (this.handleItemSelection(evt, file.path)) return
    const ws: any = this.app.workspace
    const mode = evt.button === 1 ? 'tab' : Keymap.isModEvent(evt)
    await ws.getLeaf(mode).openFile(file, { active: true })
  }

  // ------------------------------------------------------------------ header actions

  setSortOrder(order: FileExplorerSortOrder): void {
    this.sortOrder = order
    this.render()
    this.app.workspace.requestSaveLayout()
  }

  private openSortMenu(evt: MouseEvent): void {
    const m = new Menu()
    SORT_ORDER_LABELS.forEach((group, gi) => {
      for (const [id, label] of group)
        m.addItem(i =>
          i
            .setSection('sort-' + gi)
            .setTitle(label)
            .setChecked(this.sortOrder === id)
            .onClick(() => this.setSortOrder(id))
        )
    })
    m.showAtMouseEvent(evt)
  }

  setAutoReveal(on: boolean): void {
    this.autoReveal = on
    this.autoRevealButtonEl.toggleClass('is-active', on)
    this.app.workspace.requestSaveLayout()
    if (on) {
      const f = (this.app.workspace as any).getActiveFile?.()
      if (f) this.revealInFolder(f)
    }
  }
  onToggleAutoReveal(): void {
    this.setAutoReveal(!this.autoReveal)
  }

  showSearch(show: boolean): void {
    this.showSearchFilter = show
    this.searchContainerEl.toggle(show)
    this.searchButtonEl.toggleClass('is-active', show)
    if (show) this.searchInputEl.focus()
    else if (this.searchQuery) {
      this.searchInputEl.value = ''
      this.onSearchChanged()
    }
    this.app.workspace.requestSaveLayout()
  }

  onSearchChanged(): void {
    this.searchQuery = this.searchInputEl.value
    this.render()
    this.app.workspace.requestSaveLayout()
  }

  /** Expand the ancestors of `file`, select it and scroll it into view. */
  revealInFolder(file: any): void {
    let changed = false
    for (let p = file.parent; p && !(p.isRoot?.() ?? p.path === '/'); p = p.parent) {
      if (!this.expanded.has(p.path)) {
        this.expanded.add(p.path)
        changed = true
      }
    }
    if (changed) this.requestSaveFolds()
    if (file.path === (this.app.workspace as any).getActiveFile?.()?.path) this.activePath = file.path
    this.render()
    const item = this.fileItems[file.path]
    if (!item) return
    // Reference: focus the item (keyboard focus ring), scroll it into view, flash it for 750 ms, activate the explorer.
    for (const k in this.fileItems) if (this.fileItems[k] !== item) this.fileItems[k].selfEl.removeClass('has-focus')
    item.selfEl.addClass('has-focus')
    requestAnimationFrame(() => {
      item.selfEl.scrollIntoView?.({ block: 'nearest' })
      item.selfEl.addClass('is-flashing')
      window.setTimeout(() => item.selfEl.removeClass('is-flashing'), 750)
      this.app.workspace.setActiveLeaf(this.leaf as any)
    })
  }

  revealActiveFile(): void {
    const f = (this.app.workspace as any).getActiveFile?.()
    if (f) this.revealInFolder(f)
  }

  private targetFolder(): any {
    const fm: any = (this.app as any).fileManager
    const src = (this.app.workspace as any).getActiveFile?.()?.path ?? ''
    return fm?.getNewFileParent ? fm.getNewFileParent(src) : this.app.vault.getRoot?.()
  }

  async onCreateNewNoteClick(evt?: MouseEvent, folder?: any): Promise<void> {
    const fm: any = (this.app as any).fileManager
    const f = await fm.createNewMarkdownFile(folder ?? this.targetFolder())
    const ws: any = this.app.workspace
    await ws.getLeaf(evt ? Keymap.isModEvent(evt) : false).openFile(f, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } })
  }

  async onCreateNewFolderClick(parent?: any): Promise<void> {
    const fm: any = (this.app as any).fileManager
    const folder = await fm.createNewFolder(parent ?? this.targetFolder())
    if (!folder) return
    const p = folder.parent
    if (p && !(p.isRoot?.() ?? false)) this.expanded.add(p.path)
    this.render()
    await this.startRenameFile(folder)
  }

  // ------------------------------------------------------------------ context menu

  openFileContextMenu(evt: MouseEvent, file: any): void {
    const S = FE_STRINGS
    const app: any = this.app
    const menu = new Menu().addSections(['title', 'open', 'action-primary', 'action', 'info', 'info.copy', 'view', 'system', '', 'danger'])
    const isRoot = !file || (isFolder(file) && (file.isRoot?.() ?? file.path === '/'))
    if (isFolder(file) || !file) {
      const folder = file ?? app.vault.getRoot?.()
      menu.addItem(i => i.setSection('action-primary').setTitle(S.newNote).setIcon('lucide-edit').onClick(() => void this.onCreateNewNoteClick(undefined, folder)))
      menu.addItem(i => i.setSection('action-primary').setTitle(S.newFolder).setIcon('lucide-folder-open').onClick(() => void this.onCreateNewFolderClick(folder)))
    } else {
      menu.addItem(i => i.setSection('open').setTitle(S.openNewTab).setIcon('lucide-file-plus').onClick(() => void app.workspace.getLeaf('tab').openFile(file, { active: true })))
      menu.addItem(i => i.setSection('open').setTitle(S.openRight).setIcon('lucide-separator-vertical').onClick(() => void app.workspace.getLeaf('split').openFile(file, { active: true })))
    }
    if (!isRoot) {
      menu.addItem(i => i.setSection('action').setTitle(S.makeCopy).setIcon('lucide-files').onClick(() => void this.duplicate(file)))
      menu.addItem(i => i.setSection('danger').setTitle(S.rename).setIcon('lucide-edit-3').onClick(() => void this.startRenameFile(file)))
      menu.addItem(i =>
        i
          .setSection('danger')
          .setTitle(S.delete)
          .setIcon('lucide-trash-2')
          .setWarning(true)
          .onClick(() => void this.promptForDeletion(file))
      )
    }
    app.workspace.trigger('file-menu', menu, file ?? app.vault.getRoot?.(), 'file-explorer-context-menu', null)
    const selfEl: HTMLElement | undefined = file ? this.fileItems[file.path]?.selfEl : undefined
    if (selfEl) {
      selfEl.addClass('has-focus')
      menu.setParentElement(selfEl)
      menu.onHide(() => selfEl.removeClass('has-focus'))
    }
    menu.showAtMouseEvent(evt)
  }

  private async duplicate(file: any): Promise<void> {
    const vault: any = this.app.vault
    const parentPrefix = file.parent && !(file.parent.isRoot?.() ?? file.parent.path === '/') ? file.parent.path + '/' : ''
    if (isFolder(file)) {
      const dest = vault.getAvailablePath(parentPrefix + file.name, '')
      const copyInto = async (src: any, to: string) => {
        await vault.createFolder(to)
        for (const c of src.children) {
          if (isFolder(c)) await copyInto(c, to + '/' + c.name)
          else await this.copyFile(c, to + '/' + c.name)
        }
      }
      await copyInto(file, dest)
      return
    }
    await this.copyFile(file, vault.getAvailablePath(parentPrefix + file.basename, file.extension))
  }

  private async copyFile(file: any, dest: string): Promise<void> {
    const vault: any = this.app.vault
    if (typeof vault.copy === 'function') await vault.copy(file, dest)
    else await vault.createBinary(dest, await vault.readBinary(file))
  }

  async promptForDeletion(file: any): Promise<void> {
    await (this.app as any).fileManager.promptForDeletion(file)
  }

  // ------------------------------------------------------------------ rename

  /** Name validation (illegal chars, empty, dotfile, duplicate); returns an error text or ''. */
  private validateName(file: any, name: string, checkEmpty: boolean): string {
    if (ILLEGAL_FILE_RE.test(name)) return FE_STRINGS.msgInvalidCharacters + ' ' + ILLEGAL_FILE_CHARS_DISPLAY
    if (checkEmpty && name === '') return FE_STRINGS.msgEmptyFileName
    if (name.startsWith('.')) return FE_STRINGS.msgBadDotfile
    if (file && (this.app.vault as any).checkForDuplicate?.(file, name)) return FE_STRINGS.msgFileAlreadyExists
    return ''
  }

  async startRenameFile(file: any): Promise<void> {
    if (isFolder(file) && (file.isRoot?.() ?? file.path === '/')) return
    await this.saveRename()
    this.exitRename()
    let item = this.fileItems[file.path]
    if (!item) {
      this.revealInFolder(file)
      item = this.fileItems[file.path]
    }
    if (!item) return
    this.renaming = { file, item }
    const el = item.innerEl
    item.selfEl.addClass('has-focus', 'is-being-renamed')
    el.setAttribute('contenteditable', 'true')
    el.setAttribute('spellcheck', String(!!(this.app.vault as any).getConfig?.('spellcheck')))
    el.setText(basenameOf(file))
    el.focus()
    const sel = el.ownerDocument.getSelection()
    if (sel) {
      const r = el.ownerDocument.createRange()
      r.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(r)
    }
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === 'Enter') {
        if (evt.isComposing) return
        evt.preventDefault()
        void this.saveRename().then(ok => ok && this.exitRename())
      } else if (evt.key === 'Escape') {
        evt.preventDefault()
        this.exitRename()
      }
    }
    // Live validation tooltip while typing.
    const linkChars = ILLEGAL_LINK_CHARS.split('')
    const onInput = () => {
      const text = el.textContent || ''
      if (!(el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE)) el.setText(text)
      const name = text.trim()
      let err = this.validateName(file, name, false)
      if (!err && linkChars.some(c => name.includes(c))) err = 'Links will not work with file names containing any of these characters: ' + linkChars.join(' ')
      if (err) displayTooltip(item.selfEl, err, { classes: ['mod-error'] })
      else hideTooltip()
    }
    const onBlur = () => {
      void this.saveRename().then(() => {
        this.exitRename()
        hideTooltip()
      })
    }
    el.addEventListener('keydown', onKey)
    el.addEventListener('input', onInput)
    el.addEventListener('blur', onBlur)
    ;(this.renaming as any).cleanup = () => {
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('input', onInput)
      el.removeEventListener('blur', onBlur)
    }
  }

  exitRename(): void {
    const r: any = this.renaming
    if (!r) return
    this.renaming = null
    r.cleanup?.()
    r.item.selfEl.removeClass('is-being-renamed')
    r.item.innerEl.removeAttribute('contenteditable')
    r.item.innerEl.removeAttribute('spellcheck')
    r.item.innerEl.setText(basenameOf(r.file))
    r.item.selfEl.querySelector('.tooltip')?.remove()
    this.render()
  }

  /** Commit the rename in progress. Resolves false (and shows an error tooltip) when it is rejected. */
  async saveRename(): Promise<boolean> {
    const r: any = this.renaming
    if (!r) return true
    const file = r.file
    const name = (r.item.innerEl.textContent || '').trim()
    let err = this.validateName(file, name, true)
    if (!err) {
      const newPath = file.getNewPathAfterRename(name)
      if (newPath !== file.path) {
        try {
          await (this.app as any).fileManager.renameFile(file, newPath)
        } catch (e: any) {
          console.error(e)
          err = e?.message || e?.code || String(e)
        }
      }
    }
    if (err) {
      displayTooltip(r.item.selfEl, err, { placement: 'bottom', classes: ['mod-error'] })
      setTimeout(() => hideTooltip(), 2000)
      return false
    }
    return true
  }

  // ------------------------------------------------------------------ drag & drop

  private attachDragSource(el: HTMLElement, file: any): void {
    el.addEventListener('dragstart', evt => {
      this.dragFile = file
      evt.dataTransfer?.setData('text/plain', file.path)
      if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'all'
      const dm = (this.app as any).dragManager
      if (dm) dm.onDragStart(evt, isFolder(file) ? dm.dragFolder(evt, file, 'file-explorer') : dm.dragFile(evt, file, 'file-explorer'))
      el.addClass('is-being-dragged')
    })
    el.addEventListener('dragend', () => {
      this.dragFile = null
      el.removeClass('is-being-dragged')
    })
  }

  attachDropHandler(el: HTMLElement, getFolder: () => any, item?: ItemDom): void {
    const canDrop = (folder: any) => {
      const f = this.dragFile
      if (!f || !folder) return false
      if (f === folder || f.parent === folder) return false
      if (isFolder(f) && (folder.path === f.path || folder.path.startsWith(f.path + '/'))) return false
      return true
    }
    el.addEventListener('dragover', evt => {
      const folder = getFolder()
      if (!canDrop(folder)) return
      evt.preventDefault()
      evt.stopPropagation()
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move'
      const target = this.fileItems[folder.path]?.el ?? this.navFilesContainer
      if (!target.hasClass('is-being-dragged-over')) {
        this.navFilesContainer.querySelectorAll('.is-being-dragged-over').forEach(e => e.removeClass('is-being-dragged-over'))
        target.addClass('is-being-dragged-over')
      }
      if (item && this.isCollapsed(folder.path) && !this.dragHoverTimer)
        this.dragHoverTimer = setTimeout(() => {
          this.dragHoverTimer = null
          this.expanded.add(folder.path)
          this.requestSaveFolds()
          this.render()
        }, 750)
    })
    el.addEventListener('dragleave', () => {
      clearTimeout(this.dragHoverTimer)
      this.dragHoverTimer = null
    })
    el.addEventListener('drop', evt => {
      const folder = getFolder()
      this.navFilesContainer.querySelectorAll('.is-being-dragged-over').forEach(e => e.removeClass('is-being-dragged-over'))
      clearTimeout(this.dragHoverTimer)
      this.dragHoverTimer = null
      if (!canDrop(folder)) return
      evt.preventDefault()
      evt.stopPropagation()
      const f = this.dragFile
      this.dragFile = null
      const prefix = folder.isRoot?.() || folder.path === '/' ? '' : folder.path + '/'
      const vault: any = this.app.vault
      const dest = isFolder(f) ? vault.getAvailablePath?.(prefix + f.name, '') ?? prefix + f.name : vault.getAvailablePath?.(prefix + f.basename, f.extension) ?? prefix + f.name
      void (this.app as any).fileManager.renameFile(f, dest)
    })
  }
}
