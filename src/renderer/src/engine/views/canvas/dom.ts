// Pointer-drag plumbing shared by canvas interactions:
// the handler factory runs once the pointer moved `threshold` px (0 = immediately); pointerup ends,
// pointercancel / contextmenu / Escape cancel; keydown/keyup are forwarded while dragging.
import { Keymap } from '../../keymap/Keymap'
import { Platform } from '../../keymap/Platform'

export interface DragHandlers {
  move?(e: PointerEvent): void
  end?(e: PointerEvent | DragEvent | MouseEvent): void
  cancel?(): void
  cleanup?(): void
  keydown?(e: KeyboardEvent): void
  keyup?(e: KeyboardEvent): void
}

const NOOP = (): void => {}

export function startPointerDrag(evt: PointerEvent, factory: () => DragHandlers | null | undefined | void, threshold = 5): () => void {
  if (!evt.isPrimary) return NOOP
  let h: DragHandlers | null = null
  if (threshold === 0 && !(h = factory() || null)) return NOOP
  const win = (evt.view as Window | null) || window
  const sx = evt.clientX
  const sy = evt.clientY
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== evt.pointerId) return
    if (!h) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < threshold) return
      h = factory() || null
      if (!h) return done()
    }
    h.move?.(e)
  }
  const onUp = (e: PointerEvent): void => {
    if (e.button !== evt.button || e.pointerId !== evt.pointerId) return
    done()
    h?.end?.(e)
  }
  const onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== evt.pointerId) return
    done()
    h?.cancel?.()
  }
  const onDropLike = (e: DragEvent): void => {
    done()
    h?.end?.(e)
  }
  const onContext = (): void => {
    done()
    h?.cancel?.()
  }
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      done()
      h?.cancel?.()
    }
    h?.keydown?.(e)
  }
  const onKeyup = (e: KeyboardEvent): void => {
    h?.keyup?.(e)
  }
  function done(): void {
    win.removeEventListener('pointermove', onMove)
    win.removeEventListener('pointerup', onUp)
    win.removeEventListener('pointercancel', onCancel)
    win.removeEventListener('dragstart', onDropLike)
    win.removeEventListener('drop', onDropLike)
    win.removeEventListener('contextmenu', onContext)
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('keyup', onKeyup)
    h?.cleanup?.()
  }
  win.addEventListener('pointermove', onMove)
  win.addEventListener('pointerup', onUp)
  win.addEventListener('pointercancel', onCancel)
  win.addEventListener('dragstart', onDropLike)
  win.addEventListener('drop', onDropLike)
  win.addEventListener('contextmenu', onContext)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  return done
}

/** Swallow the next `type` event on `el` dispatched in the current task (e.g. the click after a drag). */
export function suppressNextEvent(el: HTMLElement | SVGElement, type: string): void {
  const win = el.ownerDocument.defaultView || window
  const stop = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }
  const t = win.setTimeout(() => {
    el.removeEventListener(type, stop, { capture: true })
    win.clearTimeout(t)
  }, 0)
  el.addEventListener(type, stop, { capture: true })
}

/** Events coming from editable targets (inputs, contenteditable, properties, inline title) are ignored by canvas shortcuts. */
export function isEditableTarget(node: EventTarget | null): boolean {
  if (!node || !(node instanceof Node)) return false
  const el = node instanceof Element ? node : node.parentElement
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if ((el as HTMLElement).isContentEditable) return true
  if (el.closest('.metadata-container')) return true
  if (el.closest('.inline-title')) return true
  return false
}

/** Some ancestor of the event target (below `stop`) scrolls in the wheel direction. */
export function isInsideScrollable(evt: Event, stop: Element, horizontal = false): boolean {
  let n = evt.target as Node | null
  while (n && n !== stop) {
    if (n instanceof Element && (n.scrollHeight > n.clientHeight || (horizontal && n.scrollWidth > n.clientWidth))) {
      const cs = getComputedStyle(n)
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return true
      if (horizontal && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')) return true
    }
    n = n.parentNode
  }
  return false
}

export const isModEvent = (e: MouseEvent | KeyboardEvent | null | undefined): boolean => !!e && (Platform.isMacOS ? e.metaKey : e.ctrlKey)
export const modName = (): string => (Platform.isMacOS ? '⌘' : 'Ctrl')
export { Keymap }

/** `Shift + 1` style hotkey label (the canvas tooltips use it). */
export function hotkeyLabel(mods: string[], key: string): string {
  const names: Record<string, string> = Platform.isMacOS
    ? { Mod: '⌘', Ctrl: '^', Meta: '⌘', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' }
  const parts = mods.map(m => names[m] || m)
  parts.push(key)
  return parts.join(Platform.isMacOS ? ' ' : ' + ')
}

/** Element box in client coordinates (border excluded) with its centre; the canvas viewport rect. */
export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
  cx: number
  cy: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}
export function measureViewport(el: HTMLElement): ViewportRect {
  const r = el.getBoundingClientRect()
  const left = r.left + el.clientLeft
  const top = r.top + el.clientTop
  const width = el.clientWidth
  const height = el.clientHeight
  return { left, top, width, height, cx: left + width / 2, cy: top + height / 2, minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2 }
}
