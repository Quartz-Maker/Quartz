// Small DOM utilities shared by the UI kit (positioning, CSS-transition animations, focus,
// pointer-type detection).
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- pointer type -------------------------------------------------------------------------

let mousePointerMoves = 0
let activeTouches = 0
let lastTouchEnd = 0
let lastScroll = 0
const trackedDocs = new WeakSet<Document>()

/**
 * Hover is ignored for touch input: a pointer event counts as "mouse" only after at least two
 * real mouse `pointermove`s since the last touch (so synthetic/touch pointerover is ignored).
 */
export function installPointerTracking(doc: Document = document): void {
  if (trackedDocs.has(doc)) return
  trackedDocs.add(doc)
  const win = doc.defaultView || window
  doc.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType === 'mouse') mousePointerMoves++
  }, true)
  win.addEventListener('touchstart', (e: TouchEvent) => {
    activeTouches = e.touches.length
    mousePointerMoves = 0
  }, true)
  const end = (e: TouchEvent): void => {
    activeTouches = e.touches.length
    if (activeTouches === 0) lastTouchEnd = Date.now()
  }
  win.addEventListener('touchend', end, true)
  win.addEventListener('touchcancel', end, true)
  win.addEventListener('scroll', () => (lastScroll = Date.now()), { capture: true, passive: true })
}

/** True when a mouse/pointer event was produced by touch (or a pointer that never moved). */
export function isTouchEvent(e: Event): boolean {
  const win = (e as any).view || window
  if (!(e instanceof win.MouseEvent)) return false
  if (typeof win.PointerEvent !== 'undefined' && e instanceof win.PointerEvent) {
    return (e as PointerEvent).pointerType !== 'mouse' || mousePointerMoves < 2
  }
  if (activeTouches > 0) return true
  void lastScroll
  return Date.now() - lastTouchEnd < 400
}

/** `relatedTarget` is outside `el` (mouseover/mouseout crossing el's boundary). */
export function isBoundaryCrossing(e: MouseEvent, el: Element): boolean {
  const rel = e.relatedTarget as Node | null
  return !rel || !el.contains(rel)
}

// ---- animation ----------------------------------------------------------------------------

/** A CSS transition: `from` applied immediately, `to` on the next frame, `end` when done. */
export class CssAnimation {
  from: Record<string, string> = {}
  to: Record<string, string> = {}
  end: Record<string, string> = {}
  duration: number
  fn: string
  constructor(opts?: { duration?: number; fn?: string }) {
    this.duration = opts?.duration ?? 100
    this.fn = opts?.fn ?? 'ease-in-out'
  }
  addProp(prop: string, from: string | null, to: string | null, end: string | null = null): this {
    if (from !== null) this.from[prop] = from
    if (to !== null) this.to[prop] = to
    if (end !== null) this.end[prop] = end
    return this
  }
}

interface Running {
  anim: CssAnimation
  finish: () => void
  timer: number
  done?: () => void
  win: Window
}
const running = new WeakMap<HTMLElement, Running>()
const pendingFrames = new WeakMap<Window, (() => void)[]>()

function applyStyle(el: HTMLElement, props: Record<string, string>): void {
  for (const k in props) (el.style as any)[k] = props[k]
}

/** Stops a running animation on `el` (applying its end state; calls its callback unless `silent`). */
export function stopAnimation(el: HTMLElement, silent?: boolean): void {
  const r = running.get(el)
  running.delete(el)
  if (!r) return
  el.style.transition = ''
  el.style.transitionProperty = ''
  applyStyle(el, r.anim.end)
  r.win.clearTimeout(r.timer)
  el.removeEventListener('transitionend', r.finish)
  if (!silent) r.done?.()
}

export function animate(el: HTMLElement, anim: CssAnimation, done?: () => void): void {
  stopAnimation(el)
  applyStyle(el, anim.from)
  const win = (el.ownerDocument.defaultView || window) as Window
  const r: Running = { anim, finish: () => stopAnimation(el), timer: 0, done, win }
  running.set(el, r)
  let queue = pendingFrames.get(win)
  if (!queue) {
    const q: (() => void)[] = (queue = [])
    pendingFrames.set(win, q)
    win.setTimeout(() => {
      void win.document.body.offsetHeight
      pendingFrames.delete(win)
      for (const f of q) f()
    }, 0)
  }
  queue.push(() => {
    if (running.get(el) !== r) return
    el.style.transition = 'all ' + anim.duration + 'ms ' + anim.fn
    el.style.transitionProperty = Object.keys(anim.from).join(', ')
    applyStyle(el, anim.to)
    el.addEventListener('transitionend', (e: Event) => {
      if (e.target === el) r.finish()
    })
    r.timer = win.setTimeout(r.finish, anim.duration + 50)
  })
}

// ---- positioning --------------------------------------------------------------------------

export interface Rect {
  top: number
  bottom: number
  left: number
  right: number
}

function cssInt(el: Element, prop: string): number {
  const v = parseInt(getComputedStyle(el).getPropertyValue(prop))
  return Number.isNaN(v) ? 0 : v
}

/**
 * Places `el` (absolutely positioned) next to `rect`: below if it fits, else above, else
 * whichever side has more room (`preventOverlap`) — 10px viewport margins, optional `gap`.
 */
export function positionNear(rect: Rect, el: HTMLElement, opts?: { gap?: number; horizontalAlignment?: 'left' | 'right' | 'center'; preventOverlap?: boolean }): void {
  const o = opts || {}
  el.show()
  const doc = el.ownerDocument
  const win = doc.defaultView || window
  const gap = o.gap ?? 0
  const container = (el.offsetParent as HTMLElement) || doc.documentElement
  const align = o.horizontalAlignment ?? 'left'
  const preventOverlap = o.preventOverlap ?? false
  if (preventOverlap) el.style.maxHeight = ''
  const insetTop = cssInt(container, '--safe-area-inset-top')
  const insetBottom = cssInt(container, '--safe-area-inset-bottom')
  const insetLeft = cssInt(container, '--safe-area-inset-left')
  const insetRight = cssInt(container, '--safe-area-inset-right')
  const cr = container.getBoundingClientRect()
  const bottomEdge = container.scrollTop + container.clientHeight
  let minTop = container.scrollTop + 10
  let maxBottom = bottomEdge - 10
  if (insetTop > cr.top) minTop += insetTop - cr.top
  if (insetBottom > win.innerHeight - cr.bottom) maxBottom -= insetBottom - (win.innerHeight - cr.bottom)
  const top = Math.min(rect.top, maxBottom)
  const bottom = Math.max(rect.bottom, minTop)
  const h = el.offsetHeight
  const above = rect.top - minTop
  const below = maxBottom - rect.bottom
  const fitsAbove = above >= h + gap
  const fitsBelow = below >= h + gap
  let styleTop: number | null = null
  let styleBottom: number | null = null
  if (fitsBelow) styleTop = bottom + gap
  else if (fitsAbove || (preventOverlap && above > below)) styleBottom = bottomEdge - (top - gap)
  else styleTop = preventOverlap ? bottom + gap : container.clientHeight < h + gap ? minTop : maxBottom - h
  let minLeft = container.scrollLeft + 10
  let maxRight = container.scrollLeft + container.clientWidth - 10
  if (insetLeft > cr.left) minLeft += insetLeft - cr.left
  if (insetRight > win.innerWidth - cr.right) maxRight -= insetRight - (win.innerWidth - cr.right)
  const w = el.offsetWidth
  if (align === 'left') {
    let left = rect.left
    if (left < minLeft) left = minLeft
    else if (left + w > maxRight) left = maxRight - w
    el.style.left = left + 'px'
    el.style.right = ''
  } else if (align === 'center') {
    let left = rect.left + (rect.right - rect.left) / 2
    if (left < minLeft) left = minLeft
    else if (left + w / 2 > maxRight) left = maxRight - w
    el.style.left = left + 'px'
    el.style.right = ''
  } else {
    let right = rect.right
    if (right > maxRight) right = maxRight
    else if (right - w < minLeft) right = minLeft + w
    el.style.left = ''
    el.style.right = container.clientWidth - right + 'px'
  }
  el.style.top = styleTop !== null ? styleTop + 'px' : ''
  el.style.bottom = styleBottom !== null ? styleBottom + 'px' : ''
  if (!fitsAbove && !fitsBelow && preventOverlap) el.style.maxHeight = (above > below ? above - gap : below - gap) + 'px'
}

/** Calls `cb` once `el` gets hidden (or detached with mode 'attached'); polls every `interval` ms. */
export function onElementGone(el: HTMLElement, interval: number, cb: () => void, mode: 'visibility' | 'attached' = 'visibility'): () => void {
  const win = (el.ownerDocument.defaultView || window) as Window
  const id = win.setInterval(() => {
    const gone = mode === 'visibility' ? !el.isShown() : !el.ownerDocument.body.contains(el)
    if (gone) {
      win.clearInterval(id)
      cb()
    }
  }, interval)
  return () => win.clearInterval(id)
}

// ---- focus --------------------------------------------------------------------------------

const FOCUSABLE = ['a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable]:not([contenteditable="false"])', '[tabindex]']
  .map(s => s + ':not([disabled]):not([tabindex="-1"])')
  .join(',')

export function findFocusable(container: HTMLElement): HTMLElement | null {
  const list = container.querySelectorAll(FOCUSABLE)
  const win = container.ownerDocument.defaultView || window
  for (let i = 0; i < list.length; i++) {
    const el: any = list[i]
    if ((el instanceof win.HTMLElement && el.isShown()) || el instanceof win.SVGElement) return el as HTMLElement
  }
  return null
}

export function focusFirst(container: HTMLElement, opts?: FocusOptions): HTMLElement | null {
  const el = findFocusable(container)
  el?.focus(opts)
  return el
}

/** Blurs the active element and clears the selection of `win`. */
export function clearFocusAndSelection(win: Window = window): void {
  const active = win.document.activeElement
  if (active && active instanceof (win as any).HTMLElement) (active as HTMLElement).blur()
  win.getSelection()?.removeAllRanges()
}

/** Clicks / Enter / Space on `el` call `cb` (default prevented). */
export function onActivate(el: HTMLElement, cb: (e: Event) => void): void {
  el.addEventListener('click', e => {
    e.preventDefault()
    cb(e)
  })
  el.addEventListener('keydown', e => {
    if (e.isComposing || e.defaultPrevented) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      cb(e)
    }
  })
}

/** Is `node` (or the iframe hosting it) attached to `win`'s document? */
export function isAttachedTo(win: Window, node: Node): boolean {
  let n: Node = node
  while ((n.ownerDocument?.defaultView as any)?.frameElement) n = (n.ownerDocument!.defaultView as any).frameElement
  return win.document.body.contains(n)
}

export function parseNumber(v: string | null | undefined, fallback: number): number
export function parseNumber(v: string | null | undefined, fallback: number | undefined): number | undefined
export function parseNumber(v: string | null | undefined, fallback: number | undefined): number | undefined {
  const n = parseFloat(v as string)
  return Number.isNaN(n) ? fallback : n
}
