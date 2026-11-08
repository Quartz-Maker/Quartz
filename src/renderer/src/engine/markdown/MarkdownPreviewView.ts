/* eslint-disable @typescript-eslint/no-explicit-any */
// Reading-mode sub-view (plugin API `MarkdownPreviewView`):
// `.markdown-reading-view` > renderer, header section (inline title + properties slot),
// footer section (backlinks-in-document slot), vault-config driven classes,
// Mod+A / Mod+C behaviour, ephemeral line scroll.
import { MarkdownRenderer } from './MarkdownRenderer'
import { onPostProcessorChange, getMarkdownHost } from './host'
import { globalParseOptions } from './pipeline'

/** The hosting markdown view (MarkdownView), reduced to what reading mode uses. */
export interface PreviewHostView {
  file: { path: string; basename: string } | null
  /** Persist an edit made from reading mode (checkbox toggle, code-block replace). */
  onEdit?(text: string): void
  onScroll?(line: number | null): void
  onFoldChange?(): void
  /** Optional externally owned elements mounted into the header/footer sections. */
  inlineTitleEl?: HTMLElement
  metadataContainerEl?: HTMLElement
  backlinksEl?: HTMLElement
  /** Notice hook ("Press Mod+C to copy source", "Copied to your clipboard"). */
  notice?(msg: string): void
}

export class MarkdownPreviewView extends MarkdownRenderer {
  containerEl: HTMLElement
  view: PreviewHostView
  type = 'preview'
  inlineTitleEl: HTMLElement
  metadataContainerEl: HTMLElement
  backlinksEl: HTMLElement
  private offPP: (() => void) | null = null
  private foldTimer = 0

  constructor(app: any, contentEl: HTMLElement, view: PreviewHostView) {
    const wrap = contentEl.ownerDocument.createElement('div')
    wrap.className = 'markdown-reading-view'
    wrap.style.width = '100%'
    wrap.style.height = '100%'
    contentEl.appendChild(wrap)
    super(app, wrap)
    this.containerEl = wrap
    this.view = view
    const r = this.renderer
    r.addBottomPadding = true
    this.updateReadableLineLength()
    this.updateFoldHeading()
    this.updateFoldIndent()
    this.updateIndentGuide()
    this.updateRTL()
    this.updatePropertiesInDocument()
    this.updateStrictLineBreaks()
    r.onResize()
    r.addHeader()
    r.addFooter()
    this.inlineTitleEl = view.inlineTitleEl ?? createInlineTitle(view.file?.basename ?? '')
    this.metadataContainerEl = view.metadataContainerEl ?? createMetadataPlaceholder()
    this.backlinksEl = view.backlinksEl ?? createBacklinksPlaceholder()
    wrap.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.isComposing || e.target !== r.previewEl || !(e.ctrlKey || e.metaKey)) return
      if (e.key === 'a') {
        e.preventDefault()
        view.notice?.('Press Mod+C to copy source')
      } else if (e.key === 'c' && !wrap.ownerDocument.getSelection()?.toString()) {
        e.preventDefault()
        void navigator.clipboard.writeText(this.get())
        view.notice?.('Copied to your clipboard')
      }
    })
    this.show()
  }

  get file(): any {
    return this.view.file
  }

  onload(): void {
    this.offPP = onPostProcessorChange(() => this.rerender(true))
  }
  onunload(): void {
    this.offPP?.()
    clearTimeout(this.foldTimer)
    super.onunload()
  }

  show(): void {
    const r = this.renderer
    r.header!.el.appendChild(this.inlineTitleEl)
    r.header!.el.appendChild(this.metadataContainerEl)
    r.footer!.el.appendChild(this.backlinksEl)
    this.containerEl.style.display = ''
  }
  hide(): void {
    this.containerEl.style.display = 'none'
  }

  get(): string {
    return this.renderer.text
  }
  set(data: string, clear: boolean): void {
    if (clear) this.clear()
    this.renderer.set(data)
  }
  clear(): void {
    this.renderer.clear()
  }
  rerender(full?: boolean): void {
    this.renderer.rerender(full)
  }
  getScroll(): number {
    return this.renderer.getScroll() as number
  }
  applyScroll(scroll: number): void {
    this.renderer.applyScroll(scroll)
  }
  getFoldInfo() {
    return this.renderer.getFoldInfo()
  }
  applyFoldInfo(info: any): void {
    this.renderer.applyFoldInfo(info)
  }
  setEphemeralState(state: { line?: number; scroll?: number; focus?: boolean }): void {
    if (state.focus) {
      const p = this.renderer.previewEl
      p.tabIndex = -1
      p.focus({ preventScroll: true })
    }
    if (typeof state.scroll === 'number') this.renderer.applyScrollDelayed(state.scroll)
    if (state.line !== undefined && state.line >= 0) this.renderer.applyScrollDelayed(state.line, { highlight: true })
  }

  private cfg(key: string, def: unknown): any {
    const v = getMarkdownHost().getConfig(key)
    return v === undefined ? def : v
  }
  updateReadableLineLength(): void {
    this.renderer.previewEl.classList.toggle('is-readable-line-width', !!this.cfg('readableLineLength', true))
  }
  updateFoldHeading(): void {
    const v = !!this.cfg('foldHeading', true)
    this.renderer.previewEl.classList.toggle('allow-fold-headings', v)
    if (!v) this.renderer.unfoldAllHeadings()
  }
  updateFoldIndent(): void {
    const v = !!this.cfg('foldIndent', true)
    this.renderer.previewEl.classList.toggle('allow-fold-lists', v)
    if (!v) this.renderer.unfoldAllLists()
  }
  updateIndentGuide(): void {
    this.renderer.previewEl.classList.toggle('show-indentation-guide', !!this.cfg('showIndentGuide', true))
  }
  updateRTL(): void {
    this.renderer.previewEl.classList.toggle('rtl', !!this.cfg('rightToLeft', false))
  }
  updatePropertiesInDocument(): void {
    this.renderer.previewEl.classList.toggle('show-properties', this.cfg('propertiesInDocument', 'visible') !== 'hidden')
  }
  updateStrictLineBreaks(): void {
    globalParseOptions.breaks = !this.cfg('strictLineBreaks', false)
    this.rerender()
  }
  /** Vault `config-changed` handler. */
  onConfigChanged(key: string): void {
    switch (key) {
      case 'readableLineLength':
        return this.updateReadableLineLength()
      case 'foldHeading':
        return this.updateFoldHeading()
      case 'foldIndent':
        return this.updateFoldIndent()
      case 'showIndentGuide':
        return this.updateIndentGuide()
      case 'rightToLeft':
        return this.updateRTL()
      case 'propertiesInDocument':
        return this.updatePropertiesInDocument()
      case 'strictLineBreaks':
        return this.updateStrictLineBreaks()
    }
  }

  edit(text: string): void {
    this.renderer.set(text)
    this.view.onEdit?.(text)
  }
  onScroll(): void {
    if (Date.now() - this.renderer.lastRender < 100) return
    this.view.onScroll?.(this.renderer.getScroll())
  }
  onFoldChange(): void {
    clearTimeout(this.foldTimer)
    this.foldTimer = window.setTimeout(() => this.view.onFoldChange?.(), 500)
  }
}

function createInlineTitle(title: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'inline-title'
  el.contentEditable = 'true'
  el.spellcheck = true
  el.setAttribute('autocapitalize', 'on')
  el.tabIndex = -1
  el.setAttribute('enterkeyhint', 'done')
  el.textContent = title
  return el
}
/** Properties editor slot; the metadata editor itself belongs to the properties area. */
function createMetadataPlaceholder(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'metadata-container'
  el.tabIndex = -1
  el.style.display = 'none'
  return el
}
function createBacklinksPlaceholder(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'embedded-backlinks'
  el.style.display = 'none'
  return el
}
