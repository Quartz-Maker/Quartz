// React-facing metadata store. The source of truth is the plugin-API-compatible
// MetadataCache (`app.metadataCache`, src/renderer/src/engine/metadata); this store
// mirrors it into a Map keyed by absolute path in the legacy `FileMetadata` shape so
// existing components keep working, and answers queries through the real cache.
import { createStore as create } from 'zustand/vanilla'
import type { CachedMetadata } from 'obsidian'
import { getApp, type App } from '@/engine/App'
import { computeMetadata } from '@/engine/metadata/parser/computeMetadata'
import { getLinkpath } from '@/engine/metadata/linktext'
import { getAllTags } from '@/engine/metadata/helpers'
import { TFile } from '@/engine/vault/TAbstractFile'

export interface FileMetadata {
  filePath: string
  fileName: string
  links: ParsedLink[]
  embeds: ParsedLink[]
  tags: string[]
  headings: Heading[]
  blocks: Block[]
  frontmatter: Record<string, unknown>
  listItems: ListItem[]
  properties: Record<string, unknown>
  /** The CachedMetadata this entry was derived from. */
  cache?: CachedMetadata
}

export interface ParsedLink {
  raw: string
  target: string
  heading?: string
  blockId?: string
  alias?: string
  position: number
}

export interface Heading {
  level: number
  text: string
  position: number
}

export interface Block {
  id: string
  text: string
  position: number
}

export interface ListItem {
  position: number
  checked: boolean
  text: string
  /** Task character (" " unchecked, "x" done, any other custom status). */
  task?: string
}

export interface BacklinkEntry {
  sourceFile: string
  sourceName: string
  context: string
  position: number
}

interface MetadataState {
  cache: Map<string, FileMetadata>
  isIndexing: boolean
  indexVault: (vaultPath: string) => Promise<void>
  indexFile: (filePath: string, content: string) => void
  removeFile: (filePath: string) => void
  getBacklinks: (filePath: string) => BacklinkEntry[]
  getUnlinkedMentions: (filePath: string) => BacklinkEntry[]
  getOutgoingLinks: (filePath: string) => ParsedLink[]
  resolveLink: (linkText: string, fromFile: string) => string | null
  getAllFiles: () => FileMetadata[]
  getAllTags: () => string[]
  getHeadingsForFile: (filePath: string) => Heading[]
  getEmbeds: (filePath: string) => ParsedLink[]
  getBlocksForFile: (filePath: string) => Block[]
  getFrontmatter: (filePath: string) => Record<string, unknown>
  getListItemIdsForFile: (filePath: string) => string[]
}

// ---- path mapping (store keys are absolute paths; the vault uses vault-relative) ------
function basePath(app: App): string {
  return app.vault.adapter.getBasePath().replace(/\/+$/, '')
}
export function toVaultPath(absPath: string, app: App | null = getApp()): string {
  if (!app) return absPath
  const base = basePath(app)
  if (absPath === base) return '/'
  return absPath.startsWith(base + '/') ? absPath.slice(base.length + 1).normalize('NFC') : absPath
}
export function toAbsPath(vaultPath: string, app: App | null = getApp()): string {
  if (!app) return vaultPath
  return basePath(app) + '/' + vaultPath
}

// ---- CachedMetadata → legacy shape ---------------------------------------------------
function toParsedLink(ref: { link: string; original: string; displayText?: string; position: { start: { offset: number } } }): ParsedLink {
  const link = ref.link
  const target = getLinkpath(link)
  const sub = link.length > target.length ? link.slice(target.length + 1) : ''
  const p: ParsedLink = { raw: ref.original, target, position: ref.position.start.offset }
  if (sub.startsWith('^')) p.blockId = sub.slice(1)
  else if (sub) p.heading = sub
  const isWiki = ref.original.startsWith('[[') || ref.original.startsWith('![[')
  if (isWiki ? ref.original.includes('|') : true) {
    if (ref.displayText) p.alias = ref.displayText
  }
  return p
}

export function toFileMetadata(absPath: string, meta: CachedMetadata | null, text: string): FileMetadata {
  const m: any = meta || {}
  const lines = text.split('\n')
  const blocks: Block[] = []
  for (const b of Object.values<any>(m.blocks || {})) {
    blocks.push({ id: b.id, text: text.slice(b.position.start.offset, b.position.end.offset).replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').trim(), position: b.position.start.offset })
  }
  const fm = (m.frontmatter as Record<string, unknown>) || {}
  return {
    filePath: absPath,
    fileName: absPath.split('/').pop() || absPath,
    links: (m.links || []).map(toParsedLink),
    embeds: (m.embeds || []).map(toParsedLink),
    tags: Array.from(new Set((getAllTags(m) || []).map(t => t.replace(/^#/, '')))),
    headings: (m.headings || []).map((h: any) => ({ level: h.level, text: h.heading, position: h.position.start.offset })),
    blocks,
    frontmatter: fm,
    listItems: (m.listItems || [])
      .filter((li: any) => li.task !== undefined)
      .map((li: any) => ({
        position: li.position.start.offset,
        checked: li.task !== ' ',
        task: li.task,
        text: (lines[li.position.start.line] || '').replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/, '')
      })),
    properties: fm,
    cache: meta || undefined
  }
}

// Text of every indexed note (for backlink context and unlinked mentions).
export const contentCache = new Map<string, string>()
export function updateContentCache(filePath: string, content: string): void {
  contentCache.set(filePath, content)
}

function lineContext(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  let end = text.indexOf('\n', offset)
  if (end === -1) end = text.length
  return text.slice(start, end).trim()
}
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
  cache: new Map(),
  isIndexing: false,

  indexVault: async () => {
    const app = getApp()
    if (!app) return
    set({ isIndexing: true })
    await new Promise<void>(r => app.metadataCache.onCleanCache(r))
    set({ isIndexing: false })
  },

  /** Live (unsaved) content from an editor: parse it now so panels update while typing. */
  indexFile: (filePath: string, content: string) => {
    contentCache.set(filePath, content)
    const meta = filePath.endsWith('.md') ? computeMetadata(content) : null
    set(state => {
      const next = new Map(state.cache)
      next.set(filePath, toFileMetadata(filePath, meta, content))
      return { cache: next }
    })
  },

  removeFile: (filePath: string) => {
    contentCache.delete(filePath)
    set(state => {
      const next = new Map(state.cache)
      next.delete(filePath)
      return { cache: next }
    })
  },

  getBacklinks: (filePath: string): BacklinkEntry[] => {
    const app = getApp()
    if (!app) return []
    const file = app.vault.getFileByPath(toVaultPath(filePath, app))
    if (!file) return []
    const out: BacklinkEntry[] = []
    const dict = app.metadataCache.getBacklinksForFile(file)
    for (const src of dict.keys()) {
      if (src === file.path) continue
      const abs = toAbsPath(src, app)
      const text = contentCache.get(abs) ?? ''
      for (const ref of dict.get(src) || []) {
        const offset = ref.position ? ref.position.start.offset : 0
        out.push({ sourceFile: abs, sourceName: src.split('/').pop() || src, context: ref.position ? lineContext(text, offset) : ref.original, position: offset })
      }
    }
    return out
  },

  getUnlinkedMentions: (filePath: string): BacklinkEntry[] => {
    const targetName = (filePath.split('/').pop() || '').replace(/\.md$/, '')
    if (!targetName) return []
    const linked = new Set(get().getBacklinks(filePath).map(b => b.sourceFile))
    const results: BacklinkEntry[] = []
    for (const [sourcePath, content] of contentCache) {
      if (sourcePath === filePath || linked.has(sourcePath)) continue
      const regex = new RegExp(`(?<!\\[\\[)\\b${escapeRegex(targetName)}\\b(?!\\]\\])`, 'gi')
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        results.push({ sourceFile: sourcePath, sourceName: sourcePath.split('/').pop() || sourcePath, context: lineContext(content, match.index), position: match.index })
      }
    }
    return results
  },

  getOutgoingLinks: (filePath: string): ParsedLink[] => get().cache.get(filePath)?.links || [],
  getEmbeds: (filePath: string): ParsedLink[] => get().cache.get(filePath)?.embeds || [],
  getBlocksForFile: (filePath: string): Block[] => get().cache.get(filePath)?.blocks || [],
  getFrontmatter: (filePath: string): Record<string, unknown> => get().cache.get(filePath)?.frontmatter || {},
  getListItemIdsForFile: (filePath: string): string[] => {
    const meta = get().cache.get(filePath)
    return meta ? meta.listItems.map(li => li.text).filter(Boolean) : []
  },

  /** Resolve link text (may include #subpath / |alias) from a file. */
  resolveLink: (linkText: string, fromFile: string): string | null => {
    const app = getApp()
    if (!app) return null
    const src = toVaultPath(fromFile, app)
    const target = getLinkpath(linkText.split('|')[0]).trim()
    const dest = app.metadataCache.getFirstLinkpathDest(target, src)
    return dest ? toAbsPath(dest.path, app) : null
  },

  getAllFiles: (): FileMetadata[] => Array.from(get().cache.values()),

  getAllTags: (): string[] => {
    const tags = new Set<string>()
    for (const meta of get().cache.values()) for (const t of meta.tags) tags.add(t)
    return Array.from(tags).sort()
  },

  getHeadingsForFile: (filePath: string): Heading[] => get().cache.get(filePath)?.headings || []
}))

// ---- binding to the App's MetadataCache ---------------------------------------------
let unbind: (() => void) | null = null

/** Mirror `app.metadataCache` into the store (call once per App). */
export function bindMetadataStore(app: App): void {
  unbind?.()
  const mc = app.metadataCache
  let pending = new Map<string, FileMetadata | null>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const changes = pending
    pending = new Map()
    useMetadataStore.setState(state => {
      const next = new Map(state.cache)
      for (const [k, v] of changes) v ? next.set(k, v) : next.delete(k)
      return { cache: next }
    })
  }
  const schedule = (): void => {
    if (!timer) timer = setTimeout(flush, 50)
  }
  const refs = [
    mc.on('changed', (file: TFile, data: string, cache: CachedMetadata) => {
      const abs = toAbsPath(file.path, app)
      contentCache.set(abs, data)
      pending.set(abs, toFileMetadata(abs, cache, data))
      schedule()
    }),
    mc.on('deleted', (file: TFile) => {
      const abs = toAbsPath(file.path, app)
      contentCache.delete(abs)
      pending.set(abs, null)
      schedule()
    }),
    app.vault.on('rename', (file, oldPath: string) => {
      if (!(file instanceof TFile)) return
      const oldAbs = toAbsPath(oldPath, app)
      const text = contentCache.get(oldAbs)
      contentCache.delete(oldAbs)
      pending.set(oldAbs, null)
      const meta = mc.getFileCache(file)
      if (file.extension === 'md' && text !== undefined) {
        const abs = toAbsPath(file.path, app)
        contentCache.set(abs, text)
        pending.set(abs, toFileMetadata(abs, meta, text))
      }
      schedule()
    }),
    // resolution changes re-render link panels
    mc.on('resolved', () => {
      useMetadataStore.setState(state => ({ cache: new Map(state.cache) }))
    })
  ]
  useMetadataStore.setState({ cache: new Map(), isIndexing: true })
  contentCache.clear()
  // Files restored from the persistent cache don't emit `changed`: mirror everything
  // once the initial index is clean.
  const populate = async (): Promise<void> => {
    for (const file of app.vault.getMarkdownFiles()) {
      const abs = toAbsPath(file.path, app)
      if (useMetadataStore.getState().cache.has(abs) || pending.has(abs)) continue
      try {
        const text = await app.vault.cachedRead(file)
        contentCache.set(abs, text)
        pending.set(abs, toFileMetadata(abs, mc.getFileCache(file), text))
      } catch {
        /* file vanished */
      }
    }
    flush()
    useMetadataStore.setState({ isIndexing: false })
  }
  const waitInit = (): void => {
    if (mc.initialized) mc.onCleanCache(() => void populate())
    else setTimeout(waitInit, 50)
  }
  waitInit()
  unbind = () => {
    for (const r of refs) r.e.offref(r)
    if (timer) clearTimeout(timer)
  }
}

/** Legacy entry point: indexing is done by the App's MetadataCache now. */
export async function indexVaultWithContent(_vaultPath: string): Promise<void> {
  await useMetadataStore.getState().indexVault(_vaultPath)
}
