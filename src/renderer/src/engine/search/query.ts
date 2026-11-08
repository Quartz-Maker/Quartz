// Global search query language: tokenizer, recursive-descent parser and the
// matcher tree evaluated per file against raw text + CachedMetadata.
import type { CachedMetadata, Pos, TFile } from 'obsidian'
import { MatchInput, RESULT_KEYS, mergeRanges, touchRegexCache, type InputKey, type MatchStrings, type SearchResult } from './queryCore'
import { tokenize } from './queryTokens'
import { Matcher, type RequiredInputs } from './queryMatchers'
import { SEARCH_OPERATORS, parseQuery, type SearchOperator } from './queryParser'

export * from './queryCore'
export * from './queryTokens'
export * from './queryMatchers'
export * from './queryParser'

// ---------------------------------------------------------------------------------------------
// SearchQuery
// ---------------------------------------------------------------------------------------------

/** What the matcher needs from the app: the merged metadata cache and (optionally) canvas node caches. */
export interface SearchEnvironment {
  getFileCache(file: TFile): CachedMetadata | null
  /** Per-text-node metadata of a canvas file, or null when canvas search is unavailable. */
  getCanvasCaches?(file: TFile, content: string): Record<string, CachedMetadata> | null
}

const SEARCHABLE_NAME_EXT = ['md', 'canvas', 'base']

export class SearchQuery {
  query: string
  caseSensitive: boolean
  matcher: Matcher | null
  requiredInputs: RequiredInputs | null
  env: SearchEnvironment

  /** Throws `Error` with a descriptive message on parse errors. */
  constructor(env: SearchEnvironment, query: string, caseSensitive: boolean, operators: Record<string, SearchOperator> = SEARCH_OPERATORS) {
    this.env = env
    this.query = query
    this.caseSensitive = caseSensitive
    const m = (this.matcher = parseQuery(tokenize(query), operators))
    this.requiredInputs = m && m.requiredInputs()
  }

  match(file: TFile, content: string): SearchResult | null {
    if (file.extension === 'canvas' && this.env.getCanvasCaches) {
      const r = this.matchCanvas(file, content)
      if (r) return r
    }
    const strings: MatchStrings = { filename: file.name, filepath: file.path, content }
    const keys: InputKey[] = []
    if (SEARCHABLE_NAME_EXT.includes(file.extension)) keys.push('filename')
    if (file.extension === 'md') keys.push('content')
    const input = new MatchInput(strings, content, keys, this.caseSensitive)
    if (file.extension === 'md') input.cache = this.env.getFileCache(file)
    return this._match(input)
  }

  private matchCanvas(file: TFile, content: string): SearchResult | null {
    const caches = this.env.getCanvasCaches!(file, content)
    if (caches === null) return null
    let data: any
    try {
      data = JSON.parse(content)
    } catch {
      /* not JSON */
    }
    if (!data || !Array.isArray(data.nodes)) return null
    let any = false
    const out: SearchResult = {}
    for (const node of data.nodes.filter((n: any) => n.type === 'text')) {
      const input = new MatchInput({ filename: file.name, filepath: file.path, content: node.text }, node.text, ['content'], this.caseSensitive)
      input.cache = caches?.[node.id] as CachedMetadata
      const r = this._match(input)
      if (r !== null) {
        any = true
        if (r) out[`canvas-${node.id}`] = r.content
      }
    }
    const name = this._match(new MatchInput({ content: '', filename: file.name, filepath: file.path }, '', ['content', 'filename'], this.caseSensitive))
    if (name !== null) {
      any = true
      if (name) out.filename = name.filename
    }
    return any ? out : null
  }

  matchContent(text: string): SearchResult | null {
    return this._match(new MatchInput({ content: text }, text, ['content'], this.caseSensitive))
  }
  matchTag(tag: string): SearchResult | null {
    return this._match(new MatchInput({ tag }, tag, ['tag'], this.caseSensitive))
  }
  matchFilename(path: string): SearchResult | null {
    return this._match(new MatchInput({ filename: basenameOf(path), filepath: path }, path, ['filename'], this.caseSensitive))
  }
  matchFilepath(path: string): SearchResult | null {
    return this._match(new MatchInput({ filename: basenameOf(path), filepath: path }, path, ['filepath'], this.caseSensitive))
  }

  _match(input: MatchInput): SearchResult | null {
    touchRegexCache()
    let r = this.matcher!.match(input)
    if (r) for (const k of RESULT_KEYS) if (Object.prototype.hasOwnProperty.call(r, k)) r[k] = mergeRanges(r[k]!)
    if (r === undefined) r = {}
    return r
  }
}

function basenameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export type { Pos }
