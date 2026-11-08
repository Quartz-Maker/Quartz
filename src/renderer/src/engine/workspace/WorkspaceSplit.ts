// WorkspaceSplit (N-ary, vertical = side by side, horizontal = stacked), WorkspaceSidedock,
// WorkspaceContainer/Root, WorkspaceFloating and WorkspaceWindow (popout model only).
import { WorkspaceItem, WorkspaceParent, type SerializedItem } from './WorkspaceItem'
import { setIcon, setDynamicTooltip, TOOLTIP_DELAY_SLOW } from './dom'
import { Menu } from './Menu'
import { t } from './strings'
import { openPopoutBrowserWindow } from './popout'
import type { Workspace } from './Workspace'

export type SplitDirection = 'vertical' | 'horizontal'
export type Side = 'left' | 'right'

/** Minimum pane / sidebar size in px while resizing. */
export const MIN_PANE_SIZE = 200
/** Sidebar collapses when dragged below this width. */
export const SIDEDOCK_COLLAPSE_THRESHOLD = 50
export const SIDEDOCK_DEFAULT_SIZE = 300

/** "left" → "primary", "right" → "secondary" (logical side naming). */
export function logicalSide(side: string): string {
  return side === 'left' ? 'primary' : side === 'right' ? 'secondary' : side
}

function isRtl(): boolean {
  return false
}

/** Physical side for a logical/physical side, honouring RTL. */
export function physicalSide(side: string): 'left' | 'right' {
  return (logicalSide(side) === 'primary') !== isRtl() ? 'left' : 'right'
}

/** Both the logical and physical class variants: e.g. ["mod-primary-split", "mod-left-split"]. */
export function sideClasses(side: string, pattern: string): string[] {
  return [pattern.replace('{side}', logicalSide(side)), pattern.replace('{side}', physicalSide(side))]
}

export class WorkspaceSplit extends WorkspaceParent {
  readonly isSplit = true
  type = 'split'
  direction: SplitDirection | null = null
  resizeStartPos: { x: number; y: number } | null = null
  originalSizes: number[] | null = null
  isResizing = false

  constructor(workspace: Workspace, direction: SplitDirection, id?: string | null) {
    super(workspace, id)
    this.containerEl.addClass('workspace-split')
    this.setDirection(direction)
  }

  serialize(): SerializedItem {
    const out = super.serialize()
    out.direction = this.direction
    return out
  }

  setDirection(direction: SplitDirection): void {
    this.containerEl.removeClass('mod-' + this.direction)
    this.direction = direction
    this.containerEl.addClass('mod-' + direction)
  }

  /** Normalise children's percentages to sum to 100 (or clear them if any is unset). */
  recomputeChildrenDimensions(): void {
    const kids = this.children
    let total: number | null = 0
    for (const c of kids) {
      if (c.dimension == null) {
        total = null
        break
      }
      total += c.dimension
    }
    for (const c of kids) {
      if (total == null || isNaN(total)) c.setDimension(null)
      else c.setDimension((100 * (c.dimension as number)) / total)
    }
    this.workspace.requestResize()
  }

  onChildResizeStart(child: WorkspaceItem, evt: PointerEvent): void {
    this.resizeStartPos = { x: evt.clientX, y: evt.clientY }
    const index = this.children.indexOf(child)
    const win = (evt.target as Node | null)?.ownerDocument?.defaultView ?? window
    const ac = new AbortController()
    const signal = ac.signal
    const end = () => {
      ac.abort()
      document.body.removeClass('is-grabbing')
      child.resizeHandleEl.removeClass('is-active')
      try {
        this.finishResize()
      } catch (e) {
        console.error(e)
      }
    }
    win.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        let diff = 0
        if (this.direction === 'vertical') diff = (e.clientX - this.resizeStartPos!.x) * (isRtl() ? -1 : 1)
        else if (this.direction === 'horizontal') diff = e.clientY - this.resizeStartPos!.y
        if (!this.isResizing) {
          this.originalSizes = this.children.map(c => this.getElSize(c.containerEl))
          this.isResizing = true
        }
        const before = this.children.slice(0, index + 1).reverse()
        const after = this.children.slice(index + 1)
        if (diff > 0) {
          const moved = this.resizeItemsByDiff(after, diff, 1)
          if (Math.abs(diff) > moved) diff = moved
          this.resizeItemsByDiff(before, diff, -1)
        } else {
          const moved = this.resizeItemsByDiff(before, diff, -1)
          if (Math.abs(diff) > moved) diff = -moved
          this.resizeItemsByDiff(after, diff, 1)
        }
        e.preventDefault()
      },
      { signal }
    )
    win.addEventListener('pointerup', end, { signal })
    win.addEventListener('pointercancel', end, { signal })
  }

  /** Shrinks/grows `items` in order by `diff` px, never below MIN_PANE_SIZE; returns px moved. */
  resizeItemsByDiff(items: WorkspaceItem[], diff: number, sign: number): number {
    let moved = 0
    for (const item of items) {
      const i = this.children.indexOf(item)
      const orig = this.originalSizes![i]
      const target = Math.max(MIN_PANE_SIZE, orig - diff * sign)
      const delta = orig - target
      diff -= delta * sign
      moved += Math.abs(delta)
      this.setElSize(this.children[i].containerEl, target)
    }
    return moved
  }

  finishResize(): void {
    this.isResizing = false
    this.resizeStartPos = null
    const sizes: number[] = []
    let total = 0
    for (const c of this.children) {
      const s = this.getElSize(c.containerEl)
      sizes.push(s)
      total += s
    }
    this.children.forEach((c, i) => {
      this.unsetElSize(c.containerEl)
      c.setDimension(total ? (sizes[i] / total) * 100 : null)
    })
    this.workspace.requestSaveLayout()
    this.workspace.requestResize()
  }

  getElSize(el: HTMLElement): number {
    return this.direction === 'vertical' ? el.offsetWidth : el.offsetHeight
  }

  setElSize(el: HTMLElement, px: number): void {
    el.style.flex = '0 0 auto'
    if (this.direction === 'vertical') el.style.width = `${px}px`
    else el.style.height = `${px}px`
  }

  unsetElSize(el: HTMLElement): void {
    el.style.flex = ''
    el.style.width = ''
    el.style.height = ''
  }
}

/** Bottom block of the left sidebar: vault switcher + help + settings. */
export class VaultProfile {
  containerEl: HTMLElement
  constructor(workspace: Workspace, parentEl: HTMLElement) {
    const app = workspace.app
    const name = app.vault.getName()
    const base = app.vault.adapter.getBasePath?.() ?? ''
    this.containerEl = parentEl.createDiv('workspace-sidedock-vault-profile', el => {
      el.createDiv('workspace-drawer-vault-switcher', sw => {
        sw.createDiv('workspace-drawer-vault-switcher-icon', i => setIcon(i, 'lucide-chevrons-up-down'))
        sw.createDiv({ cls: 'workspace-drawer-vault-name', text: name })
        setDynamicTooltip(
          sw,
          () => {
            const root = app.vault.getRoot?.()
            return `${base}\n\n${t.fileWithCount(root?.getFileCount?.() ?? 0)}, ${t.folderWithCount(root?.getFolderCount?.() ?? 0)}`
          },
          { placement: 'top', delay: TOOLTIP_DELAY_SLOW }
        )
        sw.addEventListener('click', evt => {
          if (sw.hasClass('has-active-menu')) return
          Menu.forEvent(evt)
            .addItem(i => i.setTitle(name).setChecked(true))
            .addSeparator()
            .addItem(i => i.setTitle(t.manageVaults).setIcon('open-vault').onClick(() => app.openVaultChooser?.()))
            .setParentElement(sw)
        })
      })
      el.createDiv({ cls: 'workspace-drawer-vault-actions' }, actions => {
        actions.createSpan('clickable-icon', s => {
          setIcon(s, 'help')
          s.addEventListener('click', () => app.openHelp?.())
        })
        actions.createSpan('clickable-icon', s => {
          setIcon(s, 'lucide-settings')
          s.addEventListener('click', () => app.setting?.open())
        })
      })
    })
  }
}

export class WorkspaceSidedock extends WorkspaceSplit {
  side: Side
  size = SIDEDOCK_DEFAULT_SIZE
  collapsed = false
  emptyStateEl: HTMLElement
  vaultProfile: VaultProfile | null = null

  constructor(workspace: Workspace, direction: SplitDirection, side: Side, id?: string | null) {
    super(workspace, direction, id)
    this.side = side
    this.containerEl.addClass('mod-sidedock', ...sideClasses(side, 'mod-{side}-split'))
    workspace.containerEl.addClass(...sideClasses(side, 'is-{side}-sidedock-open'))
    if (logicalSide(side) === 'primary') this.vaultProfile = new VaultProfile(workspace, this.containerEl)
    this.resizeHandleEl.addEventListener('pointerdown', this.onSidedockResizeStart.bind(this))
    this.emptyStateEl = this.containerEl.createDiv('workspace-sidedock-empty-state', el => {
      el.createEl('p', { cls: 'u-muted', text: t.emptySidebar })
    })
    this.setSize(this.size)
  }

  // Sidebars resize from their own handler; never the generic split child resize.
  onResizeStart(_evt: PointerEvent): void {}

  serialize(): SerializedItem {
    const out = super.serialize()
    out.width = this.size
    if (this.collapsed) out.collapsed = true
    return out
  }

  setSize(px: number): void {
    this.size = px
    this.containerEl.style.width = `${px}px`
  }

  toggle(): void {
    if (this.collapsed) this.expand()
    else this.collapse()
  }

  collapse(): void {
    if (this.collapsed) return
    this.collapsed = true
    const ws = this.workspace
    ws.containerEl.removeClass(...sideClasses(this.side, 'is-{side}-sidedock-open'))
    this.containerEl.addClass('is-sidedock-collapsed')
    if (logicalSide(this.side) === 'primary') ws.leftRibbon.setCollapsedState(true)
    else ws.rightRibbon.setCollapsedState(true)
    // (applies the end state of the width animation directly.)
    this.containerEl.hide()
    this.containerEl.style.width = '0px'
    ws.requestResize()
    const active = ws.activeLeaf
    if (active && active.getRoot() === this) ws.setActiveLeaf(ws.getMostRecentLeaf(ws.rootSplit)!, { focus: true })
    ws.requestSaveLayout()
    ws.updateFrameless()
    this.resizeHandleEl.style.opacity = '0'
  }

  expand(): void {
    if (!this.collapsed) return
    this.collapsed = false
    const ws = this.workspace
    ws.containerEl.addClass(...sideClasses(this.side, 'is-{side}-sidedock-open'))
    this.containerEl.removeClass('is-sidedock-collapsed')
    if (logicalSide(this.side) === 'primary') ws.leftRibbon.setCollapsedState(false)
    else ws.rightRibbon.setCollapsedState(false)
    this.containerEl.show()
    this.containerEl.style.width = `${this.size}px`
    ws.requestResize()
    ws.requestSaveLayout()
    ws.updateFrameless()
    this.resizeHandleEl.style.opacity = '1'
  }

  onSidedockResizeStart(evt: PointerEvent): void {
    if (evt.button !== 0) return
    const win = (evt.target as Node | null)?.ownerDocument?.defaultView ?? window
    const ac = new AbortController()
    const signal = ac.signal
    const end = () => {
      ac.abort()
      this.resizeHandleEl.removeClass('is-active')
      document.body.removeClass('is-grabbing')
      this.workspace.requestSaveLayout()
      this.workspace.requestResize()
    }
    win.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        const rect = this.containerEl.getBoundingClientRect()
        const wsWidth = this.workspace.containerEl.clientWidth
        let w = physicalSide(this.side) === 'left' ? e.clientX - rect.x : wsWidth - e.clientX
        w += this.resizeHandleEl.offsetWidth / 2
        if (!this.collapsed && w < SIDEDOCK_COLLAPSE_THRESHOLD) this.collapse()
        else if (this.collapsed && w >= MIN_PANE_SIZE) this.expand()
        else if (!this.collapsed) this.setSize(Math.clamp(w, MIN_PANE_SIZE, Math.max(MIN_PANE_SIZE, 0.8 * wsWidth)))
        e.preventDefault()
      },
      { signal }
    )
    win.addEventListener('pointerup', end, { signal })
    win.addEventListener('pointercancel', end, { signal })
    document.body.addClass('is-grabbing')
  }

  recomputeChildrenDimensions(): void {
    super.recomputeChildrenDimensions()
    if (this.children.length === 0) {
      this.collapse()
      this.emptyStateEl.show()
      if (logicalSide(this.side) === 'secondary') this.workspace.rightRibbon.hide()
    } else {
      this.emptyStateEl.hide()
      if (this.side === 'right') this.workspace.rightRibbon.show()
    }
  }
}

export abstract class WorkspaceContainer extends WorkspaceSplit {
  readonly isContainer = true
  allowSingleChild = true
  abstract win: Window
  abstract doc: Document

  onFocus(): void {
    setTimeout(() => {
      if (!this.doc.hasFocus()) return
      const hasModal = !!this.doc.querySelector('.modal-container')
      const ws = this.workspace
      const active = ws.activeLeaf
      if (!active || active.getContainer() !== this) {
        const leaf = ws.getMostRecentLeaf(this)
        if (leaf) ws.setActiveLeaf(leaf, { focus: !hasModal })
      }
    }, 100)
  }

  focus(): void {
    const ew = (this.win as any).electronWindow
    if (ew && !this.doc.hasFocus()) {
      if (ew.isMinimized()) ew.restore()
      ew.focus()
    }
  }
}

export class WorkspaceRoot extends WorkspaceContainer {
  win: Window = window
  doc: Document = document
  constructor(workspace: Workspace, direction: SplitDirection, id?: string | null) {
    super(workspace, direction, id)
    this.containerEl.addClass('mod-root')
  }
}

export class WorkspaceFloating extends WorkspaceParent {
  type = 'floating'
  allowSingleChild = true
  autoManageDOM = false
}

export interface WorkspaceWindowInitData {
  x?: number
  y?: number
  width?: number
  height?: number
  size?: { width: number; height: number }
  maximize?: boolean
  zoom?: number
}

/**
 * Popout window: a root split hosted in a same-realm child window (see popout.ts). When no child
 * window can be opened (tests, plain browsers) it stays a pure model hosted by the main window,
 * so `floating` still round-trips through workspace.json.
 */
export class WorkspaceWindow extends WorkspaceContainer {
  type = 'window'
  win: Window = window
  doc: Document = document
  rootEl: HTMLElement | null = null
  styleRelayCleanup: (() => void) | null = null
  size: { x?: number; y?: number; width?: number; height?: number } = {}
  maximize: boolean | undefined
  zoom: number | undefined
  isPopped = false

  constructor(workspace: Workspace, id?: string | null, data?: WorkspaceWindowInitData) {
    super(workspace, 'vertical', id)
    this.containerEl.addClass('mod-root', 'workspace-window')
    if (data) {
      if (data.size) {
        data.width = Math.max(data.size.width, 600)
        data.height = Math.max(data.size.height, 600)
      }
      for (const k of ['x', 'y', 'width', 'height'] as const) if (Object.prototype.hasOwnProperty.call(data, k)) this.size[k] = data[k]
      this.maximize = data.maximize
      this.zoom = data.zoom
    }
    const handle = workspace.canPopoutWindow ? openPopoutBrowserWindow({ width: data?.width, height: data?.height, x: data?.x, y: data?.y }) : null
    if (!handle) return
    this.isPopped = true
    const w = (this.win = handle.win)
    w.app = workspace.app
    this.doc = w.document
    this.styleRelayCleanup = handle.cleanup
    this.rootEl = this.doc.body.createDiv('app-container')
    this.rootEl.createDiv('horizontal-main-container').createDiv('workspace').appendChild(this.containerEl)
    this.doc.title = 'Quartz'
    w.addEventListener('focus', () => this.onFocus())
    w.addEventListener('beforeunload', (e: Event) => {
      if (!this.win) return
      let quitting = false
      try {
        quitting = !!w.electron.ipcRenderer.sendSync('is-quitting')
      } catch {
        /* ignore */
      }
      if (quitting) e.preventDefault()
      else this.close()
    })
    this.component.registerDomEvent(window, 'pagehide', () => this.destroyWindow())
    w.history.forward = () => window.history.forward()
    w.history.back = () => window.history.back()
    w.history.go = (d?: number) => window.history.go(d)
    let timer: ReturnType<typeof setTimeout> | undefined
    w.addEventListener('resize', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        workspace.iterateLeaves(this, l => l.onResize())
        workspace.requestSaveLayout()
        this.updateSize()
      }, 50)
    })
    this.component.registerEvent(workspace.on('quit', () => w.close()))
    this.component.registerEvent(workspace.on('layout-change', () => this.updateTitle()))
    if (data) {
      try {
        if (data.maximize) w.electronWindow.maximize()
        if (typeof data.zoom === 'number' && data.zoom) w.electronWindow.setFrameZoomLevel(data.zoom)
      } catch {
        /* ignore */
      }
    }
    workspace.trigger('window-open', this, w)
    this.updateSize()
  }

  serialize(): SerializedItem {
    const out = super.serialize()
    const w: any = this.isPopped ? this.win : null
    if (w && !w.closed) {
      out.x = w.screenX
      out.y = w.screenY
      out.width = w.outerWidth
      out.height = w.outerHeight
      this.updateSize()
      Object.assign(out, this.size)
      try {
        const ew = w.electronWindow
        out.maximize = ew.isMaximized()
        out.zoom = ew.webContents.zoomLevel
      } catch {
        /* ignore */
      }
      return out
    }
    Object.assign(out, this.size)
    if (this.maximize !== undefined) out.maximize = this.maximize
    if (this.zoom !== undefined) out.zoom = this.zoom
    return out
  }

  updateSize(): void {
    const ew = (this.win as any)?.electronWindow
    if (!this.isPopped || !ew) return
    try {
      if (!ew.isMaximized() && !ew.isMinimized() && !ew.isFullScreen()) {
        const b = ew.getBounds()
        this.size = { x: b.x, y: b.y, width: b.width, height: b.height }
      }
    } catch {
      /* window gone */
    }
  }

  updateTitle(): void {
    if (!this.isPopped || !this.win) return
    const leaf = this.workspace.getMostRecentLeaf(this)
    const app: any = this.workspace.app
    const title = leaf ? leaf.getDisplayText().trim() : ''
    this.doc.title = app.getAppTitle ? app.getAppTitle(title) : title
  }

  close(): void {
    WorkspaceItem.prototype.detach.call(this)
    const ws = this.workspace
    if (ws.activeLeaf?.getContainer() === this) {
      const leaf = ws.getMostRecentLeaf()
      if (leaf) ws.setActiveLeaf(leaf)
    }
    ws.iterateLeaves(this, l => {
      l.detach()
    })
    this.component.unload()
    this.destroyWindow()
  }

  destroyWindow(): void {
    if (!this.isPopped) return
    const w: any = this.win
    const g: any = window
    if (g.activeWindow === w) {
      g.activeWindow = window
      g.activeDocument = document
    }
    if (this.styleRelayCleanup) {
      this.styleRelayCleanup()
      this.styleRelayCleanup = null
    }
    if (w) {
      this.win = null as any
      try {
        w.close()
      } catch {
        /* already closed */
      }
      this.workspace.trigger('window-close', this, w)
    }
  }

  detach(): void {
    this.close()
  }

  removeChild(child: WorkspaceItem): void {
    super.removeChild(child)
    if (this.children.length === 0) this.close()
  }
}
