// Small helpers shared by the workspace/view layer.

/** `debounce(cb, timeout, resetTimer)`: the returned function has `cancel()` and `run()`. */
export interface Debouncer<T extends unknown[], V> {
  (...args: T): this
  cancel(): this
  run(): V | void
}

export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let ctx: unknown = null
  let args: T | null = null
  let due = 0
  const fire = (): V => {
    const c = ctx, a = args as T
    ctx = null
    args = null
    return cb.apply(c, a)
  }
  const tick = (): void => {
    if (due) {
      const now = Date.now()
      if (now < due) {
        timer = setTimeout(tick, due - now)
        due = 0
        return
      }
    }
    timer = null
    fire()
  }
  const fn = function (this: unknown, ...a: T) {
    ctx = this
    args = a
    if (!timer) timer = setTimeout(tick, timeout)
    else if (resetTimer) due = Date.now() + timeout
    return fn
  } as Debouncer<T, V>
  fn.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    return fn
  }
  fn.run = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      return fire()
    }
  }
  return fn
}

/** Coalesce calls into one microtask (used for `requestUpdateLayout`). */
export function microtaskCoalesce<T extends unknown[]>(cb: (...args: T) => void): (...args: T) => void {
  let pending = false
  let ctx: unknown = null
  let args: T | null = null
  return function (this: unknown, ...a: T) {
    ctx = this
    args = a
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      const c = ctx, x = args as T
      ctx = null
      args = null
      cb.apply(c, x)
    })
  }
}

/** 16 lowercase hex chars — the id format used for every layout item and link group. */
export function genId(len = 16): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ((16 * Math.random()) | 0).toString(16)
  return s
}

/** Truncate to `max` chars with an ellipsis (tooltips, menus). */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trim() + '…'
}

/**
 * Visibility test used instead of `el.isShown()` (offsetParent): attached to a document and no ancestor with `display:none`.
 */
export function isElShown(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (el.offsetParent) return true
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.style && n.style.display === 'none') return false
  }
  return true
}

export function isTFileLike(f: any): boolean {
  return !!f && typeof f === 'object' && typeof f.path === 'string' && typeof f.extension === 'string' && typeof f.basename === 'string'
}

export const IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus']
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'mkv']
export const PDF_EXTENSIONS = ['pdf']
export const MARKDOWN_EXTENSIONS = ['md']
export const CANVAS_EXTENSIONS = ['canvas']
export const BASES_EXTENSIONS = ['base']

export function extnameOf(path: string): string {
  // Path-extension rule: last dot, not first/last char.
  const dot = path.lastIndexOf('.')
  return dot === -1 || dot === path.length - 1 || dot === 0 ? '' : path.slice(dot + 1).toLowerCase()
}
