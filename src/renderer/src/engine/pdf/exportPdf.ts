/* eslint-disable @typescript-eslint/no-explicit-any */
// Export to PDF (`workspace:export-pdf`, view menu item). A modal collects the options and persists them in
// app.json `pdfExportSettings`; the note is rendered by the reading pipeline into `div.print` of a hidden popup
// window (light theme), then the main-process `print-to-pdf` IPC writes the file.
import { ConfirmationModal, Notice, Platform, Setting } from '../ui'
import { Component } from '../core/Component'
import { electron, nodeRequire } from '../node'
import { mdastToHtml, parseMarkdown, getFrontMatter } from '../markdown/pipeline'
import { sanitizeHTMLToDom } from '../markdown/sanitize'
import { getCssClasses } from '../markdown/MarkdownPreviewRenderer'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { installBuiltinPostProcessors } from '../markdown/postprocessors'
import { randomDocId } from '../markdown/embeds'
import { startStyleRelay, attachElectron } from '../workspace/popout'
import { installEnhancements } from '../core/enhance'
import { installFrame } from '../app/frame'
import { PDF } from './strings'

const remote = (): any => (electron() as any).remote ?? nodeRequire('@electron/remote')
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export interface PdfExportSettings {
  includeName?: boolean
  pageSize: string
  landscape: boolean
  margin: string
  downscalePercent: number
}

/** Options handed to the `print-to-pdf` IPC (Electron `printToPDF` options plus `filepath`/`open`). */
export interface PrintOptions {
  includeName?: boolean
  pageSize: string
  landscape: boolean
  marginsType: number
  margins?: { top: number; left: number; bottom: number; right: number }
  scaleFactor: number
  scale: number
  open: boolean
  filepath?: string
}

export const canExportPdf = (): boolean => Platform.canExportPdf

/** Converts the modal values into IPC options (margin "1"/"2" → zero margins, scale clamped to 0.1–2). */
export function buildPrintOptions(s: PdfExportSettings): PrintOptions {
  const o: PrintOptions = {
    includeName: s.includeName,
    pageSize: s.pageSize,
    landscape: s.landscape,
    marginsType: parseInt(s.margin),
    scaleFactor: s.downscalePercent,
    scale: Math.min(2, Math.max(0.1, s.downscalePercent / 100)),
    open: true
  }
  if (o.marginsType === 1 || o.marginsType === 2) o.margins = { top: 0, left: 0, bottom: 0, right: 0 }
  return o
}

/** Renders `file` into `container` as the print DOM: `div.markdown-preview-view.markdown-rendered > div*`. */
export async function renderPrintDom(app: any, file: any, container: HTMLElement, owner: Component, includeName: boolean): Promise<HTMLElement> {
  installBuiltinPostProcessors()
  const doc = container.ownerDocument
  const view = container.createDiv('markdown-preview-view markdown-rendered')
  view.toggleClass('rtl', !!app.vault.getConfig('rightToLeft'))
  view.toggleClass('show-properties', app.vault.getConfig('propertiesInDocument') !== 'hidden')
  if (includeName) view.createEl('h1', { text: file.basename })
  const md: string = await app.vault.cachedRead(file)
  const tree = parseMarkdown(md)
  const frontmatter = getFrontMatter(tree)
  const html = sanitizeHTMLToDom(mdastToHtml(tree), doc)
  const frag = doc.createDocumentFragment()
  for (const el of Array.from(html.children) as HTMLElement[]) {
    if (el.tagName === 'HR') frag.appendChild(el)
    else frag.createDiv({}, d => d.appendChild(el))
  }
  view.appendChild(frag)
  view.addClasses(getCssClasses(frontmatter) ?? [])
  const promises: Promise<any>[] = []
  MarkdownRenderer.postProcess(app, {
    docId: randomDocId(),
    sourcePath: file.path,
    frontmatter,
    promises,
    addChild: (c: any) => owner.addChild(c),
    getSectionInfo: () => null,
    replace: () => null as any,
    containerEl: view,
    el: view,
    displayMode: true
  } as any)
  if (promises.length > 0) await Promise.all(promises)
  for (const a of view.findAll('a.internal-link')) a.removeAttribute('href')
  return view
}

export class PdfExportModal extends ConfirmationModal {
  file: any
  includeName!: any
  pageSize!: any
  landscape!: any
  marginsType!: any
  scaleFactor!: any
  ctaEl!: HTMLElement

  constructor(app: any, file: any) {
    super(app)
    this.file = file
    this.modalEl.addClass('mod-narrow')
    this.titleEl.setText(PDF.title)
    const el = this.contentEl
    el.createEl('p', { cls: 'u-muted u-break-word', text: PDF.caption.replace('{{filename}}', file.basename) })
    const s: PdfExportSettings = app.vault.getConfig('pdfExportSettings')
    new Setting(el).setName(PDF.includeName).addToggle(c => { this.includeName = c; c.setValue(s.includeName as boolean) })
    new Setting(el).setName(PDF.pageSize).addDropdown(c => {
      this.pageSize = c
      for (const p of ['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid']) c.addOption(p, p)
      c.setValue(s.pageSize)
    })
    new Setting(el).setName(PDF.landscape).addToggle(c => { this.landscape = c; c.setValue(s.landscape) })
    new Setting(el).setName(PDF.margin).addDropdown(c => {
      this.marginsType = c
      c.addOption('0', PDF.marginDefault).addOption('2', PDF.marginMinimal).addOption('1', PDF.marginNone)
      c.setValue(s.margin)
    })
    new Setting(el).setName(PDF.downscale).addSlider(c => { this.scaleFactor = c; c.setLimits(10, 100, 1).setValue(s.downscalePercent) })
    this.buttonContainerEl.createEl('button', { cls: 'mod-cta', text: PDF.button }, btn => {
      this.ctaEl = btn
      btn.addEventListener('click', () => void this.onExport(btn))
    })
    this.addCancelButton()
  }

  private async onExport(btn: HTMLElement): Promise<void> {
    btn.addClass('mod-loading')
    const settings: PdfExportSettings = {
      includeName: this.includeName.getValue(),
      pageSize: this.pageSize.getValue(),
      landscape: this.landscape.getValue(),
      margin: this.marginsType.getValue(),
      downscalePercent: this.scaleFactor.getValue()
    }
    this.app.vault.setConfig('pdfExportSettings', settings)
    const opts = buildPrintOptions(settings)
    const res = await remote().dialog.showSaveDialog({
      defaultPath: this.file.basename + '.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['showOverwriteConfirmation']
    })
    btn.removeClass('mod-loading')
    if (res.canceled || !res.filePath) return
    opts.filepath = res.filePath
    this.close()
    await this.printToPdf(opts)
  }

  onOpen(): void {
    window.setTimeout(() => this.ctaEl.focus())
  }

  async printToPdf(opts: PrintOptions): Promise<void> {
    const w: any = window.open('about:blank', '_blank', 'popup,hide=true')
    if (!w) {
      new Notice(PDF.failed)
      return
    }
    const base = createEl('base', { href: location.href })
    w.document.head.appendChild(base)
    w.document.title = this.file.basename
    installEnhancements(w)
    attachElectron(w)
    startStyleRelay(w, [base])() // one-shot copy of styles/body classes; no live mirroring
    try {
      installFrame(w)
    } catch (e) {
      console.error(e)
    }
    const busy = new Notice(PDF.preparing, 0)
    const doc: Document = w.document
    await sleep(200)
    doc.body.removeClass('theme-dark')
    doc.body.addClass('theme-light')
    const printEl = doc.body.createDiv('print')
    const owner = new Component()
    owner.load()
    const cleanup = (): void => {
      printEl.detach()
      owner.unload()
      try { w.close() } catch { /* closed */ }
      busy.hide()
    }
    printEl.addEventListener('click', cleanup)
    try {
      await renderPrintDom(this.app, this.file, printEl, owner, !!opts.includeName)
      await sleep(200)
      await new Promise<void>(resolve => {
        const ipc = w.electron.ipcRenderer
        ipc.once('print-to-pdf', () => resolve())
        ipc.send('print-to-pdf', opts)
      })
      new Notice(PDF.saved.replace('{{path}}', opts.filepath ?? ''))
    } catch (e) {
      console.error(e)
      new Notice(PDF.failed)
    } finally {
      cleanup()
    }
  }
}

/** Opens the export modal for a note (`MarkdownView.printToPdf`). */
export function openPdfExport(app: any, file: any): void {
  new PdfExportModal(app, file).open()
}
