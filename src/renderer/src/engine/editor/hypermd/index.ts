// Public API of the HyperMD editor language (token & line classes).
//
//   import { hypermdLanguage, tokenClassPlugin, hypermdEditorExtensions } from '@/engine/editor/hypermd'
//
// - `hypermdLanguage`: CM6 Language running the hypermd mode.
// - `tokenClassPlugin`: lowest-precedence ViewPlugin emitting `cm-*` marks + `HyperMD-*` line classes.
// - `hypermdEditorExtensions()`: language + class plugin + default spellcheck-off classes.
// - `tokenClassesAt` / `lineClassesAt` helpers read the token/line class strings from the syntax tree
//   (for Live Preview / folding code that needs to know "is this a header / code block / …").
import type { EditorState, Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { HyperMDStreamLanguage, tokenClassProp, lineClassProp } from './streamLanguage'
import { tokenClassPlugin, spellcheckOffClasses, defaultSpellcheckOff } from './classPlugin'
import { getHyperMDMode, tokenizeDocument } from './tokenize.js'
import { getModeRegistry } from './registry.js'
import { normalizeLine } from './normalize.js'

export { HyperMDStreamLanguage, tokenClassProp, lineClassProp, tokenClassPlugin, spellcheckOffClasses, defaultSpellcheckOff }
export { tokenizeDocument, getModeRegistry, getHyperMDMode, normalizeLine }

export const hypermdLanguage = HyperMDStreamLanguage.define(getHyperMDMode())

export function hypermdEditorExtensions(): Extension[] {
  return [hypermdLanguage, tokenClassPlugin, defaultSpellcheckOff]
}

/** Line class string (e.g. "HyperMD-header HyperMD-header-1") of the line containing `pos`, or "". */
export function lineClassesAt(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos)
  let found = ''
  syntaxTree(state).iterate({
    from: line.from, to: line.to,
    enter: node => {
      if (found) return false
      const cls = node.type.prop(lineClassProp)
      if (cls && node.from === line.from) { found = cls; return false }
      return undefined
    }
  })
  return found
}

/** Line numbers inside fenced code blocks (incl. fences) or indented code, from the token classes. */
export function codeBlockLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>()
  syntaxTree(state).iterate({
    enter: node => {
      const lineCls = node.type.prop(lineClassProp)
      if (lineCls && /(^| )HyperMD-codeblock( |$)/.test(lineCls)) lines.add(state.doc.lineAt(node.from).number)
      const cls = node.type.prop(tokenClassProp)
      if (cls && /(^| )hmd-indented-code( |$)/.test(cls)) lines.add(state.doc.lineAt(node.from).number)
    }
  })
  return lines
}

/** True when [from, to) lies inside one inline-code token run (backticks included). */
export function isInInlineCode(state: EditorState, from: number, to: number): boolean {
  let start = -1, end = -1
  for (const t of tokenClassesIn(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to)) {
    if (!/(^| )inline-code( |$)/.test(t.cls)) continue
    if (start < 0 || t.from !== end) start = t.from
    end = t.to
    if (start <= from && end >= to) return true
  }
  return false
}

/** Token class strings of all token nodes overlapping [from, to). */
export function tokenClassesIn(state: EditorState, from: number, to: number): { from: number; to: number; cls: string }[] {
  const out: { from: number; to: number; cls: string }[] = []
  syntaxTree(state).iterate({
    from, to,
    enter: node => {
      const cls = node.type.prop(tokenClassProp)
      if (cls) out.push({ from: node.from, to: node.to, cls })
    }
  })
  return out
}
