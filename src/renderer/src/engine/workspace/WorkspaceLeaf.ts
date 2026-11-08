// WorkspaceLeaf — hosts one View; owns its tab header element and per-leaf navigation history.
import { WorkspaceItem, type SerializedItem } from './WorkspaceItem'
import { setIcon, setTooltip, TOOLTIP_DELAY } from './dom'
import { Menu } from './Menu'
import { t } from './strings'
import { notice } from './AppLike'
import { debounce, genId, isElShown, truncate } from './util'
import { View } from '../view/View'
import { EmptyView, UnknownView, DeferredView } from '../view/EmptyView'
import type { AppLike } from './AppLike'
import type { WorkspaceTabs } from './WorkspaceTabs'

export interface ViewState {
  type: string
  state?: Record<string, unknown>
  active?: boolean
  pinned?: boolean
  group?: WorkspaceLeaf | null
  icon?: string
  title?: string
  /** internal: set when navigating history */
  popstate?: boolean
}

export interface OpenViewState {
  state?: Record<string, unknown>
  eState?: Record<string, unknown>
  active?: boolean
  group?: WorkspaceLeaf
}

export interface HistoryEntry {
  title: string
  icon: string
  state: ViewState
  eState: unknown
}

/** Back/forward stacks of `{title, icon, state, eState}`. */
export class LeafHistory {
  backHistory: HistoryEntry[] = []
  forwardHistory: HistoryEntry[] = []
  constructor(public owner: WorkspaceLeaf) {}

  async updateState(entry: HistoryEntry): Promise<void> {
    const state = entry.state
    state.popstate = true
    await this.owner.setViewState(state, entry.eState)
    this.owner.trigger('history-change')
  }

  async forward(): Promise<void> {
    return this.go(1)
  }

  async back(): Promise<void> {
    return this.go(-1)
  }

  pushState(entry: HistoryEntry): void {
    this.backHistory.push(entry)
    // (the cap check here is a no-op; history is effectively unbounded.)
    this.forwardHistory = []
    this.owner.trigger('history-change')
  }

  async go(n: number): Promise<void> {
    if (this.owner.working) {
      notice(this.owner.app, t.msgTabBusy)
      return
    }
    const current = this.owner.getHistoryState()
    let target = current
    let e: HistoryEntry | undefined
    while (n > 0 && (e = this.forwardHistory.pop())) {
      this.backHistory.push(target)
      target = e
      n--
    }
    while (n < 0 && (e = this.backHistory.pop())) {
      this.forwardHistory.push(target)
      target = e
      n++
    }
    if (target !== current) await this.updateState(target)
  }

  serialize(): { backHistory: HistoryEntry[]; forwardHistory: HistoryEntry[] } {
    return { backHistory: this.backHistory.slice(), forwardHistory: this.forwardHistory.slice() }
  }

  deserialize(data?: { backHistory?: HistoryEntry[]; forwardHistory?: HistoryEntry[] }): void {
    if (!data) return
    if (data.backHistory) this.backHistory = data.backHistory
    if (data.forwardHistory) this.forwardHistory = data.forwardHistory
    this.owner.trigger('history-change')
  }
}

export class WorkspaceLeaf extends WorkspaceItem {
  type = 'leaf'
  declare app: AppLike
  activeTime = 0
  history: LeafHistory
  hoverPopover: any = null
  group: string | null = null
  pinned = false
  width = 0
  height = 0
  working = false
  view: View
  _empty: EmptyView
  resizeObserver: ResizeObserver | null = null
  tabHeaderEl: HTMLElement
  tabHeaderInnerIconEl!: HTMLElement
  tabHeaderInnerTitleEl!: HTMLElement
  tabHeaderStatusContainerEl!: HTMLElement
  tabHeaderCloseEl!: HTMLElement
  tabHeaderStatusLinkEl: HTMLElement | null = null
  tabHeaderStatusPinEl: HTMLElement | null = null

  constructor(app: AppLike, id?: string | null) {
    super(app.workspace, id)
    this.history = new LeafHistory(this)
    const el = this.containerEl
    el.addClass('workspace-leaf')
    el.addEventListener('focusin', () => this.app.workspace.setActiveLeaf(this))
    el.addEventListener('pointerdown', () => this.app.workspace.setActiveLeaf(this), { capture: true })

    const close = (evt: Event) => {
      const p = this.parent as WorkspaceTabs | null
      if (p && p.type === 'tabs') {
        if (this === p.children[p.children.length - 1]) p.unlockTabWidths()
        else p.lockTabWidths(evt)
      }
      this.detach()
    }
    const header = (this.tabHeaderEl = createDiv('workspace-tab-header tappable'))
    header.draggable = true
    header.setAttribute('draggable', 'true')
    header.createDiv('workspace-tab-header-inner', inner => {
      this.tabHeaderInnerIconEl = inner.createDiv('workspace-tab-header-inner-icon')
      this.tabHeaderInnerTitleEl = inner.createDiv('workspace-tab-header-inner-title')
      this.tabHeaderStatusContainerEl = inner.createDiv('workspace-tab-header-status-container')
      this.tabHeaderCloseEl = inner.createDiv('workspace-tab-header-inner-close-button', c => {
        setIcon(c, 'lucide-x')
        setTooltip(c, t.menu.close)
        c.addEventListener('click', close)
      })
    })
    header.addEventListener('dragstart', evt => this.workspace.onDragLeaf(evt, this))
    header.addEventListener('contextmenu', evt => this.onOpenTabHeaderMenu(evt, header))
    // Middle-click closes the tab (mousedown prevented to avoid autoscroll).
    header.addEventListener('mousedown', evt => {
      if (evt.button === 1) evt.preventDefault()
    })
    header.addEventListener('auxclick', evt => {
      if (evt.button === 1) close(evt)
    })
    header.addEventListener('mouseover', evt => {
      if (evt.defaultPrevented) return
      const file = this.getViewState().state?.file
      if (typeof file === 'string' && this.app.vault.getAbstractFileByPath(file))
        this.workspace.trigger('hover-link', { event: evt, source: 'tab-header', hoverParent: this, targetEl: header, linktext: file })
    })

    if (typeof ResizeObserver !== 'undefined') {
      const onResize = debounce(() => this.onResize(), 20, true)
      this.resizeObserver = new ResizeObserver(entries => {
        for (const e of entries) {
          if (e.target === el) {
            const w = el.offsetWidth, h = el.offsetHeight
            if (w !== this.width || h !== this.height) {
              this.width = w
              this.height = h
              onResize()
            }
            return
          }
        }
      })
      this.resizeObserver.observe(el)
    }
    this.view = this._empty = new EmptyView(this)
    void this.view.open(this.containerEl)
  }

  serialize(): SerializedItem {
    const out = super.serialize()
    if (this.pinned) out.pinned = true
    out.state = this.getViewState()
    if (this.group) out.group = this.group
    return out
  }

  canNavigate(): boolean {
    return this.view.navigation && !this.pinned
  }

  async openFile(file: any, openState?: OpenViewState): Promise<void> {
    if (!file) return
    openState = openState || {}
    const cur = this.view as any
    let type = this.app.viewRegistry.getTypeByExtension(file.extension)
    if (cur && typeof cur.canAcceptExtension === 'function' && cur.canAcceptExtension(file.extension)) type = cur.getViewType()
    if (!type) {
      this.app.openWithDefaultApp?.(file.path)
      return
    }
    const state = openState.state || {}
    const active = openState.active ?? this === this.workspace.activeLeaf
    state.file = file.path
    await this.setViewState({ type, state, active, group: openState.group }, openState.eState)
  }

  async openLinkText(linktext: string, sourcePath: string, openState?: OpenViewState): Promise<void> {
    const app = this.app
    try {
      openState = openState || {}
      const hash = linktext.indexOf('#')
      const path = hash === -1 ? linktext : linktext.slice(0, hash)
      const subpath = hash === -1 ? '' : linktext.slice(hash)
      let file = app.metadataCache?.getFirstLinkpathDest(path, sourcePath)
      const state = openState.state || {}
      const eState: Record<string, unknown> = openState.eState || {}
      if (file) {
        if (subpath) eState.subpath = subpath
      } else {
        if (!app.fileManager) return
        const parent = path.includes('/') ? null : app.fileManager.getNewFileParent(sourcePath, linktext)
        file = await app.fileManager.createNewFile(parent, path)
        state.mode = 'source'
      }
      openState.state = state
      openState.eState = eState
      await this.openFile(file, openState)
    } catch (e: any) {
      notice(app, e?.message ?? String(e))
      console.error(e)
    }
  }

  /** Replaces the hosted view (null → the leaf's EmptyView). */
  async open(view: View | null): Promise<View> {
    const old = this.view
    if (view === old) return view
    if (old) {
      const name = old.getDisplayText()
      try {
        const p = old.close()
        if (!(old instanceof DeferredView) && !(old instanceof EmptyView)) await p
      } catch (e) {
        console.error('Failed to close view', e)
        notice(this.app, t.msgFailedToCloseView(name))
      }
    }
    this.containerEl.setChildrenInPlace([this.resizeHandleEl])
    if (!view) view = this._empty
    this.view = view
    try {
      await view.open(this.containerEl)
    } catch (e) {
      console.error('Failed to open view', e)
    }
    return view
  }

  highlight(): void {
    this.containerEl.addClass('is-highlighted')
  }

  unhighlight(): void {
    this.containerEl.removeClass('is-highlighted')
  }

  getViewState(): ViewState {
    const v = this.view
    const out: ViewState = { type: v ? v.getViewType() : 'empty', state: v ? v.getState() : {} }
    if (this.pinned) out.pinned = true
    if (v) {
      out.icon = v.getIcon() || undefined
      out.title = v.getDisplayText().trim() || undefined
    }
    return out
  }

  async setViewState(viewState: ViewState, eState?: any): Promise<void> {
    if (this.working) return
    this.working = true
    try {
      let view = this.view
      const curType = view ? view.getViewType() : ''
      const wasDeferred = view instanceof DeferredView
      const typeChanged = viewState.type !== curType
      let before: ReturnType<WorkspaceLeaf['getHistoryState']> | undefined
      // No history entry when leaving an empty (or unknown — a subclass) view.
      if (view && !(view instanceof EmptyView)) before = this.getHistoryState()
      const result: { history: boolean; layout: boolean; close: boolean; done?: () => void } = { history: false, layout: false, close: false }
      if (typeChanged || wasDeferred) {
        const creator = this.app.viewRegistry.getViewCreatorByType(viewState.type)
        if (creator) {
          if (before || wasDeferred || !viewState.icon || viewState.title === undefined || isElShown(this.containerEl)) {
            try {
              view = creator(this)
            } catch (e) {
              console.error(`Failed to create view of type "${viewState.type}"`, e)
              view = new UnknownView(this, viewState.type)
            }
          } else view = new DeferredView(this, viewState.type, viewState.icon, viewState.title)
        } else view = typeof viewState.type !== 'string' || viewState.type === 'empty' ? this._empty : new UnknownView(this, viewState.type)
        await this.open(view)
        result.history = true
        result.layout = true
      }
      const st = viewState.state || {}
      try {
        await view.setState(st, result)
      } catch (e) {
        console.error(e)
      }
      if (result.close) await this.open(null)
      if (viewState.active) this.workspace.setActiveLeaf(this, { focus: true })
      if (viewState.group !== undefined) this.setGroupMember(viewState.group ?? null)
      if (eState) this.setEphemeralState(eState)
      if (viewState.popstate || (st as any).sync || (wasDeferred && !typeChanged)) result.history = false
      if (result.layout) this.workspace.onLayoutChange()
      this.updateHeader()
      if (result.history && before) this.recordHistory(before)
      result.done?.()
    } finally {
      this.working = false
    }
  }

  get isDeferred(): boolean {
    return this.view instanceof DeferredView
  }

  async loadIfDeferred(): Promise<void> {
    if (this.view instanceof DeferredView) await this.view.rerender()
  }

  async rebuildView(): Promise<void> {
    const vs = this.getViewState()
    const es = this.getEphemeralState()
    await this.open(null)
    await this.setViewState(vs, es)
  }

  getEphemeralState(): any {
    return this.view.getEphemeralState()
  }

  setEphemeralState(state: any): void {
    if (state && state.focus) {
      const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null
      if (active && active !== document.body && active !== this.containerEl && !this.containerEl.contains(active) && this.workspace.layoutReady) {
        active.blur?.()
        getSelection()?.removeAllRanges()
      }
    }
    this.view.setEphemeralState(state)
  }

  togglePinned(): void {
    this.setPinned(!this.pinned)
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned
    this.trigger('pinned-change', pinned)
    this.updateHeader()
    this.workspace.requestSaveLayout()
    if (this.group) for (const l of this.workspace.getGroupLeaves(this.group)) if (l.pinned !== pinned) l.setPinned(pinned)
  }

  canPin(): boolean {
    return !!this.parent && this.parent.type === 'tabs'
  }

  setGroupMember(other: WorkspaceLeaf | null): void {
    if (other === this) return
    let group: string | null = null
    if (other) {
      group = other.group
      if (!group) {
        group = genId(16)
        other.setGroup(group)
      }
    }
    this.setGroup(group)
  }

  setGroup(group: string | null): void {
    if (group === this.group) return
    let pinned = this.pinned
    if (!pinned) for (const l of this.workspace.getGroupLeaves(group)) if (l.pinned) {
      pinned = true
      break
    }
    this.setPinned(pinned)
    this.group = group
    this.trigger('group-change', group)
    this.updateHeader()
    this.workspace.requestUpdateLayout()
  }

  /** Re-attached leaves (moved, re-docked, restored) must keep reporting resizes: detach() disconnects the observer. */
  setParent(parent: any): void {
    super.setParent(parent)
    if (parent) this.resizeObserver?.observe(this.containerEl)
  }

  detach(): void {
    const parentId = this.parent?.id
    const rootId = this.getRoot().id
    super.detach()
    if (this.group) for (const l of this.workspace.getGroupLeaves(this.group)) l.unhighlight()
    if (this.view) {
      this.workspace.pushUndoHistory(this, parentId, rootId)
      void this.view.close()
      this.view = this._empty
    }
    this.resizeObserver?.disconnect()
  }

  /** Refreshes icon/title/pin/link state of the tab header. */
  updateHeader(): void {
    setIcon(this.tabHeaderInnerIconEl, this.getIcon())
    this.tabHeaderInnerTitleEl.setText(this.getDisplayText())
    if (this.group) {
      if (!this.tabHeaderStatusLinkEl) {
        this.tabHeaderStatusLinkEl = this.tabHeaderStatusContainerEl.createDiv({ cls: 'workspace-tab-header-status-icon mod-linked', prepend: true }, e => {
          setIcon(e, 'lucide-link')
          setTooltip(e, t.menu.unlinkTab)
          e.addEventListener('click', () => {
            for (const l of this.workspace.getGroupLeaves(this.group)) l.unhighlight()
            this.setGroup(null)
          })
          e.addEventListener('mouseover', () => {
            setIcon(e, 'lucide-unlink')
            for (const l of this.workspace.getGroupLeaves(this.group)) l.highlight()
          })
          e.addEventListener('mouseout', () => {
            setIcon(e, 'lucide-link')
            for (const l of this.workspace.getGroupLeaves(this.group)) l.unhighlight()
          })
        })
      }
    } else {
      this.tabHeaderStatusLinkEl?.detach()
      this.tabHeaderStatusLinkEl = null
    }
    if (this.pinned) {
      this.tabHeaderCloseEl.hide()
      if (!this.tabHeaderStatusPinEl)
        this.tabHeaderStatusPinEl = this.tabHeaderStatusContainerEl.createDiv('workspace-tab-header-status-icon mod-pinned', e => {
          setIcon(e, 'lucide-pin')
          setTooltip(e, t.menu.unpin)
          e.addEventListener('click', () => this.setPinned(false))
        })
    } else {
      this.tabHeaderCloseEl.show()
      this.tabHeaderStatusPinEl?.detach()
      this.tabHeaderStatusPinEl = null
    }
    setTooltip(this.tabHeaderEl, truncate(this.getDisplayText(), 100), { delay: TOOLTIP_DELAY })
    const type = this.view ? this.view.getViewType() : ''
    this.tabHeaderEl.setAttr('data-type', type)
    this.tabHeaderEl.toggleClass('mod-unknown', !!this.view && this.view instanceof UnknownView)
  }

  getIcon(): string {
    return this.view.getIcon() || super.getIcon()
  }

  getDisplayText(): string {
    return this.view.getDisplayText() || ''
  }

  isVisible(): boolean {
    return isElShown(this.containerEl)
  }

  onOpenTabHeaderMenu(evt: MouseEvent, parentEl: HTMLElement): Menu {
    evt.preventDefault()
    const menu = Menu.forEvent(evt).addSections(['title', 'close', 'pane', 'open', 'action', 'find', 'info', 'info.copy', 'view', 'view.linked', 'system', '', 'danger'])
    menu.setSectionSubmenu('info.copy', { title: t.menu.copyPath, icon: 'lucide-clipboard' })
    menu.setSectionSubmenu('view.linked', { title: t.menu.openLinkedView, icon: 'lucide-link' })
    this.view.onTabMenu(menu)
    if (this.isVisible()) {
      this.view.onPaneMenu(menu, this.workspace.isInSidebar(this) ? 'sidebar-context-menu' : 'tab-header')
      this.workspace.trigger('leaf-menu', menu, this)
    }
    menu.setParentElement(parentEl)
    return menu
  }

  handleDrop(_evt: DragEvent, draggable: any, isOver: boolean): any {
    if (draggable?.type === 'file' || draggable?.type === 'link') {
      if (!isOver) {
        this.workspace.setActiveLeaf(this)
        if (draggable.type === 'file') void this.openFile(draggable.file)
        else void this.openLinkText(draggable.linktext, draggable.sourcePath)
      }
      return { action: 'Open in this tab', dropEffect: 'move' }
    }
  }

  getHistoryState(): HistoryEntry {
    return { title: this.getDisplayText(), icon: this.getIcon(), state: this.getViewState(), eState: this.getEphemeralState() }
  }

  recordHistory(entry: HistoryEntry): void {
    const v = this.view
    if (!v || !v.navigation || v instanceof EmptyView) return
    const last = this.history.backHistory[this.history.backHistory.length - 1]
    if (last && JSON.stringify(last.state) === JSON.stringify(entry.state)) return
    this.history.pushState(entry)
  }

  onResize(): void {
    this.view?.onResize()
  }
}
