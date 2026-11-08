/* eslint-disable @typescript-eslint/no-explicit-any */
// `![[x.canvas]]`: a static SVG minimap of groups, cards and connections; click opens.
import { Component } from '../../core/Component'
import { setIcon } from '../../ui/icons'
import { applyCanvasColor } from './color'
import { edgeBezier, expandBBox, rectToBBox, sideAnchor, unionBBox } from './geometry'
import { getMarkdownHost } from '../../markdown/host'
import type { EmbedContext } from '../../markdown/embeds'

/** Render the minimap of a canvas file's text into `el` (nothing for invalid / empty canvases). */
export function renderCanvasMinimap(el: HTMLElement, text: string): void {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return
  }
  const nodes = data?.nodes
  if (!nodes || nodes.length === 0) return
  const edges = data.edges || []
  const svg = createSvg('svg', 'canvas-minimap')
  const boxes: Record<string, any> = {}
  const all: any[] = []
  for (const n of nodes) {
    const b = rectToBBox(n)
    boxes[n.id] = b
    all.push(b)
  }
  let bounds = unionBBox(all)
  const rectFor = (n: any) => applyCanvasColor(svg.createSvg('rect', { attr: { x: n.x, y: n.y, width: n.width, height: n.height, rx: '20', ry: '20' } }) as any, n.color)
  for (const n of nodes) if (n.type === 'group') rectFor(n)
  const stroke = Math.sqrt((bounds.maxX - bounds.minX) / 10)
  for (const e of edges) {
    const a = boxes[e.fromNode]
    const b = boxes[e.toNode]
    if (!a || !b) continue
    const bz = edgeBezier(sideAnchor(a, e.fromSide), e.fromSide, sideAnchor(b, e.toSide), e.toSide)
    const p = svg.createSvg('path', { attr: { d: bz.path } }) as any
    p.style.strokeWidth = String(stroke)
    applyCanvasColor(p, e.color)
  }
  for (const n of nodes) if (n.type !== 'group') rectFor(n)
  bounds = expandBBox(bounds, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 20)
  svg.setAttr('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`)
  el.appendChild(svg)
}

export class CanvasEmbed extends Component {
  containerEl: HTMLElement
  headerEl: HTMLElement | null = null
  constructor(public ctx: EmbedContext, public path: string, public subpath: string) {
    super()
    const el = (this.containerEl = ctx.containerEl)
    el.addClass('canvas-embed')
    if (ctx.showInline) {
      el.addClass('inline-embed')
      const base = path.substring(path.lastIndexOf('/') + 1).replace(/\.canvas$/i, '')
      this.headerEl = el.createDiv({ cls: 'embed-title' }, t => {
        t.createSpan({ cls: 'file-embed-icon' }, i => setIcon(i, 'lucide-layout-dashboard'))
        t.appendText(' ' + base)
      })
    }
    el.addEventListener('click', e => getMarkdownHost().openLinkText(ctx.linktext, ctx.sourcePath, e.ctrlKey || e.metaKey))
  }
  async loadFile(): Promise<void> {
    const el = this.containerEl
    el.empty()
    if (this.headerEl) el.appendChild(this.headerEl)
    renderCanvasMinimap(el, await getMarkdownHost().readFile(this.path))
  }
}
