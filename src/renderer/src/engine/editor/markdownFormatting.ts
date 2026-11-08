// Tree-aware markdown formatting helpers (toggleMarkdownFormatting machinery). They read the HyperMD token nodes to find the
// formatting element around a position.
import type { EditorState, ChangeSpec } from '@codemirror/state'
import { ChangeSet } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { Tree, TreeCursor } from '@lezer/common'
import { tokenClassProp, lineClassProp } from './hypermd'
import { highlightColorAt, HIGHLIGHT_COLOR_EMOJI } from './livepreview/widgets'

export type FormatKind = 'bold' | 'italic' | 'code' | 'highlight' | 'strikethrough' | 'comment' | 'math'
export interface FormatSpec { nodeType: string; surroundingChars: string; altSurroundingChars?: string; isBlock?: boolean }

export const FORMATS: Record<FormatKind, FormatSpec> = {
  bold: { nodeType: 'strong', surroundingChars: '**', altSurroundingChars: '__' },
  italic: { nodeType: 'em', surroundingChars: '*', altSurroundingChars: '_' },
  code: { nodeType: 'inline-code', surroundingChars: '`' },
  highlight: { nodeType: 'highlight', surroundingChars: '==' },
  strikethrough: { nodeType: 'strikethrough', surroundingChars: '~~' },
  comment: { nodeType: 'comment', surroundingChars: '%%', isBlock: true },
  math: { nodeType: 'math', surroundingChars: '$' }
}

const words = (s: string | undefined) => new Set((s ?? '').split(' '))
const tokenWords = (c: TreeCursor) => words(c.type.prop(tokenClassProp))
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b)

/** Range with surrounding whitespace trimmed. */
export function trimRange(state: EditorState, r: { from: number; to: number }) {
  let { from, to } = r
  while (from < to && /\s+/.test(state.sliceDoc(from, from + 1))) from++
  while (to > from && /\s+/.test(state.sliceDoc(to - 1, to))) to--
  return { from, to }
}

/** Line contains a table-separator, code block or math block line (formatting is skipped). */
export function isSpecialLine(tree: Tree, line: { from: number; to: number }): boolean {
  let found = false
  tree.iterate({
    from: line.from, to: line.to,
    enter: n => {
      const w = words(n.type.prop(lineClassProp))
      if (w.has('HyperMD-table-2') || w.has('HyperMD-codeblock') || w.has('HyperMD-math')) { found = true; return false }
      return undefined
    }
  })
  return found
}

/** The line's text range after list / quote / task / header markers, trimmed. */
export function lineContentRange(state: EditorState, lineNo: number) {
  const line = state.doc.line(lineNo)
  let from = line.from
  syntaxTree(state).iterate({
    from: line.from, to: line.to,
    enter: n => {
      const w = words(n.type.prop(tokenClassProp))
      if (w.has('hmd-list-indent') || w.has('formatting-quote') || w.has('formatting-list') || w.has('formatting-task') || w.has('formatting-header')) from = Math.min(line.to, n.to)
    }
  })
  return trimRange(state, { from, to: line.to })
}

/** Surrounding chars of `spec` right after (dir 1) / before (dir -1) `pos`. */
export function markerAt(state: EditorState, pos: number, spec: FormatSpec, dir = 1): { from: number; to: number } | null {
  const opts = [spec.surroundingChars]
  if (spec.altSurroundingChars) opts.push(spec.altSurroundingChars)
  for (const s of opts) {
    let from = pos, to = pos
    if (dir === -1) from -= s.length
    else to += s.length
    if (state.sliceDoc(from, to) === s) return { from, to }
  }
  return null
}

/** The formatting element of `kind` around `pos` (side `dir`), incl. its markers. */
export function elementAt(state: EditorState, cursor: TreeCursor, pos: number, dir: -1 | 1, kind: FormatKind): { from: number; to: number } | null {
  const spec = FORMATS[kind]
  const isKind = () => tokenWords(cursor).has(spec.nodeType)
  cursor.moveTo(pos, dir)
  if (!cursor.node.parent || !isKind()) return null
  let from = cursor.from, to = cursor.to
  let edge = cursor.from
  for (;;) {
    if (!spec.isBlock && cursor.to < edge) break
    if (markerAt(state, cursor.from, spec)) from = cursor.from
    if (!isKind()) break
    edge = cursor.from
    if (!cursor.prevSibling()) break
  }
  cursor.moveTo(pos, dir)
  edge = cursor.to
  for (;;) {
    if (!spec.isBlock && cursor.from > edge) break
    if (cursor.from > from && markerAt(state, cursor.to, spec, -1)) { to = cursor.to; break }
    if (!isKind()) break
    to = cursor.to
    edge = cursor.to
    if (!cursor.nextSibling()) break
  }
  return { from, to }
}

export function elementAround(state: EditorState, cursor: TreeCursor, pos: number, kind: FormatKind) {
  return elementAt(state, cursor, pos, -1, kind) ?? elementAt(state, cursor, pos, 1, kind)
}

/** Changes removing the `kind` markers inside `range`. */
export function removeMarkers(state: EditorState, range: { from: number; to: number }, kind: FormatKind): { from: number; to: number; insert: string }[] {
  const spec = FORMATS[kind]
  const out: { from: number; to: number; insert: string }[] = []
  syntaxTree(state).iterate({
    from: range.from, to: range.to,
    enter: n => {
      if (n.to <= range.from) return
      const w = words(n.type.prop(tokenClassProp))
      if (w.has('formatting') && w.has(spec.nodeType)) {
        const m = markerAt(state, n.from, spec)
        if (m) {
          if (kind === 'highlight') m.to = Math.max(m.to, n.to)
          out.push({ ...m, insert: '' })
        }
      }
    }
  })
  return out
}

export interface FormatState {
  headingLevel: number; uniformHeading: boolean
  bold: boolean; italic: boolean; code: boolean; comment: boolean; highlight: boolean; highlightColor: string
  strikethrough: boolean; math: boolean
}

/** Which formats cover the whole (non-marker) content of `range`. */
export function formatStateAt(state: EditorState, range: { from: number; to: number; head: number }): FormatState {
  const tree = syntaxTree(state)
  const c = tree.cursor()
  let active: Partial<Record<FormatKind, string>> = { italic: 'em', code: 'inline-code', comment: 'comment', bold: 'strong', highlight: 'highlight', strikethrough: 'strikethrough', math: 'math' }
  let sawContent = false
  let uniform = true
  let level: number | undefined
  const a = state.doc.lineAt(range.from), b = state.doc.lineAt(range.to)
  const multi = a.number !== b.number
  for (let n = a.number; n <= b.number; n++) {
    const line = state.doc.line(n)
    if ((range.from < line.from || range.to > line.to) && isSpecialLine(tree, line)) continue
    const cr = lineContentRange(state, n)
    if (multi && cr.from === cr.to) continue
    const from = Math.max(cr.from, range.from), to = Math.min(cr.to, range.to)
    c.moveTo(from, -1)
    if (!(c.node.parent && !(c.node.type.prop(lineClassProp) ?? '').includes('table'))) c.moveTo(from, 1)
    let end = c.from
    if (!c.node.parent) active = {}
    for (;;) {
      const cls = c.type.prop(tokenClassProp) || ''
      const w = words(cls)
      for (const k of Object.keys(active) as FormatKind[]) {
        if (!w.has('formatting')) { sawContent = true; if (!w.has(active[k]!)) delete active[k] }
      }
      if (uniform) {
        const m = /\bheader-(\d)\b/.exec(cls)
        const lv = m ? Number(m[1]) : 0
        if (level !== undefined && level !== lv) uniform = false
        level = lv
      }
      if (end < c.from) active = {}
      end = c.to
      if (end >= to || !c.next()) break
    }
    if (end < to) active = {}
  }
  if (!sawContent) active = {}
  let color = ''
  const hl = elementAround(state, c, range.head, 'highlight')
  if (hl) {
    const s = hl.from + 2
    color = highlightColorAt(state.sliceDoc(s, s + 2)).color
  }
  return {
    headingLevel: level ?? 0, uniformHeading: uniform,
    bold: !!active.bold, italic: !!active.italic, code: !!active.code, comment: !!active.comment,
    highlight: !!active.highlight, highlightColor: color, strikethrough: !!active.strikethrough, math: !!active.math
  }
}

/** Merge overlapping ranges (optionally only when `canMerge`). */
export function mergeRanges<T extends { from: number; to: number }>(list: T[], canMerge?: (a: T, b: T) => boolean): T[] {
  const sorted = list.map(r => ({ ...r })).sort((x, y) => x.from - y.from || x.to - y.to)
  const out: T[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to && (!canMerge || canMerge(last, r))) last.to = Math.max(last.to, r.to)
    else out.push(r)
  }
  return out
}

// ---- highlights --------------------------------------------------------------------------------

export interface HighlightElement { from: number; contentFrom: number; textFrom: number; contentTo: number; to: number; color: string; marker: string }

export function highlightsIn(state: EditorState, ranges: { from: number; to: number }[]): HighlightElement[] {
  if (!ranges.length) return []
  const doc = state.doc
  const from = doc.lineAt(Math.min(...ranges.map(r => r.from))).from
  const to = doc.lineAt(Math.max(...ranges.map(r => r.to))).to
  const out: HighlightElement[] = []
  const seen = new Set<string>()
  const tree = syntaxTree(state)
  const marks = '=='
  tree.iterate({
    from, to,
    enter: n => {
      if (!(n.type.prop(tokenClassProp) ?? '').split(' ').includes('formatting-highlight')) return
      const el = elementAt(state, tree.cursor(), n.from, 1, 'highlight')
      if (!el || !ranges.some(r => el.from < r.to && r.from < el.to)) return
      const key = el.from + ':' + el.to
      if (seen.has(key)) return
      seen.add(key)
      if (el.to - el.from < 4 || state.sliceDoc(el.from, el.from + 2) !== marks || state.sliceDoc(el.to - 2, el.to) !== marks) return
      const cFrom = el.from + 2, cTo = el.to - 2
      const c = highlightColorAt(state.sliceDoc(cFrom, Math.min(cTo, cFrom + 2)))
      out.push({ from: el.from, contentFrom: cFrom, textFrom: cFrom + c.length, contentTo: cTo, to: el.to, color: c.color, marker: state.sliceDoc(cFrom, cFrom + c.length) })
    }
  })
  return out
}

export function removeHighlightChanges(els: HighlightElement[]) {
  return els.flatMap(e => [{ from: e.from, to: e.textFrom }, { from: e.contentTo, to: e.to }])
}

/** Changes that (re)highlight `targets` with their colours, merging with existing highlights. */
export function applyHighlightChanges(state: EditorState, targets: { from: number; to: number; color: string }[]): ChangeSet {
  const existing = highlightsIn(state, targets)
  const removal = state.changes(removeHighlightChanges(existing))
  const doc = removal.apply(state.doc)
  const map = (r: { from: number; to: number; color: string }) => ({ from: removal.mapPos(r.from), to: removal.mapPos(r.to), color: r.color })
  let spans = existing.map(e => map({ from: e.textFrom, to: e.contentTo, color: e.color }))
  for (const t of targets.map(map)) {
    const next: typeof spans = []
    for (const s of spans) {
      if (s.from >= t.to || t.from >= s.to) { next.push(s); continue }
      if (s.from < t.from) {
        let cut = t.from
        if (s.color !== t.color) while (s.from < cut && /\s/.test(doc.sliceString(cut - 1, cut))) cut--
        if (s.from < cut) next.push({ ...s, to: cut })
      }
      if (t.to < s.to) {
        let cut = t.to
        if (s.color !== t.color) while (cut < s.to && /\s/.test(doc.sliceString(cut, cut + 1))) cut++
        if (cut < s.to) next.push({ ...s, from: cut })
      }
    }
    next.push({ ...t })
    spans = mergeRanges(next, (a, b) => a.color === b.color)
  }
  const markers: Record<string, string> = {}
  for (const e of existing) if (e.color && !Object.prototype.hasOwnProperty.call(markers, e.color)) markers[e.color] = e.marker
  const inserts: ChangeSpec[] = spans.flatMap(s => {
    const m = s.color ? markers[s.color] ?? HIGHLIGHT_COLOR_EMOJI[s.color] : ''
    return [{ from: s.from, insert: '==' + m }, { from: s.to, insert: '==' }]
  })
  return removal.compose(ChangeSet.of(inserts, doc.length))
}

export { clamp }
