// Live Preview block widgets: base, images, embeds, code, callouts, math, html.
//
// Widgets keep their DOM across decoration rebuilds: the block field hands the SAME widget instance
// back to CodeMirror when the source is unchanged (identity equality), and `toDOM` returns the cached
// container, so an unchanged callout/math/embed is never re-rendered while typing.
import { WidgetType } from '@codemirror/view'
import { Menu } from '../../ui/Menu'
import { Modal } from '../../ui/Modal'
import type { EditorView } from '@codemirror/view'
import { sanitizeHTMLToDom as readingSanitize } from '../../markdown/sanitize'
import { renderMermaidBlock } from '../../markdown/postprocessors'
import { setIcon, setTooltip } from '../../workspace/dom'
import { renderMarkdownInto, getCodeBlockProcessors, loadEmbed } from './render'
import { renderMath, finishRenderMath, loadMathJax, isMathLoaded } from './math'

const LABEL_EDIT_BLOCK = 'Edit this block'

// Same sanitizer as the reading view (one sanitizeHTMLToDom everywhere).
let sanitizer: (html: string) => DocumentFragment = html => readingSanitize(html)
export function sanitizeHTMLToDom(html: string): DocumentFragment { return sanitizer(html) }
/** Replace the sanitizer. */
export function setHtmlSanitizer(fn: (html: string) => DocumentFragment) { sanitizer = fn }

function div(cls: string, parent?: HTMLElement): HTMLDivElement {
  const el = document.createElement('div')
  if (cls) el.className = cls
  parent?.appendChild(el)
  return el
}

const owners = new WeakMap<HTMLElement, EmbedWidget>()

/** Base: position tracking, cached DOM, "Edit this block" action, click-to-select. */
export abstract class EmbedWidget extends WidgetType {
  start = -1
  end = -1
  containerEl: HTMLElement | null = null
  actionsEl: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null

  setPos(start: number, end: number) { this.start = start; this.end = end }

  abstract initDOM(view: EditorView): HTMLElement

  toDOM(view: EditorView): HTMLElement {
    return this.containerEl || (this.containerEl = this.initDOM(view))
  }

  /** Widgets are reused by identity only. */
  eq(other: WidgetType): boolean { return other === this }

  addAction(el: HTMLElement, icon: string, tooltip: string, onClick: () => void, cls?: string) {
    if (!this.actionsEl) this.actionsEl = div('embed-actions', el)
    const action = div('embed-action', this.actionsEl)
    setIcon(action, icon)
    setTooltip(action, tooltip)
    if (cls) action.classList.add(cls)
    action.addEventListener('click', onClick)
  }

  addEditButton(view: EditorView, el: HTMLElement) {
    owners.set(el, this)
    this.addAction(el, 'lucide-code-2', LABEL_EDIT_BLOCK, () => EmbedWidget.selectElement(view, el), 'edit-block-button')
  }

  /** Clicking the widget (outside nested editors / interactive children) selects its source. */
  hookClickHandler(view: EditorView, el: HTMLElement) {
    owners.set(el, this)
    el.addEventListener('click', ev => {
      for (let n = ev.target as Node | null; n && n !== view.contentDOM; n = n.parentNode) {
        if (n instanceof HTMLElement && n.matches('.cm-editor, .interactive-child')) return
      }
      EmbedWidget.selectElement(view, el)
    })
  }

  resizeWidget(view: EditorView, el: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return
    if (!this.resizeObserver) this.resizeObserver = new ResizeObserver(() => view.requestMeasure())
    this.resizeObserver.observe(el, { box: 'border-box' })
  }

  destroy() { this.resizeObserver?.disconnect() }

  static selectElement(view: EditorView, el: HTMLElement) {
    const owner = owners.get(el)
    if (!owner || owner.start < 0 || owner.end < 0) {
      try { const pos = view.posAtDOM(el); view.dispatch({ selection: { head: pos, anchor: pos } }); view.focus() } catch { /* detached */ }
      return
    }
    try {
      view.focus()
      view.dispatch({ selection: { head: owner.start, anchor: owner.end }, scrollIntoView: true })
    } catch { /* detached */ }
  }

  ignoreEvent() { return true }
}

// ---- math ----------------------------------------------------------------------------------------

export class MathWidget extends EmbedWidget {
  constructor(readonly math: string, readonly block: boolean) { super() }
  initDOM(view: EditorView) {
    const el = document.createElement(this.block ? 'div' : 'span')
    el.className = 'math'
    this.containerEl = el
    if (this.block) {
      el.appendChild(document.createElement('br'))
      el.appendChild(document.createElement('br'))
      this.addEditButton(view, el)
    }
    this.hookClickHandler(view, el)
    this.resizeWidget(view, el)
    if (isMathLoaded()) this.render(el)
    else void loadMathJax().then(() => this.render(el))
    return el
  }
  render(el: HTMLElement) {
    el.classList.toggle('math-block', this.block)
    el.classList.toggle('cm-embed-block', this.block)
    while (el.firstChild) el.removeChild(el.firstChild)
    try { el.appendChild(renderMath(this.math, this.block)) } catch { el.appendChild(document.createTextNode(this.math)) }
    if (this.actionsEl) el.appendChild(this.actionsEl)
    finishRenderMath()
  }
  get estimatedHeight() { return 50 }
}

// ---- html ----------------------------------------------------------------------------------------

/** Tags whose HTML is never rendered in Live Preview. */
export const HTML_EXCLUDED_TAGS = ['script', 'style', 'link', 'meta', 'object', 'embed', 'webview']

const inlineTagCache = new Map<string, boolean>()
/** Elements the UA stylesheet does not lay out inline (used where computed style is unavailable). */
const UA_BLOCK_TAGS = new Set(('address article aside blockquote body center dd details dialog dir div dl dt fieldset figcaption figure ' +
  'footer form frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li link main menu meta nav noframes ol optgroup option p ' +
  'pre script search section style summary table tbody td tfoot th thead title tr ul area base datalist noembed noscript param rp template').split(' '))
/** Whether `tag` lays out inline (decides inline vs block HTML widgets). */
export function isInlineTag(tag: string): boolean {
  if (!tag || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag)) return false
  const known = inlineTagCache.get(tag)
  if (known !== undefined) return known
  if ((window as any).happyDOM) return !UA_BLOCK_TAGS.has(tag.toLowerCase())
  let display = ''
  let el: HTMLElement | null = null
  try {
    el = document.createElement(tag)
    document.body.appendChild(el)
    display = getComputedStyle(el).display
  } catch { /* invalid */ }
  if (el) document.body.removeChild(el)
  const inline = !!display && display.startsWith('inline')
  inlineTagCache.set(tag, inline)
  return inline
}

export class HtmlWidget extends EmbedWidget {
  constructor(readonly html: string, readonly block: boolean, readonly fixLinks?: (el: HTMLElement) => void) { super() }
  initDOM(view: EditorView) {
    const el = document.createElement(this.block ? 'div' : 'span')
    el.className = 'cm-html-embed' + (this.block ? ' cm-embed-block' : '')
    this.containerEl = el
    el.tabIndex = -1
    el.appendChild(sanitizeHTMLToDom(this.html))
    if (this.block) this.addEditButton(view, el)
    this.fixLinks?.(el)
    this.hookClickHandler(view, el)
    this.resizeWidget(view, el)
    return el
  }
  get estimatedHeight() { return 40 }
}

// ---- rendered code blocks (mermaid / query / registered processors) -------------------------------

export class CodeBlockWidget extends EmbedWidget {
  lineStart = 0
  lineEnd = 0
  private trustRef: any = null
  private trustWs: any = null
  destroy() { if (this.trustRef) this.trustWs?.offref?.(this.trustRef); this.trustRef = null; super.destroy() }
  constructor(readonly lang: string, public code: string, readonly sourcePath: string) { super() }
  initDOM(view: EditorView) {
    const { lang, code } = this
    const el = div('cm-preview-code-block cm-embed-block markdown-rendered cm-lang-' + lang)
    this.containerEl = el
    el.tabIndex = -1
    const pre = el.appendChild(document.createElement('pre'))
    const codeEl = pre.appendChild(document.createElement('code'))
    codeEl.className = 'language-' + lang
    const processors = getCodeBlockProcessors()
    const handler = processors[lang]
    if (lang === 'mermaid' && !handler) {
      // Per-vault trust gate (localStorage `mermaid-vault-trust`), re-rendered when it changes.
      while (el.firstChild) el.removeChild(el.firstChild)
      const draw = () => { if (this.code !== undefined) renderMermaidBlock(el, this.code); this.addEditButton(view, el) }
      draw()
      const ws = (window as any).app?.workspace
      if (ws?.on && !this.trustRef) { this.trustRef = ws.on('post-processor-change', () => { if (el.isConnected) { while (el.firstChild) el.removeChild(el.firstChild); this.actionsEl = null; draw() } }); this.trustWs = ws }
      this.resizeWidget(view, el)
      return el
    }
    if (handler) {
      while (el.firstChild) el.removeChild(el.firstChild)
      const target = div('block-language-' + lang, el)
      try {
        handler(code, target, {
          docId: Math.random().toString(16).slice(2, 18), sourcePath: this.sourcePath, frontmatter: {}, promises: [],
          addChild: () => {},
          getSectionInfo: (n: HTMLElement) => el.contains(n) ? { lineStart: this.lineStart, lineEnd: this.lineEnd, text: view.state.doc.toString() } : null,
          replace: (text: string) => view.dispatch({ changes: { from: view.state.doc.line(this.lineStart + 1).from, to: view.state.doc.line(this.lineEnd + 1).to, insert: text } }),
          replaceCode: (text: string) => { const { start, end } = this; this.code = text; this.end = start + text.length; view.dispatch({ changes: { from: start, to: end, insert: text } }) },
          containerEl: view.scrollDOM, el: target
        })
      } catch (e) {
        console.error(e)
        while (el.firstChild) el.removeChild(el.firstChild)
        const p = el.appendChild(document.createElement('pre'))
        const c = p.appendChild(document.createElement('code'))
        c.className = 'language-' + lang
        c.textContent = code
      }
    } else codeEl.textContent = code
    this.addEditButton(view, el)
    this.resizeWidget(view, el)
    return el
  }
  get estimatedHeight() { return 50 }
}

// ---- callouts ------------------------------------------------------------------------------------

const CALLOUT_MENU_TYPES = ['info', 'important', 'tip', 'success', 'question', 'warning', 'example', 'quote']

export class CalloutWidget extends EmbedWidget {
  constructor(readonly text: string, readonly sourcePath: string, readonly config: { rtl?: boolean; indentGuide?: boolean } = {}) { super() }
  initDOM(view: EditorView) {
    const el = div('cm-embed-block cm-callout')
    this.containerEl = el
    el.tabIndex = -1
    const body = div('markdown-rendered', el)
    body.classList.toggle('rtl', !!this.config.rtl)
    body.classList.toggle('show-indentation-guide', this.config.indentGuide !== false)
    void renderMarkdownInto(body, this.text, this.sourcePath)
    this.hookClickHandler(view, el)
    this.addEditButton(view, el)
    this.resizeWidget(view, el)
    el.addEventListener('contextmenu', ev => this.showTypeMenu(view, ev))
    return el
  }

  /** `[!type]` position inside the first line of the callout source. */
  private typeRange(view: EditorView): [number, number] {
    const line = view.state.doc.lineAt(this.start)
    const from = line.text.indexOf('[!') + 2
    return [line.from + from, line.from + line.text.indexOf(']', from)]
  }

  /** Right click: Edit | Callout type submenu (types, Other..., None = unwrap). */
  private showTypeMenu(view: EditorView, ev: MouseEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    const [a, b] = this.typeRange(view)
    const current = view.state.doc.sliceString(a, b)
    const menu = Menu.forEvent(ev).setNoIcon().addSections(['edit', 'clipboard', 'type', '', 'danger'])
    menu.addItem(i => i.setTitle('Edit').setSection('edit').onClick(() => { view.focus(); view.dispatch({ selection: { anchor: this.start } }) }))
    menu.setSectionSubmenu('type', { title: 'Callout type' })
    const update = (type: string) => { const [x, y] = this.typeRange(view); view.dispatch({ changes: { from: x, to: y, insert: type } }) }
    for (const t of CALLOUT_MENU_TYPES) menu.addItem(i => i.setTitle(t[0].toUpperCase() + t.slice(1)).setSection('type').setChecked(t === current).onClick(() => update(t)))
    menu.addItem(i => i.setTitle('Other...').setSection('type').onClick(() => {
      const m = new Modal((window as any).app)
      m.titleEl.setText('Callout type')
      const input = m.contentEl.createEl('input', { type: 'text', cls: 'prompt-input', attr: { placeholder: 'Callout type...' } })
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); m.close(); if (v) update(v) } })
      m.open()
      input.focus()
    }))
    menu.addItem(i => i.setTitle('None').setSection('type').onClick(() => {
      const doc = view.state.doc
      const first = doc.lineAt(this.start), last = doc.lineAt(this.end)
      const changes = [{ from: first.from, to: Math.min(doc.length, first.to + 1), insert: '' }]
      for (let n = first.number + 1; n <= last.number; n++) {
        const l = doc.line(n)
        const m = /^\s*>[ ]?/.exec(l.text)
        changes.push({ from: l.from, to: l.from + (m ? m[0].length : 0), insert: '' })
      }
      view.dispatch({ changes })
    }))
  }
  get estimatedHeight() {
    let n = 1
    for (let i = 0; i < this.text.length; i++) if (this.text.charCodeAt(i) === 10) n++
    return n * 24
  }
}

// ---- embeds & images -----------------------------------------------------------------------------

/** Parse `alt|100x200` / `100` into width/height/alt. */
export function parseImageSize(title: string): { width: number; height: number; alt: string } {
  let width = 0, height = 0
  const size = (s: string) => {
    const m = s.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/)
    if (!m) return false
    width = parseInt(m[1]); height = m[2] ? parseInt(m[2]) : 0
    return true
  }
  if (title) {
    const bar = title.lastIndexOf('|')
    if (bar !== -1) { if (size(title.substr(bar + 1))) title = title.substr(0, bar) }
    else if (size(title)) title = ''
  }
  return { width, height, alt: title }
}

function applyImageTitle(img: HTMLElement, url: string, title: string) {
  const { width, height } = parseImageSize(title)
  let { alt } = parseImageSize(title)
  if (!alt) { const i = url.lastIndexOf('/'); alt = i === -1 ? url : url.slice(i + 1) }
  setOrRemove(img, 'width', width === 0 ? null : String(width))
  setOrRemove(img, 'height', height === 0 ? null : String(height))
  img.setAttribute('alt', alt)
}

function setOrRemove(el: HTMLElement, attr: string, v: string | null) {
  if (v == null) el.removeAttribute(attr)
  else el.setAttribute(attr, v)
}

/** External (or vault-resource) markdown image `![alt](url)`: `div.image-embed > div.image-wrapper > img`. */
export class ImageWidget extends EmbedWidget {
  constructor(readonly url: string, public title: string) { super() }
  initDOM(view: EditorView) {
    const el = div('image-embed')
    el.setAttribute('tabindex', '-1')
    const wrapper = div('image-wrapper', el)
    const img = wrapper.appendChild(document.createElement('img'))
    img.src = this.url
    applyImageTitle(img, this.url, this.title)
    div('image-resize-corner', wrapper)
    this.containerEl = el
    this.addAction(el, 'lucide-zoom-in', 'Zoom in', () => {})
    this.addAction(el, 'lucide-code-2', LABEL_EDIT_BLOCK, () => EmbedWidget.selectElement(view, el), 'edit-block-button')
    owners.set(el, this)
    img.addEventListener('click', ev => { if (!ev.defaultPrevented) EmbedWidget.selectElement(view, el) })
    this.resizeWidget(view, el)
    return el
  }
  applyTitle(title: string) {
    this.title = title
    const img = this.containerEl?.querySelector('img')
    if (img) applyImageTitle(img, this.url, title)
  }
  get estimatedHeight() { return 30 }
}

/** Internal embed `![[target|title]]`: `div.internal-embed[src][alt]`, filled by the embed loader. */
export class InternalEmbedWidget extends EmbedWidget {
  constructor(readonly href: string, public title: string, readonly sourcePath: string, readonly isImage: boolean) { super() }
  initDOM(view: EditorView) {
    const el = div('internal-embed')
    el.tabIndex = -1
    el.setAttribute('src', this.href)
    this.containerEl = el
    const loaded = loadEmbed(el, this.href, this.sourcePath)
    this.applyTitle(this.title)
    if (!loaded || !this.isImage) this.addEditButton(view, el)
    else this.hookClickHandler(view, el)
    this.resizeWidget(view, el)
    return el
  }
  applyTitle(title: string) {
    this.title = title
    const el = this.containerEl
    if (!el) return
    const { width, height, alt } = parseImageSize(title)
    setOrRemove(el, 'alt', alt || null)
    setOrRemove(el, 'width', width === 0 ? null : String(width))
    setOrRemove(el, 'height', height === 0 ? null : String(height))
  }
  get estimatedHeight() { return 100 }
}
