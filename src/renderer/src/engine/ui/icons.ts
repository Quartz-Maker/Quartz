// Icon API (plugin API, obsidian.d.ts): getIcon / setIcon / addIcon / removeIcon / getIconIds.
//
// Behaviour:
// - `lucide-<name>` ids: the Lucide set (lucide 1.14.0 geometry) plus the (since removed) `github`
//   brand icon; ids are derived from Lucide's PascalCase export names
//   (canonical names *and* aliases). The SVG wrapper is
//   `<svg xmlns width=24 height=24 viewBox="0 0 24 24" fill=none stroke=currentColor
//   stroke-width=2 stroke-linecap=round stroke-linejoin=round class="svg-icon lucide-x">` and child
//   attributes are emitted in a fixed order with numbers normalised (".5" → "0.5").
// - ids added with addIcon(): `<svg viewBox="0 0 100 100" class="svg-icon <id>">` + raw content.
// - a few custom ids (CUSTOM_ICONS): 24px wrapper with the id as class, drawn with an equivalent
//   Lucide glyph.
// - legacy names (LEGACY_ICON_ALIASES, e.g. `trash`) and bare Lucide names resolve to `lucide-*`.
// Lookup order: `lucide-*` → added icons → custom icons → legacy alias / bare Lucide name.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as lucide from 'lucide'
import { LEGACY_ICON_ALIASES } from './iconAliases'

type IconNode = [string, Record<string, string | number>][]

const SVG_NS = 'http://www.w3.org/2000/svg'
const LUCIDE_ATTRS: Record<string, string | number> = {
  xmlns: SVG_NS,
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
}
const ADDED_ATTRS: Record<string, string> = { viewBox: '0 0 100 100' }
/** Attribute order emitted for icon children. */
const ATTR_ORDER = ['d', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx', 'ry', 'points', 'fill']

/** `github` was dropped from Lucide 1.x but is still provided (lucide 0.577.0, ISC). */
const GITHUB: IconNode = [
  ['path', { d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4' }],
  ['path', { d: 'M9 18c-4.51 2-5-2-7-2' }]
]

/**
 * Custom icon ids (in getIconIds() order) → the Lucide glyph Quartz draws for them.
 */
export const CUSTOM_ICONS: Record<string, string> = {
  'refresh-cw-off': 'RefreshCwOff',
  'bracket-glyph': 'Brackets',
  'box-glyph': 'Box',
  'check-small': 'Check',
  'dice-glyph': 'Dice5',
  dice: 'Dice5',
  discord: 'MessageCircle',
  'right-triangle': 'ChevronDown',
  'heading-glyph': 'Heading',
  help: 'CircleHelp',
  'keyboard-toggle': 'Keyboard',
  'broken-link': 'Unlink',
  experiment: 'FlaskConical',
  'left-arrow': 'ChevronLeft',
  link: 'Link',
  'link-glyph': 'Link',
  'links-coming-in': 'LogIn',
  'links-going-out': 'LogOut',
  'open-vault': 'Vault',
  paused: 'Pause',
  'question-mark-glyph': 'CircleHelp',
  'right-arrow': 'ChevronRight',
  'sidebar-left': 'PanelLeft',
  'sidebar-right': 'PanelRight',
  'sheets-in-box': 'Archive',
  'star-list': 'ListStart',
  'sync-small': 'RefreshCw',
  tabs: 'AppWindow',
  'uppercase-lowercase-a': 'CaseSensitive',
  vault: 'Vault',
  'stack-horizontal': 'Columns2',
  'stack-vertical': 'Rows2',
  'stretch-horizontal': 'StretchHorizontal',
  'stretch-vertical': 'StretchVertical',
  'distribute-space-horizontal': 'AlignHorizontalSpaceAround',
  'distribute-space-vertical': 'AlignVerticalSpaceAround',
  'zoom-to-selection': 'Scan',
  'create-group': 'Group',
  'snap-to-object': 'Magnet',
  'line-horizontal': 'Minus',
  'aspect-ratio': 'Ratio',
  'rectangle-vertical-double': 'GalleryVertical',
  'tab-frame': 'AppWindow',
  'sidebar-toggle-button-icon': 'PanelLeft'
}

/** Icon id for a Lucide export name: `AArrowDown` → `a-arrow-down`, `CalendarX2` → `calendar-x2`. */
export function lucideExportToId(name: string): string {
  return name.replace(/^([A-Z])([A-Z])/, '$1-$2').replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()
}

let lucideTable: Map<string, IconNode> | null = null
/** name (without `lucide-`) → icon node, in Lucide export order. */
function lucideIcons(): Map<string, IconNode> {
  if (lucideTable) return lucideTable
  const t = new Map<string, IconNode>()
  const mod = lucide as any
  for (const k of Object.keys(mod)) {
    if (!/^[A-Z]/.test(k) || /Icon$/.test(k) || /^Lucide/.test(k)) continue
    const node = mod[k]
    if (!Array.isArray(node)) continue
    // `Grid2X2` is an alias spelling of `Grid2x2` (same id).
    const id = lucideExportToId(k.replace(/(\d)X(\d)/g, '$1x$2'))
    if (!t.has(id)) t.set(id, node as IconNode)
  }
  // Order = Lucide's export order, then the legacy `github`.
  if (!t.has('github')) t.set('github', GITHUB)
  lucideTable = t
  return lucideTable
}

function normaliseValue(k: string, v: string | number): string {
  const s = String(v)
  return k !== 'd' && k !== 'points' && /^-?[0-9.]+$/.test(s) ? String(Number(s)) : s
}

function createSvg(attrs: Record<string, string | number>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  for (const k of Object.keys(attrs)) svg.setAttribute(k, String(attrs[k]))
  return svg
}

function buildLucide(node: IconNode): SVGSVGElement {
  const svg = createSvg(LUCIDE_ATTRS)
  for (const [tag, attrs] of node) {
    const el = document.createElementNS(SVG_NS, tag)
    const keys = Object.keys(attrs).filter(k => k !== 'key')
    keys.sort((a, b) => {
      const ia = ATTR_ORDER.indexOf(a)
      const ib = ATTR_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    for (const k of keys) el.setAttribute(k, normaliseValue(k, attrs[k]))
    svg.appendChild(el)
  }
  return svg
}

const addedIcons: Record<string, string> = {}
const cache: Record<string, SVGSVGElement> = {}

function cached(id: string, make: () => SVGSVGElement | null): SVGSVGElement | null {
  if (!Object.prototype.hasOwnProperty.call(cache, id)) {
    const el = make()
    if (!el) return null
    el.classList.add('svg-icon', id)
    cache[id] = el
  }
  return cache[id].cloneNode(true) as SVGSVGElement
}

function lucideNode(name: string): IconNode | null {
  return lucideIcons().get(name) ?? null
}

/** `getIcon(iconId)`: a fresh `svg.svg-icon` element, or null for an unknown id. */
export function getIcon(iconId: string): SVGSVGElement | null {
  if (iconId.startsWith('lucide-')) {
    const node = lucideNode(iconId.substring(7))
    return node ? cached(iconId, () => buildLucide(node)) : null
  }
  if (Object.prototype.hasOwnProperty.call(addedIcons, iconId)) {
    return cached(iconId, () => {
      const svg = createSvg(ADDED_ATTRS)
      svg.innerHTML = addedIcons[iconId]
      return svg
    })
  }
  if (iconId === 'right-triangle') return cached(iconId, () => buildLucide([['path', { d: 'M3 8L12 17L21 8' }]]))
  if (Object.prototype.hasOwnProperty.call(CUSTOM_ICONS, iconId)) {
    const node = (lucide as any)[CUSTOM_ICONS[iconId]] as IconNode | undefined
    return node ? cached(iconId, () => buildLucide(node)) : null
  }
  let name = iconId
  if (Object.prototype.hasOwnProperty.call(LEGACY_ICON_ALIASES, name)) name = LEGACY_ICON_ALIASES[name]
  const node = lucideNode(name)
  if (node) return cached('lucide-' + name, () => buildLucide(node))
  const inner = fallbackProvider?.(iconId)
  if (!inner) return null
  const svg = createSvg(LUCIDE_ATTRS)
  svg.innerHTML = inner
  svg.classList.add('svg-icon', iconId)
  return svg
}

/** Inner SVG markup for ids the kit does not know (24px wrapper); null = unknown. */
export type IconProvider = (iconId: string) => string | null
let fallbackProvider: IconProvider | null = null
/** Extension hook: supply glyphs for extra icon ids (consulted last, never cached). */
export function setIconProvider(p: IconProvider | null): void {
  fallbackProvider = p
}

/**
 * `setIcon(parent, iconId)`: keeps the current icon if the first child already is that icon,
 * otherwise removes the first child and appends the new icon (nothing for an unknown id).
 */
export function setIcon(parent: HTMLElement, iconId: string): void {
  const first = parent.firstChild as Element | null
  if (first && first instanceof (parent.ownerDocument.defaultView || window).SVGSVGElement && first.classList.contains(iconId)) return
  if (first) parent.removeChild(first)
  const icon = getIcon(iconId)
  if (icon) parent.appendChild(icon)
}

/** `addIcon(iconId, svgContent)`: registers markup for a 0 0 100 100 viewBox. */
export function addIcon(iconId: string, svgContent: string): void {
  delete cache[iconId]
  addedIcons[iconId] = svgContent
}

/** `removeIcon(iconId)`: removes an icon registered with addIcon. */
export function removeIcon(iconId: string): void {
  delete cache[iconId]
  delete addedIcons[iconId]
}

/** `getIconIds()`: lucide ids, then added ids, then custom ids. */
export function getIconIds(): string[] {
  return [...[...lucideIcons().keys()].map(k => 'lucide-' + k), ...Object.keys(addedIcons), ...Object.keys(CUSTOM_ICONS)]
}
