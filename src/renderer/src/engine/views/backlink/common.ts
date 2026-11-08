/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared pieces of the backlink / outgoing-link panes (DOM):
//   collapsible section header
//     div.tree-item-self.is-clickable[aria-label="Click to collapse"][data-tooltip-position=left]
//       > span.tree-item-icon.collapse-icon > svg.right-triangle
//       + div.tree-item-inner + div.tree-item-flair-outer > span.tree-item-flair
//   followed by div.search-result-container (hidden while collapsed)
// and the unlinked-mention finder (whole-word, case-insensitive, outside links/embeds/frontmatter).
import { setIcon } from '../../ui/icons'
import { wholeWordRegex } from '../../search/query'
import type { Range } from '../../search/query'

export const STRINGS = {
  linkedMentions: 'Linked mentions',
  unlinkedMentions: 'Unlinked mentions',
  noBacklinks: 'No backlinks found.',
  noUnlinked: 'No unlinked mentions found.',
  linkButton: 'Link',
  links: 'Links',
  noLinks: 'No links found.',
  linkThisFile: 'Link this file',
  notCreated: 'Not created yet',
  collapse: 'Click to collapse',
  expand: 'Click to expand',
  collapseResults: 'Collapse results',
  expandResults: 'Expand results',
  moreContext: 'Show more context',
  lessContext: 'Show less context',
  changeSort: 'Change sort order',
  showSearch: 'Show search filter',
  clearSearch: 'Clear search',
  backlinksTitle: 'Backlinks',
  backlinksFor: (n: string) => `Backlinks for ${n}`,
  outgoingTitle: 'Outgoing links',
  outgoingFrom: (n: string) => `Outgoing links from ${n}`
}

export class CollapsibleSection {
  selfEl: HTMLElement
  iconEl: HTMLElement
  innerEl: HTMLElement
  countEl: HTMLElement
  containerEl: HTMLElement
  collapsed = false

  constructor(parent: HTMLElement, label: string, public onToggle: (collapsed: boolean) => void) {
    const self = (this.selfEl = parent.createDiv('tree-item-self is-clickable'))
    self.setAttribute('data-tooltip-position', 'left')
    this.iconEl = self.createSpan('tree-item-icon collapse-icon')
    setIcon(this.iconEl, 'right-triangle')
    this.innerEl = self.createDiv({ cls: 'tree-item-inner', text: label })
    this.countEl = self.createDiv('tree-item-flair-outer').createSpan('tree-item-flair')
    this.containerEl = parent.createDiv('search-result-container')
    self.addEventListener('click', () => {
      this.setCollapsed(!this.collapsed)
      this.onToggle(this.collapsed)
    })
    this.setCollapsed(false)
  }

  setCollapsed(c: boolean): void {
    this.collapsed = c
    this.selfEl.toggleClass('is-collapsed', c)
    this.iconEl.toggleClass('is-collapsed', c)
    this.selfEl.setAttribute('aria-label', c ? STRINGS.expand : STRINGS.collapse)
    this.containerEl.toggle(!c)
  }

  setCount(n: number | null): void {
    if (n === null) this.countEl.hide()
    else {
      this.countEl.show()
      this.countEl.setText(String(n))
    }
  }
}

/** Ranges of `cache` that must not count as unlinked mentions (links, embeds, frontmatter). */
export function excludedRanges(cache: any): Range[] {
  const out: Range[] = []
  for (const k of ['links', 'embeds']) for (const l of cache?.[k] || []) if (l.position) out.push([l.position.start.offset, l.position.end.offset])
  const fm = cache?.frontmatterPosition ?? cache?.frontmatter?.position
  if (fm) out.push([fm.start.offset, fm.end.offset])
  return out
}

/** Whole-word, case-insensitive occurrences of any of `names` in `text`, outside `exclude`. */
export function findMentions(text: string, names: string[], exclude: Range[]): { range: Range; name: string }[] {
  const out: { range: Range; name: string }[] = []
  const taken = (s: number, e: number) => exclude.some(([a, b]) => s < b && e > a) || out.some(({ range: [a, b] }) => s < b && e > a)
  for (const name of names) {
    if (!name) continue
    const src = wholeWordRegex(name)
    if (!src) continue
    const re = new RegExp(src, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length - m[1].length
      const end = start + m[1].length
      if (!taken(start, end)) out.push({ range: [start, end], name })
      re.lastIndex = end
      if (m[0].length === 0) re.lastIndex++
    }
  }
  out.sort((a, b) => a.range[0] - b.range[0])
  return out
}

/** Frontmatter aliases of a file cache (array or comma string). */
export function aliasesOf(cache: any): string[] {
  const fm = cache?.frontmatter
  const a = fm ? (fm.aliases ?? fm.alias) : null
  if (Array.isArray(a)) return a.filter((x: any) => typeof x === 'string' && x)
  if (typeof a === 'string') return a.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export function debounceFn(fn: () => void, ms: number): (() => void) & { cancel(): void } {
  let t: any = null
  const f = (() => {
    clearTimeout(t)
    t = setTimeout(fn, ms)
  }) as any
  f.cancel = () => clearTimeout(t)
  return f
}
