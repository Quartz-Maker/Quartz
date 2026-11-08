// Graph rendering formulas.

/** Alpha of faded (non-neighbour) nodes and links while hovering. */
export const FADED_ALPHA = 0.2
/** Base radius of the unit circle graphic (drawn at r = 100, scaled by size/100). */
export const CIRCLE_RADIUS = 100

/** Per-frame easing toward a target: a·k + b·(1 − k), k = 0.9 by default. */
export function ease(a: number, b: number, k = 0.9): number {
  return a * k + b * (1 - k)
}

/** Per-channel tint easing. */
export function easeTint(from: number, to: number): number {
  return (ease((from >> 16) & 255, (to >> 16) & 255) << 16) + (ease((from >> 8) & 255, (to >> 8) & 255) << 8) + (ease(from & 255, to & 255) | 0)
}

/** Node radius in world units. */
export function nodeSize(weight: number, nodeSizeMultiplier: number): number {
  return nodeSizeMultiplier * Math.max(8, Math.min(3 * Math.sqrt(weight + 1), 30))
}

/** Nodes/labels grow sub-linearly with zoom. */
export function nodeScaleFor(scale: number): number {
  return Math.sqrt(1 / scale)
}

/** Label alpha before node fade: clamp(log2(scale) + 1 − textFadeMultiplier, 0, 1). */
export function textAlphaFor(scale: number, textFadeMultiplier: number): number {
  return Math.clamp(Math.log(scale) / Math.log(2) + 1 - textFadeMultiplier, 0, 1)
}

/** Arrow alpha ramp: fades in between zoom 0.3 and 0.8. */
export function arrowRamp(scale: number): number {
  return Math.clamp(2 * (scale - 0.3), 0, 1)
}

export const ZOOM_MIN = 1 / 128
export const ZOOM_MAX = 8

/** Wheel delta → target scale factor (line mode ×40, page mode ×800). */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  let d = deltaY
  if (deltaMode === 1) d *= 40
  else if (deltaMode === 2) d *= 800
  return Math.pow(1.5, -d / 120)
}

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}
/** True when `b` lies completely outside `a`. */
export function outside(a: Box, b: Box): boolean {
  return b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom
}
export function boxAround(x: number, y: number, r: number): Box {
  return { left: x - r, right: x + r, top: y - r, bottom: y + r }
}

export const LABEL_FONT =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif'

export function labelFontSize(size: number): number {
  return 14 + size / 4
}

/** Parse a computed CSS colour (rgb/rgba/#hex) → {r,g,b,a}. */
export function parseCssColor(s: string): { r: number; g: number; b: number; a: number } | null {
  s = s.trim()
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s)
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4])
    if (m[4] && m[4].endsWith('%')) a /= 100
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: Math.clamp(a, 0, 1) }
  }
  m = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('')
    const n = parseInt(h.slice(0, 6), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
      const probe = '#010203'
      ctx.fillStyle = probe
      ctx.fillStyle = s
      if (ctx.fillStyle !== probe) {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillRect(0, 0, 1, 1)
        const d = ctx.getImageData(0, 0, 1, 1).data
        return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Colour probe classes (`.graph-view.<class>`) read by the renderer. */
export const COLOR_CLASSES = {
  fill: 'color-fill',
  fillFocused: 'color-fill-focused',
  fillTag: 'color-fill-tag',
  fillUnresolved: 'color-fill-unresolved',
  fillAttachment: 'color-fill-attachment',
  arrow: 'color-arrow',
  circle: 'color-circle',
  line: 'color-line',
  text: 'color-text',
  fillHighlight: 'color-fill-highlight',
  lineHighlight: 'color-line-highlight'
} as const
export type GraphColorKey = keyof typeof COLOR_CLASSES
export type GraphColors = Record<GraphColorKey, { a: number; rgb: number }>

/** Read graph colours from hidden `.graph-view.color-*` probe elements (computed colour × opacity). */
export function readGraphColors(doc: Document = document): GraphColors {
  const out = {} as GraphColors
  for (const key of Object.keys(COLOR_CLASSES) as GraphColorKey[]) {
    const el = doc.body.createDiv({ cls: 'graph-view ' + COLOR_CLASSES[key] })
    const cs = getComputedStyle(el)
    const color = cs.color, opacity = cs.opacity
    el.detach()
    const c = parseCssColor(color)
    let a = parseFloat(opacity)
    if (isNaN(a)) a = 1
    out[key] = c ? { a: a * c.a, rgb: (c.r << 16) | (c.g << 8) | c.b } : { a, rgb: 0x888888 }
  }
  return out
}
