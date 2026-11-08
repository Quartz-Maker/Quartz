// `app://` protocol.
//
//  - `app://quartz.md/<file>`  → the bundled renderer (out/renderer), traversal-checked.
//  - `app://<36 hex>/<abs path>` → any local file (vault resources). The random host is
//    created once per run (`file-url` IPC) so web content can't guess it; additionally
//    requests are only allowed from the app's own frames (see `isAllowedAppRequest`).
//  - Range requests → 206 with Content-Range; malformed/out-of-bounds → 416.
//  - Files under the app root and network-share files get `X-Frame-Options: DENY`.
//  - Network-share (UNC) hosts need a one-time user approval per run (caller supplies it).
import { resolve, join, extname } from 'path'
import { promises as fsp, createReadStream } from 'fs'
import { Readable } from 'stream'
import { pathToFileURL } from 'url'
import { isNetworkPath, networkHost } from './util'

export const APP_SCHEME = 'app'
export const APP_HOST = 'quartz.md'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}/`

export interface ResolveOpts {
  appRoot: string
  resourcePrefix: string // e.g. app://0123…(36)/
  isWin?: boolean
}

/** Map an app:// URL to a local path and whether framing is denied. */
export function resolveAppUrl(url: string, opts: ResolveOpts): { path: string; noframe: boolean } {
  const isWin = opts.isWin ?? process.platform === 'win32'
  let o = url
  let noframe = false
  if (o.indexOf('?') > 0) o = o.substring(0, o.indexOf('?'))
  if (o.indexOf('#') > 0) o = o.substring(0, o.indexOf('#'))
  if (o.indexOf(APP_ORIGIN) === 0) {
    o = safeDecode(o.substring(APP_ORIGIN.length))
    o = resolve(join(opts.appRoot, o))
    if (o.indexOf(resolve(opts.appRoot)) !== 0) o = ''
    noframe = true
  } else if (o.indexOf(opts.resourcePrefix) === 0) {
    o = safeDecode(o.substring(opts.resourcePrefix.length))
    if (!isWin) o = '/' + o
    o = resolve(o)
    if (isNetworkPath(o)) noframe = true
  } else {
    o = ''
  }
  return { path: o, noframe }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Range header → byte range. `null` = no/ignored header, `'invalid'` = 416. */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = header.match(/^bytes=(\d*)-(\d*)/)
  if (!m) return 'invalid'
  const start = Number(m[1] || 0)
  const end = Number(m[2] || size - 1)
  if (isNaN(start) || isNaN(end) || start < 0 || end > size - 1 || end < start) return 'invalid'
  return { start, end }
}

/**
 * Absolute path → resource URL, like FileSystemAdapter.getResourcePath minus the
 * `?<mtime>` suffix: `pathToFileURL(p).href` with `file:///`
 * stripped (UNC `file://host/…` becomes `%5C%5Chost/…`), appended to the per-run prefix.
 */
export function pathToResourceUrl(absPath: string, resourcePrefix: string): string {
  let r = pathToFileURL(absPath).href
  if (r.startsWith('file:///')) r = r.substring(8)
  else if (r.startsWith('file://')) r = '%5C%5C' + r.substring(7)
  return resourcePrefix + r
}

// Set Content-Type explicitly: the Vite build uses ES module scripts, which require a JS
// MIME type.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
}
export const mimeFor = (p: string): string | undefined => MIME[extname(p).toLowerCase()]

export interface HandlerOpts extends ResolveOpts {
  /** Ask the user once per host before serving network-share files. */
  approveNetworkHost: (host: string) => Promise<boolean>
}

/** Build the `protocol.handle('app', …)` callback. */
export function createAppProtocolHandler(opts: HandlerOpts): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const { path, noframe } = resolveAppUrl(req.url, opts)
    if (!path) return new Response('Not Found', { status: 400 })
    const host = networkHost(path)
    if (host && !(await opts.approveNetworkHost(host))) return new Response('Forbidden', { status: 403 })
    try {
      const st = await fsp.stat(path)
      let status = 200
      let body: ReturnType<typeof createReadStream>
      const headers = new Headers()
      const range = parseRange(req.headers.get('Range'), st.size)
      if (range === 'invalid') return new Response('Range Not Satisfiable', { status: 416 })
      if (range) {
        headers.set('Accept-Ranges', 'bytes')
        headers.set('Content-Length', `${range.end - range.start + 1}`)
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`)
        status = 206
        body = createReadStream(path, { start: range.start, end: range.end })
      } else {
        headers.set('Content-Length', `${st.size}`)
        body = createReadStream(path)
      }
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Last-Modified', st.mtime.toUTCString())
      const mime = mimeFor(path)
      if (mime) headers.set('Content-Type', mime)
      if (noframe) headers.set('X-Frame-Options', 'DENY')
      return new Response(Readable.toWeb(body) as unknown as ReadableStream, { status, headers })
    } catch (e) {
      console.error(e)
      return new Response('Not Found', { status: 400 })
    }
  }
}

/**
 * `session.webRequest.onBeforeRequest({urls:["app://*\/*"]})` policy: only
 * the app page itself (origin app://quartz.md, or a top-level about:blank/null-origin frame
 * loading app-root files) may load app:// URLs. `extraOrigins` covers the Vite dev server.
 */
export function isAllowedAppRequest(
  frameOrigin: string | undefined,
  isTopFrame: boolean,
  url: string,
  extraOrigins: string[] = []
): boolean {
  if (frameOrigin === undefined) return true // no frame (e.g. service/worker or main-initiated)
  if (frameOrigin + '/' === APP_ORIGIN) return true
  if (frameOrigin === 'null' && isTopFrame && url.startsWith(APP_ORIGIN)) return true
  return extraOrigins.includes(frameOrigin)
}
