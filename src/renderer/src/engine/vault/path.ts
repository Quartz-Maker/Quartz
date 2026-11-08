// Vault-relative path helpers.

const NBSP_LIKE = / | /g

/** Collapse slashes, strip leading/trailing slashes; "" → "/". (No NFC.) */
export function normalizeSlashes(p: string): string {
  p = p.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '')
  if (p === '') p = '/'
  return p
}

/** obsidian.d.ts `normalizePath`: NBSP → space, slash cleanup, Unicode NFC. */
export function normalizePath(p: string): string {
  return normalizeSlashes(p).replace(NBSP_LIKE, ' ').normalize('NFC')
}

/** Last path segment. */
export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}
/** Everything before the last "/" ("" for top-level). */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}
/** File name without extension (a leading or trailing dot is not an extension). */
export function stem(p: string): string {
  const name = basename(p)
  const i = name.lastIndexOf('.')
  return i === -1 || i === name.length - 1 || i === 0 ? name : name.substr(0, i)
}
/** Path without its extension. */
export function stripExtension(p: string): string {
  const i = p.lastIndexOf('.')
  return i === -1 || i === p.length - 1 || i === 0 ? p : p.substr(0, i)
}
/** Lower-cased extension without the dot. */
export function extname(p: string): string {
  const i = p.lastIndexOf('.')
  return i === -1 || i === p.length - 1 || i === 0 ? '' : p.substr(i + 1).toLowerCase()
}
export function joinExt(base: string, ext: string): string {
  return ext ? base + '.' + ext : base
}
/** Any segment starting with "." makes a path hidden. */
export function isHiddenPath(p: string): boolean {
  while (p) {
    if (basename(p).startsWith('.')) return true
    p = dirname(p)
  }
  return false
}
/** Strip ".md" from a path (other extensions are kept). */
export function stripMd(p: string): string {
  return extname(basename(p)) === 'md' ? stripExtension(p) : p
}

const platform = typeof process !== 'undefined' ? process.platform : ''
export const isWindows = platform === 'win32'
export const isMac = platform === 'darwin'
const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const ILLEGAL_FILE_CHARS = isWindows ? '*"\\/<>:|?' : '\\/:' + (isAndroid ? '*?<>"' : '')
export const ILLEGAL_FILE_CHARS_DISPLAY = ILLEGAL_FILE_CHARS.split('').join(' ')
export const ILLEGAL_FILE_RE = new RegExp('[' + escapeRe(ILLEGAL_FILE_CHARS) + ']')
export const ILLEGAL_LINK_CHARS = '#^[]|'
const RESERVED_WIN = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** Throws for names the file system / vault refuses. */
export function checkPath(p: string): void {
  if (isWindows) {
    const last = p.charAt(p.length - 1)
    if (last === '.' || last === ' ') throw new Error('File names cannot end with a dot or a space.')
    const name = stem(p)
    if (RESERVED_WIN.test(name)) throw new Error('File name is forbidden: ' + name)
  }
  if (p.split('/').some(seg => ILLEGAL_FILE_RE.test(seg)))
    throw new Error('File name cannot contain any of the following characters: ' + ILLEGAL_FILE_CHARS_DISPLAY)
}
export function isValidPath(p: string): boolean {
  try {
    checkPath(p)
    return true
  } catch {
    return false
  }
}
