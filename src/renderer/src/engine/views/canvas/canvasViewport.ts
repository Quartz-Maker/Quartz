/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas viewport/frame helpers: render frame, virtualisation, zoom/pan, wheel.
// Bodies of Canvas methods (called with the canvas as `this`); the thin methods stay on the class.
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'
import { Platform } from '../../keymap/Platform'
import { bboxCenter, containsBBox, expandBBox, pt, unionBBox, type BBox, type Point } from './geometry'
import { isInsideScrollable, measureViewport } from './dom'
import { CanvasNode } from './CanvasNode'
import { CanvasEdge } from './CanvasEdge'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { ZOOM_EPSILON, WHEEL_PAN_FACTOR, ZOOM_BREAKPOINT_BASE } from './canvasSupport'

export function setViewport(this: Canvas, x: number, y: number, zoom: number): void {
  if (x === this.x && y === this.y && zoom === this.zoom) return
  this.x = this.tx = x
  this.y = this.ty = y
  this.zoom = this.tZoom = zoom
  this.markViewportChanged()
}

export function zoomBy(this: Canvas, delta: number, center?: Point): void {
  this.tZoom += delta
  this.zoomCenter = center || pt(0, 0)
  this.markViewportChanged()
}

export function panBy(this: Canvas, dx: number, dy: number): void {
  this.x += dx
  this.y += dy
  this.tx = this.x
  this.ty = this.y
  this.markViewportChanged()
}

export function nudgeSelection(this: Canvas, e: KeyboardEvent, dir: 'up' | 'down' | 'left' | 'right'): void {
  const nodes = Array.from(this.selection).filter(i => i instanceof CanvasNode) as CanvasNode[]
  if (nodes.length === 0) return
  const step = e.shiftKey ? 5 * this.gridSpacing : this.gridSpacing
  const d = { x: 0, y: 0 }
  if (dir === 'down') d.y = step
  else if (dir === 'up') d.y = -step
  else if (dir === 'left') d.x = -step
  else d.x = step
  if (this.options.snapToGrid) {
    const g = this.gridSpacing
    const b = unionBBox(Array.from(this.selection).map(i => i.getBBox()))
    const off = { x: Math.round(b.minX % g), y: Math.round(b.minY % g) }
    if ((dir === 'left' || dir === 'right') && off.x > 0) {
      d.x = -off.x
      if (dir === 'right') d.x += g
    } else if ((dir === 'up' || dir === 'down') && off.y > 0) {
      d.y = -off.y
      // (sic) the grid step is added to x here
      if (dir === 'down') d.x += g
    }
  }
  for (const n of nodes) n.moveTo({ x: n.x + d.x, y: n.y + d.y })
  this.requestSave()
}

export function zoomToBbox(this: Canvas, b: BBox): void {
  const { width, height } = this.canvasRect
  if (width === 0 || height === 0) return
  const sx = width / (1.1 * (b.maxX - b.minX))
  const sy = height / (1.1 * (b.maxY - b.minY))
  const s = Math.clamp(Math.min(sx, sy), -4, 1)
  const c = bboxCenter(b)
  this.tx = c.x
  this.ty = c.y
  this.zoomCenter = null
  this.tZoom = Math.log2(s)
  this.markViewportChanged()
}

export function panIntoView(this: Canvas, b: BBox, margin: number = this.gridSpacing): void {
  b = expandBBox(b, margin)
  const v = this.getViewportBBox()
  if (b.maxX - b.minX > v.maxX - v.minX || b.maxY - b.minY > v.maxY - v.minY) {
    this.zoomToBbox(b)
    return
  }
  if (b.minX < v.minX) this.tx = this.x + b.minX - v.minX
  if (b.minY < v.minY) this.ty = this.y + b.minY - v.minY
  if (b.maxX > v.maxX) this.tx = this.x + b.maxX - v.maxX
  if (b.maxY > v.maxY) this.ty = this.y + b.maxY - v.maxY
  this.markViewportChanged()
}

export function getViewportNodes(this: Canvas, excludeSelected?: boolean): CanvasNode[] {
  let list = this.getIntersectingNodes(this.getViewportBBox())
  if (excludeSelected) list = list.filter(n => !this.selection.has(n))
  return list
}

export function hitTestNode(this: Canvas, p: Point, margin = 0): CanvasNode | null {
  const hits = this.nodeIndex.search(expandBBox({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, margin))
  if (hits.length === 0) return null
  hits.sort((a, b) => b.zIndex - a.zIndex)
  return hits[0]
}

export function onResize(this: Canvas): void {
  this.canvasRect = measureViewport(this.wrapperEl)
  this.viewportChanged = true
  this.requestFrame()
  if (this.canvasRect.width > 0 && this.zoomToFitQueued) {
    this.zoomToFitQueued = false
    this.finishViewportAnimation = true
    this.zoomToFit()
  }
}

/** One animation frame: ease the viewport, reindex moved items, virtualize, render dirty items, selection. */
export function renderFrame(this: Canvas, t0: number): void {
  const now = performance.now()
  const dt = now - t0
  const viewportChanged = this.viewportChanged
  if (viewportChanged) {
    let keep = Math.pow(0.984, dt)
    if (this.finishViewportAnimation) {
      keep = 0
      this.finishViewportAnimation = false
    }
    let k = 1 - keep
    let { x, y, zoom, scale } = this
    let { tx, ty, tZoom } = this
    const center = this.zoomCenter
    if (!this.screenshotting) tZoom = this.tZoom = Math.clamp(tZoom, -4, 1)
    const dz = tZoom - zoom
    if (Math.abs(dz) < ZOOM_EPSILON) k = 1
    if (Math.abs(dz) === Infinity) {
      zoom = tZoom = 0
      scale = Math.pow(2, zoom)
    } else if (dz === 0) {
      zoom = tZoom
      scale = Math.pow(2, zoom)
    } else if (center) {
      const prev = scale
      zoom += dz * k
      scale = Math.pow(2, zoom)
      x -= center.x / scale - center.x / prev
      y -= center.y / scale - center.y / prev
      tx = this.tx = x
      ty = this.ty = y
    } else {
      zoom += dz * k
      scale = Math.pow(2, zoom)
    }
    const ddx = tx - x
    x += ddx * k
    if (ddx !== 0 && Math.abs(ddx) < ZOOM_EPSILON) x = tx
    const ddy = ty - y
    y += ddy * k
    if (ddy !== 0 && Math.abs(ddy) < ZOOM_EPSILON) y = ty
    this.x = x
    this.y = y
    this.zoom = zoom
    this.scale = scale
    const { width: w, height: h } = this.canvasRect
    this.wrapperEl.toggleClass('mod-zoomed-out', zoom <= ZOOM_BREAKPOINT_BASE)
    this.canvasEl.style.transform = `translate(${w / 2}px, ${h / 2}px) scale(${scale}) translate(${-x}px, ${-y}px)`
    const g = this.gridSpacing
    this.backgroundPatternEl.setAttrs({ x: String(w / 2 - (x % g) * scale), y: String(h / 2 - (y % g) * scale), width: String(g * scale), height: String(g * scale) })
    if (this.x !== tx || this.y !== ty || this.zoom !== tZoom || Date.now() < this.pauseAnimation) {
      this.requestFrame(now)
      this.wasAnimating = true
    } else {
      if (this.screenshotting) scale = Math.min(1, scale)
      this.wrapperEl.setCssProps({ '--zoom-multiplier': String(Math.sqrt(1 / scale)) })
      this.wrapperEl.toggleClass('mod-animating', !Platform.isIosApp && this.wasAnimating)
      this.wasAnimating = false
      this.viewportChanged = false
      this.app.workspace?.requestSaveLayout?.()
    }
  }
  const { moved, dirty, nodes, edges, edgeIndex, nodeIndex } = this
  if (moved.size > 0) {
    for (const i of Array.from(moved)) if (i instanceof CanvasNode) for (const e of this.getEdgesForNode(i)) moved.add(e)
    const ns: CanvasNode[] = []
    const es: CanvasEdge[] = []
    for (const i of Array.from(moved)) {
      if (i instanceof CanvasNode) {
        nodeIndex.remove(i)
        if (nodes.has(i.id)) ns.push(i)
      } else if (i instanceof CanvasEdge) {
        edgeIndex.remove(i)
        if (edges.has(i.id)) es.push(i)
      }
      dirty.add(i)
    }
    for (const n of ns) nodeIndex.insert(n)
    for (const e of es) edgeIndex.insert(e)
  }
  this.virtualize()
  for (const i of Array.from(dirty)) {
    if (i.isAttached) {
      i.render()
      dirty.delete(i)
    }
  }
  const stale = this.staleSelection
  const sel = this.selection
  let changed = this.selectionChanged
  if (stale) {
    for (const i of stale) {
      if (!sel.has(i)) {
        if (stale.length === 1) i.blur()
        else i.deselect()
        changed = true
      }
    }
    const was = new Set(stale)
    for (const i of Array.from(sel)) {
      if (was.has(i)) {
        if (stale.length === 1 && sel.size > 1) {
          i.blur()
          i.select()
          changed = true
        } else if (stale.length > 1 && sel.size === 1) {
          i.deselect()
          i.focus()
          changed = true
        }
      } else {
        if (sel.size === 1) i.focus()
        else i.select()
        changed = true
      }
    }
  }
  this.staleSelection = null
  this.selectionChanged = false
  if (changed || viewportChanged || Array.from(sel).some(i => moved.has(i))) this.menu.render(changed)
  moved.clear()
  this.nodeInteractionLayer.render()
}

export function getViewportBBox(this: Canvas): BBox {
  const r = this.canvasRect
  const a = this.posFromDom(pt(r.minX, r.minY))
  const b = this.posFromDom(pt(r.maxX, r.maxY))
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }
}

/** Attach what intersects the viewport (at most 10 newly attached nodes per frame), detach the rest. */
export function virtualize(this: Canvas): void {
  const { screenshotting, lastNodesInViewport: lastN, lastEdgesInViewport: lastE } = this
  const vb = this.getViewportBBox()
  let ns = this.getIntersectingNodes(vb)
  let es = this.getIntersectingEdges(vb)
  if (screenshotting) {
    ns = Array.from(this.nodes.values())
    es = Array.from(this.edges.values())
  }
  const keepN = new Set(ns)
  const keepE = new Set(es)
  if (this.selection.size === 1) this.selection.forEach(i => i instanceof CanvasNode && keepN.add(i))
  let added = 0
  for (const n of ns) {
    if (lastN.has(n)) n.attach()
    else if (added < 10 || screenshotting) {
      n.attach()
      added++
    } else keepN.delete(n)
  }
  for (const e of es) e.attach()
  const gone: CanvasNode[] = []
  lastN.forEach(n => keepN.has(n) || gone.push(n))
  for (const n of gone) n.preDetach()
  for (const n of gone) n.detach()
  lastE.forEach(e => keepE.has(e) || e.detach())
  this.lastNodesInViewport = keepN
  this.lastEdgesInViewport = keepE
  if (added > 0) this.requestFrame()
}

export function setReadonly(this: Canvas, v: boolean): void {
  const b = this.quickSettingsButton
  this.readonly = v
  if (!b) return
  setIcon(b, v ? 'lucide-lock' : 'lucide-settings')
  setTooltip(b, v ? S.labelDisableReadonly : S.labelCanvasSettings, { placement: 'left' })
  this.wrapperEl.toggleClass('mod-readonly', v)
  this.menu.render(true)
}

export function smartZoom(this: Canvas, e: MouseEvent): void {
  const p = this.posFromEvt(e)
  const b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
  if (this.selection.size > 0 && containsBBox(this.menu.selection.bbox, b)) {
    this.zoomToSelection()
    return
  }
  const hits = this.getIntersectingNodes(b)
  if (hits.length > 0) {
    hits.sort((a, c) => a.width * a.height - c.width * c.height)
    this.zoomToBbox(hits[0].bbox!)
  } else this.zoomToFit()
}

export function onWheel(this: Canvas, e: WheelEvent): void {
  if (this.isDragging || e.defaultPrevented) return
  const wrap = this.wrapperEl
  const behavior = this.options.defaultWheelBehavior
  const mod = e.ctrlKey || e.metaKey
  let zoom = mod || this.isHoldingSpace
  const anyE = e as any
  const mouseWheel = Math.abs(anyE.wheelDeltaY) === 240 && anyE.wheelDeltaX === 0
  if (behavior === 'zoom' && !mouseWheel) zoom = !zoom
  if (Platform.isMacOS && e.ctrlKey && e.deltaX === 0 && e.deltaY === 0) {
    this.smartZoom(e)
    return
  }
  if (!mod && isInsideScrollable(e, wrap)) return
  e.preventDefault()
  let dx = e.deltaX
  let dy = e.deltaY
  const mode = e.deltaMode
  if (mode) {
    if (mode === e.DOM_DELTA_LINE) {
      dx *= 40
      dy *= 40
    } else if (mode === e.DOM_DELTA_PAGE) {
      dx *= 800
      dy *= 800
    }
  }
  if (zoom) {
    let dz = -dy / 300
    if (Platform.isMacOS && !Number.isInteger(dy)) dz *= 2
    this.zoomBy(dz, dy < 0 ? this.domPosFromEvt(e) : undefined)
    this.pauseAnimation = Date.now() + 200
  } else if (e.shiftKey && dx === 0) {
    this.tx += (dy / this.scale) * WHEEL_PAN_FACTOR
    this.markViewportChanged()
  } else {
    this.tx += (dx / this.scale) * WHEEL_PAN_FACTOR
    this.ty += (dy / this.scale) * WHEEL_PAN_FACTOR
    this.markViewportChanged()
  }
  const wx = anyE.wheelDeltaX
  const wy = anyE.wheelDeltaY
  const notched = (dx === 0 && Number.isInteger(wy) && Math.abs(wy) === 120 && wy !== -3 * e.deltaY) || (dy === 0 && Number.isInteger(wx) && Math.abs(wx) === 120 && wx !== -3 * e.deltaX)
  if (!notched) this.finishViewportAnimation = true
}
