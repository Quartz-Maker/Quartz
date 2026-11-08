/* eslint-disable @typescript-eslint/no-explicit-any */
// Selection chrome:
//   CanvasSelection        `.canvas-selection` box with 8 resizers (multi-selection, rubber band)
//   CanvasSelectionMenu    `.canvas-menu-container > .canvas-menu` popover above the selection
//   NodeInteractionLayer   `.canvas-node-interaction-layer` resizers + connection points of the hovered card
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'
import { parseColor, toHex } from './color'
import { bboxToRect, collectSnapPoints, expandBBox, findSnap, rectToBBox, resizeSource, unionBBox, type BBox, type ResizeHandle } from './geometry'
import { startPointerDrag, hotkeyLabel } from './dom'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { CanvasNode, GroupNode, FileNode } from './CanvasNode'
import { CanvasEdge } from './CanvasEdge'
import { CanvasImageSuggestModal } from './modals'

type Item = CanvasNode | CanvasEdge
const SIDES: ResizeHandle[] = ['top', 'right', 'bottom', 'left']
const CORNERS: ResizeHandle[] = ['topright', 'bottomright', 'bottomleft', 'topleft']

export function byZIndex(a: any, b: any): number {
  return a.zIndex - b.zIndex
}

export class CanvasSelection {
  bbox: BBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  resizerEls: HTMLElement[] = []
  canvas: Canvas
  selectionEl: HTMLElement

  constructor(canvas: Canvas, cls?: string) {
    this.canvas = canvas
    this.selectionEl = createDiv('canvas-selection' + (cls ? ' ' + cls : ''))
    for (const side of SIDES) {
      const el = createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': side } })
      el.addEventListener('pointerdown', e => {
        if (e.target === el && e.pointerType === 'mouse') this.onResizePointerdown(e, side)
      })
      if (side === 'bottom' || side === 'right')
        el.addEventListener('dblclick', e => {
          for (const n of Array.from(this.canvas.selection)) if (n instanceof CanvasNode) n.onResizeDblclick(e, side)
        })
      this.resizerEls.push(el)
    }
    for (const corner of CORNERS) {
      const el = createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': corner } })
      el.addEventListener('pointerdown', e => this.onResizePointerdown(e, corner))
      this.resizerEls.push(el)
    }
  }

  update(b: BBox): void {
    this.bbox = b
    const el = this.selectionEl
    if (!el.parentNode) this.canvas.canvasEl.appendChild(el)
    for (const r of this.resizerEls) el.appendChild(r)
    const p = expandBBox(b, 10)
    el.setCssStyles({ transform: `translate(${p.minX}px, ${p.minY}px)`, width: `${p.maxX - p.minX}px`, height: `${p.maxY - p.minY}px` })
  }

  /** Resize every selected card proportionally with the selection box. */
  onResizePointerdown(e: PointerEvent, handle: ResizeHandle): void {
    if (!e.isPrimary || e.button !== 0 || e.pointerType !== 'mouse') return
    e.preventDefault()
    startPointerDrag(e, () => {
      const box = this.bbox
      const canvas = this.canvas
      const { x: bx, y: by, width: bw, height: bh } = bboxToRect(box)
      const { snapToGrid, snapToObjects } = canvas.options
      const nodes = Array.from(canvas.selection) as CanvasNode[]
      const rel: BBox[] = []
      const orig: any[] = []
      const frac: { width: number; height: number }[] = []
      for (const n of nodes) {
        n.nodeEl.addClass('is-dragging')
        orig.push(n.rect)
        const nb = n.getBBox()
        frac.push({ width: (nb.maxX - nb.minX) / bw, height: (nb.maxY - nb.minY) / bh })
        rel.push({ minX: (nb.minX - box.minX) / bw, minY: (nb.minY - box.minY) / bh, maxX: (nb.maxX - box.maxX) / bw, maxY: (nb.maxY - box.maxY) / bh })
      }
      return canvas.handleDragWithPan(e, {
        move: ev => {
          const min = canvas.config.minContainerDimension
          const minW = min / Math.min(...frac.map(f => f.width))
          const minH = min / Math.min(...frac.map(f => f.height))
          const p = canvas.posFromEvt(ev)
          canvas.clearSnapPoints()
          let dx = 0
          let dy = 0
          let sx: any = null
          let sy: any = null
          const { source, resizeX, resizeY } = resizeSource(handle, p, { x: bx, y: by, width: bw, height: bh })
          if (canvas.canSnap(ev)) {
            if (snapToObjects) {
              const src = collectSnapPoints([rectToBBox(source)])
              const dest = collectSnapPoints(canvas.getViewportNodes(true).map(n => rectToBBox(n)))
              const d = canvas.snapDistance
              if (resizeX && (sx = findSnap(src, dest, d, 'x'))) dx = sx.delta
              if (resizeY && (sy = findSnap(src, dest, d, 'y'))) dy = sy.delta
            }
            if (snapToGrid) {
              const g = canvas.gridSpacing
              if (resizeX && !sx) dx = Math.round(p.x / g) * g - p.x
              if (resizeY && !sy) dy = Math.round(p.y / g) * g - p.y
            }
          }
          const px = p.x + dx
          const py = p.y + dy
          if (handle.includes('top')) {
            box.minY = Math.min(box.maxY - minH, py)
            if (box.minY !== py) ((sy = null), (dy = box.minY - p.y))
          }
          if (handle.includes('left')) {
            box.minX = Math.min(box.maxX - minW, px)
            if (box.minX !== px) ((sx = null), (dx = box.minX - p.x))
          }
          if (handle.includes('bottom')) {
            box.maxY = Math.max(box.minY + minH, py)
            if (box.maxY !== py) ((sy = null), (dy = box.maxY - p.y))
          }
          if (handle.includes('right')) {
            box.maxX = Math.max(box.minX + minW, px)
            if (box.maxX !== px) ((sx = null), (dx = box.maxX - p.x))
          }
          const r = { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY }
          let keepRatio = nodes.some(n => n.aspectRatio)
          if (ev.shiftKey) keepRatio = !keepRatio
          let ratio = 0
          if (keepRatio && bh !== 0) ratio = bw / bh
          if (ratio !== 0) {
            let w = r.width
            let h = r.height
            if (resizeX && resizeY) {
              const nw = Math.max(w, h * ratio)
              h = Math.max(h, w / ratio)
              if ((w = nw) !== r.width) sx = null
              else if (h !== r.height) sy = null
            } else if (resizeX) h = w / ratio
            else if (resizeY) w = h * ratio
            if (handle.includes('left')) {
              const nx = bx + bw - w
              dx += nx - r.x
              r.x = nx
            }
            if (handle.includes('top')) {
              const ny = by + bh - h
              dy += ny - r.y
              r.y = ny
            }
            if (handle.includes('right')) dx += w - r.width
            if (handle.includes('bottom')) dy += h - r.height
            r.width = w
            r.height = h
          }
          if (sx || sy) canvas.renderSnapPoints(sx, sy, dx, dy)
          const nb = rectToBBox(r)
          nodes.forEach((n, i) => {
            const q = rel[i]
            n.moveAndResize(bboxToRect({ minX: nb.minX + q.minX * r.width, minY: nb.minY + q.minY * r.height, maxX: nb.maxX + q.maxX * r.width, maxY: nb.maxY + q.maxY * r.height }))
          })
        },
        end: () => canvas.requestSave(),
        cancel: () => {
          nodes.forEach((n, i) => n.moveAndResize(orig[i]))
          canvas.requestSave()
        },
        cleanup: () => {
          for (const n of nodes) n.nodeEl.removeClass('is-dragging')
        }
      })
    })
  }

  hide(): void {
    this.selectionEl.remove()
  }
}

/** The popover menu above the selection. */
export class CanvasSelectionMenu {
  canvas: Canvas
  containerEl: HTMLElement
  menuEl: HTMLElement
  selection: CanvasSelection

  constructor(canvas: Canvas) {
    this.canvas = canvas
    this.containerEl = createDiv('canvas-menu-container')
    this.menuEl = this.containerEl.createDiv('canvas-menu')
    this.selection = new CanvasSelection(canvas, 'mod-group-selection')
    const el = this.selection.selectionEl
    el.addEventListener('contextmenu', e => {
      this.canvas.onSelectionContextMenu(e)
      e.preventDefault()
    })
    el.addEventListener('pointerdown', e => {
      if (e.isPrimary && e.button === 0 && !e.defaultPrevented) startPointerDrag(e, () => this.canvas.handleSelectionDrag(e, el))
    })
  }

  render(rebuild: boolean): void {
    const { canvas, selection, containerEl, menuEl } = this
    const items = Array.from(canvas.selection) as Item[]
    if (items.length === 0) {
      containerEl.detach()
      menuEl.empty()
      selection.hide()
      return
    }
    items.sort(byZIndex)
    const single = items.length === 1
    const last = items[items.length - 1]
    const box = unionBBox(items.map(i => i.getBBox()))
    if (single) selection.hide()
    else selection.update(box)
    if (canvas.isDragging) {
      containerEl.detach()
      menuEl.empty()
      return
    }
    canvas.wrapperEl.append(containerEl)
    if (rebuild) this.build(items, single, last)
    this.position(items, single, last, box)
  }

  private button(parent: HTMLElement, label: string, icon: string, cb: (e: MouseEvent) => void, evenIfReadonly = false): void {
    if (this.canvas.readonly && !evenIfReadonly) return
    const b = parent.createEl('button', 'clickable-icon')
    setTooltip(b, label, { placement: 'top' })
    setIcon(b, icon)
    b.addEventListener('click', cb)
  }

  private build(items: Item[], single: boolean, last: Item): void {
    const { canvas, menuEl } = this
    menuEl.empty()
    let activeBtn: HTMLElement | null = null
    let submenu: HTMLElement | null = null
    let submenuType = ''
    this.button(menuEl, S.actionRemove, 'lucide-trash-2', () => canvas.deleteSelection())
    let current = (last as any).color as string
    this.button(menuEl, S.actionSetColor, 'lucide-palette', e => {
      const btn = e.currentTarget as HTMLElement
      if (submenu) {
        activeBtn!.removeClass('is-active')
        submenu.remove()
        submenu = null
        if (submenuType === 'color') return
      }
      activeBtn = btn
      btn.addClass('is-active')
      submenu = menuEl.createDiv('canvas-submenu')
      submenuType = 'color'
      const apply = (color: string, close = true) => {
        for (const it of items) it.setColor(color, !close)
        current = color
        if (close) {
          submenu!.remove()
          submenu = null
        }
        canvas.requestSave()
      }
      let matched = false
      const swatch = (color: string) => {
        const el = submenu!.createDiv('canvas-color-picker-item')
        if (current === color) {
          el.addClass('is-active')
          matched = true
        }
        if (color) el.addClass('mod-canvas-color-' + color)
        el.addEventListener('click', () => apply(color))
      }
      swatch('')
      for (let i = 1; i <= 6; i++) swatch(String(i))
      const custom = submenu.createDiv('canvas-color-picker-item canvas-color-picker-custom')
      const input = custom.createEl('input', { type: 'color' })
      custom.style.setProperty('--canvas-color', '#000000')
      if (!matched) {
        const c = parseColor(current)
        if (c) {
          input.value = toHex(c)
          custom.style.setProperty('--canvas-color', toHex(c))
          custom.addClass('is-active')
        }
      }
      input.addEventListener('change', () => apply(input.value))
      input.addEventListener('input', () => apply(input.value, false))
    })
    this.button(menuEl, S.actionZoomToSelection + `\n(${hotkeyLabel(['Shift'], '2')})`, 'zoom-to-selection', () => canvas.zoomToSelection(), true)
    if (!single && last instanceof CanvasNode)
      this.button(menuEl, S.actionCreateGroup, 'create-group', () => {
        const r = bboxToRect(expandBBox(unionBBox(Array.from(canvas.selection.values()).map(i => i.getBBox())), 20))
        canvas.createGroupNode({ pos: r, size: r })
      })
    if ((!single && last instanceof CanvasNode) || (single && last instanceof GroupNode)) {
      const targets = (): [CanvasNode[], BBox] => {
        if (single && last instanceof GroupNode) {
          const b = last.getBBox()
          return [canvas.getContainingNodes(b).filter(n => n !== last), expandBBox(b, -20)]
        }
        const nodes = items.filter(i => i instanceof CanvasNode) as CanvasNode[]
        return [nodes, unionBBox(nodes.map(n => n.getBBox()))]
      }
      this.button(menuEl, S.actionAlign, 'lucide-align-start-vertical', e => {
        const btn = e.currentTarget as HTMLElement
        if (btn.hasClass('has-active-menu')) return
        const r = btn.getBoundingClientRect()
        const m = new Menu().setUseNativeMenu(false)
        const add = (section: string, title: string, icon: string, fn: () => void) => m.addItem(i => i.setSection(section).setTitle(title).setIcon(icon).onClick(fn))
        add('align-h', S.actionAlignLeft, 'lucide-align-start-vertical', () => align(canvas, targets, 'left'))
        add('align-h', S.actionAlignCenter, 'lucide-align-center-vertical', () => align(canvas, targets, 'center'))
        add('align-h', S.actionAlignRight, 'lucide-align-end-vertical', () => align(canvas, targets, 'right'))
        add('align-v', S.actionAlignTop, 'lucide-align-start-horizontal', () => align(canvas, targets, 'top'))
        add('align-v', S.actionAlignMiddle, 'lucide-align-center-horizontal', () => align(canvas, targets, 'middle'))
        add('align-v', S.actionAlignBottom, 'lucide-align-end-horizontal', () => align(canvas, targets, 'bottom'))
        add('arrange', S.actionArrangeHorizontally, 'stack-horizontal', () => arrange(canvas, targets, 'horizontal'))
        add('arrange', S.actionArrangeVertically, 'stack-vertical', () => arrange(canvas, targets, 'vertical'))
        add('arrange', S.actionArrangeGrid, 'lucide-layout-grid', () => arrange(canvas, targets, 'grid'))
        add('distribute', S.actionDistributeHorizontalSpacing, 'distribute-space-horizontal', () => distribute(canvas, targets, 'horizontal'))
        add('distribute', S.actionDistributeVerticalSpacing, 'distribute-space-vertical', () => distribute(canvas, targets, 'vertical'))
        add('justify', S.actionJustifyHorizontally, 'stretch-horizontal', () => justify(canvas, targets, 'horizontal'))
        add('justify', S.actionJustifyVertically, 'stretch-vertical', () => justify(canvas, targets, 'vertical'))
        m.setParentElement(btn).showAtPosition({ x: r.x, y: r.bottom, width: r.width, overlap: true })
      })
    }
    if (last instanceof CanvasEdge && items.every(i => i instanceof CanvasEdge)) {
      const edges = items as CanvasEdge[]
      let icon = 'lucide-arrow-right'
      if (last.from.end === 'arrow') icon = 'lucide-move-horizontal'
      else if (last.to.end === 'none') icon = 'line-horizontal'
      this.button(menuEl, S.labelLineDirection, icon, e => {
        const btn = e.currentTarget as HTMLElement
        if (btn.hasClass('has-active-menu')) return
        const set = (fromEnd: 'none' | 'arrow', toEnd: 'none' | 'arrow') => {
          for (const ed of edges) {
            ed.from.end = fromEnd
            ed.to.end = toEnd
            canvas.markDirty(ed)
          }
          canvas.requestSave()
        }
        const r = btn.getBoundingClientRect()
        new Menu()
          .setUseNativeMenu(false)
          .addItem(i => i.setTitle(S.labelNondirectional).setIcon('line-horizontal').setChecked(icon === 'line-horizontal').onClick(() => set('none', 'none')))
          .addItem(i => i.setTitle(S.labelUnidirectional).setIcon('lucide-arrow-right').setChecked(icon === 'lucide-arrow-right').onClick(() => set('none', 'arrow')))
          .addItem(i => i.setTitle(S.labelBidirectional).setIcon('lucide-move-horizontal').setChecked(icon === 'lucide-move-horizontal').onClick(() => set('arrow', 'arrow')))
          .setParentElement(btn)
          .showAtPosition({ x: r.x, y: r.bottom, width: r.width, overlap: true })
      })
    }
    if (single && last instanceof CanvasEdge && last.labelElement) {
      const edge = last
      this.button(menuEl, S.actionRemoveLabel, 'lucide-x-square', () => {
        edge.setLabel('')
        edge.labelElement!.destroy()
        canvas.requestSave()
        this.render(true)
      })
    }
    if (!single) return
    if (last instanceof CanvasEdge) {
      this.button(menuEl, S.actionEditLabel, 'lucide-edit', () => last.editLabel())
    } else if (last instanceof CanvasNode && last.isEditable()) {
      const isGroup = last instanceof GroupNode
      this.button(menuEl, isGroup ? S.actionEditLabel : S.edit, 'lucide-edit', () => last.startEditing())
      if (last instanceof GroupNode) {
        const group = last
        this.button(menuEl, group.bgFile ? S.actionEditBackground : S.actionSetBackground, 'lucide-image', e => {
          const btn = e.currentTarget as HTMLElement
          if (btn.hasClass('has-active-menu')) return
          const pick = () =>
            new CanvasImageSuggestModal(canvas.app, f => {
              group.setBackgroundFile(f)
              canvas.requestSave()
              this.render(true)
            }).open()
          if (!group.bgPath) return pick()
          const style = (s: string) => {
            group.setBackgroundStyle(s)
            canvas.requestSave()
          }
          const r = btn.getBoundingClientRect()
          new Menu()
            .setUseNativeMenu(false)
            .addItem(i => i.setSection('image').setTitle(S.actionReplaceBackground).setIcon('lucide-repeat').onClick(pick))
            .addItem(i =>
              i
                .setSection('image')
                .setTitle(S.actionRemoveBackground)
                .setIcon('lucide-image-off')
                .onClick(() => {
                  group.setBackgroundFile(null)
                  canvas.requestSave()
                  this.render(true)
                })
            )
            .addItem(i => i.setSection('style').setTitle(S.optionBackgroundCover).setIcon('lucide-scaling').setChecked(!group.bgStyle || group.bgStyle === 'cover').onClick(() => style('cover')))
            .addItem(i => i.setSection('style').setTitle(S.optionBackgroundRatio).setIcon('aspect-ratio').setChecked(group.bgStyle === 'ratio').onClick(() => style('ratio')))
            .addItem(i => i.setSection('style').setTitle(S.optionBackgroundRepeat).setIcon('lucide-layout-grid').setChecked(group.bgStyle === 'repeat').onClick(() => style('repeat')))
            .setParentElement(btn)
            .showAtPosition({ x: r.x, y: r.bottom, width: r.width, overlap: true })
        })
      }
    }
  }

  private position(items: Item[], single: boolean, last: Item, box: BBox): void {
    const { canvas, containerEl, menuEl } = this
    const scale = canvas.scale
    const rect = canvas.canvasRect
    let x = (box.minX + box.maxX) / 2
    let y = box.minY - 10 / scale
    if (items.some(i => i instanceof GroupNode)) y = box.minY - 35 / Math.sqrt(scale)
    else if (last instanceof FileNode) y = box.minY - 30 / Math.sqrt(scale)
    if (last instanceof CanvasEdge && single) {
      const c = last.getCenter()
      const lh = last.labelElement?.wrapperEl.clientHeight || 20
      y = Math.min(y, c.y - 20 / scale - lh / 2)
    }
    const mr = menuEl.getBoundingClientRect()
    const w = mr.width
    const h = mr.height
    x = (x - canvas.x) * scale - w / 2 + rect.width / 2
    y = (y - canvas.y) * scale - h + rect.height / 2
    x = Math.clamp(x, 10, rect.width - w - 10)
    y = Math.clamp(y, 10, rect.height - h - 10)
    containerEl.setCssStyles({ left: `${x}px`, top: `${y}px` })
  }

  updateZIndex(z: number): void {
    this.containerEl.style.zIndex = String(z)
  }
}

type Targets = () => [CanvasNode[], BBox]

function align(canvas: Canvas, targets: Targets, how: string): void {
  const [nodes, b] = targets()
  for (const n of nodes) {
    if (how === 'left') n.moveTo({ x: b.minX, y: n.y })
    else if (how === 'right') n.moveTo({ x: b.maxX - n.width, y: n.y })
    else if (how === 'top') n.moveTo({ x: n.x, y: b.minY })
    else if (how === 'bottom') n.moveTo({ x: n.x, y: b.maxY - n.height })
    else if (how === 'center') n.moveTo({ x: (b.minX + b.maxX - n.width) / 2, y: n.y })
    else if (how === 'middle') n.moveTo({ x: n.x, y: (b.minY + b.maxY - n.height) / 2 })
  }
  canvas.requestSave()
}

function distribute(canvas: Canvas, targets: Targets, dir: 'horizontal' | 'vertical'): void {
  const [nodes, b] = targets()
  if (nodes.length <= 1) return
  if (dir === 'horizontal') {
    let total = 0
    for (const n of nodes) total += n.width
    nodes.sort((p, q) => (p.x !== q.x ? p.x - q.x : p.y - q.y))
    const gap = (b.maxX - b.minX - total) / (nodes.length - 1)
    for (let i = 1; i < nodes.length - 1; i++) {
      const prev = nodes[i - 1]
      nodes[i].moveTo({ x: prev.x + prev.width + gap, y: nodes[i].y })
    }
  } else {
    let total = 0
    for (const n of nodes) total += n.height
    nodes.sort((p, q) => (p.y !== q.y ? p.y - q.y : p.x - q.x))
    const gap = (b.maxY - b.minY - total) / (nodes.length - 1)
    for (let i = 1; i < nodes.length - 1; i++) {
      const prev = nodes[i - 1]
      nodes[i].moveTo({ x: nodes[i].x, y: prev.y + prev.height + gap })
    }
  }
  canvas.requestSave()
}

function justify(canvas: Canvas, targets: Targets, dir: 'horizontal' | 'vertical'): void {
  const [nodes, b] = targets()
  if (nodes.length <= 1) return
  for (const n of nodes) {
    if (dir === 'horizontal') n.moveAndResize({ x: b.minX, y: n.y, width: b.maxX - b.minX, height: n.height })
    else n.moveAndResize({ x: n.x, y: b.minY, width: n.width, height: b.maxY - b.minY })
  }
  canvas.requestSave()
}

function arrange(canvas: Canvas, targets: Targets, how: 'horizontal' | 'vertical' | 'grid'): void {
  const [nodes, b] = targets()
  if (nodes.length <= 1) return
  nodes.sort((p, q) => p.y - q.y)
  const rows: CanvasNode[][] = []
  let rowEnd = -Infinity
  for (const n of nodes) {
    if (n.y < rowEnd) {
      rows[rows.length - 1].push(n)
      const end = n.y + n.height
      if (end < rowEnd) rowEnd = end
    } else {
      rows.push([n])
      rowEnd = n.y + n.height
    }
  }
  for (const r of rows) r.sort((p, q) => p.x - q.x)
  const flat = ([] as CanvasNode[]).concat(...rows)
  let prev = flat[0]
  const gap = canvas.gridSpacing
  if (how === 'horizontal')
    for (let i = 1; i < flat.length; i++) {
      flat[i].moveTo({ x: prev.x + prev.width + gap, y: prev.y })
      prev = flat[i]
    }
  else if (how === 'vertical')
    for (let i = 1; i < flat.length; i++) {
      flat[i].moveTo({ x: prev.x, y: prev.y + prev.height + gap })
      prev = flat[i]
    }
  else {
    let y = b.minY
    for (const r of rows) {
      r[0].moveTo({ x: b.minX, y })
      let h = r[0].height
      for (let i = 1; i < r.length; i++) {
        const p = r[i - 1]
        r[i].moveTo({ x: p.x + p.width + gap, y })
        h = Math.max(h, r[i].height)
      }
      y += h + gap
    }
  }
  canvas.requestSave()
}

/** Resizers + connection points shown over the hovered card. */
export class NodeInteractionLayer {
  canvas: Canvas
  interactionEl: HTMLElement
  target: CanvasNode | null = null

  constructor(canvas: Canvas) {
    this.canvas = canvas
    const el = (this.interactionEl = createDiv('canvas-node-interaction-layer'))
    for (const side of SIDES) {
      const r = createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': side } })
      r.addEventListener('pointerdown', e => {
        if (e.target === r && e.pointerType === 'mouse') this.target?.onResizePointerdown(e, side)
      })
      r.addEventListener('click', e => this.target?.onClick(e))
      if (side === 'bottom' || side === 'right') r.addEventListener('dblclick', e => this.target?.onResizeDblclick(e, side))
      r.createDiv({ cls: 'canvas-node-connection-point', attr: { 'data-side': side } }).addEventListener('pointerdown', e => this.target?.onConnectionPointerdown(e, side as any))
      el.append(r)
    }
    for (const corner of CORNERS) {
      const r = createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': corner } })
      r.addEventListener('pointerdown', e => this.target?.onResizePointerdown(e, corner))
      r.addEventListener('click', e => this.target?.onClick(e))
      el.append(r)
    }
  }

  setTarget(node: CanvasNode | null): void {
    if (this.target === node) return
    this.target = node
    this.render()
  }

  render(): void {
    const { canvas, target, interactionEl } = this
    if (target) {
      if (!interactionEl.parentNode) canvas.canvasEl.appendChild(interactionEl)
    } else if (interactionEl.parentNode) interactionEl.detach()
    if (target)
      interactionEl.setCssStyles({ transform: `translate(${target.x}px, ${target.y}px)`, width: `${target.width}px`, height: `${target.height}px`, zIndex: String(canvas.zIndexCounter + 1) })
  }
}
