/* eslint-disable @typescript-eslint/no-explicit-any */
// `![[…]]` embed loading: `.internal-embed:not(.is-loaded)` spans are
// resolved through the injected link resolver and handed to a creator chosen by extension.
// Depth limit 5, then a generic file box; unresolved targets get the "not created yet" /
// "could not be found" boxes.
import { Component } from '../core/Component'
import { setIcon } from './icons'
import { getMarkdownHost } from './host'
import { parseMarkdown, mdastToHtml, getFrontMatter } from './pipeline'
import { sanitizeHTMLToDom } from './sanitize'

export interface EmbedContext {
  app?: unknown
  linktext: string
  sourcePath: string
  containerEl: HTMLElement
  displayMode?: boolean
  showInline?: boolean
  depth: number
}
export interface EmbedComponent extends Component {
  loadFile(): Promise<void>
}
export type EmbedCreator = (ctx: EmbedContext, path: string, subpath: string) => EmbedComponent | null

export const IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus']
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'mkv']
export const PDF_EXTENSIONS = ['pdf']
export const MARKDOWN_EXTENSIONS = ['md']

const depthByEl = new WeakMap<Element, number>()
/** Embed nesting depth of an element (walks up to the nearest loaded embed). */
export function embedDepth(el: Element | null): number {
  while (el) {
    if (depthByEl.has(el)) return depthByEl.get(el)!
    el = el.parentElement
  }
  return 0
}

/** Split `path#sub`. */
export function splitLinktext(linktext: string): { path: string; subpath: string } {
  const i = linktext.indexOf('#')
  if (i === -1) return { path: linktext, subpath: '' }
  return { path: linktext.substring(0, i), subpath: linktext.substring(i) }
}

function extname(path: string): string {
  const base = path.substring(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.substring(i + 1).toLowerCase()
}
function basename(path: string): string {
  const base = path.substring(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i <= 0 ? base : base.substring(0, i)
}

class MediaEmbed extends Component implements EmbedComponent {
  constructor(public ctx: EmbedContext, public path: string, public kind: 'image' | 'audio' | 'video') {
    super()
    ctx.containerEl.addClass('media-embed', kind + '-embed')
  }
  async loadFile(): Promise<void> {
    const el = this.ctx.containerEl
    const url = getMarkdownHost().getResourcePath(this.path)
    if (this.kind === 'image') {
      const img = el.createEl('img', { attr: { alt: el.getAttr('alt') || null } })
      const w = el.getAttr('width')
      const h = el.getAttr('height')
      if (w) img.setAttr('width', w)
      if (h) img.setAttr('height', h)
      await waitFor(img, ['load', 'error'], () => (img.src = url))
    } else if (this.kind === 'audio') {
      await audio(el, url)
    } else {
      const video = el.createEl('video', { attr: { controls: '', preload: 'metadata' } })
      await new Promise<void>((resolve) => {
        let timer = 0
        const done = () => {
          clearTimeout(timer)
          video.style.height = ''
          resolve()
        }
        video.addEventListener('loadedmetadata', () => {
          if (video.videoWidth === 0 && video.videoHeight === 0) {
            video.src = ''
            el.removeChild(video)
            audio(el, url).then(done, done)
          } else done()
        })
        video.addEventListener('error', done)
        video.style.height = '0'
        timer = window.setTimeout(done, 5000)
        video.src = url + '#t=0.001'
      })
    }
  }
}
function audio(el: HTMLElement, url: string): Promise<void> {
  const a = el.createEl('audio', { attr: { controls: '', controlsList: 'nodownload' } })
  return waitFor(a, ['loadedmetadata', 'error'], () => (a.src = url))
}
function waitFor(el: HTMLElement, events: string[], start: () => void): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    for (const e of events) el.addEventListener(e, done)
    window.setTimeout(done, 5000)
    start()
  })
}

class PdfEmbed extends Component implements EmbedComponent {
  constructor(public ctx: EmbedContext, public path: string, public subpath: string) {
    super()
    ctx.containerEl.addClass('pdf-embed')
  }
  async loadFile(): Promise<void> {
    // pdf.js viewer is out of scope here: Chromium's built-in viewer via <iframe>, honouring #page / #height.
    const el = this.ctx.containerEl
    const params = new URLSearchParams(this.subpath.replace(/^#/, ''))
    const frame = el.createEl('iframe')
    let url = getMarkdownHost().getResourcePath(this.path)
    const page = params.get('page')
    if (page) url += '#page=' + page
    const height = params.get('height')
    if (height) el.style.height = height + 'px'
    frame.src = url
  }
}

class GenericEmbed extends Component implements EmbedComponent {
  constructor(public ctx: EmbedContext, public path: string) {
    super()
    const el = ctx.containerEl
    el.addClass('file-embed', 'mod-generic')
    el.createDiv({ cls: 'file-embed-title' }, (t: HTMLElement) => {
      t.createSpan({ cls: 'file-embed-icon' }, (i: HTMLElement) => setIcon(i, 'lucide-file'))
      t.appendText(' ' + path.substring(path.lastIndexOf('/') + 1))
    })
  }
  async loadFile(): Promise<void> {
    this.ctx.containerEl.addEventListener('click', (e) => {
      getMarkdownHost().openLinkText(this.ctx.linktext, this.ctx.sourcePath, e.ctrlKey || e.metaKey)
    })
  }
}

class UnresolvedEmbed extends Component implements EmbedComponent {
  constructor(public ctx: EmbedContext) {
    super()
  }
  onClick = (e: MouseEvent): void => {
    getMarkdownHost().openLinkText(this.ctx.linktext, this.ctx.sourcePath, e.ctrlKey || e.metaKey)
  }
  async loadFile(): Promise<void> {
    const el = this.ctx.containerEl
    const linktext = this.ctx.linktext
    el.addClass('file-embed')
    if (getMarkdownHost().canCreate(splitLinktext(linktext).path || linktext)) {
      el.addClass('mod-empty')
      el.appendText(`“${linktext}” is not created yet. Click to create.`)
      el.addEventListener('click', this.onClick)
    } else {
      el.addClass('mod-empty-attachment')
      el.appendText(`“${linktext}” could not be found.`)
    }
  }
}

/** Markdown note / section embed (reading-mode DOM). */
class MarkdownEmbed extends Component implements EmbedComponent {
  headerEl: HTMLElement | null = null
  constructor(public ctx: EmbedContext, public path: string, public subpath: string) {
    super()
    const el = ctx.containerEl
    el.addClass('markdown-embed')
    if (ctx.showInline) {
      el.addClass('inline-embed')
      this.headerEl = el.createDiv({ cls: 'embed-title markdown-embed-title', prepend: true })
    }
    if (!ctx.displayMode) {
      el.createDiv('markdown-embed-link', (l: HTMLElement) => {
        setIcon(l, 'lucide-maximize-2')
        l.setAttr('aria-label', 'Open link')
        l.addEventListener('click', (e) => {
          if (e.button !== 0 && e.button !== 1) return
          e.preventDefault()
          getMarkdownHost().openLinkText(this.path + this.subpath, ctx.sourcePath, e.ctrlKey || e.metaKey)
        })
      })
    }
  }
  async loadFile(): Promise<void> {
    const host = getMarkdownHost()
    let text = await host.readFile(this.path)
    if (this.subpath) {
      const range = resolveSubpath(text, this.subpath)
      if (range) text = text.substring(range.start, range.end)
    }
    if (!this.subpath) this.headerEl?.setText(basename(this.path))
    // Reference structure: [title] > content > .markdown-preview-view > sizer section (pusher, header with inline
    // title + collapsed properties, el-* sections), then an empty content slot and the Open-link button last.
    const el = this.ctx.containerEl
    const content = el.createDiv('markdown-embed-content')
    const { EmbedRenderer } = await import('./MarkdownRenderer')
    const r = new EmbedRenderer(this.ctx.app ?? null, content, this.path)
    this.addChild(r)
    const preview = r.renderer.previewEl
    preview.toggleClass('rtl', !!host.getConfig('rightToLeft'))
    preview.toggleClass('show-indentation-guide', host.getConfig('showIndentGuide') !== false)
    preview.toggleClass('allow-fold-headings', host.getConfig('foldHeading') !== false)
    preview.toggleClass('allow-fold-lists', host.getConfig('foldIndent') !== false)
    preview.toggleClass('show-properties', host.getConfig('propertiesInDocument') !== 'hidden')
    r.renderer.addHeader()
    const title = r.renderer.header!.el.createDiv({ cls: 'inline-title', text: basename(this.path).replace(/\.md$/, '') })
    title.tabIndex = -1
    r.renderer.header!.el.createDiv({ cls: 'metadata-container is-collapsed', attr: { tabindex: '-1' } })
    r.renderer.set(text)
    await new Promise<void>(res => r.renderer.onRendered(res))
    el.createDiv('markdown-embed-content')
    const link = el.querySelector(':scope > .markdown-embed-link')
    if (link) el.appendChild(link)
  }
}

export function randomDocId(): string {
  let s = ''
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// --- subpath resolution ------------------------------------------------------

/** Heading text normalisation for `#A#B` matching (punctuation-insensitive, case-insensitive). */
function normHeading(s: string): string {
  return s
    .replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Source range for `#Heading#Sub`, `#^block` or `#[^footnote]` (null if not found). */
export function resolveSubpath(text: string, subpath: string): { start: number; end: number } | null {
  const tree = parseMarkdown(text)
  const kids: any[] = tree.children
  const sub = subpath.replace(/^#/, '')
  if (sub.startsWith('[^') && sub.endsWith(']')) {
    const id = sub.slice(2, -1).toLowerCase()
    for (const n of kids) if (n.type === 'footnoteDefinition' && n.identifier === id) return { start: n.position.start.offset, end: n.position.end.offset }
    return null
  }
  if (sub.startsWith('^')) {
    const id = sub.substring(1)
    let found: any = null
    const walk = (n: any): void => {
      if (found) return
      if (n.id === id && n.position) {
        found = n
        return
      }
      for (const c of n.children || []) walk(c)
    }
    for (const n of kids) walk(n)
    return found ? { start: found.position.start.offset, end: found.position.end.offset } : null
  }
  const parts = sub.split('#').filter((x) => !!x).map(normHeading)
  if (parts.length === 0) return null
  let pi = 0
  let level = 0
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]
    if (n.type !== 'heading') continue
    if (pi > 0 && n.depth <= level && pi < parts.length) {
      // left the parent heading's scope before matching the full path
    }
    const txt = normHeading(text.substring(n.children[0]?.position.start.offset ?? n.position.end.offset, n.children[n.children.length - 1]?.position.end.offset ?? n.position.end.offset))
    if (txt === parts[pi] && (pi === 0 || n.depth > level)) {
      level = n.depth
      pi++
      if (pi === parts.length) {
        let end = text.length
        for (let j = i + 1; j < kids.length; j++) {
          if (kids[j].type === 'heading' && kids[j].depth <= n.depth) {
            end = kids[j].position.start.offset
            break
          }
        }
        return { start: n.position.start.offset, end }
      }
    }
  }
  return null
}

// --- registry -----------------------------------------------------------------

export class EmbedRegistry {
  embedByExtension: Record<string, EmbedCreator> = {}
  constructor() {
    this.registerExtensions(MARKDOWN_EXTENSIONS, (ctx, path, sub) => new MarkdownEmbed(ctx, path, sub))
    this.registerExtensions(IMAGE_EXTENSIONS, (ctx, path) => new MediaEmbed(ctx, path, 'image'))
    this.registerExtensions(AUDIO_EXTENSIONS, (ctx, path) => new MediaEmbed(ctx, path, 'audio'))
    this.registerExtensions(VIDEO_EXTENSIONS, (ctx, path) => new MediaEmbed(ctx, path, 'video'))
    this.registerExtensions(PDF_EXTENSIONS, (ctx, path, sub) => new PdfEmbed(ctx, path, sub))
  }
  registerExtension(ext: string, creator: EmbedCreator): void {
    if (this.isExtensionRegistered(ext)) throw new Error(`Attempting to register an embed for an already registered extension "${ext}"`)
    this.embedByExtension[ext] = creator
  }
  registerExtensions(exts: string[], creator: EmbedCreator): void {
    for (const e of exts) this.registerExtension(e, creator)
  }
  unregisterExtension(ext: string): void {
    delete this.embedByExtension[ext]
  }
  unregisterExtensions(exts: string[]): void {
    for (const e of exts) this.unregisterExtension(e)
  }
  isExtensionRegistered(ext: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.embedByExtension, ext)
  }
  getEmbedCreator(path: string): EmbedCreator | null {
    const ext = extname(path)
    return this.isExtensionRegistered(ext) ? this.embedByExtension[ext] : null
  }
}

export const embedRegistry = new EmbedRegistry()

/** Load an embed into `ctx.containerEl`. */
export function loadEmbed(ctx: EmbedContext): EmbedComponent {
  const el = ctx.containerEl
  ctx.depth = ctx.depth + 1
  el.empty()
  let embed: EmbedComponent | null = null
  const { path, subpath } = splitLinktext(ctx.linktext)
  const dest = getMarkdownHost().resolveLink(path, ctx.sourcePath) ?? (path === '' ? ctx.sourcePath || null : null)
  if (dest) {
    const creator = embedRegistry.getEmbedCreator(dest)
    if (creator && ctx.depth <= 5) embed = creator(ctx, dest, subpath)
    if (!embed) embed = new GenericEmbed(ctx, dest)
  }
  if (!embed) embed = new UnresolvedEmbed(ctx)
  el.addClass('is-loaded')
  depthByEl.set(el, ctx.depth)
  return embed
}
