/* eslint-disable @typescript-eslint/no-explicit-any */
// Reading-view DOM/scheduling helpers and code-text utilities (split from MarkdownPreviewRenderer.ts).

export function forFirstHeading(el: HTMLElement, cb: (h: HTMLElement) => void): void {
  const first = el.firstChild
  if (first instanceof el.ownerDocument.defaultView!.HTMLHeadingElement) cb(first as HTMLElement)
}
export function forFoldableListItems(el: HTMLElement, cb: (li: HTMLElement) => void): void {
  for (const li of Array.from(el.querySelectorAll('li'))) {
    if (li.querySelectorAll('ul, ol').length > 0) cb(li as HTMLElement)
  }
}

export function prependSpan(parent: HTMLElement, cls: string): HTMLSpanElement {
  const s = parent.ownerDocument.createElement('span')
  s.className = cls
  parent.insertBefore(s, parent.firstChild)
  return s
}

export const renderOptions = { progressiveRender: true, asyncParse: true, listBullet: true }

/** Delegated event helper (like `el.on(type, selector, cb)`). */
export function delegate(root: HTMLElement, type: string, selector: string, cb: (evt: any, target: any) => void): void {
  root.addEventListener(type, (evt) => {
    let t = evt.target as Node | null
    while (t && t !== root) {
      if (t.nodeType === 1 && (t as Element).matches(selector)) {
        cb(evt, t as HTMLElement)
        return
      }
      t = t.parentNode
    }
  })
}


/** Idle callback (with timeout) for delays > 0, else next animation frame. */
export function schedule(fn: () => void, delay: number): { cancel(): void; high: boolean } {
  const w = window as any
  if (delay > 0 && w.requestIdleCallback) {
    let done = false
    const idle = w.requestIdleCallback(
      () => {
        done = true
        clearTimeout(timer)
        fn()
      },
      { timeout: delay }
    )
    const timer = setTimeout(() => {
      done = true
      w.cancelIdleCallback(idle)
      fn()
    }, delay)
    return {
      high: false,
      cancel: () => {
        if (!done) {
          done = true
          w.cancelIdleCallback(idle)
          clearTimeout(timer)
        }
      }
    }
  }
  if (typeof requestAnimationFrame === 'function') {
    // rAF; a timer backs it up when the window isn't painting (hidden/occluded).
    let done = false
    const run = () => {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      clearTimeout(backup)
      fn()
    }
    const raf = requestAnimationFrame(run)
    const backup = setTimeout(run, 100)
    return {
      high: true,
      cancel: () => {
        done = true
        cancelAnimationFrame(raf)
        clearTimeout(backup)
      }
    }
  }
  const id = setTimeout(fn, delay)
  return { cancel: () => clearTimeout(id), high: true }
}

/** Reorder `parent`'s children to exactly `nodes`, touching as little DOM as possible. */
export function setChildrenInPlace(parent: HTMLElement, nodes: Node[]): void {
  let cur = parent.firstChild
  const keep = new Set(nodes)
  for (const node of nodes) {
    if (cur === node) {
      cur = cur.nextSibling
      continue
    }
    parent.insertBefore(node, cur)
  }
  while (cur) {
    const next: ChildNode | null = cur.nextSibling
    if (!keep.has(cur)) parent.removeChild(cur)
    cur = next
  }
}

export function isShown(el: HTMLElement): boolean {
  return !!el.offsetParent
}

/** Start/end offsets of 0-based line `n`. */
export function lineRange(text: string, n: number): { start: number; end: number } {
  let idx = -1
  for (let i = 0; i < n; i++) idx = text.indexOf('\n', idx + 1)
  const start = idx + 1
  const end = text.indexOf('\n', start)
  return { start, end: end !== -1 ? end : text.length }
}

export function cssEscapeClass(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1')
}

/** Code text without the trailing newline, cached per element. */
export const codeTextCache = new WeakMap<Element, string>()
export function getCodeText(el: Element): string {
  const cached = codeTextCache.get(el)
  if (cached !== undefined) return cached
  let t = el.textContent || ''
  if (t.endsWith('\n')) t = t.substring(0, t.length - 1)
  codeTextCache.set(el, t)
  return t
}

/** `cssclasses` frontmatter → classes (space-free strings only). */
export function getCssClasses(fm: any): string[] | null {
  if (!fm) return null
  let v: unknown = null
  for (const k of Object.keys(fm)) {
    if (/^cssclasses$/i.test(k)) {
      v = fm[k]
      break
    }
  }
  if (!v) return null
  let list: string[]
  if (typeof v === 'string') list = [v.trim()]
  else if (Array.isArray(v)) list = v.filter((x) => typeof x === 'string').map((x) => x.trim())
  else return null
  return list.filter((x) => !!x && !x.includes(' '))
}

/** Text nodes of `el` in document order. */
export function textNodes(el: Node): Text[] {
  const out: Text[] = []
  const w = el.ownerDocument!.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text)
  return out
}

/** DOM Range for [start, end) offsets in the concatenated text of `nodes`. */
export function rangeAt(nodes: Text[], start: number, end: number): Range | null {
  let pos = 0
  let range: Range | null = null
  for (const n of nodes) {
    const len = n.length
    if (!range && start < pos + len) {
      range = n.ownerDocument.createRange()
      range.setStart(n, start - pos)
    }
    if (range && end <= pos + len) {
      range.setEnd(n, end - pos)
      return range
    }
    pos += len
  }
  return null
}
