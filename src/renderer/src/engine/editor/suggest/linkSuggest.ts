/* eslint-disable @typescript-eslint/no-explicit-any */
// The `[[` link suggester (an EditorSuggest registered on `app.workspace.editorSuggest`).
// Supports file / heading / block / display modes,
// `##` and `^^` vault-wide modes, alias + unresolved rows, Enter/Tab/Shift+Enter/#/^ semantics,
// `![[` embeds, and the markdown-link variant when `useMarkdownLinks` is on.
import { EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo } from '../../plugins/extras'
import { TFile } from '../../vault/TAbstractFile'
import { parseLinktext, encodeLinkDestination, stripHeadingForLink } from '../../metadata/linktext'
import { parseFrontMatterAliases } from '../../metadata/helpers'
import { parseMarkdown } from '../../metadata/parser/quartzParser'
import { visit } from '../../metadata/parser/visit'
import { fuzzySearchPath, prepareFuzzySearch, prepareQuery, fuzzySearch, renderMatches, type SearchMatches, type SearchResult } from '../../search/fuzzy'
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'

const IMAGE_EXTS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
const PDF_EXTS = ['pdf']
const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const extOf = (p: string): string => {
  const i = p.lastIndexOf('.')
  return i === -1 || i === p.length - 1 || i === 0 ? '' : p.slice(i + 1).toLowerCase()
}
const stripExt = (p: string): string => {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i === -1 || i === b.length - 1 || i === 0 ? p : p.slice(0, p.length - (b.length - i))
}
const imageSize = (s: string): boolean => /^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/.test(s)
const T = {
  typeHash: 'Type #',
  linkHeading: 'to link heading',
  typeBlock: 'Type ^',
  linkBlock: 'to link blocks',
  typePipe: 'Type |',
  changeDisplay: 'to change display text',
  accept: 'to accept',
  noAlias: 'Display text',
  noHeading: 'Heading',
  noMatch: 'No match found',
  imageSize: (n: string) => `Image size: ${n}px wide`,
  alias: 'Alias'
}

export interface LinkSuggestion {
  type: 'file' | 'alias' | 'linktext' | 'heading' | 'block' | 'none'
  file?: TFile | null
  path?: string | null
  alias?: string
  subpath?: string
  heading?: string
  level?: number
  content?: string
  display?: string
  node?: any
  idMatch?: SearchMatches | null
  score: number
  matches: SearchMatches | null
  downranked?: boolean
}

// ---------------------------------------------------------------------------- block cache
interface BlockEntry {
  display: string
  node: any
}
interface BlockFile {
  file: TFile
  content: string
  mtime: number
  blocks: BlockEntry[]
}

/** Plain text of an mdast node (as shown in block rows). */
function nodeText(n: any): string {
  if (!n) return ''
  const t = n.type
  if (t === 'html') return ''
  if (t === 'iembed') return n.href
  const kids = (): string[] => (n.children || []).map(nodeText)
  if (t === 'listItem') {
    const k = kids()
    return k.length === 1 ? k[0] + '\n' : k.join('\n')
  }
  if (t === 'tag') return n.tag
  if (t === 'comment') return ''
  let s = n.value || n.alt || n.title || (n.children && kids().join('')) || ''
  if (t === 'list' && n.start !== undefined && n.start !== null) s = n.start + '. ' + s
  if (t === 'paragraph' || t === 'break' || t === 'heading' || t === 'code') s += '\n'
  else if (s.endsWith('\n')) s = s.substring(0, s.length - 1)
  if (t === 'tableCell') s += ' '
  else if (t === 'tableRow') s += '\n'
  return s
}

export class BlockCache {
  cache: Record<string, BlockFile> = {}
  constructor(public app: any) {}
  clear(): void {
    this.cache = {}
  }
  async getForFile(file: TFile): Promise<BlockFile | null> {
    if (file.extension !== 'md') return null
    const mtime = file.stat.mtime
    const hit = this.cache[file.path]
    if (hit && hit.file === file && hit.mtime === mtime) return hit
    const content: string = await this.app.vault.cachedRead(file)
    const root: any = parseMarkdown(content)
    const blocks: BlockEntry[] = []
    for (const child of root.children || []) {
      if (child.type === 'yaml') continue
      if (child.type === 'list') {
        visit(child, 'listItem', (node: any) => {
          const t = nodeText(node).trim()
          if (t) blocks.push({ display: t, node })
        })
        continue
      }
      let t = nodeText(child).trim()
      if (t === '') continue
      if (child.type === 'heading') t = '#'.repeat(child.depth || 1) + ' ' + t
      blocks.push({ display: t, node: child })
    }
    return (this.cache[file.path] = { file, content, mtime, blocks })
  }
  async *getAll(): AsyncGenerator<BlockFile> {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const r = await this.getForFile(f)
      if (r) yield r
    }
  }
}
export function getBlockCache(app: any): BlockCache {
  const mc = app.metadataCache
  return (mc.blockCache ||= new BlockCache(app))
}

/** Where/how to write a `^id` for `block` (an existing paragraph/list item gets ` ^id`, other blocks a `\n\n^id` line). */
export function blockIdPlacement(block: { content: string; node: any }, id: string): { blockStart: number; blockEnd: number; addition: string; newlines: number } {
  const content = block.content
  const node = block.node
  const blockStart = node.position.start.offset
  let blockEnd = node.position.end.offset
  let newlines = 0
  const inline = node.type === 'paragraph' || node.type === 'listItem'
  let addition = '^' + id
  if (inline) {
    addition = ' ' + addition
    if (node.type === 'listItem') {
      const c = node.children
      if (c && c.length > 1) {
        const last = c[c.length - 1]
        const prev = c[c.length - 2]
        if (last.type === 'list') blockEnd = prev.position.end.offset
      }
    }
  } else {
    addition = '\n\n' + addition
    newlines = 2
  }
  if (!(inline || (content.charAt(blockEnd) === '\n' && content.charAt(blockEnd + 1) === '\n'))) {
    addition += '\n'
    newlines++
  }
  return { blockStart, blockEnd, addition, newlines }
}

const randomHex = (n: number): string => Array.from({ length: n }, () => ((16 * Math.random()) | 0).toString(16)).join('')

// ---------------------------------------------------------------------------- matching helpers
const blockWords = (q: string): string[] => q.toLowerCase().split(' ')
function blockMatches(words: string[], textLower: string): SearchMatches | null {
  const out: SearchMatches = []
  for (const w of words) {
    if (!w) continue
    let found = false
    let pos = -1
    while ((pos = textLower.indexOf(w, pos)) !== -1) {
      found = true
      out.push([pos, pos + w.length])
      pos += w.length + 1
    }
    if (!found) return null
  }
  if (out.length === 0) return out
  out.sort((a, b) => a[0] - b[0])
  const merged: SearchMatches = [out[0]]
  for (let i = 1; i < out.length; i++) {
    const last = merged[merged.length - 1]
    if (last[1] < out[i][0]) merged.push(out[i])
    else if (last[1] < out[i][1]) last[1] = out[i][1]
  }
  return merged
}
const blockScore = (m: SearchMatches | null): number => (m ? -(m.length + (m.length > 0 ? m[0][0] / 10 : 0)) : 0)
const byScore = (a: { score: number }, b: { score: number }): number => b.score - a.score

class Runnable {
  cancelled = false
  cancel(): void {
    this.cancelled = true
  }
  isCancelled(): boolean {
    return this.cancelled
  }
}

// ---------------------------------------------------------------------------- suggestion source
export class LinkSuggestManager {
  mode: 'file' | 'heading' | 'block' | 'display' = 'file'
  global = false
  fileSuggestions: any[] | null = null
  runnable: Runnable | null = null
  sourcePosition: { line: number; ch: number } | null = null
  constructor(public app: any, public getSourcePath: () => string) {}

  getInstructions(): { command: string; purpose: string }[] {
    return this.mode === 'file'
      ? [
          { command: T.typeHash, purpose: T.linkHeading },
          { command: T.typeBlock, purpose: T.linkBlock },
          { command: T.typePipe, purpose: T.changeDisplay }
        ]
      : [{ command: '↵', purpose: T.accept }]
  }

  async getSuggestionsAsync(run: Runnable, query: string): Promise<LinkSuggestion[]> {
    const bar = query.indexOf('|')
    let display: string | null = null
    if (bar !== -1) {
      display = query.substr(bar + 1)
      query = query.substr(0, bar)
    }
    if (display === null) {
      if (query.startsWith('##')) {
        this.mode = 'heading'
        this.global = true
        return this.getGlobalHeadingSuggestions(run, query.substr(2))
      }
      if (query.startsWith('^^')) {
        this.mode = 'block'
        this.global = true
        return this.getGlobalBlockSuggestions(run, query.substr(2))
      }
    }
    this.global = false
    const parsed = parseLinktext(query)
    let path = parsed.path
    const subpath = parsed.subpath
    if (display !== null) {
      this.mode = 'display'
      return this.getDisplaySuggestions(path, subpath, display)
    }
    if (subpath) {
      if (subpath.startsWith('#^')) {
        this.mode = 'block'
        return this.getBlockSuggestions(run, path, subpath.substr(2))
      }
      this.mode = 'heading'
      return this.getHeadingSuggestions(run, path, subpath)
    }
    const caret = path.lastIndexOf('^')
    if (caret !== -1) {
      const q = path.substr(caret + 1)
      path = path.substr(0, caret)
      this.mode = 'block'
      return this.getBlockSuggestions(run, path, q)
    }
    this.mode = 'file'
    return this.getFileSuggestions(run, path)
  }

  getDisplaySuggestions(path: string, subpath: string, display: string): LinkSuggestion[] {
    const mc = this.app.metadataCache
    const dest: TFile | null = mc.getFirstLinkpathDest(path, this.getSourcePath())
    const out: LinkSuggestion[] = []
    if (dest) {
      const aliases = parseFrontMatterAliases(mc.getFileCache(dest)?.frontmatter)
      if (aliases && aliases.length > 0) {
        const q = prepareQuery(display)
        for (const alias of aliases) {
          const m = fuzzySearch(q, alias)
          if (m) out.push({ type: 'alias', alias, file: dest, path: path + subpath, score: m.score, matches: m.matches })
        }
      }
    }
    return out.length > 0 ? out : [{ type: 'alias', file: null, path: path + subpath, alias: display, score: 0, matches: [[0, display.length]] }]
  }

  async getHeadingSuggestions(run: Runnable, path: string, subpath: string): Promise<LinkSuggestion[]> {
    const mc = this.app.metadataCache
    const dest: TFile | null = mc.getFirstLinkpathDest(path, this.getSourcePath())
    if (!dest || dest.extension !== 'md') return []
    const cache = mc.getFileCache(dest)
    const list = this.matchHeadings(run, dest, cache?.headings, path, subpath)
    if (list.length > 0) return list
    return [{ type: 'heading', file: null, path, subpath, score: 0, heading: subpath.slice(1), level: 0, matches: [[0, subpath.length]] }]
  }

  private matchHeadings(run: Runnable, file: TFile, headings: any[] | undefined, path: string, sub: string): LinkSuggestion[] {
    if (!headings || headings.length === 0) return []
    const parts = sub.split('#').filter(e => !!e)
    if (sub.endsWith('#')) parts.push('')
    let prefix = '#' + parts.slice(0, parts.length - 1).join('#')
    if (!prefix.endsWith('#')) prefix += '#'
    let idx = 0
    let level = 0
    const out: LinkSuggestion[] = []
    for (const h of headings) {
      if (run.isCancelled()) break
      if (h.level <= level || idx >= parts.length) break
      const lower = h.heading.toLowerCase()
      if (idx === parts.length - 1) {
        const part = parts[idx]
        if (part === '') out.push({ type: 'heading', file, path, subpath: prefix + stripHeadingForLink(h.heading), level: h.level, heading: h.heading, score: 0, matches: null })
        else {
          const m = fuzzySearch(prepareQuery(part), h.heading)
          if (m) out.push({ type: 'heading', file, path, subpath: prefix + stripHeadingForLink(h.heading), level: h.level, heading: h.heading, score: m.score, matches: m.matches })
        }
      } else if (lower === parts[idx].toLowerCase()) {
        idx++
        level = h.level
      }
    }
    return out
  }

  getGlobalHeadingSuggestions(run: Runnable, query: string): LinkSuggestion[] {
    const mc = this.app.metadataCache
    const out: LinkSuggestion[] = []
    const q = prepareQuery(query)
    for (const p of mc.getCachedFiles()) {
      if (run.isCancelled()) break
      if (mc.isUserIgnored(p)) continue
      const f = this.app.vault.getAbstractFileByPath(p)
      if (!(f instanceof TFile) || f.extension !== 'md') continue
      const c = mc.getCache(p)
      if (!c || !c.headings || c.headings.length === 0) continue
      for (const h of c.headings) {
        const m = fuzzySearch(q, h.heading)
        if (m) out.push({ type: 'heading', file: f, path: null, subpath: '#' + stripHeadingForLink(h.heading), level: h.level, heading: h.heading, score: m.score, matches: m.matches })
      }
    }
    return out
  }

  async getBlockSuggestions(run: Runnable, path: string, query: string): Promise<LinkSuggestion[]> {
    const mc = this.app.metadataCache
    const dest: TFile | null = mc.getFirstLinkpathDest(path, this.getSourcePath())
    if (!dest || dest.extension !== 'md') return []
    const data = await getBlockCache(this.app).getForFile(dest)
    if (!data) return []
    const words = blockWords(query)
    const out: LinkSuggestion[] = []
    for (const b of data.blocks) {
      if (run.isCancelled()) break
      const m = blockMatches(words, b.display.toLowerCase())
      let score = blockScore(m)
      let idMatch: SearchMatches | null = null
      const id = b.node.id
      if (id && typeof id === 'string' && (idMatch = blockMatches(words, id.toLowerCase()))) score = 0
      if (m || idMatch) out.push({ type: 'block', file: dest, path, content: data.content, display: b.display, node: b.node, score, matches: m, idMatch })
    }
    return out
  }

  async getGlobalBlockSuggestions(run: Runnable, query: string): Promise<LinkSuggestion[]> {
    const src = this.getSourcePath()
    const cur = this.app.vault.getAbstractFileByPath(src)
    const words = blockWords(query)
    const out: LinkSuggestion[] = []
    for await (const data of getBlockCache(this.app).getAll()) {
      if (run.isCancelled()) break
      for (const b of data.blocks) {
        if (this.sourcePosition && data.file === cur && b.node.position.start.line - 1 <= this.sourcePosition.line && b.node.position.end.line - 1 >= this.sourcePosition.line) continue
        const m = blockMatches(words, b.display.toLowerCase())
        let score = blockScore(m)
        let idMatch: SearchMatches | null = null
        const id = b.node.id
        if (id && typeof id === 'string' && (idMatch = blockMatches(words, id.toLowerCase()))) score = 0
        if (m || idMatch) out.push({ type: 'block', file: data.file, path: null, content: data.content, display: b.display, node: b.node, score, matches: m, idMatch })
      }
    }
    return out
  }

  getFileSuggestions(run: Runnable, query: string): LinkSuggestion[] {
    const mc = this.app.metadataCache
    const all = (this.fileSuggestions ||= mc.getLinkSuggestions())
    const out: LinkSuggestion[] = []
    if (query === '') {
      for (const s of all) {
        const f: TFile | null = s.file
        if (f) {
          if (mc.isUserIgnored(f.path)) continue
          if (s.alias) out.push({ type: 'alias', alias: s.alias, file: f, path: s.path, score: f.stat.mtime, matches: null })
          else out.push({ type: 'file', file: f, path: s.path, score: f.stat.mtime, matches: null })
        } else out.push({ type: 'linktext', path: s.path, score: 0, matches: null })
      }
      return out.sort(byScore)
    }
    const search = prepareFuzzySearch(query)
    for (const s of all) {
      const f: TFile | null = s.file
      if (f) {
        const ign = mc.isUserIgnored(f.path)
        if (s.alias) {
          const m = search(s.alias)
          if (m) out.push({ type: 'alias', alias: s.alias, file: f, path: s.path, score: m.score + (ign ? -10 : 0), matches: m.matches, downranked: ign })
        } else {
          const m = fuzzySearchPath(search, s.path)
          if (m) out.push({ type: 'file', file: f, path: s.path, score: m.score + (ign ? -10 : 0), matches: m.matches, downranked: ign })
        }
      } else {
        const m = search(s.path)
        if (m) out.push({ type: 'linktext', path: s.path, score: m.score, matches: m.matches })
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------- insertion
export interface LinkInsertion {
  replacement: string
  start: number
  end: number
  selectionStart: number
  selectionEnd: number
  blockId: string | null
}

/** Compute the text a selection writes (`start`..`end` are columns on the line holding `[[`). */
export function buildLinkInsertion(app: any, sug: LinkSuggestion, query: string, restOfLine: string, startCh: number, endCh: number, sourcePath: string, key: string, format: 'markdown' | 'other' = 'markdown'): LinkInsertion {
  let blockId: string | null = null
  let title = ''
  let alias = ''
  let selStart = endCh
  let selEnd = endCh
  const useMd = format === 'markdown' && !!app.vault.getConfig('useMarkdownLinks')
  const wiki = !useMd
  let link = ''
  let replacement = ''
  const mc = app.metadataCache
  const pathFor = (file: TFile, p: string | null | undefined): string =>
    p !== null && p !== undefined ? (wiki || !p || file.extension !== 'md' || p.endsWith('.md') ? p : p + '.md') : file.path === sourcePath ? '' : mc.fileToLinktext(file, sourcePath, wiki)
  if (sug.type === 'none') {
    if (key === 'Enter' || key === 'Tab' || key === '#' || key === '^') link = query
  } else if (sug.type === 'file') {
    title = sug.file!.basename
    link = mc.fileToLinktext(sug.file, sourcePath, wiki)
  } else if (sug.type === 'alias') {
    alias = title = sug.alias!
    const p = parseLinktext(sug.path!)
    let path = p.path
    if (sug.file) path = mc.fileToLinktext(sug.file, sourcePath, wiki)
    link = path + p.subpath
  } else if (sug.type === 'linktext') {
    title = sug.path!
    link = sug.path!
  } else if (sug.type === 'heading') {
    link = pathFor(sug.file!, sug.path) + sug.subpath
    title = sug.heading!
  } else if (sug.type === 'block') {
    title = ''
    const path = pathFor(sug.file!, sug.path)
    const id = sug.node.id
    link = id ? path + '#^' + id : path + '#^' + (blockId = randomHex(6))
  }
  const m = restOfLine.match(/^(\s*)(\|)?(.*?)(]])/)
  let end = endCh
  if (m && !m[0].includes('[[')) {
    if (m[2] && !alias) {
      alias = m[3]
      if (!title) title = alias
    }
    end += m[0].length
  }
  if (!alias && sug.type === 'file') {
    if (!IMAGE_EXTS.includes(sug.file!.extension) && link.includes('/')) alias = title
  }
  if (useMd && key !== '#' && key !== '^') {
    replacement = `[${title}](${encodeLinkDestination(link)})`
    selStart = selEnd = title ? startCh + replacement.length : startCh + 1
  } else {
    if (key === '#') {
      link += '#'
      if (sug.type === 'file' && PDF_EXTS.includes(sug.file!.extension)) link += 'page='
    } else if (key === '^') link += '^'
    if (alias) link += '|' + alias
    const close = link.endsWith(']]') ? '' : ']]'
    replacement = '[[' + link + close
    const x = startCh + replacement.length - 2
    if (key === 'Tab') {
      if (alias) {
        selStart = x - alias.length
        selEnd = x
      } else selStart = selEnd = x
    } else selStart = selEnd = key === '#' || key === '^' || key === '|' ? (alias ? x - alias.length - 1 : x) : startCh + replacement.length
  }
  return { replacement, start: startCh, end, selectionStart: selStart, selectionEnd: selEnd, blockId }
}

// ---------------------------------------------------------------------------- the suggester
const NONE: LinkSuggestion = { type: 'none', matches: null, score: 0 }

export class LinkSuggest extends EditorSuggest<LinkSuggestion> {
  suggestManager: LinkSuggestManager
  constructor(app: any) {
    super(app)
    this.suggestManager = new LinkSuggestManager(app, () => (this.context as any)?.file?.path ?? '')
    this.setInstructions(this.suggestManager.getInstructions())
    this.scope.register(['Shift'], 'Enter', (e: KeyboardEvent) => {
      if (e.isComposing) return
      this.selectSuggestion({ type: 'none', matches: [], score: 0 }, e)
      return false
    })
    this.scope.register([], 'Tab', (e: KeyboardEvent) => {
      if (!e.isComposing && this.suggestions.useSelectedItem(e)) return false
    })
    this.scope.register(null as any, '#', (e: KeyboardEvent) => {
      if ((this.suggestManager.mode === 'file' || this.suggestManager.mode === 'heading') && this.suggestions.useSelectedItem(e)) return false
    })
    this.scope.register(null as any, '^', (e: KeyboardEvent) => {
      if (this.suggestManager.mode === 'file' && this.suggestions.useSelectedItem(e)) return false
    })
  }

  onTrigger(cursor: { line: number; ch: number }, editor: any, _file: any): EditorSuggestTriggerInfo | null {
    const line = cursor.line
    const before: string = editor.getLine(line).substr(0, cursor.ch)
    const open = before.lastIndexOf('[[')
    const close = before.lastIndexOf(']')
    if (open !== -1 && close < open) {
      const query = before.substr(open + 2)
      const bar = query.indexOf('|')
      if (bar !== -1) {
        const p = parseLinktext(query.substr(0, bar)).path
        if (IMAGE_EXTS.includes(extOf(p))) return null
      }
      return { start: { line, ch: open + 2 }, end: { line, ch: cursor.ch }, query }
    }
    return null
  }

  async getSuggestions(ctx: EditorSuggestContext): Promise<LinkSuggestion[]> {
    const mgr = this.suggestManager
    mgr.runnable?.cancel()
    const run = (mgr.runnable = new Runnable())
    const q = ctx.query.trim()
    let list: LinkSuggestion[] | null = await mgr.getSuggestionsAsync(run, q)
    if (!list || run.isCancelled()) return null as any
    if (list.length === 0) list = [NONE]
    list.sort(byScore)
    this.setInstructions(mgr.getInstructions())
    return list
  }

  showSuggestions(list: LinkSuggestion[]): void {
    super.showSuggestions(list)
    if (this.context) {
      const q = this.context.query
      if (!q || q === '^' || q === '#') this.suggestions.forceSetSelectedItem(-1, null)
    }
  }

  renderSuggestion(s: LinkSuggestion, el: HTMLElement): void {
    renderLinkSuggestion(s, el, this.suggestManager.global)
  }

  selectSuggestion(sug: LinkSuggestion, evt: MouseEvent | KeyboardEvent): void {
    const ctx: any = this.context
    this.close()
    if (!ctx) return
    const ed = ctx.editor
    let { start, end } = ctx
    const file = ctx.file as TFile | null
    start = { line: start.line, ch: start.ch - 2 }
    const ins = buildLinkInsertion(this.app, sug, ctx.query, ed.getLine(end.line).substr(end.ch), start.ch, end.ch, file?.path || '', evt instanceof KeyboardEvent ? evt.key : '', 'markdown')
    const lineStart = { line: start.line, ch: 0 }
    const at = (ch: number): { line: number; ch: number } => ({ line: lineStart.line, ch: lineStart.ch + ch })
    const changes: any[] = [{ from: at(ins.start), to: at(ins.end), text: ins.replacement }]
    const selection = { from: at(ins.selectionStart), to: at(ins.selectionEnd) }
    if (sug.type === 'block' && ins.blockId) {
      const { blockStart, blockEnd, addition, newlines } = blockIdPlacement({ content: sug.content!, node: sug.node }, ins.blockId)
      let content = sug.content!
      const target = sug.file!
      if (file !== target) {
        content = content.slice(0, blockEnd) + addition + content.slice(blockEnd)
        void this.app.vault.modify(target, content)
      } else {
        const block = content.substring(blockStart, blockEnd)
        if (block === '') return this.close()
        const doc: string = ed.getValue()
        let from = 0
        let best = -99999
        for (;;) {
          const i = doc.indexOf(block, from)
          if (i === -1) break
          if (Math.abs(blockStart - i) < Math.abs(blockStart - best)) best = i
          from = i + block.length
        }
        if (best >= 0) {
          changes.push({ from: ed.offsetToPos(best + block.length), text: addition })
          selection.from.line += newlines
          selection.to.line += newlines
        }
      }
    }
    ed.transaction({ changes, selection }, 'input.autocomplete')
    setTimeout(() => ed.focus())
  }

  close(): void {
    super.close()
    this.suggestManager.fileSuggestions = null
    if (this.suggestManager.runnable) {
      this.suggestManager.runnable.cancel()
      this.suggestManager.runnable = null
    }
  }
}

export function renderLinkSuggestion(e: LinkSuggestion, el: HTMLElement, global = false): void {
  el.addClass('mod-complex')
  const content = el.createDiv('suggestion-content')
  const aux = el.createDiv('suggestion-aux')
  const title = content.createDiv('suggestion-title')
  const note = content.createDiv('suggestion-note')
  const matches = e.matches
  if (global && (e.type === 'heading' || e.type === 'block')) note.setText(stripMdExt(e.file!.path))
  if (e.downranked) el.addClass('mod-downranked')
  if (e.type === 'none') title.setText(T.noMatch)
  else if (e.type === 'file') {
    const p = e.path!
    const b = baseName(p)
    const folder = p.substr(0, p.length - b.length)
    renderMatches(note, folder, matches)
    renderMatches(title, b, matches, -folder.length)
  } else if (e.type === 'alias') {
    let icon = 'lucide-forward'
    note.setText(e.path!)
    if (IMAGE_EXTS.includes(extOf(e.path!)) && e.alias && imageSize(e.alias)) {
      icon = 'lucide-scaling'
      title.setText(T.imageSize(e.alias))
    } else if (e.alias) renderMatches(title, e.alias, matches)
    else title.createSpan({ cls: 'suggestion-empty-suggestion', text: T.noAlias })
    aux.createSpan({ cls: 'suggestion-flair' }, flair => {
      setIcon(flair, icon)
      setTooltip(flair, T.alias)
    })
  } else if (e.type === 'linktext') renderMatches(title, e.path!, matches)
  else if (e.type === 'heading') {
    if (e.heading) renderMatches(title, e.heading, matches)
    else title.createSpan({ cls: 'suggestion-empty-suggestion', text: T.noHeading })
    if (e.level! > 0) aux.createSpan({ cls: 'suggestion-flair', text: 'H' + e.level })
  } else if (e.type === 'block') {
    renderMatches(title, e.display!, matches)
    const id = e.node.id
    if (id && typeof id === 'string') {
      if (note.getText().trim()) note.appendText(' > ')
      renderMatches(note, id, e.idMatch ?? null)
    }
  }
}
const stripMdExt = (p: string): string => (extOf(p) === 'md' ? stripExt(p) : p)

export type { SearchResult }
