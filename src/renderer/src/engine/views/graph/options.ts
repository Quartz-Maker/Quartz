// Graph options: defaults, slider transforms and graph.json key order.
// graph.json stores SLIDER positions; the forces sent to the worker are transformed:
//   centerStrength / linkStrength → logSlider(v, 0.01), repelStrength → v³, linkDistance raw.

/** Engine (data) options and their defaults. */
export interface GraphDataOptions {
  showAttachments: boolean
  hideUnresolved: boolean
  showOrphans: boolean
  showTags: boolean
  localFile: string | null
  localJumps: number
  localInterlinks: boolean
  localForelinks: boolean
  localBacklinks: boolean
}

export const DEFAULT_DATA_OPTIONS: GraphDataOptions = {
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  showTags: false,
  localFile: null,
  localJumps: 1,
  localInterlinks: false,
  localForelinks: true,
  localBacklinks: true
}

/** Log-scale slider → value: (t^(1-x) - t) / (1 - t); 0→0, 1→1. */
export function sliderToValue(x: number, t: number): number {
  return (Math.pow(t, 1 - x) - t) / (1 - t)
}

/** Inverse of sliderToValue. */
export function valueToSlider(v: number, t: number): number {
  return 1 - Math.log(v * (1 - t) + t) / Math.log(t)
}

export const DEFAULT_DISPLAY_OPTIONS = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1
}

/** Slider positions (what graph.json stores). */
export const DEFAULT_FORCE_OPTIONS = {
  centerStrength: valueToSlider(0.1, 0.01),
  repelStrength: 10,
  linkStrength: valueToSlider(1, 0.01),
  linkDistance: 250
}

/** Worker force values for slider positions. */
export const forceTransforms = {
  centerStrength: (v: number) => sliderToValue(v, 0.01),
  repelStrength: (v: number) => v * v * v,
  linkStrength: (v: number) => sliderToValue(v, 0.01),
  linkDistance: (v: number) => v
}

export interface ColorGroup {
  query: string
  color: { a: number; rgb: number }
}

/** The persisted options object (graph.json / localgraph leaf state `options`). */
export interface GraphOptions {
  'collapse-filter'?: boolean
  search?: string
  localJumps?: number
  localBacklinks?: boolean
  localForelinks?: boolean
  localInterlinks?: boolean
  showTags?: boolean
  showAttachments?: boolean
  hideUnresolved?: boolean
  showOrphans?: boolean
  'collapse-color-groups'?: boolean
  colorGroups?: ColorGroup[]
  'collapse-display'?: boolean
  showArrow?: boolean
  textFadeMultiplier?: number
  nodeSizeMultiplier?: number
  lineSizeMultiplier?: number
  'collapse-forces'?: boolean
  centerStrength?: number
  repelStrength?: number
  linkStrength?: number
  linkDistance?: number
  scale?: number
  close?: boolean
  [key: string]: unknown
}

/** Slider limits [min, max, step] of every slider in the panel. */
export const SLIDER_LIMITS: Record<string, [number, number, number | 'any']> = {
  localJumps: [1, 5, 1],
  textFadeMultiplier: [-3, 3, 0.1],
  nodeSizeMultiplier: [0.1, 5, 'any'],
  lineSizeMultiplier: [0.1, 5, 'any'],
  centerStrength: [0, 1, 'any'],
  repelStrength: [0, 20, 'any'],
  linkStrength: [0, 1, 'any'],
  linkDistance: [30, 500, 1]
}

/** HSL → packed RGB int, as used for new colour groups (h = 40·index, s = 70 dark / 60 light, l = 60). */
export function hslToRgbInt(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const r = Math.round(f(0) * 255), g = Math.round(f(8) * 255), b = Math.round(f(4) * 255)
  return (r << 16) | (g << 8) | b
}

export function newGroupColor(index: number, dark: boolean): { a: number; rgb: number } {
  return { a: 1, rgb: hslToRgbInt(40 * index, dark ? 70 : 60, 60) }
}

/** Serialize options as plugin.saveData does (JSON, 2-space indent). */
export function serializeOptions(options: GraphOptions): string {
  return JSON.stringify(options, null, 2)
}
