// Wires the reading renderer to Quartz's current stores.
// Internal link resolution is injected: `(linktext, sourcePath) => path | null`, backed by
// useMetadataStore.resolveLink for notes and a filesystem lookup for attachments.
import { setMarkdownHost } from '@/engine/markdown'
import { useMetadataStore, contentCache } from '@/stores/metadata'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'
import { assetUrl } from '@/core/images'
import { fs } from '@/engine/node'

function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return (abs ? '/' : '') + out.join('/')
}

function exists(p: string): boolean {
  try {
    return fs().statSync(p).isFile()
  } catch {
    return false
  }
}

/** Attachments (non-markdown) aren't in the metadata cache: try note folder, then vault root. */
function resolveAttachment(linkpath: string, sourcePath: string): string | null {
  const vault = (window as any).__quartzVaultPath as string | undefined
  const p = linkpath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (p.startsWith('/')) return exists(p) ? p : null
  const dir = sourcePath ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : vault || ''
  const candidates = [normalize(`${dir}/${p}`)]
  if (vault) candidates.push(normalize(`${vault}/${p}`))
  for (const c of candidates) if (exists(c)) return c
  // Resolve a bare attachment name anywhere in the vault (shortest path wins).
  if (vault && !p.includes('/')) {
    const hits = vaultFilesByName(vault).get(p.toLowerCase())
    if (hits && hits.length) return hits.slice().sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0]
  }
  return null
}

let nameIndex: { vault: string; at: number; map: Map<string, string[]> } | null = null
/** Basename → paths for non-markdown files (re-scanned at most every 5 s). */
function vaultFilesByName(vault: string): Map<string, string[]> {
  if (nameIndex && nameIndex.vault === vault && Date.now() - nameIndex.at < 5000) return nameIndex.map
  const map = new Map<string, string[]>()
  const walk = (dir: string, depth: number): void => {
    if (depth > 20) return
    let entries: import('fs').Dirent[] = []
    try {
      entries = fs().readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = dir + '/' + e.name
      if (e.isDirectory()) walk(full, depth + 1)
      else if (!/\.md$/i.test(e.name)) {
        const k = e.name.toLowerCase()
        const list = map.get(k)
        if (list) list.push(full)
        else map.set(k, [full])
      }
    }
  }
  walk(vault, 0)
  nameIndex = { vault, at: Date.now(), map }
  return map
}

export function resolveReadingLink(linkpath: string, sourcePath: string): string | null {
  // Callers pass either absolute paths (React stores) or vault-relative ones (plugin-API code).
  const vault = (window as any).__quartzVaultPath as string | undefined
  if (sourcePath && vault && !sourcePath.startsWith('/')) sourcePath = `${vault}/${sourcePath}`
  // Prefer the app metadata cache (resolves notes and attachments alike).
  const app = (window as any).app
  if (app && vault && linkpath !== '') {
    const rel = sourcePath.startsWith(vault + '/') ? sourcePath.slice(vault.length + 1) : sourcePath
    const dest = app.metadataCache.getFirstLinkpathDest(linkpath, rel)
    if (dest) return `${vault}/${dest.path}`
  }
  const hasExt = /\.[a-z0-9]+$/i.test(linkpath)
  if (!hasExt || /\.md$/i.test(linkpath)) {
    const r = useMetadataStore.getState().resolveLink(linkpath, sourcePath)
    if (r) return r
  }
  if (linkpath === '') return sourcePath || null
  return hasExt ? resolveAttachment(linkpath, sourcePath) : null
}

let installed = false
export function installReadingHost(): void {
  if (installed) return
  installed = true
  setMarkdownHost({
    resolveLink: resolveReadingLink,
    getResourcePath: (p) => (/^(https?:|data:|quartz-asset:|app:)/i.test(p) ? p : assetUrl(p.replace(/^file:\/\//, ''))),
    readFile: async (p) => {
      const cached = contentCache.get(p)
      if (cached !== undefined) return cached
      try {
        return fs().readFileSync(p, 'utf8')
      } catch {
        return ''
      }
    },
    openLinkText: (linktext, sourcePath, newLeaf) => {
      const path = linktext.split('#')[0]
      const dest = resolveReadingLink(path, sourcePath)
      if (!dest) return
      const ws = useWorkspaceStore.getState()
      if (newLeaf) void ws.openFileInNewTab(dest)
      else void ws.openFile(dest)
    },
    openExternal: (href) => {
      const api = (window as any).quartzAPI
      if (api?.shell?.openExternal) api.shell.openExternal(href)
      else window.open(href, '_blank')
    },
    getConfig: (key) => (useSettingsStore.getState().settings as any)[key]
  })
}
