// JSON Canvas data model (read/write).
//   - nodes: text | file | link | group (unknown types are skipped on import)
//   - edges: fromEnd defaults to "none", toEnd to "arrow"; sides may be missing (computed from geometry)
//   - every node/edge keeps the keys it does not consume (`unknownData`) and spreads them first
//   - files are printed with tabs, any object/array whose values are all primitives on one line
import { toHex } from './color'

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'
export type CanvasEdgeEnd = 'none' | 'arrow'
/** "1"–"6" (theme presets) or any CSS colour (hex as written by the colour picker). */
export type CanvasColor = string

export interface CanvasNodeDataBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
  [key: string]: unknown
}
export interface CanvasTextData extends CanvasNodeDataBase {
  type: 'text'
  text: string
}
export interface CanvasFileData extends CanvasNodeDataBase {
  type: 'file'
  file: string
  subpath?: string
}
export interface CanvasLinkData extends CanvasNodeDataBase {
  type: 'link'
  url: string
}
export type CanvasBackgroundStyle = 'cover' | 'ratio' | 'repeat'
export interface CanvasGroupData extends CanvasNodeDataBase {
  type: 'group'
  label?: string
  background?: string
  backgroundStyle?: CanvasBackgroundStyle
}
export type CanvasNodeData = CanvasTextData | CanvasFileData | CanvasLinkData | CanvasGroupData

export interface CanvasEdgeData {
  id: string
  fromNode: string
  fromSide?: CanvasSide
  fromEnd?: CanvasEdgeEnd
  toNode: string
  toSide?: CanvasSide
  toEnd?: CanvasEdgeEnd
  color?: CanvasColor
  label?: string
  [key: string]: unknown
}

export interface CanvasData {
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  [key: string]: unknown
}

export const DEFAULT_FROM_END: CanvasEdgeEnd = 'none'
export const DEFAULT_TO_END: CanvasEdgeEnd = 'arrow'

/** 16 random lowercase hex chars (id generator). Overridable for tests. */
export let randomId = (length = 16): string => {
  let s = ''
  for (let i = 0; i < length; i++) s += ((16 * Math.random()) | 0).toString(16)
  return s
}
export function setRandomIdGenerator(fn: (length?: number) => string): void {
  randomId = fn
}

const isPrimitive = (v: unknown): boolean => typeof v !== 'object'

function printLines(value: unknown, indent: string): string[] {
  if (value === undefined) return ['null']
  if (isPrimitive(value) || !value || Object.prototype.toString.call(value) === '[object Date]') return [JSON.stringify(value)]
  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return [JSON.stringify(value)]
    const out = ['[']
    value.forEach((item, i) => {
      const lines = printLines(item, indent)
      lines.forEach((line, j) => out.push(indent + line + (j === lines.length - 1 && i !== value.length - 1 ? ',' : '')))
    })
    out.push(']')
    return out
  }
  const obj = value as Record<string, unknown>
  let flat = true
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && !isPrimitive(obj[k])) {
      flat = false
      break
    }
  }
  if (flat) return [JSON.stringify(obj)]
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined)
  const out = ['{']
  keys.forEach((k, i) => {
    const lines = printLines(obj[k], indent)
    lines[0] = JSON.stringify(k) + ':' + lines[0]
    lines.forEach((line, j) => out.push(indent + line + (j === lines.length - 1 && i !== keys.length - 1 ? ',' : '')))
  })
  out.push('}')
  return out
}

/** The pretty-printer used for `.canvas` files (tab indent, compact primitive-only containers). */
export function stringifyCanvas(data: unknown, indent = '\t'): string | undefined {
  if (data === undefined) return undefined
  return printLines(data, indent).join('\n')
}

/** Parse a `.canvas` file's text (empty text → `{}`, as an empty canvas). */
export function parseCanvas(text: string): Partial<CanvasData> {
  if (!text) return {}
  return JSON.parse(text)
}

const RGB_TRIPLE = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/i

/** Colour normalisation on read: `"r,g,b"` → `#rrggbb`, everything else kept as is. */
export function normalizeColor(color: string): string {
  const m = color.match(RGB_TRIPLE)
  return m ? toHex({ r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) }) : color
}

/** Object without the listed keys (TS `__rest`). */
export function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && !keys.includes(k)) out[k] = obj[k]
  return out
}
