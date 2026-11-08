/* eslint-disable @typescript-eslint/no-explicit-any */
// Reading-view section model: one rendered chunk of the preview (split from MarkdownPreviewRenderer.ts).
import { sanitizeHTMLToDom } from './sanitize'
import type { Loc } from './sections'

export class MarkdownSection {
  rendered = false
  height = 0
  computed = false
  lines = 0
  used = true
  highlightRanges: any[] | null = null
  level = 0
  headingCollapsed = false
  shown = true
  usesFrontMatter = false
  html: string
  el: HTMLDivElement
  start: Loc = { line: 0, col: 0, offset: 0 }
  end: Loc = { line: 0, col: 0, offset: 0 }

  constructor(html: string | null) {
    this.html = html || ''
    this.el = document.createElement('div')
    if (html === null) this.rendered = true
  }

  render(): void {
    if (this.rendered) return
    this.el.appendChild(sanitizeHTMLToDom(this.html, this.el.ownerDocument))
    const first = this.el.firstChild
    if (first && first.nodeType === Node.ELEMENT_NODE) this.el.classList.add('el-' + (first as Element).tagName.toLowerCase())
    this.rendered = true
    this.computed = false
  }

  resetCompute(): void {
    this.computed = false
    if (this.highlightRanges) for (const r of this.highlightRanges) r.rects = null
  }

  setCollapsed(collapsed: boolean): void {
    this.headingCollapsed = collapsed
    toggleCollapsed(this.el, collapsed)
  }
}

/** Toggles `is-collapsed` on the element (and its collapse indicator). */
export function toggleCollapsed(el: HTMLElement, collapsed: boolean): void {
  el.classList.toggle('is-collapsed', collapsed)
}
