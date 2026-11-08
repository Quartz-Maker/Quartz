/* eslint-disable @typescript-eslint/no-explicit-any */
// Content-bearing card bases: `ContentNode` (breakpoint-mounted content) and `EmbedNode` (child component host), plus `NodeChild`.
import type { Point, Rect } from './geometry'
import { isEditableTarget } from './dom'
import { CanvasTextChild } from './textCard'
import { CanvasNode, nodeClasses } from './CanvasNodeBase'

/** Card whose content is hidden below the zoom breakpoint (placeholder icon instead). */
export abstract class ContentNode extends CanvasNode {
  isContentMounted = false
  alwaysKeepLoaded = false
  contentEl!: HTMLElement
  contentBlockerEl!: HTMLElement
  placeholderEl!: HTMLElement

  attach(): void {
    super.attach()
  }
  preDetach(): void {}
  detach(): void {
    if (!this.alwaysKeepLoaded) super.detach()
  }
  updateBreakpoint(visible: boolean): void {
    super.updateBreakpoint(visible)
    if (visible) this.mountContent()
    else this.unmountContent()
  }
  mountContent(): void {
    if (!this.initialized || this.isContentMounted) return
    const c = this.containerEl
    c.appendChild(this.contentEl)
    c.appendChild(this.contentBlockerEl)
    this.placeholderEl.detach()
    this.isContentMounted = true
  }
  unmountContent(): void {
    if (this.alwaysKeepLoaded || !this.initialized || !this.isContentMounted) return
    this.contentEl.detach()
    this.contentBlockerEl.detach()
    this.containerEl.appendChild(this.placeholderEl)
    this.isContentMounted = false
  }
  initialize(): void {
    super.initialize()
    this.contentEl = createDiv('canvas-node-content')
    this.contentBlockerEl = createDiv('canvas-node-content-blocker')
    this.placeholderEl = this.containerEl.createDiv('canvas-node-placeholder')
  }
}

/** Child components hosted by text and file cards. */
export interface NodeChild {
  load(): void
  unload(): void
  loadFile?(): Promise<void>
}

function isInteractiveTarget(e: MouseEvent): boolean {
  const active = (e.target as Node | null)?.ownerDocument?.activeElement
  if (active && active.closest('button, input')) return true
  if (isEditableTarget(e.target)) return true
  const t = e.target
  return t instanceof Element && !!t.closest('button, input, .collapse-indicator, .interactive-child')
}

/** Text and file cards: content is a child component; double click (or click on a text line) edits. */
export abstract class EmbedNode extends ContentNode {
  child: any = null
  resizeDirty = false
  labelEl: HTMLElement | null = null

  initialize(): void {
    super.initialize()
    this.containerEl.addEventListener('dblclick', e => {
      if (e.defaultPrevented) return
      const c = this.child
      if (c instanceof CanvasTextChild && !c.editMode && !isInteractiveTarget(e)) this.startEditing({ x: e.clientX, y: e.clientY })
    })
    // A single click on text of a focused card starts editing at that spot (no drag-selection, no shift).
    this.contentEl.addEventListener('click', e => {
      if (e.defaultPrevented || e.detail > 1 || e.shiftKey || this.destroyed || isInteractiveTarget(e)) return
      const c = this.child
      if (!(c instanceof CanvasTextChild) || c.editMode) return
      const sel = this.contentEl.ownerDocument.getSelection()
      if (sel && !sel.isCollapsed && sel.anchorNode && this.contentEl.contains(sel.anchorNode)) return
      const t = e.target
      if (!(t instanceof Element) || !Array.from(t.childNodes).some(n => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim())) return
      this.startEditing({ x: e.clientX, y: e.clientY })
    })
  }
  blur(): void {
    super.blur()
    const c = this.child
    if (c instanceof CanvasTextChild) {
      c.showPreview(true)
      c.applyScope(null)
    }
  }
  focus(): void {
    super.focus()
    const ws = this.app.workspace
    if (ws) ws.activeEditor = this.child instanceof CanvasTextChild ? this.child : null
    this.canvas.requestUpdateFileOpen(this instanceof nodeClasses.FileNode ? this.file : null)
  }
  destroy(): void {
    super.destroy()
    const c = this.child
    if (c instanceof CanvasTextChild) c.applyScope(null)
    this.unloadChild()
  }
  unloadChild(): void {
    this.aspectRatio = 0
    if (this.child) {
      this.child.unload()
      this.child = null
      this.alwaysKeepLoaded = false
    }
    if (this.contentEl) this.contentEl.empty()
    this.setIsEditing(false)
  }
  startEditing(pos?: Point): void {
    super.startEditing()
    const c = this.child
    if (!this.canvas.readonly && c instanceof CanvasTextChild) {
      c.showEditor(pos)
      this.setIsEditing(true)
    }
  }
  isEditable(): boolean {
    return this.child instanceof CanvasTextChild
  }
  onClick(e: MouseEvent): void {
    const c = this.child
    if (!this.canvas.readonly) this.setIsEditing(c instanceof CanvasTextChild ? !!c.editMode : false)
    super.onClick(e)
  }
  onResizeDblclick(e: MouseEvent, handle: string): void {
    e.preventDefault()
    const c = this.child
    if (!(c instanceof CanvasTextChild)) return
    const el = c.previewMode.renderer.previewEl as HTMLElement
    if (!el.isShown()) return
    if (handle === 'top' || handle === 'bottom') {
      for (let i = 0; i < 10; i++) {
        const before = el.clientHeight
        el.style.height = '1px'
        const sh = el.scrollHeight
        el.style.height = ''
        const delta = sh - before + 1
        if (Math.abs(delta) < 0.5) break
        this.resize({ width: this.width, height: this.height + delta })
        this.render()
        this.canvas.requestSave()
      }
      return
    }
    el.style.height = '1px'
    try {
      const target = el.scrollHeight + 0.1
      const orig = this.width
      let lo = 0
      let hi = orig
      for (let i = 0; i < 10; i++) {
        const mid = Math.round((lo + hi) / 2)
        this.resize({ width: mid, height: this.height })
        this.render()
        if (el.scrollHeight > target) lo = mid
        else hi = mid
        if (hi - lo < 1) break
      }
      this.resize({ width: hi, height: this.height })
      if (el.scrollHeight > target) {
        this.resize({ width: orig, height: this.height })
        this.render()
      } else this.canvas.requestSave()
    } finally {
      el.style.height = ''
    }
  }
  moveAndResize(r: Rect): void {
    if (this.child instanceof CanvasTextChild && (this.width !== r.width || this.height !== r.height)) this.resizeDirty = true
    super.moveAndResize(r)
  }
  render(): void {
    super.render()
    const c = this.child
    if (this.resizeDirty && c instanceof CanvasTextChild) c.previewMode.renderer.onResize()
    this.resizeDirty = false
  }

  /** `.canvas-node-label` above file / link cards (setting "Show card names"). */
  updateNodeLabel(text: string | DocumentFragment, onClick: (e: MouseEvent) => void, onDblClick: (e: MouseEvent) => void): void {
    const vis = this.canvas.options.cardLabelVisibility
    let el = this.labelEl
    if (vis === 'never') {
      if (el) {
        el.detach()
        this.labelEl = null
      }
      return
    }
    if (!el) {
      el = this.labelEl = this.nodeEl.createDiv('canvas-node-label')
      el.addEventListener('click', onClick)
      el.addEventListener('dblclick', onDblClick)
      el.addEventListener('pointerdown', this.onPointerdown.bind(this))
    }
    el.toggleClass('mod-hover-label', vis === 'hover')
    if (typeof text === 'string') el.setText(text)
    else {
      el.empty()
      el.appendChild(text)
    }
  }
}
