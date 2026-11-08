/* eslint-disable @typescript-eslint/no-explicit-any */
// `MarkdownRenderer` (plugin API) — owner of a section renderer, plus the static
// `render` / `renderMarkdown` used by plugins, embeds and hover previews.
import { Component } from '../core/Component'
import { MarkdownRenderChild } from './MarkdownRenderChild'
import {
  MarkdownPreviewRenderer,
  type LinkHandlers,
  type MarkdownPostProcessorContext,
  type MarkdownSection,
  type PreviewOwner,
  getCodeText
} from './MarkdownPreviewRenderer'
import { parseMarkdown, mdastToHtml, getFrontMatter } from './pipeline'
import { parseSections } from './sections'
import { sanitizeHTMLToDom } from './sanitize'
import { getMarkdownHost } from './host'
import { installBuiltinPostProcessors } from './postprocessors'
import { loadEmbed, embedDepth, randomDocId, splitLinktext } from './embeds'
import { setIcon } from './icons'
import { Keymap } from '../keymap/Keymap'

const warnedPlugins: Record<string, boolean> = {}

/** Link interaction handlers backed by the injected host. */
export function createLinkHandlers(getPath: () => string): LinkHandlers {
  const host = () => getMarkdownHost()
  const isMod = (e: MouseEvent): boolean | 'tab' | 'split' | 'window' => Keymap.isModEvent(e)
  return {
    onInternalLinkClick(e, _el, href) {
      e.preventDefault()
      host().openLinkText(href, getPath(), isMod(e))
    },
    onInternalLinkDrag() {},
    onInternalLinkRightClick() {},
    onInternalLinkMouseover(e, el, href) {
      host().onHoverLink({ event: e, targetEl: el, linktext: href, sourcePath: getPath() })
    },
    onExternalLinkClick(e, _el, href) {
      e.preventDefault()
      let valid = false
      try {
        new URL(href)
        valid = true
      } catch {
        valid = false
      }
      if (valid) host().openExternal(href, e.ctrlKey || e.metaKey ? '_blank' : '')
      else console.warn(`Cannot open location “${href}”`)
    },
    onExternalLinkRightClick() {},
    onTagClick(_e, _el, tag) {
      host().onTagClick(tag)
    }
  }
}

/** Toggle `is-unresolved` on internal links. */
export function resolveLinks(el: HTMLElement, sourcePath: string, getHref?: (a: HTMLElement) => string | null): void {
  const host = getMarkdownHost()
  for (const a of Array.from(el.querySelectorAll('a.internal-link')) as HTMLElement[]) {
    const href = getHref ? getHref(a) : a.getAttribute('data-href') || a.getAttribute('href')
    if (!href) continue
    const { path } = splitLinktext(href)
    const unresolved = path !== '' && host.resolveLink(path, sourcePath) === null
    a.classList.toggle('is-unresolved', unresolved)
  }
}

export abstract class MarkdownRenderer extends MarkdownRenderChild implements PreviewOwner {
  app: any
  hoverPopover: any = null
  docId = randomDocId()
  renderer: MarkdownPreviewRenderer
  private updateLinksTimer = 0

  constructor(app: any, containerEl: HTMLElement, observeInsert = true) {
    super(containerEl)
    this.app = app
    installBuiltinPostProcessors()
    this.renderer = new MarkdownPreviewRenderer(this, createLinkHandlers(() => this.path), containerEl, observeInsert)
  }

  abstract get file(): any

  get path(): string {
    return this.file?.path || ''
  }

  /** Debounced (500 ms) unresolved-link refresh; call on vault/metadata changes. */
  requestUpdateLinks(): void {
    clearTimeout(this.updateLinksTimer)
    this.updateLinksTimer = window.setTimeout(() => {
      for (const s of this.renderer.sections) if (s.rendered) this.resolveLinks(s.el)
    }, 500)
  }

  onunload(): void {
    clearTimeout(this.updateLinksTimer)
    this.renderer.destroy()
  }

  /** Write a toggled checkbox back to the source (owner implements `edit`). */
  edit(_text: string): void {}

  onCheckboxClick(e: MouseEvent, el: HTMLInputElement, line: number): void {
    e.preventDefault()
    navigator.vibrate?.(100)
    const result = MarkdownRenderer.toggleCheckbox(this.renderer.text, line)
    if (result === null) return
    const section = this.renderer.getSectionContainer(el)
    if (section) {
      const checked = result.char !== ' '
      const rel = line - section.start.line
      if (rel >= 0) {
        const n = String(rel)
        section.html = section.html.replace(
          /<li class="task-list-item( is-checked)?" data-task="(.)" data-line="(\d+)"><input class="task-list-item-checkbox" type="checkbox"( checked)? data-line="(\d+)">/g,
          (m, _c, _t, liLine, _ch, inLine) =>
            liLine === n && inLine === n
              ? `<li class="task-list-item${checked ? ' is-checked' : ''}" data-task="${result.char}" data-line="${liLine}"><input class="task-list-item-checkbox" type="checkbox"${checked ? ' checked' : ''} data-line="${inLine}">`
              : m
        )
      }
      setTimeout(() => {
        el.checked = checked
        const li = el.parentNode as HTMLElement | null
        if (li && li.nodeName === 'LI') {
          li.setAttribute('data-task', result.char)
          li.classList.toggle('is-checked', checked)
        }
      }, 0)
    }
    this.edit(result.text)
  }

  static toggleCheckbox(text: string, line: number): { text: string; char: string } | null {
    let idx = -1
    for (let i = 0; i < line; i++) idx = text.indexOf('\n', idx + 1)
    const start = idx + 1
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const at = text.slice(start, end).search(/\[.\]/)
    if (at === -1) return null
    const pos = start + at + 1
    const char = text.charAt(pos) === ' ' ? 'x' : ' '
    return { text: text.slice(0, pos) + char + text.slice(pos + 1), char }
  }

  postProcess(section: MarkdownSection, promises: Promise<any>[], frontmatter: any): void {
    const ctx = MarkdownRenderer.postProcess(this.app, {
      docId: this.docId,
      sourcePath: this.path,
      frontmatter,
      promises,
      addChild: (c: Component) => this.addChild(c),
      getSectionInfo: (el: HTMLElement) => this.renderer.getSectionInfo(el),
      replace: (text: string, rerender?: boolean) => {
        const src = this.renderer.text
        const next = src.slice(0, section.start.offset) + text + src.slice(section.end.offset)
        if (rerender) {
          const parsed = parseSections(text)
          if (parsed.sections.length === 1) section.html = parsed.sections[0].html
        }
        this.edit(next)
      },
      containerEl: this.renderer.sizerEl,
      el: section.el
    })
    section.usesFrontMatter = !!(ctx as any).usesFrontMatter
    this.resolveLinks(section.el)
  }

  onScroll(): void {}
  onFoldChange(): void {}
  onRenderComplete(): void {}

  resolveLinks(el: HTMLElement): void {
    resolveLinks(el, this.path, (a) => this.renderer.getInternalLinkHref(a))
  }

  /** Run code-block `query` embeds, every registered post-processor, then load embeds. */
  static postProcess(app: any, ctx: MarkdownPostProcessorContext): MarkdownPostProcessorContext {
    const { sourcePath, promises, el, displayMode } = ctx
    for (const code of Array.from(el.querySelectorAll('code.language-query')) as HTMLElement[]) {
      const query = getCodeText(code).trim()
      const pre = code.parentElement!
      renderQueryBlock(pre, query, sourcePath)
    }
    for (const pp of MarkdownPreviewRenderer.postProcessors) {
      const r = pp(el, ctx)
      if (r && (r as Promise<any>).then) promises.push(r as Promise<any>)
    }
    const depth = embedDepth(ctx.containerEl)
    for (const span of Array.from(el.querySelectorAll('.internal-embed:not(.is-loaded)')) as HTMLElement[]) {
      const embed = loadEmbed({ app, linktext: span.getAttribute('src') || '', sourcePath, containerEl: span, displayMode, showInline: true, depth })
      ctx.addChild(embed)
      promises.push(embed.loadFile())
    }
    return ctx
  }

  /** Wire link/tag delegation for an embedded preview. */
  static registerEmbedEvents(el: HTMLElement, path: string): void {
    MarkdownPreviewRenderer.registerDomEvents(el, createLinkHandlers(() => path))
  }

  /** @deprecated use `render` */
  static renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    return MarkdownRenderer.render(null, markdown, el, sourcePath, component)
  }

  /** Render a whole markdown string (no sections) and run post-processors; embeds load when `app` is given. */
  static render(app: any, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    installBuiltinPostProcessors()
    if (!(component && component instanceof Component)) {
      const m = (new Error().stack || '').match(/plugin:([^:]+)/)
      if (m && !warnedPlugins[m[1]]) {
        warnedPlugins[m[1]] = true
        console.error(
          new Error(
            `Plugin "${m[1]}" is not passing Component in renderMarkdown. This is needed to avoid memory leaks when embedded contents register global event handlers.`
          )
        )
      }
    }
    const tree = parseMarkdown(markdown)
    const frontmatter = getFrontMatter(tree)
    el.appendChild(sanitizeHTMLToDom(mdastToHtml(tree), el.ownerDocument))
    const promises: Promise<any>[] = []
    const ctx: MarkdownPostProcessorContext = {
      docId: randomDocId(),
      sourcePath,
      frontmatter,
      promises,
      addChild: (c: any) => component && component.addChild(c),
      getSectionInfo: () => null,
      replace: () => null as any,
      containerEl: el,
      el,
      displayMode: true
    }
    for (const pp of MarkdownPreviewRenderer.postProcessors) {
      const r = pp(el, ctx)
      if (r && (r as Promise<any>).then) promises.push(r as Promise<any>)
    }
    if (app && component) {
      const depth = embedDepth(el)
      for (const span of Array.from(el.querySelectorAll('.internal-embed:not(.is-loaded)')) as HTMLElement[]) {
        const embed = loadEmbed({ app, linktext: span.getAttribute('src') || '', sourcePath, containerEl: span, displayMode: true, showInline: true, depth })
        ctx.addChild(embed)
        promises.push(embed.loadFile())
      }
    }
    return promises.length > 0 ? Promise.all(promises).then(() => undefined) : Promise.resolve()
  }
}

/** ` ```query ` blocks: embedded search container (results filled by the search area via host). */
function renderQueryBlock(pre: HTMLElement, query: string, sourcePath: string): void {
  const div = createDiv('internal-query')
  pre.replaceWith(div)
  div.createDiv('internal-query-header', (h: HTMLElement) => {
    h.createSpan('internal-query-header-icon', (i: HTMLElement) => setIcon(i, 'lucide-search'))
    h.createSpan({ cls: 'internal-query-header-title', text: query })
  })
  const results = div.createDiv('search-result-container')
  const hook = (getMarkdownHost() as any).renderQuery as ((el: HTMLElement, q: string, path: string) => void) | undefined
  hook?.(results, query, sourcePath)
}

/** Child renderer of a note embed (reference: a renderer one embed level deeper inside `.markdown-embed-content`). */
export class EmbedRenderer extends MarkdownRenderer {
  constructor(app: any, containerEl: HTMLElement, private embedPath: string) {
    super(app, containerEl, false)
  }
  get file(): any {
    return this.app?.vault?.getAbstractFileByPath?.(this.embedPath) ?? { path: this.embedPath }
  }
}
