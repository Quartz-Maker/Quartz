// Inline Live Preview: hides markdown formatting per syntax ELEMENT (cursor snapping,
// decoration builder, task-line attributes).
//
// The builder walks the HyperMD token nodes in the visible ranges. Contiguous formatting/content
// tokens (each starting where the previous one ended) form one element run. When a run ends it is
// tested as a whole against the reveal predicate (focused selection or search match): touched runs
// keep their source (only "always"/"onReveal" decorations), untouched runs get their formatting
// tokens replaced. Header `#`, quote `>` and escape backslashes use LINE granularity instead.
import { EditorSelection, RangeSetBuilder } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import { tokenClassProp, lineClassProp } from '../hypermd/streamLanguage'
import { isMouseDown, makeRevealTest, refreshLivePreview, setSearchMatches, imageRevealEffect } from './state'
import {
  HIDE, HIDE_END, HIDE_LINE, underlineMark, transparentMark, blockquoteBorder, listBulletMark, listNumberMark,
  CheckboxWidget, HighlightColorWidget, ExternalLinkWidget, highlightColorAt
} from './widgets'


/** Emphasis-like token classes (their content extends an element run). */
export const FORMAT_CLASSES = new Set(['em', 'strong', 'inline-code', 'strikethrough', 'highlight'])
/** Link-like token classes. */
export const LINK_CLASSES = new Set(['link', 'image', 'hmd-internal-link', 'hmd-embed', 'formatting-link', 'footref'])
/** List-prefix regex: [1] indent/quote, [2] marker incl. task, [3] bullet/number marker, [4] number, [5] delimiter, [6] task char. */
export const LIST_RE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/

/** True when `url` is a vault-relative path rather than an external URL. */
export function isLocalUrl(url: string): boolean {
  return url.startsWith('./') || url.startsWith('../') || url.indexOf(':') === -1
}

/** Base for LP view plugins: skip rebuilds during IME composition / mouse drag / partial parse. */
export abstract class LivePreviewDecorations {
  tree: Tree
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.tree = syntaxTree(view.state)
    this.decorations = this.buildDeco(view)
  }

  update(update: ViewUpdate) {
    const tree = syntaxTree(update.state)
    if (tree.length < update.view.viewport.to || update.view.composing || isMouseDown(update.view)) {
      this.decorations = this.decorations.map(update.changes)
    } else if (tree != this.tree || update.viewportChanged || update.selectionSet ||
      update.transactions.some(tr => tr.effects.some(e => e.is(refreshLivePreview) || e.is(setSearchMatches)))) {
      this.tree = tree
      this.decorations = this.buildDeco(update.view)
    }
  }

  abstract buildDeco(view: EditorView): DecorationSet
}

interface Pending { from: number; to: number; deco: Decoration; always?: boolean; onReveal?: boolean }

/** Move `pos` out of a hidden range [from, to] according to the replace kind. */
function snap(pos: number, from: number, to: number, deco: Decoration, multiLine: boolean): number {
  if (from <= pos && pos <= to) {
    if (deco === HIDE) pos = Math.min(from, pos)
    else if (deco === HIDE_END) pos = Math.max(to, pos)
    else if (deco === HIDE_LINE && multiLine) pos = Math.min(from, pos)
  }
  return pos
}

export class InlineLivePreview extends LivePreviewDecorations {
  update(update: ViewUpdate) {
    const { state, view } = update
    if (!update.docChanged && update.selectionSet && !isMouseDown(view) &&
      !update.transactions.some(tr => tr.effects.some(e => e.is(imageRevealEffect)))) {
      const sel = state.selection
      const decos = this.decorations
      let changed = false
      const ranges = sel.ranges.map(range => {
        let anchor = range.anchor, head = range.head
        const multiLine = state.doc.lineAt(anchor).number !== state.doc.lineAt(head).number
        for (let i = 0; i < 10; i++) {
          let moved = false
          const visit = (from: number, to: number, deco: Decoration) => {
            const a = snap(anchor, from, to, deco, multiLine)
            const h = snap(head, from, to, deco, multiLine)
            if (a !== anchor || h !== head) { anchor = a; head = h; moved = true }
          }
          decos.between(anchor, anchor, visit)
          if (anchor !== head) decos.between(head, head, visit)
          if (!moved) break
        }
        if (anchor !== range.anchor || head !== range.head) { changed = true; return EditorSelection.range(anchor, head) }
        return range
      })
      if (changed) {
        view.dom.ownerDocument.defaultView!.setTimeout(() => {
          if (sel === view.state.selection) view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex) })
        })
      }
    }
    super.update(update)
  }

  buildDeco(view: EditorView): DecorationSet {
    if (!this.tree.length) return Decoration.none
    return buildInlineDecorations(view.state, this.tree, view.visibleRanges, makeRevealTest(view))
  }
}

/** The inline LP decorations for `ranges` (exported for tests). */
export function buildInlineDecorations(
  state: EditorState, tree: Tree, ranges: readonly { from: number; to: number }[],
  touches: (from: number, to: number) => boolean
): DecorationSet {
  const doc = state.doc
  const lineTouched = (pos: number) => { const l = doc.lineAt(pos); return touches(l.from, l.to) }
  const out = new RangeSetBuilder<Decoration>()
  let lastEnd = 0

  for (const range of ranges) {
    let runFrom = range.from, runTo = range.from
    let pending: Pending[] | null = null
    const push = (p: Pending) => { (pending || (pending = [])).push(p) }
    const flush = (pos: number) => {
      if (pending) {
        if (touches(runFrom, runTo)) {
          for (const p of pending) if (p.always || p.onReveal) out.add(p.from, p.to, p.deco)
        } else {
          // trailing hidden tokens snap the caret to the far side
          if (pending.length > 1) {
            let edge = runTo
            for (let i = pending.length - 1; i > 0; i--) {
              const p = pending[i]
              if (p.deco !== HIDE || p.to !== edge) break
              p.deco = HIDE_END
              edge = p.from
            }
          }
          for (const p of pending) if (!p.onReveal) out.add(p.from, p.to, p.deco)
        }
        pending = null
      }
      runFrom = pos
      runTo = pos
    }
    let url = ''
    let inImage = false, inEmbed = false

    tree.iterate({
      from: range.from, to: range.to,
      enter: node => {
        const from = node.from, to = node.to
        const cls = node.type.prop(tokenClassProp)
        if (!(from === runTo && cls)) flush(from)
        if (!cls) return
        if (from < lastEnd) return
        lastEnd = to
        const text = () => doc.sliceString(from, to)
        const words = cls.split(' ')
        const has = new Set(words)
        if (has.has('hmd-codeblock')) return
        if (has.has('formatting-header')) {
          const line = doc.lineAt(from)
          if (!touches(line.from, line.to) && line.text.trim() !== text().trim()) push({ from, to, deco: HIDE_LINE })
          return
        }
        if (has.has('formatting-quote')) {
          if (!lineTouched(from)) push({ from, to: from + 1, deco: has.has('quote-1') ? transparentMark : blockquoteBorder })
          return
        }
        if (has.has('hmd-escape-backslash') && !lineTouched(from)) push({ from, to, deco: HIDE })

        const isFormat = words.some(w => FORMAT_CLASSES.has(w))
        const isElement = isFormat || words.some(w => LINK_CLASSES.has(w))
        let isFormatting = has.has('formatting')
        const isUrlString = has.has('string') && has.has('url')
        const isLinkText = has.has('link') && !has.has('url') && !isFormatting
        const isWikiText = has.has('hmd-internal-link') && !has.has('link-has-alias') && !has.has('link-alias-pipe') && !has.has('hmd-embed')
        const isText = isLinkText || isWikiText
        const isImage = has.has('image')
        const isEmbed = has.has('formatting-embed') || has.has('hmd-embed')
        const isLinkSyntax = has.has('formatting-link') || has.has('link-has-alias') || has.has('link-alias-pipe')
        const isTask = has.has('formatting-task')
        let snapEnd = has.has('formatting-link-end') || isUrlString
        const isBullet = has.has('formatting-list-ul')
        const isBareUrl = has.has('url') && !has.has('string')

        if (isImage) inImage = true
        else if (inImage && !has.has('url')) inImage = false
        if (isEmbed) inEmbed = true
        else if (inEmbed && !has.has('formatting-link-end')) inEmbed = false
        // images, embeds and math are rendered by the block field
        if (isImage || inImage || isEmbed || inEmbed || has.has('math')) {
          if (isFormat) runTo = to
          return
        }
        // empty `[[]]`
        if (has.has('formatting-link-start') && doc.length >= to + 2 && doc.sliceString(to, to + 2) === ']]') return
        if (has.has('formatting-link-end') && from >= 2 && doc.sliceString(from - 2, from) === '[[') return

        let hides = isLinkSyntax || isUrlString || isText || isTask || isBullet || isBareUrl
        // inline footnote refs `[^1]` stay raw (footnote definitions are hidden)
        if (has.has('hmd-barelink') && !has.has('hmd-footnote')) isFormatting = hides = false
        // `<https://…>` autolinks
        if (isLinkSyntax && has.has('link') && has.has('url')) {
          if (!touches(from, to)) push({ from, to, deco: underlineMark })
          if (to + 1 < doc.length && doc.sliceString(to, to + 1) === '>') push({ from: to, to: to + 1, deco: HIDE_END })
          runTo = to + 1
          return
        }
        if ((isLinkSyntax && has.has('link') && text() === ']') || (isFormatting && isUrlString && text() === '(')) snapEnd = true
        if (isElement || hides) {
          runTo = to
          if (isFormatting || hides) {
            const item: Pending = { from, to, deco: snapEnd ? HIDE_END : HIDE }
            if (isTask) {
              item.deco = Decoration.widget({ widget: new CheckboxWidget(doc.sliceString(from + 1, from + 2)) })
            } else if (isBullet) {
              const m = doc.lineAt(from).text.match(LIST_RE)
              if (!(m && m[6])) { item.deco = listBulletMark; item.to = runTo = from + 1 }
            } else if (isText) {
              const t = text()
              if (isWikiText && t.length > 1 && t.startsWith('#')) {
                push({ from, to: from + 1, deco: HIDE })
                item.from++
              }
              item.deco = underlineMark
            } else if (isBareUrl) item.deco = underlineMark
            push(item)
            if (has.has('formatting-highlight') && !has.has('formatting-highlight-end')) {
              const c = highlightColorAt(text(), 2)
              if (c.color) push({ from: from + 2, to, onReveal: true, deco: Decoration.replace({ widget: new HighlightColorWidget(c.color) }) })
            }
          }
        }
        if (has.has('formatting-list-ol')) {
          runTo = to
          push({ from, to, deco: listNumberMark })
        }
        if (has.has('url') && !isFormatting) url = text()
        else if (has.has('url') && isFormatting && url && text() === ')') {
          if (!isLocalUrl(url)) {
            const c = Array.from(has).map(w => 'cm-' + w).join(' ') + ' external-link'
            push({ from: to, to, always: true, deco: Decoration.widget({ widget: new ExternalLinkWidget(c) }) })
          }
          url = ''
        } else url = ''
      }
    })
    flush(0)
  }
  return out.finish()
}

export const inlineLivePreview = ViewPlugin.fromClass(InlineLivePreview, { decorations: v => v.decorations })

/** `data-task="<char>"` on task lines (themes style alternative checkboxes with it). */
class TaskLineAttributes extends LivePreviewDecorations {
  buildDeco(view: EditorView): DecorationSet {
    if (!this.tree.length) return Decoration.none
    const doc = view.state.doc
    const b = new RangeSetBuilder<Decoration>()
    for (const { from, to } of view.visibleRanges) {
      this.tree.iterate({
        from, to,
        enter: node => {
          const lc = node.type.prop(lineClassProp)
          if (lc && lc.split(' ').includes('HyperMD-task-line')) {
            const m = doc.lineAt(node.from).text.match(LIST_RE)
            if (m && m[6]) b.add(node.from, node.from, Decoration.line({ attributes: { 'data-task': m[6] } }))
          }
        }
      })
    }
    return b.finish()
  }
}

export const taskLineAttributes = ViewPlugin.fromClass(TaskLineAttributes, { decorations: v => v.decorations })
