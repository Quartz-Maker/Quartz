// Token-class decorations, the mechanism themes rely on: a lowest-precedence ViewPlugin walks the syntax tree over the visible ranges and emits
//   - Decoration.mark({class: 'cm-a cm-b'}) for every token node (words already sorted),
//   - Decoration.line({attributes: {class: 'HyperMD-header HyperMD-header-1'}}) for line nodes,
// adding spellcheck="false" to marks carrying one of the classes in `spellcheckOffClasses`.
import { Facet, Prec, RangeSetBuilder } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import { tokenClassProp, lineClassProp } from './streamLanguage'

/** Space-separated token words whose marks get spellcheck="false". */
export const spellcheckOffClasses = Facet.define<string>({})

/** The default list. */
export const defaultSpellcheckOff = spellcheckOffClasses.of(
  'url inline-code property footref hmd-footnote math link-has-alias formatting-link hmd-codeblock blockid hmd-frontmatter hashtag'
)

export interface DecorationCaches {
  line: { [cls: string]: Decoration }
  token: { [cls: string]: Decoration }
}

/**
 * Build the token/line class decorations for `ranges` of `tree`.
 * `lineStartAt(pos)` gives the start of the (visual) line block containing pos.
 */
export function buildTokenClassDecorations(
  state: EditorState, tree: Tree, ranges: readonly { from: number; to: number }[],
  lineStartAt: (pos: number) => number = pos => state.doc.lineAt(pos).from,
  caches: DecorationCaches = { line: Object.create(null), token: Object.create(null) }
): DecorationSet {
  if (!tree.length) return Decoration.none
  const words: string[] = []
  for (const v of state.facet(spellcheckOffClasses)) words.push(...v.split(' '))
  const noSpell = new Set(words.filter(Boolean))
  const builder = new RangeSetBuilder<Decoration>()
  let last = 0
  for (const { from, to } of ranges) {
    tree.iterate({
      from, to,
      enter: node => {
        const lineCls = node.type.prop(lineClassProp)
        if (lineCls) {
          const deco = caches.line[lineCls] || (caches.line[lineCls] = Decoration.line({ attributes: { class: lineCls } }))
          const lineFrom = lineStartAt(node.from)
          if (last > lineFrom) return
          builder.add(lineFrom, lineFrom, deco)
          last = lineFrom
        }
        const cls = node.type.prop(tokenClassProp)
        if (cls) {
          if (last > node.from) return
          let deco = caches.token[cls]
          if (!deco) {
            const parts = cls.split(' ')
            const spec: { class: string; attributes?: { [k: string]: string } } = { class: parts.map(w => 'cm-' + w).join(' ') }
            if (noSpell.size && parts.some(w => noSpell.has(w))) spec.attributes = { spellcheck: 'false' }
            deco = caches.token[cls] = Decoration.mark(spec)
          }
          builder.add(node.from, node.to, deco)
          last = node.to
        }
      }
    })
  }
  return builder.finish()
}

class TokenClassView {
  decorations: DecorationSet
  tree: Tree
  caches: DecorationCaches = { line: Object.create(null), token: Object.create(null) }

  constructor(view: EditorView) {
    this.tree = syntaxTree(view.state)
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate) {
    const tree = syntaxTree(update.state)
    if (tree.length < update.view.viewport.to || update.view.compositionStarted) {
      this.decorations = this.decorations.map(update.changes)
    } else if (tree != this.tree || update.viewportChanged) {
      this.tree = tree
      this.decorations = this.build(update.view)
    }
  }

  build(view: EditorView) {
    return buildTokenClassDecorations(view.state, this.tree, view.visibleRanges, pos => view.lineBlockAt(pos).from, this.caches)
  }
}

/** The token-class ViewPlugin, registered at lowest precedence. */
export const tokenClassPlugin: Extension = Prec.lowest(ViewPlugin.fromClass(TokenClassView, { decorations: v => v.decorations }))
