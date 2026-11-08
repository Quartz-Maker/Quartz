export const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i

export function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p)
}

function normalize(p: string): string {
  const isAbs = p.startsWith('/')
  const stack: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return (isAbs ? '/' : '') + stack.join('/')
}

// Resource URL: `app://<per-run 36-hex host>/<abs path>` served by the
// main process (`file-url` IPC gives the prefix), same shape as
// FileSystemAdapter.getResourcePath minus the `?<mtime>` cache-buster.
let resourcePrefix: string | null = null
function getResourcePrefix(): string {
  if (resourcePrefix === null) {
    try {
      resourcePrefix = (window as any).require('electron').ipcRenderer.sendSync('file-url') as string
    } catch {
      resourcePrefix = ''
    }
  }
  return resourcePrefix
}

export function assetUrl(absPath: string): string {
  const prefix = getResourcePrefix()
  if (!prefix) return 'file://' + encodeURI(absPath)
  let r: string
  try {
    r = (window as any).require('url').pathToFileURL(absPath).href as string
  } catch {
    r = 'file://' + encodeURI(absPath)
  }
  if (r.startsWith('file:///')) r = r.substring(8)
  else if (r.startsWith('file://')) r = '%5C%5C' + r.substring(7)
  return prefix + r
}

// Resolve an image reference (from ![](src) or ![[src]]) to a loadable URL.
// Relative paths resolve against the current note's folder; remote/data URLs
// pass through unchanged.
export function resolveImageSrc(src: string, fromFile: string): string {
  const s = decodeURIComponent(src.trim())
  if (/^(https?:|data:|app:)/i.test(s)) return s
  const p = s.replace(/^\.\//, '').replace(/^file:\/\//, '')
  if (p.startsWith('/')) return assetUrl(normalize(p))
  const vault = (window as any).__quartzVaultPath as string | undefined
  const dir = fromFile ? fromFile.substring(0, fromFile.lastIndexOf('/')) : (vault || '')
  return assetUrl(normalize(`${dir}/${p}`))
}
