/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas clipboard, paste, file import and drag-drop helpers.
// Bodies of Canvas methods (called with the canvas as `this`); the thin methods stay on the class.
import type { Point } from './geometry'
import { randomId } from './json'
import { CanvasNode } from './CanvasNode'
import { CanvasEdge } from './CanvasEdge'
import type { Canvas } from './Canvas'
import { isUrl, dataTransferText } from './canvasUrl'

export function handleCut(this: Canvas, e: ClipboardEvent): void {
  if (this.readonly || !(this as any).hasFocus()) return
  this.handleCopy(e)
  for (const i of Array.from(this.selection)) {
    if (i instanceof CanvasNode) this.removeNode(i)
    if (i instanceof CanvasEdge) this.removeEdge(i)
  }
  this.requestSave()
}

/** New ids for nodes and edges (edges re-pointed), optional offset. */
export function cloneData<T extends { nodes: any[]; edges: any[] }>(this: Canvas, d: T, offset?: Point | null): T {
  const map: Record<string, string> = {}
  for (const n of d.nodes) {
    const id = randomId(16)
    map[n.id] = id
    n.id = id
    if (offset) {
      n.x += offset.x
      n.y += offset.y
    }
  }
  for (const e of d.edges) {
    e.fromNode = map[e.fromNode] || ''
    e.toNode = map[e.toNode] || ''
    e.id = randomId(16)
  }
  return d
}

export function handlePaste(this: Canvas, e: ClipboardEvent): void {
  if (e.defaultPrevented || this.readonly || !(this as any).hasFocus()) return
  e.preventDefault()
  const center = this.posCenter()
  const dt = e.clipboardData
  if (!dt) return
  const files = Array.from(dt.files || [])
  if (files.length > 0) {
    void this.importFiles(files).then(list => {
      this.createFileNodes(list, center)
      this.requestSave()
    })
    return
  }
  const raw = dt.getData('obsidian/canvas')
  if (raw) {
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.error(err)
      return
    }
    const { nodes, edges, center: c } = parsed
    if (!nodes || !Array.isArray(nodes) || !edges || !Array.isArray(edges)) return
    const offset = c ? { x: center.x - c.x, y: center.y - c.y } : null
    const added = this.importData(this.cloneData(parsed, offset), false)
    this.deselectAll()
    this.requestSave()
    added?.forEach(n => this.select(n))
    return
  }
  const text = dataTransferText(dt)
  if (isUrl(text)) {
    this.createLinkNode({ pos: center, position: 'center', url: text })
    this.requestSave()
    return
  }
  if (text) this.createTextNode({ pos: center, position: 'center', text })
}

/** Copy OS files into the vault as attachments (`app.importAttachments` when present). */
export async function importFiles(this: Canvas, files: File[]): Promise<any[]> {
  const app = this.app
  if (typeof app.importAttachments === 'function') return app.importAttachments(files.map(f => ({ name: f.name, data: f.arrayBuffer() })), null)
  const out: any[] = []
  for (const f of files) {
    const dot = f.name.lastIndexOf('.')
    const base = dot > 0 ? f.name.slice(0, dot) : f.name
    const ext = dot > 0 ? f.name.slice(dot + 1) : ''
    const path = await app.vault.getAvailablePathForAttachments(base, ext, this.view.file)
    out.push(await app.vault.createBinary(path, await f.arrayBuffer()))
  }
  return out
}

/** Drop of an app draggable: file / link / files / folder. */
export function dropDraggable(this: Canvas, drag: any, pos: Point): void {
  const isFile = (f: any) => f && 'extension' in f
  const isFolder = (f: any) => f && 'children' in f
  const collect = (folder: any, out: any[]) => {
    for (const c of folder.children) {
      if (isFolder(c)) collect(c, out)
      else if (isFile(c)) out.push(c)
    }
  }
  switch (drag.type) {
    case 'file':
    case 'link':
      if (isFile(drag.file)) this.createFileNode({ pos, file: drag.file })
      this.wrapperEl.focus()
      break
    case 'files': {
      const set = new Set<any>()
      for (const f of drag.files || []) {
        if (isFolder(f)) {
          const l: any[] = []
          collect(f, l)
          l.forEach(x => set.add(x))
        } else if (isFile(f)) set.add(f)
      }
      const list = Array.from(set).sort((a, b) => a.basename.localeCompare(b.basename))
      if (list.length) {
        const made = this.createFileNodes(list, pos)
        this.deselectAll()
        made.forEach(n => this.select(n))
        this.requestSave()
      }
      this.wrapperEl.focus()
      break
    }
    case 'folder':
      if (isFolder(drag.file)) {
        const l: any[] = []
        collect(drag.file, l)
        l.sort((a, b) => a.basename.localeCompare(b.basename))
        this.createFileNodes(l, pos)
        this.requestSave()
        this.wrapperEl.focus()
      }
      break
  }
}
