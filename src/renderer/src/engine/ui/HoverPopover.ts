// `HoverPopover` + `PopoverState` (plugin API, obsidian.d.ts).
//
// States Showing → Shown → Hiding → Hidden. Created in Showing; shown after `waitTime` (default
// 300 ms) if the target is still attached. Leaving the target while Showing hides immediately;
// leaving while Shown enters Hiding and hides after `waitTime` unless the target, the popover, a
// focused element inside it or a child popover (one whose target lies inside this popover) is
// hovered again. A 500 ms poll re-checks the element under the last mouse position; a click or
// contextmenu outside closes every popover that is not focused/hovered. One popover per parent
// (`parent.hoverPopover`). Positioned at the target (or the mouse when the target is taller than
// 300 px) with a 10 px gap; repositioned on resize at most 10 times. Fades in over 80 ms.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component } from '../core/Component'
import { hideTooltip } from './tooltip'
import { animate, CssAnimation, isBoundaryCrossing, positionNear, type Rect } from './dom'

export enum PopoverState {
  Showing = 0,
  Shown = 1,
  Hiding = 2,
  Hidden = 3
}

export interface HoverParent {
  hoverPopover: HoverPopover | null
}

export interface Point {
  x: number
  y: number
}

const pending: HoverPopover[] = []
const active: HoverPopover[] = []
let pollTimer = 0
let lastMouse: (Point & { doc: Document }) | null = null

function remove<T>(arr: T[], v: T): void {
  const i = arr.indexOf(v)
  if (i !== -1) arr.splice(i, 1)
}

function onOutsideClick(e: MouseEvent): void {
  for (const p of pending.slice()) p.hide()
  const target = e.target as Node | null
  const toHide: HoverPopover[] = []
  for (const p of active) {
    if (p.isFocused || (target && p.hoverEl.contains(target)) || p.childHovers.some(c => target && c.hoverEl.contains(target))) continue
    toHide.push(p)
  }
  const win = ((e as any).view as Window) || window
  win.setTimeout(() => toHide.forEach(p => p.hide()), 5)
}

function onMouseMove(e: MouseEvent): void {
  lastMouse = { x: e.clientX, y: e.clientY, doc: (e.target as Node | null)?.ownerDocument || document }
}

function poll(): void {
  if (active.length === 0) {
    window.removeEventListener('click', onOutsideClick, { capture: true })
    window.removeEventListener('contextmenu', onOutsideClick, { capture: true })
    window.removeEventListener('mousemove', onMouseMove)
    clearInterval(pollTimer)
    pollTimer = 0
    lastMouse = null
    return
  }
  if (!lastMouse) return
  const el = lastMouse.doc.elementFromPoint(lastMouse.x, lastMouse.y)
  for (const p of active) p.detect(el)
  for (const p of active) p.transition()
}

function startPolling(): void {
  if (pollTimer) return
  window.addEventListener('click', onOutsideClick, { capture: true })
  window.addEventListener('contextmenu', onOutsideClick, { capture: true })
  window.addEventListener('mousemove', onMouseMove)
  pollTimer = window.setInterval(poll, 500) as unknown as number
}

export class HoverPopover extends Component {
  hoverEl: HTMLElement
  state: PopoverState
  /** @internal */ parent: HoverParent
  /** @internal */ targetEl: HTMLElement | null
  /** @internal */ waitTime: number
  /** @internal */ staticPos: Point | null
  /** @internal */ onTarget = true
  /** @internal */ onHover = false
  /** @internal */ isFocused = false
  /** @internal */ timer = 0
  /** @internal */ observer: ResizeObserver | null = null

  constructor(parent: HoverParent, targetEl: HTMLElement | null, waitTime = 300, staticPos: Point | null = null) {
    super()
    this.parent = parent
    this.targetEl = targetEl
    this.waitTime = waitTime
    this.state = PopoverState.Showing
    this.staticPos = staticPos
    const el = (this.hoverEl = createDiv('popover hover-popover'))
    this.onMouseIn = this.onMouseIn.bind(this)
    this.onMouseOut = this.onMouseOut.bind(this)
    if (targetEl) {
      targetEl.addEventListener('mouseover', this.onMouseIn)
      targetEl.addEventListener('mouseout', this.onMouseOut)
    }
    el.addEventListener('mouseover', e => {
      if (isBoundaryCrossing(e, el)) {
        this.onHover = true
        this.transition()
      }
    })
    el.addEventListener('mouseout', e => {
      if (isBoundaryCrossing(e, el)) {
        this.onHover = false
        this.transition()
      }
    })
    const win = ((window as any).activeWindow as Window) || window
    this.timer = win.setTimeout(this.show.bind(this), waitTime)
    pending.push(this)
    startPolling()
  }

  /** @internal */
  onMouseIn(e: MouseEvent): void {
    if (this.targetEl && !isBoundaryCrossing(e, this.targetEl)) return
    this.onTarget = true
    this.transition()
  }

  /** @internal */
  onMouseOut(e: MouseEvent): void {
    if (this.targetEl && !isBoundaryCrossing(e, this.targetEl)) return
    this.onTarget = false
    this.transition()
  }

  /** @internal */
  detect(el: Element | null): void {
    const t = this.targetEl
    if (t) this.onTarget = el === t || (!!el && t.contains(el))
    this.onHover = el === this.hoverEl || (!!el && this.hoverEl.contains(el))
  }

  /** @internal */
  shouldShow(): boolean {
    return this.shouldShowSelf() || this.shouldShowChild()
  }

  /** @internal */
  shouldShowSelf(): boolean {
    const el = this.hoverEl
    return this.onTarget || this.onHover || this.isFocused || el.contains(el.ownerDocument.activeElement)
  }

  /** @internal Popovers whose target lies inside this one. */
  get childHovers(): HoverPopover[] {
    return active.filter(p => p !== this && !!p.targetEl && this.hoverEl.contains(p.targetEl))
  }

  /** @internal */
  shouldShowChild(): boolean {
    return this.childHovers.some(p => p.shouldShow())
  }

  /** @internal */
  setIsFocused(focused: boolean): void {
    this.isFocused = focused
  }

  /** @internal */
  transition(): void {
    const show = this.shouldShow()
    const s = this.state
    if (show) {
      if (s === PopoverState.Hiding) {
        this.state = PopoverState.Shown
        clearTimeout(this.timer)
      }
    } else if (s === PopoverState.Showing) this.hide()
    else if (s === PopoverState.Shown) {
      this.state = PopoverState.Hiding
      const win = ((window as any).activeWindow as Window) || window
      this.timer = win.setTimeout(() => {
        if (this.shouldShow()) this.transition()
        else this.hide()
      }, this.waitTime)
    }
  }

  /** @internal */
  show(): void {
    const t = this.targetEl
    if (t && !t.ownerDocument.body.contains(t)) {
      this.hide()
      return
    }
    this.state = PopoverState.Shown
    this.timer = 0
    this.position()
    this.onShow()
    remove(pending, this)
    active.push(this)
    startPolling()
    this.load()
    animate(this.hoverEl, new CssAnimation({ fn: 'var(--anim-motion-swing)', duration: 80 }).addProp('opacity', '0', '1', ''))
  }

  /** @internal */
  hide(): void {
    const { hoverEl, targetEl } = this
    this.state = PopoverState.Hidden
    remove(pending, this)
    remove(active, this)
    clearTimeout(this.timer)
    hoverEl.detach()
    if (targetEl) {
      targetEl.removeEventListener('mouseover', this.onMouseIn)
      targetEl.removeEventListener('mouseout', this.onMouseOut)
    }
    this.onTarget = false
    this.onHover = false
    for (const p of active.slice()) {
      if (!p.shouldShowSelf() && p.targetEl && hoverEl.contains(p.targetEl)) p.hide()
    }
    this.onHide()
    this.unload()
  }

  /** @internal */
  onShow(): void {
    const parent = this.parent
    if (parent.hoverPopover) parent.hoverPopover.hide()
    parent.hoverPopover = this
    hideTooltip()
  }

  /** @internal */
  onHide(): void {
    if (this.parent.hoverPopover === this) this.parent.hoverPopover = null
  }

  /** @internal */
  position(): void {
    const { hoverEl, targetEl, staticPos } = this
    const pos = staticPos || lastMouse
    let rect: Rect
    if (!staticPos && targetEl) {
      if (lastMouse && targetEl.offsetHeight > 300) {
        this.staticPos = lastMouse
        rect = { top: lastMouse.y - 10, bottom: lastMouse.y + 10, left: lastMouse.x, right: lastMouse.x }
      } else {
        const r = targetEl.getBoundingClientRect()
        rect = { top: r.top, bottom: r.top + targetEl.offsetHeight, left: r.left, right: r.left + targetEl.offsetWidth }
      }
    } else if (pos) {
      rect = { top: pos.y - 10, bottom: pos.y + 10, left: pos.x, right: pos.x }
      this.staticPos = pos
    } else rect = { top: 0, bottom: 0, left: 0, right: 0 }
    let doc: Document = ((window as any).activeDocument as Document) || document
    let rtl = false
    if (targetEl) {
      rtl = getComputedStyle(targetEl).direction === 'rtl'
      doc = targetEl.ownerDocument
    }
    if (hoverEl.parentElement !== doc.body) doc.body.appendChild(hoverEl)
    positionNear(rect, hoverEl, { gap: 10, preventOverlap: true, horizontalAlignment: rtl ? 'right' : 'left' })
  }

  /** @internal Re-position when `el` resizes (at most 10 times). */
  watchResize(el: HTMLElement): void {
    if (!this.observer) {
      let n = 0
      this.observer = new ResizeObserver(() => {
        if (this.state !== PopoverState.Shown) return
        if (++n >= 10) {
          this.observer?.disconnect()
          this.observer = null
          return
        }
        this.position()
      })
    }
    this.observer.observe(el)
  }

  onunload(): void {
    super.onunload()
    this.observer?.disconnect()
    this.observer = null
  }
}
