/* eslint-disable @typescript-eslint/no-explicit-any */
// Section-based reading-view renderer (`MarkdownPreviewRenderer`).
// Plain DOM, owned by a React `ref` container: React never renders inside `previewEl`.
//
// DOM: previewEl `.markdown-preview-view.markdown-rendered` > sizerEl
// `.markdown-preview-sizer.markdown-preview-section` > pusher + one div per section
// (class `el-<first child tag>`), optional header (`mod-header mod-ui`) / footer
// (`mod-footer mod-ui`) sections. Sections are keyed by HTML string and reused across
// re-parses; rendering is time-sliced and the DOM is virtualised around the viewport.
import { MarkdownSection, toggleCollapsed } from './previewSection'
import { parseSections, type ParsedSections } from './sections'
import { globalParseOptions } from './pipeline'
import { setIcon } from './icons'
import { MarkdownRenderChild } from './MarkdownRenderChild'
import type { MarkdownPostProcessor, MarkdownRecycler, MarkdownSectionInformation, MarkdownPostProcessorContext, PreviewOwner, LinkHandlers } from './previewTypes'
import { forFirstHeading, forFoldableListItems, prependSpan, delegate, renderOptions, schedule, setChildrenInPlace, isShown, lineRange, cssEscapeClass, codeTextCache, getCodeText, getCssClasses, textNodes, rangeAt } from './previewDom'
import { getFoldInfo, applyFoldInfo } from './previewFold'
import { getScroll, applyScroll, updateVirtualDisplay } from './previewScroll'

export * from './previewTypes'
export * from './previewSection'
export * from './previewDom'

export class MarkdownPreviewRenderer {
  static postProcessors: MarkdownPostProcessor[] = []
  static codeBlockPostProcessors: Record<string, (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void> = {}
  static recyclers: MarkdownRecycler[] = []

  previewEl: HTMLDivElement
  sizerEl: HTMLDivElement
  pusherEl: HTMLDivElement
  header: MarkdownSection | null = null
  footer: MarkdownSection | null = null
  cssClasses: string[] | null = null
  sections: MarkdownSection[] = []
  asyncSections: MarkdownSection[] = []
  recycledSections: MarkdownSection[] = []
  lastText: string | null = null
  text = ''
  frontmatter: any = null
  queued: { cancel(): void; high?: boolean } | null = null
  rendered: (() => void)[] | null = null
  lastRender = 0
  lastScroll = 0
  lastScrollTs = 0
  viewportHeight = 0
  renderedWidth = 0
  renderExtra = 1
  renderExtraMinPx = 500
  addBottomPadding = false
  topSpace = 0
  parsing = false
  scrolling = false
  owner: PreviewOwner
  /** Visibility check gating rendering (offsetParent && offsetWidth > 0). Overridable for tests. */
  isVisible: () => boolean
  private resizeObserver: ResizeObserver | null = null

  constructor(owner: PreviewOwner, handlers: LinkHandlers, containerEl: HTMLElement, observeInsert = true) {
    this.owner = owner
    const doc = containerEl.ownerDocument
    const preview = (this.previewEl = doc.createElement('div'))
    preview.className = 'markdown-preview-view markdown-rendered'
    containerEl.appendChild(preview)
    const sizer = (this.sizerEl = doc.createElement('div'))
    sizer.className = 'markdown-preview-sizer markdown-preview-section'
    preview.appendChild(sizer)
    const pusher = (this.pusherEl = doc.createElement('div'))
    pusher.className = 'markdown-preview-pusher'
    pusher.style.width = '1px'
    pusher.style.height = '0.1px'
    this.isVisible = () => !!preview.offsetParent && preview.offsetWidth > 0
    MarkdownPreviewRenderer.registerDomEvents(sizer, handlers, this.handleDetached.bind(this), this.handleMediaClick.bind(this))
    delegate(sizer, 'click', 'a.footnote-link', this.onFootnoteLinkClick.bind(this))
    delegate(sizer, 'click', '.task-list-item-checkbox', this.onCheckboxClick.bind(this))
    delegate(sizer, 'click', '.heading-collapse-indicator', this.onHeadingCollapseClick.bind(this))
    delegate(sizer, 'click', 'li > .list-collapse-indicator', this.onListCollapseClick.bind(this))
    preview.addEventListener('scroll', this.onScroll.bind(this), { passive: true })
    if (observeInsert && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize())
      this.resizeObserver.observe(preview)
    }
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.queued?.cancel()
  }

  set(text: string): void {
    this.text = text
    this.queueRender()
  }

  rerender(full?: boolean): void {
    this.lastText = null
    if (full) {
      for (const s of this.sections) {
        if (s !== this.header && s !== this.footer) {
          s.rendered = false
          s.el.textContent = ''
        }
      }
    }
    this.queueRender()
  }

  clear(): void {
    this.sections = []
    this.asyncSections = []
    this.recycledSections = []
    this.rendered = []
    this.sizerEl.textContent = ''
    this.text = ''
    this.lastText = null
    this.lastScroll = 0
    this.previewEl.scrollTop = 0
    this.renderedWidth = 0
    this.owner.onRenderComplete()
    this.cleanupParentComponents()
    this.queueRender()
  }

  belongsToMe(el: Element): boolean {
    return MarkdownPreviewRenderer.belongsToMe(el, this.previewEl, this.handleDetached.bind(this))
  }

  handleDetached(el: Element): boolean {
    return this.sections.some((s) => s.el === el)
  }

  /** Image lightbox hook; the gallery modal belongs to the workspace UI area. */
  handleMediaClick(_evt: MouseEvent, target: HTMLElement): void {
    if (!(target instanceof target.ownerDocument.defaultView!.HTMLImageElement)) return
    const images: { url: string; alt: string; title: string }[] = []
    let index = -1
    for (const s of this.sections) {
      for (const img of Array.from(s.el.querySelectorAll('img'))) {
        images.push({ url: img.src, alt: img.alt, title: img.title })
        if (img === target) index = images.length - 1
      }
    }
    if (index !== -1) this.previewEl.dispatchEvent(new CustomEvent('quartz-image-gallery', { detail: { images, index }, bubbles: true }))
  }

  getSectionForElement(el: Node): MarkdownSection | null {
    for (const s of this.sections) if (s.el.contains(el)) return s
    return null
  }

  getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null {
    if (!this.belongsToMe(el)) return null
    const s = this.getSectionForElement(el)
    return s ? { text: this.lastText || '', lineStart: s.start.line, lineEnd: s.end.line } : null
  }

  getInternalLinkHref(el: HTMLElement): string | null {
    const href = el.getAttribute('data-href') || el.getAttribute('href')
    return href && this.belongsToMe(el) ? href : null
  }

  onFootnoteLinkClick(evt: MouseEvent, target: HTMLElement): void {
    if (evt.button !== 0 || !this.belongsToMe(target)) return
    evt.preventDefault()
    let href = target.getAttribute('href')
    if (!href || !href.startsWith('#')) return
    href = href.substr(1)
    const selector = '[data-footnote-id=' + href + ']'
    let section: MarkdownSection | null = null
    let found: HTMLElement | null = null
    for (const s of this.sections) {
      try {
        found = s.el.querySelector(selector)
      } catch {
        found = null
      }
      if (found) {
        section = s
        break
      }
    }
    if (!found || !section) return
    this.showSection(section)
    this.applyScrollSection(section)
    this.highlightEl(found)
    this.updateVirtualDisplay()
    found.scrollIntoView?.({ block: 'center' })
    this.owner.onScroll()
  }

  onCheckboxClick(evt: MouseEvent, target: HTMLInputElement): void {
    if (!this.belongsToMe(target)) return
    const n = parseInt(target.getAttribute('data-line') ?? '')
    if (n < 0 || isNaN(n)) return
    const s = this.getSectionContainer(target)
    if (s) this.owner.onCheckboxClick(evt, target, s.start.line + n)
  }

  onHeadingCollapseClick(evt: MouseEvent, target: HTMLElement): void {
    if (evt.button !== 0 || evt.defaultPrevented) return
    const h = target.parentNode as HTMLElement | null
    if (!h || !/^H[1-6]$/.test(h.nodeName) || !this.belongsToMe(h)) return
    const s = this.getSectionContainer(h)
    if (!s) return
    evt.preventDefault()
    s.setCollapsed(!s.headingCollapsed)
    this.previewEl.ownerDocument.getSelection()?.removeAllRanges()
    this.queueRender()
    this.owner.onFoldChange()
  }

  setListCollapse(li: HTMLElement, collapsed: boolean): void {
    if (!li.querySelectorAll('ul, ol')) return
    toggleCollapsed(li, collapsed)
    this.getSectionContainer(li)?.resetCompute()
  }

  onListCollapseClick(evt: MouseEvent, target: HTMLElement): void {
    if (evt.button !== 0 || evt.defaultPrevented) return
    const li = target.parentNode as HTMLElement | null
    if (!li || li.nodeName !== 'LI' || !this.belongsToMe(li)) return
    evt.preventDefault()
    this.setListCollapse(li, !li.classList.contains('is-collapsed'))
    this.queueRender()
    this.owner.onFoldChange()
  }

  queueRender(): void {
    if (!this.rendered) this.rendered = []
    const q = this.queued
    const notParsing = !this.parsing
    if (q) {
      if (notParsing && !q.high) {
        q.cancel()
        this.queued = schedule(() => this.onRender(), 0)
      }
    } else {
      this.queued = schedule(() => this.onRender(), notParsing ? 0 : 200)
    }
  }

  parseSync(): void {
    const text = this.text
    this.parseFinish(text, parseSections(text, globalParseOptions))
  }

  /** Large documents: parse off the critical path. */
  parseAsync(): void {
    if (this.parsing) return
    this.parsing = true
    const text = this.text
    setTimeout(() => {
      try {
        const result = parseSections(text, globalParseOptions)
        const scrollTop = this.previewEl.scrollTop
        this.parseFinish(text, result)
        this.previewEl.scrollTop = scrollTop
        this.parsing = false
        this.onRender()
      } catch (e) {
        this.parsing = false
        console.error(e)
        this.parseSync()
        this.queueRender()
      }
    }, 0)
  }

  parseFinish(text: string, parsed: ParsedSections): void {
    const { sections: parsedSections, frontmatter } = parsed
    const recycled = this.recycledSections
    const header = this.header
    const footer = this.footer
    const old = this.sections
    const byHtml = new Map<string, MarkdownSection[]>()
    for (const s of old) {
      if (s === header || s === footer) continue
      s.used = false
      const list = byHtml.get(s.html)
      if (list) list.push(s)
      else byHtml.set(s.html, [s])
    }
    const next: MarkdownSection[] = []
    for (let i = 0; i < parsedSections.length; i++) {
      const { html, level, pos } = parsedSections[i]
      let section: MarkdownSection | null = null
      const candidates = byHtml.get(html)
      if (candidates) {
        for (const c of candidates) {
          if (!c.used) {
            c.used = true
            section = c
            break
          }
        }
      }
      if (!section) section = new MarkdownSection(html)
      const startLine = i === 0 ? 0 : pos.start.line
      const endLine = i === parsedSections.length - 1 ? pos.end.line + 1 : parsedSections[i + 1].pos.start.line
      section.lines = endLine - startLine
      section.start = pos.start
      section.end = pos.end
      section.level = level
      next.push(section)
    }
    // Frontmatter-dependent sections are re-rendered when the stored frontmatter
    // compares equal (sic).
    const same = JSON.stringify(this.frontmatter) === JSON.stringify(frontmatter)
    this.frontmatter = frontmatter
    if (same) {
      for (const s of next) {
        if (s.usesFrontMatter) {
          s.rendered = false
          s.el.textContent = ''
        }
      }
    }
    if (this.cssClasses) {
      this.previewEl.classList.remove(...this.cssClasses)
      this.cssClasses = null
    }
    const cls = getCssClasses(frontmatter)
    if (cls && cls.length > 0) {
      this.cssClasses = cls
      this.previewEl.classList.add(...cls)
    }
    if (header) next.unshift(header)
    if (footer) next.push(footer)
    this.sections = next
    const prevAsync = this.asyncSections
    this.asyncSections = prevAsync.filter((s) => next.includes(s))
    for (const s of old) if (s.rendered && !s.used) recycled.push(s)
    this.lastText = text
    this.lastRender = Date.now()
  }

  /** Decorate + post-process one freshly rendered section. */
  private renderSection(section: MarkdownSection): void {
    const el = section.el
    section.render()
    for (const r of MarkdownPreviewRenderer.recyclers) r(el, this.recycledSections)
    forFirstHeading(el, (h) => setIcon(prependSpan(h, 'heading-collapse-indicator collapse-indicator collapse-icon'), 'right-triangle'))
    forFoldableListItems(el, (li) => setIcon(prependSpan(li, 'list-collapse-indicator collapse-indicator collapse-icon'), 'right-triangle'))
    if (renderOptions.listBullet) {
      for (const li of Array.from(el.querySelectorAll('ul > li'))) {
        li.parentElement!.classList.add('has-list-bullet')
        prependSpan(li as HTMLElement, 'list-bullet')
      }
    }
    const promises: Promise<any>[] = []
    this.owner.postProcess(section, promises, this.frontmatter)
    if (promises.length > 0) {
      this.asyncSections.push(section)
      Promise.all(promises).then(() => {
        const i = this.asyncSections.indexOf(section)
        if (i !== -1) this.asyncSections.splice(i, 1)
        section.resetCompute()
        this.queueRender()
      })
    }
  }

  onRender(): void {
    this.queued = null
    const preview = this.previewEl
    if (!this.isVisible()) return
    const scrollTop = preview.scrollTop
    if (this.lastText !== this.text) {
      if (!renderOptions.asyncParse || this.text.length < 10240) this.parseSync()
      else this.parseAsync()
    }
    const sections = this.sections
    const sizer = this.sizerEl
    const pusher = this.pusherEl
    let count = 0
    const t0 = performance.now()
    let more = false
    for (const s of sections) {
      if (s.rendered) continue
      count++
      this.renderSection(s)
      if (count % 10 === 0 && performance.now() - t0 > 5) {
        more = true
        break
      }
    }
    const toMeasure: MarkdownSection[] = []
    let prevUnmeasured = false
    const children: Node[] = [pusher]
    let unmeasured = 0
    for (const s of sections) {
      let attach = s.el.parentElement === sizer
      if (!s.computed && s.rendered) {
        attach = true
        toMeasure.push(s)
        prevUnmeasured = true
        unmeasured++
      } else if (prevUnmeasured) {
        attach = true
        prevUnmeasured = false
      }
      if (attach) children.push(s.el)
      if (unmeasured > 100) {
        more = true
        break
      }
    }
    setChildrenInPlace(sizer, children)
    for (const s of toMeasure) this.measureSection(s)
    this.topSpace = pusher.offsetTop
    this.updateShownSections()
    this.updateVirtualDisplay(scrollTop)
    if (more) this.queueRender()
    else if (this.lastText === this.text) {
      this.recycledSections = []
      if (this.asyncSections.length > 0) return
      if (this.rendered) for (const cb of this.rendered) cb()
      this.rendered = null
      this.owner.onRenderComplete()
      this.cleanupParentComponents()
    }
  }

  updateShownSections(): void {
    let level = 7
    for (const s of this.sections) {
      if (s.level > level) s.shown = false
      else {
        s.shown = true
        level = 7
        if (s.headingCollapsed) level = s.level
      }
    }
  }

  updateVirtualDisplay(scrollTopArg?: number): void {
    updateVirtualDisplay(this, scrollTopArg)
  }

  /** Make sure a section's DOM exists (document search scans sections that are not on screen). */
  ensureRendered(section: MarkdownSection): void {
    if (!section.rendered) this.renderSection(section)
  }

  /** Overlays for document-search matches of the shown sections (`.search-highlight` in the sizer). */
  renderHighlights(from: number, to: number): void {
    const sizer = this.sizerEl
    const parent = sizer.offsetParent as HTMLElement | null
    if (!parent) return
    const base = parent.getBoundingClientRect()
    const scale = parent.offsetWidth / Math.round(base.width) || 1
    const divs: HTMLElement[] = []
    for (let i = Math.max(0, from); i <= to && i < this.sections.length; i++) {
      const sec = this.sections[i]
      if (!sec.shown || !sec.highlightRanges?.length) continue
      const nodes = textNodes(sec.el)
      for (const r of sec.highlightRanges) {
        if (!r.rects) {
          r.rects = []
          const range = rangeAt(nodes, r.start, r.end)
          if (!range) continue
          for (const rect of Array.from(range.getClientRects()))
            r.rects.push({ x: (rect.x - base.x + parent.scrollLeft) * scale, y: (rect.y - base.y + parent.scrollTop) * scale, width: rect.width * scale, height: rect.height * scale })
        }
        for (const rect of r.rects) {
          const d = document.createElement('div')
          if (r.active) d.classList.add('is-active')
          d.style.left = rect.x + 'px'
          d.style.top = rect.y + 'px'
          d.style.width = rect.width + 'px'
          d.style.height = rect.height + 'px'
          divs.push(d)
        }
      }
    }
    if (divs.length) {
      const layer = document.createElement('div')
      layer.className = 'search-highlight'
      layer.append(...divs)
      sizer.appendChild(layer)
    }
  }

  measureSection(s: MarkdownSection): void {
    if (!s.rendered) return
    const el = s.el
    const next = el.nextSibling as HTMLElement | null
    const top = el.offsetTop
    const end = next ? next.offsetTop : el.offsetTop + el.offsetHeight
    s.height = end - top
    s.computed = true
  }

  onRendered(cb: () => void): void {
    if (this.rendered) this.rendered.push(cb)
    else cb()
  }

  onResize(): void {
    const preview = this.previewEl
    const h = (this.viewportHeight = preview.clientHeight)
    const w = preview.offsetWidth
    this.sizerEl.style.paddingBottom = this.addBottomPadding ? Math.round(h / 2) + 'px' : '0'
    if (w !== this.renderedWidth) {
      this.renderedWidth = w
      for (const s of this.sections) s.resetCompute()
      this.queueRender()
    } else this.updateVirtualDisplay()
  }

  foldAllHeadings(): void {
    for (const s of this.sections) forFirstHeading(s.el, () => s.setCollapsed(true))
    this.updateShownSections()
    this.updateVirtualDisplay()
    this.owner.onFoldChange()
  }

  unfoldAllHeadings(): void {
    for (const s of this.sections) {
      s.setCollapsed(false)
      s.shown = true
    }
    this.updateVirtualDisplay()
    this.owner.onFoldChange()
  }

  foldAllLists(): void {
    for (const s of this.sections) forFoldableListItems(s.el, (li) => this.setListCollapse(li, true))
    this.queueRender()
    this.owner.onFoldChange()
  }

  unfoldAllLists(): void {
    for (const s of this.sections) forFoldableListItems(s.el, (li) => this.setListCollapse(li, false))
    this.queueRender()
    this.owner.onFoldChange()
  }

  /** Fold state in source-line terms (shared with the editor's fold manager). */
  getFoldInfo(): { folds: { from: number; to: number }[]; lines: number } {
    return getFoldInfo(this)
  }

  applyFoldInfo(info: { folds: { from: number; to: number }[]; lines: number } | null): void {
    applyFoldInfo(this, info)
  }

  onScroll(): void {
    const scrollTop = this.previewEl.scrollTop
    if (Math.abs(this.lastScroll - scrollTop) > Math.max(this.viewportHeight * this.renderExtra, this.renderExtraMinPx) / 2) {
      this.updateVirtualDisplay()
    }
    if (this.scrolling) this.scrolling = false
    else {
      this.owner.onScroll()
      this.lastScrollTs = Date.now()
    }
  }

  private elTop(el: HTMLElement): number {
    return el.getBoundingClientRect().top - this.previewEl.getBoundingClientRect().top + this.previewEl.scrollTop
  }

  /** Scroll position as a fractional source line. */
  getScroll(): number | null {
    return getScroll(this)
  }

  applyScroll(line: number, opts?: { highlight?: boolean; center?: boolean }): boolean {
    return applyScroll(this, line, opts)
  }

  getSectionTop(section: MarkdownSection): number {
    let y = 0
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i]
      if (s === section) return y
      let h = s.height
      if (!s.computed && h === 0 && i > 0) h = y / i
      if (!s.shown) h = 0
      y += h
    }
    return -1
  }

  showSection(section: MarkdownSection): void {
    if (section.shown) return
    let i = this.sections.indexOf(section)
    if (i === -1) return
    let level = section.level
    for (; i >= 0; i--) {
      const s = this.sections[i]
      if (s.headingCollapsed && s.level < level) {
        s.setCollapsed(false)
        level = s.level
      }
    }
    this.updateShownSections()
    this.updateVirtualDisplay()
  }

  applyScrollSection(section: MarkdownSection): boolean | undefined {
    const top = this.getSectionTop(section)
    if (top === -1) return undefined
    this.scrolling = true
    this.previewEl.scrollTop = top
    return true
  }

  applyScrollDelayed(line: number, opts?: { highlight?: boolean; center?: boolean }, cb?: () => void): void {
    if (this.applyScroll(line, opts)) cb?.()
    else
      this.onRendered(() => {
        this.applyScroll(line, opts)
        cb?.()
      })
  }

  highlightEl(el: HTMLElement): void {
    for (const s of this.sections) {
      if (s.el.classList.contains('is-flashing')) s.el.classList.remove('is-flashing')
      for (const f of Array.from(s.el.querySelectorAll('.is-flashing'))) f.classList.remove('is-flashing')
    }
    el.classList.add('is-flashing')
    setTimeout(() => el.classList.remove('is-flashing'), 3000)
  }

  getSectionContainer(el: Node): MarkdownSection | null {
    for (const s of this.sections) if (s.el.contains(el)) return s
    return null
  }

  addHeader(): void {
    if (this.header) return
    this.header = new MarkdownSection(null)
    this.header.el.classList.add('mod-header', 'mod-ui')
    this.sections.unshift(this.header)
    this.queueRender()
  }
  removeHeader(): void {
    if (!this.header) return
    this.sections.splice(this.sections.indexOf(this.header), 1)
    this.header = null
    this.queueRender()
  }
  addFooter(): void {
    if (this.footer) return
    this.footer = new MarkdownSection(null)
    this.footer.el.classList.add('mod-footer', 'mod-ui')
    this.sections.push(this.footer)
    this.queueRender()
  }
  removeFooter(): void {
    if (!this.footer) return
    this.sections.splice(this.sections.indexOf(this.footer), 1)
    this.footer = null
    this.queueRender()
  }
  updateHeader(): void {
    if (this.header) {
      this.header.resetCompute()
      this.queueRender()
    }
  }
  updateFooter(): void {
    if (this.footer) {
      this.footer.resetCompute()
      this.queueRender()
    }
  }

  /** Unload child components whose container left the preview. */
  cleanupParentComponents(): void {
    const owner = this.owner
    if (!owner._children || !owner.removeChild) return
    const dead = owner._children.filter((c: any) => c instanceof MarkdownRenderChild && !this.belongsToMe(c.containerEl))
    for (const c of dead) owner.removeChild(c)
  }

  // --- static registry ------------------------------------------------------

  static registerPostProcessor(pp: MarkdownPostProcessor, sortOrder?: number): void {
    pp.sortOrder = sortOrder
    const list = this.postProcessors
    list.push(pp)
    list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }
  static unregisterPostProcessor(pp: MarkdownPostProcessor): void {
    const i = this.postProcessors.indexOf(pp)
    if (i !== -1) this.postProcessors.splice(i, 1)
  }
  static registerRecycler(r: MarkdownRecycler): void {
    this.recyclers.push(r)
  }
  static unregisterRecycler(r: MarkdownRecycler): void {
    const i = this.recyclers.indexOf(r)
    if (i !== -1) this.recyclers.splice(i, 1)
  }
  static registerCodeBlockPostProcessor(
    lang: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void
  ): void {
    const map = this.codeBlockPostProcessors
    if (Object.prototype.hasOwnProperty.call(map, lang)) throw new Error(`Code block postprocessor for language ${lang} is already registered`)
    map[lang] = handler
  }
  static unregisterCodeBlockPostProcessor(lang: string): void {
    delete this.codeBlockPostProcessors[lang]
  }
  static createCodeBlockPostProcessor(
    lang: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void
  ): MarkdownPostProcessor {
    return (el, ctx) => {
      const codes = Array.from(el.querySelectorAll('code.language-' + cssEscapeClass(lang))) as HTMLElement[]
      for (const code of codes) {
        let source = getCodeText(code)
        const pre = code.parentElement!
        const div = el.ownerDocument.createElement('div')
        div.className = 'block-language-' + lang
        pre.replaceWith(div)
        const c: MarkdownPostProcessorContext = ctx
        c.replaceCode = (newCode: string) => {
          const info = ctx.getSectionInfo(div)
          if (!info) return
          const text = info.text.substring(lineRange(info.text, info.lineStart).start, lineRange(info.text, info.lineEnd).end)
          let line = parseInt(code.dataset.line ?? '', 10)
          if (isNaN(line)) line = 0
          const s = lineRange(text, line + 1).start
          const e = s + source.length
          if (text.substring(s, e) === source) {
            ctx.replace(text.substring(0, s) + newCode + text.substring(e), true)
            codeTextCache.set(code, newCode)
            source = newCode
          }
        }
        const p = handler(source, div, c)
        if (p) ctx.promises.push(p as Promise<any>)
      }
    }
  }

  static registerDomEvents(root: HTMLElement, handlers: LinkHandlers, isDetachedSection?: (el: Element) => boolean, onMedia?: (e: MouseEvent, el: HTMLElement) => void): void {
    const linkInfo = (el: HTMLElement) => {
      const href = el.getAttribute('data-href') || el.getAttribute('href')
      return href && MarkdownPreviewRenderer.belongsToMe(el, root, isDetachedSection) ? { href, text: (el.textContent || '').trim() } : null
    }
    const onClick = (evt: MouseEvent, el: HTMLElement) => {
      if (evt.button !== 0 && evt.button !== 1) return
      const i = linkInfo(el)
      if (i) handlers.onInternalLinkClick(evt, el, i.href, i.text)
    }
    delegate(root, 'click', 'a.internal-link', onClick)
    delegate(root, 'auxclick', 'a.internal-link', onClick)
    delegate(root, 'dragstart', 'a.internal-link', (evt, el) => {
      const i = linkInfo(el)
      if (i) handlers.onInternalLinkDrag(evt, el, i.href, i.text)
    })
    delegate(root, 'contextmenu', 'a.internal-link', (evt, el) => {
      const i = linkInfo(el)
      if (i) handlers.onInternalLinkRightClick(evt, el, i.href, i.text)
    })
    delegate(root, 'mouseover', 'a.internal-link', (evt, el) => {
      const i = linkInfo(el)
      if (i) handlers.onInternalLinkMouseover(evt, el, i.href, i.text)
    })
    delegate(root, 'mouseover', 'a.footnote-link', (evt, el) => {
      const ref = el.dataset.footref
      if (ref && MarkdownPreviewRenderer.belongsToMe(el, root, isDetachedSection)) handlers.onInternalLinkMouseover(evt, el, `#[^${ref}]`)
    })
    delegate(root, 'click', 'a.external-link', (evt, el) => {
      if (evt.button !== 0 && evt.button !== 1) return
      const href = el.getAttribute('href')
      if (href && MarkdownPreviewRenderer.belongsToMe(el, root, isDetachedSection)) handlers.onExternalLinkClick(evt, el, href)
    })
    delegate(root, 'contextmenu', 'a.external-link', (evt, el) => {
      const href = el.getAttribute('href')
      if (href && MarkdownPreviewRenderer.belongsToMe(el, root, isDetachedSection)) handlers.onExternalLinkRightClick(evt, el, href)
    })
    delegate(root, 'click', 'a.tag', (evt, el) => {
      if (evt.button !== 0 || !MarkdownPreviewRenderer.belongsToMe(el, root, isDetachedSection)) return
      evt.preventDefault()
      handlers.onTagClick(evt, el, el.textContent || '')
    })
    const media = (evt: MouseEvent, el: HTMLElement) => {
      if (evt.defaultPrevented) return
      if (MarkdownPreviewRenderer.belongsToMe(el, root, isDetachedSection)) onMedia?.(evt, el)
    }
    delegate(root, 'click', 'img,video', media)
    delegate(root, 'contextmenu', 'img,video', media)
  }

  static belongsToMe(el: Element | null, root: Element, isDetachedSection?: (el: Element) => boolean): boolean {
    while (el) {
      if (el === root) return true
      if (el.classList.contains('markdown-preview-view') || el.classList.contains('bases-view')) return false
      const parent = el.parentElement
      if (!parent) return !!isDetachedSection && isDetachedSection(el)
      el = parent
    }
    return false
  }
}
