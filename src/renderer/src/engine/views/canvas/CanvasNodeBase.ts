/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas card base class (`CanvasNode`): geometry, z-order, selection, drag/resize/connect, base menu; plus `nearestSide` and `DummyNode`.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { applyCanvasColor } from './color'
import { collectSnapPoints, containsBBox, expandBBox, findSnap, oppositeSide, rectToBBox, resizeSource, type BBox, type Point, type Rect, type ResizeHandle } from './geometry'
import { DEFAULT_FROM_END, DEFAULT_TO_END, normalizeColor, omit, randomId, type CanvasNodeData, type CanvasSide } from './json'
import { startPointerDrag, isEditableTarget } from './dom'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { CanvasEdge } from './CanvasEdge'
import { CanvasFileSuggestModal } from './modals'
import { splitLinktext } from '../../markdown/embeds'

import type { FileNode } from './CanvasFileNode'
import type { GroupNode } from './CanvasGroupNode'

/** Late-bound subclass references (set by their modules) so this base module never imports its subclasses (avoids an import cycle). */
export const nodeClasses = {} as { FileNode: typeof FileNode; GroupNode: typeof GroupNode }

export abstract class CanvasNode {
  app: any
  canvas: Canvas
  id: string
  x = 0
  y = 0
  width = 100
  height = 100
  color = ''
  unknownData: Record<string, unknown> = {}
  initialized = false
  zIndex = -1
  aspectRatio = 0
  isEditing = false
  destroyed = false
  renderedZIndex = -1
  nodeEl: HTMLElement
  containerEl!: HTMLElement
  bbox: BBox | null = null

  constructor(canvas: Canvas, id: string = randomId(16)) {
    this.app = canvas.app
    this.canvas = canvas
    this.id = id
    this.nodeEl = createDiv('canvas-node')
  }

  getData(): CanvasNodeData {
    const d: any = { ...this.unknownData, id: this.id, x: this.x, y: this.y, width: this.width, height: this.height }
    if (this.color) d.color = this.color
    return d
  }

  setData(data: any): void {
    const canvas = this.canvas
    const rest = omit(data, ['x', 'y', 'width', 'height', 'color'])
    const x = Math.round(data.x)
    const y = Math.round(data.y)
    const w = Math.round(data.width)
    const h = Math.round(data.height)
    let dirty = false
    let moved = false
    if (!isNaN(x) && this.x !== x) ((this.x = x), (moved = dirty = true))
    if (!isNaN(y) && this.y !== y) ((this.y = y), (moved = dirty = true))
    if (!isNaN(w) && this.width !== w) ((this.width = w), (moved = dirty = true))
    if (!isNaN(h) && this.height !== h) ((this.height = h), (moved = dirty = true))
    const color = normalizeColor((data.color as string) || '')
    if (this.color !== color) ((this.color = color), (dirty = true))
    if (dirty) canvas.markDirty(this)
    if (moved) canvas.markMoved(this)
    this.unknownData = rest
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, width: this.width, height: this.height }
  }

  setColor(color: string, renderNow = false): void {
    color = normalizeColor(color || '')
    if (this.color === color) return
    this.color = color
    if (renderNow) this.render()
    else this.canvas.markDirty(this)
  }

  moveTo(p: Point): void {
    this.moveAndResize({ width: this.width, height: this.height, ...p })
  }
  resize(size: { width: number; height: number }): void {
    this.moveAndResize({ x: this.x, y: this.y, ...size })
  }
  moveAndResize(r: Rect): void {
    this.x = Math.round(r.x)
    this.y = Math.round(r.y)
    this.width = Math.round(r.width)
    this.height = Math.round(r.height)
    this.canvas.markMoved(this)
  }

  destroy(): void {
    this.nodeEl.detach()
    this.destroyed = true
  }

  attach(): void {
    const canvas = this.canvas
    if (!this.nodeEl.parentNode) canvas.canvasEl.appendChild(this.nodeEl)
    this.updateBreakpoint(canvas.zoom > canvas.zoomBreakpoint || this.isEditing)
  }
  preDetach(): void {}
  detach(): void {
    if (this.nodeEl.parentNode) this.nodeEl.detach()
  }
  updateBreakpoint(_visible: boolean): void {}
  get isAttached(): boolean {
    return !!this.nodeEl.parentNode
  }

  initialize(): void {
    const el = this.nodeEl
    el.addEventListener('click', this.onClick.bind(this))
    el.addEventListener('contextmenu', this.onContextMenu.bind(this))
    this.containerEl = el.createDiv('canvas-node-container')
    this.containerEl.addEventListener('pointerdown', this.onPointerdown.bind(this))
  }

  setIsEditing(editing: boolean): void {
    if (this.isEditing === editing) return
    this.isEditing = editing
    this.nodeEl.toggleClass('is-editing', editing)
  }
  isEditable(): boolean {
    return false
  }
  startEditing(_pos?: Point): void {
    const canvas = this.canvas
    if (canvas.readonly) return
    canvas.selectOnly(this)
    if (canvas.zoom < canvas.zoomBreakpoint + 0.1) canvas.zoomToBbox(this.getBBox())
  }

  getBBox(): BBox {
    return rectToBBox(this)
  }

  render(): void {
    if (!this.initialized) {
      this.initialized = true
      this.initialize()
      if (this.zIndex < 0) this.updateZIndex()
    }
    const { nodeEl, x, y, width, height, color, canvas } = this
    nodeEl.setCssStyles({ transform: `translate(${x}px, ${y}px)`, width: `${width}px`, height: `${height}px` })
    nodeEl.setCssProps({ '--canvas-node-width': `${width}px`, '--canvas-node-height': `${height}px` })
    applyCanvasColor(nodeEl, color)
    nodeEl.toggleClass('is-themed', !!color)
    this.renderZIndex()
    this.updateBreakpoint(canvas.zoom > canvas.zoomBreakpoint || this.isEditing)
  }

  updateZIndex(): void {
    const canvas = this.canvas
    if (this.zIndex !== canvas.zIndexCounter) this.zIndex = canvas.getZIndex()
    this.renderZIndex()
  }
  renderZIndex(): void {
    const canvas = this.canvas
    let z = this.zIndex
    if (canvas.selection.size === 1 && canvas.selection.has(this)) z = canvas.zIndexCounter + 1
    if (z !== this.renderedZIndex) {
      this.nodeEl.style.zIndex = z.toString()
      this.renderedZIndex = z
    }
  }

  get isFocused(): boolean {
    return this.nodeEl.hasClass('is-focused')
  }
  focus(): void {
    this.nodeEl.addClass('is-focused')
    this.renderZIndex()
  }
  blur(): void {
    this.nodeEl.removeClass('is-focused')
    this.setIsEditing(false)
    this.renderZIndex()
  }
  select(): void {
    this.nodeEl.addClass('is-selected')
    this.renderZIndex()
  }
  deselect(): void {
    this.nodeEl.removeClass('is-selected')
    this.renderZIndex()
  }

  onPointerdown(e: PointerEvent): void {
    if (!e.isPrimary || e.button !== 0 || this.isEditing || e.pointerType !== 'mouse' || this.canvas.readonly || isEditableTarget(e.target)) return
    startPointerDrag(e, () => this.canvas.handleSelectionDrag(e, this.nodeEl, this))
  }

  onClick(e: MouseEvent): void {
    if (this.isEditing) return
    const canvas = this.canvas
    if (e.shiftKey) canvas.toggleSelect(this)
    else canvas.selectOnly(this)
  }

  onContextMenu(e: MouseEvent): void {
    if (this.isEditing || e.defaultPrevented) return
    const canvas = this.canvas
    if (canvas.selection.has(this) && canvas.selection.size > 1) canvas.onSelectionContextMenu(e)
    else {
      canvas.selectOnly(this)
      const menu = Menu.forEvent(e)
      menu.addSections(['title', 'canvas', 'open', 'action-primary', 'action', 'info', 'view', 'system', '', 'danger'])
      this.showMenu(menu)
    }
  }

  showMenu(menu: Menu): void {
    const canvas = this.canvas
    if (!canvas.readonly)
      menu.addItem(i =>
        i
          .setSection('danger')
          .setTitle(S.actionRemove)
          .setIcon('lucide-trash-2')
          .setWarning(true)
          .onClick(() => {
            canvas.removeNode(this)
            canvas.requestSave()
          })
      )
    menu.addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.actionZoomToSelection)
        .setIcon('zoom-to-selection')
        .onClick(() => canvas.zoomToSelection())
    )
    this.app.workspace?.trigger?.('canvas:node-menu', menu, this)
  }

  onResizePointerdown(e: PointerEvent, handle: ResizeHandle): void {
    if (!e.isPrimary || e.button !== 0 || (e.pointerType !== 'mouse' && !this.canvas.selection.has(this))) return
    e.preventDefault()
    startPointerDrag(e, () => {
      const canvas = this.canvas
      const { x: ox, y: oy, width: ow, height: oh } = this
      const { snapToGrid, snapToObjects } = canvas.options
      canvas.selectOnly(this)
      this.nodeEl.addClass('is-dragging')
      return canvas.handleDragWithPan(e, {
        move: (ev: PointerEvent) => {
          const min = canvas.config.minContainerDimension
          const p = canvas.posFromEvt(ev)
          canvas.clearSnapPoints()
          let dx = 0
          let dy = 0
          let sx: any = null
          let sy: any = null
          const { source, resizeX, resizeY } = resizeSource(handle, p, this)
          if (canvas.canSnap(ev)) {
            if (snapToObjects) {
              const src = collectSnapPoints([rectToBBox(source)])
              const dest = collectSnapPoints(canvas.getViewportNodes(true).map(n => rectToBBox(n)))
              const dist = canvas.snapDistance
              if (resizeX && (sx = findSnap(src, dest, dist, 'x'))) dx = sx.delta
              if (resizeY && (sy = findSnap(src, dest, dist, 'y'))) dy = sy.delta
            }
            if (snapToGrid) {
              const g = canvas.gridSpacing
              if (resizeX && !sx) dx = Math.round(p.x / g) * g - p.x
              if (resizeY && !sy) dy = Math.round(p.y / g) * g - p.y
            }
          }
          const px = p.x + dx
          const py = p.y + dy
          const b = rectToBBox({ x: ox, y: oy, width: ow, height: oh })
          if (handle.includes('top')) {
            b.minY = Math.min(b.maxY - min, py)
            if (b.minY !== py) ((sy = null), (dy = b.minY - p.y))
          }
          if (handle.includes('left')) {
            b.minX = Math.min(b.maxX - min, px)
            if (b.minX !== px) ((sx = null), (dx = b.minX - p.x))
          }
          if (handle.includes('bottom')) {
            b.maxY = Math.max(b.minY + min, py)
            if (b.maxY !== py) ((sy = null), (dy = b.maxY - p.y))
          }
          if (handle.includes('right')) {
            b.maxX = Math.max(b.minX + min, px)
            if (b.maxX !== px) ((sx = null), (dx = b.maxX - p.x))
          }
          const r = { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }
          const ratio = this.aspectRatio
          if (ratio !== 0) {
            let w = r.width
            let h = r.height
            if (resizeX && resizeY) {
              const nw = Math.max(w, h * ratio)
              h = Math.max(h, w / ratio)
              if ((w = nw) !== r.width) sx = null
              else if (h !== r.height) sy = null
            } else if (resizeX) h = w / ratio
            else if (resizeY) w = h * ratio
            if (handle.includes('left')) {
              const nx = ox + ow - w
              dx += nx - r.x
              r.x = nx
            }
            if (handle.includes('top')) {
              const ny = oy + oh - h
              dy += ny - r.y
              r.y = ny
            }
            if (handle.includes('right')) dx += w - r.width
            if (handle.includes('bottom')) dy += h - r.height
            r.width = w
            r.height = h
          }
          if (sx || sy) canvas.renderSnapPoints(sx, sy, dx, dy)
          this.moveAndResize(r)
        },
        end: () => canvas.requestSave(),
        cancel: () => {
          this.moveAndResize({ x: ox, y: oy, width: ow, height: oh })
          canvas.requestSave()
        },
        cleanup: () => this.nodeEl.removeClass('is-dragging')
      })
    })
  }

  onConnectionPointerdown(e: PointerEvent, side: CanvasSide): void {
    if (!e.isPrimary || e.button !== 0 || (e.pointerType === 'touch' && !this.canvas.selection.has(this))) return
    e.preventDefault()
    startPointerDrag(e, () => {
      const canvas = this.canvas
      const dummy = new DummyNode(canvas)
      let target: { side: CanvasSide; node: CanvasNode } | null = null
      canvas.canvasEl.addClass('is-connecting')
      canvas.deselectAll()
      const toSide = oppositeSide(side)
      const from = { side, node: this as CanvasNode, end: DEFAULT_FROM_END }
      const edge = new CanvasEdge(canvas, randomId(16), from, { side: toSide, node: dummy, end: DEFAULT_TO_END })
      canvas.addEdge(edge)
      return canvas.handleDragWithPan(e, {
        move: (ev: PointerEvent) => {
          const p = canvas.posFromEvt(ev)
          dummy.x = p.x
          dummy.y = p.y
          dummy.width = 0
          dummy.height = 0
          const near = canvas
            .getIntersectingNodes(expandBBox(dummy.getBBox(), canvas.config.objectSnapDistance))
            .filter(n => n !== this && !(n instanceof nodeClasses.GroupNode && containsBBox(n.getBBox(), this.getBBox())) && !(this instanceof nodeClasses.GroupNode && containsBBox(this.getBBox(), n.getBBox())))
          target = nearestSide(p, near, canvas.config.objectSnapDistance)
          if (target) edge.update(from, { side: target.side, node: target.node, end: DEFAULT_TO_END })
          else edge.update(from, { side: toSide, node: dummy, end: DEFAULT_TO_END })
        },
        end: (ev: any) => {
          if (target) {
            canvas.requestSave()
            return
          }
          this.showConnectionDropMenu(ev, edge, from, toSide)
        },
        cancel: () => canvas.removeEdge(edge),
        cleanup: () => canvas.canvasEl.removeClass('is-connecting')
      })
    })
  }

  /** Dropping a new connection on empty space: "Add card" / "Add note from vault" / linked files. */
  showConnectionDropMenu(ev: MouseEvent, edge: CanvasEdge, from: any, toSide: CanvasSide): void {
    const canvas = this.canvas
    const app = this.app
    const menu = new Menu().addSections(['action', 'file', ''])
    let keep = false
    const removeLater = (): void => {
      window.setTimeout(() => {
        if (!keep) canvas.removeEdge(edge)
        keep = false
      }, 50)
    }
    menu.onHide(removeLater)
    const connect = (node: CanvasNode): void => {
      edge.update(from, { side: toSide, node, end: DEFAULT_TO_END })
      canvas.requestSave()
    }
    const placeFile = (file: any, subpath: string): void => {
      const p = canvas.posFromEvt(ev)
      connect(canvas.createFileNode({ pos: p, position: toSide, file, subpath }))
    }
    const choose = async (linktext: string, sourcePath: string): Promise<void> => {
      keep = true
      const p = canvas.posFromEvt(ev)
      if (linktext) {
        const { path, subpath } = splitLinktext(linktext)
        let file = app.metadataCache.getFirstLinkpathDest(path, sourcePath)
        if (!file) {
          const parent = app.fileManager.getNewFileParent(linktext, path)
          file = await app.fileManager.createNewMarkdownFile(parent, path)
        }
        placeFile(file, subpath)
      } else connect(canvas.createTextNode({ pos: p, position: toSide }))
    }
    menu.addItem(i => i.setTitle(S.actionAddCard).setSection('action').onClick(() => void choose('', '')))
    menu.addItem(i =>
      i
        .setTitle(S.actionAddNote)
        .setSection('action')
        .onClick(() => {
          keep = true
          new CanvasFileSuggestModal(canvas, f => {
            keep = true
            placeFile(f, '')
          }, removeLater).open()
        })
    )
    if (this instanceof nodeClasses.FileNode && this.file) {
      const file = this.file
      const links: string[] = []
      const cache = app.metadataCache.getFileCache(file)
      for (const l of cache?.links ?? []) {
        const { path, subpath } = splitLinktext(l.link)
        const dest = app.metadataCache.getFirstLinkpathDest(path, file.path)
        if (dest) links.push(dest.path + subpath)
      }
      const connected = this.getConnectedFiles()
      let n = 0
      for (const lt of links) {
        if (connected.has(lt)) continue
        connected.add(lt)
        menu.addItem(i => i.setTitle(lt).setSection('file').onClick(() => void choose(lt, file.path)))
        if (++n >= 20) break
      }
    }
    app.workspace?.trigger?.('canvas:node-connection-drop-menu', menu, this, edge)
    menu.showAtMouseEvent(ev)
  }

  onResizeDblclick(_e: MouseEvent, _handle: string): void {}

  getConnectedFiles(): Set<string> {
    const out = new Set<string>()
    for (const edge of this.canvas.edgeFrom.getArray(this)) {
      const to = edge.to.node
      if (edge.from.node === this && to instanceof nodeClasses.FileNode && to.file) out.add(to.file.path + to.subpath)
    }
    return out
  }
}

/** Nearest side anchor of `nodes` to `p`; the first within `snap` wins immediately. */
export function nearestSide(p: Point, nodes: CanvasNode[], snap: number): { side: CanvasSide; node: CanvasNode } | null {
  let best: [number, { side: CanvasSide; node: CanvasNode } | null] = [Infinity, null]
  for (const node of nodes) {
    const b = node.getBBox()
    const sides: [CanvasSide, Point][] = [
      ['top', { x: (b.minX + b.maxX) / 2, y: b.minY }],
      ['right', { x: b.maxX, y: (b.minY + b.maxY) / 2 }],
      ['bottom', { x: (b.minX + b.maxX) / 2, y: b.maxY }],
      ['left', { x: b.minX, y: (b.minY + b.maxY) / 2 }]
    ]
    for (const [side, q] of sides) {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d <= snap) return { side, node }
      if (d < best[0]) best = [d, { side, node }]
    }
  }
  return best[1]
}

/** Temporary node: drag previews, the free end of a connection being drawn. */
export class DummyNode extends CanvasNode {
  constructor(canvas: Canvas) {
    super(canvas, randomId(16))
    this.nodeEl.addClass('is-dummy')
  }
}
