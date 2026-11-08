/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas connections: one `<g>` in the first `svg.canvas-edges` with an interaction path and
// a display path, one `<g>` in the second with the arrow polygons; labels are `.canvas-path-label-wrapper`
// divs positioned at the bezier midpoint.
import { Menu } from '../../ui/Menu'
import { applyCanvasColor } from './color'
import { bezierPoint, distance, edgePath, expandBBox, sideAnchor, ARROW_POINTS, type BBox, type Bezier, type Point } from './geometry'
import { DEFAULT_FROM_END, DEFAULT_TO_END, normalizeColor, omit, type CanvasEdgeData, type CanvasEdgeEnd, type CanvasSide } from './json'
import { startPointerDrag, suppressNextEvent } from './dom'
import { S } from './strings'
import type { Canvas } from './Canvas'
import type { CanvasNode } from './CanvasNode'

export interface EdgeEndpoint {
  node: CanvasNode
  side: CanvasSide
  end: CanvasEdgeEnd
}

export class CanvasEdge {
  canvas: Canvas
  id: string
  from: EdgeEndpoint
  to: EdgeEndpoint
  color = ''
  label: string | undefined = ''
  unknownData: Record<string, unknown> = {}
  initialized = false
  lineGroupEl: SVGGElement
  lineEndGroupEl: SVGGElement
  path!: { interaction: SVGPathElement; display: SVGPathElement }
  bezier!: Bezier
  fromLineEnd: { el: SVGGElement; type: CanvasEdgeEnd } | null = null
  toLineEnd: { el: SVGGElement; type: CanvasEdgeEnd } | null = null
  labelElement: EdgeLabel | null = null
  bbox: BBox | null = null

  constructor(canvas: Canvas, id: string, from: EdgeEndpoint, to: EdgeEndpoint) {
    this.canvas = canvas
    this.id = id
    this.from = from
    this.to = to
    this.lineGroupEl = createSvg('g') as SVGGElement
    this.lineEndGroupEl = createSvg('g') as SVGGElement
  }

  attach(): void {
    if (this.isAttached) return
    this.canvas.edgeContainerEl.appendChild(this.lineGroupEl)
    this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl)
  }
  detach(): void {
    if (!this.isAttached) return
    this.lineGroupEl.detach()
    this.lineEndGroupEl.detach()
  }
  get isAttached(): boolean {
    return !!this.lineGroupEl.parentNode
  }
  destroy(): void {
    this.labelElement?.destroy()
    this.lineGroupEl?.remove()
    this.lineEndGroupEl?.remove()
  }

  getData(): CanvasEdgeData {
    const { id, from, to, color, label } = this
    const d: CanvasEdgeData = { ...this.unknownData, id, fromNode: from.node.id, fromSide: from.side, toNode: to.node.id, toSide: to.side }
    if (from.end !== DEFAULT_FROM_END) d.fromEnd = from.end
    if (to.end !== DEFAULT_TO_END) d.toEnd = to.end
    if (color) d.color = color
    if (label) d.label = label
    return d
  }

  setData(data: any): void {
    const { fromNode, fromSide, toNode, toSide, label } = data
    let { fromEnd, toEnd } = data
    const rest = omit(data, ['fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label'])
    let dirty = false
    const color = normalizeColor(data.color || '')
    if (this.color !== color) ((this.color = color), (dirty = true))
    if (this.label !== label) ((this.label = label), (dirty = true))
    const canvas = this.canvas
    const nodes = canvas.nodes
    let moved = false
    if (fromNode && fromNode !== this.from.node.id && nodes.has(fromNode)) ((moved = true), (this.from.node = nodes.get(fromNode)!))
    fromEnd = fromEnd || DEFAULT_FROM_END
    if (fromNode && fromEnd !== this.from.end) ((this.from.end = fromEnd), (dirty = true))
    if (toNode && toNode !== this.to.node.id && nodes.has(toNode)) ((moved = true), (this.to.node = nodes.get(toNode)!))
    toEnd = toEnd || DEFAULT_TO_END
    if (toNode && toEnd !== this.to.end) ((this.to.end = toEnd), (dirty = true))
    if (fromNode) {
      const side = fromSide ?? canvas.sideTowards(this.from.node, this.to.node)
      if (side !== this.from.side) ((this.from.side = side), (dirty = true))
    }
    if (toNode) {
      const side = toSide ?? canvas.sideTowards(this.to.node, this.from.node)
      if (side !== this.to.side) ((this.to.side = side), (dirty = true))
    }
    if (moved) canvas.markMoved(this)
    if (dirty) canvas.markDirty(this)
    this.unknownData = rest
  }

  setColor(color: string, renderNow = false): void {
    color = normalizeColor(color || '')
    if (this.color === color) return
    this.color = color
    if (renderNow) this.render()
    else this.canvas.markDirty(this)
  }
  setLabel(label: string): void {
    if (this.label !== label) this.label = label
  }

  update(from: EdgeEndpoint, to: EdgeEndpoint): void {
    const canvas = this.canvas
    if (this.from.node !== from.node) {
      canvas.edgeFrom.delete(this.from.node, this)
      if (!from.node.nodeEl.hasClass('is-dummy')) canvas.edgeFrom.add(from.node, this)
    }
    if (this.to.node !== to.node) {
      canvas.edgeTo.delete(this.to.node, this)
      if (!to.node.nodeEl.hasClass('is-dummy')) canvas.edgeTo.add(to.node, this)
    }
    this.from = from
    this.to = to
    canvas.markMoved(this)
  }

  getBBox(): BBox {
    const a = sideAnchor(this.from.node.getBBox(), this.from.side)
    const b = sideAnchor(this.to.node.getBBox(), this.to.side)
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }
  }

  focus(): void {
    this.select()
  }
  blur(): void {
    this.deselect()
    this.labelElement?.blur()
  }
  select(): void {
    this.lineGroupEl.addClass('is-focused')
    this.lineEndGroupEl.addClass('is-focused')
  }
  deselect(): void {
    this.lineGroupEl.removeClass('is-focused')
    this.lineEndGroupEl.removeClass('is-focused')
  }
  editLabel(): void {
    if (!this.labelElement) this.labelElement = new EdgeLabel(this)
    this.labelElement.focus()
  }
  getCenter(): Point {
    return bezierPoint(0.5, this.bezier)
  }

  initialize(): void {
    const g = this.lineGroupEl
    g.addEventListener('click', e => this.onClick(e))
    g.addEventListener('contextmenu', e => this.onContextMenu(e))
    g.addEventListener('pointerdown', e => this.onConnectionPointerdown(e))
    this.path = { interaction: g.createSvg('path', 'canvas-interaction-path') as SVGPathElement, display: g.createSvg('path', 'canvas-display-path') as SVGPathElement }
  }

  render(): void {
    if (!this.initialized) {
      this.initialized = true
      this.initialize()
    }
    const { lineGroupEl, lineEndGroupEl, color, label } = this
    this.updatePath()
    if (this.labelElement && !label) this.labelElement.destroy(true)
    this.labelElement?.render()
    if (label) {
      if (!this.labelElement) this.labelElement = new EdgeLabel(this)
      this.labelElement.setText(label)
    }
    applyCanvasColor(lineGroupEl, color)
    applyCanvasColor(lineEndGroupEl, color)
    lineGroupEl.toggleClass('is-themed', !!color)
    lineEndGroupEl.toggleClass('is-themed', !!color)
  }

  updatePath(): void {
    const { from, to, path } = this
    if (from.end !== this.fromLineEnd?.type) {
      this.fromLineEnd?.el.detach()
      this.fromLineEnd = this.createEdgeEnd(from.end)
    }
    if (to.end !== this.toLineEnd?.type) {
      this.toLineEnd?.el.detach()
      this.toLineEnd = this.createEdgeEnd(to.end)
    }
    const r = edgePath(from.node.getBBox(), from.side, !!this.fromLineEnd, to.node.getBBox(), to.side, !!this.toLineEnd)
    this.bezier = r.bezier
    if (this.fromLineEnd && r.fromTransform) this.fromLineEnd.el.style.transform = r.fromTransform
    if (this.toLineEnd && r.toTransform) this.toLineEnd.el.style.transform = r.toTransform
    path.interaction.setAttr('d', r.d)
    path.display.setAttr('d', r.d)
  }

  createEdgeEnd(type: CanvasEdgeEnd): { el: SVGGElement; type: CanvasEdgeEnd } | null {
    if (type !== 'arrow') return null
    const el = this.lineEndGroupEl.createSvg('g', {}, g => {
      g.createSvg('polygon', { cls: 'canvas-path-end', attr: { points: ARROW_POINTS } })
    }) as SVGGElement
    return { el, type }
  }

  onClick(e: MouseEvent): void {
    const canvas = this.canvas
    if (e.button !== 0 || canvas.readonly) return
    if (e.shiftKey) canvas.toggleSelect(this)
    else if (canvas.selection.size === 1 && canvas.selection.has(this)) this.editLabel()
    else canvas.selectOnly(this)
  }

  onContextMenu(e: MouseEvent): void {
    if (e.defaultPrevented) return
    const canvas = this.canvas
    if (canvas.selection.has(this) && canvas.selection.size > 1) canvas.onSelectionContextMenu(e)
    else {
      if (!canvas.readonly) canvas.selectOnly(this)
      const menu = new Menu().addSections(['canvas'])
      this.showMenu(menu, e)
      e.preventDefault()
      menu.showAtMouseEvent(e)
    }
  }

  showMenu(menu: Menu, e: MouseEvent): void {
    const canvas = this.canvas
    if (!canvas.readonly) {
      menu.addItem(i =>
        i
          .setSection('danger')
          .setTitle(S.actionRemove)
          .setIcon('lucide-trash-2')
          .setWarning(true)
          .onClick(() => {
            canvas.removeEdge(this)
            canvas.requestSave()
          })
      )
      menu.addItem(i =>
        i
          .setSection('canvas')
          .setTitle(S.actionEditLabel)
          .setIcon('lucide-edit')
          .onClick(() => this.editLabel())
      )
    }
    menu.addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.actionFollowConnection)
        .setIcon('lucide-corner-down-right')
        .onClick(() => {
          const p = canvas.posFromEvt(e)
          const a = sideAnchor(this.from.node.getBBox(), this.from.side)
          const b = sideAnchor(this.to.node.getBBox(), this.to.side)
          const node = distance(p, a) > distance(p, b) ? this.from.node : this.to.node
          canvas.zoomToBbox(node.getBBox())
        })
    )
    canvas.app.workspace?.trigger?.('canvas:edge-menu', menu, this)
  }

  /** Dragging a connection moves its nearer end to another card side (or deletes it when dropped on nothing). */
  onConnectionPointerdown(e: PointerEvent): void {
    const canvas = this.canvas
    if (!e.isPrimary || e.button !== 0 || canvas.readonly || (e.pointerType === 'touch' && !canvas.selection.has(this))) return
    e.preventDefault()
    startPointerDrag(e, () => {
      const { from, to } = this
      const p0 = canvas.posFromEvt(e)
      const a = sideAnchor(from.node.getBBox(), from.side)
      const b = sideAnchor(to.node.getBBox(), to.side)
      const moving = distance(p0, a) > distance(p0, b) ? 'to' : 'from'
      const fixed = moving === 'from' ? to : from
      const dummy = canvas.createDummyNode()
      let target: { side: CanvasSide; node: CanvasNode } | null = null
      canvas.canvasEl.addClass('is-connecting')
      canvas.deselectAll()
      return canvas.handleDragWithPan(e, {
        move: ev => {
          const p = canvas.posFromEvt(ev)
          dummy.x = p.x
          dummy.y = p.y
          dummy.width = 0
          dummy.height = 0
          const near = canvas.getIntersectingNodes(expandBBox(dummy.getBBox(), canvas.config.objectSnapDistance)).filter(n => n !== fixed.node)
          target = canvas.nearestSide(p, near)
          if (moving === 'from') {
            if (target) this.update({ side: target.side, node: target.node, end: from.end }, to)
            else this.update({ side: from.side, node: dummy, end: from.end }, to)
          } else if (target) this.update(from, { side: target.side, node: target.node, end: to.end })
          else this.update(from, { side: to.side, node: dummy, end: to.end })
        },
        end: () => {
          if (!target) canvas.removeEdge(this)
          canvas.requestSave()
        },
        cancel: () => this.update(from, to),
        cleanup: () => {
          canvas.canvasEl.removeClass('is-connecting')
          suppressNextEvent(this.lineGroupEl, 'click')
        }
      })
    })
  }
}

/** Editable label at the middle of a connection. */
export class EdgeLabel {
  isEditing = false
  initialTextState = ''
  edge: CanvasEdge
  wrapperEl: HTMLElement
  textareaEl: HTMLElement

  constructor(edge: CanvasEdge) {
    this.edge = edge
    const canvas = edge.canvas
    const wrap = (this.wrapperEl = canvas.canvasEl.createDiv('canvas-path-label-wrapper'))
    wrap.addEventListener('click', e => {
      if (canvas.readonly) return
      if (e.shiftKey) {
        this.blur()
        canvas.toggleSelect(edge)
        return
      }
      const sel = canvas.selection
      if (sel.size === 1 && sel.has(edge)) {
        if (!this.isEditing) this.focus({ x: e.clientX, y: e.clientY })
      } else canvas.selectOnly(edge)
    })
    this.textareaEl = wrap.createDiv({ cls: 'canvas-path-label', text: edge.label || '', attr: { contentEditable: false, 'data-placeholder': S.promptAddText } })
    this.textareaEl.addEventListener('input', () => {
      this.edge.label = this.textareaEl.innerText
      this.edge.canvas.requestSave(false)
    })
    if (!edge.label) setTimeout(() => this.focus())
    this.render()
  }

  setText(text: string): void {
    this.textareaEl.setText(text)
  }

  focus(at?: Point): void {
    const el = this.textareaEl
    this.isEditing = true
    el.setAttr('contenteditable', true)
    el.addClass('is-editing')
    const doc = el.ownerDocument as any
    let range: Range | null = null
    if (at && typeof doc.caretRangeFromPoint === 'function') range = doc.caretRangeFromPoint(at.x, at.y)
    if (!range) {
      range = doc.createRange()
      range!.selectNodeContents(el)
    }
    const sel = el.ownerDocument.defaultView?.getSelection()
    if (sel && range) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
    el.focus()
    this.initialTextState = this.edge.label || ''
  }

  blur(): void {
    const el = this.textareaEl
    this.isEditing = false
    el.blur()
    el.setAttr('contenteditable', false)
    el.removeClass('is-editing')
    if (this.edge.label) {
      if (this.initialTextState !== this.edge.label) this.edge.canvas.requestSave()
    } else this.destroy()
    this.initialTextState = ''
  }

  render(): void {
    const c = this.edge.getCenter()
    this.wrapperEl.style.transform = `translate(${c.x}px, ${c.y}px)`
    applyCanvasColor(this.wrapperEl, this.edge.color)
    this.wrapperEl.toggleClass('is-themed', !!this.edge.color)
  }

  destroy(silent?: boolean): void {
    const edge = this.edge
    if (edge.label) delete edge.label
    if (this.initialTextState && !silent) edge.canvas.requestSave()
    this.wrapperEl.remove()
    edge.labelElement = null
  }
}
