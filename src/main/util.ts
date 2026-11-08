// Small pure helpers for the main process.
import { normalize } from 'path'

/** n random lowercase hex digits. Vault ids use 16, resource host 36. */
export function randomHex(n: number, rnd: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ((rnd() * 16) | 0).toString(16)
  return s
}

/**
 * Split `action?query#hash` into `{action, queryData}`.
 * Values are URI-decoded; a key without `=` gets the string "true"; trailing slashes
 * are stripped from the action; `hash` (if any) is put into queryData.hash.
 */
export function parseActionQuery(s: string): { action: string; queryData: Record<string, string> } {
  const data: Record<string, string> = {}
  const q = s.indexOf('?')
  const h = s.indexOf('#', Math.max(0, q))
  if (h >= 0) {
    data.hash = s.substr(h + 1)
    s = s.substr(0, h)
  }
  let query = ''
  if (q >= 0) {
    query = s.substr(q + 1)
    s = s.substr(0, q)
  }
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    const k = eq === -1 ? part : part.substring(0, eq)
    const v = eq === -1 ? null : part.substring(eq + 1)
    if (!k) continue
    data[safeDecode(k)] = v !== null ? safeDecode(v) : 'true'
  }
  return { action: s.replace(/\/+$/g, ''), queryData: data }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * `file:` URL → normalized local path + `#fragment`. The fragment is stripped from the
 * path part so it is not duplicated (`/a.pdf#p=2#p=2`).
 */
export function fileUrlToPath(url: string, isWin = process.platform === 'win32'): string {
  let p = url.replace(/^file:(\/\/)?/, '')
  if (isWin && p.startsWith('/')) p = p.substring(1)
  const hashAt = url.lastIndexOf('#')
  let hash = ''
  if (hashAt !== -1) {
    hash = url.substring(hashAt)
    p = p.substring(0, p.length - (url.length - hashAt))
  }
  p = safeDecode(p)
  return normalize(p) + hash
}

/** UNC / network path (`\\host\share…` or `//host/share…`). */
export function isNetworkPath(p: unknown): boolean {
  return typeof p === 'string' && /^[\\/]{2,}[^\\/]+[\\/]+[^\\/]+/.test(p)
}

/** Lower-cased host of a UNC path, else null. */
export function networkHost(p: unknown): string | null {
  if (typeof p !== 'string') return null
  const m = p.match(/^[\\/]{2,}([^\\/]+)[\\/]+[^\\/]+/)
  return m ? m[1].toLowerCase() : null
}

/** Extensions treated as executable by the link opener. */
export const WIN_EXECUTABLE_EXTS = ['.exe', '.bat', '.cmd', '.ps1', '.com', '.msi', '.vbs', '.js', '.jse', '.wsf', '.wsh', '.py', '.pyw', '.scr']
export const UNIX_EXECUTABLE_EXTS = ['.sh', '.command', '.csh', '.ksh', '.bash', '.zsh', '.fish', '.desktop', '.action', '.workflow']

/** Truncate for dialogs. */
export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trim() + '…'
}
