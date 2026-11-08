// The `editor:*` editing commands. They act on the
// `Editor` (engine/editor/Editor.ts) handed to editorCallback / editorCheckCallback.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorSelection } from '@codemirror/state'
import type { Command } from '../commands/Commands'
import { DEFAULT_HOTKEYS } from '../commands/defaultHotkeys'
import { Editor, offsetToPos, posToOffset } from './Editor'
import { toggleFoldFrontmatter } from './folding'
import { HIGHLIGHT_COLOR_EMOJI } from './livepreview/widgets'
import { tableAtSelection } from './livepreview/table'
import { TABLE_COMMANDS } from './livepreview/tableOps'
import { RenameHeadingModal, headingOfLine, showHeadingMenu, showMenuAtCursor } from './editorMenu'

export interface EditorCommandEnv {
  /** `editor:attach-file`: pick files and insert them as attachments. */
  attachFile?(editor: any, capture: boolean): void
  /** The MarkdownView of an editor (menu / rename-heading need its file). */
  viewOf?(editor: any): any
  /** foldHeading || foldIndent */
  foldingEnabled(): boolean
  /** `app.workspace.activeEditor` */
  activeEditor?(): { editor: any; getMode?: () => string } | null
}

const isEditor = (e: any): e is Editor => e instanceof Editor
const notInTable = (fn: (e: Editor) => void) => (checking: boolean, e: any) => {
  if (!isEditor(e) || e.inTableCell) return false
  if (!checking) fn(e)
  return true
}

/** The editing commands in registration order. */
export function getEditorCommands(env: EditorCommandEnv = { foldingEnabled: () => true }): Command[] {
  const out: Command[] = []
  const add = (c: Command) => out.push(DEFAULT_HOTKEYS[c.id] ? { hotkeys: DEFAULT_HOTKEYS[c.id], ...c } : c)

  add({ id: 'editor:toggle-fold-properties', name: 'Toggle fold properties in current file', icon: 'lucide-diff',
    checkCallback: (checking: boolean) => {
      const a = env.activeEditor?.()
      if (!a || !isEditor(a.editor) || (a.getMode && a.getMode() !== 'source')) return false
      if (!checking) toggleFoldFrontmatter(a.editor.cm)
      return true
    } })
  add({ id: 'editor:toggle-fold', name: 'Toggle fold on the current line', icon: 'lucide-diff',
    editorCheckCallback: (checking, e: any) => {
      if (!isEditor(e) || !e.hasFocus() || !env.foldingEnabled()) return false
      if (!checking) e.exec('toggleFold')
      return true
    } })
  add({ id: 'editor:fold-all', name: 'Fold all headings and lists', icon: 'lucide-minimize-2',
    editorCheckCallback: (checking, e: any) => { if (!isEditor(e) || !env.foldingEnabled()) return false; if (!checking) e.exec('foldAll'); return true } })
  add({ id: 'editor:unfold-all', name: 'Unfold all headings and lists', icon: 'lucide-maximize-2',
    editorCheckCallback: (checking, e: any) => { if (!isEditor(e) || !env.foldingEnabled()) return false; if (!checking) e.exec('unfoldAll'); return true } })
  add({ id: 'editor:fold-less', name: 'Fold less', icon: 'lucide-unfold-vertical', editorCallback: (e: Editor) => e.foldLess() })
  add({ id: 'editor:fold-more', name: 'Fold more', icon: 'lucide-fold-vertical', editorCallback: (e: Editor) => e.foldMore() })
  add({ id: 'editor:insert-wikilink', name: 'Add internal link', icon: 'bracket-glyph', editorCallback: (e: any) => { if (isEditor(e)) e.triggerWikilink(false) } })
  add({ id: 'editor:insert-embed', name: 'Add embed', icon: 'lucide-sticky-note', editorCallback: (e: any) => { if (isEditor(e)) e.triggerWikilink(true) } })
  add({ id: 'editor:insert-link', name: 'Insert Markdown link', icon: 'lucide-link', editorCallback: (e: any) => { if (isEditor(e)) e.insertMarkdownLink() } })
  add({ id: 'editor:insert-tag', name: 'Add tag', icon: 'lucide-tag', editorCallback: (e: Editor) => {
    const at = e.getCursor('from')
    e.replaceRange('#', at, at, 'input.autocomplete')
    e.setSelection({ line: at.line, ch: at.ch + 1 })
  } })
  add({ id: 'editor:set-heading', name: 'Toggle heading', icon: 'heading-glyph', editorCallback: (e: Editor) => showHeadingMenu(e) })
  for (let n = 0; n <= 6; n++) {
    add({ id: `editor:set-heading-${n}`, name: n === 0 ? 'Remove heading' : `Set as heading ${n}`, icon: n === 0 ? 'heading-glyph' : `heading-${n}`, editorCallback: (e: Editor) => e.setHeading(n) })
  }
  add({ id: 'editor:toggle-bold', name: 'Toggle bold', icon: 'lucide-bold', editorCallback: (e: Editor) => e.toggleMarkdownFormatting('bold') })
  add({ id: 'editor:toggle-italics', name: 'Toggle italic', icon: 'lucide-italic', editorCallback: (e: Editor) => e.toggleMarkdownFormatting('italic') })
  add({ id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', icon: 'lucide-strikethrough', editorCallback: (e: Editor) => e.toggleMarkdownFormatting('strikethrough') })
  add({ id: 'editor:toggle-highlight', name: 'Toggle highlight', icon: 'lucide-highlighter', editorCallback: (e: any) => { if (isEditor(e)) e.toggleHighlight() } })
  for (const color of Object.keys(HIGHLIGHT_COLOR_EMOJI)) {
    add({ id: `editor:toggle-highlight-${color}`, name: `Toggle ${color} highlight`, icon: 'lucide-highlighter', editorCallback: (e: any) => { if (isEditor(e)) e.toggleHighlight(color) } })
  }
  add({ id: 'editor:toggle-code', name: 'Toggle code', icon: 'lucide-code-2', editorCallback: (e: Editor) => e.toggleMarkdownFormatting('code') })
  add({ id: 'editor:toggle-inline-math', name: 'Toggle inline math', icon: 'lucide-sigma', editorCallback: (e: Editor) => e.toggleMarkdownFormatting('math') })
  add({ id: 'editor:toggle-blockquote', name: 'Toggle blockquote', icon: 'lucide-quote', editorCheckCallback: notInTable(e => e.toggleBlockquote()) })
  add({ id: 'editor:toggle-comments', name: 'Toggle comment', icon: 'lucide-percent', editorCallback: (e: Editor) => e.toggleComment() })
  add({ id: 'editor:clear-formatting', name: 'Clear formatting', icon: 'lucide-eraser',
    editorCheckCallback: (checking, e: any) => { if (!isEditor(e) || !e.somethingSelected()) return false; if (!checking) e.clearMarkdownFormatting(); return true } })
  add({ id: 'editor:toggle-bullet-list', name: 'Toggle bullet list', icon: 'lucide-list', editorCheckCallback: notInTable(e => e.toggleBulletList()) })
  add({ id: 'editor:toggle-numbered-list', name: 'Toggle numbered list', icon: 'lucide-list-ordered', editorCheckCallback: notInTable(e => e.toggleNumberList()) })
  add({ id: 'editor:toggle-checklist-status', name: 'Toggle checkbox status', icon: 'lucide-check-square', editorCheckCallback: notInTable(e => e.toggleCheckList()) })
  add({ id: 'editor:cycle-list-checklist', name: 'Cycle bullet/checkbox', icon: 'lucide-check-square', editorCheckCallback: notInTable(e => e.toggleCheckList(true)) })
  add({ id: 'editor:insert-callout', name: 'Insert callout', icon: 'lucide-quote', editorCheckCallback: notInTable(e => e.insertCallout()) })
  add({ id: 'editor:insert-codeblock', name: 'Insert code block', icon: 'lucide-code', editorCheckCallback: notInTable(e => e.insertCodeblock()) })
  add({ id: 'editor:insert-horizontal-rule', name: 'Insert horizontal rule', icon: 'lucide-minus', editorCallback: (e: Editor) => e.insertHorizontalRule() })
  add({ id: 'editor:insert-mathblock', name: 'Insert math block', icon: 'lucide-sigma-square', editorCallback: (e: Editor) => e.insertMathBlock() })
  add({ id: 'editor:insert-table', name: 'Insert table', icon: 'lucide-table', editorCallback: (e: Editor) => e.insertTable() })
  add({ id: 'editor:insert-footnote', name: 'Insert footnote', icon: 'lucide-file-signature', editorCallback: (e: Editor) => e.insertFootnote() })
  add({ id: 'editor:indent-list', name: 'Indent list item', icon: 'lucide-indent', editorCallback: (e: Editor) => e.indentList() })
  add({ id: 'editor:unindent-list', name: 'Unindent list item', icon: 'lucide-outdent', editorCallback: (e: Editor) => e.unindentList() })
  add({ id: 'editor:swap-line-up', name: 'Move line up', icon: 'lucide-corner-right-up', repeatable: true, editorCallback: (e: Editor) => e.exec('swapLineUp') })
  add({ id: 'editor:swap-line-down', name: 'Move line down', icon: 'lucide-corner-right-down', repeatable: true, editorCallback: (e: Editor) => e.exec('swapLineDown') })
  add({ id: 'editor:delete-paragraph', name: 'Delete paragraph', icon: 'lucide-scissors', repeatable: true, editorCallback: (e: Editor) => e.exec('deleteLine') })
  add({ id: 'editor:rename-heading', name: 'Rename this heading...', icon: 'lucide-edit-3',
    editorCheckCallback: (checking, e: any) => {
      if (!isEditor(e)) return false
      const file = env.viewOf?.(e)?.file
      const heading = file ? headingOfLine(e.getLine(e.getCursor().line)) : null
      if (heading === null) return false
      if (!checking) new RenameHeadingModal((window as any).app, e, file, heading).open()
      return true
    } })
  add({ id: 'editor:attach-file', name: 'Insert attachment', icon: 'lucide-paperclip', editorCallback: (e: any) => { if (isEditor(e)) env.attachFile?.(e, false) } })
  const addCursor = (below: boolean) => (checking: boolean, e: any) => {
    if (!isEditor(e)) return false
    if (!checking) {
      const cm = e.cm
      const sel = cm.state.selection
      let edge = sel.ranges[0]
      for (const r of sel.ranges.slice(1)) if (below ? r.to > edge.to : r.from < edge.from) edge = r
      const p = offsetToPos(cm.state.doc, edge.from)
      const at = posToOffset(cm.state.doc, { line: p.line + (below ? 1 : -1), ch: p.ch })
      cm.dispatch({ selection: sel.addRange(EditorSelection.cursor(at)), userEvent: 'select' })
    }
    return true
  }
  add({ id: 'editor:add-cursor-below', name: 'Add cursor below', icon: 'lucide-mouse-pointer-click', repeatable: true, editorCheckCallback: addCursor(true) })
  add({ id: 'editor:add-cursor-above', name: 'Add cursor above', icon: 'lucide-mouse-pointer-click', repeatable: true, editorCheckCallback: addCursor(false) })
  for (const t of TABLE_COMMANDS) {
    add({ id: `editor:table-${t.id}`, name: `Table: ${t.name}`, icon: t.icon,
      editorCheckCallback: (checking, e: any) => {
        if (!isEditor(e)) return false
        const at = tableAtSelection(e.cm)
        if (!at) return false
        if (checking) return true
        at.widget.runOp(t.op, at.row, at.col)
        return true
      } })
  }
  add({ id: 'editor:context-menu', name: 'Show context menu under cursor', icon: 'lucide-menu',
    editorCallback: (e: any) => { if (isEditor(e)) showMenuAtCursor({ app: (window as any).app, editor: e, view: env.viewOf?.(e) }) } })
  return out
}

/** Ids from getEditorCommands() that builtin.ts must not register again. */
export const EDITOR_COMMAND_IDS = new Set(getEditorCommands().map(c => c.id))
