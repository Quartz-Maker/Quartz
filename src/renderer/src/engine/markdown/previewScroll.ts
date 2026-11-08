// Reading-view scroll position <-> source-line mapping (split from MarkdownPreviewRenderer.ts).
import { isShown, renderOptions, setChildrenInPlace } from './previewDom'
import type { MarkdownPreviewRenderer } from './MarkdownPreviewRenderer'

/** Scroll position as a fractional source line. */
export function getScroll(r: MarkdownPreviewRenderer): number | null {
  const sections = r.sections
  if (sections.length === 0) return null
  const scrollTop = r.previewEl.scrollTop
  let line = 0
  let top = r.topSpace
  for (const s of sections) {
    if (!s.computed) return null
    if (!(scrollTop > top + s.height || (line === 0 && s.lines === 0))) {
      let h = s.height
      if (line === 0) {
        h += top
        top = 0
      }
      let result = line
      const within = scrollTop - top
      let frac = 0
      if (s.lines > 0) {
        const per = h / s.lines
        const d = Math.floor(within / per)
        result += d
        frac = within / per - d
      }
      const secTop = (r as any).elTop(s.el)
      let prev: HTMLElement | undefined
      let prevLine = 0
      let per = h / s.lines
      for (const li of Array.from(s.el.querySelectorAll('li'))) {
        if (!r.belongsToMe(li)) continue
        const l = parseInt(li.getAttribute('data-line') ?? '')
        if (l < 0 || isNaN(l) || !isShown(li as HTMLElement)) continue
        if (!((r as any).elTop(li as HTMLElement) - secTop < within)) {
          const dl = l - prevLine
          if (dl > 0) per = ((r as any).elTop(li as HTMLElement) - (prev ? (r as any).elTop(prev) : secTop)) / dl
          break
        }
        prevLine = l
        prev = li as HTMLElement
        per = 0
      }
      if (prev) {
        if (per === 0) per = (s.el.offsetTop + s.height - (r as any).elTop(prev)) / (s.lines - prevLine)
        result = line + prevLine
        frac = (within - ((r as any).elTop(prev) - secTop)) / per
      }
      return result + frac
    }
    line += s.lines
    if (s.shown) top += s.height
  }
  return line
}

export function applyScroll(r: MarkdownPreviewRenderer, line: number, opts?: { highlight?: boolean; center?: boolean }): boolean {
  if (typeof line !== 'number' || isNaN(line)) return false
  if (r.text !== r.lastText) return false
  const whole = Math.floor(line)
  const frac = line - whole
  r.scrolling = true
  const { highlight, center } = opts || {}
  let acc = 0
  let top = r.topSpace
  for (const s of r.sections) {
    if (!s.computed) return false
    if (acc + s.lines <= whole) {
      acc += s.lines
      if (s.shown) top += s.height
      continue
    }
    if (!s.shown && highlight) {
      r.showSection(s)
      if (s.shown) return r.applyScroll(line, opts)
    }
    let h = s.height
    if (acc === 0) {
      h += top
      top = 0
    }
    let per = h / s.lines
    const rel = whole - acc
    let offset = 0
    if (center) offset -= (r.previewEl.clientHeight - per) / 2
    let target = Math.max(0, top + per * (rel + frac) + offset)
    r.previewEl.scrollTop = target
    r.updateVirtualDisplay()
    let prev: HTMLElement | null = null
    let prevLine = 0
    for (const li of Array.from(s.el.querySelectorAll('li'))) {
      if (!r.belongsToMe(li)) continue
      const l = parseInt(li.getAttribute('data-line') ?? '')
      if (l < 0 || isNaN(l) || !isShown(li as HTMLElement)) continue
      if (!(l <= rel)) {
        const dl = l - prevLine
        if (dl > 0) per = ((r as any).elTop(li as HTMLElement) - (prev ? (r as any).elTop(prev) : s.el.offsetTop)) / dl
        break
      }
      prevLine = l
      prev = li as HTMLElement
      per = 0
    }
    if (prev) {
      if (per === 0) per = (s.el.offsetTop + s.height - (r as any).elTop(prev)) / (s.lines - prevLine)
      const t = (r as any).elTop(prev) - s.el.offsetTop
      target = Math.max(0, top + t + per * (rel - prevLine + frac) + offset)
      r.previewEl.scrollTop = target
    }
    if (highlight) r.highlightEl(prev || s.el)
    return true
  }
  return true
}

export function updateVirtualDisplay(self: MarkdownPreviewRenderer, scrollTopArg?: number): void {
  const preview = self.previewEl
  const sizer = self.sizerEl
  const pusher = self.pusherEl
  const sections = self.sections
  let scrollTop = preview.scrollTop
  if (typeof scrollTopArg === 'number') scrollTop = scrollTopArg
  if (!renderOptions.progressiveRender) {
    setChildrenInPlace(sizer, [pusher, ...sections.map((s) => s.el)])
    sizer.style.minHeight = ''
    pusher.style.marginBottom = '0'
    if (preview.scrollTop !== scrollTop) preview.scrollTop = scrollTop
    return
  }
  self.lastScroll = scrollTop
  const viewport = preview.clientHeight
  const bottom = scrollTop + viewport
  const top = Math.min(scrollTop, preview.scrollHeight - viewport)
  const extra = Math.max(viewport * self.renderExtra, self.renderExtraMinPx)
  const winTop = top - extra
  const winBottom = bottom + extra
  let total = 0
  let measured = 0
  for (const s of sections) {
    if (s.height > 0) {
      total += s.height
      measured++
    }
  }
  const avg = measured > 0 ? total / measured : 0
  let pushTop = 0
  let y = self.topSpace
  const children: Node[] = [pusher]
  let first = -1
  let last = -1
  let selFirst = -1
  let selLast = -1
  let selStart: Node | null = null
  let selEnd: Node | null = null
  const sel = preview.ownerDocument.getSelection?.()
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0)
    if (!r.collapsed && preview.contains(r.startContainer) && preview.contains(r.endContainer)) {
      selStart = r.startContainer
      selEnd = r.endContainer
      if (selStart === pusher || (selStart === sizer && r.startOffset <= 1)) selFirst = 0
      if (selEnd === sizer && r.endOffset > 1) selLast = sections.length - 1
    }
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const el = s.el
    if (selStart && (el === selStart || el.contains(selStart))) selFirst = i
    if (selEnd && (el === selEnd || el.contains(selEnd))) selLast = i
    if (!s.shown) continue
    const h = s.height
    if (s.computed) {
      const next = y + h
      if (next >= winTop && y <= winBottom) {
        if (first === -1) first = i
        last = i
      }
      y = next
    } else {
      y += h
      if (h === 0) y += avg
    }
  }
  let from = first
  let to = last
  if (selFirst !== -1 && selLast !== -1) {
    from = Math.min(from, selFirst)
    to = Math.max(to, selLast)
  }
  if (from < 0) from = 0
  if (++to > sections.length - 1) to = sections.length - 1
  y = self.topSpace
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const el = s.el
    if (s.shown && from <= i && i <= to) children.push(el)
    else if (el.parentNode === sizer) el.remove()
    let h = s.height
    if (!s.computed && h === 0) h = avg
    if (!s.shown) h = 0
    if (i === from) pushTop = y
    y = y + h
  }
  if (pushTop > 0 && (pushTop -= self.topSpace) < 0) pushTop = 0
  y -= self.topSpace
  y = Math.max(0, y)
  pusher.style.marginBottom = pushTop + 'px'
  sizer.style.minHeight = y - 1 + 'px'
  setChildrenInPlace(sizer, children)
  if (to !== sections.length - 1) to--
  for (let i = from; i <= to; i++) {
    const s = sections[i]
    if (s && s.shown) self.measureSection(s)
  }
  if (preview.scrollTop !== scrollTop) preview.scrollTop = scrollTop
  self.renderHighlights(from, to)
}
