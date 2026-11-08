/* eslint-disable @typescript-eslint/no-explicit-any */
// Web page card (`LinkNode`): webview / iframe frame, URL label.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { Notice } from '../../ui/Notice'
import { randomId, type CanvasNodeData } from './json'
import { isModEvent } from './dom'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { CanvasUrlModal } from './modals'
import { embedUrlFor } from './canvasUrl'
import { ContentNode } from './CanvasContentNodes'

/** Web page card: Electron `<webview>` on desktop (iframe elsewhere). */
export class LinkNode extends ContentNode {
  url = ''
  frameEl: any = null
  labelEl: HTMLElement | null = null
  constructor(canvas: Canvas, id: string = randomId(16)) {
    super(canvas, id)
    this.alwaysKeepLoaded = true
  }
  getData(): CanvasNodeData {
    return { ...super.getData(), type: 'link', url: this.url } as CanvasNodeData
  }
  setData(data: any): void {
    super.setData(data)
    if (data.url) this.setUrl(data.url)
  }
  setUrl(url: string): void {
    if (this.url === url) return
    this.url = url
    this.canvas.markDirty(this)
    this.setFrameUrl()
  }
  recreateFrame(): void {
    if (this.frameEl) this.frameEl.detach()
    const content = this.contentEl
    let el: any
    const desktop = typeof (window as any).electron !== 'undefined' || typeof (window as any).quartzAPI !== 'undefined'
    if (desktop) {
      el = content.ownerDocument.createElement('webview')
      el.setAttribute('partition', this.canvas.webviewPartition())
      el.addClass('canvas-link')
      el.setAttribute('allowpopups', '')
      el.addEventListener('page-title-updated', () => this.updateLabel(el.getTitle()))
      content.appendChild(el)
    } else {
      el = content.createEl('iframe', 'canvas-link')
      el.setAttr('sandbox', 'allow-forms allow-presentation allow-same-origin allow-scripts allow-modals')
      el.setAttr('allow', 'fullscreen')
    }
    this.frameEl = el
    el.style.width = '100%'
    el.style.height = '100%'
    this.setFrameUrl()
  }
  initialize(): void {
    super.initialize()
    this.contentEl.addClass('node-insert-event')
    this.recreateFrame()
  }
  updateLabel(text: string): void {
    const vis = this.canvas.options.cardLabelVisibility
    let el = this.labelEl
    if (vis === 'never') {
      if (el) {
        el.detach()
        this.labelEl = null
      }
      return
    }
    if (!el) {
      el = this.labelEl = this.nodeEl.createDiv('canvas-node-label')
      el.addEventListener('click', e => {
        if (isModEvent(e)) window.open(this.url, '_blank')
      })
      el.addEventListener('dblclick', () => window.open(this.url, '_blank'))
      el.addEventListener('pointerdown', this.onPointerdown.bind(this))
    }
    el.toggleClass('mod-hover-label', vis === 'hover')
    el.setText(text)
  }
  setFrameUrl(): void {
    const el = this.frameEl
    const url = this.url
    if (!el) return
    this.updateLabel(url)
    if (!/^https?:\/\//.test(url)) return
    el.src = embedUrlFor(url) || url
  }
  showMenu(menu: Menu): void {
    super.showMenu(menu)
    if (!this.canvas.readonly)
      menu.addItem(i =>
        i
          .setSection('canvas')
          .setTitle(S.actionChangeUrl)
          .setIcon('lucide-link')
          .onClick(() =>
            new CanvasUrlModal(this.app, this.url, url => {
              this.setUrl(url)
              this.canvas.requestSave()
            }).open()
          )
      )
    menu.addItem(i => i.setSection('canvas').setTitle(S.openInBrowser).setIcon('lucide-globe').onClick(() => window.open(this.url, '_blank')))
    menu.addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.copyUrl)
        .setIcon('lucide-copy')
        .onClick(() => {
          void navigator.clipboard?.writeText(this.url)
          new Notice(S.copied('URL'))
        })
    )
    menu.addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.actionReloadPage)
        .setIcon('lucide-rotate-ccw')
        .onClick(() => {
          const el = this.frameEl
          if (!/^https?:\/\//.test(this.url)) return
          if (typeof el.loadURL === 'function') {
            try {
              el.loadURL(this.url)
            } catch {
              /* not attached yet */
            }
          } else el.src = this.url
        })
    )
  }
}
