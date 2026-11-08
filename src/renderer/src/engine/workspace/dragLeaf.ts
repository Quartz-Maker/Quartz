/* eslint-disable @typescript-eslint/no-explicit-any */
// Tab drag & drop. While a tab header is dragged the
// workspace listens on `window` (popout events are relayed there) and shows `.workspace-drop-overlay`
// (+ `.workspace-fake-target-overlay` previewing the remaining area for an edge drop):
//   - over a tab strip: insert caret (center) / split zones from the top third of the strip;
//   - over a tab group or sidebar: nearest edge within 33% picks left/right/top/bottom, else center;
//   - sidebars only accept top/bottom/center; a collapsed/empty sidebar (or its ribbon/toggle) takes the tab;
//   - leaving the window and dropping opens a popout window.
import { setIcon } from '../ui/icons'
import { ItemView } from '../view/View'
import { WorkspaceLeaf } from './WorkspaceLeaf'
import { WorkspaceTabs } from './WorkspaceTabs'
import { WorkspaceSplit, WorkspaceSidedock, WorkspaceWindow } from './WorkspaceSplit'
import type { WorkspaceItem } from './WorkspaceItem'
import type { Workspace } from './Workspace'

const DRAG_THRESHOLD_SQ = 25

/** Pointer position (not event target) inside `el` — overlays such as the titlebar may sit on top. */
export const contains = (e: Event, el: HTMLElement | null | undefined): boolean => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  const { clientX: x, clientY: y } = e as MouseEvent
  return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/** Drop target under the pointer: a tab group, an empty/collapsed sidebar, or null. */
export function getDropLocation(ws: Workspace, e: Event): WorkspaceItem | null {
  const w = (e as any).win as Window
  if (w && w !== window) {
    for (const c of ws.floatingSplit.children) if (c instanceof WorkspaceWindow && c.win === w) return recursiveGetTarget(e, c)
  }
  const { leftRibbon, rightRibbon, leftSidebarToggleButtonEl: lt, rightSidebarToggleButtonEl: rt, leftSplit, rightSplit, rootSplit } = ws
  if (contains(e, leftRibbon.containerEl) || contains(e, lt)) return leftSplit
  if (contains(e, rightRibbon.containerEl) || contains(e, rt)) return rightSplit
  if (contains(e, leftSplit.containerEl)) return leftSplit.children.length === 0 ? leftSplit : recursiveGetTarget(e, leftSplit)
  if (contains(e, rightSplit.containerEl)) return rightSplit.children.length === 0 ? rightSplit : recursiveGetTarget(e, rightSplit)
  if (contains(e, rootSplit.containerEl)) return recursiveGetTarget(e, rootSplit)
  return null
}

export function recursiveGetTarget(e: Event, parent: WorkspaceSplit): WorkspaceItem | null {
  for (const c of parent.children) {
    if (contains(e, c.containerEl)) return c instanceof WorkspaceTabs ? c : c instanceof WorkspaceSplit ? recursiveGetTarget(e, c) : c
  }
  return null
}

const excluded = (target: WorkspaceItem, inSidebar: boolean): string[] | undefined => (inSidebar ? ['left', 'right'] : undefined)

export function onDragLeaf(ws: Workspace, evt: DragEvent, leaf: WorkspaceLeaf): void {
  const dt = evt.dataTransfer
  if (!dt) return
  const src = evt.target as HTMLElement
  dt.setData('text/plain', '')
  const text = leaf.getDisplayText()
  const ghost = createDiv('drag-ghost mod-leaf', g => {
    g.createDiv('drag-ghost-icon', i => setIcon(i, leaf.getIcon()))
    g.createSpan({ text: text.length <= 60 ? text : text.slice(0, 59).trim() + '…' })
  })
  document.body.appendChild(ghost)
  dt.setDragImage?.(ghost, 0, 0)
  setTimeout(() => ghost.detach())

  const dm = (ws.app as any).dragManager
  let fakeContainer: HTMLElement | null = null
  const fake = createDiv('workspace-fake-target-overlay')
  const startX = evt.clientX
  const startY = evt.clientY
  let moved = false
  let outside = false
  let fadedEl: HTMLElement | null = null
  void leaf.loadIfDeferred()

  const hide = (): void => {
    if (fadedEl) fadedEl.style.opacity = ''
    dm.hideOverlay()
    fake.hide()
  }

  const over = (e: DragEvent): void => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'none'
    if (!moved) {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return
      moved = true
      document.body.addClass('is-grabbing')
    }
    const doc: Document = (e as any).doc
    const target = getDropLocation(ws, e)
    if (!target || target === (leaf as any)) return hide()
    const root = target.getRoot()
    const inSidebar = root === ws.leftSplit || root === ws.rightSplit
    if (!(leaf.view instanceof ItemView || inSidebar)) return hide()
    let rect = target.containerEl.getBoundingClientRect()
    const { width: W, height: H, x: X, y: Y } = rect
    const dir = ws.getDropDirection(e, rect, excluded(target, inSidebar), target)
    const parent = leaf.parent as WorkspaceTabs
    if (target === parent && dir !== 'center' && parent.children.length === 1) return hide()
    e.dataTransfer!.dropEffect = 'move'
    if (target === ws.leftSplit && ws.leftSplit.collapsed) rect = ws.leftSidebarToggleButtonEl.getBoundingClientRect()
    else if (target === ws.rightSplit && ws.rightSplit.collapsed) rect = ws.rightSidebarToggleButtonEl.getBoundingClientRect()
    else if (target instanceof WorkspaceTabs && dir === 'center') rect = target.getTabInsertLocation(e.clientX).rect as DOMRect
    if (target instanceof WorkspaceSidedock && target.children.length === 1 && target.children[0] === (leaf as any)) return hide()
    dm.showOverlay(doc, rect)
    if (dir === 'center') {
      if (fadedEl) fadedEl.style.opacity = ''
      fake.hide()
      return
    }
    let dx = 0
    let dy = 0
    let dw = W
    let dh = H
    if (dir === 'top') {
      dx = rect.x
      dy = Y + rect.height
      dh = H - rect.height
    } else if (dir === 'left') {
      dx = X + rect.width
      dy = rect.y
      dw = W - rect.width
    } else if (dir === 'right') {
      dx = X
      dy = Y
      dw = W - rect.width
    } else if (dir === 'bottom') {
      dx = X
      dy = Y
      dh = H - rect.height
    }
    if (!fakeContainer || fadedEl !== target.containerEl) {
      if (fadedEl) fadedEl.style.opacity = ''
      fake.empty()
      fake.appendChild(target.containerEl.cloneNode(true))
      target.containerEl.style.opacity = '0'
      fadedEl = target.containerEl
      let wrap: HTMLElement = fake
      for (let p = target.containerEl.parentElement; p && p !== doc.body; p = p.parentElement) {
        const d = createDiv(p.className)
        d.appendChild(wrap)
        wrap = d
      }
      fakeContainer?.detach()
      fakeContainer = wrap
    }
    target.containerEl.style.opacity = '0'
    if (fakeContainer.parentNode !== doc.body) {
      fakeContainer.addClass('workspace-fake-target-container')
      doc.body.appendChild(fakeContainer)
    }
    fake.show()
    fake.toggleClass('is-in-sidebar', root !== ws.rootSplit)
    fake.style.transform = `translate(${dx}px, ${dy}px)`
    fake.style.width = dw + 'px'
    fake.style.height = dh + 'px'
  }

  const enter = (e: DragEvent): void => {
    if (e.target) outside = false
    over(e)
  }
  const leave = (e: DragEvent): void => {
    if (e.relatedTarget || e.buttons === 0) return
    hide()
    ;((e as any).win as Window).setTimeout(() => (outside = true), 10)
  }

  const drop = (e: DragEvent): void => {
    outside = false
    cleanup()
    if (!moved) return
    const target = getDropLocation(ws, e)
    if (!target || target === (leaf as any)) return
    const root = target.getRoot()
    const inSidebar = root === ws.leftSplit || root === ws.rightSplit
    const from = leaf.parent as WorkspaceTabs
    if (target instanceof WorkspaceSidedock && (target === ws.leftSplit || target === ws.rightSplit)) {
      from.removeChild(leaf)
      leaf.setDimension(null)
      const first = target.children[0]
      let tabs: WorkspaceTabs
      if (first instanceof WorkspaceTabs) tabs = first
      else {
        tabs = new WorkspaceTabs(ws)
        target.insertChild(-1, tabs)
      }
      tabs.insertChild(-1, leaf)
      ws.requestResize()
      return
    }
    if (!(leaf.view instanceof ItemView || inSidebar)) return
    const rect = target.containerEl.getBoundingClientRect()
    const dir = ws.getDropDirection(e, rect, excluded(target, inSidebar), target)
    if (target === from && dir !== 'center' && from.children.length === 1) return
    if (inSidebar) leaf.setGroupMember(null)
    if (target instanceof WorkspaceTabs && dir === 'center') {
      let idx = target.getTabInsertLocation(e.clientX).index
      if (from === target) {
        const cur = target.children.indexOf(leaf)
        if (idx > cur) idx--
        if (cur === idx) return
      }
      from.removeChild(leaf)
      leaf.setDimension(null)
      target.insertChild(idx, leaf)
      target.selectTabIndex(target.children.indexOf(leaf))
      ws.requestResize()
      return
    }
    if (target instanceof WorkspaceSidedock && target.children.length === 1 && target.children[0] === (leaf as any)) return
    if (!(target.parent instanceof WorkspaceSplit) || dir === 'center') return
    const direction = dir === 'top' || dir === 'bottom' ? 'horizontal' : 'vertical'
    const before = dir === 'left' || dir === 'top'
    if (inSidebar) {
      const tabs = new WorkspaceTabs(ws)
      ws.splitLeaf(target, tabs, direction, before)
      from.removeChild(leaf)
      leaf.setDimension(null)
      tabs.insertChild(0, leaf)
    } else {
      from.removeChild(leaf)
      leaf.setDimension(null)
      ws.splitLeaf(target, leaf, direction, before)
    }
    ws.requestResize()
  }

  const cleanup = (): void => {
    window.removeEventListener('dragover', over)
    window.removeEventListener('dragenter', enter)
    window.removeEventListener('dragleave', leave)
    window.removeEventListener('drop', drop)
    src.removeEventListener('dragend', end)
    if (fadedEl) fadedEl.style.opacity = ''
    dm.removeOverlay()
    ghost.detach()
    fakeContainer?.detach()
    fake.detach()
    document.body.removeClass('is-grabbing')
  }

  const end = (): void => {
    cleanup()
    // Dropped outside the window: the tab becomes a popout window.
    if (outside && evt && leaf.view instanceof ItemView && ws.canPopoutWindow) {
      const r = leaf.containerEl.getBoundingClientRect()
      let zoom = 0
      try {
        zoom = (leaf.containerEl.win as any).electron.webFrame.getZoomLevel()
      } catch {
        /* no electron */
      }
      outside = false
      leaf.parent?.removeChild(leaf)
      leaf.setDimension(null)
      ws.openPopout({ x: evt.screenX, y: evt.screenY, size: { width: r.width, height: r.height }, zoom }).insertChild(0, WorkspaceTabs.createFrom(ws, leaf))
      ws.setActiveLeaf(leaf, { focus: true })
    }
  }

  window.addEventListener('dragover', over)
  window.addEventListener('dragenter', enter)
  window.addEventListener('dragleave', leave)
  src.addEventListener('dragend', end, { once: true })
  window.addEventListener('drop', drop)
}
