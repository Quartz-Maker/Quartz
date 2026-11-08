/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas snapping, snap-point rendering and keydown helpers.
// Bodies of Canvas methods (called with the canvas as `this`); the thin methods stay on the class.
import { Platform } from '../../keymap/Platform'
import { collectSnapPoints, findSnap, pt, unionBBox, type BBox, type Point, type SnapResult } from './geometry'
import { isEditableTarget } from './dom'
import type { Canvas } from './Canvas'

export function toggleGridSnapping(this: Canvas, v: boolean): void {
  this.options.snapToGrid = v
  this.view.plugin.saveOptions()
}

export function toggleObjectSnapping(this: Canvas, v: boolean): void {
  this.options.snapToObjects = v
  this.view.plugin.saveOptions()
}

/** Snap offset for moving `boxes` onto `targets` (objects first, grid for the free axes). */
export function getSnapping(this: Canvas, boxes: BBox[], targets: BBox[], snapX: boolean, snapY: boolean): Point {
  const { snapToGrid, snapToObjects } = this.options
  let dx = 0
  let dy = 0
  let sx: SnapResult | null = null
  let sy: SnapResult | null = null
  if (boxes.length === 0) return { x: 0, y: 0 }
  if (snapToObjects) {
    const src = collectSnapPoints(boxes)
    const dest = collectSnapPoints(targets)
    const d = this.snapDistance
    if ((sx = findSnap(src, dest, snapX ? d : 0, 'x'))) dx += sx.delta
    if ((sy = findSnap(src, dest, snapY ? d : 0, 'y'))) dy += sy.delta
  }
  if (snapToGrid && (!sx || !sy)) {
    const b = unionBBox(boxes)
    const g = this.gridSpacing
    if (!sx && snapX) dx += Math.round(b.minX / g) * g - b.minX
    if (!sy && snapY) dy += Math.round(b.minY / g) * g - b.minY
  }
  if (sx || sy) this.renderSnapPoints(sx, sy, dx, dy)
  return pt(dx, dy)
}

export function endSnapPointRendering(this: Canvas): void {
  if (this.snapContainerEl) {
    this.snapContainerEl.detach()
    this.snapContainerEl = null
  }
}

export function renderSnapPoints(this: Canvas, sx: SnapResult | null, sy: SnapResult | null, dx: number, dy: number): void {
  let el = this.snapContainerEl
  if (!el) el = this.snapContainerEl = this.canvasEl.createSvg('svg', 'canvas-snaps')
  el.style.zIndex = String(this.zIndexCounter + 2)
  const shift = (p: Point) => pt(p.x + dx, p.y + dy)
  let all: any[] = []
  if (sx) all = all.concat(sx.matches)
  if (sy) all = all.concat(sy.matches)
  for (const m of all) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of m.src.map(shift).concat(m.dest)) {
      el.createSvg('circle', { attr: { cx: p.x, cy: p.y, r: 4 } })
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    el.createSvg('line', { attr: { x1: minX, y1: minY, x2: maxX, y2: maxY } })
  }
}

export function onKeydown(this: Canvas, e: KeyboardEvent): void {
  if (e.repeat || e.defaultPrevented || isEditableTarget(e.target)) return
  switch (e.key) {
    case 'Escape':
      this.deselectAll()
      break
    case 'Backspace':
    case 'Delete': {
      const w = this.wrapperEl
      if (this.isDragging || w.ownerDocument.activeElement !== w) break
      this.deleteSelection()
    }
  }
}

export function canSnap(this: Canvas, e: MouseEvent | PointerEvent): boolean {
  return Platform.isMacOS ? !e.ctrlKey : !e.altKey
}
