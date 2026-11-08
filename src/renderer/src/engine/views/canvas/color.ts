// Colour helpers used by the canvas (card colours, group label contrast, colour picker).
export interface RGBA {
  r: number
  g: number
  b: number
  a?: number
}

const byte = (s: string): number => 255 & parseInt(s)
const pct = (s: string): number => 255 & parseInt(s)
const RGB_FN = /^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,\s*[\d.]+\s*)?\)$/i
const HSL_FN = /^hsla?\s*\(\s*([\d.]+)(deg|rad|grad|turn)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(,\s*[\d.]+\s*)?\)$/i
const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

function hue(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + 6 * (q - p) * t
  if (t < 0.5) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number): RGBA {
  h /= 360
  l /= 100
  s /= 100
  let r: number, g: number, b: number
  if (s === 0) r = g = b = l
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }
  return { r: Math.round(255 * r), g: Math.round(255 * g), b: Math.round(255 * b) }
}

const cache: Record<string, RGBA | null> = Object.create(null)
let ctx2d: OffscreenCanvasRenderingContext2D | null | undefined

/** Parse any CSS colour (hex, rgb(), hsl(), named via a 2D context); null when invalid. */
export function parseColor(s: string): RGBA | null {
  let m = s.match(HEX)
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: m[4] ? parseInt(m[4], 16) / 255 : 1 }
  m = s.match(RGB_FN)
  if (m) return { r: byte(m[1]), g: byte(m[2]), b: byte(m[3]), a: m[4] ? clamp01(parseFloat(m[4].substring(1))) : 1 }
  m = s.match(HSL_FN)
  if (m) {
    let h = parseFloat(m[1])
    if (m[2] === 'rad') h = (180 * h) / Math.PI
    else if (m[2] === 'grad') h *= 0.9
    else if (m[2] === 'turn') h *= 360
    return { ...hslToRgb(h, pct(m[3]), pct(m[4])), a: m[5] ? clamp01(parseFloat(m[5].substring(1))) : 1 }
  }
  if (Object.prototype.hasOwnProperty.call(cache, s)) return cache[s]
  if (ctx2d === undefined) {
    try {
      ctx2d = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) : null
    } catch {
      ctx2d = null
    }
  }
  let out: RGBA | null = null
  if (ctx2d) {
    try {
      const probe = '#010203'
      ctx2d.fillStyle = probe
      ctx2d.fillStyle = s
      if (ctx2d.fillStyle !== probe) {
        ctx2d.clearRect(0, 0, 1, 1)
        ctx2d.fillRect(0, 0, 1, 1)
        const d = ctx2d.getImageData(0, 0, 1, 1).data
        out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
      }
    } catch {
      /* ignore */
    }
  }
  cache[s] = out
  return out
}

const hx = (n: number): string => {
  const s = n.toString(16)
  return s.length === 1 ? '0' + s : s
}
export function toHex(c: RGBA): string {
  return '#' + hx(c.r) + hx(c.g) + hx(c.b)
}

/** Perceived brightness ≥ 150 (light colour → dark foreground). */
export function isLightColor(c: RGBA): boolean {
  return (299 * c.r + 587 * c.g + 114 * c.b) / 1000 >= 150
}

const PRESET = /^(\d+)$/
export function isPresetColor(color: string): boolean {
  return PRESET.test(color)
}

/**
 * Apply a canvas colour to an element: removes previous `mod-canvas-color*` classes and the inline
 * `--canvas-color`, toggles `is-themed`, then adds `mod-canvas-color-N` for presets or
 * `mod-canvas-color-custom` + inline `--canvas-color` for parseable custom colours.
 */
export function applyCanvasColor(el: HTMLElement | SVGElement, color: string | undefined | null): void {
  color = (color || '').trim()
  for (const cls of Array.from(el.classList)) if (cls.startsWith('mod-canvas-color')) el.classList.remove(cls)
  el.style.removeProperty('--canvas-color')
  el.classList.toggle('is-themed', !!color)
  if (!color) return
  if (PRESET.test(color)) el.classList.add('mod-canvas-color-' + color)
  else {
    const c = parseColor(color)
    if (c) {
      el.classList.add('mod-canvas-color-custom')
      el.style.setProperty('--canvas-color', toHex(c))
    }
  }
}
