// `quartz://` URI parsing. The renderer receives the resulting params via `window.OBS_ACT`.
import { resolve, sep as pathSep } from 'path'
import { parseActionQuery } from './util'
import { deepestVaultForPath, vaultIdByNameOrId, type VaultEntry } from './registry'

export const URI_SCHEME = 'quartz'
export const URI_PREFIX = URI_SCHEME + '://'

export type UriParse =
  | { kind: 'starter' } // choose-vault / sync-setup → open the starter window
  | { kind: 'action'; params: Record<string, string> }

/**
 * Forms:
 *   quartz:///abs/path            → {action:"open", path:"/abs/path"}   (decodeURI)
 *   quartz://vault/<name>/<file>  → {action:"open", vault, file}       (segments decodeURIComponent'd)
 *   quartz://choose-vault | sync-setup → starter window
 *   quartz://<action>?k=v&flag    → {action, ...query}
 * Returns null when the URL does not use our scheme.
 */
export function parseUri(url: string, isWin = process.platform === 'win32'): UriParse | null {
  if (!url.startsWith(URI_PREFIX)) return null
  let t = url.substr(URI_PREFIX.length)
  if (t.startsWith('/')) {
    let p = t
    if (isWin) p = t.substr(1)
    let decoded = p
    try {
      decoded = decodeURI(p)
    } catch {
      /* keep raw */
    }
    return { kind: 'action', params: { action: 'open', path: decoded } }
  }
  if (t.startsWith('sync-setup')) return { kind: 'starter' }
  if (t.startsWith('choose-vault')) return { kind: 'starter' }
  if (t.startsWith('vault/')) {
    t = t.substr(6)
    const parts = t.split('/').map(s => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    return { kind: 'action', params: { action: 'open', vault: parts[0], file: parts.slice(1).join('/') } }
  }
  const { action, queryData } = parseActionQuery(t)
  return { kind: 'action', params: { ...queryData, action } }
}

export type UriTarget =
  | { kind: 'vault'; vaultId: string; params: Record<string, string> }
  | { kind: 'focused'; params: Record<string, string> } // no vault given → most recently focused
  | { kind: 'not-found'; params: Record<string, string> }

/**
 * Pick the target vault for parsed params:
 *  - `path`: deepest registered vault containing it; `file` = remainder (starts with sep).
 *  - `vault`: id or case-insensitive folder name; `vault` is removed from params.
 *  - neither: the most recently focused vault window (caller resolves).
 */
export function resolveUriTarget(
  params: Record<string, string>,
  vaults: Record<string, VaultEntry>,
  sep: string = pathSep
): UriTarget {
  const p = { ...params }
  const path = p.path
  const vault = p.vault
  if (path && typeof path === 'string') {
    const abs = resolve(path)
    const hit = deepestVaultForPath(vaults, abs, sep)
    if (!hit) return { kind: 'not-found', params: p }
    p.file = abs.substr(hit.root.length)
    return { kind: 'vault', vaultId: hit.id, params: p }
  }
  if (vault && typeof vault === 'string') {
    const id = vaultIdByNameOrId(vaults, vault)
    delete p.vault
    return id ? { kind: 'vault', vaultId: id, params: p } : { kind: 'not-found', params: p }
  }
  return { kind: 'focused', params: p }
}

/** Last argv entry if it is one of our URIs (only `argv.at(-1)` is inspected). */
export function uriFromArgv(argv: string[]): string | null {
  const last = argv[argv.length - 1]
  return last && last.startsWith(URI_PREFIX) ? last : null
}

/**
 * Drop the executable (and electron's app path when run as
 * `electron <app>`), and all `--switches` except the CLI output flags.
 */
export function cleanArgv(argv: string[], execBasename: (p: string) => string): string[] {
  const rest = argv.slice()
  const exe = rest.shift() ?? ''
  const keep = new Set(['--copy', '--help', '--json', '--md', '--tsv', '--csv'])
  const out = rest.filter(s => !s.startsWith('--') || keep.has(s))
  if (execBasename(exe).toLowerCase().includes('electron')) out.shift()
  return out
}
