// `Notice` (plugin API, obsidian.d.ts).
//
// DOM: one `body > div.notice-container` per window, each notice `div.notice > div.notice-message`
// [+ `.notice-button-container > .notice-cta`]. Slides in from translateX(350px). Default duration
// 4000 ms; 0/falsy = sticky. Hovering pauses auto-hide, which resumes 1 s after mouseleave. A click
// hides it (fade + collapse over 120 ms); the container is removed when it becomes empty.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform } from '../keymap/Platform'
import { animate, CssAnimation } from './dom'

const containers = new WeakMap<Window, HTMLElement>()

export class Notice {
  noticeEl: HTMLElement
  containerEl: HTMLElement
  messageEl: HTMLElement
  /** @internal */ timerId = -1
  /** @internal */ win: Window
  /** @internal */ buttonContainerEl: HTMLElement | null = null

  constructor(message: string | DocumentFragment, duration = 4000) {
    const win = (this.win = ((window as any).activeWindow as Window) || window)
    let container = containers.get(win)
    if (!container) {
      container = createDiv('notice-container')
      containers.set(win, container)
    }
    if (!container.parentElement) win.document.body.appendChild(container)
    const el = (this.containerEl = container.createDiv('notice'))
    this.messageEl = this.noticeEl = el.createDiv({ cls: 'notice-message', text: message as any })
    if (Platform.isMobile) animate(el, new CssAnimation().addProp('transform', 'translateY(100%)', '', ''))
    else animate(el, new CssAnimation().addProp('transform', 'translateX(350px)', '', ''))
    this.setAutoHide(duration)
    el.addEventListener('click', () => this.hide())
  }

  setMessage(message: string | DocumentFragment): this {
    this.messageEl.setText(message as any)
    return this
  }

  /** @internal (Re)starts the auto-hide timer; 0 = sticky. */
  setAutoHide(duration: number): this {
    const el = this.containerEl
    if (this.timerId !== -1) {
      this.win.clearTimeout(this.timerId)
      this.timerId = -1
    }
    if (duration) {
      let hovered = false
      const tryHide = (): void => {
        if (!hovered) this.hide()
      }
      this.timerId = this.win.setTimeout(tryHide, duration)
      el.addEventListener('mouseenter', () => (hovered = true))
      el.addEventListener('mouseleave', () => {
        hovered = false
        this.win.setTimeout(tryHide, 1000)
      })
    }
    return this
  }

  /** @internal Adds a call-to-action button; clicking it hides the notice. */
  addButton(text: string, cb: (evt: MouseEvent) => any): this {
    if (!this.buttonContainerEl) this.buttonContainerEl = this.containerEl.createDiv('notice-button-container')
    this.buttonContainerEl.createDiv({ cls: 'notice-cta', text }).addEventListener('click', e => {
      this.hide()
      cb(e)
    })
    return this
  }

  hide(): void {
    const el = this.containerEl
    if (this.timerId !== -1) {
      this.win.clearTimeout(this.timerId)
      this.timerId = -1
    }
    const done = (): void => {
      el.detach()
      const c = containers.get(this.win)
      if (c && c.childElementCount === 0) c.detach()
    }
    if (!el.parentElement) {
      done()
      return
    }
    if (Platform.isMobile) {
      animate(el, new CssAnimation({ duration: 150 }).addProp('transform', 'scale(1, 1)', 'scale(0.85, 0.85)', '').addProp('opacity', '1', '0', ''), done)
      return
    }
    const cs = getComputedStyle(el)
    let shift = -el.offsetHeight
    const mb = parseInt(cs.marginBottom)
    if (!Number.isNaN(mb)) shift -= mb
    animate(el, new CssAnimation({ duration: 120 }).addProp('opacity', '1', '0').addProp('margin-top', '0px', shift + 'px'), done)
  }
}
