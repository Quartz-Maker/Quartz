/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.dragManager` (DragManager-lite): tracks the "draggable" of an in-app drag
// (file / files / folder / link / heading / bookmarks), draws the drag ghost with the action
// label, and lets drop targets register with `handleDrop`. Same draggable shapes, DOM
// (`.drag-ghost`, `.drag-ghost-self`, `.drag-ghost-action`, body.is-grabbing) and handler
// protocol that plugins expect from DragManager.
import { TFile, TFolder } from '../vault/TAbstractFile'
import { setIcon } from '../ui/icons'

export interface Draggable {
  source?: string
  type: string
  icon?: string
  title?: string
  ghostEl?: HTMLElement
  ghostAnchor?: { x: number; y: number }
  [k: string]: any
}
export interface DropResult {
  action?: string | null
  dropEffect?: 'copy' | 'link' | 'move' | 'none'
  hoverEl?: HTMLElement | null
  hoverClass?: string
}
export type DropHandler = (evt: DragEvent, draggable: Draggable | null, isOver: boolean) => DropResult | boolean | void

const setPlain = (dt: DataTransfer, v: string): void => dt.setData('text/plain', v)
const setUrl = (dt: DataTransfer, v: string): void => {
  dt.setData('text/plain', v)
  dt.setData('text/uri-list', v)
}

export class DragManager {
  app: any
  ghostEl: HTMLElement | null = null
  actionEl: HTMLElement | null = null
  draggable: Draggable | null = null
  sourceEls: HTMLElement[] | null = null
  sourceClass = ''
  hoverEl: HTMLElement | null = null
  hoverClass = ''
  overlayEl: HTMLElement
  isDragOverHandled = false

  constructor(app: any) {
    this.app = app
    this.overlayEl = createDiv('workspace-drop-overlay')
    if (typeof window === 'undefined') return
    window.addEventListener('dragstart', this.onDragStartGlobal.bind(this))
    window.addEventListener('dragover', this.onDragOverFirst.bind(this), { capture: true })
    window.addEventListener('dragover', this.onDragOver.bind(this))
  }

  private onDragStartGlobal(e: DragEvent): void {
    const n = e.target as HTMLElement
    n.addEventListener('dragend', () => this.onDragEnd(), { once: true })
    if (!this.draggable) {
      const sel = window.getSelection()
      if ((!(sel && sel.rangeCount > 0) || sel.getRangeAt(0).collapsed) && n.nodeName === 'IMG') {
        const file = this.app.vault.resolveFileUrl((n as HTMLImageElement).src)
        if (file) this.onDragStart(e, this.dragFile(e, file))
      }
    }
  }
  private onDragOverFirst(): void {
    this.isDragOverHandled = false
    queueMicrotask(() => {
      if (!this.isDragOverHandled) {
        this.setAction(null)
        this.updateHover(null, '')
      }
    })
  }
  private onDragOver(e: DragEvent): void {
    this.isDragOverHandled = true
    const g = this.ghostEl
    if (g && (e.clientX !== 0 || e.clientY !== 0)) {
      const a = this.draggable?.ghostAnchor
      g.style.left = '0'
      g.style.top = '0'
      g.style.translate = a ? `${e.clientX - a.x}px ${e.clientY - a.y}px` : `${e.clientX + 5}px ${e.clientY + 5}px`
      if (g.parentNode !== document.body) document.body.appendChild(g)
      g.show()
    }
  }
  onDragEnd(): void {
    if (this.ghostEl) {
      this.ghostEl.detach()
      this.ghostEl = null
    }
    this.draggable = null
    this.updateSource(null, '')
    this.updateHover(null, '')
    document.body.removeClass('is-grabbing')
    this.overlayEl.detach()
  }
  onDragStart(e: DragEvent, d: Draggable | null): void {
    const dt = e.dataTransfer
    if (!dt || this.draggable) return
    this.draggable = d
    document.body.addClass('is-grabbing')
    dt.effectAllowed = 'all'
    if (this.ghostEl) {
      this.ghostEl.detach()
      this.ghostEl = null
    }
    if (d && d.ghostEl) this.ghostEl = d.ghostEl
    else if (d) {
      const g = (this.ghostEl = document.body.createDiv('drag-ghost'))
      const self = g.createDiv('drag-ghost-self')
      if (d.icon) setIcon(self, d.icon)
      if (d.title) self.createSpan({ text: d.title })
      this.actionEl = g.createDiv('drag-ghost-action')
    }
    // Hide the browser's own drag image: the ghost element follows the pointer instead.
    const blank = document.createElement('div')
    document.body.append(blank)
    dt.setDragImage(blank, 0, 0)
    setTimeout(() => blank.detach(), 0)
    let empty = true
    for (const it of Array.from(dt.items)) {
      if (it.kind !== 'string' || dt.getData(it.type) !== '') {
        empty = false
        break
      }
    }
    if (empty) dt.setData('text/plain', (d && d.title) || '-')
  }
  /** Make `el` draggable; `cb(evt)` returns the Draggable for the drag. */
  handleDrag(el: HTMLElement, cb: (e: DragEvent) => Draggable | null | undefined): void {
    el.draggable = true
    el.addEventListener('dragstart', e => {
      const d = cb(e)
      if (d) this.onDragStart(e, d)
    })
  }
  dragFile(e: DragEvent, file: TFile, source?: string): Draggable {
    setUrl(e.dataTransfer!, this.app.getObsidianUrl(file))
    return { source, type: 'file', icon: 'lucide-file', title: file.name.replace(/\.md$/, ''), file }
  }
  dragFolder(e: DragEvent, folder: TFolder, source?: string): Draggable {
    setPlain(e.dataTransfer!, folder.name)
    return { source, type: 'folder', icon: 'lucide-folder-open', title: folder.name, file: folder }
  }
  dragFiles(e: DragEvent, files: (TFile | TFolder)[], source?: string): Draggable | null {
    if (files.length === 0) return null
    let nf = 0
    let nd = 0
    const urls: string[] = []
    for (const f of files) {
      if (f instanceof TFile) {
        nf++
        urls.push(this.app.getObsidianUrl(f))
      } else if (f instanceof TFolder) nd++
    }
    const title = nd > 0 && nf > 0 ? `${nf} files and ${nd} folders` : nd > 0 ? `${nd} folders` : nf > 0 ? `${nf} files` : ''
    setUrl(e.dataTransfer!, urls.join('\n'))
    return { source, type: 'files', icon: 'lucide-files', title, files }
  }
  dragLink(e: DragEvent, linktext: string, sourcePath: string, title?: string, source?: string): Draggable {
    const path = linktext.split('#')[0].split('|')[0]
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath)
    let url = linktext
    let short = linktext
    if (file) {
      url = this.app.getObsidianUrl(file)
      short = file.name.replace(/\.md$/, '')
    }
    setUrl(e.dataTransfer!, url)
    return { source, type: 'link', icon: 'lucide-link', title: title || short, linktext, sourcePath, file }
  }
  /** Register a drop target. `cb(evt, draggable, isOver)`: while over, return a DropResult to accept; on drop return truthy when handled. */
  handleDrop(el: HTMLElement, cb: DropHandler, always = false): void {
    const over = (e: DragEvent): void => {
      if ((always || this.draggable) && !e.defaultPrevented) {
        const r = cb(e, this.draggable, true)
        if (r) {
          e.preventDefault()
          const { action, dropEffect, hoverEl, hoverClass } = r === true ? ({} as DropResult) : (r as DropResult)
          if (action) this.setAction(action)
          if (dropEffect) e.dataTransfer!.dropEffect = dropEffect
          if (hoverEl && hoverClass) this.updateHover(hoverEl, hoverClass)
        }
      }
    }
    el.addEventListener('dragover', over)
    el.addEventListener('dragenter', over)
    el.addEventListener('drop', e => {
      if ((always || this.draggable) && !e.defaultPrevented && cb(e, this.draggable, false)) e.preventDefault()
    })
  }
  setAction(text: string | null | undefined): void {
    const a = this.actionEl
    if (!a) return
    if (text) {
      a.setText(text)
      a.show()
    } else a.hide()
  }
  updateSource(els: HTMLElement[] | null, cls: string): void {
    if (this.sourceEls) for (const e of this.sourceEls) e.removeClass(this.sourceClass)
    this.sourceEls = els
    this.sourceClass = cls
    if (els) for (const e of els) e.addClass(cls)
  }
  updateHover(el: HTMLElement | null, cls: string): void {
    if (el === this.hoverEl) return
    if (this.hoverEl) this.hoverEl.removeClass(this.hoverClass)
    this.hoverEl = el
    this.hoverClass = cls
    if (el) el.addClass(cls)
  }
  showOverlay(doc: Document, r: { x: number; y: number; width: number; height: number }): void {
    const o = this.overlayEl
    if (o.parentNode !== doc.body) doc.body.appendChild(o)
    o.show()
    o.style.transform = `translate(${r.x}px, ${r.y}px)`
    o.style.width = r.width + 'px'
    o.style.height = r.height + 'px'
  }
  hideOverlay(): void {
    this.overlayEl.hide()
  }
  removeOverlay(): void {
    this.overlayEl.detach()
  }
}
