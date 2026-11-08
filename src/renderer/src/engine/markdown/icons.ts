// Minimal `setIcon`/`getIcon` for the reading view. Produces an
// `<svg class="svg-icon <id>">` element. Exact markup for the icons the reading
// view uses is in icons-data.ts; any other lucide id is built from the `lucide` package.
import { icons as lucideIcons } from 'lucide'
import { ICON_MARKUP } from './icons-data'

const SVG_NS = 'http://www.w3.org/2000/svg'

function toPascal(id: string): string {
  return id
    .replace(/^lucide-/, '')
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('')
}

function iconDef(id: string): [string, string] | null {
  if (ICON_MARKUP[id] !== undefined) return ICON_MARKUP[id]
  const node = (lucideIcons as Record<string, [string, Record<string, string>][]>)[toPascal(id)]
  if (!node) return null
  const cls = id.startsWith('lucide-') ? id : 'lucide-' + id
  return [cls, node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join('')
      return `<${tag}${a}></${tag}>`
    })
    .join('')]
}

export function getIcon(id: string, doc: Document = document): SVGSVGElement | null {
  const def = iconDef(id)
  if (def === null) return null
  const [cls, inner] = def
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  const attrs: [string, string][] = [
    ['xmlns', SVG_NS],
    ['width', '24'],
    ['height', '24'],
    ['viewBox', '0 0 24 24'],
    ['fill', 'none'],
    ['stroke', 'currentColor'],
    ['stroke-width', '2'],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'],
    ['class', 'svg-icon ' + cls]
  ]
  for (const [k, v] of attrs) svg.setAttribute(k, v)
  svg.innerHTML = inner
  return svg
}

/** Replace `el`'s content with the icon (no-op content if unknown). */
export function setIcon(el: HTMLElement, id: string): void {
  while (el.firstChild) el.removeChild(el.firstChild)
  const svg = getIcon(id, el.ownerDocument)
  if (svg) el.appendChild(svg)
}
