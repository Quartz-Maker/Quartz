// Canvas geometry: boxes, side anchors, edge bezier paths, snapping.
import type { CanvasSide } from './json'

export interface Point {
  x: number
  y: number
}
export interface Rect extends Point {
  width: number
  height: number
}
export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const pt = (x: number, y: number): Point => ({ x, y })
export const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })
export const bbox = (minX: number, minY: number, maxX: number, maxY: number): BBox => ({ minX, minY, maxX, maxY })
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function bboxFromPoints(a: Point, b: Point): BBox {
  return bbox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))
}
export function rectToBBox(r: Rect): BBox {
  return bbox(r.x, r.y, r.x + r.width, r.y + r.height)
}
export function bboxToRect(b: BBox): Rect {
  return rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
}
export function unionBBox(list: BBox[]): BBox {
  const out = bbox(Infinity, Infinity, -Infinity, -Infinity)
  for (const b of list) {
    out.minX = Math.min(out.minX, b.minX)
    out.minY = Math.min(out.minY, b.minY)
    out.maxX = Math.max(out.maxX, b.maxX)
    out.maxY = Math.max(out.maxY, b.maxY)
  }
  return out
}
export function expandBBox(b: BBox, by: number): BBox {
  return bbox(b.minX - by, b.minY - by, b.maxX + by, b.maxY + by)
}
/** `outer` fully contains `inner`. */
export function containsBBox(outer: BBox, inner: BBox): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY
}
export function intersectsBBox(a: BBox, b: BBox): boolean {
  return b.minX <= a.maxX && b.minY <= a.maxY && b.maxX >= a.minX && b.maxY >= a.minY
}
export function bboxCenter(b: BBox): Point {
  return pt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)
}
export function bboxEquals(a: BBox, b: BBox): boolean {
  return a.maxX === b.maxX && a.maxY === b.maxY && a.minX === b.minX && a.minY === b.minY
}

/** Top-left of a box of `size` centred on `p`. */
export function centeredAt(p: Point, size: { width: number; height: number }): Point {
  return pt(p.x - size.width / 2, p.y - size.height / 2)
}

/**
 * Creation placement: `position` = "center" centres the box on `pos`; a side places the box so that
 * the given side's midpoint is at `pos` (used when an edge is dropped on empty space).
 */
export function placeRect(pos: Point, size: { width: number; height: number }, position?: 'center' | CanvasSide): Rect {
  if (position) {
    if (position === 'center') pos = centeredAt(pos, size)
    else {
      const { width: w, height: h } = size
      switch (position) {
        case 'left':
          pos = pt(pos.x, pos.y - h / 2)
          break
        case 'top':
          pos = pt(pos.x - w / 2, pos.y)
          break
        case 'right':
          pos = pt(pos.x - w, pos.y - h / 2)
          break
        case 'bottom':
          pos = pt(pos.x - w / 2, pos.y - h)
          break
      }
    }
  }
  return rect(pos.x, pos.y, size.width, size.height)
}

export type ResizeHandle = CanvasSide | 'topleft' | 'topright' | 'bottomleft' | 'bottomright'

/** The snapping source of a resize handle (an edge line or a corner point). */
export function resizeSource(handle: ResizeHandle, p: Point, r: Rect): { source: Rect; resizeX: boolean; resizeY: boolean } {
  switch (handle) {
    case 'top':
    case 'bottom':
      return { source: rect(r.x, p.y, r.width, 0), resizeX: false, resizeY: true }
    case 'left':
    case 'right':
      return { source: rect(p.x, r.y, 0, r.height), resizeX: true, resizeY: false }
    default:
      return { source: rect(p.x, p.y, 0, 0), resizeX: true, resizeY: true }
  }
}

// --- edges ----------------------------------------------------------------------------------

/** Midpoint of a box side (the edge anchor). */
export function sideAnchor(b: BBox, side: CanvasSide): Point {
  switch (side) {
    case 'top':
      return pt((b.minX + b.maxX) / 2, b.minY)
    case 'right':
      return pt(b.maxX, (b.minY + b.maxY) / 2)
    case 'bottom':
      return pt((b.minX + b.maxX) / 2, b.maxY)
    case 'left':
      return pt(b.minX, (b.minY + b.maxY) / 2)
  }
}

/** Length of the arrow head; the curve starts/ends this far out from the side. */
export const EDGE_END_OFFSET = 7

export function offsetFromSide(p: Point, side: CanvasSide, by = EDGE_END_OFFSET): Point {
  switch (side) {
    case 'top':
      return pt(p.x, p.y - by)
    case 'bottom':
      return pt(p.x, p.y + by)
    case 'left':
      return pt(p.x - by, p.y)
    case 'right':
      return pt(p.x + by, p.y)
  }
}

export interface Bezier {
  from: Point
  to: Point
  cp1: Point
  cp2: Point
  path: string
}

/** Cubic bezier between two side points; control points pushed along the side normals by clamp(d/2, 70, 150). */
export function edgeBezier(from: Point, fromSide: CanvasSide, to: Point, toSide: CanvasSide): Bezier {
  const d = clamp(distance(from, to) / 2, 70, 150)
  const cp1 = offsetFromSide(from, fromSide, d)
  const cp2 = offsetFromSide(to, toSide, d)
  return { from, to, cp1, cp2, path: `M${from.x},${from.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${to.x},${to.y}` }
}

export function bezierPoint(t: number, b: Bezier): Point {
  const u = 1 - t
  const a = u * u * u
  const c1 = 3 * t * u * u
  const c2 = 3 * t * t * u
  const d = t * t * t
  return pt(a * b.from.x + c1 * b.cp1.x + c2 * b.cp2.x + d * b.to.x, a * b.from.y + c1 * b.cp1.y + c2 * b.cp2.y + d * b.to.y)
}

/** Arrow head rotation per side (the polygon points "down" at 0deg). */
export const SIDE_ROTATION: Record<CanvasSide, string> = { top: '180', bottom: '0', left: '90', right: '270' }
export const ARROW_POINTS = '0,0 6.5,10.4 -6.5,10.4'

/** The `d` attribute of an edge plus the arrow transforms. */
export function edgePath(fromBox: BBox, fromSide: CanvasSide, fromArrow: boolean, toBox: BBox, toSide: CanvasSide, toArrow: boolean) {
  const a = sideAnchor(fromBox, fromSide)
  const a2 = offsetFromSide(a, fromSide)
  const b = sideAnchor(toBox, toSide)
  const b2 = offsetFromSide(b, toSide)
  const bezier = edgeBezier(a2, fromSide, b2, toSide)
  let d = bezier.path
  let fromTransform: string | null = null
  let toTransform: string | null = null
  if (fromArrow) fromTransform = `translate(${a.x}px, ${a.y}px) rotate(${SIDE_ROTATION[fromSide]}deg)`
  else d = `M${a.x} ${a.y} L${a2.x} ${a2.y} ${d}`
  if (toArrow) toTransform = `translate(${b.x}px, ${b.y}px) rotate(${SIDE_ROTATION[toSide]}deg)`
  else d = `${d} M${b2.x} ${b2.y} L${b.x} ${b.y}`
  return { d, bezier, fromTransform, toTransform }
}

/** The side of `from` facing `to` (used when an edge has no side in the file). */
export function sideTowards(from: Rect, to: Rect): CanvasSide {
  const a = bboxCenter(rectToBBox(from))
  const b = bboxCenter(rectToBBox(to))
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const corner = Math.atan2(from.height, from.width)
  if (angle > -corner && angle <= corner) return 'right'
  if (angle > corner && angle <= Math.PI - corner) return 'bottom'
  if (angle > Math.PI - corner || angle <= -(Math.PI - corner)) return 'left'
  return 'top'
}

export function oppositeSide(side: CanvasSide): CanvasSide {
  switch (side) {
    case 'right':
      return 'left'
    case 'left':
      return 'right'
    case 'top':
      return 'bottom'
  }
  return 'top'
}

// --- snapping -------------------------------------------------------------------------------

/** Corners + centre of a box. */
export function snapPointsOf(b: BBox): Point[] {
  return [pt(b.minX, b.minY), pt(b.minX, b.maxY), pt(b.maxX, b.minY), pt(b.maxX, b.maxY), pt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)]
}

/** Unique snap points of several boxes, sorted by x then y. */
export function collectSnapPoints(boxes: BBox[]): Point[] {
  const all: Point[] = []
  for (const b of boxes) for (const p of snapPointsOf(b)) all.push(p)
  all.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
  const out: Point[] = []
  let prev: Point | null = null
  for (const p of all) {
    if (prev && prev.x === p.x && prev.y === p.y) continue
    prev = p
    out.push(p)
  }
  return out
}

export interface SnapMatch {
  src: Point[]
  dest: Point[]
}
export interface SnapResult {
  matches: SnapMatch[]
  delta: number
}

/**
 * Best alignment of `src` points onto `dest` points along one axis within `maxDelta`
 * (all source/target pairs sharing the winning delta are returned for guide rendering).
 */
export function findSnap(src: Point[], dest: Point[], maxDelta: number, axis: 'x' | 'y'): SnapResult | null {
  if (src.length === 0 || dest.length === 0) return null
  const key = axis === 'x' ? (p: Point) => p.x : (p: Point) => p.y
  src.sort((a, b) => key(a) - key(b))
  dest.sort((a, b) => key(a) - key(b))
  let delta = maxDelta
  let matches: SnapMatch[] = []
  let s: Point[] = []
  let d: Point[] = []
  let last = Infinity
  for (const p of src) {
    const v = key(p)
    if (v !== last) {
      last = v
      if (s.length > 0 || d.length > 0) {
        matches.push({ src: s, dest: d })
        s = []
        d = []
      }
      let lo = 0
      let hi = dest.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const diff = v - key(dest[mid])
        if (diff > 0) lo = mid + 1
        else if (diff < 0) hi = mid - 1
        else {
          lo = hi = mid
          break
        }
      }
      if (lo !== hi) {
        if (hi < 0) hi = 0
        else if (lo >= dest.length - 1) lo = dest.length - 1
        else {
          const up = key(dest[lo]) - v
          const down = v - key(dest[hi])
          if (up === down) {
            if (up === delta) hi = lo
            else lo = hi
          } else lo = hi = up < down ? lo : hi
        }
      }
      const target = key(dest[lo])
      const dd = target - v
      if (dd === delta || Math.abs(dd) < Math.abs(delta)) {
        if (dd !== delta) {
          matches = []
          s = []
          d = []
          delta = dd
        }
        while (lo > 0 && key(dest[lo - 1]) === target) lo--
        while (hi < dest.length - 1 && key(dest[hi + 1]) === target) hi++
        s.push(p)
        for (let i = lo; i <= hi; i++) d.push(dest[i])
      }
    } else if (s.length > 0 && key(s[s.length - 1]) === v) s.push(p)
  }
  if (s.length > 0 || d.length > 0) matches.push({ src: s, dest: d })
  return matches.length === 0 ? null : { matches, delta }
}

/** Grid spacing for a log2 zoom level. */
export function gridSpacingFor(zoom: number): number {
  return zoom < -3.3 ? 160 : zoom < -2.16 ? 80 : zoom < -0.91 ? 40 : 20
}
