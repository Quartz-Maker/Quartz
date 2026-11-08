/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas node/edge lifecycle helpers: creation, removal, data import/export, clear.
// Bodies of Canvas methods (called with the canvas as `this`); the thin methods stay on the class.
import { Platform } from '../../keymap/Platform'
import { bboxCenter, placeRect, sideTowards, unionBBox, type BBox, type Point } from './geometry'
import { DEFAULT_FROM_END, DEFAULT_TO_END, type CanvasSide } from './json'
import { CanvasNode, FileNode, GroupNode, LinkNode, TextNode } from './CanvasNode'
import { CanvasEdge } from './CanvasEdge'
import { byZIndex } from './CanvasMenu'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { isYouTubeUrl } from './canvasUrl'

export function createPlaceholder(this: Canvas): void {
  if (this.canvasPlaceholderEl) return
  const frag = createFragment(f => {
    f.appendText(S.labelDragFromBelow)
    f.createEl('br')
    f.appendText(S.labelSpaceDragPan)
    f.createEl('br')
    f.appendText(`${Platform.isMacOS ? '⌘' : 'Ctrl'} + ${S.labelScrollToZoom}`)
  })
  this.canvasPlaceholderEl = this.canvasEl.createDiv({ cls: 'canvas-placeholder-message', text: frag })
}

export function getSelectionData(this: Canvas, sel: Set<CanvasNode | CanvasEdge> = this.selection): { nodes: any[]; edges: any[]; center: Point } {
  const items = Array.from(sel)
  items.sort(byZIndex)
  const nodes: any[] = []
  const edges: any[] = []
  const touched = new Set<CanvasEdge>()
  for (const i of items) {
    if (i instanceof CanvasNode) {
      nodes.push(i.getData())
      for (const e of this.getEdgesForNode(i)) touched.add(e)
    }
  }
  for (const e of touched) if (sel.has(e.from.node) && sel.has(e.to.node)) edges.push(e.getData())
  return { nodes, edges, center: bboxCenter(unionBBox(items.map(i => i.getBBox()))) }
}

export function updateFileOpen(this: Canvas, file: any): void {
  const ws = this.app.workspace
  const leaf = this.view.leaf
  if (!ws || !leaf || leaf !== ws.activeLeaf || leaf.view !== this.view) return
  if (file === null) file = this.view.file
  ws.trigger('file-open', file)
}

export function setData(this: Canvas, data: any): void {
  if (!data) return
  if (Object.keys(data).length === 0) {
    this.createPlaceholder()
    return
  }
  this.importData(data, true)
  this.data = data
  this.pushHistory(data)
}

/** Create/update nodes and edges from data; `replace` removes everything not in `data`. Returns the touched nodes. */
export function importData(this: Canvas, data: any, replace: boolean): Set<CanvasNode> | undefined {
  const list = data.nodes
  if (!list || !Array.isArray(list)) return
  const nodes = this.nodes
  const seen = new Set<CanvasNode>()
  let lastZ = 0
  for (const nd of list) {
    const id = nd.id
    let node = nodes.get(id)
    if (!node) {
      if (nd.type === 'file') node = new FileNode(this, id)
      else if (nd.type === 'text') node = new TextNode(this, id)
      else if (nd.type === 'link') node = new LinkNode(this, id)
      else if (nd.type === 'group') node = new GroupNode(this, id)
      else continue
      this.addNode(node)
      this.markMoved(node)
    }
    node.setData(nd)
    seen.add(node)
    if (node.zIndex < lastZ) node.updateZIndex()
    lastZ = node.zIndex
  }
  if (replace) nodes.forEach(n => seen.has(n) || this.removeNode(n))
  const elist = data.edges
  if (elist && Array.isArray(elist)) {
    const edges = this.edges
    const seenEdges = new Set<CanvasEdge>()
    for (const ed of elist) {
      const id = ed.id
      if (nodes.has(ed.fromNode) && nodes.has(ed.toNode)) {
        let edge = edges.get(id)
        if (!edge) {
          const a = nodes.get(ed.fromNode)!
          const b = nodes.get(ed.toNode)!
          let fs = ed.fromSide
          let ts = ed.toSide
          if (!fs) ed.fromSide = fs = this.sideTowards(a, b)
          if (!ts) ed.toSide = ts = this.sideTowards(b, a)
          edge = new CanvasEdge(this, id, { node: a, side: fs, end: ed.fromEnd || DEFAULT_FROM_END }, { node: b, side: ts, end: ed.toEnd || DEFAULT_TO_END })
          this.addEdge(edge)
          this.markMoved(edge)
        }
        seenEdges.add(edge)
        edge.setData(ed)
      } else if (edges.has(id)) this.removeEdge(edges.get(id)!)
    }
    if (replace) edges.forEach(e => seenEdges.has(e) || this.removeEdge(e))
    return seen
  }
  return undefined
}

export function clear(this: Canvas): void {
  this.staleSelection = []
  this.selection.clear()
  this.nodes.forEach(n => this.removeNode(n))
  this.edges.forEach(e => this.removeEdge(e))
  this.nodeIndex.clear()
  this.history.clear()
  this.data = {}
  this.requestPushHistory.cancel()
  this.requestUpdateFileOpen.cancel()
  this.setViewport(0, 0, 0)
  this.setReadonly(false)
}

export function addNode(this: Canvas, node: CanvasNode): void {
  this.nodes.set(node.id, node)
  this.requestFrame()
  if (this.canvasPlaceholderEl) {
    this.canvasPlaceholderEl.detach()
    this.canvasPlaceholderEl = null
  }
}

export function removeNode(this: Canvas, node: CanvasNode): void {
  for (const e of this.getEdgesForNode(node)) this.removeEdge(e)
  this.deselect(node)
  this.nodes.delete(node.id)
  this.nodeIndex.remove(node)
  this.moved.delete(node)
  this.dirty.delete(node)
  this.lastNodesInViewport.delete(node)
  node.destroy()
  this.requestFrame()
}

export function addEdge(this: Canvas, edge: CanvasEdge): void {
  this.edges.set(edge.id, edge)
  this.edgeFrom.add(edge.from.node, edge)
  this.edgeTo.add(edge.to.node, edge)
  this.requestFrame()
}

export function removeEdge(this: Canvas, edge: CanvasEdge): void {
  if (!this.edges.has(edge.id)) return
  this.deselect(edge)
  this.edges.delete(edge.id)
  this.edgeFrom.delete(edge.from.node, edge)
  this.edgeTo.delete(edge.to.node, edge)
  this.edgeIndex.remove(edge)
  this.moved.delete(edge)
  this.dirty.delete(edge)
  this.lastEdgesInViewport.delete(edge)
  edge.destroy()
  this.requestFrame()
}

export function getIntersectingEdges(this: Canvas, b: BBox): CanvasEdge[] {
  return this.edgeIndex.search(b)
}

export function selectOnly(this: Canvas, item: CanvasNode | CanvasEdge): void {
  const s = this.selection
  if (s.size === 1 && Array.from(s)[0] === item) return
  this.updateSelection(() => {
    s.clear()
    s.add(item)
  })
}

export function selectAll(this: Canvas, items?: Iterable<CanvasNode | CanvasEdge>): void {
  const s = this.selection
  this.updateSelection(() => {
    if (items) {
      s.clear()
      for (const i of items) s.add(i)
    } else this.nodes.forEach(n => s.add(n))
  })
}

export function deleteSelection(this: Canvas): void {
  if (this.readonly) return
  for (const i of Array.from(this.selection)) {
    if (i instanceof CanvasNode) this.removeNode(i)
    if (i instanceof CanvasEdge) this.removeEdge(i)
  }
  this.deselectAll()
  this.requestSave()
}

export function getZIndex(this: Canvas): number {
  const z = (this.zIndexCounter += 1)
  const s = (z + 1).toString()
  this.cardMenuEl.style.zIndex = s
  this.canvasControlsEl.style.zIndex = s
  this.menu.updateZIndex(z + 3)
  return z
}

export function createTextNode(this: Canvas, o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; text?: string; save?: boolean; focus?: boolean }): TextNode {
  const n = new TextNode(this)
  n.moveAndResize(placeRect(o.pos, o.size || this.config.defaultTextNodeDimensions, o.position))
  if (o.text) n.setText(o.text)
  this.addNode(n)
  if (o.save !== false) this.requestSave()
  if (o.focus !== false) {
    n.attach()
    n.render()
    this.selectOnly(n)
    n.startEditing()
  }
  return n
}

export function createFileNode(this: Canvas, o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; file: any; subpath?: string; save?: boolean; focus?: boolean }): FileNode {
  const n = new FileNode(this)
  n.moveAndResize(placeRect(o.pos, o.size || this.config.defaultFileNodeDimensions, o.position))
  n.setFile(o.file, o.subpath)
  this.addNode(n)
  if (o.save !== false) this.requestSave()
  if (o.focus !== false) this.selectOnly(n)
  return n
}

export function createFileNodes(this: Canvas, files: any[], at: Point): FileNode[] {
  const { width, height } = this.config.defaultFileNodeDimensions
  const out: FileNode[] = []
  files.forEach((file, i) => {
    out.push(this.createFileNode({ pos: { x: at.x + (width + 45) * (i % 10), y: at.y + (height + 45) * Math.trunc(i / 10) }, size: this.config.defaultFileNodeDimensions, file, save: false, focus: false }))
  })
  return out
}

export function createLinkNode(this: Canvas, o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; url: string; save?: boolean; focus?: boolean }): LinkNode {
  const n = new LinkNode(this)
  let size = o.size || this.config.defaultFileNodeDimensions
  if (isYouTubeUrl(o.url)) size = { width: 640, height: 360 }
  n.moveAndResize(placeRect(o.pos, size, o.position))
  n.setUrl(o.url)
  this.addNode(n)
  if (o.save !== false) this.requestSave()
  if (o.focus !== false) this.selectOnly(n)
  return n
}

export function createGroupNode(this: Canvas, o: { pos: Point; size?: { width: number; height: number }; position?: 'center' | CanvasSide; label?: string; save?: boolean; focus?: boolean }): GroupNode {
  const n = new GroupNode(this)
  n.moveAndResize(placeRect(o.pos, o.size || this.config.defaultFileNodeDimensions, o.position))
  n.setLabel(o.label || S.labelUntitledGroup)
  this.addNode(n)
  if (o.save !== false) this.requestSave()
  if (o.focus !== false) {
    this.selectOnly(n)
    n.attach()
    n.render()
    n.focusLabel()
  }
  return n
}

export function markDirty(this: Canvas, item: CanvasNode | CanvasEdge): void {
  this.dirty.add(item)
  if (this.selection.has(item)) this.selectionChanged = true
  this.requestFrame()
}
