// WorkspaceTabs — a tab group. DOM:
//   .workspace-tabs(.mod-stacked) > hr + .workspace-tab-header-container + .workspace-tab-container
//   header container > .workspace-tab-header-container-inner (tab headers) + -new-tab + -spacer + -tab-list
import { WorkspaceItem, WorkspaceParent, type SerializedItem } from './WorkspaceItem'
import { WorkspaceLeaf } from './WorkspaceLeaf'
import { setIcon, setTooltip } from './dom'
import { Menu } from './Menu'
import { t } from './strings'
import { t as tr } from '../settings/i18n'
import { isElShown } from './util'
import type { Workspace } from './Workspace'

function wheelScroll(e: WheelEvent): void {
  if (!e.deltaY) return
  const el = e.currentTarget as HTMLElement
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) el.scrollLeft += e.deltaX
  else el.scrollLeft += e.deltaY
  e.preventDefault()
}

export class WorkspaceTabs extends WorkspaceParent {
  type = 'tabs'
  allowSingleChild = true
  autoManageDOM = false
  declare children: WorkspaceLeaf[]
  tabHeaderEls: HTMLElement[] = []
  currentTab = 0
  hasLockedTabWidths = false
  isStacked = false
  tabHeaderContainerEl: HTMLElement
  tabsInnerEl: HTMLElement
  tabsContainerEl: HTMLElement

  constructor(workspace: Workspace, id?: string | null) {
    super(workspace, id)
    this.containerEl.addClass('workspace-tabs')
    const hc = (this.tabHeaderContainerEl = this.containerEl.createDiv('workspace-tab-header-container'))
    const inner = (this.tabsInnerEl = hc.createDiv('workspace-tab-header-container-inner'))
    this.tabsContainerEl = this.containerEl.createDiv('workspace-tab-container')
    this.containerEl.addEventListener('click', evt => {
      const header = (evt.target as HTMLElement | null)?.closest?.('.workspace-tab-header') as HTMLElement | null
      if (!header || !this.containerEl.contains(header)) return
      if (header.closest('.workspace-tabs') !== this.containerEl) return
      const i = this.tabHeaderEls.indexOf(header)
      if (i === -1) return
      this.selectTabIndex(i)
      const leaf = this.children[i]
      if (leaf instanceof WorkspaceLeaf) this.workspace.setActiveLeaf(leaf, { focus: true })
    })
    inner.addEventListener('wheel', wheelScroll, { passive: false })
    // In-app drags (explorer, bookmarks, search, links) dropped on the tab strip: over the middle of a
    // tab they open in that tab ("Open in this tab"), elsewhere as a new tab at the caret.
    const dragged = (): any => {
      const d = (this.workspace.app as any).dragManager?.draggable
      return d && (d.type === 'file' || d.type === 'link') ? d : null
    }
    const dragOver = (e: DragEvent): void => {
      const d = dragged()
      if (!d || e.defaultPrevented) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      const dm = (this.workspace.app as any).dragManager
      const loc = this.getTabInsertLocation(e.clientX)
      if (loc.droppedIndex !== null) {
        dm.setAction(tr('interface.dragAndDrop.openInThisTab'))
        dm.hideOverlay()
      } else {
        dm.setAction(tr('interface.dragAndDrop.openAsTab'))
        dm.showOverlay(e.doc, loc.rect)
      }
    }
    hc.addEventListener('dragover', dragOver)
    hc.addEventListener('dragenter', dragOver)
    // Only for file/link drags really leaving the strip: dragleave also fires when crossing between the
    // strip's children, and hiding unconditionally made the tab-drag drop caret flicker off.
    hc.addEventListener('dragleave', e => {
      if (!dragged()) return
      const rt = e.relatedTarget as Node | null
      if (rt && hc.contains(rt)) return
      ;(this.workspace.app as any).dragManager?.hideOverlay()
    })
    hc.addEventListener('drop', e => {
      const d = dragged()
      if (!d || e.defaultPrevented) return
      e.preventDefault()
      ;(this.workspace.app as any).dragManager.removeOverlay()
      const loc = this.getTabInsertLocation(e.clientX)
      let leaf: WorkspaceLeaf
      if (loc.droppedIndex !== null) leaf = this.children[loc.droppedIndex]
      else {
        leaf = new WorkspaceLeaf(this.workspace.app as any)
        this.insertChild(loc.index, leaf)
      }
      this.workspace.setActiveLeaf(leaf, { focus: true })
      if (d.type === 'file') void leaf.openFile(d.file)
      else void leaf.openLinkText(d.linktext, d.sourcePath)
    })
    hc.addEventListener('mouseleave', () => this.unlockTabWidths())
    hc.createDiv('workspace-tab-header-new-tab', d => {
      d.createSpan('clickable-icon', s => {
        setTooltip(s, t.labelNewTab)
        setIcon(s, 'lucide-plus')
        s.addEventListener('click', () => this.workspace.newTabIn(this))
      })
    })
    hc.createDiv('workspace-tab-header-spacer')
    hc.createDiv('workspace-tab-header-tab-list', d => {
      d.createSpan('clickable-icon', s => {
        setIcon(s, 'lucide-chevron-down')
        const open = (evt: MouseEvent) => {
          if (s.hasClass('has-active-menu')) return
          evt.preventDefault()
          this.buildTabListMenu(Menu.forEvent(evt), s)
        }
        s.addEventListener('click', open)
        s.addEventListener('contextmenu', open)
      })
    })
  }

  /** Tab-list chevron menu: Stack/Unstack, Close all (unpinned), then a checked list of tabs. */
  buildTabListMenu(menu: Menu, parentEl?: HTMLElement): Menu {
    menu.dom.addClass('mod-tab-list')
    if (parentEl) menu.setParentElement(parentEl)
    menu.addSections(['action', 'close', '', 'tablist', ''])
    if (!(this.getRoot() as any).side) {
      menu
        .addItem(i =>
          i
            .setSection('action')
            .setTitle(this.isStacked ? t.menu.unstackTabs : t.menu.stackTabs)
            .setIcon('lucide-layers')
            .onClick(() => this.setStacked(!this.isStacked))
        )
        .addItem(i =>
          i
            .setSection('close')
            .setTitle(t.menu.closeAll)
            .setIcon('lucide-x')
            .onClick(() => {
              for (const l of this.children.slice()) if (!l.pinned) l.detach()
            })
        )
    }
    this.workspace.trigger('tab-group-menu', menu, this)
    this.children.forEach((leaf, idx) => {
      if (!(leaf instanceof WorkspaceLeaf) || !leaf.view) return
      const view = leaf.view
      menu.addItem(i =>
        i
          .setSection('tablist')
          .setTitle(view.getDisplayText())
          .setChecked(idx === this.currentTab)
          .setIcon(view.getIcon())
          .onClick(() => this.workspace.setActiveLeaf(leaf))
      )
    })
    return menu
  }

  static createFrom(workspace: Workspace, leaf: WorkspaceItem): WorkspaceTabs {
    const tabs = new WorkspaceTabs(workspace)
    tabs.insertChild(0, leaf)
    return tabs
  }

  setStacked(stacked: boolean): void {
    if (this.isStacked === stacked) return
    this.isStacked = stacked
    this.containerEl.toggleClass('mod-stacked', stacked)
    if (this.children.length > 0) {
      this.updateTabDisplay()
      this.workspace.requestUpdateLayout()
    }
  }

  serialize(): SerializedItem {
    const out = super.serialize()
    if (this.currentTab > 0) out.currentTab = this.currentTab
    if (this.isStacked) out.stacked = true
    return out
  }

  selectTabIndex(index: number): void {
    index = Math.clamp(index, 0, this.children.length - 1)
    if (this.currentTab === index) return
    this.currentTab = index
    this.updateTabDisplay()
    if (this.isStacked) this.children[this.currentTab]?.containerEl.removeClass('is-hidden')
    this.workspace.requestSaveLayout()
    this.workspace.requestResize()
  }

  selectTab(leaf: WorkspaceItem): void {
    const i = this.children.indexOf(leaf as WorkspaceLeaf)
    if (i !== -1) this.selectTabIndex(i)
  }

  /** Re-syncs header strip and leaf containers with `children`/`currentTab`/stacked mode. */
  updateTabDisplay(): void {
    const kids = this.children
    const inner = this.tabsInnerEl
    const container = this.tabsContainerEl
    if (kids.length === 0) {
      container.empty()
      return
    }
    let cur = Math.clamp(this.currentTab, 0, kids.length - 1)
    if (cur !== this.currentTab) {
      this.currentTab = cur
      this.workspace.requestSaveLayout()
      this.workspace.requestResize()
    }
    const headers: HTMLElement[] = []
    const containerKids: HTMLElement[] = []
    for (const l of kids) {
      headers.push(l.tabHeaderEl)
      if (this.isStacked) {
        containerKids.push(l.tabHeaderEl)
        void l.loadIfDeferred()
      }
      containerKids.push(l.containerEl)
    }
    this.tabHeaderEls = headers
    let active: WorkspaceLeaf | null = null
    kids.forEach((l, i) => {
      const on = i === cur
      l.tabHeaderEl.toggleClass('is-active', on)
      l.containerEl.toggle(this.isStacked || on)
      if (on) active = l
    })
    container.setChildrenInPlace(containerKids)
    if (!this.isStacked) inner.setChildrenInPlace(headers)
    else inner.empty()
    this.updateSlidingTabs()
    inner.style.setProperty('--animation-dur', '250ms')
    if (active && isElShown(this.containerEl)) void (active as WorkspaceLeaf).loadIfDeferred()
  }

  recomputeChildrenDimensions(): void {
    this.updateTabDisplay()
  }

  /** Stacked mode: position sliding headers/panes (min pane 300px, max = container − headers). */
  updateSlidingTabs(): void {
    const kids = this.children
    const c = this.tabsContainerEl
    if (this.isStacked) {
      const widths = kids.map(l => l.tabHeaderEl.offsetWidth)
      const total = widths.reduce((a, b) => a + b, 0)
      const max = Math.max(300, c.clientWidth - total)
      const min = max / kids.length
      let left = 0
      let right = total
      kids.forEach((l, i) => {
        l.tabHeaderEl.style.left = left + 'px'
        left += widths[i]
        right -= widths[i]
        l.tabHeaderEl.style.right = right + 'px'
        l.containerEl.style.left = left + 'px'
        l.containerEl.style.minWidth = min + 'px'
        l.containerEl.style.maxWidth = max + 'px'
      })
      this.onContainerScroll()
    } else
      for (const l of kids) {
        l.tabHeaderEl.style.left = ''
        l.tabHeaderEl.style.right = ''
        l.containerEl.style.left = ''
        l.containerEl.style.minWidth = ''
        l.containerEl.style.maxWidth = ''
      }
  }

  /** Stacked mode: panes scrolled fully out of view get `is-hidden` (never the current one). */
  onContainerScroll(): void {
    if (!this.isStacked) return
    const c = this.tabsContainerEl
    // Needs real layout; without it (detached / no layout engine) nothing is considered off-screen.
    if (c.clientWidth === 0) return
    const kids = this.children
    const sl = c.scrollLeft
    const sr = sl + c.clientWidth
    let x = 0
    kids.forEach((l, i) => {
      const start = x + l.tabHeaderEl.offsetWidth
      const end = start + l.containerEl.offsetWidth
      x = end
      l.containerEl.toggleClass('is-hidden', i !== this.currentTab && (end <= sl || start >= sr))
    })
  }

  /** Index where a dragged tab would be inserted at clientX (+ the caret rect, + dropped-on tab). */
  getTabInsertLocation(clientX: number): { rect: { x: number; y: number; width: number; height: number }; index: number; droppedIndex: number | null } {
    const kids = this.children
    let rect: any = this.tabHeaderContainerEl.getBoundingClientRect()
    let index = this.tabHeaderEls.length
    let dropped: number | null = null
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].tabHeaderEl.getBoundingClientRect()
      if (i === kids.length - 1 || clientX <= r.right) {
        rect = { x: r.x, y: r.y, width: 10, height: r.height }
        index = i
        const mid = (r.x + r.right) / 2
        if (Math.abs(clientX - mid) / (r.right - r.x) < 0.25) dropped = i
        if (clientX > mid) {
          index++
          rect.x = r.right
        }
        break
      }
    }
    rect.x -= 5
    return { rect, index, droppedIndex: dropped }
  }

  insertChild(index: number, child: WorkspaceItem): void {
    super.insertChild(index, child)
    if (child instanceof WorkspaceLeaf) child.updateHeader()
    this.unlockTabWidths()
  }

  removeChild(child: WorkspaceItem): void {
    const idx = this.children.indexOf(child as WorkspaceLeaf)
    const cur = this.currentTab
    const curLeaf = this.children[cur]
    ;(child as WorkspaceLeaf).tabHeaderEl?.removeClass('is-active')
    if (this.children.length === 1) this.workspace.lastTabGroupStacked = this.isStacked
    super.removeChild(child)
    if (this.children.length > 0 && idx === cur) {
      this.currentTab = Math.min(idx, this.children.length - 1)
      this.workspace.onLayoutChange(this)
    } else this.currentTab = this.children.indexOf(curLeaf)
  }

  /** After closing a tab with the mouse, keep widths stable until the pointer leaves the strip. */
  lockTabWidths(_evt?: Event): void {
    if (!isElShown(this.tabHeaderContainerEl) || this.isStacked) return
    this.hasLockedTabWidths = true
    const widths = this.children.map(l => l.tabHeaderEl.clientWidth)
    this.children.forEach((l, i) => (l.tabHeaderEl.style.width = widths[i] + 'px'))
  }

  unlockTabWidths(): void {
    if (!this.hasLockedTabWidths) return
    this.hasLockedTabWidths = false
    for (const l of this.children) l.tabHeaderEl.style.width = ''
  }
}
