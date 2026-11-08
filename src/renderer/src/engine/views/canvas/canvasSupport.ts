/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas support types and helpers: options/host interfaces, zoom constants, SetMultimap, SpatialIndex, CanvasHistory, shell hooks.
import { intersectsBBox, type BBox } from './geometry'

export const DOT_RADIUS = '0.7'
export const ZOOM_EPSILON = 0.01
export const WHEEL_PAN_FACTOR = 0.93
export const ZOOM_BREAKPOINT_BASE = -1.7

export interface CanvasOptions {
  snapToObjects?: boolean
  snapToGrid?: boolean
  newFileLocation?: 'root' | 'current' | 'folder'
  newFileFolderPath?: string
  defaultWheelBehavior?: 'pan' | 'zoom'
  defaultModDragBehavior?: 'menu' | 'card' | 'note' | 'media' | 'webpage' | 'group'
  cardLabelVisibility?: 'always' | 'hover' | 'never'
  zoomBreakpoint?: number
  [key: string]: unknown
}

/** What the canvas needs from its view (CanvasView, or the embedded host in the React shell). */
export interface CanvasHost {
  app: any
  contentEl: HTMLElement
  file: any
  leaf?: any
  plugin: { options: CanvasOptions; saveOptions(): void }
  requestSave(): void
  saveLocalData(): void
}

/** Multimap with Set values (edges by endpoint node). */
export class SetMultimap<K, V> {
  data = new Map<K, Set<V>>()
  add(k: K, v: V): void {
    const s = this.data.get(k)
    if (s) s.add(v)
    else this.data.set(k, new Set([v]))
  }
  delete(k: K, v: V): void {
    const s = this.data.get(k)
    if (!s) return
    s.delete(v)
    if (s.size === 0) this.data.delete(k)
  }
  get(k: K): Set<V> | undefined {
    return this.data.get(k)
  }
  getArray(k: K): V[] {
    const s = this.data.get(k)
    return s ? Array.from(s) : []
  }
}

/** Spatial lookup over cached bboxes. */
export class SpatialIndex<T extends { bbox: BBox | null; getBBox(): BBox }> {
  items = new Set<T>()
  insert(item: T): void {
    item.bbox = item.getBBox()
    this.items.add(item)
  }
  remove(item: T): void {
    if (!item.bbox) return
    this.items.delete(item)
    item.bbox = null
  }
  clear(): void {
    for (const i of this.items) i.bbox = null
    this.items.clear()
  }
  search(b: BBox): T[] {
    const out: T[] = []
    for (const i of this.items) if (i.bbox && intersectsBBox(b, i.bbox)) out.push(i)
    return out
  }
}

/** Undo stack of canvas snapshots. */
export class CanvasHistory {
  data: any[] = []
  current = 0
  constructor(public max: number) {}
  canUndo(): boolean {
    return this.current > 0
  }
  undo(): any {
    if (!this.canUndo()) return null
    this.current--
    return this.data[this.current]
  }
  canRedo(): boolean {
    return this.current < this.data.length - 1
  }
  redo(): any {
    if (!this.canRedo()) return null
    this.current++
    return this.data[this.current]
  }
  push(d: any): void {
    const a = this.data
    if (a.length - 1 > this.current) a.length = this.current + 1
    a.push(d)
    if (a.length >= this.max) a.shift()
    this.current = a.length - 1
  }
  replace(d: any): void {
    const a = this.data
    if (a.length === 0) {
      a.push(d)
      this.current = 0
    } else a[this.current] = d
  }
  clear(): void {
    this.data.length = 0
    this.current = 0
  }
}

export function sameBox(a: BBox, b: BBox): boolean {
  return a.maxX === b.maxX && a.maxY === b.maxY && a.minX === b.minX && a.minY === b.minY
}

/** Host hooks for the React shell (open links without a workspace). */
export const canvasShellHooks: { openLinkText?: (linktext: string, sourcePath: string, newLeaf: boolean | string) => void } = {}

export function webContents(): any {
  try {
    const remote = (window as any).require?.('@electron/remote')
    return remote?.getCurrentWebContents?.()
  } catch {
    return null
  }
}
