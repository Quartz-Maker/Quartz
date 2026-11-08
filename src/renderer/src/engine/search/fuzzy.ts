// Shared fuzzy matcher (plugin API: prepareQuery, prepareFuzzySearch,
// prepareSimpleSearch, fuzzySearch, sortSearchResults, renderMatches, renderResults).

export type SearchMatchPart = [number, number]
export type SearchMatches = SearchMatchPart[]

export interface SearchResult {
  score: number
  matches: SearchMatches
}

export interface SearchResultContainer {
  match: SearchResult
}

export interface PreparedQuery {
  query: string
  tokens: string[]
  fuzzy: string[]
}

/** General punctuation, supplemental punctuation and ASCII punctuation. */
const PUNCT = /[ -⁯⸀-⹿\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/
const SPACE = /\s/
/** Tibetan, kana, CJK ideographs, compatibility ideographs, half-width katakana. */
const CJK = /[ༀ-࿿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/

const isBoundaryChar = (c: string): boolean => PUNCT.test(c) || CJK.test(c)

/** Sort and merge overlapping ranges (touching ranges are merged too only when overlapping). */
function mergeRanges(ranges: SearchMatches): SearchMatches {
  if (ranges.length === 0) return ranges
  ranges.sort((a, b) => a[0] - b[0])
  const out: SearchMatches = [ranges[0]]
  for (let i = 1; i < ranges.length; i++) {
    const last = out[out.length - 1]
    const cur = ranges[i]
    if (last[1] < cur[0]) out.push(cur)
    else if (last[1] < cur[1]) last[1] = cur[1]
  }
  return out
}

export function prepareQuery(query: string): PreparedQuery {
  const lower = query.toLowerCase()
  const tokens: string[] = []
  let start = 0
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charAt(i)
    if (SPACE.test(c)) {
      if (start !== i) tokens.push(lower.substring(start, i))
      start = i + 1
    } else if (isBoundaryChar(c)) {
      if (start !== i) tokens.push(lower.substring(start, i))
      tokens.push(c)
      start = i + 1
    }
  }
  if (start !== lower.length) tokens.push(lower.substring(start, lower.length))
  return { query, tokens, fuzzy: lower.split('').filter(c => c !== ' ') }
}

function computeScore(matches: SearchMatches, queryLen: number, textLen: number, penalty: number): number {
  if (matches.length === 0) return 0
  const first = matches[0][0]
  const last = matches[matches.length - 1][1]
  let score = 0
  score -= Math.max(0, matches.length - 1)
  score -= penalty / 10
  score -= (last - first + 1 - queryLen) / 100
  score -= first / 1000
  score -= textLen / 10000
  return score
}

/** True when a hit at `pos` starts in the middle of a word (and should be penalised). */
function startsInsideWord(text: string, pos: number): boolean {
  if (pos <= 0) return false
  const c = text.charAt(pos)
  if (isBoundaryChar(c)) return false
  const prev = text.charAt(pos - 1)
  const cIsUpper = c.toLowerCase() !== c
  const cIsLower = c.toUpperCase() !== c
  const prevIsUpper = prev.toLowerCase() !== prev
  // Upper-case after upper-case (inside an acronym/ALLCAPS word).
  if (cIsUpper && prevIsUpper) return true
  // Lower-case letter not preceded by a separator.
  if (cIsLower && !PUNCT.test(prev) && !SPACE.test(prev) && !CJK.test(prev)) return true
  return false
}

function matchParts(parts: string[], query: string, text: string, charMode: boolean): SearchResult | null {
  if (parts.length === 0) return null
  const lower = text.toLowerCase()
  let penalty = 0
  let from = 0
  const matches: SearchMatches = []
  for (const part of parts) {
    const pos = lower.indexOf(part, from)
    if (pos === -1) return null
    if (startsInsideWord(text, pos) && !(charMode && pos === from)) penalty += 1
    if (matches.length === 0) matches.push([pos, pos + part.length])
    else {
      const last = matches[matches.length - 1]
      if (last[1] < pos) matches.push([pos, pos + part.length])
      else last[1] = pos + part.length
    }
    from = pos + part.length
  }
  return { matches, score: computeScore(matches, query.length, lower.length, penalty) }
}

export function fuzzySearch(q: PreparedQuery, text: string): SearchResult | null {
  if (q.query === '') return { score: 0, matches: [] }
  return matchParts(q.tokens, q.query, text, false) || matchParts(q.fuzzy, q.query, text, true)
}

export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
  const q = prepareQuery(query)
  return (text: string) => fuzzySearch(q, text)
}

function simpleMatches(words: string[], text: string): SearchMatches | null {
  const lower = text.toLowerCase()
  const ranges: SearchMatches = []
  for (const word of words) {
    if (!word) continue
    let found = false
    const len = word.length
    let pos = -1
    while ((pos = lower.indexOf(word, pos)) !== -1) {
      found = true
      ranges.push([pos, pos + len])
      pos += len + 1
    }
    if (!found) return null
  }
  return mergeRanges(ranges)
}

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
  const words = query.toLowerCase().split(' ')
  return (text: string) => {
    const matches = simpleMatches(words, text)
    if (!matches) return null
    return { score: computeScore(matches, query.length, text.length, 0), matches }
  }
}

/** Stable sort, best (highest) score first. */
export function sortSearchResults(results: SearchResultContainer[]): void {
  results.sort((a, b) => b.match.score - a.match.score)
}

function buildHighlighted(text: string, matches: SearchMatches | null | undefined, offset = 0): Node {
  if (!matches || matches.length === 0) return document.createTextNode(text)
  const frag = document.createDocumentFragment()
  let pos = 0
  for (let i = 0; pos < text.length && i < matches.length; i++) {
    let start = matches[i][0] + offset
    const end = matches[i][1] + offset
    if (end <= 0) continue
    if (start >= text.length) break
    if (start < 0) start = 0
    if (start !== pos) frag.appendChild(document.createTextNode(text.substring(pos, start)))
    const span = document.createElement('span')
    span.className = 'suggestion-highlight'
    span.textContent = text.substring(start, end)
    frag.appendChild(span)
    pos = end
  }
  if (pos < text.length) frag.appendChild(document.createTextNode(text.substring(pos)))
  return frag
}

export function renderMatches(el: HTMLElement | DocumentFragment, text: string, matches: SearchMatches | null, offset = 0): void {
  el.appendChild(buildHighlighted(text, matches, offset))
}

export function renderResults(el: HTMLElement, text: string, result: SearchResult | null, offset = 0): void {
  renderMatches(el, text, result ? result.matches : null, offset)
}

/** Basename of a vault path (text after the last `/`). */
function basenameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/**
 * File-path variant used by the quick switcher and file suggesters: match the basename first
 * (ranges shifted into the full path); otherwise match the full path with a −1 score penalty.
 */
export function fuzzySearchPath(search: (text: string) => SearchResult | null, path: string): SearchResult | null {
  const base = basenameOf(path)
  let r = search(base)
  if (r) {
    const shift = path.length - base.length
    if (r.matches) for (const m of r.matches) { m[0] += shift; m[1] += shift }
    return r
  }
  r = search(path)
  if (r) r.score -= 1
  return r
}
