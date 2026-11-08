import { createStore as create } from 'zustand/vanilla'
import type { TFile } from 'obsidian'
import { getApp } from '@/engine/App'
import { SearchQuery } from '@/engine/search/query'
import type { SearchResult as EngineResult } from '@/engine/search/query'
import { appSearchEnvironment, runSearch, SearchAppLike, SearchQueue, SearchResultSink } from '@/engine/search/runner'
import { getSortComparator } from '@/engine/search/sort'
import { planSnippets } from '@/engine/search/snippets'
import { installQueryBlockRenderer } from '@/engine/search/queryBlock'
import { resultCountText } from '@/engine/search/explain'
import { useWorkspaceStore } from './workspace'

// The React SearchPanel's view of the global search engine (engine/search): same
// query language, matchers, ordering and live updates; rows are the line-context snippets.

export interface SearchResult {
  filePath: string
  fileName: string
  score: number
  matches: SearchMatch[]
  /** Raw engine result (per-file range map). */
  result?: EngineResult
}

export interface SearchMatch {
  /** 1-based line number (0 for property rows). */
  line: number
  text: string
  highlight: [number, number][] // start/end pairs within `text`
}

interface SearchState {
  query: string
  results: SearchResult[]
  /** The "N results" (total match ranges). */
  count: number
  countText: string
  /** Parse error message (`.search-info`), or null. */
  error: string | null
  isIndexed: boolean
  matchCase: boolean
  setQuery: (query: string) => void
  setMatchCase: (v: boolean) => void
  search: (query: string) => void
  indexVault: (vaultPath: string) => Promise<void>
}

function absPath(app: any, path: string): string {
  const base: string = app.vault.adapter?.getBasePath?.() ?? ''
  return base ? base.replace(/[\\/]+$/, '') + '/' + path : path
}

/** App view for result clicks when the workspace isn't mounted (React shell). */
function withShellWorkspace(app: any): SearchAppLike {
  if (app.workspace && typeof app.workspace.getLeaf === 'function') return app
  const proxy = Object.create(app)
  proxy.workspace = {
    getLeaf: () => ({ openFile: (f: TFile) => useWorkspaceStore.getState().openFile(absPath(app, f.path)) }),
    trigger: () => {}
  }
  return proxy
}

installQueryBlockRenderer(() => {
  const app = getApp()
  return app ? withShellWorkspace(app) : null
})

function toRows(file: TFile, r: EngineResult, content: string, cache: any): SearchMatch[] {
  const rows: SearchMatch[] = []
  if (r.properties) {
    const fm = cache?.frontmatter ?? {}
    const seen = new Set<string>()
    for (const p of r.properties) {
      if (seen.has(p.key)) continue
      seen.add(p.key)
      const v = fm[p.key]
      const value = Array.isArray(v) ? v.filter(Boolean).map(String).join(' ') : String(v)
      const prefix = p.key + ': '
      const hl: [number, number][] = []
      if (!Array.isArray(v)) for (const q of r.properties) if (q.key === p.key && q.pos) hl.push([prefix.length + q.pos[0], prefix.length + q.pos[1]])
      rows.push({ line: 0, text: prefix + value, highlight: hl })
    }
  }
  if (r.content && r.content.length && file.extension !== 'canvas') {
    for (const s of planSnippets(r.content.slice(), content, cache ?? {}, false)) {
      let line = 1
      for (let i = 0; i < s.start; i++) if (content.charCodeAt(i) === 10) line++
      const text = content.substring(s.start, s.end)
      const hl: [number, number][] = []
      for (const m of s.matches) {
        const a = Math.max(m[0], s.start) - s.start
        const b = Math.min(m[1], s.end) - s.start
        if (b > a) hl.push([a, b])
      }
      rows.push({ line, text, highlight: hl })
    }
  }
  return rows
}

class StoreSink implements SearchResultSink {
  sortOrder = 'alphabetical'
  items = new Map<TFile, { result: EngineResult; content: string }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private app: any, private publish: (s: Partial<SearchState>) => void) {}
  startLoader(): void {}
  stopLoader(): void {
    this.flush()
  }
  add(file: TFile, result: EngineResult, content: string): void {
    this.items.set(file, { result, content })
    this.schedule()
  }
  removeResult(file: TFile): void {
    if (this.items.delete(file)) this.schedule()
  }
  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 30)
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const cmp = getSortComparator(this.sortOrder)
    const files = Array.from(this.items.keys()).sort(cmp)
    let count = 0
    const results: SearchResult[] = files.map((f) => {
      const { result, content } = this.items.get(f)!
      const cache = f.extension === 'md' ? this.app.metadataCache.getFileCache(f) : null
      for (const k of ['filename', 'filepath', 'content', 'propertyName', 'tag'] as const) count += result[k]?.length ?? 0
      count += result.properties?.length ?? 0
      return {
        filePath: absPath(this.app, f.path),
        fileName: f.extension === 'md' ? f.basename : f.name,
        score: 1,
        matches: toRows(f, result, content, cache),
        result
      }
    })
    this.publish({ results, count, countText: resultCountText(count) })
  }
}

let liveQueue: SearchQueue | null = null

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  count: 0,
  countText: resultCountText(0),
  error: null,
  isIndexed: false,
  matchCase: false,

  setQuery: (query: string) => {
    set({ query })
    get().search(query)
  },

  setMatchCase: (v: boolean) => {
    set({ matchCase: v })
    get().search(get().query)
  },

  search: (query: string) => {
    if (liveQueue) {
      liveQueue.unload()
      liveQueue = null
    }
    const app = getApp() as any
    if (!app || !query) {
      set({ results: [], count: 0, countText: resultCountText(0), error: null })
      return
    }
    let sq: SearchQuery
    try {
      sq = new SearchQuery(appSearchEnvironment(app), query, get().matchCase)
    } catch (e: any) {
      set({ results: [], count: 0, countText: resultCountText(0), error: e?.message ?? String(e) })
      return
    }
    if (!sq.matcher) {
      set({ results: [], count: 0, countText: resultCountText(0), error: null })
      return
    }
    set({ error: null })
    const sink = new StoreSink(app, (s) => {
      if (liveQueue === queue) set(s)
    })
    const queue = (liveQueue = new SearchQueue(app, sink))
    queue.load()
    const work = queue.start()
    void runSearch(app, sq.requiredInputs, work, (file, content) => {
      const r = sq.match(file, content)
      if (r) sink.add(file, r, content)
      else sink.removeResult(file)
    })
  },

  // The engine reads the vault live (no index); kept for callers that used to build one.
  indexVault: async (_vaultPath: string) => {
    set({ isIndexed: true })
    const q = get().query
    if (q && !liveQueue) get().search(q)
  }
}))
