// Hanging indent for list / quote lines (local list-indent plugin):
// every line starting with a list/quote prefix (not inside code) gets
// `style="text-indent:-Npx;padding-inline-start:Npx"`, N = rendered width of the prefix. The width
// is first estimated from the column count × character width, then measured from the DOM.
import { RangeSetBuilder, countColumn } from '@codemirror/state'
import { Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import { lineClassProp, tokenClassProp } from './hypermd'
import { LIST_RE } from './livepreview/inline'

function listPrefix(text: string): string | null {
  const m = LIST_RE.exec(text)
  return m && m[0] ? m[0] : null
}
function inCode(tree: Tree, from: number, to: number): boolean {
  let found = false
  tree.iterate({
    from, to,
    enter: n => {
      if ((n.type.prop(lineClassProp) ?? '').includes('HyperMD-codeblock')) found = true
      if ((n.type.prop(tokenClassProp) ?? '').includes('hmd-indented-code')) found = true
    }
  })
  return found
}

interface Entry { text: string; size: number }

class ListIndent {
  decorations: DecorationSet = Decoration.none
  cache = new Map<number, Entry>()
  marks = new Map<number, Decoration>()
  tree: Tree

  constructor(readonly view: EditorView) {
    this.tree = syntaxTree(view.state)
    this.build(view)
    this.measure()
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged || u.selectionSet || u.focusChanged || this.tree !== syntaxTree(u.state)) {
      this.build(u.view)
      this.measure()
    }
  }

  cached(line: number, text: string): Entry | null {
    for (const n of [line, line - 1, line + 1]) { const e = this.cache.get(n); if (e && e.text === text) return e }
    const e = this.cache.get(line)
    return e && e.text.length === text.length ? e : null
  }

  build(view: EditorView) {
    const charW = view.defaultCharacterWidth
    const b = new RangeSetBuilder<Decoration>()
    const tree = (this.tree = syntaxTree(view.state))
    for (const block of view.viewportLineBlocks) {
      const line = view.state.doc.lineAt(block.from)
      const prefix = listPrefix(line.text)
      if (prefix && !inCode(tree, line.from, line.from + prefix.length)) {
        const size = this.cached(line.number, prefix)?.size ?? Math.floor(countColumn(prefix, view.state.tabSize) * charW)
        if (size > 0) {
          let mark = this.marks.get(size)
          if (!mark) this.marks.set(size, (mark = Decoration.line({ attributes: { style: `text-indent:${-size}px;padding-inline-start:${size}px` } })))
          b.add(line.from, line.from, mark)
        }
      } else this.cache.delete(line.number)
    }
    this.decorations = b.finish()
  }

  measure() {
    const view = this.view
    view.requestMeasure({
      key: this,
      read: () => {
        if (!view.contentDOM.offsetParent) return null
        const out: { el: HTMLElement; line: number; text: string; size: number }[] = []
        for (const el of Array.from(view.contentDOM.children) as HTMLElement[]) {
          if (!el.classList.contains('cm-line') || el.contentEditable === 'false') continue
          const line = view.state.doc.lineAt(view.posAtDOM(el))
          const prefix = listPrefix(line.text)
          if (!prefix || inCode(this.tree, line.from, line.from + prefix.length)) continue
          const coords = view.coordsAtPos(line.from + prefix.length, 1)
          if (!coords) continue
          const rect = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          const ltr = view.textDirectionAt(line.from) === 0
          const edge = ltr ? rect.left + parseFloat(cs.borderLeft || '0') : rect.right - parseFloat(cs.borderRight || '0')
          const size = Math.floor(Math.abs((ltr ? coords.right : coords.left) - edge) - (parseFloat(cs.paddingInlineStart || '0') + parseFloat(cs.textIndent || '0')))
          if (size > 0) out.push({ el, line: line.number, text: prefix, size })
        }
        return out
      },
      write: res => {
        if (!res) return
        let changed = false
        for (const r of res) {
          const prev = this.cache.get(r.line)
          if (!prev || prev.size !== r.size || prev.text !== r.text) { this.cache.set(r.line, { text: r.text, size: r.size }); changed = true }
          r.el.style.textIndent = `${-r.size}px`
          r.el.style.paddingInlineStart = `${r.size}px`
        }
        if (changed) this.build(view)
      }
    })
  }
}

export const listIndentPlugin = ViewPlugin.fromClass(ListIndent, { decorations: v => v.decorations })
