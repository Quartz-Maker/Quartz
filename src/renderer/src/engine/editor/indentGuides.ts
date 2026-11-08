// Indentation guides (`showIndentGuide`).
// Every tab / 4-space unit of the leading `[\s>]` run gets `cm-indent`; the unit at the caret's list
// level inside the caret's list block gets `cm-indent cm-active-indent`; shorter space runs get
// `cm-indent-spacing`.
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import { LIST_RE } from './livepreview/inline'

const indentMark = Decoration.mark({ class: 'cm-indent' })
const activeIndentMark = Decoration.mark({ class: 'cm-indent cm-active-indent' })
const spacingMark = Decoration.mark({ class: 'cm-indent-spacing' })

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  let line = doc.lineAt(view.state.selection.main.from)
  let prefix = '', bulletPad = ''
  const m = line.text.match(LIST_RE)
  if (m && m[0]) {
    prefix = m[1]
    if (m[2]) bulletPad = ' '.repeat(m[2].length)
    else {
      for (let n = line.number - 1; n > 0;) {
        const l = doc.line(n)
        const u = l.text.match(LIST_RE)
        if (!u || !u[0]) break
        if (u[2] || u[1] !== prefix) {
          const h = u[1] || ''
          if (u[2] && prefix.startsWith(h) && u[0].length <= prefix.length) { line = l; prefix = u[1]; bulletPad = ' '.repeat(u[2].length) }
          break
        }
        n--
      }
    }
  }
  let end = line.number + 1
  while (end <= doc.lines) {
    let t = doc.line(end).text
    if (!t.startsWith(prefix)) break
    t = t.substr(prefix.length)
    if (bulletPad) {
      if (t.startsWith(bulletPad)) { end++; continue }
      bulletPad = ''
    }
    if (!/^(\t| {4})/.test(t)) break
    end++
  }
  for (const block of view.viewportLineBlocks) {
    const l = doc.lineAt(block.from)
    const h = l.text.match(/^[\s>]+/)
    if (!h) continue
    const ws = h[0]
    const inBlock = line.number < l.number && l.number < end
    let i = 0
    while (i < ws.length) {
      const ch = ws.charAt(i)
      const start = block.from + i
      let unit = false
      const active = inBlock && i === prefix.length
      if (ch === '>') { i++; if (ws.charAt(i) === ' ') i++ }
      else if (ch === '\t') { unit = true; i++ }
      else {
        let full = true
        const stop = i + 4
        for (let j = i; j < stop; j++) if (ws.charAt(j) !== ' ') { i = j; full = false; break }
        if (!full) { b.add(start, block.from + i, spacingMark); i++; continue }
        unit = true
        i = stop
      }
      if (unit) b.add(start, block.from + i, active ? activeIndentMark : indentMark)
    }
  }
  return b.finish()
}

export const indentGuides = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = build(view) }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view) }
}, { decorations: v => v.decorations })
