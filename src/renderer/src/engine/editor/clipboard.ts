// Editor clipboard: Turndown, handleDataTransfer, copy/paste hooks, tryPasteUrl,
// tryCollapseListMarker.
//
// Paste: the data transfer is converted (app HTML with our marker -> plain; text/markdown;
// HTML -> Markdown through Turndown when `autoConvertHtml`; uri-list + text -> markdown link). Then
//   1. a URL pasted over non-empty single-line selections becomes `[selection](url)`,
//   2. a list item pasted onto a list marker merges the markers (smart lists),
//   3. converted text replaces the selection ("input.paste"), files go to the attachment handler,
//   4. otherwise CodeMirror's default paste runs.
// Copy writes `text/markdown` and `text/html` (marker + rendered HTML) next to `text/plain`.
import { EditorSelection } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import TurndownService from 'turndown'
import { LIST_RE } from './livepreview/inline'
import { sanitizeHTMLToDom } from './livepreview/blockWidgets'
import type { AttachmentManager } from './attachments'

export const HTML_PASTE_MARKER = '<!-- obsidian -->'

export interface ClipboardOptions {
  config: () => { autoConvertHtml: boolean; smartIndentList: boolean }
  /** Render markdown to HTML for `text/html` on copy. */
  renderHtml?: (markdown: string) => string
  /** Pasted / dropped files and in-app drags (attachments, link drops). */
  attachments?: AttachmentManager
  /** Pasted `data:` images (> 1000 chars) to save as "Pasted image" attachments. */
  saveDataImage?: (dataUrl: string) => void
}

const clean = (s: string | null) => (s ? s.replace(/(\n+\s*)+/g, '\n') : '')

let turndownService: TurndownService | null = null
/** Shared Turndown instance. */
export function getTurndown(): TurndownService {
  if (turndownService) return turndownService
  const td = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', fence: '```', linkStyle: 'inlined' })
  td.remove(['script', 'style', 'title'])
  td.addRule('strikethrough', { filter: ['del', 's'], replacement: c => '~~' + c + '~~' })
  td.addRule('highlight', { filter: ['mark'], replacement: c => '==' + c + '==' })
  td.addRule('link', {
    filter: (node, opts) => opts.linkStyle === 'inlined' && node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content, node) => {
      if (!(node instanceof Element)) return content
      let href = node.getAttribute('href')
      if (href) href = href.replace(/ /g, '%20').replace(/([()])/g, '\\$1')
      let title = clean(node.getAttribute('title'))
      if (title) title = ' "' + title.replace(/"/g, '\\"') + '"'
      return '[' + content + '](' + href + title + ')'
    }
  })
  td.addRule('media', {
    filter: ['img'],
    replacement: (content, node) => {
      if (!(node instanceof Element)) return content
      const alt = clean(node.getAttribute('alt'))
      let src = node.getAttribute('src') || ''
      if (src) src = src.replace(/ /g, '%20').replace(/([()])/g, '\\$1')
      let title = clean(node.getAttribute('title'))
      if (title) title = ' "' + title.replace(/"/g, '\\"') + '"'
      return src ? '![' + alt + '](' + src + title + ')' : ''
    }
  })
  const hlRe = /highlight-(?:text|source)-([a-z0-9]+)/
  td.addRule('highlightedCodeBlock', {
    filter: node => { const f = node.firstChild; return node.nodeName === 'DIV' && hlRe.test(node.className) && !!f && f.nodeName === 'PRE' },
    replacement: (_c, node, opts) => {
      const lang = ((node as HTMLElement).className.match(hlRe) || [null, ''])[1]
      return '\n\n' + opts.fence + lang + '\n' + node.firstChild!.textContent + '\n' + opts.fence + '\n\n'
    }
  })
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, opts) => {
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ')
      let prefix = opts.bulletListMarker + ' '
      const parent = node.parentNode as HTMLElement
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start')
        const idx = Array.prototype.indexOf.call(parent.children, node)
        prefix = (start ? Number(start) + idx : idx + 1) + '. '
      }
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
    }
  })
  td.addRule('taskListItems', {
    filter: node => node instanceof HTMLInputElement && node.type === 'checkbox' && node.parentNode!.nodeName === 'LI',
    replacement: (_c, node) => ((node as HTMLInputElement).checked ? '[x] ' : '[ ] ')
  })
  const colspan = (el: Element) => { const v = el.getAttribute('colspan'); if (!v) return 0; const n = parseInt(v); return isNaN(n) ? 0 : Math.max(0, n - 1) }
  const isHeadingRow = (tr: Element | null) => {
    if (!tr) return false
    const parent = tr.parentNode as Element
    const prevIsEmptyHead = (sec: Element) => { const p = sec.previousSibling as Element | null; return sec.nodeName === 'TBODY' && (!p || (p.nodeName === 'THEAD' && /^\s*$/i.test(p.textContent || ''))) }
    return parent.nodeName === 'THEAD' || (parent.firstChild === tr && (parent.nodeName === 'TABLE' || prevIsEmptyHead(parent)) &&
      Array.prototype.every.call(tr.childNodes, (n: Node) => n.nodeName === 'TH'))
  }
  td.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const first = Array.prototype.indexOf.call(node.parentNode!.childNodes, node) === 0
      return (first ? '|' : '') + content.trim().replace(/\|+/g, '\\|').replace(/\n\r?/g, '<br>') + '|' + '   |'.repeat(colspan(node as Element))
    }
  })
  const aligns: Record<string, string> = { left: ':--', right: '--:', center: ':-:' }
  td.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      let sep = ''
      const tr = node as HTMLTableRowElement
      if (isHeadingRow(tr)) {
        for (let i = 0; i < tr.cells.length; i++) {
          const cell = tr.cells[i]
          const a = aligns[(cell.getAttribute('align') || '').toLowerCase()] || '---'
          sep += (i === 0 ? '|' : '') + a + '|' + (a + '|').repeat(colspan(cell))
        }
      }
      return '\n' + content + (sep ? '\n' + sep : '')
    }
  })
  td.addRule('table', {
    filter: 'table',
    replacement: (content, node) => {
      const first = (node as HTMLTableElement).rows[0]
      if (!isHeadingRow(first)) {
        let n = first.cells.length
        for (let i = 0; i < first.cells.length; i++) n += colspan(first.cells[i])
        content = '|' + '   |'.repeat(n) + '\n|' + '---|'.repeat(n) + '\n' + content.replace(/^[\r\n]+/, '')
      }
      return '\n\n' + content.replace(/[\r\n]+/g, '\n') + '\n\n'
    }
  })
  td.addRule('tableSection', { filter: ['thead', 'tbody', 'tfoot'], replacement: c => c })
  td.escape = (s: string) => s
  return (turndownService = td)
}

export function htmlToMarkdown(html: string): string { return getTurndown().turndown(html) }

/** isUrl: parses as a URL and has no spaces. */
export function isUrl(text: string): boolean {
  if (!text || text.includes(' ')) return false
  try { new URL(text); return true } catch { return false }
}

/** Converted text for a paste / drop, or null to fall back to plain text. */
export function convertDataTransfer(dt: DataTransfer, opts: ClipboardOptions): string | null {
  const html = dt.getData('text/html')
  if (html && html.includes(HTML_PASTE_MARKER) && dt.getData('text/plain')) return null
  const md = dt.getData('text/markdown')
  if (md) return md
  if (html) {
    if (!opts.config().autoConvertHtml) return null
    const frag = sanitizeHTMLToDom(html)
    const div = document.createElement('div')
    div.appendChild(frag)
    if (dt.files && dt.files.length > 0 && /^<img [^>]+>$/.test(div.innerHTML.trim())) return null
    for (const el of Array.from(div.querySelectorAll('img, audio, video')) as (HTMLImageElement | HTMLMediaElement)[]) {
      const src = el.getAttribute('src') || ''
      if (src.startsWith('data:') && src.length > 1000) { opts.saveDataImage?.(src); el.remove() }
    }
    return htmlToMarkdown(div.innerHTML.trim())
  }
  const uri = dt.getData('text/uri-list')
  if (uri) {
    const plain = dt.getData('text/plain') || ''
    if (!plain) return uri
    if (uri.toLowerCase() !== plain.toLowerCase() && decodeURIComponent(uri.toLowerCase()) !== plain.toLowerCase()) {
      const name = uri.slice(uri.lastIndexOf('/') + 1)
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
      const link = '[' + plain + '](' + uri + ')'
      return ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext) ? '!' + link : link
    }
  }
  return null
}

/** URL over non-empty single-line selections -> `[sel](url)` (one URL per selection allowed). */
export function tryPasteUrl(view: EditorView, text: string): boolean {
  const { doc, selection } = view.state
  if (!selection.ranges.some(r => !r.empty)) return false
  if (!selection.ranges.every(r => r.empty || doc.lineAt(r.from).number === doc.lineAt(r.to).number)) return false
  let urls: string[]
  if (!text.includes('\n') && isUrl(text)) urls = selection.ranges.map(() => text)
  else {
    const lines = text.split('\n')
    if (lines.length !== selection.ranges.length || !lines.every(isUrl)) return false
    urls = lines
  }
  const changes = selection.ranges.map((r, i) => ({ from: r.from, to: r.to, insert: r.empty ? urls[i] : '[' + doc.sliceString(r.from, r.to) + '](' + urls[i] + ')' }))
  view.dispatch({ changes, userEvent: 'input.paste' })
  return true
}

/** Pasting `- item` onto an existing `- ` marker merges the markers. */
export function collapseListMarker(state: EditorState, text: string) {
  const ranges = state.selection.ranges
  const parts = text.split('\n')
  const perRange = ranges.length > 1 && parts.length === ranges.length
  let merged = false
  let i = 0
  const tr = state.changeByRange(r => {
    const chunk = perRange ? parts[i] : text
    i++
    const { from, to } = r
    const line = state.doc.lineAt(from)
    const before = state.doc.sliceString(line.from, from)
    const cur = LIST_RE.exec(before)
    const pasted = LIST_RE.exec(chunk.split('\n', 1)[0])
    if (!cur?.[2] || cur[0] !== before || !pasted?.[2]) return { changes: { from, to, insert: chunk }, range: EditorSelection.cursor(from + chunk.length) }
    merged = true
    const indent = cur[1], marker = cur[3]
    const task = pasted[6] ?? cur[6]
    const insert = marker + (task ? `[${task}] ` : '') + chunk.substring(pasted[0].length)
    const at = line.from + indent.length
    return { changes: { from: at, to, insert }, range: EditorSelection.cursor(at + insert.length) }
  })
  return merged ? { ...tr, userEvent: 'input.paste', scrollIntoView: true } : null
}

export function clipboardExtensions(opts: ClipboardOptions) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const dt = event.clipboardData
      if (!dt) return false
      const converted = convertDataTransfer(dt, opts)
      const text = converted || dt.getData('text/plain')
      const done = () => { event.preventDefault(); return true }
      if (text && tryPasteUrl(view, text)) return done()
      if (text && opts.config().smartIndentList) {
        const tr = collapseListMarker(view.state, text)
        if (tr) { view.dispatch(tr); return done() }
      }
      if (converted) {
        view.dispatch(view.state.replaceSelection(converted), { userEvent: 'input.paste', scrollIntoView: true })
        return done()
      }
      if (opts.attachments?.handlePasteFiles(dt)) return done()
      return false
    },
    dragover(event) {
      opts.attachments?.handleDragOver(event)
      return false
    },
    drop(event, view) {
      return !!opts.attachments?.handleDrop(event, view, dt => convertDataTransfer(dt, opts))
    },
    copy(event, view) { return writeCopyData(event, view, opts, false) },
    cut(event, view) { return writeCopyData(event, view, opts, true) },
    dragstart(event) { event.dataTransfer?.clearData('text/html'); return false }
  })
}

/** Copy / cut: text/plain like CodeMirror (whole lines for empty selections) + text/markdown + text/html. */
function writeCopyData(event: ClipboardEvent, view: EditorView, opts: ClipboardOptions, cut: boolean): boolean {
  const dt = event.clipboardData
  if (!dt) return false
  const { state } = view
  let ranges = state.selection.ranges.filter(r => !r.empty).map(r => ({ from: r.from, to: r.to }))
  let linewise = false
  if (!ranges.length) {
    linewise = true
    let upto = -1
    ranges = []
    for (const r of state.selection.ranges) {
      const line = state.doc.lineAt(r.from)
      if (line.number > upto) { ranges.push({ from: line.from, to: Math.min(state.doc.length, line.to + 1) }); upto = line.number }
    }
  }
  const text = ranges.map(r => state.sliceDoc(r.from, r.to)).join(linewise ? '' : state.lineBreak)
  if (!text) return false
  dt.clearData()
  dt.setData('text/plain', text)
  dt.setData('text/markdown', text)
  if (text.length <= 1e6 && opts.renderHtml) dt.setData('text/html', HTML_PASTE_MARKER + opts.renderHtml(text))
  event.preventDefault()
  if (cut && !state.readOnly) view.dispatch({ changes: ranges, scrollIntoView: true, userEvent: 'delete.cut' })
  return true
}
