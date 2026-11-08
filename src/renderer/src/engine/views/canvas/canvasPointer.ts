/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas pointer and drag-gesture helpers: selection drag, pan-while-drag, temp-node drag.
// Bodies of Canvas methods (called with the canvas as `this`); the thin methods stay on the class.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { Platform } from '../../keymap/Platform'
import { Keymap } from '../../keymap/Keymap'
import { bboxFromPoints, bboxToRect, centeredAt, containsBBox, expandBBox, pt, rectToBBox, type Point, type Rect } from './geometry'
import { startPointerDrag, suppressNextEvent, type DragHandlers } from './dom'
import { CanvasNode, DummyNode, GroupNode } from './CanvasNode'
import { CanvasEdge } from './CanvasEdge'
import { CanvasSelection } from './CanvasMenu'
import { CanvasFileSuggestModal, CanvasUrlModal } from './modals'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { sameBox, webContents } from './canvasSupport'

export function onPriorityPointerdown(this: Canvas, e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return
  if (e.button === 1) {
    e.preventDefault()
    const start = this.posFromEvt(e)
    this.setDragging(true)
    startPointerDrag(
      e,
      () => ({
        move: ev => {
          const p = this.posFromEvt(ev)
          this.panBy(start.x - p.x, start.y - p.y)
        },
        end: ev => ev.preventDefault(),
        cleanup: () => this.setDragging(false)
      }),
      0
    )
  }
  if (e.button === 2 || (Platform.isMacOS && e.button === 1 && e.ctrlKey)) {
    e.preventDefault()
    const start = this.posFromEvt(e)
    startPointerDrag(e, () => {
      this.setDragging(true)
      return {
        move: ev => {
          const p = this.posFromEvt(ev)
          this.panBy(start.x - p.x, start.y - p.y)
        },
        cleanup: () => {
          suppressNextEvent(this.wrapperEl, 'contextmenu')
          this.setDragging(false)
        }
      }
    })
  }
}

export function interactionHitTest(this: Canvas, e: PointerEvent): void {
  this.pointer = this.posFromEvt(e)
  if (this.pointerFrame) return
  const win = (this.pointerFrameWin = this.canvasEl.ownerDocument.defaultView || window)
  this.pointerFrame = win.requestAnimationFrame(() => {
    this.pointerFrame = 0
    this.pointerFrameWin = null
    if (this.isDragging) return
    const hit = this.hitTestNode(this.pointer, 8 / this.scale)
    const layer = this.nodeInteractionLayer
    if (this.selection.size > 1 && hit && this.selection.has(hit)) layer.setTarget(null)
    else if (layer.target !== hit) layer.setTarget(hit)
  })
}

/** Rubber-band selection; with Mod held, the band becomes the size of a new card. */
export function handleDragToSelect(this: Canvas, e: PointerEvent, additive: boolean, prev: Set<CanvasNode | CanvasEdge>): DragHandlers {
  const start = this.posFromEvt(e)
  const band = new CanvasSelection(this)
  return this.handleDragWithPan(e, {
    move: ev => {
      const p = this.posFromEvt(ev)
      band.update(bboxFromPoints(start, p))
      const b = { minX: Math.min(start.x, p.x), minY: Math.min(start.y, p.y), maxX: Math.max(start.x, p.x), maxY: Math.max(start.y, p.y) }
      const hits = this.getIntersectingNodes(b).filter(n => !(n instanceof GroupNode) || containsBBox(b, n.getBBox()))
      let next = new Set<CanvasNode | CanvasEdge>(hits)
      if (additive) {
        const s = new Set(prev)
        next.forEach(n => (s.has(n) ? s.delete(n) : s.add(n)))
        next = s
      }
      this.selectAll(next)
    },
    end: (ev: any) => {
      if (Keymap.isModifier(ev, 'Mod')) {
        const r = bboxToRect(band.bbox)
        switch (this.view.plugin.options.defaultModDragBehavior) {
          case 'card':
            this.createTextNode({ pos: r, size: r })
            band.hide()
            break
          case 'note':
            new CanvasFileSuggestModal(this, f => {
              this.createFileNode({ pos: r, size: r, file: f })
              band.hide()
            })
              .showAttachments(false)
              .open()
            break
          case 'media':
            new CanvasFileSuggestModal(this, f => {
              this.createFileNode({ pos: r, size: r, file: f })
              band.hide()
            })
              .showMarkdownAndCanvas(false)
              .open()
            break
          case 'webpage':
            new CanvasUrlModal(this.app, '', url => {
              this.createLinkNode({ pos: r, size: r, url })
              band.hide()
            }).open()
            break
          case 'group':
            this.createGroupNode({ pos: r, size: r })
            band.hide()
            break
          default: {
            const menu = new Menu()
            this.showCreationMenu(menu, r, r)
            menu.onHide(() => band.hide())
            menu.showAtMouseEvent(ev)
          }
        }
      } else band.hide()
      suppressNextEvent(this.wrapperEl, 'click')
    },
    cancel: () => {
      this.selectAll(prev)
      band.hide()
    }
  })
}

export function onContextMenu(this: Canvas, e: MouseEvent): void {
  if (e.defaultPrevented || e.target !== this.wrapperEl || this.readonly) return
  e.preventDefault()
  this.deselectAll()
  const p = this.posFromEvt(e)
  const menu = new Menu()
  this.showCreationMenu(menu, p)
  menu.addSeparator()
  if (this.history.canUndo())
    menu.addItem(i =>
      i
        .setTitle(S.undo)
        .setSection('history')
        .setIcon('lucide-undo-2')
        .onClick(() => this.undo())
    )
  if (this.history.canRedo())
    menu.addItem(i =>
      i
        .setTitle(S.redo)
        .setSection('history')
        .setIcon('lucide-redo-2')
        .onClick(() => this.redo())
    )
  if (Platform.isDesktopApp)
    menu.addSeparator().addItem(i =>
      i
        .setTitle(S.paste)
        .setSection('clipboard')
        .setIcon('lucide-clipboard-check')
        .onClick(() => webContents()?.paste())
    )
  this.showQuickSettingsMenu(menu)
  menu.showAtMouseEvent(e)
}

/** Drag a card preview from the card menu; `place` receives the drop position (top-left). */
export function dragTempNode(this: Canvas, e: PointerEvent, size: { width: number; height: number }, place: (p: Point) => void): void {
  if (!e.isPrimary || e.button !== 0) return
  e.preventDefault()
  startPointerDrag(e, () => {
    const temp = new DummyNode(this)
    temp.resize(size)
    temp.attach()
    temp.nodeEl.addClass('is-dragging')
    return this.handleDragWithPan(e, {
      move: ev => {
        this.clearSnapPoints()
        const p = this.posFromEvt(ev)
        const r: Rect = { ...centeredAt(p, size), ...size }
        if (this.canSnap(ev)) {
          const s = this.getSnapping(
            [rectToBBox(r)],
            this.getViewportNodes()
              .filter(n => !(n instanceof GroupNode))
              .map(n => rectToBBox(n)),
            true,
            true
          )
          r.x += s.x
          r.y += s.y
        }
        temp.moveTo(r)
        temp.render()
      },
      end: ev => {
        if (this.posInViewport(this.domPosFromEvt(ev as MouseEvent))) place(pt(temp.x, temp.y))
      },
      cleanup: () => temp.detach()
    })
  })
}

/** Wraps drag handlers: auto-pan near the viewport edges, `is-dragging` state, snap guide cleanup. */
export function handleDragWithPan(this: Canvas, e: PointerEvent, h: DragHandlers): DragHandlers {
  const r = this.wrapperEl.getBoundingClientRect()
  this.setDragging(true)
  const win = (e.view as Window | null) || window
  let vx = 0
  let vy = 0
  let timer = 0
  return {
    ...h,
    move: ev => {
      const inner = expandBBox({ minX: r.left, minY: r.top, maxX: r.right, maxY: r.bottom }, -30)
      vx = 0
      vy = 0
      if (ev.clientX < inner.minX) vx = ev.clientX - inner.minX
      if (ev.clientX > inner.maxX) vx = ev.clientX - inner.maxX
      if (ev.clientY < inner.minY) vy = ev.clientY - inner.minY
      if (ev.clientY > inner.maxY) vy = ev.clientY - inner.maxY
      if (vx !== 0 || vy !== 0) {
        vx = Math.clamp(vx, -40, 40)
        vy = Math.clamp(vy, -40, 40)
        if (!timer)
          timer = win.setInterval(() => {
            const k = 0.5 / Math.sqrt(this.scale)
            this.panBy(vx * k, vy * k)
          }, 1000 / 60)
      } else if (timer) {
        win.clearInterval(timer)
        timer = 0
      }
      h.move?.(ev)
    },
    cleanup: () => {
      if (timer) {
        win.clearInterval(timer)
        timer = 0
      }
      this.endSnapPointRendering()
      this.setDragging(false)
      h.cleanup?.()
    }
  }
}

/** Move the selection (groups carry the cards they contain); Alt/Ctrl-drag clones. */
export function handleSelectionDrag(this: Canvas, e: PointerEvent, el: HTMLElement | null, node?: CanvasNode): DragHandlers | undefined {
  if (this.readonly) return
  const start = this.posFromEvt(e)
  if (node && !this.selection.has(node)) this.selectOnly(node)
  const moving = new Set<CanvasNode>()
  this.selection.forEach(i => {
    if (!(i instanceof CanvasNode)) return
    moving.add(i)
    if (i instanceof GroupNode) for (const n of this.getContainingNodes(i.getBBox())) moving.add(n)
  })
  const list = Array.from(moving)
  const origin = new WeakMap<CanvasNode, Point>()
  for (const n of list) {
    origin.set(n, pt(n.x, n.y))
    n.nodeEl.addClass('is-dragging')
    n.updateZIndex()
  }
  let active: CanvasNode[] = list
  let clones: DummyNode[] | null = null
  const checkClone = (ev: MouseEvent | KeyboardEvent) => {
    const cloning = Platform.isMacOS ? ev.altKey : ev.ctrlKey
    if (cloning && !clones) {
      active = clones = []
      for (const n of list) {
        const o = origin.get(n)!
        const c = new DummyNode(this)
        clones.push(c)
        origin.set(c, o)
        c.x = n.x
        c.y = n.y
        c.width = n.width
        c.height = n.height
        c.attach()
        c.render()
        c.nodeEl.addClass('is-dragging')
        n.moveTo(o)
      }
    } else if (!cloning && clones) {
      for (let i = 0; i < list.length; i++) {
        list[i].moveTo(clones[i])
        clones[i].detach()
      }
      clones = null
      active = list
    }
  }
  const at = (n: CanvasNode, d: Point): Rect => {
    const o = origin.get(n)!
    return { x: o.x + d.x, y: o.y + d.y, width: n.width, height: n.height }
  }
  const delta = (ev: MouseEvent): Point => {
    const p = this.posFromEvt(ev)
    const d = { x: p.x - start.x, y: p.y - start.y }
    if (ev.shiftKey) {
      if (Math.abs(d.x) > Math.abs(d.y)) d.y = 0
      else d.x = 0
    }
    if (!this.canSnap(ev)) return d
    const groups = active.filter(n => n instanceof GroupNode)
    let sources: CanvasNode[]
    if (groups.length === 0) sources = active
    else if (groups.length === 1) sources = groups
    else {
      sources = groups.slice()
      for (const g of groups) {
        const gb = g.getBBox()
        if (groups.some(o => o !== g && containsBBox(o.getBBox(), gb) && !sameBox(o.getBBox(), gb))) sources.remove(g)
      }
    }
    const set = new Set(active)
    const boxes = sources.map(n => rectToBBox(at(n, d)))
    const targets = this.getViewportNodes()
      .filter(n => !set.has(n) && groups.length > 0 === n instanceof GroupNode)
      .map(n => rectToBBox(n))
    const s = this.getSnapping(boxes, targets, d.x !== 0, d.y !== 0)
    return { x: d.x + s.x, y: d.y + s.y }
  }
  return this.handleDragWithPan(e, {
    move: ev => {
      this.clearSnapPoints()
      checkClone(ev)
      const d = delta(ev)
      for (const n of active) n.moveTo(at(n, d))
    },
    end: (ev: any) => {
      for (const n of list) n.nodeEl.removeClass('is-dragging')
      if (clones) {
        const d = delta(ev)
        const data = this.getSelectionData(moving as any)
        const added = this.importData(this.cloneData(data, d), false)
        this.clearSnapPoints()
        if (added) this.selectAll(added)
      }
      this.setDragging(false)
      this.requestSave()
    },
    cancel: () => {
      for (const n of list) {
        n.moveTo(origin.get(n)!)
        n.nodeEl.removeClass('is-dragging')
      }
    },
    cleanup: () => {
      if (clones) for (const c of clones) c.detach()
      if (el) suppressNextEvent(el, 'click')
    },
    keydown: ev => checkClone(ev),
    keyup: ev => checkClone(ev)
  })
}
