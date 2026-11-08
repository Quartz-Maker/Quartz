// Reading-view fold state <-> source-line conversion (split from MarkdownPreviewRenderer.ts).
import { toggleCollapsed } from './previewSection'
import { forFirstHeading, forFoldableListItems } from './previewDom'
import type { MarkdownPreviewRenderer } from './MarkdownPreviewRenderer'

/** Fold state in source-line terms (shared with the editor's fold manager). */
export function getFoldInfo(r: MarkdownPreviewRenderer): { folds: { from: number; to: number }[]; lines: number } {
  const folds: { from: number; to: number }[] = []
  if (r.frontmatter) {
    for (const s of r.sections) {
      const mc = s.el.querySelector('.metadata-container')
      if (mc) {
        if (mc.classList.contains('is-collapsed')) folds.push({ from: s.start.line, to: s.start.line + s.lines })
        break
      }
    }
  }
  r.sections.forEach((s, n) => {
    forFirstHeading(s.el, () => {
      if (!s.headingCollapsed) return
      let to = s.start.line + s.lines
      if (n < r.sections.length - 1) to = r.sections[n + 1].start.line - 1
      folds.push({ from: s.start.line, to })
    })
  })
  for (const s of r.sections) {
    forFoldableListItems(s.el, (li) => {
      if (!li.classList.contains('is-collapsed')) return
      const line = parseInt(li.getAttribute('data-line') ?? '')
      if (line < 0 || isNaN(line)) return
      const next = li.nextElementSibling
      if (!next) {
        folds.push({ from: s.start.line + line, to: s.start.line + s.lines - 1 })
        return
      }
      const nl = parseInt(next.getAttribute('data-line') ?? '')
      if (nl < line || isNaN(nl)) return
      folds.push({ from: s.start.line + line, to: nl - 1 })
    })
  }
  return { folds, lines: (r.text.match(/^/gm) || []).length }
}

export function applyFoldInfo(r: MarkdownPreviewRenderer, info: { folds: { from: number; to: number }[]; lines: number } | null): void {
  if (info && info.lines !== (r.text.match(/^/gm) || []).length) return
  r.onRendered(() => {
    const starts = new Set<number>()
    if (info) for (const f of info.folds) starts.add(f.from)
    for (const s of r.sections) forFirstHeading(s.el, () => s.setCollapsed(starts.has(s.start.line)))
    for (const s of r.sections) {
      forFoldableListItems(s.el, (li) => {
        const line = parseInt(li.getAttribute('data-line') ?? '')
        if (line < 0 || isNaN(line)) return
        const want = starts.has(s.start.line + line)
        if (li.classList.contains('is-collapsed') !== want) {
          toggleCollapsed(li, want)
          s.resetCompute()
        }
      })
    }
    r.queueRender()
  })
}
