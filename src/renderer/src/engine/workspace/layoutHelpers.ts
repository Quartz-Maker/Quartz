// Workspace layout/drag helper bodies moved out of Workspace.ts; the class keeps thin methods that call these.
import { WorkspaceItem, WorkspaceParent } from './WorkspaceItem'
import { WorkspaceSplit, WorkspaceSidedock, WorkspaceRoot, WorkspaceFloating, WorkspaceWindow, type WorkspaceWindowInitData } from './WorkspaceSplit'
import { WorkspaceTabs } from './WorkspaceTabs'
import { WorkspaceLeaf } from './WorkspaceLeaf'
import { contains } from './dragLeaf'
import { ItemView } from '../view/View'
import type { Workspace } from './Workspace'

export async function setLayout(ws: Workspace, data: any): Promise<void> {
  ws.layoutReady = false
  let root: WorkspaceRoot | null = null
  let left: WorkspaceSidedock | null = null
  let right: WorkspaceSidedock | null = null
  let floating: WorkspaceFloating | null = null
  if (data.main) {
    root = (await ws.deserializeLayout(data.main, 'root')) as WorkspaceRoot | null
    ws.rootSplit = root as WorkspaceRoot
    if (root && root.direction !== 'vertical') {
      root.setDirection('vertical')
      root.recomputeChildrenDimensions()
    }
  }
  if (data.left) {
    left = (await ws.deserializeLayout(data.left, 'left')) as WorkspaceSidedock | null
    if (left) ws.leftSplit = left
    if (left instanceof WorkspaceSidedock && left.direction !== 'horizontal') {
      left.setDirection('horizontal')
      left.recomputeChildrenDimensions()
    }
  }
  if (data.right) {
    right = (await ws.deserializeLayout(data.right, 'right')) as WorkspaceSidedock | null
    if (right) ws.rightSplit = right
    if (right instanceof WorkspaceSidedock && right.direction !== 'horizontal') {
      right.setDirection('horizontal')
      right.recomputeChildrenDimensions()
    }
  }
  if (data.floating) {
    floating = (await ws.deserializeLayout(data.floating, null)) as WorkspaceFloating | null
    if (floating) ws.floatingSplit = floating
  }
  if (data['left-ribbon']) ws.leftRibbon.load(data['left-ribbon'])
  if (!root) {
    root = ws.rootSplit = new WorkspaceRoot(ws, 'vertical')
    const tabs = new WorkspaceTabs(ws)
    const leaf = new WorkspaceLeaf(ws.app)
    tabs.insertChild(0, leaf)
    root.insertChild(0, tabs)
    const recent = ws.getLastOpenFiles()
    if (recent.length > 0) {
      const f = ws.app.vault.getAbstractFileByPath(recent[0])
      if (f && typeof f.extension === 'string') await leaf.openFile(f)
    }
    ws.setActiveLeaf(leaf)
  }
  if (!left) left = ws.leftSplit = new WorkspaceSidedock(ws, 'horizontal', 'left')
  if (!right) {
    right = ws.rightSplit = new WorkspaceSidedock(ws, 'horizontal', 'right')
    right.collapse()
  }
  if (!floating) floating = ws.floatingSplit = new WorkspaceFloating(ws)
  ws.containerEl.setChildrenInPlace([ws.leftRibbon.containerEl, left.containerEl, root.containerEl, right.containerEl, ws.rightRibbon.containerEl])
  const active = ws.getLeafById(data.active)
  if (active) {
    const r = active.getRoot()
    if (!((r === left && left.collapsed) || (r === right && right.collapsed))) ws.setActiveLeaf(active, { focus: true })
  }
  const loads: Promise<any>[] = []
  ws.iterateAllLeaves(l => {
    if (l.isVisible()) loads.push(l.loadIfDeferred().catch(e => console.error('Failed to load deferred view', e)))
  })
  await Promise.all(loads)
  ws.layoutReady = true
  ws.onLayoutChange()
  ws.requestActiveLeafEvents()
}

/** Builds an item from its serialised form; returns null for empty/invalid parts. */
export async function deserializeLayout(ws: Workspace, data: any, side: 'root' | 'left' | 'right' | null): Promise<WorkspaceItem | null> {
  const fillChildren = async (parent: WorkspaceParent) => {
    for (let i = 0; i < data.children.length; i++) {
      let child = await ws.deserializeLayout(data.children[i], null)
      if (child) {
        // Bare leaves are wrapped in a tab group.
        if (child.type === 'leaf' && parent.type !== 'tabs') child = WorkspaceTabs.createFrom(ws, child)
        parent.insertChild(i, child)
      } else {
        data.children.splice(i, 1)
        i--
      }
    }
  }
  if (data.type === 'split') {
    let split: WorkspaceSplit
    if (side === 'root') split = new WorkspaceRoot(ws, data.direction, data.id)
    else if (side) {
      const sd = new WorkspaceSidedock(ws, data.direction, side, data.id)
      if (data.width) sd.setSize(data.width)
      if (data.collapsed) sd.collapse()
      split = sd
    } else split = new WorkspaceSplit(ws, data.direction, data.id)
    await fillChildren(split)
    if (split.children.length === 0 && !(split instanceof WorkspaceSidedock)) return null
    for (let i = 0; i < data.children.length; i++) split.children[i].setDimension(data.children[i].dimension ?? null)
    split.recomputeChildrenDimensions()
    return split
  }
  if (data.type === 'floating') {
    const fl = new WorkspaceFloating(ws, data.id)
    data.children = (data.children || []).filter((c: any) => c.type === 'window')
    await fillChildren(fl)
    return fl
  }
  if (data.type === 'window') {
    const win = new WorkspaceWindow(ws, data.id, data)
    await fillChildren(win)
    if (win.children.length === 0) return null
    for (let i = 0; i < data.children.length; i++) win.children[i].setDimension(data.children[i].dimension ?? null)
    win.recomputeChildrenDimensions()
    return win
  }
  if (data.type === 'tabs') {
    const tabs = new WorkspaceTabs(ws, data.id)
    if (data.stacked) tabs.setStacked(true)
    await fillChildren(tabs)
    if (tabs.children.length === 0) return null
    tabs.selectTabIndex(data.currentTab || 0)
    tabs.recomputeChildrenDimensions()
    return tabs
  }
  if (data.type === 'leaf') {
    const leaf = new WorkspaceLeaf(ws.app, data.id)
    const vs = data.state || {}
    try {
      await leaf.setViewState(vs)
    } catch (e) {
      console.error(`Failed to restore view of type "${vs.type}"`, e)
    }
    if (!leaf.view) {
      leaf.detach()
      return null
    }
    if (data.group) leaf.setGroup(data.group)
    if (data.pinned) leaf.togglePinned()
    return leaf
  }
  return null
}

/** Moves `leaf` (an ItemView leaf) into a new popout window sized like its container. */
export function moveLeafToPopout(ws: Workspace, leaf: WorkspaceLeaf, data?: WorkspaceWindowInitData): WorkspaceWindow {
  if (!(leaf.view instanceof ItemView)) return undefined as unknown as WorkspaceWindow
  data = data ?? {}
  if (!data.size) {
    const r = leaf.containerEl.getBoundingClientRect()
    data.size = { width: r.width, height: r.height }
  }
  if (!data.zoom) {
    try {
      data.zoom = (leaf.containerEl.win as any).electron.webFrame.getZoomLevel()
    } catch {
      /* no electron */
    }
  }
  const win = ws.openPopout(data)
  leaf.parent?.removeChild(leaf)
  leaf.setDimension(null)
  win.insertChild(0, WorkspaceTabs.createFrom(ws, leaf))
  return win
}

export function getAdjacentLeafInDirection(ws: Workspace, leaf: WorkspaceLeaf | null, dir: 'top' | 'bottom' | 'left' | 'right'): WorkspaceLeaf | null {
  if (!leaf) return null
  let item: WorkspaceItem = leaf
  if (leaf.parent instanceof WorkspaceTabs) item = leaf.parent
  const axis = dir === 'left' || dir === 'right' ? 'vertical' : 'horizontal'
  let next: WorkspaceItem | null = null
  for (let cur: WorkspaceItem | null = item; cur; ) {
    const p: WorkspaceParent | null = cur.parent
    if ((p instanceof WorkspaceTabs && (dir === 'left' || dir === 'right')) || (p instanceof WorkspaceSplit && p.direction === axis)) {
      const kids: WorkspaceItem[] = p.children
      const i = kids.indexOf(cur)
      if (dir === 'left' || dir === 'top') {
        if (i > 0) {
          next = kids[i - 1]
          break
        }
      } else if (i < kids.length - 1) {
        next = kids[i + 1]
        break
      }
    }
    cur = p
  }
  while (next instanceof WorkspaceParent) next = next.children[next instanceof WorkspaceTabs ? next.currentTab : 0]
  return next instanceof WorkspaceLeaf ? next : null
}

export function updateLayout(ws: Workspace): void {
  if (!ws.layoutReady) return
  const q = ws.layoutItemQueue
  while (q.length > 0) q.pop()!.recomputeChildrenDimensions()
  if (ws.rootSplit.children.length === 0) {
    const leaf = new WorkspaceLeaf(ws.app)
    const tabs = new WorkspaceTabs(ws)
    if (ws.lastTabGroupStacked) tabs.setStacked(true)
    tabs.insertChild(0, leaf)
    ws.rootSplit.insertChild(0, tabs)
  }
  if (!ws.activeLeaf || !ws.isAttached(ws.activeLeaf)) {
    const g = ws.activeTabGroup
    let next: WorkspaceLeaf | null = null
    if (g && g instanceof WorkspaceTabs && ws.isAttached(g as any)) next = g.children[g.currentTab] ?? null
    if (!next) next = ws.getMostRecentLeaf(ws.rootSplit)
    if (!next)
      ws.iterateAllLeaves(l => {
        if (!next || next.activeTime < l.activeTime) next = l
      })
    if (!next) next = ws.createLeafInParent(ws.rootSplit, 0)
    ws.setActiveLeaf(next, { focus: true })
  }
  const p = (ws.activeLeaf?.parent as WorkspaceTabs) ?? null
  if (p !== ws.activeTabGroup) {
    ws.activeTabGroup?.containerEl.removeClass('mod-active')
    ws.activeTabGroup = p
    p?.containerEl.addClass('mod-active')
  }
  // Groups with a single member dissolve.
  const counts: Record<string, number> = {}
  ws.iterateAllLeaves(l => {
    if (l.group) counts[l.group] = (counts[l.group] || 0) + 1
  })
  for (const g in counts) if (counts[g] === 1) for (const l of ws.getGroupLeaves(g)) l.setGroup(null)
  ws.updateFrameless()
  ws.updateTitle()
  ws.requestSaveLayout()
  ws.requestResize()
  ws.requestLayoutChangeEvents()
}

/**
 * Marks the tab groups touching the window's top edge (`mod-top`, `mod-top-left-space`,
 * `mod-top-right-space`) and moves the sidebar toggle buttons into the right header strip.
 */
export function updateFrameless(ws: Workspace): void {
  if (!ws.layoutReady) return
  const allTabs: WorkspaceTabs[] = []
  const collect = (x: WorkspaceItem) => {
    if (x instanceof WorkspaceTabs) allTabs.push(x)
    else if (x instanceof WorkspaceParent) x.children.forEach(collect)
  }
  ;[ws.rootSplit, ws.leftSplit, ws.rightSplit, ws.floatingSplit].forEach(collect)
  for (const tb of allTabs) tb.containerEl.removeClass('mod-top', 'mod-top-left-space', 'mod-top-right-space')
  const root = ws.rootSplit, left = ws.leftSplit, right = ws.rightSplit
  const top: WorkspaceTabs[] = []
  const collectTop = (x: WorkspaceItem) => {
    if (x instanceof WorkspaceTabs) top.push(x)
    else if (x instanceof WorkspaceSplit) {
      if (x.direction === 'vertical') x.children.forEach(collectTop)
      else if (x.children[0]) collectTop(x.children[0])
    }
  }
  collectTop(root)
  for (const tb of top) tb.containerEl.addClass('mod-top')
  let leftSpace: WorkspaceTabs | null = top[0] ?? null
  let rightSpace: WorkspaceTabs | null = top[top.length - 1] ?? null
  const lastTop = rightSpace
  const leftFirst = left.children[0]
  const rightFirst = right.children[0]
  if (leftFirst instanceof WorkspaceTabs) {
    leftFirst.containerEl.addClass('mod-top', 'mod-top-left-space')
    if (!left.collapsed) leftSpace = leftFirst
  }
  if (rightFirst instanceof WorkspaceTabs) {
    rightFirst.containerEl.addClass('mod-top', 'mod-top-right-space')
    if (!right.collapsed) rightSpace = rightFirst
  }
  const { titlebarStyle, isMacOS } = ws.options
  const ribbonShown = !ws.leftRibbon.containerEl.hasClass('is-hidden') && ws.leftRibbon.containerEl.style.display !== 'none'
  const lt = ws.leftSidebarToggleButtonEl, rt = ws.rightSidebarToggleButtonEl
  if (!ribbonShown || (titlebarStyle === 'hidden' && isMacOS)) {
    if (!left.collapsed && leftFirst instanceof WorkspaceTabs) leftFirst.tabHeaderContainerEl.appendChild(lt)
    else if (left.collapsed && top[0]) top[0].tabHeaderContainerEl.prepend(lt)
  } else ws.leftRibbon.containerEl.prepend(lt)
  if (!right.collapsed && (isMacOS || titlebarStyle !== 'hidden')) {
    if (rightFirst instanceof WorkspaceTabs) rightFirst.tabHeaderContainerEl.appendChild(rt)
  } else if (lastTop) lastTop.tabHeaderContainerEl.appendChild(rt)
  leftSpace?.containerEl.addClass('mod-top-left-space')
  rightSpace?.containerEl.addClass('mod-top-right-space')
  ws.trigger('window-frame-change')
}

/** `workspace:undo-close-pane`: restore into the original tab group, keeping id + history. */
export function undoCloseLeaf(ws: Workspace): boolean {
  const entry = ws.undoHistory.shift()
  if (!entry) return false
  let leaf: WorkspaceLeaf | null = ws.activeLeaf
  let root: WorkspaceParent = ws.rootSplit
  if (entry.rootId) root = [ws.rootSplit, ws.floatingSplit, ws.leftSplit, ws.rightSplit].find(r => r.id === entry.rootId) ?? root
  if (entry.parentId) {
    let tabs: WorkspaceTabs | null = null
    ws.iterateTabs([root], tb => {
      if (tb.id === entry.parentId) tabs = tb
    })
    if (tabs) {
      const tb = tabs as WorkspaceTabs
      leaf = new WorkspaceLeaf(ws.app)
      tb.insertChild(tb.children.length, leaf)
    }
  }
  if (!leaf || leaf.view.getViewType() !== 'empty') leaf = root === ws.floatingSplit ? ws.openPopoutLeaf() : ws.splitActiveLeaf()
  if (entry.parentId && leaf.parent) leaf.parent.id = entry.parentId
  if (entry.leafId) leaf.id = entry.leafId
  entry.state.active = true
  if (entry.leafHistory) leaf.history.deserialize(entry.leafHistory)
  void leaf.setViewState(entry.state, entry.eState)
  return true
}

/**
 * Drop-direction rule: nearest edge within 33% of the target, else "center". Also shrinks `rect`
 * in place to the highlight band (`max(dim/3, 40px)`) for the chosen edge.
 */
export function getDropDirection(ws: Workspace, evt: { clientX: number; clientY: number; target?: EventTarget | null }, rect: { x: number; y: number; width: number; height: number }, exclude?: string[] | null, target?: WorkspaceItem): string {
  const { clientX: x, clientY: y } = evt
  const l = Math.abs(x - rect.x) / rect.width
  const tp = Math.abs(y - rect.y) / rect.height
  const r = Math.abs(x - (rect.x + rect.width)) / rect.width
  const b = Math.abs(y - (rect.y + rect.height)) / rect.height
  exclude = exclude ? exclude.slice() : []
  const inHeader = target instanceof WorkspaceTabs && contains(evt as unknown as Event, target.tabHeaderContainerEl)
  if (target instanceof WorkspaceTabs && target.isStacked && !inHeader) exclude.push('left', 'right')
  let dir = 'center'
  let best = 1
  if (tp < 0.33 && tp < best && !exclude.includes('top')) {
    best = tp
    if (target instanceof WorkspaceTabs) {
      if (!target.isStacked && inHeader) best = 0
      const hr = target.tabHeaderContainerEl.getBoundingClientRect()
      if (y - rect.y <= hr.height / 3) dir = 'top'
      else {
        dir = 'center'
        if (target.isStacked) best = 1
      }
    } else dir = 'top'
  }
  if (l < 0.33 && l < best && !exclude.includes('left')) {
    best = l
    dir = 'left'
  }
  if (r < 0.33 && r < best && !exclude.includes('right')) {
    best = r
    dir = 'right'
  }
  if (b < 0.33 && b < best && !exclude.includes('bottom')) {
    best = b
    dir = 'bottom'
  }
  let band = dir === 'left' || dir === 'right' ? rect.width : rect.height
  band = Math.max(band / 3, 40)
  if (dir === 'left') rect.width = band
  else if (dir === 'top') rect.height = band
  else if (dir === 'right') {
    rect.x += rect.width - band
    rect.width = band
  } else if (dir === 'bottom') {
    rect.y += rect.height - band
    rect.height = band
  }
  return dir
}
