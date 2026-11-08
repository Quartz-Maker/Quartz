// Tooltips (plugin API, obsidian.d.ts: `setTooltip`, `displayTooltip`).
//
// Tooltips are declared purely through attributes — `aria-label` (text), `data-tooltip-position`
// (non-bottom placement), `data-tooltip-classes`, `data-tooltip-delay`, `data-tooltip-gap` — read by
// one delegated `pointerover` listener per document. Hover tooltips wait 1000 ms unless the element
// sets a delay (tab headers / ribbon use 300 ms); once a tooltip has been visible, moving to the
// next labelled element within 100 ms shows the next one immediately. DOM: `body > div.tooltip
// [.mod-top|.mod-left|.mod-right] > text + div.tooltip-arrow`. Elements whose computed
// `--no-tooltip` is `true` never show one.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isTouchEvent, isBoundaryCrossing, parseNumber } from './dom'

export type TooltipPlacement = 'bottom' | 'right' | 'left' | 'top'
export interface TooltipOptions {
  placement?: TooltipPlacement
  classes?: string[]
  gap?: number
  delay?: number
}
interface DisplayOptions extends TooltipOptions {
  /** @internal align horizontally with this element instead of the target */
  horizontalParent?: HTMLElement
}

const DEFAULT_GAP = 8
const ARROW_SIZE = 5
/** Delay used by tab headers and ribbon actions. */
export const TOOLTIP_DELAY = 300
/** Default hover delay when the element does not set `data-tooltip-delay`. */
export const TOOLTIP_DELAY_SLOW = 1000
const FADE_WINDOW = 100

let tooltipEl: HTMLElement | null = null
let tooltipTarget: HTMLElement | null = null
let showTimer: number | null = null
let hideTimer: number | null = null
let hideTimerWin: Window | null = null
let lastHidden = 0

function cancelShow(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

function cancelHide(): void {
  if (hideTimer !== null) {
    hideTimerWin?.clearTimeout(hideTimer)
    hideTimer = null
    hideTimerWin = null
  }
}

function scheduleHide(): void {
  cancelShow()
  if (tooltipEl && hideTimer === null) {
    tooltipTarget = null
    hideTimerWin = tooltipEl.win
    hideTimer = hideTimerWin.setTimeout(hideTooltip, FADE_WINDOW)
  }
}

/** Hides the current tooltip (and cancels a pending one). */
export function hideTooltip(): void {
  cancelShow()
  cancelHide()
  if (tooltipEl) {
    lastHidden = Date.now()
    tooltipEl.detach()
    tooltipEl = null
    tooltipTarget = null
  }
}

function noTooltip(el: Element): boolean {
  return getComputedStyle(el).getPropertyValue('--no-tooltip').trim() === 'true'
}

function showFromAttributes(el: HTMLElement): void {
  cancelShow()
  let text = el.getAttribute('aria-label') || ''
  const dyn = dynamicTooltips.get(el)
  if (dyn) text = dyn(el)
  let placement: TooltipPlacement = 'bottom'
  if (el.hasAttribute('data-tooltip-position')) placement = el.getAttribute('data-tooltip-position') as TooltipPlacement
  let classes: string[] = []
  if (el.hasAttribute('data-tooltip-classes')) classes = (el.getAttribute('data-tooltip-classes') || '').split(' ')
  let delay = TOOLTIP_DELAY_SLOW
  if (el.hasAttribute('data-tooltip-delay')) {
    delay = parseInt(el.getAttribute('data-tooltip-delay') || '')
    if (Number.isNaN(delay)) delay = TOOLTIP_DELAY_SLOW
  }
  let gap: number | undefined
  if (el.hasAttribute('data-tooltip-gap')) gap = parseNumber(el.getAttribute('data-tooltip-gap'), undefined)
  displayTooltip(el, text, { placement, classes, delay, gap })
}

function onPointerOver(e: PointerEvent, target: HTMLElement): void {
  if (isTouchEvent(e) || !isBoundaryCrossing(e, target) || noTooltip(target)) return
  showFromAttributes(target)
}

function onPointerOut(e: PointerEvent, target: HTMLElement): void {
  if (isTouchEvent(e) || !isBoundaryCrossing(e, target)) return
  scheduleHide()
  const rel = e.relatedTarget as any
  if (rel && rel.matchParent) {
    const next = rel.matchParent('[aria-label]')
    if (next && next instanceof (next.ownerDocument.defaultView || window).HTMLElement) {
      if (noTooltip(next)) return
      showFromAttributes(next)
    }
  }
}

const installed = new WeakSet<Document>()
/** Installs the delegated hover listeners on a document (once per document). */
export function initTooltips(doc: Document = document): void {
  if (installed.has(doc)) return
  installed.add(doc)
  const body = doc.body as any
  body.on('pointerover', '[aria-label]', onPointerOver)
  body.on('pointerout', '[aria-label]', onPointerOut)
  body.addEventListener('pointerup', hideTooltip)
}

/** `displayTooltip(el, content, options)`: shows a tooltip for `el` now (or after `delay`). */
export function displayTooltip(el: HTMLElement, content: string | DocumentFragment, options?: DisplayOptions): void {
  if (!content) return
  const o: DisplayOptions = options || {}
  const placement = o.placement ?? 'bottom'
  const classes = (o.classes ?? []).slice()
  const gap = o.gap ?? DEFAULT_GAP
  const delay = o.delay ?? 0
  if (delay > 0 && !tooltipEl && Date.now() > lastHidden + FADE_WINDOW) {
    cancelShow()
    o.delay = 0
    showTimer = window.setTimeout(() => displayTooltip(el, content, o), delay)
    return
  }
  if (!el.isShown()) return
  const doc = el.doc
  const r = el.getBoundingClientRect()
  let { left, width } = r
  const { top, height } = r
  if (o.horizontalParent) {
    const pr = o.horizontalParent.getBoundingClientRect()
    left = pr.left
    width = pr.width
  }
  cancelHide()
  if (tooltipEl && tooltipTarget === el) tooltipEl.setText(content as any)
  else {
    hideTooltip()
    tooltipEl = createDiv({ cls: 'tooltip', text: content as any })
  }
  const tip = tooltipEl
  const arrow = tip.createDiv('tooltip-arrow')
  let y = 0
  let x = 0
  if (placement === 'bottom') {
    y = top + height + gap
    x = left + width / 2
  } else if (placement === 'right') {
    y = top + height / 2
    x = left + width + gap
    classes.push('mod-right')
  } else if (placement === 'left') {
    y = top + height / 2
    x = left - gap
    classes.push('mod-left')
  } else if (placement === 'top') {
    y = top - gap - ARROW_SIZE
    x = left + width / 2
    classes.push('mod-top')
  }
  tip.addClasses(classes.filter(Boolean))
  tip.style.top = '0px'
  tip.style.left = '0px'
  tip.style.width = ''
  tip.style.height = ''
  if (!tip.parentNode) doc.body.appendChild(tip)
  const tr = tip.getBoundingClientRect()
  const halfW = placement === 'bottom' || placement === 'top' ? tr.width / 2 : tr.width
  const halfH = placement === 'right' || placement === 'left' ? tr.height / 2 : tr.height
  if (placement === 'left') x -= halfW
  else if (placement === 'top') y -= halfH
  const bodyH = doc.body.clientHeight
  const bodyW = doc.body.clientWidth
  if (y + halfH > bodyH) y = bodyH - halfH - gap
  y = Math.max(y, gap)
  if (placement === 'top' || placement === 'bottom') {
    if (x + halfW > bodyW) {
      const shift = x + halfW + gap - bodyW
      x -= shift
      arrow.style.left = 'initial'
      arrow.style.right = halfW - shift - gap / 2 + 'px'
    } else if (x - gap - halfW < 0) {
      const shift = -(x - gap - halfW)
      x += shift
      arrow.style.right = 'initial'
      arrow.style.left = halfW - shift - gap / 2 + 'px'
    }
    x = Math.max(x, gap)
  }
  tip.style.top = y + 'px'
  tip.style.left = x + 'px'
  tip.style.width = tr.width + 'px'
  tip.style.height = tr.height + 'px'
  tooltipTarget = el
}

function writeOptions(el: HTMLElement, o?: TooltipOptions): void {
  if (!o) return
  if (o.placement && o.placement !== 'bottom') el.setAttribute('data-tooltip-position', o.placement)
  if (o.classes) el.setAttribute('data-tooltip-classes', o.classes.join(' '))
  if (o.delay) el.setAttribute('data-tooltip-delay', String(o.delay))
  if (o.gap) el.setAttribute('data-tooltip-gap', String(o.gap))
}

/** `setTooltip(el, text, options)`; refreshes the visible tooltip if it belongs to `el`. */
export function setTooltip(el: HTMLElement, tooltip: string, options?: TooltipOptions): void {
  el.setAttribute('aria-label', tooltip)
  writeOptions(el, options)
  if (tooltipTarget === el) displayTooltip(el, tooltip, options)
}

const dynamicTooltips = new WeakMap<HTMLElement, (el: HTMLElement) => string>()

/** @internal Tooltip text computed on hover (`aria-label` is ""), used for counts. */
export function setDynamicTooltip(el: HTMLElement, getText: (el: HTMLElement) => string, options?: TooltipOptions): void {
  el.setAttribute('aria-label', '')
  dynamicTooltips.set(el, getText)
  writeOptions(el, options)
  if (tooltipTarget === el) displayTooltip(el, getText(el), options)
}

/** @internal */
export function getDynamicTooltip(el: HTMLElement): string | null {
  const fn = dynamicTooltips.get(el)
  return fn ? fn(el) : null
}
