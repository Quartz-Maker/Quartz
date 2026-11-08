// The `Editor` API on CodeMirror 6. Positions are {line, ch} (0-based lines).
import { ChangeSet, EditorSelection, EditorState } from '@codemirror/state'
import type { ChangeSpec, SelectionRange, TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  cursorLineUp, cursorLineDown, cursorCharLeft, cursorCharRight, cursorDocEnd,
  cursorGroupLeft, cursorGroupRight, insertNewlineAndIndent, moveLineUp, moveLineDown, deleteLine, undo, redo
} from '@codemirror/commands'
import { getIndentUnit, indentString, indentUnit, syntaxTree } from '@codemirror/language'
import { countColumn } from '@codemirror/state'
import { tokenClassProp } from './hypermd'
import { LIST_RE } from './livepreview/inline'
import { toggleFold, foldAll, unfoldAll, foldMore, foldLess } from './folding'
import {
  FORMATS, trimRange, isSpecialLine, lineContentRange, markerAt, elementAt, elementAround, removeMarkers, formatStateAt,
  mergeRanges, highlightsIn, removeHighlightChanges, applyHighlightChanges, clamp
} from './markdownFormatting'
import type { FormatKind } from './markdownFormatting'
import { HIGHLIGHT_COLOR_EMOJI } from './livepreview/widgets'

export interface EditorPosition { line: number; ch: number }
export interface EditorRange { from: EditorPosition; to: EditorPosition }
export interface EditorRangeOrCaret { from: EditorPosition; to?: EditorPosition }
export interface EditorChange extends EditorRangeOrCaret { text: string }
export interface EditorSelectionT { anchor: EditorPosition; head: EditorPosition }
export interface EditorSelectionOrCaret { anchor: EditorPosition; head?: EditorPosition }
export interface EditorTransaction {
  replaceSelection?: string
  changes?: EditorChange[]
  selections?: EditorRangeOrCaret[]
  selection?: EditorRangeOrCaret
}

type Doc = EditorState['doc']

export function offsetToPos(doc: Doc, offset: number): EditorPosition {
  const line = doc.lineAt(offset)
  return { line: line.number - 1, ch: offset - line.from }
}
export function posToOffset(doc: Doc, pos: EditorPosition): number {
  if (pos.line < 0) return 0
  const n = pos.line + 1
  if (n > doc.lines) return doc.length
  const line = doc.line(n)
  if (!isFinite(pos.ch)) return line.to
  return pos.ch < 0 ? line.from + Math.max(0, line.length + pos.ch) : line.from + pos.ch
}

/** Quote-depth helper: length of the `>` prefix (plus one following space). */
export function quotePrefixLength(text: string): number {
  const m = text.match(/^\s{0,3}>(\s*)/)
  if (!m) return 0
  const n = m[0].length - m[1].length
  let rest = m[1]
  while (rest.startsWith('    ')) rest = rest.substring(4)
  return rest.startsWith(' ') ? n + 1 : n
}

/** Keep the selection direction of `r` for a new from/to. */
function rangeLike(r: SelectionRange, from: number, to: number) {
  return r.anchor >= r.head ? EditorSelection.range(to, from, r.goalColumn, r.bidiLevel ?? undefined) : EditorSelection.range(from, to, r.goalColumn, r.bidiLevel ?? undefined)
}

// ---- line-based indentation commands (indentMore / indentLess) -----------------------------------

function eachSelectedLine(state: EditorState, fn: (line: { from: number; to: number; text: string; number: number }, changes: ChangeSpec[], range: SelectionRange) => void) {
  let last = -1
  return state.changeByRange(range => {
    const changes: ChangeSpec[] = []
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos)
      if (line.number > last && (range.empty || range.to > line.from)) { fn(line, changes, range); last = line.number }
      pos = line.to + 1
    }
    const set = state.changes(changes)
    return { changes, range: EditorSelection.range(set.mapPos(range.anchor, 1), set.mapPos(range.head, 1)) }
  })
}

const QUOTE_WS = /^[\s>]+/
export function indentMore(view: EditorView): boolean {
  const state = view.state
  if (state.readOnly) return false
  view.dispatch(state.update(eachSelectedLine(state, (line, changes) => {
    let at = line.from
    const m = line.text.match(QUOTE_WS)
    if (m) {
      let i = m[0].lastIndexOf('>')
      if (i !== -1) { if (m[0].charAt(i + 1) === ' ') i++; at = at + i + 1 }
    }
    changes.push({ from: at, insert: state.facet(indentUnit) })
  }), { userEvent: 'input.indent' }))
  return true
}

export function indentLess(view: EditorView): boolean {
  const state = view.state
  if (state.readOnly) return false
  view.dispatch(state.update(eachSelectedLine(state, (line, changes) => {
    const m = line.text.match(QUOTE_WS)
    if (!m) return
    const ws = m[0]
    const gt = ws.indexOf('>')
    if (gt > 0) { changes.push({ from: line.from, to: line.from + gt, insert: '' }); return }
    if (ws === '> ') return
    let last = ws.lastIndexOf('>')
    if (last !== -1 && ws.charAt(last + 1) === ' ') last++
    const start = last + 1
    const rest = ws.substr(start)
    if (!rest) return
    const col = countColumn(rest, state.tabSize)
    const target = indentString(state, Math.max(0, col - getIndentUnit(state)))
    let i = 0
    while (i < rest.length && i < target.length && rest.charCodeAt(i) === target.charCodeAt(i)) i++
    changes.push({ from: line.from + start + i, to: line.from + ws.length, insert: target.slice(i) })
  }), { userEvent: 'delete.dedent' }))
  return true
}

export const editorCommands: Record<string, (view: EditorView) => boolean> = {
  goUp: cursorLineUp, goDown: cursorLineDown, goLeft: cursorCharLeft, goRight: cursorCharRight,
  goStart: v => { v.dispatch(v.state.update({ selection: { anchor: 0 }, scrollIntoView: true })); return true },
  goEnd: cursorDocEnd, goWordLeft: cursorGroupLeft, goWordRight: cursorGroupRight,
  indentMore, indentLess, newlineAndIndent: insertNewlineAndIndent,
  swapLineUp: moveLineUp, swapLineDown: moveLineDown, deleteLine,
  toggleFold, foldAll, unfoldAll: v => unfoldAll(v)
}

/** CM6-backed `Editor`. */
export class Editor {
  cm: EditorView
  /** The view actually receiving input (a table cell editor when one is active). */
  activeCMProvider: () => EditorView
  /** Called by `insertFootnote` / embeds etc.; optional host hooks. */
  host: { inTableCell?: () => boolean; nextFootnoteLabel?: () => string } = {}

  constructor(cm: EditorView, activeCM?: () => EditorView) {
    this.cm = cm
    this.activeCMProvider = activeCM ?? (() => this.cm)
  }

  get activeCM() { return this.activeCMProvider() }
  get containerEl() { return this.cm.dom }

  getDoc() { return this }
  refresh() { this.cm.requestMeasure() }
  getValue() { return this.cm.state.doc.toString() }
  setValue(text: string) { this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: text } }) }
  getLine(n: number) { const d = this.cm.state.doc; return n >= d.lines ? '' : d.line(n + 1).text }
  setLine(n: number, text: string) { this.replaceRange(text, { line: n, ch: 0 }, { line: n, ch: this.getLine(n).length }) }
  lineCount() { return this.cm.state.doc.lines }
  lastLine() { return this.cm.state.doc.lines - 1 }
  getSelection() { const m = this.cm.state.selection.main; return this.cm.state.doc.sliceString(m.from, m.to) }
  somethingSelected() { return !!this.getSelection() }
  getRange(from: EditorPosition, to: EditorPosition) { const d = this.cm.state.doc; return d.sliceString(posToOffset(d, from), posToOffset(d, to)) }
  replaceSelection(text: string, origin?: string) { const tr = this.cm.state.replaceSelection(text); (tr as any).userEvent = origin; this.cm.dispatch(tr) }
  replaceRange(text: string, from: EditorPosition, to?: EditorPosition, origin?: string) {
    const d = this.cm.state.doc
    const a = posToOffset(d, from), b = to ? posToOffset(d, to) : a
    this.cm.dispatch({ changes: { from: a, to: b, insert: text }, scrollIntoView: true, userEvent: origin })
  }
  getCursor(side: 'from' | 'to' | 'head' | 'anchor' = 'head'): EditorPosition {
    const m = this.cm.state.selection.main, d = this.cm.state.doc
    return offsetToPos(d, side === 'from' ? m.from : side === 'to' ? m.to : side === 'anchor' ? m.anchor : m.head)
  }
  setCursor(pos: EditorPosition | number, ch?: number) {
    return typeof pos === 'number' ? this.setSelection({ line: pos, ch: ch ?? 0 }) : this.setSelection(pos)
  }
  listSelections(): EditorSelectionT[] {
    const d = this.cm.state.doc
    return this.cm.state.selection.ranges.map(r => ({ anchor: offsetToPos(d, r.anchor), head: offsetToPos(d, r.head) }))
  }
  setSelection(anchor: EditorPosition, head?: EditorPosition) {
    const d = this.cm.state.doc
    const a = posToOffset(d, anchor)
    this.cm.dispatch({ selection: { anchor: a, head: head ? posToOffset(d, head) : a }, scrollIntoView: true })
  }
  setSelections(ranges: EditorSelectionOrCaret[], main?: number) {
    const d = this.cm.state.doc
    this.cm.dispatch({
      selection: EditorSelection.create(ranges.map(r => { const a = posToOffset(d, r.anchor); return EditorSelection.range(a, r.head ? posToOffset(d, r.head) : a) }), main),
      scrollIntoView: true
    })
  }
  exec(command: string) { editorCommands[command]?.(this.activeCM) }
  focus() { this.activeCM.focus() }
  blur() { this.activeCM.contentDOM.blur() }
  coordsAtPos(pos: EditorPosition) { return this.cm.coordsAtPos(posToOffset(this.cm.state.doc, pos)) }
  hasFocus() { return this.activeCM.hasFocus }
  getScrollInfo() {
    const s = this.cm.scrollDOM
    return { top: s.scrollTop, left: s.scrollLeft, clientHeight: s.clientHeight, clientWidth: s.clientWidth, height: s.offsetHeight, width: s.offsetWidth }
  }
  scrollTo(x?: number | null, y?: number | null) {
    const s = this.cm.scrollDOM
    s.scroll(x ?? s.scrollLeft, y ?? s.scrollTop)
  }
  scrollIntoView(range: EditorRange, center?: boolean) {
    const d = this.cm.state.doc
    this.cm.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(posToOffset(d, range.from), posToOffset(d, range.to)), { y: center ? 'center' : 'nearest' }) })
  }
  transaction(tx: EditorTransaction, origin?: string) {
    const cm = this.cm
    let doc = cm.state.doc
    const spec: TransactionSpec & { changes?: any } = { scrollIntoView: true }
    const changes: any[] = []
    if (typeof tx.replaceSelection === 'string') {
      const r = cm.state.replaceSelection(tx.replaceSelection)
      changes.push(r.changes)
      spec.selection = r.selection
      spec.effects = r.effects
    }
    if (tx.changes) for (const c of tx.changes) {
      const a = posToOffset(doc, c.from)
      changes.push({ from: a, to: c.to ? posToOffset(doc, c.to) : a, insert: c.text })
    }
    if (changes.length) {
      const set = ChangeSet.of(changes, doc.length, cm.state.lineBreak)
      spec.changes = [set]
      if (tx.selections || tx.selection) doc = set.apply(doc)
    } else spec.changes = changes
    if (tx.selections) {
      spec.selection = EditorSelection.create(tx.selections.map(s => { const a = posToOffset(doc, s.from); return EditorSelection.range(a, s.to ? posToOffset(doc, s.to) : a) }))
    } else if (tx.selection) {
      const a = posToOffset(doc, tx.selection.from)
      spec.selection = { anchor: a, head: tx.selection.to ? posToOffset(doc, tx.selection.to) : a }
    }
    spec.userEvent = origin
    cm.dispatch(spec)
  }
  wordAt(pos: EditorPosition): EditorRange | null {
    const d = this.cm.state.doc
    const w = this.cm.state.wordAt(posToOffset(d, pos))
    return w ? { from: offsetToPos(d, w.from), to: offsetToPos(d, w.to) } : null
  }
  posToOffset(pos: EditorPosition) { return posToOffset(this.cm.state.doc, pos) }
  offsetToPos(offset: number) { return offsetToPos(this.cm.state.doc, offset) }
  undo() { undo(this.cm) }
  redo() { redo(this.cm) }

  /** Apply `write` to every selected line (processLines). */
  processLines<T>(read: (line: number, text: string) => T | null, write: (line: number, text: string, value: T | null) => EditorChange | void | null, ignoreEmpty = true) {
    const sels = this.listSelections()
    const lines = Array.from(new Set(sels.flatMap(s => {
      const out: number[] = []
      for (let l = Math.min(s.anchor.line, s.head.line); l <= Math.max(s.anchor.line, s.head.line); l++) out.push(l)
      return out
    }))).sort((a, b) => a - b)
    const values: (T | null)[] = []
    for (const l of lines) {
      const text = this.getLine(l)
      if (ignoreEmpty && lines.length > 1 && !text.trim()) values.push(null)
      else values.push(read(l, text))
    }
    const changes: EditorChange[] = []
    for (let i = 0; i < lines.length; i++) {
      if (ignoreEmpty && values[i] === null) continue
      const c = write(lines[i], this.getLine(lines[i]), values[i])
      if (c) changes.push(c)
    }
    if (!changes.length) return
    if (sels.length === 1) {
      const c = changes[0], s = sels[0], anchor = { ...s.anchor }
      if (anchor.ch === 0 && anchor.line === s.head.line && anchor.ch === s.head.ch && anchor.line === c.from.line) {
        const delta = c.text.length - (c.to ? c.to.ch - c.from.ch : 0)
        anchor.ch += delta
        if (anchor.ch < 0) anchor.ch = 0
        this.transaction({ changes, selection: { from: anchor } })
        return
      }
    }
    this.transaction({ changes })
  }

  setHeading(level: number) {
    this.processLines((_l, text) => text.match(/^([>\s]*)(#{1,6} )?(.*)/), (l, text, m) => {
      const marks = level === 0 ? '' : '#'.repeat(level) + ' '
      return { from: { line: l, ch: m![1].length }, to: { line: l, ch: text.length - m![3].length }, text: marks }
    })
  }
  toggleBlockquote() {
    let add = false
    this.processLines((_l, text) => { const n = quotePrefixLength(text); if (n === 0) add = true; return n }, (l, _t, n) => {
      if (add && n === 0) return { from: { line: l, ch: 0 }, text: '> ' }
      if (add) return
      return { from: { line: l, ch: 0 }, to: { line: l, ch: n! }, text: '' }
    }, false)
  }
  toggleBulletList() {
    let add = false
    this.processLines((_l, text) => { const m = text.match(LIST_RE)!; if (!m[3] || m[4] || m[6]) add = true; return m }, (l, _t, m) =>
      m ? { from: { line: l, ch: 0 }, to: { line: l, ch: m[0].length }, text: m[1] + (add ? '- ' : '') } : null)
  }
  toggleNumberList() {
    let add = false
    this.processLines((_l, text) => { const m = text.match(LIST_RE)!; if (!m[4]) add = true; return m }, (l, _t, m) =>
      m ? { from: { line: l, ch: 0 }, to: { line: l, ch: m[0].length }, text: m[1] + (add ? '1. ' : '') } : null)
  }
  toggleCheckList(cycle?: boolean) {
    let mode = 3
    this.processLines((_l, text) => {
      const m = text.match(LIST_RE)!
      if (mode > 2 && m[6] === ' ') mode = 2
      if (mode > 1 && !m[6]) mode = 1
      if (cycle && mode > 0 && !m[3]) mode = 0
      return m
    }, (l, text, m) => {
      if (!m) return null
      const prefix = m[1] + (m[3] || '- ')
      const c = { from: { line: l, ch: 0 }, to: { line: l, ch: m[0].length }, text: text.substr(0, m[0].length) }
      c.text = prefix
      if (mode === 1) { if (!m[6]) c.text = prefix + '[ ] ' }
      else if (mode === 2) c.text = prefix + '[x] '
      else if (mode === 3) c.text = cycle ? prefix : prefix + '[ ] '
      return c
    })
  }
  insertCallout() {
    const from = this.getCursor('from'), to = this.getCursor('to')
    const sameish = from.line === to.line && from.ch === to.ch
    if (!sameish || this.getLine(from.line).substring(0, from.ch).trim()) {
      const changes: EditorChange[] = []
      let text = '> [!NOTE]\n> '
      const sel = { from: { line: from.line, ch: 4 }, to: { line: from.line, ch: 8 } }
      if (from.line > 0 && this.getLine(from.line - 1)) { text = '\n' + text; sel.from.line += 1; sel.to.line += 1 }
      changes.push({ from: { line: from.line, ch: 0 }, text })
      for (let l = from.line + 1; l <= to.line; l++) changes.push({ from: { line: l, ch: 0 }, text: '> ' })
      if (to.line < this.lineCount() - 1 && this.getLine(to.line + 1)) changes.push({ from: { line: to.line + 1, ch: 0 }, text: '\n' })
      this.transaction({ changes, selection: sel })
    } else {
      this.transaction({ changes: [{ from, to, text: '\n> [!NOTE] Title\n> Contents\n' }], selection: { from: { line: from.line + 1, ch: 4 }, to: { line: from.line + 1, ch: 8 } } })
    }
  }
  insertCodeblock() { this.insertBlock('```', '```') }
  insertMathBlock() { this.insertBlock('$$', '$$') }
  indentList() { this.exec('indentMore') }
  unindentList() { this.exec('indentLess') }

  newlineAndIndentContinueMarkdownList() {
    const changes: EditorChange[] = []
    const handle = (s: EditorSelectionT): boolean => {
      const h = s.head
      if (h.line !== s.anchor.line || h.ch !== s.anchor.ch) return false
      const text = this.getLine(h.line)
      const m = LIST_RE.exec(text)
      if (!m || !m[0]) return false
      let [whole, indent, marker, bullet, num, delim, task] = m as unknown as string[]
      const len = whole.length
      if (h.ch < whole.length || (!marker && !indent)) return false
      if (!marker) {
        for (let l = h.line - 1; l >= 0; l--) {
          const g = LIST_RE.exec(this.getLine(l))!
          if (g[2] && g[0].length === len) { [whole, indent, marker, bullet, num, delim, task] = g as unknown as string[]; break }
          if (g[0].length < len) break
        }
      }
      if (text.substr(whole.length).trim() === '') {
        if (!indent) { changes.push({ text: '', from: { line: h.line, ch: 0 }, to: h }); return true }
        if (indent.endsWith('>') || indent.endsWith('> ')) {
          if (marker) { changes.push({ text: '', from: { line: h.line, ch: indent.length }, to: h }); return true }
          const cut = indent.endsWith('>') ? 1 : 2
          if (h.line > 0 && this.getLine(h.line - 1) === indent) {
            changes.push({ text: '', from: { line: h.line - 1, ch: indent.length - cut }, to: { line: h.line - 1, ch: indent.length } },
              { text: '', from: { line: h.line, ch: indent.length - cut }, to: { line: h.line, ch: indent.length } })
            return true
          }
          changes.push({ text: '\n' + indent.substr(0, indent.length - cut), from: { line: h.line, ch: indent.length - cut }, to: { line: h.line, ch: indent.length } })
          return true
        }
        if (indent.endsWith('\t')) { changes.push({ text: '', from: { line: h.line, ch: indent.length - 1 }, to: { line: h.line, ch: indent.length } }); return true }
        let b = 0
        while (b < 4 && indent.charAt(indent.length - b - 1) === ' ') b++
        if (b > 0) { changes.push({ text: '', from: { line: h.line, ch: indent.length - b }, to: { line: h.line, ch: indent.length } }); return true }
        changes.push({ text: '', from: { line: h.line, ch: 0 }, to: { line: h.line, ch: indent.length } })
        return true
      }
      if (!marker) { changes.push({ text: text.charAt(h.ch - 1) + '\n' + indent, from: { line: h.line, ch: h.ch - 1 }, to: h }); return true }
      let next = bullet
      if (num) next = parseInt(num, 10) + 1 + delim
      if (task) next += '[ ] '
      const after = LIST_RE.exec(text.substring(h.ch))
      if (after && after[3]) next = ''
      changes.push({ text: text.charAt(h.ch - 1) + '\n' + indent + next, from: { line: h.line, ch: h.ch - 1 }, to: h })
      if (after && after[1]) changes.push({ text: '', from: h, to: { line: h.line, ch: h.ch + after[1].length } })
      return true
    }
    for (const s of this.listSelections()) if (!handle(s)) { this.exec('newlineAndIndent'); return }
    this.transaction({ changes }, 'input.type')
  }

  newlineAndIndentOnly() {
    const changes: EditorChange[] = []
    const handle = (s: EditorSelectionT): boolean => {
      const h = s.head
      if (h.line !== s.anchor.line || h.ch !== s.anchor.ch) return false
      const text = this.getLine(h.line)
      const m = LIST_RE.exec(text)
      if (!m || !m[0] || h.ch < m[0].length) return false
      changes.push({ text: text.charAt(h.ch - 1) + '\n' + m[1] + (m[2] ? m[2].replace(/\t/g, '    ').replace(/./g, ' ') : ''), from: { line: h.line, ch: h.ch - 1 }, to: h })
      return true
    }
    for (const s of this.listSelections()) if (!handle(s)) { this.newlineOnly(); return }
    this.transaction({ changes })
  }
  newlineOnly() { this.transaction({ replaceSelection: '\n' }) }

  /** CJK `【【` / `】】` → `[[` / `]]`. */
  expandText() {
    const a = this.getCursor('anchor'), h = this.getCursor('head')
    if (a.line !== h.line || a.ch !== h.ch) return
    const before = this.getLine(a.line).substr(0, a.ch)
    const rules: { regex: RegExp; replace: (m: RegExpMatchArray) => string }[] = [
      { regex: /(！)?【【$/, replace: m => (m[1] ? '![[' : '[[') }, { regex: /】】$/, replace: () => ']]' }, { regex: /【【$/, replace: () => '[[' }
    ]
    for (const r of rules) {
      const m = before.match(r.regex)
      if (m) { this.replaceRange(r.replace(m), { line: a.line, ch: a.ch - m[0].length }, a); break }
    }
  }

  foldMore() { foldMore(this.cm) }
  foldLess() { foldLess(this.cm) }

  insertHorizontalRule() {
    const state = this.cm.state
    this.cm.dispatch(state.changeByRange(r => {
      const nl = offsetToPos(state.doc, r.from).ch > 0 ? 2 : 1
      const text = '\n'.repeat(nl) + '---\n'
      return { range: EditorSelection.cursor(r.from + text.length), changes: [{ from: r.from, to: r.to, insert: text }] }
    }))
  }
  insertBlock(open: string, close: string) {
    const { doc, selection } = this.cm.state
    const lines = selection.ranges.map(r => EditorSelection.range(doc.lineAt(r.from).from, doc.lineAt(r.to).to))
    const changes: ChangeSpec[] = []
    for (const r of lines) { changes.push({ insert: open + '\n', from: r.from }); changes.push({ insert: '\n' + close, from: r.to }) }
    const shift = open.length + 1
    this.cm.dispatch({ changes, selection: EditorSelection.create(selection.ranges.map(r => EditorSelection.range(r.anchor + shift, r.head + shift))) })
  }
  insertMarkdownLink() {
    const state = this.cm.state
    const tr = state.changeByRange(r => {
      const text = state.sliceDoc(r.from, r.to)
      const at = r.empty ? 1 : 1 + text.length + 2
      return { changes: { from: r.from, to: r.to, insert: '[' + text + ']()' }, range: rangeLike(r, r.from + at, r.from + at) }
    })
    this.cm.dispatch({ ...tr, userEvent: 'input.autocomplete' })
  }
  triggerWikilink(embed?: boolean) {
    const state = this.cm.state
    const tr = state.changeByRange(r => {
      const open = embed ? '![[' : '[['
      const text = state.sliceDoc(r.from, r.to)
      const at = r.from + open.length + text.length
      return { changes: { from: r.from, to: r.to, insert: open + text + ']]' }, range: rangeLike(r, at, at) }
    })
    this.cm.dispatch({ ...tr, userEvent: 'input.autocomplete' })
  }
  clearMarkdownFormatting() {
    const changes: ChangeSpec[] = []
    for (const r of this.cm.state.selection.ranges) {
      if (r.empty) continue
      syntaxTree(this.cm.state).iterate({
        from: r.from, to: r.to,
        enter: n => { if ((n.type.prop(tokenClassProp) ?? '').split(' ').includes('formatting')) changes.push({ from: n.from, to: n.to, insert: '' }) }
      })
    }
    this.cm.dispatch({ changes })
  }
  get inTableCell() { return !!this.host.inTableCell?.() }

  insertTable() {
    const cm = this.cm
    let at = cm.state.selection.main.anchor
    const line = cm.state.doc.lineAt(at)
    let nl = '\n'
    if (line.text.length) { at = line.to; nl = '\n\n' }
    cm.dispatch({ changes: [{ from: at, insert: nl + '|     |     |\n| --- | --- |\n|     |     |\n' }] })
    cm.dispatch({ selection: { anchor: at + nl.length + 1 } })
  }

  toggleMarkdownFormatting(kind: FormatKind) {
    const cm = this.cm
    const state = cm.state
    const tree = syntaxTree(state)
    const cursor = tree.cursor()
    const spec = FORMATS[kind]
    let shift = 0
    const sels: SelectionRange[] = []
    let all: ChangeSpec[] = []
    const ranges = state.selection.ranges
    const allowEmpty = true
    const active = formatStateAt(state, ranges[0])[kind]
    for (const range of ranges) {
      let { from, to } = trimRange(state, range)
      const local: { from: number; to: number; insert: string }[] = []
      const mapped = (a: number, b: number, extra = 0) => {
        const collapsed = a === b
        let da = shift, db = shift
        for (const c of local) {
          const d = c.from - c.to + c.insert.length
          if (c.to <= a) da += d
          if ((d < 0 && c.to <= b) || c.to < b) db += d
          shift += d
        }
        const na = a + da + extra
        const nb = collapsed ? na : b + db + extra
        return range.head >= range.anchor ? EditorSelection.range(na, nb) : EditorSelection.range(nb, na)
      }
      if (active) {
        if (range.empty) {
          const m = markerAt(state, from, spec)
          if (m) { sels.push(mapped(from, from, m.to - m.from)); continue }
        }
        const el = elementAt(state, cursor, from, 1, kind) ?? elementAt(state, cursor, from, -1, kind) ?? { from, to }
        local.push(...removeMarkers(state, el, kind))
        sels.push(mapped(from, Math.min(to, el.to)))
      } else {
        let target = { from, to }
        if (range.empty) {
          const w = state.wordAt(from)
          if (w) { from = w.from; to = w.to; target = { from, to } }
        } else {
          target.from = elementAt(state, cursor, from, 1, kind)?.from ?? from
          target.to = elementAt(state, cursor, to, -1, kind)?.to ?? to
        }
        const a = state.doc.lineAt(range.from), b = state.doc.lineAt(range.to)
        for (let n = a.number; n <= b.number; n++) {
          let s = target.from, e = target.to
          const line = state.doc.line(n)
          if ((range.from < line.from || range.to > line.to) && isSpecialLine(tree, line)) continue
          if (!range.empty) {
            const cr = lineContentRange(state, n)
            s = clamp(cr.from, target.from, target.to)
            e = clamp(cr.to, target.from, target.to)
          }
          if ((allowEmpty && range.empty) || s !== e) {
            local.push(...removeMarkers(state, { from: s, to: e }, kind))
            local.push({ from: s, to: s, insert: spec.surroundingChars })
            local.push({ from: e, to: e, insert: spec.surroundingChars })
          }
        }
        if (range.empty && allowEmpty) sels.push(mapped(range.from, range.from, from === to ? -spec.surroundingChars.length : 0))
        else sels.push(mapped(from, to))
      }
      all = all.concat(local)
    }
    cm.dispatch({ changes: all, selection: sels.length ? EditorSelection.create(sels) : undefined, userEvent: 'input.type' })
  }

  toggleComment() {
    const cm = this.cm
    const cursor = syntaxTree(cm.state).cursor()
    const marks = FORMATS.comment.surroundingChars
    const tr = cm.state.changeByRange(range => {
      const st = formatStateAt(cm.state, range)
      let changes: { from: number; to: number; insert: string }[]
      let r = range
      if (st.comment) {
        const el = elementAround(cm.state, cursor, r.from, 'comment') ?? { from: r.from, to: r.to }
        changes = removeMarkers(cm.state, el, 'comment')
      } else {
        let t = { from: r.from, to: r.to }
        if (r.empty) { r = (cm.state.wordAt(r.from) as SelectionRange | null) ?? r; t = { from: r.from, to: r.to } }
        else {
          t.from = elementAt(cm.state, cursor, r.from, 1, 'comment')?.from ?? r.from
          t.to = elementAt(cm.state, cursor, r.to, -1, 'comment')?.to ?? r.to
        }
        changes = removeMarkers(cm.state, t, 'comment')
        changes.push({ from: t.from, to: t.from, insert: marks }, { from: t.to, to: t.to, insert: marks })
      }
      let next = r.map(ChangeSet.of(changes, cm.state.doc.length))
      if (!st.comment && next.empty) next = EditorSelection.cursor(next.anchor + marks.length, next.assoc, next.bidiLevel ?? undefined, next.goalColumn)
      return { range: next, changes }
    })
    cm.dispatch(tr)
  }

  toggleHighlight(color?: string) {
    const cm = this.cm
    const ranges = this.highlightSelectionRanges()
    if (!ranges.length) return
    const existing = highlightsIn(cm.state, ranges)
    if ((color === undefined || existing.every(e => e.color === color)) && ranges.every(r => {
      let covered = r.from
      for (const e of existing) { if (e.from > covered) break; covered = Math.max(covered, e.to) }
      return covered > r.from && covered >= r.to
    })) {
      cm.dispatch({ changes: removeHighlightChanges(existing), userEvent: 'input.type' })
      if (!cm.hasFocus) cm.focus()
      return
    }
    const colorOf = (r: { from: number; to: number }) => {
      const hits = existing.filter(e => e.textFrom < r.to && r.from < e.contentTo)
      const c = hits[0]?.color ?? ''
      return hits.every(e => e.color === c) ? c : ''
    }
    const targets = ranges.map(r => ({ ...r, color: color ?? colorOf(r) }))
    const changes = applyHighlightChanges(cm.state, targets)
    let selection: EditorSelection | undefined
    if (existing.length === 0 && ranges.length === 1 && ranges[0].from === ranges[0].to) {
      const m = targets[0].color ? HIGHLIGHT_COLOR_EMOJI[targets[0].color] : ''
      selection = EditorSelection.single(ranges[0].from + 2 + m.length)
    }
    cm.dispatch({ changes, selection, userEvent: 'input.type' })
    if (!cm.hasFocus) cm.focus()
  }

  private highlightSelectionRanges(): { from: number; to: number }[] {
    const state = this.cm.state
    const tree = syntaxTree(state)
    const cursor = tree.cursor()
    const out: { from: number; to: number }[] = []
    for (const r of state.selection.ranges) {
      const { from, to } = trimRange(state, r)
      if (r.empty) {
        const el = elementAround(state, cursor, r.from, 'highlight')
        if (el) { out.push(el); continue }
        const w = state.wordAt(from)
        out.push(w ?? { from, to })
      } else {
        const a = state.doc.lineAt(r.from), b = state.doc.lineAt(r.to)
        for (let n = a.number; n <= b.number; n++) {
          const line = state.doc.line(n)
          if ((r.from < line.from || r.to > line.to) && isSpecialLine(tree, line)) continue
          const cr = lineContentRange(state, n)
          const s = clamp(cr.from, from, to), e = clamp(cr.to, from, to)
          if (s !== e) out.push({ from: s, to: e })
        }
      }
    }
    return mergeRanges(out)
  }

  /** `[^n]` at the caret plus a definition at the end of the note. */
  insertFootnote() {
    const cm = this.cm
    const label = '[^' + (this.host.nextFootnoteLabel?.() ?? nextFootnoteNumber(cm.state.doc.toString())) + ']'
    const { from, to } = cm.state.selection.main
    const changes: ChangeSpec[] = [{ from, insert: label }]
    const doc = cm.state.doc
    const trailing = doc.slice(to).toString().match(/\n*$/)![0].length
    changes.push({ from: doc.length, insert: '\n'.repeat(2 - Math.min(trailing, 2)) + label + ': \n' })
    cm.dispatch({ changes, selection: EditorSelection.cursor(from + label.length) })
  }
}

function nextFootnoteNumber(text: string): number {
  let max = 0
  for (const m of text.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, parseInt(m[1], 10))
  return max + 1
}
