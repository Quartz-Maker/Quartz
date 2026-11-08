// Search-query seam for the graph filter and colour groups. They are compiled with the global search
// engine (`match(file, inputs)`, `matchTag`, `matchFilename`, `requiredInputs`). The real engine lives in
// `engine/search` (built separately): it plugs in through `setGraphSearchEngine`. Until then a small
// fallback understands plain terms, "phrases", -negation, path:, file:, tag:, content: (AND-ed).

export interface GraphSearchQuery {
  /** Falsy when the query is empty (such queries are dropped). */
  matcher: unknown
  /** Inputs `match` needs besides the file, e.g. { content: true }. */
  requiredInputs?: Record<string, boolean>
  match(file: { path: string; name: string; basename: string; extension: string }, inputs: { content?: string; tags?: string[] }): unknown
  matchTag(tag: string): unknown
  matchFilename(path: string): unknown
}

export type GraphSearchEngine = (app: any, query: string) => GraphSearchQuery

let engine: GraphSearchEngine | null = null

/** Plug the global search engine in (called by the search area). */
export function setGraphSearchEngine(e: GraphSearchEngine | null): void {
  engine = e
}

export function compileGraphQuery(app: any, query: string): GraphSearchQuery {
  return (engine || fallbackEngine)(app, query)
}

type Term = { neg: boolean; op: '' | 'path' | 'file' | 'tag' | 'content'; text: string }

function tokenize(q: string): Term[] {
  const out: Term[] = []
  const re = /(-?)(?:(path|file|tag|content):)?(?:"([^"]*)"|(\S+))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(q))) {
    const text = (m[3] ?? m[4] ?? '').toLowerCase()
    if (!text) continue
    out.push({ neg: m[1] === '-', op: ((m[2] || '') as string).toLowerCase() as Term['op'], text })
  }
  return out
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

function tagMatches(tag: string, want: string): boolean {
  const t = tag.toLowerCase().replace(/^#/, ''), w = want.replace(/^#/, '')
  return t === w || t.startsWith(w + '/')
}

export const fallbackEngine: GraphSearchEngine = (_app, query) => {
  const terms = tokenize(query)
  const needsContent = terms.some(t => t.op === '' || t.op === 'content')
  const needsTags = terms.some(t => t.op === 'tag')
  const each = (fn: (t: Term) => boolean) => terms.every(t => (t.neg ? !fn(t) : fn(t)))
  return {
    matcher: terms.length ? terms : null,
    requiredInputs: { ...(needsContent ? { content: true } : {}), ...(needsTags ? { tags: true } : {}) },
    match(file, inputs) {
      const name = file.name.toLowerCase(), path = file.path.toLowerCase()
      const content = (inputs.content || '').toLowerCase()
      return each(t => {
        switch (t.op) {
          case 'path':
            return path.includes(t.text)
          case 'file':
            return name.includes(t.text)
          case 'tag':
            return (inputs.tags || []).some(tag => tagMatches(tag, t.text))
          case 'content':
            return content.includes(t.text)
          default:
            return name.includes(t.text) || content.includes(t.text)
        }
      })
    },
    matchTag(tag) {
      const lt = tag.toLowerCase()
      return each(t => (t.op === 'tag' ? tagMatches(tag, t.text) : t.op === '' ? lt.includes(t.text) : !t.neg))
    },
    matchFilename(path) {
      const name = basename(path).toLowerCase()
      return each(t => (t.op === '' || t.op === 'file' ? name.includes(t.text) : t.op === 'path' ? path.toLowerCase().includes(t.text) : !t.neg))
    }
  }
}
