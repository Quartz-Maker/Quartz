// How match ranges become result rows: snippet boundaries (line context or
// "show more context"), grouping of nearby matches, highlighting, file titles and property rows.
import type { CachedMetadata, TFile } from 'obsidian'
import { countMatches, mergeRanges, PropertyMatch, Range, SearchResult } from './query'

interface Positioned {
  position: { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } }
}

/** Index of the item containing `offset` (binary search over positions). */
export function findPositionIndex<T extends Positioned>(items: T[], offset: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = ((lo + hi) / 2) | 0
    const p = items[mid].position
    const c = offset < p.start.offset ? 1 : offset > p.end.offset ? -1 : 0
    if (c === 0) return mid
    if (c < 0) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The match's line, clipped to `max` chars either side → [start, end, clippedBefore, clippedAfter]. */
export function lineContext(content: string, range: Range, max = 100): [number, number, boolean, boolean] {
  let s = range[0] - 1
  let n = 0
  while (n < max && s >= 0) {
    if (content.charAt(s) === '\n') break
    s--
    n++
  }
  s++
  const before = n === max
  let e = range[1]
  let m = 0
  while (m < max && e < content.length) {
    if (content.charAt(e) === '\n') break
    e++
    m++
  }
  return [s, e, before, m === max]
}

const LIST_LINE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/
const BLANK_LINE = /\r?\n\r?\n/y

/** "Show more context": containing list item (+ children), else section, else list subtree / paragraph (±1000 chars). */
export function extraContextRange(content: string, range: Range, cache: CachedMetadata): [number, number] {
  const { listItems, sections } = cache
  if (listItems) {
    const i = findPositionIndex(listItems, range[0])
    const li = listItems[i]
    if (li && range[0] >= li.position.start.offset && range[1] <= li.position.end.offset) {
      let last = li
      let j = i + 1
      const lines = new Set<number>([last.position.start.line])
      while (j < listItems.length) {
        const c = listItems[j]
        if (!lines.has(c.parent)) break
        lines.add(c.position.start.line)
        j++
        last = c
      }
      return [li.position.start.offset - li.position.start.col, last.position.end.offset]
    }
  }
  if (sections) {
    const s = sections[findPositionIndex(sections, range[0])]
    if (s && range[0] >= s.position.start.offset && range[1] <= s.position.end.offset) return [s.position.start.offset, s.position.end.offset]
  }
  let p = range[0]
  const lo = p - 1000
  while (p > 0 && p > lo && content.charCodeAt(p - 1) !== 10) p--
  let f = range[0]
  const hi = f + 1000
  while (f < content.length && f < hi && content.charCodeAt(f) !== 10) f++
  const g = content.substring(p, f).match(LIST_LINE)
  if (g && g[2]) {
    let m = f
    while (m < content.length) {
      let nl = content.indexOf('\n', m + 1)
      if (nl === -1) nl = content.length
      const b = content.substring(m + 1, nl).match(LIST_LINE)
      if (b && b[1].length <= g[1].length) break
      m = nl
    }
    return [p, m]
  }
  let w = p
  while (w > 0 && w > lo) {
    BLANK_LINE.lastIndex = w
    if (BLANK_LINE.test(content)) break
    w--
  }
  while (content.charCodeAt(w) === 10 && w < p) w++
  let k = f
  while (k < content.length && k < hi) {
    BLANK_LINE.lastIndex = k
    if (BLANK_LINE.test(content)) break
    k++
  }
  return [w, k]
}

/** One step of the hover "show more context" chevrons. */
export function prevContextPos(content: string, cache: CachedMetadata, pos: number): number {
  const { listItems, sections } = cache
  if (listItems) {
    const li = listItems[findPositionIndex(listItems, pos)]
    if (li) {
      const { start, end } = li.position
      if (start.offset - start.col <= pos && end.offset >= pos) return start.offset - start.col
    }
  }
  if (sections) {
    const s = sections[findPositionIndex(sections, pos)]
    if (s && s.type !== 'list') {
      const { start, end } = s.position
      if (start.offset - start.col <= pos && end.offset >= pos) return start.offset - start.col
    }
  }
  let h = pos
  while (h > 0 && content.charCodeAt(h - 1) !== 10) h--
  return h
}

export function nextContextPos(content: string, cache: CachedMetadata, pos: number): number {
  const { listItems, sections } = cache
  if (listItems) {
    const i = findPositionIndex(listItems, pos)
    const li = listItems[i]
    if (li) {
      const { start, end } = li.position
      if (start.offset - start.col <= pos && end.offset >= pos) {
        let last = li
        let j = i + 1
        const lines = new Set<number>([last.position.start.line])
        while (j < listItems.length) {
          const c = listItems[j]
          if (!lines.has(c.parent)) break
          lines.add(c.position.start.line)
          j++
          last = c
        }
        return last.position.end.offset
      }
    }
  }
  if (sections) {
    const s = sections[findPositionIndex(sections, pos)]
    if (s && s.type !== 'list') {
      const { start, end } = s.position
      if (start.offset - start.col <= pos && end.offset >= pos) return end.offset
    }
  }
  let g = pos
  while (g < content.length && content.charCodeAt(g) !== 10) g++
  return g
}

export interface SnippetPlan {
  start: number
  end: number
  /** Leading/trailing "..." (line context clipped). */
  before: boolean
  after: boolean
  matches: Range[]
}

/** Group sorted match ranges into snippets the way the result list does. */
export function planSnippets(ranges: Range[], content: string, cache: CachedMetadata, extraContext: boolean, separateMatches = false): SnippetPlan[] {
  ranges.sort((a, b) => a[0] - b[0])
  const out: SnippetPlan[] = []
  let i = 0
  const take = (start: number, end: number, before = false, after = false): void => {
    let j = i + 1
    if (!separateMatches) {
      while (j < ranges.length) {
        const r = ranges[j]
        if (r[0] >= end) break
        if (r[1] > end) {
          end = r[1]
          j++
          break
        }
        j++
      }
    }
    out.push({ start, end, before, after, matches: ranges.slice(i, j) })
    i = j
  }
  while (i < ranges.length) {
    if (extraContext) {
      const [s, e] = extraContextRange(content, ranges[i], cache)
      take(s, e)
    } else {
      const [s, e, b, a] = lineContext(content, ranges[i])
      take(s, e, b, a)
    }
  }
  return out
}

/** Split `text[start,end)` into plain / matched pieces. */
export function highlightPieces(text: string, start: number, end: number, ranges: Range[]): Array<[boolean, string]> {
  const out: Array<[boolean, string]> = []
  let cur = start
  for (const r of ranges) {
    let s = r[0]
    if (s >= end) break
    let e = r[1]
    if (e < start) continue
    if (s < start) s = start
    if (e > end) e = end
    if (s > cur) out.push([false, text.substring(cur, s)])
    out.push([true, text.substring(s, e)])
    cur = e
  }
  if (cur < end) out.push([false, text.substring(cur, end)])
  return out
}

/** Append highlight spans (`span.search-result-file-matched-text`) for `text[start,end)`. */
export function renderHighlighted(el: HTMLElement, text: string, start: number, end: number, ranges: Range[]): void {
  const doc = el.ownerDocument
  for (const [hit, s] of highlightPieces(text, start, end, ranges)) {
    const span = doc.createElement('span')
    if (hit) span.className = 'search-result-file-matched-text'
    span.textContent = s
    el.appendChild(span)
  }
}

/** Title text + ranges for a file result (path when `path:` matched, else name/basename). */
export function resultTitle(file: Pick<TFile, 'path' | 'name' | 'basename' | 'extension'>, result: SearchResult): { text: string; ranges: Range[] | null } {
  if (result.filename || result.filepath) {
    if (result.filepath) {
      let ranges = result.filepath
      if (result.filename) {
        const d = file.path.length - file.name.length
        for (const m of result.filename) ranges.push([m[0] + d, m[1] + d])
        ranges = mergeRanges(ranges)
      }
      return { text: file.path, ranges }
    }
    const ranges = result.filename!
    let text = file.name
    if (file.extension === 'md' && (ranges.length === 0 || ranges[ranges.length - 1][1] <= file.basename.length)) text = file.basename
    return { text, ranges }
  }
  return { text: file.extension === 'md' ? file.basename : file.name, ranges: null }
}

/** Flair number: matches excluding filename ranges. */
export function resultFlair(result: SearchResult): number {
  return countMatches({ ...result, filename: undefined })
}

/** Property matches grouped by key, in first-seen order. */
export function groupPropertyMatches(props: PropertyMatch[]): PropertyMatch[][] {
  const by: Record<string, PropertyMatch[]> = {}
  for (const p of props) {
    if (!Object.prototype.hasOwnProperty.call(by, p.key)) by[p.key] = []
    by[p.key].push(p)
  }
  return Object.keys(by).map((k) => by[k])
}

/** Render a `key: value` property row with highlighted value parts. */
export function renderPropertyRow(el: HTMLElement, matches: PropertyMatch[], frontmatter: Record<string, any> | undefined): void {
  const doc = el.ownerDocument
  const key = matches[0].key
  const span = (t: string): void => {
    const s = doc.createElement('span')
    s.textContent = t
    el.appendChild(s)
  }
  span(key + ': ')
  const v = (frontmatter ?? {})[key]
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const item = v[i]
      if (!item) continue
      const text = String(item)
      const ranges = mergeRanges(matches.filter((m) => m.pos && m.subkey?.[0] === i).map((m) => m.pos!))
      renderHighlighted(el, text, 0, text.length, ranges)
      span(' ')
    }
  } else {
    const text = String(v)
    const ranges = mergeRanges(matches.map((m) => m.pos).filter(Boolean) as Range[])
    renderHighlighted(el, text, 0, text.length, ranges)
  }
}
