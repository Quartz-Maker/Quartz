// Frontmatter in Live Preview.
// When the frontmatter is valid YAML and `propertiesInDocument !== "source"`, the whole `---…---`
// range is replaced by an empty block (the Properties editor in `.cm-sizer` shows it instead) and a
// transaction filter keeps carets out of it. Invalid YAML stays visible: `is-invalid` over it plus an
// `error-marker` at the error position.
import { EditorSelection, EditorState, Facet, StateEffect, StateField, Transaction } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { parse, YAMLError } from 'yaml'

/** Typing the third `-` on the first line inserts an empty frontmatter and asks for a property. */
export const addPropertyEffect = StateEffect.define<void>()

const invalidMark = Decoration.mark({ class: 'is-invalid' })
const hiddenBlock = Decoration.replace({ block: true })

/** Frontmatter end offset (end of the closing `---` line) or -1. */
export function frontmatterEndOf(doc: { line(n: number): { text: string; to: number }; lines: number }): number {
  if (doc.line(1).text !== '---') return -1
  for (let n = 2; n <= doc.lines; n++) { const l = doc.line(n); if (l.text === '---') return l.to }
  return -1
}

let lastYaml: string | null = null
let lastError: Error | null = null
function yamlError(src: string): Error | null {
  if (src === lastYaml) return lastError
  lastYaml = src
  try {
    const v = parse(src, null as any, {}) ?? {}
    if (typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('Frontmatter must be a valid object!'), { pos: [0, 0] })
    lastError = null
  } catch (e) { lastError = e as Error }
  return lastError
}

export interface PropertiesState { decorations: DecorationSet; frontmatterEnd: number; hidden: boolean }

/** Read by the shell (scroll / "is caret at top" logic). */
export const propertiesInfo = Facet.define<PropertiesState, PropertiesState | null>({ combine: v => (v.length ? v[0] : null) })

export interface PropertiesOptions {
  /** `propertiesInDocument` setting: 'visible' | 'hidden' | 'source'. */
  mode: () => string
  /** Run `markdown:add-metadata-property`. */
  addProperty?: () => void
}

export function livePreviewProperties(opts: PropertiesOptions): Extension {
  const field = StateField.define<PropertiesState>({
    create: state => compute(state),
    update: (_v, tr) => compute(tr.state),
    provide: f => [EditorView.decorations.from(f, v => v.decorations), propertiesInfo.from(f)]
  })
  function compute(state: EditorState): PropertiesState {
    const doc = state.doc
    const end = frontmatterEndOf(doc)
    let hidden = end !== -1 && opts.mode() !== 'source'
    const decos = []
    if (end !== -1) {
      const err = yamlError(doc.sliceString(3, end - 3))
      if (err) {
        hidden = false
        decos.push(invalidMark.range(0, end))
        if (err instanceof YAMLError || (err as any).pos) {
          const pos = Math.min(Math.max(((err as any).pos?.[0] ?? 0) + 3, 4), end - 3)
          decos.push(Decoration.mark({ class: 'error-marker', attributes: { 'aria-label': 'Syntax error. Your frontmatter is invalid.' } }).range(pos, pos + 1))
        }
      }
    }
    if (hidden) decos.push(hiddenBlock.range(0, end))
    return { decorations: Decoration.set(decos, true), frontmatterEnd: end, hidden }
  }
  let viewRef: EditorView | null = null
  const filter = EditorState.transactionFilter.of((tr: Transaction) => {
    if (viewRef?.composing || tr.annotation(Transaction.userEvent) === 'set') return tr
    if (opts.mode() === 'source') return tr
    if (tr.effects.some(e => e.is(addPropertyEffect))) { setTimeout(() => opts.addProperty?.(), 30); return tr }
    const oldDoc = tr.startState.doc
    const end = frontmatterEndOf(oldDoc)
    if (end === -1) return tr
    if (yamlError(oldDoc.sliceString(3, end - 3))) return tr
    let extra: { insert: string; from: number }[] | undefined
    const newDoc = tr.newDoc
    const newEnd = frontmatterEndOf(newDoc)
    let len = newDoc.length
    if (len === newEnd) { len++; extra = [{ insert: '\n', from: newEnd }] }
    const sel = tr.newSelection
    if (sel.ranges.some(r => r.from <= end || r.to <= end)) {
      let touchesHidden = false
      tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        if (fromA >= 3 && toA < end - 1) touchesHidden = true
        if (fromB === toB && toA <= end + 1) touchesHidden = true
      }, true)
      if (touchesHidden) return []
      const clamp = (p: number) => Math.min(Math.max(p, end + 1), len)
      const selection = EditorSelection.create(sel.ranges.map(r => EditorSelection.range(clamp(r.anchor), clamp(r.head))), sel.mainIndex)
      return [tr, { changes: extra, selection, sequential: true }]
    }
    return tr
  })
  const ref = EditorView.updateListener.of(u => { viewRef = u.view })
  return [field, filter, ref]
}


/** `--` + `-` typed at the very start of the document creates `---\n\n---` (properties). */
export const dashFrontmatterInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '-') return false
  const main = view.state.selection.main
  if (from !== main.from || to !== main.to) return false
  const line = view.state.doc.lineAt(from)
  if (line.from > 0) return false
  if (/^--$/.test(line.text)) {
    view.dispatch({ changes: [{ insert: '-\n\n---\n', from: line.to }], selection: { anchor: from + 2 }, effects: [addPropertyEffect.of()], userEvent: 'input.type' })
    return true
  }
  return false
})
