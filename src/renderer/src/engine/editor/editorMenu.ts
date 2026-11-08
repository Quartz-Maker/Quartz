// The editor context menu (`editMode.onContextMenu`):
//   Add link / Add external link | [Search for ... when a selection exists] | Format / Paragraph / Insert
//   submenus | Cut Copy Paste "Paste as plain text" Select all | [heading line: "Rename this heading..."].
// After the core items the `editor-menu` workspace event is fired (menu, editor, view) so plugins, core
// plugins (Bookmarks, Note composer) and community plugins can attach items. Also hosts the commands
// `editor:set-heading` (heading picker menu), `editor:rename-heading`, `editor:attach-file`,
// `editor:context-menu`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Menu } from '../ui/Menu'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import { getLinkpath } from '../metadata/linktext'
import type { Editor } from './Editor'
import { HIGHLIGHT_COLOR_EMOJI } from './livepreview/widgets'
import { setTableMenuBuilder, tableAtSelection } from './livepreview/table'
import { openGlobalSearch } from '../search/SearchView'

export interface EditorMenuHost {
  app: any
  editor: Editor
  /** The owning MarkdownView (passed to `editor-menu`). */
  view: any
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** `# Heading` line -> heading text (null when the line is not an ATX heading). */
export function headingOfLine(line: string): string | null {
  const m = /^#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
  return m ? m[1] : null
}

export function buildEditorMenu(host: EditorMenuHost, menu = new Menu(), opts: { inTable?: boolean } = {}): Menu {
  const { app, editor: e, view } = host
  const sel = e.getSelection()
  menu.addItem(i => i.setSection('selection-link').setIcon('lucide-link').setTitle('Add link').onClick(() => e.triggerWikilink(false)))
  menu.addItem(i => i.setSection('selection-link').setIcon('lucide-external-link').setTitle('Add external link').onClick(() => e.insertMarkdownLink()))
  if (sel) {
    const shown = sel.length > 20 ? sel.slice(0, 20) + '…' : sel
    menu.addItem(i => i.setSection('selection').setIcon('lucide-search').setTitle(`Search for “${shown.split('\n')[0]}”`).onClick(() => openGlobalSearch(app, sel)))
  }
  menu.addItem(i => {
    const sub = i.setSection('selection').setIcon('lucide-paintbrush').setTitle('Format').setSubmenu()
    const add = (title: string, icon: string, run: () => void, section = 'format') => sub.addItem(x => x.setSection(section).setIcon(icon).setTitle(title).onClick(run))
    add('Bold', 'lucide-bold', () => e.toggleMarkdownFormatting('bold'))
    add('Italic', 'lucide-italic', () => e.toggleMarkdownFormatting('italic'))
    add('Strikethrough', 'lucide-strikethrough', () => e.toggleMarkdownFormatting('strikethrough'))
    sub.addItem(x => {
      const hl = x.setSection('format').setIcon('lucide-highlighter').setTitle('Highlight').setSubmenu()
      hl.addItem(y => y.setIcon('lucide-highlighter').setTitle('Default').onClick(() => e.toggleHighlight()))
      for (const c of Object.keys(HIGHLIGHT_COLOR_EMOJI)) hl.addItem(y => y.setIcon('highlight-swatch').setTitle(cap(c)).onClick(() => e.toggleHighlight(c)))
    })
    add('Code', 'lucide-code-2', () => e.toggleMarkdownFormatting('code'))
    add('Math', 'lucide-sigma', () => e.toggleMarkdownFormatting('math'))
    add('Comment', 'lucide-percent', () => e.toggleComment())
    add('Clear formatting', 'lucide-eraser', () => e.clearMarkdownFormatting())
  })
  menu.addItem(i => {
    const sub = i.setSection('selection').setIcon('lucide-pilcrow').setTitle('Paragraph').setDisabled(!!opts.inTable).setSubmenu()
    const add = (title: string, icon: string, run: () => void, section: string) => sub.addItem(x => x.setSection(section).setIcon(icon).setTitle(title).onClick(run))
    add('Bullet list', 'lucide-list', () => e.toggleBulletList(), 'list')
    add('Numbered list', 'lucide-list-ordered', () => e.toggleNumberList(), 'list')
    add('Task list', 'lucide-check-square', () => e.toggleCheckList(), 'list')
    for (let n = 1; n <= 6; n++) add(`Heading ${n}`, `lucide-heading-${n}`, () => e.setHeading(n), 'heading')
    add('Body', 'lucide-text', () => e.setHeading(0), 'heading')
    add('Quote', 'lucide-quote', () => e.toggleBlockquote(), 'block')
  })
  menu.addItem(i => {
    const sub = i.setSection('selection').setIcon('lucide-list-plus').setTitle('Insert').setDisabled(!!opts.inTable).setSubmenu()
    const add = (title: string, icon: string, run: () => void, section: string) => sub.addItem(x => x.setSection(section).setIcon(icon).setTitle(title).onClick(run))
    add('Footnote', 'lucide-file-signature', () => e.insertFootnote(), 'basic')
    add('Table', 'lucide-table', () => e.insertTable(), 'basic')
    add('Callout', 'lucide-quote', () => e.insertCallout(), 'basic')
    add('Horizontal rule', 'lucide-minus', () => e.insertHorizontalRule(), 'basic')
    add('Code block', 'lucide-code', () => e.insertCodeblock(), 'advanced')
    add('Math block', 'lucide-sigma-square', () => e.insertMathBlock(), 'advanced')
    if (app.commands?.commands?.['bases:create-new']) add('New base', 'lucide-layout-list', () => app.commands.executeCommandById('bases:create-new'), 'advanced')
  })
  const doc = e.cm.dom.ownerDocument
  const clip = (cmd: 'cut' | 'copy') => () => { e.cm.focus(); doc.execCommand(cmd) }
  menu.addItem(i => i.setSection('clipboard').setIcon('lucide-scissors').setTitle('Cut').onClick(clip('cut')))
  menu.addItem(i => i.setSection('clipboard').setIcon('lucide-copy').setTitle('Copy').onClick(clip('copy')))
  menu.addItem(i => i.setSection('clipboard').setIcon('lucide-clipboard-check').setTitle('Paste').onClick(() => { e.cm.focus(); doc.execCommand('paste') }))
  menu.addItem(i => i.setSection('clipboard').setIcon('lucide-clipboard-type').setTitle('Paste as plain text').onClick(async () => {
    try { const t = await navigator.clipboard.readText(); e.cm.focus(); e.replaceSelection(t) } catch { /* clipboard unavailable */ }
  }))
  menu.addItem(i => i.setSection('clipboard').setIcon('lucide-box-select').setTitle('Select all').onClick(() => { e.cm.focus(); e.exec('selectAll') }))
  const heading = headingOfLine(e.getLine(e.getCursor().line))
  if (heading !== null && view?.file) {
    menu.addItem(i => i.setSection('action').setIcon('lucide-edit-3').setTitle('Rename this heading...').onClick(() => new RenameHeadingModal(app, e, view.file, heading).open()))
  }
  app.workspace.trigger('editor-menu', menu, e, view)
  return menu
}

/** Wire right click on the editor (and table cells) to the editor menu. */
export function installEditorMenu(host: EditorMenuHost): () => void {
  const { editor: e } = host
  const onCtx = (ev: MouseEvent) => {
    if ((ev.target as HTMLElement).closest('.cm-table-widget')) return // the table widget builds its own (below)
    ev.preventDefault()
    buildEditorMenu(host).showAtMouseEvent(ev)
  }
  e.cm.contentDOM.addEventListener('contextmenu', onCtx)
  setTableMenuBuilder((menu, _ev, w, row, col) => {
    buildEditorMenu(host, menu, { inTable: true })
    w.addMenuItems(menu, row, col)
  })
  return () => e.cm.contentDOM.removeEventListener('contextmenu', onCtx)
}

/** `editor:context-menu`: the menu at the caret. */
export function showMenuAtCursor(host: EditorMenuHost): void {
  const { editor: e } = host
  const tbl = tableAtSelection(e.cm)
  const c = e.cm.coordsAtPos(e.cm.state.selection.main.head)
  if (!c) return
  const menu = new Menu()
  if (tbl) {
    buildEditorMenu(host, menu, { inTable: true })
    tbl.widget.addMenuItems(menu, tbl.row, tbl.col)
  } else buildEditorMenu(host, menu)
  menu.showAtPosition({ x: c.left, y: c.top })
}

/** `editor:set-heading`: a menu at the caret listing "No heading" and Heading 1-6. */
export function showHeadingMenu(e: Editor): void {
  const menu = new Menu()
  for (let n = 0; n <= 6; n++) {
    menu.addItem(i => i.setIcon(n === 0 ? 'lucide-type' : `lucide-heading-${n}`).setTitle(n === 0 ? 'No heading' : `Heading ${n}`).onClick(() => e.setHeading(n)))
  }
  const c = e.cm.coordsAtPos(e.cm.state.selection.main.head)
  if (c) menu.showAtPosition({ x: c.left, y: c.top })
}

function splitSub(link: string): [string, string | null] {
  const i = link.indexOf('#')
  return i < 0 ? [link, null] : [link.slice(0, i), link.slice(i + 1)]
}

/** Rename heading modal: rewrites the heading line and every link to `file#heading` in the vault. */
export class RenameHeadingModal extends Modal {
  constructor(app: any, private editor: Editor, private file: any, private oldHeading: string) {
    super(app)
    this.titleEl.setText('Rename heading')
  }

  onOpen(): void {
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'prompt-input' })
    input.value = this.oldHeading
    input.focus()
    input.select()
    const go = () => { const v = input.value.trim(); this.close(); if (v && v !== this.oldHeading) void this.rename(v) }
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go() } })
    const btns = this.contentEl.createDiv('modal-button-container')
    btns.createEl('button', { cls: 'mod-cta', text: 'Rename' }).addEventListener('click', go)
    btns.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close())
  }

  async rename(next: string): Promise<void> {
    const { editor, file, oldHeading } = this
    const app: any = this.app
    const pos = editor.getCursor()
    const line = editor.getLine(pos.line)
    const m = /^(#{1,6}[ \t]+)(.*?)((?:[ \t]+#+)?[ \t]*)$/.exec(line)
    if (m) editor.replaceRange(m[1] + next + m[3], { line: pos.line, ch: 0 }, { line: pos.line, ch: line.length })
    const sanitize = (s: string) => s.replace(/([:#|^\\\r\n])/g, ' ').replace(/\s+/g, ' ').trim()
    const oldSub = sanitize(oldHeading), newSub = sanitize(next)
    if (oldSub === newSub) return
    let updated = 0
    for (const src of app.vault.getMarkdownFiles()) {
      if (src.path === file.path) continue
      const cache = app.metadataCache.getFileCache(src)
      const links = ((cache?.links ?? []) as any[]).concat(cache?.embeds ?? []).filter((l: any) => {
        const [path, sub] = splitSub(l.link)
        if (sub === null || sanitize(sub) !== oldSub) return false
        const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(path), src.path)
        return dest?.path === file.path
      })
      if (!links.length) continue
      links.sort((a: any, b: any) => b.position.start.offset - a.position.start.offset)
      await app.vault.process(src, (data: string) => {
        for (const l of links) {
          const s = l.position.start.offset, en = l.position.end.offset
          data = data.slice(0, s) + data.slice(s, en).replace('#' + oldHeading, '#' + newSub).replace('#' + oldSub, '#' + newSub) + data.slice(en)
          updated++
        }
        return data
      })
    }
    if (updated) new Notice(`Updated ${updated} link${updated === 1 ? '' : 's'}`)
  }
}
