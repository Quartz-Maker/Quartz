// Editor folding: fold indicator, unfold-on-edit, indent / heading / frontmatter fold services,
// fold all, fold more/less, fold info, localStorage persistence.
import { RangeSetBuilder, EditorState, Transaction, countColumn } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import {
  codeFolding, foldService, foldable, foldedRanges, foldEffect, unfoldEffect, unfoldAll, foldCode, unfoldCode,
  syntaxTree, ensureSyntaxTree, language
} from '@codemirror/language'
import { tokenClassProp } from './hypermd'
import { setIcon } from '../workspace/dom'

// ---- fold services ----------------------------------------------------------------------------------

function indentOf(state: EditorState, text: string): number {
  const i = text.search(/\S/)
  return i === -1 ? -1 : countColumn(text.substr(0, i), state.tabSize)
}

/** Indented lines below a less-indented line (blank lines don't end the range). */
export const indentFold = foldService.of((state, lineStart, lineEnd) => {
  try {
    const line = state.doc.lineAt(lineStart)
    const base = indentOf(state, line.text)
    if (base < 0) return null
    let last = null
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n)
      const ind = indentOf(state, l.text)
      if (ind === -1) continue
      if (!(ind > base)) break
      last = l
    }
    if (last) return { from: lineEnd, to: last.to }
  } catch (e) { console.error(e) }
  return null
})

/** A heading folds until the next heading of the same or higher level (ATX or setext, tree-confirmed). */
export const headingFold = foldService.of((state, lineStart) => {
  const tree = syntaxTree(state)
  const isHeader = (line: { from: number; to: number }) => {
    if (tree.length < line.to) return true
    const cls = tree.resolve(line.from, 1).type.prop(tokenClassProp)
    return !!cls && /\bheader\b/.test(cls)
  }
  const level = (line: { from: number; to: number; text: string; number: number }) => {
    const m = line.text.match(/^\s*(#{1,6})(\s+|$)/)
    if (m && isHeader(line)) return m[1].length
    if (state.doc.lines <= line.number) return 100
    const next = state.doc.line(line.number + 1)
    return next.text.match(/^[=-]+\s*$/) && tree.length >= next.to && isHeader(next) ? (next.text[0] === '=' ? 1 : 2) : 100
  }
  try {
    const last = state.doc.lines
    const line = state.doc.lineAt(lineStart)
    if (line.number === last) return null
    const lv = level(line)
    if (lv === 100) return null
    let next = state.doc.line(line.number + 1)
    let end = line.to
    while (next && !(level(next) <= lv)) {
      end = next.to
      if (next.number === last) break
      next = state.doc.line(next.number + 1)
    }
    return end === line.to ? null : { from: line.to, to: end }
  } catch (e) { console.error(e) }
  return null
})

/** `---` frontmatter (only blank lines above) folds to its closing `---`, from the line start. */
export const frontmatterFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart)
  if (line.text !== '---') return null
  for (let n = line.number - 1; n > 0; n--) if (state.doc.line(n).text.trim()) return null
  let n = line.number + 1
  while (n <= state.doc.lines && state.doc.line(n).text !== '---') n++
  if (n > state.doc.lines) return null
  return { from: lineStart, to: state.doc.line(n).to }
})

// ---- inline fold indicator ------------------------------------------------------------------------

function firstFoldIn(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null
  foldedRanges(state).between(from, to, (a, b) => { if (!found || found.from > a) found = { from: a, to: b } })
  return found
}

const RIGHT_TRIANGLE = '<path d="M3 8L12 17L21 8"></path>'

class FoldIndicatorWidget extends WidgetType {
  constructor(readonly folded: boolean) { super() }
  eq(other: FoldIndicatorWidget) { return other.folded === this.folded }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'cm-fold-indicator'
    const icon = el.appendChild(document.createElement('div'))
    icon.className = 'collapse-indicator collapse-icon'
    el.classList.toggle('is-collapsed', this.folded)
    setIcon(icon, 'right-triangle')
    const svg = icon.querySelector('svg')
    if (svg && !svg.firstChild) svg.innerHTML = RIGHT_TRIANGLE
    el.addEventListener('mousedown', e => e.preventDefault())
    el.addEventListener('click', e => {
      const line = view.state.doc.lineAt(view.posAtDOM(el))
      const folded = firstFoldIn(view.state, line.from, line.to)
      if (folded) { view.dispatch({ effects: unfoldEffect.of(folded) }); e.preventDefault(); return }
      const range = foldable(view.state, line.from, line.to)
      if (range) { view.dispatch({ effects: foldEffect.of(range) }); e.preventDefault() }
    })
    return el
  }
}
const foldedIndicator = Decoration.widget({ widget: new FoldIndicatorWidget(true) })
const unfoldedIndicator = Decoration.widget({ widget: new FoldIndicatorWidget(false) })

const foldIndicators = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  wasComposing = false
  constructor(view: EditorView) { this.build(view) }
  update(u: ViewUpdate) {
    if (u.view.composing) { this.decorations = this.decorations.map(u.changes); this.wasComposing = true; return }
    if (u.docChanged || u.viewportChanged || u.startState.facet(language) !== u.state.facet(language) ||
      foldedRanges(u.startState) !== foldedRanges(u.state) || this.wasComposing || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.wasComposing = false
      this.build(u.view)
    }
  }
  build(view: EditorView) {
    const b = new RangeSetBuilder<Decoration>()
    for (const block of view.viewportLineBlocks) {
      let deco: Decoration | null = null
      if (firstFoldIn(view.state, block.from, block.to)) deco = foldedIndicator
      else if (foldable(view.state, block.from, block.to)) deco = unfoldedIndicator
      if (deco) {
        const text = view.state.doc.sliceString(block.from, block.to)
        const at = block.from + text.match(/^\s*/)![0].length
        b.add(at, at, deco)
      }
    }
    this.decorations = b.finish()
  }
}, { decorations: v => v.decorations })

/** Editing inside a folded range unfolds it (any change not marked userEvent "set"). */
export const unfoldOnEdit = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) === 'set') return tr
  const folds = foldedRanges(tr.startState).map(tr.changes)
  const effects: any[] = []
  tr.changes.iterChangedRanges((fromA, _toA, fromB) => {
    folds.between(fromA, fromB, (from, to) => { effects.push(unfoldEffect.of({ from, to })) })
  })
  return effects.length ? [tr, { effects, sequential: true }] : tr
})

export interface FoldSettings { foldHeading: boolean; foldIndent: boolean }

/** Folding extensions for the dynamic compartment (empty when both settings are off). */
export function foldingExtensions(s: FoldSettings): Extension[] {
  if (!s.foldHeading && !s.foldIndent) return []
  const out: Extension[] = [codeFolding(), foldIndicators, EditorView.atomicRanges.of(v => foldedRanges(v.state)), unfoldOnEdit]
  if (s.foldHeading) out.push(headingFold)
  if (s.foldIndent) out.push(indentFold)
  out.push(frontmatterFold)
  return out
}

// ---- commands -------------------------------------------------------------------------------------

export function toggleFold(view: EditorView): boolean { return unfoldCode(view) || foldCode(view) }

export function foldAll(view: EditorView): boolean {
  ensureSyntaxTree(view.state, view.state.doc.length, 5000)
  const state = view.state
  const effects = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n)
    const r = foldable(state, l.from, l.to)
    if (r) effects.push(foldEffect.of(r))
  }
  if (effects.length) view.dispatch({ effects })
  return !!effects.length
}
export { unfoldAll }

function allFoldable(state: EditorState) {
  const out: { from: number; to: number }[] = []
  for (let n = 1; n <= state.doc.lines; n++) { const l = state.doc.line(n); const r = foldable(state, l.from, l.to); if (r) out.push(r) }
  return out
}
function foldOffsets(state: EditorState) {
  const s = new Set<number>()
  for (const it = foldedRanges(state).iter(); it.value; it.next()) s.add(it.from)
  return s
}
function foldMoreLess(view: EditorView, more: boolean) {
  const doc = view.state.doc
  const folded = foldOffsets(view.state)
  const all = allFoldable(view.state)
  const picks: { from: number; to: number }[] = []
  for (const r of view.state.selection.ranges) {
    const a = { from: r.from, to: doc.lineAt(r.to).to }
    const hits = all.filter(f => a.from <= f.to && a.to >= f.from)
    if (more) { for (let i = hits.length - 1; i >= 0; i--) if (!folded.has(hits[i].from)) { picks.push(hits[i]); break } }
    else for (const f of hits) if (folded.has(f.from)) { picks.push(f); break }
  }
  if (picks.length) view.dispatch({ effects: picks.map(p => (more ? foldEffect : unfoldEffect).of(p)) })
}
export const foldMore = (view: EditorView) => foldMoreLess(view, true)
export const foldLess = (view: EditorView) => foldMoreLess(view, false)

export function toggleFoldFrontmatter(view: EditorView) {
  if (view.state.doc.lineAt(0).text !== '---') return
  const r = foldable(view.state, 0, 0)
  if (!r) return
  view.dispatch({ effects: (firstFoldIn(view.state, 0, 0) ? unfoldEffect : foldEffect).of(r) })
}

// ---- fold info + persistence -----------------------------------------------------------------------

export interface FoldInfo { folds: { from: number; to: number }[]; lines: number }

/** Folded ranges as 0-based line numbers (`getFoldInfo`). */
export function getFoldInfo(state: EditorState): FoldInfo {
  const folds: { from: number; to: number }[] = []
  for (const it = foldedRanges(state).iter(); it.value; it.next()) {
    folds.push({ from: state.doc.lineAt(it.from).number - 1, to: state.doc.lineAt(it.to).number - 1 })
  }
  return { folds, lines: state.doc.lines }
}

/** Re-apply saved folds when the line count still matches (`applyFoldInfo`). */
export function applyFoldInfo(view: EditorView, info: FoldInfo | null) {
  const doc = view.state.doc
  if (info && doc.lines !== info.lines) return
  unfoldAll(view)
  if (!info) return
  const effects = []
  for (const f of info.folds) {
    const a = doc.line(f.from + 1), b = doc.line(Math.min(f.to + 1, doc.lines))
    const r = foldable(view.state, a.from, a.to)
    if (r) effects.push(foldEffect.of({ from: r.from, to: Math.max(r.to, b.to) }))
  }
  if (effects.length) view.dispatch({ effects })
}

/** `localStorage["<appId>-note-fold-<path>"]` = JSON FoldInfo (removed when there are no folds). */
export const foldStorage = {
  key: (appId: string, path: string) => `${appId}-note-fold-${path}`,
  load(appId: string, path: string): FoldInfo | null {
    try { const v = localStorage.getItem(this.key(appId, path)); return v ? JSON.parse(v) : null } catch { return null }
  },
  save(appId: string, path: string, info: FoldInfo | null) {
    if (info && info.folds.length === 0) info = null
    try {
      if (info) localStorage.setItem(this.key(appId, path), JSON.stringify(info))
      else localStorage.removeItem(this.key(appId, path))
    } catch { /* storage unavailable */ }
  },
  /** Drop entries of files that no longer exist. */
  cleanup(appId: string, exists: (path: string) => boolean) {
    const prefix = `${appId}-note-fold-`
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(prefix) && !exists(k.substr(prefix.length))) localStorage.removeItem(k)
    } catch { /* storage unavailable */ }
  }
}
