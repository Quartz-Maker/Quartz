// Graph data model + builder. Pure functions over a metadata-cache-like source.
//   buildGraphData: resolved/unresolved links, tags (case-merged via getTags), attachments, user-ignored files,
//                   timelapse progression (files ordered by min(ctime, mtime), each file/link = one event).
//   localGraphData: BFS over the filtered data with depth weights; tag nodes are never expanded.
//   removeOrphans:  drops nodes without in/out links (self-links ignored).
import type { GraphDataOptions } from './options'

export type GraphNodeType = '' | 'attachment' | 'unresolved' | 'tag' | 'focused'
export interface GraphColor {
  a: number
  rgb: number
}
export interface GraphNodeData {
  type: GraphNodeType | string
  color?: GraphColor
  links: Record<string, true>
}
export interface GraphData {
  nodes: Record<string, GraphNodeData>
  weights?: Record<string, number>
  numLinks?: number
}

/** The slice of MetadataCache the builder reads. */
export interface GraphSource {
  resolvedLinks: Record<string, Record<string, number>>
  unresolvedLinks: Record<string, Record<string, number>>
  getTags(): Record<string, number>
  getCachedFiles(): string[]
  isUserIgnored(path: string): boolean
  /** Tags of a file (frontmatter first, then inline), a `getAllTags`-like list or null. */
  getFileTags(path: string): string[] | null
  /** [ctime, mtime] of a file, or null when it isn't a file. Only needed for progression. */
  getFileTimes?(path: string): [number, number] | null
}

/**
 * Filter callback: (id, type) → false (hide), true (show) or a colour (show, coloured).
 * type is '' for notes, 'attachment', 'unresolved' or 'tag'.
 */
export type GraphFilter = (id: string, type: string) => boolean | GraphColor

const NON_ATTACHMENT_EXTENSIONS = ['md', 'canvas', 'base']

/** Extension helper: text after the last "." of the whole path (none if first/last char). */
export function extname(path: string): string {
  const i = path.lastIndexOf('.')
  return i === -1 || i === path.length - 1 || i === 0 ? '' : path.substr(i + 1).toLowerCase()
}

/** Node label: basename, without ".md". */
export function displayText(id: string): string {
  const slash = id.lastIndexOf('/')
  const base = slash === -1 ? id : id.slice(slash + 1)
  if (extname(base) !== 'md') return base
  const i = base.lastIndexOf('.')
  return i === -1 || i === base.length - 1 || i === 0 ? base : base.substr(0, i)
}

/** Attachment test: any file whose extension isn't md/canvas/base. */
export function isAttachmentPath(path: string): boolean {
  return !NON_ATTACHMENT_EXTENSIONS.includes(extname(path))
}

export function newNode(type: string = ''): GraphNodeData {
  return { type, links: {} }
}

function copyNode(n: GraphNodeData | undefined): GraphNodeData {
  if (!n) return newNode()
  const c = newNode(n.type)
  if (n.color) c.color = n.color
  return c
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export function buildGraphData(source: GraphSource, options: GraphDataOptions, filter: GraphFilter, progression = 0): GraphData {
  const { resolvedLinks, unresolvedLinks } = source
  const showAttachments = options.showAttachments
  const hideUnresolved = options.hideUnresolved
  const showTags = options.showTags
  const tagCase: Record<string, string> = {}
  if (options.showTags) {
    const tags = source.getTags()
    for (const t in tags) if (hasOwn(tags, t)) tagCase[t.toLowerCase()] = t
  }
  const nodes: Record<string, GraphNodeData> = {}
  let events = 0
  const files = source.getCachedFiles().slice()
  if (progression) {
    const order: Record<string, number> = {}
    for (const p of files) {
      const t = source.getFileTimes ? source.getFileTimes(p) : null
      order[p] = t ? Math.min(t[0], t[1]) : Infinity
    }
    files.sort((a, b) => order[a] - order[b])
  }
  let cutoff = ''
  for (const path of files) {
    const attachment = isAttachmentPath(path)
    if (!showAttachments && attachment) continue
    const type = attachment ? 'attachment' : ''
    const verdict = filter(path, type)
    if (!verdict || source.isUserIgnored(path)) continue
    const node = (nodes[path] = newNode(type))
    const links = node.links
    if (options.showOrphans) {
      if (events === progression) cutoff = path
      events++
    }
    if (typeof verdict !== 'boolean') node.color = verdict
    if (hasOwn(resolvedLinks, path)) {
      const targets = resolvedLinks[path]
      for (const target in targets) {
        if (!hasOwn(targets, target)) continue
        const targetIsAttachment = isAttachmentPath(target)
        if (!showAttachments && targetIsAttachment) continue
        if (filter(target, targetIsAttachment ? 'attachment' : '')) {
          if (!progression || events < progression) links[target] = true
          else if (events === progression) cutoff = path
          events++
        }
      }
    }
    if (!hideUnresolved && hasOwn(unresolvedLinks, path)) {
      const targets = unresolvedLinks[path]
      for (const target in targets) {
        if (!hasOwn(targets, target) || !filter(target, 'unresolved')) continue
        if (!progression || events < progression) {
          links[target] = true
          if (!hasOwn(nodes, target)) nodes[target] = newNode('unresolved')
        } else if (events === progression) cutoff = path
        events++
      }
    }
    if (showTags) {
      const tags = source.getFileTags(path)
      if (tags && tags.length > 0) {
        for (const tag of tags) {
          if (!filter(tag, 'tag')) continue
          const key = tagCase[tag.toLowerCase()] || tag
          if (!progression || events < progression) links[key] = true
          else if (events === progression) cutoff = path
          events++
          if (!hasOwn(nodes, key)) nodes[key] = newNode('tag')
        }
      }
    }
  }
  if (progression && cutoff) {
    const i = files.indexOf(cutoff)
    if (i !== -1) for (let k = i + 1; k < files.length; k++) delete nodes[files[k]]
  }
  return { nodes, numLinks: events }
}

const NOT_EXPANDED: Record<string, true> = { tag: true }

/** Local-graph neighbourhood (BFS, depth weights centre=30, depth p → 30 − 30/jumps·(p+1)). */
export function localGraphData(data: GraphData, options: GraphDataOptions): GraphData {
  const all = data.nodes
  const nodes: Record<string, GraphNodeData> = {}
  const weights: Record<string, number> = {}
  const center = options.localFile as string
  const jumps = options.localJumps
  const forelinks = options.localForelinks
  const backlinks = options.localBacklinks
  weights[center] = 30
  if (!hasOwn(all, center)) {
    nodes[center] = newNode()
    return { nodes, weights }
  }
  nodes[center] = newNode(all[center].type)
  const step = (weight: number) => {
    const added: Record<string, GraphNodeData> = {}
    for (const id in all) {
      if (!hasOwn(all, id)) continue
      const n = all[id]
      if (n.type === 'tag') continue
      const links = n.links
      for (const target in links) {
        if (!hasOwn(links, target)) continue
        const included = nodes[id]
        if (forelinks && hasOwn(nodes, id) && !hasOwn(nodes, target) && !hasOwn(NOT_EXPANDED, included.type)) {
          added[target] = added[target] || copyNode(all[target])
          included.links[target] = true
        } else if (backlinks && hasOwn(nodes, target) && !hasOwn(nodes, id) && !hasOwn(NOT_EXPANDED, nodes[target].type)) {
          added[id] = added[id] || copyNode(all[id])
          added[id].links[target] = true
        }
      }
    }
    for (const id in added) {
      if (!hasOwn(added, id)) continue
      nodes[id] = added[id]
      weights[id] = weight
    }
  }
  const delta = 30 / jumps
  for (let p = 0; p < jumps; p++) step(30 - delta * (p + 1))
  if (options.localInterlinks) for (const id in nodes) if (hasOwn(nodes, id) && hasOwn(all, id)) nodes[id] = all[id]
  return { nodes, weights }
}

/** Remove nodes with neither incoming nor outgoing links (self-links don't count). Mutates `data`. */
export function removeOrphans(data: GraphData): void {
  const nodes = data.nodes
  const linked: Record<string, true> = {}
  for (const id in nodes) {
    if (!hasOwn(nodes, id)) continue
    const links = nodes[id].links
    for (const t in links) if (hasOwn(links, t) && id !== t) linked[t] = true
  }
  for (const id in nodes) {
    if (!hasOwn(nodes, id)) continue
    const links = nodes[id].links
    let out = false
    for (const t in links) {
      if (hasOwn(links, t) && hasOwn(nodes, t) && id !== t) {
        out = true
        break
      }
    }
    if (!out && !linked[id]) delete nodes[id]
  }
}

/** Query compiled by the search engine (search query object, `match`/`matchTag`/`matchFilename`). */
export interface GraphQueryLike {
  matchTag(tag: string): unknown
  matchFilename(path: string): unknown
}
export interface CompiledQuery {
  query: GraphQueryLike
  color: GraphColor | null
}

/**
 * The engine's filter (B2.render): with no queries everything passes. Notes use the async file filter
 * results (the local centre always passes); tags must pass `matchTag` and attachments `matchFilename`
 * for every uncoloured query.
 */
export function makeGraphFilter(
  queries: CompiledQuery[] | null,
  fileFilter: Record<string, boolean | GraphColor>,
  hasFilter: boolean,
  localFile: string | null
): GraphFilter {
  return (id, type) => {
    if (!queries) return true
    if (type === '') return id === localFile || (hasOwn(fileFilter, id) ? fileFilter[id] : !hasFilter)
    if (type === 'tag') return queries.every(q => !!q.color || !!q.query.matchTag(id))
    if (type === 'attachment') return queries.every(q => !!q.color || !!q.query.matchFilename(id))
    return true
  }
}

/** Per-file verdict of the search queries: false (hidden), true, or the first matching group colour. */
export function fileVerdict(queries: CompiledQuery[], matches: (q: CompiledQuery) => boolean): boolean | GraphColor {
  let visible = true
  let color: GraphColor | null = null
  for (const q of queries) {
    const m = matches(q)
    if (!m && !q.color) {
      visible = false
      break
    }
    if (m && q.color) {
      color = q.color
      break
    }
  }
  return visible && (color || true)
}

/** Full render pipeline of the data engine: build → local → orphans → focus. Returns {data, numLinks}. */
export function computeGraph(
  source: GraphSource,
  options: GraphDataOptions,
  filter: GraphFilter,
  progression: number,
  focusFile: string
): { data: GraphData; numLinks: number } {
  let data = buildGraphData(source, options, filter, progression)
  const numLinks = data.numLinks as number
  if (options.localFile) data = localGraphData(data, options)
  if (!options.showOrphans) removeOrphans(data)
  if (focusFile) {
    const n = data.nodes[focusFile]
    if (n) n.type = 'focused'
  }
  return { data, numLinks }
}
