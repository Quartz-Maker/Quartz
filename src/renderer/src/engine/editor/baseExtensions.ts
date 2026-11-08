// Shared base editor extensions:
// exception sink, history, multiple selections, rectangular selection (Alt+Shift drag / middle
// drag off Linux), drawSelection, line wrapping, per-line text direction, indent-on-input, the
// token-class plugin, the search highlight field, `cm-active` line classes, selection wrapping for
// `= ~ $ %`, triple-click line selection, Alt+click adds a cursor, the spellcheck-off facet, the
// Home/End/Alt-Arrow keymap + default + history keymaps + Mod-Shift-z redo, the indentation service
// and a compositionend re-dispatch.
import { EditorSelection, EditorState, RangeSetBuilder } from '@codemirror/state'
import type { Extension, SelectionRange } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, rectangularSelection } from '@codemirror/view'
import { secondaryCursors } from './secondaryCursors'
import { searchMatchHighlight } from './documentSearch'
import type { DecorationSet, KeyBinding, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands'
import { indentOnInput, indentService, syntaxTree } from '@codemirror/language'
import { hypermdLanguage, tokenClassPlugin, defaultSpellcheckOff, lineClassProp } from './hypermd'
import { searchMatchField } from './livepreview/state'
import { LIST_RE } from './livepreview/inline'
import { withoutAppHotkeys } from '../keymap/cmFilter'

const isLinux = typeof navigator !== 'undefined' && /Linux/.test(navigator.platform)
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

// ---- `cm-active` line class ------------------------------------------------------------------
const activeLineDeco = Decoration.line({ attributes: { class: 'cm-active' } })
export const activeLineClass = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.get(view) }
  update(u: ViewUpdate) { if (u.docChanged || u.selectionSet) this.decorations = this.get(u.view) }
  get(view: EditorView) {
    let last = -1
    const b: { from: number }[] = []
    for (const r of view.state.selection.ranges) {
      const block = view.lineBlockAt(r.head)
      if (block.from > last) { b.push({ from: block.from }); last = block.from }
    }
    b.sort((x, y) => x.from - y.from)
    const builder = new RangeSetBuilder<Decoration>()
    for (const x of b) builder.add(x.from, x.from, activeLineDeco)
    return builder.finish()
  }
}, { decorations: v => v.decorations })

// ---- wrap selection with = ~ $ % -----------------------------------------------------------------
export const WRAP_CHARS = ['=', '~', '$', '%']
export const wrapSelectionInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing || view.state.readOnly) return false
  const main = view.state.selection.main
  if (text.length > 2 || (text.length === 2 && text.codePointAt(0)! < 0x10000) || from !== main.from || to !== main.to) return false
  if (!WRAP_CHARS.includes(text)) return false
  const state = view.state
  let empty: SelectionRange | null = null
  const tr = state.changeByRange(r => r.empty
    ? { range: (empty = r) }
    : { changes: [{ insert: text, from: r.from }, { insert: text, from: r.to }], range: EditorSelection.range(r.anchor + text.length, r.head + text.length) })
  if (empty) return false
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.type' }))
  return true
})

// ---- triple click selects whole lines --------------------------------------------------------
const tripleClick = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.detail !== 3 || event.button !== 0) return null
  let start = view.posAtCoords(event)
  if (start == null) return null
  let sel = view.state.selection
  return {
    get(ev, extend, multiple) {
      const pos = view.posAtCoords(ev)
      if (pos == null) return sel
      const s = extend ? sel.main.anchor : start!
      const a = view.state.doc.lineAt(s), b = view.state.doc.lineAt(pos)
      const range = pos >= s ? EditorSelection.range(a.from, b.to) : EditorSelection.range(a.to, b.from)
      return multiple ? sel.addRange(range) : EditorSelection.create([range])
    },
    update(u) { start = u.changes.mapPos(start!); sel = sel.map(u.changes) }
  }
})

// ---- smart Home / End ------------------------------------------------------------------------------
function inTable(state: EditorState, from: number, to: number) {
  let found = false
  syntaxTree(state).iterate({ from, to, enter: n => { const c = n.type.prop(lineClassProp); if (c && c.includes('HyperMD-table')) { found = true; return false } return undefined } })
  return found
}
function lineBoundary(view: EditorView, r: SelectionRange, forward: boolean, includeWrap: boolean) {
  const m = view.moveToLineBoundary(r, forward, includeWrap)
  return m.head === r.head ? view.moveToLineBoundary(r, forward, false) : m
}
const home = (extend: boolean) => (view: EditorView) => {
  const { doc, selection } = view.state
  const ranges = selection.ranges.map(r => {
    const block = view.lineBlockAt(r.head)
    let target = lineBoundary(view, r, false, !inTable(view.state, r.from, r.to))
    const m = LIST_RE.exec(doc.sliceString(block.from, block.to))
    if (m && m[0] && target.head <= block.from + m[0].length) {
      const after = block.from + (m[1] || '').length + (m[2] || '').length
      target = EditorSelection.cursor(after < r.head ? after : block.from)
    }
    return extend ? EditorSelection.range(r.anchor, target.head, target.goalColumn) : target
  })
  view.dispatch({ selection: EditorSelection.create(ranges, selection.mainIndex), scrollIntoView: true })
  return true
}
const end = (extend: boolean) => (view: EditorView) => {
  const sel = view.state.selection
  const ranges = sel.ranges.map(r => {
    const t = lineBoundary(view, r, true, !inTable(view.state, r.from, r.to))
    return extend ? EditorSelection.range(r.anchor, t.head, t.goalColumn) : t
  })
  view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), scrollIntoView: true })
  return true
}
const altVertical = (extend: boolean, down: boolean) => (view: EditorView) => {
  const { doc, selection } = view.state
  const ranges = selection.ranges.map(r => {
    const block = view.lineBlockAt(r.head)
    let pos = down ? block.to : block.from
    if (pos === r.head) {
      const n = pos + (down ? 1 : -1)
      if (n >= 0 && n <= doc.length) { const b = view.lineBlockAt(n); pos = down ? b.to : b.from }
    }
    return extend ? EditorSelection.range(r.anchor, pos) : EditorSelection.cursor(pos)
  })
  view.dispatch({ selection: EditorSelection.create(ranges, selection.mainIndex), scrollIntoView: true, userEvent: 'select' })
  return true
}

export const baseKeymap: KeyBinding[] = [
  { key: 'Home', run: home(false), shift: home(true), preventDefault: true },
  { mac: 'Cmd-ArrowLeft', run: home(false), shift: home(true), preventDefault: true },
  { key: 'End', run: end(false), shift: end(true), preventDefault: true },
  { mac: 'Cmd-ArrowRight', run: end(false), shift: end(true), preventDefault: true },
  { mac: 'Alt-ArrowUp', run: altVertical(false, false), shift: altVertical(true, false), preventDefault: true },
  { mac: 'Alt-ArrowDown', run: altVertical(false, true), shift: altVertical(true, true), preventDefault: true },
  ...defaultKeymap,
  ...historyKeymap,
  { key: 'Mod-Shift-z', run: redo, preventDefault: true }
]

/** The base extension list shared by every markdown editor. */
export function quartzBaseExtensions(): Extension[] {
  return [
    EditorView.exceptionSink.of(console.error),
    secondaryCursors(),
    searchMatchHighlight,
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection({ eventFilter: e => (e.button === 0 && e.altKey && e.shiftKey) || (!isLinux && e.button === 1) }),
    history(),
    EditorState.phrases.of({ 'folded code': '' }),
    EditorView.lineWrapping,
    EditorView.perLineTextDirection.of(true),
    indentOnInput(),
    tokenClassPlugin,
    searchMatchField,
    activeLineClass,
    wrapSelectionInput,
    tripleClick,
    EditorView.clickAddsSelectionRange.of(e => e.altKey && !e.ctrlKey && !e.metaKey),
    defaultSpellcheckOff,
    keymap.of(withoutAppHotkeys(baseKeymap)),
    indentService.of((cx, pos) => {
      const m = cx.state.doc.lineAt(pos).text.match(/^\s*/)
      return m ? cx.countColumn(m[0]) : null
    }),
    EditorView.domEventHandlers({ compositionend: (_e, view) => { setTimeout(() => view.dispatch({}), 100) } })
  ]
}

/** The markdown language as the MarkdownView adds it (local extension). */
export const markdownLanguage = hypermdLanguage
export { isMac }
