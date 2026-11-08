/* eslint-disable @typescript-eslint/no-explicit-any */
// Popout windows. The renderer opens a same-origin child window with
// `window.open('about:blank', '_blank', 'popup,width=…,height=…,x=…,y=…')`; the main process allows it
// with the same webPreferences as a vault window and maps it to the vault. The child shares this JS
// realm's app object (`win.app`), mirrors the main document's stylesheets/body classes, relays input
// events to the main window (so global key/drag handlers also see popout events) and tracks
// `activeWindow` / `activeDocument` on focus.
import { installEnhancements } from '../core/enhance'
import { installFrame } from '../app/frame'

export interface PopoutOpenOptions {
  x?: number
  y?: number
  width?: number
  height?: number
  parented?: boolean
}

export interface PopoutHandle {
  win: any
  baseEl: HTMLElement
  /** Stops mirroring styles/classes into the popout. */
  cleanup(): void
}

/** Events re-dispatched on the main window so its global handlers (hotkeys, drag & drop, …) see them. */
const RELAYED = [
  'fullscreenchange', 'click', 'contextmenu', 'auxclick', 'keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove',
  'copy', 'paste', 'cut', 'drag', 'dragstart', 'dragover', 'dragend', 'dragenter', 'dragleave', 'drop', 'open-url'
]
/** Body classes the popout owns itself instead of inheriting from the main window. */
const OWN_BODY_CLASSES = ['is-frameless', 'is-focused', 'is-fullscreen']
const SKIP_VARS = ['--zoom-factor', '--keyboard-height']

export function canOpenPopout(): boolean {
  return typeof window !== 'undefined' && typeof window.open === 'function' && /Electron\//.test(navigator.userAgent || '')
}

function toHex(color: string): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color)
  if (!m) return ''
  return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')
}

/** Re-dispatches a popout event on the main window as a synthetic clone that proxies default prevention. */
function relay(e: Event): void {
  const C = e.constructor as any
  const copy: any = new C(e.type, e)
  copy.isRelayed = true
  copy.isSynthetic = (e as any).isSynthetic
  for (const m of ['preventDefault', 'stopPropagation', 'stopImmediatePropagation'] as const) {
    const orig = copy[m]
    copy[m] = () => {
      orig.call(copy)
      ;(e as any)[m]()
    }
  }
  Object.defineProperty(copy, 'target', { get: () => e.target })
  Object.defineProperty(copy, 'currentTarget', { get: () => e.currentTarget })
  window.dispatchEvent(copy)
}

/** Mirrors the main document's `<style>`/stylesheet `<link>` elements and body classes/variables into `w`. */
export function startStyleRelay(w: any, pinned: Element[]): () => void {
  const clones = new WeakMap<Element, Element>()
  let applied: Element[] = []
  const known = new Set((w.document.body.className as string).split(' ').filter(Boolean))
  let ownVars: Record<string, boolean> = {}

  const cloneOf = (el: Element): Element => {
    let c = clones.get(el)
    if (!c) {
      c = el.cloneNode(true) as Element
      clones.set(el, c)
      if (el instanceof HTMLStyleElement && el.sheet && !el.textContent) {
        // Styles injected through the CSSOM (no text) are copied rule by rule.
        const rules: string[] = []
        for (const r of Array.from(el.sheet.cssRules)) rules.push(r.cssText)
        c.textContent = rules.join('\n')
      }
    }
    return c
  }
  const syncHead = (): void => {
    const wanted: Element[] = [...pinned]
    for (const n of Array.from(document.head.childNodes)) {
      const isCss = n instanceof HTMLStyleElement || (n instanceof HTMLLinkElement && (n.rel === 'stylesheet' || n.type === 'text/css'))
      if (!isCss) continue
      if (n instanceof HTMLStyleElement && (n.textContent || '').includes('ͼ1')) continue // CodeMirror mounts its own
      wanted.push(cloneOf(n as Element))
    }
    for (const c of applied) if (!wanted.includes(c)) c.remove()
    const head = w.document.head as HTMLElement
    let prev: Node | null = null
    for (const c of wanted) {
      if (c.parentNode !== head || (prev ? c.previousSibling !== prev : false)) head.insertBefore(c, prev ? prev.nextSibling : head.firstChild)
      prev = c
    }
    applied = wanted
  }
  const syncBody = (): void => {
    const main = document.body
    const body = w.document.body as HTMLElement
    const out: string[] = []
    for (const c of Array.from(main.classList)) {
      known.add(c)
      if (!OWN_BODY_CLASSES.includes(c) && !out.includes(c)) out.push(c)
    }
    const own = new Set(body.className.split(' ').filter(Boolean))
    for (const c of OWN_BODY_CLASSES) if (own.has(c)) out.push(c)
    if (!out.includes('is-popout-window')) out.push('is-popout-window')
    for (const c of own) if (!known.has(c) && !out.includes(c)) out.push(c) // classes set on the popout itself
    body.className = out.join(' ')
    const vars: Record<string, boolean> = {}
    for (let i = 0; i < main.style.length; i++) {
      const k = main.style[i]
      if (k.startsWith('--') && !SKIP_VARS.includes(k)) {
        body.style.setProperty(k, main.style.getPropertyValue(k))
        vars[k] = true
      }
    }
    for (const k in ownVars) if (!vars[k]) body.style.removeProperty(k)
    ownVars = vars
    w.document.documentElement.style.setProperty('font-size', getComputedStyle(document.body).fontSize)
  }

  const mo = new MutationObserver(muts => {
    let head = false
    let body = false
    for (const m of muts) {
      if (m.target === document.body) {
        body = true
        continue
      }
      for (const n of [m.target, ...Array.from(m.addedNodes), ...Array.from(m.removedNodes)]) {
        if (n instanceof HTMLStyleElement || n instanceof HTMLLinkElement) {
          clones.delete(n)
          head = true
        }
      }
    }
    if (head) syncHead()
    if (body) syncBody()
  })
  mo.observe(document.head, { attributes: true, attributeFilter: ['data-change'], subtree: true, childList: true, characterData: true })
  mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
  const onFocusChange = (): void => syncBody()
  syncHead()
  syncBody()
  return () => {
    mo.disconnect()
    window.removeEventListener('focuschange', onFocusChange)
  }
}

let focusTracking = false
function trackMainFocus(): void {
  if (focusTracking) return
  focusTracking = true
  window.addEventListener('focus', () => {
    ;(window as any).activeWindow = window
    ;(window as any).activeDocument = document
  })
}

/** Opens a popout browser window and prepares its document. Returns null when popouts are unavailable. */
export function openPopoutBrowserWindow(o: PopoutOpenOptions = {}): PopoutHandle | null {
  if (!canOpenPopout()) return null
  const f = ['popup']
  if (o.parented) f.push('parented=1')
  if (o.width !== undefined) f.push('width=' + Math.round(o.width))
  if (o.height !== undefined) f.push('height=' + Math.round(o.height))
  if (o.x !== undefined && o.y !== undefined) f.push('x=' + Math.round(o.x), 'y=' + Math.round(o.y))
  try {
    const bg = toHex(getComputedStyle(document.body).backgroundColor)
    if (bg) f.push('background=' + bg)
  } catch {
    /* ignore */
  }
  let w: any = null
  try {
    w = window.open('about:blank', '_blank', f.join(','))
  } catch {
    w = null
  }
  if (!w) return null
  trackMainFocus()
  const baseEl = document.createElement('base')
  baseEl.href = location.href
  w.document.head.appendChild(baseEl)
  installEnhancements(w)
  attachElectron(w)
  const cleanup = startStyleRelay(w, [baseEl])
  setupFocus(w)
  for (const type of RELAYED) w.addEventListener(type, relay, { capture: true })
  w.addEventListener('focus', () => {
    ;(window as any).activeWindow = w
    ;(window as any).activeDocument = w.document
  })
  try {
    installFrame(w)
  } catch (e) {
    console.error(e)
  }
  const ew = w.electronWindow
  if (ew) {
    try {
      ew.setFrameZoomLevel((window as any).electron?.webFrame?.getZoomLevel?.() ?? (w.require?.('electron').webFrame.getZoomLevel() || 0))
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        ew.show()
      } catch {
        /* closed */
      }
    }, 0)
  }
  return { win: w, baseEl, cleanup }
}

export function attachElectron(w: any): void {
  let t = w
  while (t !== t.parent && t.parent !== null) t = t.parent
  const req = t.require
  if (!req) return
  try {
    const el = req('electron')
    w.electron = el
    if (!el.remote) {
      try {
        el.remote = req('@electron/remote')
      } catch (e) {
        console.error(e)
      }
    }
    w.electronWindow = el.remote?.getCurrentWindow()
    const open = w.open
    w.open = function (url: any, ...rest: any[]) {
      if (typeof url === 'string' && url.indexOf('file:') === 0) {
        el.ipcRenderer.send('open-url', url)
        return null
      }
      return open.call(this, url, ...rest)
    }
  } catch (e) {
    console.error(e)
  }
}

function setupFocus(w: any): void {
  const doc: Document = w.document
  let upd = (): void => doc.body.toggleClass('is-focused', doc.hasFocus())
  if (w.electronWindow) {
    upd = () => doc.body.toggleClass('is-focused', w.electronWindow.isFocused())
    w.addEventListener('focuschange', upd)
  } else {
    w.addEventListener('focus', upd)
    w.addEventListener('blur', upd)
  }
  upd()
}

export interface PopupWindowOptions {
  title: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  x?: number
  y?: number
  onClose?: () => void
}

/** A popout hosting a single modal (e.g. settings): centred on the opener unless a visible saved position is given. */
export function openPopupWindow(o: PopupWindowOptions): { win: any; cleanup: () => void } | null {
  const width = o.width ?? 900
  const height = o.height ?? 700
  let x: number | undefined
  let y: number | undefined
  if (o.x !== undefined && o.y !== undefined) {
    try {
      const displays = (window as any).electron?.remote?.screen?.getAllDisplays?.()
      const visible = (d: any): boolean => {
        const r = d.workArea
        return o.x! < r.x + r.width - 2 && o.x! + width > r.x + 2 && o.y! < r.y + r.height - 2 && o.y! + height > r.y + 2
      }
      if (displays && displays.some(visible)) {
        x = o.x
        y = o.y
      }
    } catch {
      /* ignore */
    }
  }
  if (x === undefined || y === undefined) {
    x = Math.round(window.screenX + (window.outerWidth - width) / 2)
    y = Math.round(window.screenY + (window.outerHeight - height) / 2)
  }
  const h = openPopoutBrowserWindow({ width, height, x, y, parented: !!(window as any).electronWindow?.isFullScreen?.() })
  if (!h) return null
  const w = h.win
  w.document.title = o.title
  if (w.electronWindow && (o.minWidth || o.minHeight)) w.electronWindow.setMinimumSize(o.minWidth || 0, o.minHeight || 0)
  if (o.onClose) w.addEventListener('pagehide', o.onClose)
  return {
    win: w,
    cleanup() {
      if (o.onClose) w.removeEventListener('pagehide', o.onClose)
      const g: any = window
      if (g.activeWindow === w) {
        g.activeWindow = window
        g.activeDocument = document
      }
      try {
        w.electronWindow?.hide()
      } catch {
        /* closed */
      }
      h.cleanup()
      w.close()
    }
  }
}
