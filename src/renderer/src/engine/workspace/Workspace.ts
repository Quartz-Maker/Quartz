// Workspace — `app.workspace` (plugin API). Owns rootSplit/leftSplit/rightSplit/floatingSplit,
// the ribbons, the active leaf, layout (de)serialisation (workspace.json) and leaf-opening rules.
import { Events } from '../core/Events'
import { WorkspaceItem, WorkspaceParent } from './WorkspaceItem'
import {
  WorkspaceSplit,
  WorkspaceSidedock,
  WorkspaceRoot,
  WorkspaceFloating,
  WorkspaceWindow,
  sideClasses,
  type SplitDirection,
  type Side,
  type WorkspaceWindowInitData
} from './WorkspaceSplit'
import { WorkspaceTabs } from './WorkspaceTabs'
import { WorkspaceLeaf, type HistoryEntry, type OpenViewState } from './WorkspaceLeaf'
import { WorkspaceRibbon } from './WorkspaceRibbon'
import { onDragLeaf, getDropLocation } from './dragLeaf'
import { RecentFileTracker, type RecentFilesOptions } from './RecentFileTracker'
import { setIcon, setDynamicTooltip } from './dom'
import { Menu } from './Menu'
import { t } from './strings'
import { notice, type AppLike } from './AppLike'
import { debounce, microtaskCoalesce, isElShown, genId, type Debouncer } from './util'
import { ItemView, type View } from '../view/View'
import { FileView } from '../view/FileView'
import { EmptyView, DeferredView } from '../view/EmptyView'
import { applySpellcheckLanguages } from '../settings/spellcheck'
import { setLayout, deserializeLayout, updateLayout, updateFrameless, getDropDirection, undoCloseLeaf, getAdjacentLeafInDirection, moveLeafToPopout } from './layoutHelpers'

export { WORKSPACE_FILE, WORKSPACE_MOBILE_FILE, SAVE_LAYOUT_DELAY, UNDO_HISTORY_MAX }
export type { PaneType, UndoEntry, WorkspaceOptions }
import {WORKSPACE_FILE, WORKSPACE_MOBILE_FILE, SAVE_LAYOUT_DELAY, UNDO_HISTORY_MAX, type PaneType, type UndoEntry, type WorkspaceOptions} from './workspaceTypes'

function isLeaf(x: any): x is WorkspaceLeaf {
  return x instanceof WorkspaceLeaf
}

export class Workspace extends Events {
  app: AppLike
  containerEl: HTMLElement
  leftSplit!: WorkspaceSidedock
  rightSplit!: WorkspaceSidedock
  leftRibbon: WorkspaceRibbon
  rightRibbon: WorkspaceRibbon
  rootSplit!: WorkspaceRoot
  floatingSplit!: WorkspaceFloating
  activeLeaf: WorkspaceLeaf | null = null
  activeTabGroup: WorkspaceTabs | null = null
  layoutReady = false
  lastTabGroupStacked = false
  onLayoutReadyCallbacks: { pluginId?: string; callback: () => any }[] | null = []
  undoHistory: UndoEntry[] = []
  lastActiveFile: any = null
  _activeEditor: any = null
  layoutItemQueue: WorkspaceItem[] = []
  hoverLinkSources: Record<string, any> = {}
  editorExtensions: any[] = []
  recentFileTracker: RecentFileTracker
  leftSidebarToggleButtonEl: HTMLElement
  rightSidebarToggleButtonEl: HTMLElement
  options: Required<WorkspaceOptions>
  /** MarkdownView class (editor area) for `activeEditor`; set by the editor once it exists. */
  static markdownViewClass: (new (...a: any[]) => any) | null = null

  requestSaveLayout: Debouncer<[], Promise<void>>
  requestResize: Debouncer<[], void>
  requestActiveLeafEvents: Debouncer<[], void>
  requestUpdateLayout: () => void
  requestLayoutChangeEvents: Debouncer<[], void>

  constructor(app: AppLike, containerEl: HTMLElement, options: WorkspaceOptions = {}) {
    super()
    this.app = app
    this.containerEl = containerEl
    this.options = { titlebarStyle: options.titlebarStyle ?? 'hidden', isMacOS: options.isMacOS ?? false, canPopoutWindow: options.canPopoutWindow ?? true }
    this.requestSaveLayout = debounce(() => this.saveLayout(), SAVE_LAYOUT_DELAY)
    this.requestResize = debounce(() => this.onResize(), 0)
    this.requestActiveLeafEvents = debounce(() => this.activeLeafEvents(), 0)
    this.requestUpdateLayout = microtaskCoalesce(() => this.updateLayout())
    this.requestLayoutChangeEvents = debounce(() => {
      if (this.layoutReady) this.trigger('layout-change')
    }, 10)
    this.recentFileTracker = new RecentFileTracker(this, app.vault)
    this.leftRibbon = new WorkspaceRibbon(this, 'left')
    this.rightRibbon = new WorkspaceRibbon(this, 'right')
    this.leftSidebarToggleButtonEl = this.makeSidebarToggle('left')
    this.rightSidebarToggleButtonEl = this.makeSidebarToggle('right')

    // Keep history entries/undo stack pointing at renamed files.
    app.vault.on('rename', (file: any, oldPath: string) => {
      if (!file || typeof file.extension !== 'string') return
      const fix = (e: HistoryEntry) => {
        if ((e.state.state as any)?.file === oldPath) {
          e.title = file.basename
          ;(e.state.state as any).file = file.path
        }
      }
      const fixHist = (h: { backHistory: HistoryEntry[]; forwardHistory: HistoryEntry[] }) => {
        h.backHistory.forEach(fix)
        h.forwardHistory.forEach(fix)
      }
      this.iterateAllLeaves(l => fixHist(l.history))
      for (const u of this.undoHistory) {
        if (u.state.state?.file === oldPath) u.state.state.file = file.path
        fixHist(u.leafHistory)
      }
    })
    // A view type (un)registered → rebuild leaves of that type.
    const rebuild = (type: string) => {
      for (const leaf of this.getLeavesOfType(type)) {
        if (leaf.view instanceof DeferredView) continue
        const vs = leaf.getViewState()
        void (async () => {
          await leaf.open(new EmptyView(leaf))
          await leaf.setViewState(vs)
        })()
      }
    }
    app.viewRegistry.on('view-registered', rebuild)
    app.viewRegistry.on('view-unregistered', rebuild)
  }

  get canPopoutWindow(): boolean {
    return this.options.canPopoutWindow
  }

  private makeSidebarToggle(side: Side): HTMLElement {
    return createDiv('sidebar-toggle-button ' + sideClasses(side, 'mod-{side}').join(' '), el => {
      const split = () => (side === 'left' ? this.leftSplit : this.rightSplit)
      setDynamicTooltip(el, () => (split().collapsed ? t.sidebarExpand : t.sidebarCollapse))
      el.createDiv('clickable-icon', c => setIcon(c, 'sidebar-toggle-button-icon'))
      el.addEventListener('click', () => split().toggle())
      el.addEventListener('contextmenu', evt => {
        const m = Menu.forEvent(evt).addItem(i =>
          i
            .setTitle(side === 'left' ? t.menu.leftSidebar : t.menu.rightSidebar)
            .setIcon(side === 'left' ? 'sidebar-left' : 'sidebar-right')
            .setChecked(!split().collapsed)
            .onClick(() => split().toggle())
        )
        if (side === 'left') {
          m.addItem(i =>
            i
              .setTitle(t.menu.ribbon)
              .setIcon('lucide-panel-left-close')
              .setChecked(!!this.app.vault.getConfig('showRibbon'))
              .onClick(() => this.app.vault.setConfig?.('showRibbon', !this.app.vault.getConfig('showRibbon')))
          )
        }
      })
    })
  }

  // ---------------------------------------------------------------- layout persistence

  get initialized(): boolean {
    return !!this.rootSplit
  }

  async readWorkspaceFile(): Promise<any> {
    const vault = this.app.vault
    try {
      return JSON.parse(await vault.adapter.read(vault.configDir + '/' + WORKSPACE_FILE))
    } catch {
      return {}
    }
  }

  /** Boot: read workspace.json, build the tree, then fire layout-ready + onLayoutReady callbacks. */
  async loadLayout(): Promise<void> {
    const data = await this.readWorkspaceFile()
    if (Object.prototype.hasOwnProperty.call(data, 'lastOpenFiles')) this.recentFileTracker.load(data.lastOpenFiles)
    await this.setLayout(data)
    this.trigger('layout-ready')
    const cbs = this.onLayoutReadyCallbacks || []
    this.onLayoutReadyCallbacks = null
    for (const { pluginId, callback } of cbs) {
      try {
        await new Promise(r => setTimeout(r, 0))
        callback()
      } catch (e) {
        console.error(e)
        if (pluginId) notice(this.app, `Plugin failure: ${pluginId}`)
      }
    }
  }

  onLayoutReady(callback: () => any): void {
    if (this.onLayoutReadyCallbacks === null) callback()
    else this.onLayoutReadyCallbacks.push({ callback })
  }

  async clearLayout(): Promise<void> {
    this.layoutReady = false
    this.requestLayoutChangeEvents.cancel()
    const closing: Promise<any>[] = []
    this.iterateAllLeaves(l => {
      closing.push(l.open(null))
    })
    await Promise.all(closing)
    for (const s of [this.leftSplit, this.rootSplit, this.rightSplit, this.floatingSplit]) {
      s.containerEl.detach()
      s.component.unload()
    }
    for (const w of this.floatingSplit.children.slice()) if (w instanceof WorkspaceWindow) w.close()
    ;(this as any).rootSplit = null
    ;(this as any).leftSplit = null
    ;(this as any).rightSplit = null
    ;(this as any).floatingSplit = null
    this.activeLeaf = null
    this.layoutItemQueue = []
  }

  async setLayout(data: any): Promise<void> {
    return setLayout(this, data)
  }

  async changeLayout(layout: any): Promise<void> {
    if (!this.layoutReady) return
    await this.clearLayout()
    await this.setLayout(layout)
  }

  /** Builds an item from its serialised form; returns null for empty/invalid parts. */
  async deserializeLayout(data: any, side: 'root' | 'left' | 'right' | null): Promise<WorkspaceItem | null> {
    return deserializeLayout(this, data, side)
  }

  getLayout(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    out.main = this.rootSplit.serialize()
    out.left = this.leftSplit.serialize()
    out.right = this.rightSplit.serialize()
    out['left-ribbon'] = this.leftRibbon.serialize()
    if (this.floatingSplit.children.length) out.floating = this.floatingSplit.serialize()
    if (this.activeLeaf) out.active = this.activeLeaf.id
    return out
  }

  async saveLayout(): Promise<void> {
    if (!this.layoutReady) return
    const vault = this.app.vault
    const layout = this.getLayout()
    layout.lastOpenFiles = this.recentFileTracker.serialize()
    try {
      await vault.adapter.write(vault.configDir + '/' + WORKSPACE_FILE, JSON.stringify(layout, null, 2))
    } catch {
      /* ignored */
    }
  }

  get activeEditor(): any {
    const mv = Workspace.markdownViewClass
    return this._activeEditor ?? (mv ? this.getActiveViewOfType(mv as any) : null)
  }

  set activeEditor(v: any) {
    const mv = Workspace.markdownViewClass
    if (!(mv && v instanceof mv)) this._activeEditor = v
  }

  // ---------------------------------------------------------------- leaf creation

  createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf(this.app)
    if (parent.children.length > 0) leaf.setDimension(100 / parent.children.length)
    parent.insertChild(index, leaf)
    this.setActiveLeaf(leaf)
    return leaf
  }

  /** Places `newItem` next to `target` (creating a nested split when the direction differs). */
  splitLeaf(target: WorkspaceItem, newItem: WorkspaceItem, direction: SplitDirection = 'vertical', before?: boolean): void {
    let split: WorkspaceSplit | null = null
    let index = -1
    let item: WorkspaceItem = target
    for (let p: WorkspaceParent | null = target.parent; p; ) {
      if (p instanceof WorkspaceSplit) {
        split = p
        index = p.children.indexOf(item)
        break
      }
      item = p
      p = p.parent
    }
    if (!split) return
    if (!(newItem instanceof WorkspaceTabs)) newItem = WorkspaceTabs.createFrom(this, newItem)
    const dim = item.dimension
    if (direction !== split.direction) {
      item.setDimension(null)
      const sub = new WorkspaceSplit(this, direction)
      split.replaceChild(index, sub)
      sub.setDimension(dim)
      if (before) {
        sub.insertChild(0, newItem)
        sub.insertChild(1, item)
      } else {
        sub.insertChild(0, item)
        sub.insertChild(1, newItem)
      }
    } else {
      if (dim !== null) {
        item.setDimension(dim / 2)
        newItem.setDimension(dim / 2)
      }
      split.insertChild(before ? index : index + 1, newItem)
    }
  }

  createLeafBySplit(leaf: WorkspaceLeaf, direction?: SplitDirection, before?: boolean): WorkspaceLeaf {
    const n = new WorkspaceLeaf(this.app)
    this.splitLeaf(leaf, n, direction, before)
    this.setActiveLeaf(n)
    return n
  }

  splitActiveLeaf(direction?: SplitDirection): WorkspaceLeaf {
    const leaf = this.getMostRecentLeaf()
    return leaf ? this.createLeafBySplit(leaf, direction) : this.createLeafInParent(this.rootSplit, 0)
  }

  splitLeafOrActive(leaf?: WorkspaceLeaf, direction?: SplitDirection): WorkspaceLeaf {
    return leaf ? this.createLeafBySplit(leaf, direction) : this.splitActiveLeaf(direction)
  }

  /** Copies view state, eState and history into a new leaf ("Split right/down", Mod-click back). */
  async duplicateLeaf(leaf: WorkspaceLeaf, leafType?: PaneType | boolean | SplitDirection, direction?: SplitDirection): Promise<WorkspaceLeaf> {
    if (leafType === 'horizontal' || leafType === 'vertical') {
      direction = leafType
      leafType = 'split'
    }
    const vs = leaf.getViewState()
    const es = leaf.getEphemeralState()
    const hist = leaf.history.serialize()
    const n = leafType === 'split' ? this.createLeafBySplit(leaf, direction) : this.getLeaf(leafType as PaneType | boolean)
    await n.setViewState(vs, { ...es, focus: true })
    n.history.deserialize(hist)
    return n
  }

  /** Active leaf if navigable; else most recent visible navigable leaf; else a new leaf. */
  getUnpinnedLeaf(setActive = true): WorkspaceLeaf {
    const active = this.activeLeaf
    if (active && active.canNavigate()) return active
    const container = active?.getContainer() ?? this.rootSplit
    let best: WorkspaceLeaf | null = null
    this.iterateLeaves(container, l => {
      if (!l.canNavigate()) return
      const p = l.parent as any
      if (p && (p.children[p.currentTab] === l || (p instanceof WorkspaceTabs && p.isStacked)) && (!best || best.activeTime < l.activeTime)) best = l
    })
    if (!best) {
      const recent = this.getMostRecentLeaf(container)
      const parent = (recent?.parent ?? container) as WorkspaceParent
      best = new WorkspaceLeaf(this.app)
      parent.insertChild(-1, best)
    }
    if (setActive) this.setActiveLeaf(best)
    return best
  }

  getLeaf(newLeaf?: PaneType | boolean, direction?: SplitDirection): WorkspaceLeaf {
    if (newLeaf === 'split') return this.splitActiveLeaf(direction)
    if (newLeaf === 'tab' || newLeaf === true) return this.createLeafInTabGroup()
    if (newLeaf === 'window') return this.openPopoutLeaf()
    return this.getUnpinnedLeaf()
  }

  /** New tab right after the group's most recently active tab (reuses an empty "New tab"). */
  createLeafInTabGroup(tabs?: WorkspaceTabs): WorkspaceLeaf {
    if (!tabs) {
      const recent = this.getMostRecentLeaf()
      if (!recent) throw new Error('No tab group found.')
      tabs = recent.parent as WorkspaceTabs
    }
    let idx = tabs.children.length - 1
    let last = tabs.children[idx]
    tabs.children.forEach((l, i) => {
      if (l.activeTime > last.activeTime) {
        last = l
        idx = i
      }
    })
    if (last.view instanceof EmptyView && last.view.getViewType() === 'empty') return last
    const leaf = new WorkspaceLeaf(this.app)
    tabs.insertChild(idx + 1, leaf)
    if (this.app.vault.getConfig('focusNewTab') ?? true) this.setActiveLeaf(leaf)
    return leaf
  }

  /** "+" button / `workspace:new-tab`: append an empty leaf to `tabs` and focus it. */
  newTabIn(tabs: WorkspaceTabs): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf(this.app)
    const n = tabs.children.length
    tabs.insertChild(n, leaf)
    tabs.selectTabIndex(n)
    this.setActiveLeaf(leaf, { focus: true })
    return leaf
  }

  /** Moves `leaf` (an ItemView leaf) into a new popout window sized like its container. */
  moveLeafToPopout(leaf: WorkspaceLeaf, data?: WorkspaceWindowInitData): WorkspaceWindow {
    return moveLeafToPopout(this, leaf, data)
  }

  openPopout(data?: WorkspaceWindowInitData): WorkspaceWindow {
    const win = new WorkspaceWindow(this, null, data)
    this.floatingSplit.insertChild(-1, win)
    return win
  }

  openPopoutLeaf(data?: WorkspaceWindowInitData): WorkspaceLeaf {
    const win = this.openPopout(data)
    const leaf = new WorkspaceLeaf(this.app)
    win.insertChild(0, WorkspaceTabs.createFrom(this, leaf))
    return leaf
  }

  async openLinkText(linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, openViewState?: OpenViewState): Promise<void> {
    await this.getLeaf(newLeaf).openLinkText(linktext, sourcePath, openViewState)
  }

  // ---------------------------------------------------------------- activity

  setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean } | boolean, focusArg?: boolean): void {
    let focus = focusArg
    if (params && typeof params !== 'boolean') focus = params.focus
    if (!this.isAttached(leaf)) return
    const prev = this.activeLeaf
    if (prev === leaf) {
      if (focus && leaf) this.focusLeaf(leaf)
      return
    }
    if (prev) {
      prev.containerEl.removeClass('mod-active')
      prev.tabHeaderEl.removeClass('mod-active')
    }
    this.activeTabGroup?.containerEl.removeClass('mod-active')
    this.activeLeaf = leaf
    this.activeTabGroup = (leaf?.parent as WorkspaceTabs) ?? null
    this._activeEditor = null
    if (leaf) {
      leaf.activeTime = Date.now()
      leaf.containerEl.addClass('mod-active')
      leaf.tabHeaderEl.addClass('mod-active')
      this.activeTabGroup?.containerEl.addClass('mod-active')
      const p = leaf.parent
      if (p instanceof WorkspaceTabs) p.selectTabIndex(p.children.indexOf(leaf))
      this.updateTitle()
      if (focus) this.focusLeaf(leaf)
      this.requestActiveLeafEvents()
    }
  }

  focusLeaf(leaf: WorkspaceLeaf): void {
    leaf.setEphemeralState({ focus: true })
  }

  activeLeafEvents(): void {
    if (!this.layoutReady) return
    this.trigger('active-leaf-change', this.activeLeaf)
    const prev = this.lastActiveFile
    const cur = this.getActiveFile()
    if (prev !== cur) {
      this.recentFileTracker.onFileOpen(cur, prev)
      this.lastActiveFile = cur
      this.trigger('file-open', cur)
    }
  }

  getLeafById(id: string): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null
    this.iterateAllLeaves(l => {
      if (l.id === id) {
        found = l
        return true
      }
    })
    return found
  }

  getGroupLeaves(group: string | null): WorkspaceLeaf[] {
    const out: WorkspaceLeaf[] = []
    if (!group) return out
    this.iterateAllLeaves(l => {
      if (l.group === group) out.push(l)
    })
    return out
  }

  isAttached(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf) return false
    const r = leaf.getRoot()
    return [this.leftSplit, this.rootSplit, this.floatingSplit, this.rightSplit].includes(r as any)
  }

  getMostRecentLeaf(root?: WorkspaceParent): WorkspaceLeaf | null {
    let first: WorkspaceLeaf | null = null
    let best: WorkspaceLeaf | null = null
    this.iterateLeaves(root ?? [this.rootSplit, this.floatingSplit], l => {
      if (!first) first = l
      if (l.isVisible() && (!best || best.activeTime < l.activeTime)) best = l
    })
    return best ?? first
  }

  getLeftLeaf(split: boolean): WorkspaceLeaf | null {
    return this.getSideLeaf(this.leftSplit, split)
  }

  getRightLeaf(split: boolean): WorkspaceLeaf | null {
    return this.getSideLeaf(this.rightSplit, split)
  }

  getSideLeaf(side: WorkspaceSidedock, split: boolean): WorkspaceLeaf | null {
    if (split) {
      const tabs = new WorkspaceTabs(this)
      side.insertChild(-1, tabs)
      const l = new WorkspaceLeaf(this.app)
      tabs.insertChild(-1, l)
      return l
    }
    if (side.children.length === 0) side.insertChild(0, new WorkspaceTabs(this))
    const first = side.children[0]
    if (first instanceof WorkspaceParent) {
      const l = new WorkspaceLeaf(this.app)
      first.insertChild(-1, l)
      return l
    }
    return null
  }

  async ensureSideLeaf(type: string, side: Side, options?: { active?: boolean; split?: boolean; reveal?: boolean; state?: any }): Promise<WorkspaceLeaf> {
    const { active, split, reveal = true, state } = options || {}
    const existing = this.getLeavesOfType(type)
    const leaf = existing.length === 0 ? (side === 'left' ? this.getLeftLeaf(!!split) : this.getRightLeaf(!!split))! : existing[0]
    if (active || reveal) await leaf.loadIfDeferred()
    if (state || leaf.view.getViewType() !== type) await leaf.setViewState({ type, state })
    if (reveal) await this.revealLeaf(leaf)
    if (active) this.setActiveLeaf(leaf, { focus: true })
    return leaf
  }

  getActiveViewOfType<T extends View>(type: abstract new (...args: any[]) => T): T | null {
    const leaf = this.activeLeaf
    if (!leaf) return null
    return leaf.view instanceof type ? (leaf.view as T) : null
  }

  getActiveLeafOfViewType<T extends View>(type: abstract new (...args: any[]) => T): T | null {
    return this.getActiveViewOfType(type)
  }

  getActiveFileView(): FileView | null {
    let leaf = this.activeLeaf
    if (leaf && leaf.view.navigation) return leaf.view instanceof FileView ? leaf.view : null
    leaf = null
    let view: FileView | null = null
    this.iterateAllLeaves(l => {
      if (l.view.navigation && (!leaf || leaf.activeTime < l.activeTime)) {
        leaf = l
        view = l.view instanceof FileView ? l.view : null
      }
    })
    return view
  }

  getActiveFile(): any {
    return this.activeEditor?.file || this.getActiveFileView()?.file || null
  }

  // ---------------------------------------------------------------- iteration

  iterateTabs(items: WorkspaceItem | WorkspaceItem[], cb: (tabs: WorkspaceTabs) => any): boolean {
    const list = Array.isArray(items) ? items : [items]
    for (const it of list) {
      if (it instanceof WorkspaceTabs && cb(it)) return true
      if (it instanceof WorkspaceParent && this.iterateTabs(it.children, cb)) return true
    }
    return false
  }

  /** Depth-first; stops when the callback returns true. Accepts (items, cb) or (cb, item). */
  iterateLeaves(items: WorkspaceItem | WorkspaceItem[] | null, cb: (leaf: WorkspaceLeaf) => any): boolean
  iterateLeaves(cb: (leaf: WorkspaceLeaf) => any, item: WorkspaceItem): boolean
  iterateLeaves(items: any, cb: any): boolean {
    if (typeof items === 'function' && cb instanceof WorkspaceItem) {
      const x = cb
      cb = items
      items = x
    }
    if (!items) return false
    if (Array.isArray(items)) {
      for (const it of items) if (this.iterateLeaves(it, cb)) return true
    } else if (items instanceof WorkspaceLeaf) {
      if (cb(items)) return true
    } else if (items instanceof WorkspaceParent) {
      for (const c of items.children) if (this.iterateLeaves(c, cb)) return true
    }
    return false
  }

  iterateRootLeaves(cb: (leaf: WorkspaceLeaf) => any): void {
    this.iterateLeaves(this.rootSplit, cb)
  }

  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => any): void {
    this.iterateLeaves(this.rootSplit, cb)
    this.iterateLeaves(this.leftSplit, cb)
    this.iterateLeaves(this.rightSplit, cb)
    this.iterateLeaves(this.floatingSplit, cb)
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    const out: WorkspaceLeaf[] = []
    this.iterateAllLeaves(l => {
      if (l.view.getViewType() === type) out.push(l)
    })
    return out
  }

  detachLeavesOfType(type: string): void {
    for (const l of this.getLeavesOfType(type)) l.detach()
  }

  getAdjacentLeafInDirection(leaf: WorkspaceLeaf | null, dir: 'top' | 'bottom' | 'left' | 'right'): WorkspaceLeaf | null {
    return getAdjacentLeafInDirection(this, leaf, dir)
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const root = leaf.getRoot()
    if (root instanceof WorkspaceSidedock && root.collapsed) root.expand()
    const p = leaf.parent
    if (p instanceof WorkspaceTabs) p.selectTab(leaf)
    await leaf.loadIfDeferred()
  }

  getLastOpenFiles(): string[] {
    return this.recentFileTracker.getLastOpenFiles()
  }

  getRecentFiles(opts?: RecentFilesOptions): string[] {
    return this.recentFileTracker.getRecentFiles(opts)
  }

  addRecentFile(file: any): void {
    this.recentFileTracker.addRecentFile(file)
  }

  isInSidebar(leaf: WorkspaceItem): boolean {
    const r = leaf.getRoot()
    return r === this.leftSplit || r === this.rightSplit
  }

  /** Re-applies editor options to every Markdown view (plugins call this after mutating a registered
   *  editor-extension array) and the spellcheck languages. */
  updateOptions(): void {
    if (!this.layoutReady) return
    const MV = Workspace.markdownViewClass
    this.iterateAllLeaves((leaf: any) => {
      if (MV && leaf?.view instanceof MV) leaf.view.updateOptions()
    })
    applySpellcheckLanguages((this.app as any).getSpellcheckLanguages?.() ?? null)
  }

  // ---------------------------------------------------------------- layout maintenance

  onLayoutChange(item?: WorkspaceItem): void {
    this.requestUpdateLayout()
    if (item && !this.layoutItemQueue.includes(item)) this.layoutItemQueue.push(item)
  }

  updateLayout(): void {
    return updateLayout(this)
  }

  /**
   * Marks the tab groups touching the window's top edge (`mod-top`, `mod-top-left-space`,
   * `mod-top-right-space`) and moves the sidebar toggle buttons into the right header strip.
   */
  updateFrameless(): void {
    return updateFrameless(this)
  }

  onQuickPreview(file: any, data: string): void {
    this.trigger('quick-preview', file, data)
  }

  onResize(): void {
    // A deferred view loads when its container becomes displayed (CSS "node-inserted"
    // animation). Sweep here too so it works without that stylesheet.
    if (this.layoutReady)
      this.iterateAllLeaves(l => {
        if (l.isDeferred && l.isVisible()) void l.loadIfDeferred()
      })
    this.trigger('resize')
  }

  hasUndoHistory(): boolean {
    return this.undoHistory.length > 0
  }

  pushUndoHistory(leaf: WorkspaceLeaf, parentId?: string, rootId?: string): void {
    if (!leaf) return
    const state = leaf.getViewState()
    if (state.type === 'empty') return
    this.undoHistory.unshift({ leafId: leaf.id, state, eState: leaf.getEphemeralState(), parentId, rootId, leafHistory: leaf.history.serialize() })
    if (this.undoHistory.length > UNDO_HISTORY_MAX) this.undoHistory.pop()
  }

  /** `workspace:undo-close-pane`: restore into the original tab group, keeping id + history. */
  undoCloseLeaf(): boolean {
    return undoCloseLeaf(this)
  }

  updateTitle(): void {
    const leaf = this.getMostRecentLeaf(this.rootSplit)
    const title = leaf ? leaf.getDisplayText().trim() : ''
    if (this.app.getAppTitle) document.title = this.app.getAppTitle(title)
  }

  registerEditorExtension(ext: any): void {
    this.editorExtensions.push(ext)
    this.updateOptions()
  }

  unregisterEditorExtension(ext: any): void {
    this.editorExtensions.remove(ext)
    this.updateOptions()
  }

  registerHoverLinkSource(id: string, info: any): void {
    this.hoverLinkSources[id] = info
    this.trigger('hover-link-sources-changed')
  }

  unregisterHoverLinkSource(id: string): void {
    delete this.hoverLinkSources[id]
    this.trigger('hover-link-sources-changed')
  }

  // ---------------------------------------------------------------- drag & drop (phase 2b)

  /** Tab drag start: ghost, drop overlay, drop handling (see dragLeaf.ts). */
  onDragLeaf(evt: DragEvent, leaf: WorkspaceLeaf): void {
    onDragLeaf(this, evt, leaf)
  }

  /** Drop target (tab group / empty sidebar) under the pointer of a drag event. */
  getDropLocation(evt: Event): WorkspaceItem | null {
    return getDropLocation(this, evt)
  }

  /**
   * Drop-direction rule: nearest edge within 33% of the target, else "center". Also shrinks `rect`
   * in place to the highlight band (`max(dim/3, 40px)`) for the chosen edge.
   */
  getDropDirection(evt: { clientX: number; clientY: number; target?: EventTarget | null }, rect: { x: number; y: number; width: number; height: number }, exclude?: string[] | null, target?: WorkspaceItem): string {
    return getDropDirection(this, evt, rect, exclude, target)
  }

  /** Moves a leaf into `tabs` at `index` (the "center" drop on a tab strip). */
  moveLeaf(leaf: WorkspaceLeaf, tabs: WorkspaceTabs, index: number): void {
    const from = leaf.parent as WorkspaceTabs
    if (from === tabs) {
      const cur = tabs.children.indexOf(leaf)
      if (index > cur) index--
      if (cur === index) return
    }
    from.removeChild(leaf)
    leaf.setDimension(null)
    tabs.insertChild(index, leaf)
    tabs.selectTabIndex(tabs.children.indexOf(leaf))
    this.requestResize()
  }

  /** "Link with tab…": the next clicked ItemView leaf joins this leaf's group. */
  onStartLink(leaf: WorkspaceLeaf): void {
    const up = (evt: MouseEvent) => {
      window.removeEventListener('mouseup', up)
      let target: any = null
      this.iterateAllLeaves(l => {
        if (l.containerEl.contains(evt.target as Node) || l.tabHeaderEl.contains(evt.target as Node)) {
          target = l
          return true
        }
      })
      if (target && target !== leaf && target.view instanceof ItemView) leaf.setGroupMember(target)
    }
    window.addEventListener('mouseup', up)
  }
}

// Re-exports so consumers can import the whole model from one place.
export { WorkspaceItem, WorkspaceParent, WorkspaceSplit, WorkspaceSidedock, WorkspaceRoot, WorkspaceFloating, WorkspaceWindow, WorkspaceTabs, WorkspaceLeaf, WorkspaceRibbon, RecentFileTracker }
export { genId, isElShown, isLeaf }
