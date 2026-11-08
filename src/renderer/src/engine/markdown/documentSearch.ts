// Reading-view backend of the document search bar (reference model): every section of the note is scanned (rendered
// off-screen if needed) and gets `highlightRanges`; the renderer draws overlays for the shown sections during its
// virtual display, the current match is `.is-active` and scrolled into view.
import { findAllPlain, type SearchBackend } from '../ui/DocumentSearch'
import { textNodes, type MarkdownPreviewRenderer, type MarkdownSection } from './MarkdownPreviewRenderer'

export function previewSearchBackend(renderer: MarkdownPreviewRenderer, focusBack: () => void): SearchBackend {
  let hits: { section: MarkdownSection; index: number }[] = []
  const reset = (): void => {
    for (const s of renderer.sections) s.highlightRanges = null
    hits = []
  }
  return {
    find(q) {
      reset()
      for (const s of renderer.sections) {
        if (!s.shown || s.el.classList.contains('mod-ui')) continue
        renderer.ensureRendered(s)
        const text = textNodes(s.el).map(n => n.data).join('')
        const starts = findAllPlain(text, q)
        if (!starts.length) continue
        s.highlightRanges = starts.map(start => ({ start, end: start + q.length }))
        starts.forEach((_, index) => hits.push({ section: s, index }))
      }
      renderer.updateVirtualDisplay()
      return { count: hits.length, current: hits.length ? 0 : -1 }
    },
    setCurrent(i) {
      for (const h of hits) h.section.highlightRanges![h.index].active = false
      const hit = hits[i]
      if (!hit) return
      hit.section.highlightRanges![hit.index].active = true
      renderer.applyScrollSection(hit.section)
      renderer.updateVirtualDisplay()
      const active = renderer.sizerEl.querySelector('.search-highlight > .is-active') as HTMLElement | null
      if (active) {
        const pv = renderer.previewEl
        const top = active.getBoundingClientRect().top - pv.getBoundingClientRect().top + pv.scrollTop
        pv.scrollTop = Math.max(0, top - pv.clientHeight / 2)
        renderer.updateVirtualDisplay()
      }
    },
    clear() {
      reset()
      renderer.updateVirtualDisplay()
    },
    focusBack
  }
}
