// View / ItemView — obsidian.d.ts semantics, DOM:
//   .workspace-leaf-content[data-type] > .view-header + .view-content
//   .view-header > .view-header-left > .view-header-nav-buttons > button×2
//                + .view-header-title-container.mod-at-start.mod-fade(.mod-at-end)
//                    > .view-header-title-parent + .view-header-title
//                + .view-actions.mod-raised > button.clickable-icon.view-action …("More options" last)
import { Component } from '../core/Component'
import { setIcon, setTooltip } from '../workspace/dom'
import { Menu } from '../workspace/Menu'
import { t } from '../workspace/strings'
import type { AppLike } from '../workspace/AppLike'
import type { WorkspaceLeaf } from '../workspace/WorkspaceLeaf'

export interface ViewStateResult {
  history: boolean
  /** internal: request a layout-change event */
  layout?: boolean
  /** internal: close the view after setState (FileView without file) */
  close?: boolean
  /** internal: callback after the state is fully applied */
  done?: () => void
}

export abstract class View extends Component {
  app: AppLike
  icon = 'lucide-file'
  navigation = false
  leaf: WorkspaceLeaf
  containerEl: HTMLElement
  scope: any = null

  constructor(leaf: WorkspaceLeaf) {
    super()
    this.app = leaf.app
    this.leaf = leaf
    this.containerEl = leaf.containerEl.createDiv('workspace-leaf-content')
    this.containerEl.setAttribute('data-type', this.getViewType())
  }

  async open(parentEl: HTMLElement): Promise<void> {
    parentEl.appendChild(this.containerEl)
    const r = this.load() as unknown
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(e => console.error('View failed to load', e))
    await this.onOpen()
  }

  async close(): Promise<void> {
    this.containerEl.detach()
    this.unload()
    await this.onClose()
  }

  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}

  abstract getViewType(): string
  abstract getDisplayText(): string

  getState(): Record<string, unknown> {
    return {}
  }

  async setState(_state: unknown, _result: ViewStateResult): Promise<void> {}

  getEphemeralState(): Record<string, unknown> {
    return {}
  }

  setEphemeralState(_state: unknown): void {}

  getIcon(): string {
    return this.icon ? this.icon : 'lucide-file'
  }

  onResize(): void {}

  onPaneMenu(_menu: Menu, _source: 'more-options' | 'tab-header' | string): void {}

  onHeaderMenu(_menu: Menu): void {}

  /** Base tab menu: Close / Close others / Close tabs after / Close all (main area only). */
  onTabMenu(menu: Menu): void {
    const leaf = this.leaf
    const parent = leaf.parent as any
    const siblings: WorkspaceLeaf[] = parent ? parent.children.slice() : [leaf]
    const index = siblings.indexOf(leaf)
    menu.addItem(i => i.setSection('close').setTitle(t.menu.close).setIcon('lucide-x').onClick(() => this.leaf.detach()))
    if (this.app.workspace.isInSidebar(leaf)) return
    const others = siblings.filter(l => !l.pinned && l !== leaf)
    if (others.length > 0)
      menu.addItem(i => i.setSection('close').setTitle(t.menu.closeOthers).setIcon('lucide-x').onClick(() => others.forEach(l => l.detach())))
    const after = siblings.slice(index + 1).filter(l => !l.pinned)
    if (after.length > 0)
      menu.addItem(i => i.setSection('close').setTitle(t.menu.closeAfter).setIcon('lucide-x').onClick(() => after.forEach(l => l.detach())))
    const unpinned = siblings.filter(l => !l.pinned)
    if (unpinned.length > 0 && (unpinned.length !== 1 || unpinned[0] !== leaf))
      menu.addItem(i => i.setSection('close').setTitle(t.menu.closeAll).setIcon('lucide-x').onClick(() => unpinned.forEach(l => l.detach())))
  }

  getSideTooltipPlacement(): 'left' | 'right' | 'bottom' {
    const root = this.leaf.getRoot() as any
    return root.side ? (root.side === 'right' ? 'left' : 'right') : 'bottom'
  }

  handleCut(_e: ClipboardEvent): void {}
  handleCopy(_e: ClipboardEvent): void {}
  handlePaste(_e: ClipboardEvent): void {}
}

function createNavButton(view: ItemView, dir: 'backward' | 'forward'): HTMLButtonElement {
  const btn = createEl('button', 'clickable-icon') as HTMLButtonElement
  btn.setAttribute('aria-disabled', 'true')
  setTooltip(btn, dir === 'backward' ? t.navigateBack : t.navigateForward)
  const go = async (evt: MouseEvent) => {
    if (evt.button === 2) return
    let leaf = view.leaf
    const mod = evt.ctrlKey || evt.metaKey || evt.button === 1
    if (mod) leaf = await view.app.workspace.duplicateLeaf(leaf, 'tab')
    await leaf.history.go(dir === 'backward' ? -1 : 1)
  }
  btn.addEventListener('click', go)
  btn.addEventListener('auxclick', go)
  // History dropdown: right-click, 400 ms long-press, or a downward drag > 5 px.
  const showHistory = () => {
    const leaf = view.leaf
    const stack = dir === 'backward' ? leaf.history.backHistory : leaf.history.forwardHistory
    const menu = new Menu()
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i]
      menu.addItem(item =>
        item
          .setTitle(entry.title.length <= 50 ? entry.title : entry.title.slice(0, 49).trim() + '…')
          .setIcon(entry.icon)
          .onClick(async () => {
            let n = stack.length - i
            if (dir === 'backward') n = -n
            await view.leaf.history.go(n)
          })
      )
    }
    const r = btn.getBoundingClientRect()
    menu.showAtPosition({ x: r.x, y: r.bottom, width: r.width, overlap: true })
  }
  btn.addEventListener('contextmenu', () => showHistory())
  btn.addEventListener('mousedown', (down: MouseEvent) => {
    const timer = window.setTimeout(() => {
      cleanup()
      showHistory()
    }, 400)
    const cleanup = () => {
      window.removeEventListener('mouseup', up)
      window.removeEventListener('mousemove', move)
      window.clearTimeout(timer)
    }
    const up = () => cleanup()
    const move = (e: MouseEvent) => {
      const dx = e.clientX - down.clientX, dy = e.clientY - down.clientY
      if (dx * dx + dy * dy > 25) {
        cleanup()
        if (dy > 0 && dy > Math.abs(dx)) showHistory()
      }
    }
    window.addEventListener('mouseup', up)
    window.addEventListener('mousemove', move)
  })
  return btn
}

export abstract class ItemView extends View {
  contentEl: HTMLElement
  headerEl: HTMLElement
  titleContainerEl!: HTMLElement
  titleParentEl!: HTMLElement
  titleEl!: HTMLElement
  actionsEl: HTMLElement
  backButtonEl!: HTMLButtonElement
  forwardButtonEl!: HTMLButtonElement
  moreOptionsButtonEl: HTMLElement
  canDropAnywhere = false

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const header = (this.headerEl = this.containerEl.createDiv('view-header'))
    this.contentEl = this.containerEl.createDiv('view-content')
    header.createDiv('view-header-left', left => {
      left.createDiv('view-header-nav-buttons', nav => {
        this.backButtonEl = createNavButton(this, 'backward')
        setIcon(this.backButtonEl, 'lucide-arrow-left')
        nav.appendChild(this.backButtonEl)
        this.forwardButtonEl = createNavButton(this, 'forward')
        setIcon(this.forwardButtonEl, 'lucide-arrow-right')
        nav.appendChild(this.forwardButtonEl)
      })
      this.updateNavButtons()
    })
    this.titleContainerEl = header.createDiv('view-header-title-container mod-at-start', c => {
      this.titleParentEl = c.createDiv({ cls: 'view-header-title-parent' })
      this.titleEl = c.createDiv({ cls: 'view-header-title' })
    })
    // Scroll-fade classes on the title.
    const tc = this.titleContainerEl, te = this.titleEl
    tc.addClass('mod-fade')
    const updateFade = () => {
      const left = te.scrollLeft, sw = te.scrollWidth, ow = te.offsetWidth
      tc.toggleClass('mod-at-start', left === 0)
      tc.toggleClass('mod-at-end', Math.ceil(left) >= sw - ow)
    }
    te.addEventListener('scroll', updateFade)
    updateFade()
    this.actionsEl = header.createDiv('view-actions mod-raised')
    this.moreOptionsButtonEl = this.addAction('lucide-more-vertical', t.menu.moreOptions, evt => {
      if (!(evt.currentTarget as HTMLElement).hasClass('has-active-menu')) this.onMoreOptions(evt)
    })
  }

  updateNavButtons(): void {
    const h = this.leaf.history
    this.backButtonEl.setAttribute('aria-disabled', String(h.backHistory.length === 0))
    this.forwardButtonEl.setAttribute('aria-disabled', String(h.forwardHistory.length === 0))
  }

  load(): void {
    super.load()
    this.titleEl.setText(this.getDisplayText())
    this.registerEvent(this.leaf.on('group-change', this.onGroupChange, this))
    this.registerEvent(this.leaf.on('history-change', this.updateNavButtons, this))
  }

  onGroupChange(): void {}

  /** Adds a header action button (prepended, so "More options" stays last). */
  addAction(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const btn = createEl('button', 'clickable-icon view-action')
    this.actionsEl.prepend(btn)
    setIcon(btn, icon)
    setTooltip(btn, title)
    btn.addEventListener('mousedown', e => e.preventDefault())
    const handler = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 1) return callback(e)
    }
    btn.addEventListener('click', handler)
    btn.addEventListener('auxclick', handler)
    return btn
  }

  onMoreOptions(evt: MouseEvent): void {
    evt.preventDefault()
    const menu = new Menu().addSections(['close', 'pane', 'open', 'action', 'find', 'info', 'info.copy', 'view', 'view.linked', 'system', '', 'danger'])
    menu.setSectionSubmenu('info.copy', { title: t.menu.copyPath, icon: 'lucide-clipboard' })
    menu.setSectionSubmenu('view.linked', { title: t.menu.openLinkedView, icon: 'lucide-link' })
    this.onPaneMenu(menu, 'more-options')
    this.onMoreOptionsMenu(menu)
    this.app.workspace.trigger('leaf-menu', menu, this.leaf)
    const target = evt.target as HTMLElement
    const r = target.getBoundingClientRect()
    menu.setParentElement(target).showAtPosition({ x: r.x, y: r.bottom, width: r.width, overlap: true, left: true })
  }

  onMoreOptionsMenu(_menu: Menu): void {}

  /** Adds "Split right" / "Split down" (Split right disabled in sidebars). */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const ws = this.app.workspace
    const leaf = this.leaf
    if (leaf.canPin()) {
      menu
        .addItem(i =>
          i
            .setSection('open')
            .setTitle(t.splitRight)
            .setDisabled(ws.isInSidebar(leaf))
            .setIcon('lucide-separator-vertical')
            .onClick(() => ws.duplicateLeaf(leaf, 'vertical'))
        )
        .addItem(i =>
          i.setSection('open').setTitle(t.splitDown).setIcon('lucide-separator-horizontal').onClick(() => ws.duplicateLeaf(leaf, 'horizontal'))
        )
    }
  }

  /** Adds Pin/Unpin, Link with tab…/Unlink tab, Move to new window. */
  onTabMenu(menu: Menu): void {
    super.onTabMenu(menu)
    const ws = this.app.workspace
    const leaf = this.leaf
    if (leaf.canPin())
      menu.addItem(i => i.setSection('pane').setTitle(leaf.pinned ? t.menu.unpin : t.menu.pin).setIcon('lucide-pin').onClick(() => leaf.togglePinned()))
    if (leaf.group) menu.addItem(i => i.setSection('pane').setTitle(t.menu.unlinkTab).setIcon('lucide-link').onClick(() => leaf.setGroup(null)))
    else if (leaf.canPin())
      menu.addItem(i => i.setSection('pane').setTitle(t.menu.linkTab).setIcon('lucide-link').onClick(() => ws.onStartLink(leaf)))
    if (ws.canPopoutWindow)
      menu.addItem(i => i.setSection('open').setTitle(t.menu.moveToNewWindow).setIcon('lucide-picture-in-picture').onClick(() => ws.moveLeafToPopout(leaf)))
  }

  handleDrop(evt: DragEvent, draggable: any, isOver: boolean): any {
    if (this.canDropAnywhere || evt.altKey || this.headerEl.contains(evt.target as Node)) {
      const r = this.leaf.handleDrop(evt, draggable, isOver)
      if (r) {
        r.hoverEl = this.headerEl
        r.hoverClass = 'is-highlighted'
        return r
      }
    }
  }
}
