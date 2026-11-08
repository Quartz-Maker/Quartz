/* eslint-disable @typescript-eslint/no-explicit-any */
// The canvas controller (`view.canvas`): viewport (log2 zoom, eased),
// DOM layers, node/edge maps, selection, history, snapping, creation, clipboard, drag & drop.
//
//   div.canvas-wrapper[tabindex=-1]
//     svg.canvas-background > pattern(circle r=0.7) + rect
//     div.canvas-card-menu > div.canvas-card-menu-button.mod-draggable ×3
//     div.canvas-controls > div.canvas-control-group.mod-raised > div.canvas-control-item …
//     div.canvas (transform: translate(w/2, h/2) scale(s) translate(-x, -y))
//       svg.canvas-edges (lines)  svg.canvas-edges (arrow heads)  div.canvas-node …
import { Menu } from '../../ui/Menu'
import { debounce } from '../../vault/debounce'
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'
import { Platform } from '../../keymap/Platform'
import { containsBBox, gridSpacingFor, pt, sideTowards, unionBBox, type BBox, type Point, type SnapResult } from './geometry'
import { randomId, type CanvasData, type CanvasSide } from './json'
import { startPointerDrag, measureViewport, hotkeyLabel, type DragHandlers, type ViewportRect } from './dom'
import { CanvasNode, DummyNode, FileNode, GroupNode, LinkNode, TextNode, nearestSide } from './CanvasNode'
import { CanvasEdge } from './CanvasEdge'
import { CanvasSelectionMenu, NodeInteractionLayer, byZIndex } from './CanvasMenu'
import { CanvasHelpModal, CanvasFileSuggestModal, CanvasMediaSuggestModal } from './modals'
import { S } from './strings'
import { DOT_RADIUS, ZOOM_EPSILON, WHEEL_PAN_FACTOR, ZOOM_BREAKPOINT_BASE, SetMultimap, SpatialIndex, CanvasHistory, type CanvasOptions, type CanvasHost, canvasShellHooks } from './canvasSupport'
import { isUrl, dataTransferText } from './canvasUrl'
import { createPlaceholder, getSelectionData, updateFileOpen, setData, importData, clear, addNode, removeNode, addEdge, removeEdge, getIntersectingEdges, selectOnly, selectAll, deleteSelection, getZIndex, createTextNode, createFileNode, createFileNodes, createLinkNode, createGroupNode, markDirty } from './canvasNodes'
import { setViewport, zoomBy, panBy, nudgeSelection, zoomToBbox, panIntoView, getViewportNodes, hitTestNode, onResize, renderFrame, getViewportBBox, virtualize, setReadonly, smartZoom, onWheel } from './canvasViewport'
import { handleCut, cloneData, handlePaste, importFiles, dropDraggable } from './canvasClipboard'
import { toggleGridSnapping, toggleObjectSnapping, getSnapping, endSnapPointRendering, renderSnapPoints, onKeydown, canSnap } from './canvasSnap'
import { onPriorityPointerdown, interactionHitTest, handleDragToSelect, onContextMenu, dragTempNode, handleDragWithPan, handleSelectionDrag } from './canvasPointer'
import { onDoubleClick, showQuickSettingsMenu, showCreationMenu, onSelectionContextMenu, generateHDImage } from './canvasMenus'
export { DOT_RADIUS, ZOOM_EPSILON, WHEEL_PAN_FACTOR, ZOOM_BREAKPOINT_BASE, CanvasHistory, canvasShellHooks } from './canvasSupport'
export type { CanvasOptions, CanvasHost } from './canvasSupport'
export { isUrl, isYouTubeUrl, embedUrlFor, dataTransferText } from './canvasUrl'

/** Requests a frame on the canvas' window; tests can make frames synchronous with `setCanvasFrameScheduler`. */
let frameScheduler: ((win: Window, cb: () => void) => number) | null = null
let frameCanceller: ((win: Window, id: number) => void) | null = null
export function setCanvasFrameScheduler(schedule: ((win: Window, cb: () => void) => number) | null, cancel: ((win: Window, id: number) => void) | null = null): void {
  frameScheduler = schedule
  frameCanceller = cancel
}

export class Canvas {
  app: any
  view: CanvasHost
  config = {
    zoomMultiplier: 0.5,
    objectSnapDistance: 15,
    minContainerDimension: 50,
    defaultTextNodeDimensions: { width: 250, height: 60 },
    defaultFileNodeDimensions: { width: 400, height: 400 }
  }
  requestUpdateFileOpen = debounce((file: any) => this.updateFileOpen(file), 200)
  zIndexCounter = 1
  isHoldingSpace = false
  readonly = false
  history = new CanvasHistory(100)
  data: any = {}
  requestPushHistory = debounce((d: any) => this.pushHistory(d), 250, true)
  x = 0
  y = 0
  zoom = 0
  scale = 1
  tx = 0
  ty = 0
  tZoom = 0
  zoomCenter: Point | null = null
  finishViewportAnimation = false
  zoomToFitQueued = false
  screenshotting = false
  nodes = new Map<string, CanvasNode>()
  nodeIndex = new SpatialIndex<CanvasNode>()
  edges = new Map<string, CanvasEdge>()
  edgeIndex = new SpatialIndex<CanvasEdge>()
  edgeFrom = new SetMultimap<CanvasNode, CanvasEdge>()
  edgeTo = new SetMultimap<CanvasNode, CanvasEdge>()
  staleSelection: any[] | null = null
  selection = new Set<CanvasNode | CanvasEdge>()
  selectionChanged = false
  keys: Record<string, boolean> = {}
  isDragging = false
  viewportChanged = true
  moved = new Set<CanvasNode | CanvasEdge>()
  dirty = new Set<CanvasNode | CanvasEdge>()
  frame = 0
  frameWin: Window | null = null
  wasAnimating = false
  pauseAnimation = 0
  lastNodesInViewport = new Set<CanvasNode>()
  lastEdgesInViewport = new Set<CanvasEdge>()
  pointer: Point = { x: 0, y: 0 }
  pointerFrame = 0
  pointerFrameWin: Window | null = null
  menu: CanvasSelectionMenu
  wrapperEl: HTMLElement
  backgroundPatternEl: SVGElement
  moverEl: HTMLElement
  cardMenuEl: HTMLElement
  quickSettingsButton!: HTMLElement
  undoBtnEl!: HTMLElement
  redoBtnEl!: HTMLElement
  canvasControlsEl: HTMLElement
  canvasEl: HTMLElement
  edgeContainerEl: SVGSVGElement
  edgeEndContainerEl: SVGSVGElement
  canvasRect: ViewportRect
  nodeInteractionLayer: NodeInteractionLayer
  canvasPlaceholderEl: HTMLElement | null = null
  snapContainerEl: SVGElement | null = null

  onGlobalKeydown = (e: KeyboardEvent): void => {
    if (e.key !== ' ' || this.isHoldingSpace) return
    if (this.selection.size === 1) {
      const only = Array.from(this.selection)[0]
      if (only instanceof CanvasNode && only.isEditing) return
    }
    this.wrapperEl.appendChild(this.moverEl)
    this.moverEl.style.zIndex = String(this.zIndexCounter + 4)
    this.isHoldingSpace = true
  }
  onGlobalKeyup = (e: KeyboardEvent): void => {
    if (e.key !== ' ') return
    this.moverEl.detach()
    this.isHoldingSpace = false
  }

  constructor(view: CanvasHost) {
    this.app = view.app
    this.view = view
    this.menu = new CanvasSelectionMenu(this)
    const wrap = (this.wrapperEl = view.contentEl.createDiv({ cls: 'canvas-wrapper', attr: { tabIndex: -1, 'data-ignore-swipe': 'true' } }))
    wrap.onNodeInserted(() => this.onResize())
    wrap.addEventListener('keydown', this.onKeydown.bind(this))
    wrap.addEventListener('pointerdown', this.onPriorityPointerdown.bind(this), { capture: true })
    wrap.addEventListener('pointerdown', this.onPointerdown.bind(this))
    wrap.addEventListener('dblclick', this.onDoubleClick.bind(this))
    wrap.addEventListener('contextmenu', this.onContextMenu.bind(this))
    wrap.addEventListener('wheel', this.onWheel.bind(this))
    if (!Platform.isMobile) wrap.addEventListener('pointermove', this.onPointermove.bind(this))
    const bg = wrap.createSvg('svg', 'canvas-background')
    const pid = randomId(16)
    this.backgroundPatternEl = bg.createSvg('pattern', { attr: { id: pid, patternUnits: 'userSpaceOnUse' } }, p => {
      p.createSvg('circle', { attr: { cx: DOT_RADIUS, cy: DOT_RADIUS, r: DOT_RADIUS } })
    })
    bg.createSvg('rect', { attr: { x: '0', y: '0', width: '100%', height: '100%', fill: `url(#${pid})` } })
    this.moverEl = createDiv('canvas-mover')
    this.moverEl.addEventListener('pointerdown', this.handleMoverPointerdown.bind(this))
    this.cardMenuEl = wrap.createDiv('canvas-card-menu', m => {
      m.createDiv({ cls: 'canvas-card-menu-button mod-draggable' }, b => {
        setTooltip(b, S.actionDragToAddCard, { placement: 'top' })
        setIcon(b, 'lucide-sticky-note')
        b.addEventListener('click', () => this.createTextNode({ pos: this.posCenter(), position: 'center' }))
        b.addEventListener('pointerdown', e => {
          const size = this.config.defaultTextNodeDimensions
          this.dragTempNode(e, size, p => {
            this.deselectAll()
            this.createTextNode({ pos: p, size })
          })
        })
      })
      m.createDiv({ cls: 'canvas-card-menu-button mod-draggable' }, b => {
        setTooltip(b, S.actionDragToAddNote, { placement: 'top' })
        setIcon(b, 'lucide-file-text')
        b.addEventListener('click', () => new CanvasFileSuggestModal(this, f => this.createFileNode({ pos: this.posCenter(), file: f })).showAttachments(false).open())
        b.addEventListener('pointerdown', e => {
          const size = this.config.defaultFileNodeDimensions
          this.dragTempNode(e, size, p => new CanvasFileSuggestModal(this, f => this.createFileNode({ pos: p, size, file: f })).showAttachments(false).open())
        })
      })
      m.createDiv({ cls: 'canvas-card-menu-button mod-draggable' }, b => {
        setTooltip(b, S.actionDragToAddMedia, { placement: 'top' })
        setIcon(b, 'lucide-file-image')
        b.addEventListener('click', () => new CanvasMediaSuggestModal(this, f => this.createFileNode({ pos: this.posCenter(), position: 'center', file: f })).open())
        b.addEventListener('pointerdown', e => {
          const size = this.config.defaultFileNodeDimensions
          this.dragTempNode(e, size, p => new CanvasFileSuggestModal(this, f => this.createFileNode({ pos: p, size, file: f })).showMarkdownAndCanvas(false).open())
        })
      })
    })
    this.canvasControlsEl = wrap.createDiv('canvas-controls', c => {
      c.createDiv('canvas-control-group mod-raised', g => {
        g.createDiv('canvas-control-item', b => {
          this.quickSettingsButton = b
          this.setReadonly(this.readonly)
          b.addEventListener('click', e => {
            if (this.readonly) {
              this.setReadonly(!this.readonly)
              this.view.saveLocalData()
              return
            }
            if (b.hasClass('has-active-menu')) return
            const menu = new Menu()
            this.showQuickSettingsMenu(menu)
            menu.setParentElement(b).showAtMouseEvent(e)
          })
        })
      })
      c.createDiv('canvas-control-group mod-raised', g => {
        g.createDiv('canvas-control-item', b => {
          setIcon(b, 'lucide-plus')
          setTooltip(b, S.zoomIn, { placement: 'left' })
          b.addEventListener('click', () => this.zoomBy(this.config.zoomMultiplier))
        })
        g.createDiv('canvas-control-item', b => {
          setIcon(b, 'lucide-rotate-cw')
          setTooltip(b, S.resetZoom, { placement: 'left' })
          b.addEventListener('click', () => this.zoomBy(-this.zoom))
        })
        g.createDiv('canvas-control-item', b => {
          setIcon(b, 'lucide-maximize')
          setTooltip(b, S.actionZoomToFit + `\n(${hotkeyLabel(['Shift'], '1')})`, { placement: 'left' })
          b.addEventListener('click', () => this.zoomToFit())
        })
        g.createDiv('canvas-control-item', b => {
          setIcon(b, 'lucide-minus')
          setTooltip(b, S.zoomOut, { placement: 'left' })
          b.addEventListener('click', () => this.zoomBy(-this.config.zoomMultiplier))
        })
      })
      c.createDiv('canvas-control-group mod-raised', g => {
        g.createDiv('canvas-control-item', b => {
          this.undoBtnEl = b
          setIcon(b, 'lucide-undo-2')
          setTooltip(b, S.undo, { placement: 'left' })
          b.addEventListener('click', () => this.undo())
        })
        g.createDiv('canvas-control-item', b => {
          this.redoBtnEl = b
          setIcon(b, 'lucide-redo-2')
          setTooltip(b, S.redo, { placement: 'left' })
          b.addEventListener('click', () => this.redo())
        })
      })
      if (Platform.isDesktop)
        c.createDiv('canvas-control-group mod-raised', g => {
          g.createDiv('canvas-control-item', b => {
            setIcon(b, 'lucide-help-circle')
            setTooltip(b, S.labelCanvasHelp, { placement: 'left' })
            b.addEventListener('click', () => new CanvasHelpModal(this).open())
          })
        })
    })
    const cv = (this.canvasEl = wrap.createDiv('canvas'))
    this.edgeContainerEl = cv.createSvg('svg', 'canvas-edges') as SVGSVGElement
    this.edgeEndContainerEl = cv.createSvg('svg', 'canvas-edges') as SVGSVGElement
    wrap.addEventListener('dragover', e => this.onDragOver(e))
    wrap.addEventListener('drop', e => this.onDrop(e))
    this.canvasRect = measureViewport(wrap)
    this.nodeInteractionLayer = new NodeInteractionLayer(this)
  }

  get options(): CanvasOptions {
    return this.view.plugin.options
  }

  createPlaceholder(): void {
    return createPlaceholder.call(this)
  }

  // --- data ----------------------------------------------------------------------------------

  getData(): CanvasData {
    const nodes = Array.from(this.nodes.values())
    nodes.sort(byZIndex)
    return { ...this.data, nodes: nodes.map(n => n.getData()), edges: Array.from(this.edges.values()).map(e => e.getData()) }
  }

  getSelectionData(sel: Set<CanvasNode | CanvasEdge> = this.selection): { nodes: any[]; edges: any[]; center: Point } {
    return getSelectionData.call(this, sel)
  }

  updateFileOpen(file: any): void {
    return updateFileOpen.call(this, file)
  }

  setData(data: any): void {
    return setData.call(this, data)
  }

  /** Create/update nodes and edges from data; `replace` removes everything not in `data`. Returns the touched nodes. */
  importData(data: any, replace: boolean): Set<CanvasNode> | undefined {
    return importData.call(this, data, replace)
  }

  sideTowards(a: CanvasNode, b: CanvasNode): CanvasSide {
    return sideTowards(a, b)
  }
  nearestSide(p: Point, nodes: CanvasNode[]): { side: CanvasSide; node: CanvasNode } | null {
    return nearestSide(p, nodes, this.config.objectSnapDistance)
  }
  createDummyNode(): DummyNode {
    return new DummyNode(this)
  }

  load(): void {
    window.addEventListener('keydown', this.onGlobalKeydown)
    window.addEventListener('keyup', this.onGlobalKeyup)
  }
  unload(): void {
    window.removeEventListener('keydown', this.onGlobalKeydown)
    window.removeEventListener('keyup', this.onGlobalKeyup)
    this.clear()
    this.cancelFrame()
  }
  clear(): void {
    return clear.call(this)
  }

  requestSave(pushHistory = true): void {
    this.data = this.getData()
    if (pushHistory) this.requestPushHistory(this.data)
    this.view.requestSave()
  }
  overrideHistory(): void {
    this.requestPushHistory.run()
    this.data = this.getData()
    this.history.replace(this.data)
    this.updateHistoryUI()
    this.view.requestSave()
  }
  undo(): void {
    if (this.history.canUndo()) this.applyHistory(this.history.undo())
  }
  redo(): void {
    if (this.history.canRedo()) this.applyHistory(this.history.redo())
  }
  applyHistory(d: any): void {
    this.importData(d, true)
    this.data = d
    this.view.requestSave()
    this.updateHistoryUI()
  }
  pushHistory(d: any): void {
    this.history.push(d)
    this.updateHistoryUI()
  }
  updateHistoryUI(): void {
    this.undoBtnEl.toggleClass('is-disabled', !this.history.canUndo())
    this.redoBtnEl.toggleClass('is-disabled', !this.history.canRedo())
  }

  // --- viewport ------------------------------------------------------------------------------

  get zoomBreakpoint(): number {
    return ZOOM_BREAKPOINT_BASE - ((this.options.zoomBreakpoint as number) || 0)
  }
  setViewport(x: number, y: number, zoom: number): void {
    return setViewport.call(this, x, y, zoom)
  }
  zoomBy(delta: number, center?: Point): void {
    return zoomBy.call(this, delta, center)
  }
  panTo(x: number, y: number): void {
    this.x = this.tx = x
    this.y = this.ty = y
    this.markViewportChanged()
  }
  panBy(dx: number, dy: number): void {
    return panBy.call(this, dx, dy)
  }
  zoomToSelection(): void {
    if (this.selection.size === 0) return
    this.zoomToBbox(unionBBox(Array.from(this.selection).map(i => i.getBBox())))
  }
  nudgeSelection(e: KeyboardEvent, dir: 'up' | 'down' | 'left' | 'right'): void {
    return nudgeSelection.call(this, e, dir)
  }
  zoomToFit(): void {
    if (this.nodes.size === 0) return
    this.zoomToBbox(unionBBox(Array.from(this.nodes.values()).map(n => n.getBBox())))
  }
  zoomToBbox(b: BBox): void {
    return zoomToBbox.call(this, b)
  }
  panIntoView(b: BBox, margin: number = this.gridSpacing): void {
    return panIntoView.call(this, b, margin)
  }
  get gridSpacing(): number {
    return gridSpacingFor(this.zoom)
  }
  get snapDistance(): number {
    return Math.ceil(this.config.objectSnapDistance / this.scale)
  }
  posFromEvt(e: { clientX: number; clientY: number }): Point {
    return this.posFromDom(this.domPosFromEvt(e))
  }
  domPosFromEvt(e: { clientX: number; clientY: number }): Point {
    return pt(e.clientX - this.canvasRect.cx, e.clientY - this.canvasRect.cy)
  }
  domPosFromClient(p: Point): Point {
    return pt(p.x - this.canvasRect.cx, p.y - this.canvasRect.cy)
  }
  posFromClient(p: Point): Point {
    return this.posFromDom(this.domPosFromClient(p))
  }
  posFromDom(p: Point): Point {
    return pt(this.x + p.x / this.scale, this.y + p.y / this.scale)
  }
  domFromPos(p: Point): Point {
    return pt((p.x - this.x) * this.scale, (p.y - this.y) * this.scale)
  }
  posCenter(): Point {
    return this.posFromDom(pt(0, 0))
  }
  posInViewport(p: Point): boolean {
    const r = this.canvasRect
    return p.x >= r.minX || p.x <= r.maxX || p.y >= r.minY || p.y <= r.maxY
  }
  getViewportNodes(excludeSelected?: boolean): CanvasNode[] {
    return getViewportNodes.call(this, excludeSelected)
  }
  hitTestNode(p: Point, margin = 0): CanvasNode | null {
    return hitTestNode.call(this, p, margin)
  }

  // --- nodes / edges ---------------------------------------------------------------------------

  addNode(node: CanvasNode): void {
    return addNode.call(this, node)
  }
  removeNode(node: CanvasNode): void {
    return removeNode.call(this, node)
  }
  getIntersectingNodes(b: BBox): CanvasNode[] {
    return this.nodeIndex.search(b)
  }
  getContainingNodes(b: BBox): CanvasNode[] {
    return this.nodeIndex.search(b).filter(n => containsBBox(b, n.getBBox()))
  }
  addEdge(edge: CanvasEdge): void {
    return addEdge.call(this, edge)
  }
  removeEdge(edge: CanvasEdge): void {
    return removeEdge.call(this, edge)
  }
  getEdgesForNode(node: CanvasNode): CanvasEdge[] {
    return this.edgeFrom.getArray(node).concat(this.edgeTo.getArray(node))
  }
  getIntersectingEdges(b: BBox): CanvasEdge[] {
    return getIntersectingEdges.call(this, b)
  }

  // --- selection -------------------------------------------------------------------------------

  updateSelection(fn: () => void): void {
    if (!this.staleSelection) this.staleSelection = Array.from(this.selection)
    fn()
    this.requestFrame()
  }
  select(item: CanvasNode | CanvasEdge): void {
    if (!this.selection.has(item)) this.updateSelection(() => this.selection.add(item))
  }
  deselect(item: CanvasNode | CanvasEdge): void {
    if (this.selection.has(item)) this.updateSelection(() => this.selection.delete(item))
  }
  toggleSelect(item: CanvasNode | CanvasEdge): void {
    this.updateSelection(() => (this.selection.has(item) ? this.selection.delete(item) : this.selection.add(item)))
  }
  selectOnly(item: CanvasNode | CanvasEdge): void {
    return selectOnly.call(this, item)
  }
  selectAll(items?: Iterable<CanvasNode | CanvasEdge>): void {
    return selectAll.call(this, items)
  }
  deselectAll(): void {
    if (this.selection.size !== 0) this.updateSelection(() => this.selection.clear())
  }
  deleteSelection(): void {
    return deleteSelection.call(this)
  }
  setDragging(v: boolean): void {
    if (this.isDragging === v) return
    this.isDragging = v
    this.wrapperEl.toggleClass('is-dragging', v)
    this.selectionChanged = true
    this.requestFrame()
  }
  onResize(): void {
    return onResize.call(this)
  }
  getZIndex(): number {
    return getZIndex.call(this)
  }

  // --- creation --------------------------------------------------------------------------------

  createTextNode(o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; text?: string; save?: boolean; focus?: boolean }): TextNode {
    return createTextNode.call(this, o)
  }
  createFileNode(o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; file: any; subpath?: string; save?: boolean; focus?: boolean }): FileNode {
    return createFileNode.call(this, o)
  }
  createFileNodes(files: any[], at: Point): FileNode[] {
    return createFileNodes.call(this, files, at)
  }
  createLinkNode(o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; url: string; save?: boolean; focus?: boolean }): LinkNode {
    return createLinkNode.call(this, o)
  }
  createGroupNode(o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; label?: string; save?: boolean; focus?: boolean }): GroupNode {
    return createGroupNode.call(this, o)
  }

  markViewportChanged(): void {
    this.viewportChanged = true
    this.requestFrame()
  }
  markMoved(item: CanvasNode | CanvasEdge): void {
    this.moved.add(item)
    this.requestFrame()
  }
  markDirty(item: CanvasNode | CanvasEdge): void {
    return markDirty.call(this, item)
  }

  // --- frame -----------------------------------------------------------------------------------

  requestFrame(start?: number): void {
    if (this.frame) return
    const t0 = start ?? performance.now()
    const win = (this.frameWin = this.canvasEl.ownerDocument.defaultView || window)
    const cb = () => {
      this.frame = 0
      this.frameWin = null
      this.renderFrame(t0)
    }
    this.frame = frameScheduler ? frameScheduler(win, cb) : win.requestAnimationFrame(cb)
  }

  /** One animation frame: ease the viewport, reindex moved items, virtualize, render dirty items, selection. */
  renderFrame(t0: number): void {
    return renderFrame.call(this, t0)
  }

  cancelFrame(): void {
    const { frameWin, frame, pointerFrame, pointerFrameWin } = this
    if (frame && frameWin) {
      if (frameCanceller) frameCanceller(frameWin, frame)
      else frameWin.cancelAnimationFrame(frame)
      this.frame = 0
      this.frameWin = null
    }
    if (pointerFrame && pointerFrameWin) {
      pointerFrameWin.cancelAnimationFrame(pointerFrame)
      this.pointerFrame = 0
      this.pointerFrameWin = null
    }
  }

  getViewportBBox(): BBox {
    return getViewportBBox.call(this)
  }

  /** Attach what intersects the viewport (at most 10 newly attached nodes per frame), detach the rest. */
  virtualize(): void {
    return virtualize.call(this)
  }

  rerenderViewport(): void {
    this.lastNodesInViewport.forEach(n => this.markDirty(n))
  }
  setState(s: any): void {
    if (s && Number.isNumber(s.x) && Number.isNumber(s.y) && Number.isNumber(s.zoom)) {
      this.setViewport(s.x, s.y, s.zoom)
      this.zoomToFitQueued = false
    }
  }
  getState(): { x: number; y: number; zoom: number } {
    return { x: this.tx, y: this.ty, zoom: this.tZoom }
  }

  // --- clipboard -------------------------------------------------------------------------------

  private hasFocus(): boolean {
    return this.canvasEl.ownerDocument.activeElement === this.wrapperEl
  }
  handleCut(e: ClipboardEvent): void {
    return handleCut.call(this, e)
  }
  /** New ids for nodes and edges (edges re-pointed), optional offset. */
  cloneData<T extends { nodes: any[]; edges: any[] }>(d: T, offset?: Point | null): T {
    return (cloneData.call(this, d, offset)) as T
  }
  handleCopy(e: ClipboardEvent): void {
    if (!this.hasFocus()) return
    e.preventDefault()
    if (this.selection.size === 0) return
    e.clipboardData?.setData('obsidian/canvas', JSON.stringify(this.getSelectionData()))
  }
  handlePaste(e: ClipboardEvent): void {
    return handlePaste.call(this, e)
  }

  /** Copy OS files into the vault as attachments (`app.importAttachments` when present). */
  async importFiles(files: File[]): Promise<any[]> {
    return importFiles.call(this, files)
  }

  toggleGridSnapping(v: boolean): void {
    return toggleGridSnapping.call(this, v)
  }
  toggleObjectSnapping(v: boolean): void {
    return toggleObjectSnapping.call(this, v)
  }

  /** Snap offset for moving `boxes` onto `targets` (objects first, grid for the free axes). */
  getSnapping(boxes: BBox[], targets: BBox[], snapX: boolean, snapY: boolean): Point {
    return getSnapping.call(this, boxes, targets, snapX, snapY)
  }
  endSnapPointRendering(): void {
    return endSnapPointRendering.call(this)
  }
  clearSnapPoints(): void {
    this.snapContainerEl?.empty()
  }
  renderSnapPoints(sx: SnapResult | null, sy: SnapResult | null, dx: number, dy: number): void {
    return renderSnapPoints.call(this, sx, sy, dx, dy)
  }

  // --- input -----------------------------------------------------------------------------------

  onKeydown(e: KeyboardEvent): void {
    return onKeydown.call(this, e)
  }

  onPriorityPointerdown(e: PointerEvent): void {
    return onPriorityPointerdown.call(this, e)
  }

  onPointerdown(e: PointerEvent): void {
    if (e.pointerType === 'touch') return
    if (e.target === this.wrapperEl && e.pointerType === 'mouse' && e.button === 0) {
      const additive = e.shiftKey
      const prev = new Set(this.selection)
      if (!additive) this.deselectAll()
      startPointerDrag(e, () => this.handleDragToSelect(e, additive, prev))
    }
  }

  interactionHitTest(e: PointerEvent): void {
    return interactionHitTest.call(this, e)
  }
  onPointermove(e: PointerEvent): void {
    if (e.pointerType !== 'touch') this.interactionHitTest(e)
  }

  /** Rubber-band selection; with Mod held, the band becomes the size of a new card. */
  handleDragToSelect(e: PointerEvent, additive: boolean, prev: Set<CanvasNode | CanvasEdge>): DragHandlers {
    return handleDragToSelect.call(this, e, additive, prev)
  }

  onDoubleClick(e: MouseEvent): void {
    return onDoubleClick.call(this, e)
  }

  onContextMenu(e: MouseEvent): void {
    return onContextMenu.call(this, e)
  }

  setReadonly(v: boolean): void {
    return setReadonly.call(this, v)
  }

  showQuickSettingsMenu(menu: Menu): void {
    return showQuickSettingsMenu.call(this, menu)
  }

  showCreationMenu(menu: Menu, pos: Point, size?: { width: number; height: number }): void {
    return showCreationMenu.call(this, menu, pos, size)
  }

  smartZoom(e: MouseEvent): void {
    return smartZoom.call(this, e)
  }

  onWheel(e: WheelEvent): void {
    return onWheel.call(this, e)
  }

  handleMoverPointerdown(e: PointerEvent): void {
    if (!e.isPrimary || e.button !== 0) return
    const start = this.posFromEvt(e)
    startPointerDrag(e, () => ({
      move: ev => {
        const p = this.posFromEvt(ev)
        this.panBy(start.x - p.x, start.y - p.y)
      }
    }))
  }

  onSelectionContextMenu(e: MouseEvent): void {
    return onSelectionContextMenu.call(this, e)
  }

  canSnap(e: MouseEvent | PointerEvent): boolean {
    return canSnap.call(this, e)
  }

  /** Drag a card preview from the card menu; `place` receives the drop position (top-left). */
  dragTempNode(e: PointerEvent, size: { width: number; height: number }, place: (p: Point) => void): void {
    return dragTempNode.call(this, e, size, place)
  }

  /** Wraps drag handlers: auto-pan near the viewport edges, `is-dragging` state, snap guide cleanup. */
  handleDragWithPan(e: PointerEvent, h: DragHandlers): DragHandlers {
    return handleDragWithPan.call(this, e, h)
  }

  /** Move the selection (groups carry the cards they contain); Alt/Ctrl-drag clones. */
  handleSelectionDrag(e: PointerEvent, el: HTMLElement | null, node?: CanvasNode): DragHandlers | undefined {
    return handleSelectionDrag.call(this, e, el, node)
  }

  // --- drag & drop -----------------------------------------------------------------------------

  /** Internal drags (file explorer etc.) through `app.dragManager` when present; OS files / text / URLs otherwise. */
  private onDragOver(e: DragEvent): void {
    if (e.defaultPrevented || this.readonly) return
    const dm = this.app.dragManager
    const drag = dm?.draggable
    const dt = e.dataTransfer
    if (drag || (dt && (dt.types.includes('Files') || dt.types.includes('text/plain') || dt.types.includes('text/uri-list')))) {
      e.preventDefault()
      if (dt) dt.dropEffect = drag ? 'copy' : dt.types.includes('Files') ? 'copy' : 'link'
    }
  }

  private onDrop(e: DragEvent): void {
    if (e.defaultPrevented || this.readonly) return
    const dm = this.app.dragManager
    const drag = dm?.draggable
    const pos = this.posFromEvt(e)
    if (drag) {
      e.preventDefault()
      this.dropDraggable(drag, pos)
      return
    }
    const dt = e.dataTransfer
    if (!dt) return
    e.preventDefault()
    const files = Array.from(dt.files || [])
    if (files.length) {
      void this.importFiles(files).then(list => {
        this.createFileNodes(list, pos)
        this.requestSave()
      })
      return
    }
    const quartzPath = dt.getData('text/x-quartz-path')
    if (quartzPath) {
      const f = this.app.vault.getAbstractFileByPath(quartzPath)
      if (f) this.dropDraggable({ type: 'children' in f ? 'folder' : 'file', file: f }, pos)
      return
    }
    const text = dataTransferText(dt)
    // In-app drags without a drag manager (file explorer) carry the vault path as text/plain.
    const dragged = text && !text.includes('\n') ? this.app.vault.getAbstractFileByPath(text) : null
    if (dragged) {
      this.dropDraggable({ type: 'children' in dragged ? 'folder' : 'file', file: dragged }, pos)
      return
    }
    if (isUrl(text)) this.createLinkNode({ pos, position: 'center', url: text })
    else if (text) this.createTextNode({ pos, position: 'center', text })
  }

  /** Drop of an app draggable: file / link / files / folder. */
  dropDraggable(drag: any, pos: Point): void {
    return dropDraggable.call(this, drag, pos)
  }

  // --- host helpers ----------------------------------------------------------------------------

  openLinkText(linktext: string, sourcePath: string, newLeaf: boolean | string): void {
    const ws = this.app.workspace
    if (ws?.openLinkText) void ws.openLinkText(linktext, sourcePath || this.view.file?.path || '', newLeaf)
    else canvasShellHooks.openLinkText?.(linktext, sourcePath || this.view.file?.path || '', newLeaf)
  }
  openFile(file: any, newLeaf: boolean | string): void {
    const ws = this.app.workspace
    if (ws?.getLeaf) void ws.getLeaf(newLeaf).openFile(file)
    else canvasShellHooks.openLinkText?.(file.path, '', newLeaf)
  }
  webviewPartition(): string {
    return typeof this.app.getWebviewPartition === 'function' ? this.app.getWebviewPartition() : 'persist:canvas'
  }

  /** Export (desktop): the whole canvas or the viewport as PNG. */
  async generateHDImage(): Promise<void> {
    return generateHDImage.call(this)
  }
}
