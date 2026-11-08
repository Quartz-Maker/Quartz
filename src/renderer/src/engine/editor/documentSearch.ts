// Editor backend of the document search bar: the current match is decorated with `.obsidian-search-match-highlight`
// and scrolled into view (the selection is left alone); Find all selects every match.
import { EditorSelection, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { findAllPlain, type SearchBackend } from '../ui/DocumentSearch'

const setMatch = StateEffect.define<{ from: number; to: number } | null>()
const matchMark = Decoration.mark({ class: 'obsidian-search-match-highlight' })

export const searchMatchHighlight: Extension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) if (e.is(setMatch)) deco = e.value ? Decoration.set([matchMark.range(e.value.from, e.value.to)]) : Decoration.none
    return deco
  },
  provide: f => EditorView.decorations.from(f)
})

export function editorSearchBackend(view: EditorView): SearchBackend {
  let query = ''
  let matches: number[] = []
  const range = (i: number) => ({ from: matches[i], to: matches[i] + query.length })
  return {
    find(q) {
      query = q
      matches = findAllPlain(view.state.doc.toString(), q)
      const head = view.state.selection.main.from
      const at = matches.findIndex(m => m >= head)
      return { count: matches.length, current: matches.length ? (at === -1 ? 0 : at) : -1 }
    },
    setCurrent(i) {
      const r = range(i)
      view.dispatch({ effects: [setMatch.of(r), EditorView.scrollIntoView(r.from, { y: 'center' })] })
    },
    clear() {
      view.dispatch({ effects: setMatch.of(null) })
    },
    findAll() {
      if (!matches.length) return
      view.dispatch({ selection: EditorSelection.create(matches.map((_, i) => EditorSelection.range(range(i).from, range(i).to))) })
      view.focus()
    },
    replace(i, text) {
      const r = range(i)
      view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
    },
    replaceAll(text) {
      view.dispatch({ changes: matches.map((_, i) => ({ ...range(i), insert: text })) })
    },
    focusBack() {
      view.focus()
    }
  }
}
