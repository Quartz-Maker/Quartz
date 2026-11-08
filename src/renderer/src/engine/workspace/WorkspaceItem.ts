// WorkspaceItem / WorkspaceParent — base of the layout tree (plugin API names).
// Every item owns a real `containerEl` whose first child is `hr.workspace-leaf-resize-handle`.
import { Events } from '../core/Events'
import { Component } from '../core/Component'
import { genId } from './util'
import type { AppLike } from './AppLike'
import type { Workspace } from './Workspace'

export interface SerializedItem {
  id: string
  type: string
  dimension?: number
  [key: string]: unknown
}

export abstract class WorkspaceItem extends Events {
  app: AppLike
  workspace: Workspace
  id: string
  type = 'item'
  parent: WorkspaceParent | null = null
  containerEl: HTMLElement
  resizeHandleEl: HTMLElement
  /** Percentage of the parent split (null = flex default). */
  dimension: number | null = null
  component = new Component()

  constructor(workspace: Workspace, id?: string | null) {
    super()
    this.app = workspace.app
    this.workspace = workspace
    this.id = id || genId(16)
    const el = (this.containerEl = createDiv())
    const handle = (this.resizeHandleEl = el.createEl('hr', 'workspace-leaf-resize-handle tappable'))
    handle.setAttr('data-ignore-swipe', true)
    handle.addEventListener('pointerdown', this.onResizeStart.bind(this))
    // Double-click a handle: reset all siblings to equal size.
    handle.addEventListener('dblclick', () => {
      const p = this.parent as any
      if (p?.isSplit) {
        for (const c of p.children as WorkspaceItem[]) c.setDimension(null)
        this.workspace.requestSaveLayout()
        this.workspace.requestResize()
      }
    })
    this.component.load()
  }

  get parentSplit(): WorkspaceParent | null {
    return this.parent
  }

  serialize(): SerializedItem {
    const out: SerializedItem = { id: this.id, type: this.type }
    if (this.dimension) out.dimension = this.dimension
    return out
  }

  onResizeStart(evt: PointerEvent): void {
    if (evt.button !== 0) return
    const p = this.parent as any
    if (p && typeof p.onChildResizeStart === 'function') {
      this.resizeHandleEl.addClass('is-active')
      document.body.addClass('is-grabbing')
      p.onChildResizeStart(this, evt)
    }
  }

  setParent(parent: WorkspaceParent | null): void {
    this.parent = parent
  }

  getRoot(): WorkspaceItem {
    let item: WorkspaceItem = this
    while (item.parent) item = item.parent
    return item
  }

  getContainer(): any {
    let item: WorkspaceItem = this
    while (item.parent) {
      if ((item as any).isContainer) return item
      item = item.parent
    }
    return (item as any).isContainer ? item : this.workspace.rootSplit
  }

  setDimension(dim: number | null): void {
    if (dim !== null && (dim <= 0 || dim >= 100)) dim = null
    this.dimension = dim
    this.containerEl.style.flexGrow = dim ? String(dim) : ''
  }

  detach(): void {
    this.parent?.removeChild(this)
  }

  getIcon(): string {
    return 'lucide-file'
  }

  /** Recompute sizes/visibility after a structural change (overridden). */
  recomputeChildrenDimensions(): void {}
}

export abstract class WorkspaceParent extends WorkspaceItem {
  children: WorkspaceItem[] = []
  /** When false, a parent left with one child is replaced by that child. */
  allowSingleChild = false
  /** When false, the subclass places children's DOM itself (tabs, floating). */
  autoManageDOM = true

  serialize(): SerializedItem {
    const out = super.serialize()
    out.children = this.children.map(c => c.serialize())
    return out
  }

  replaceChild(index: number, child: WorkspaceItem): void {
    const kids = this.children
    if (index < 0) index = 0
    if (index >= kids.length) index = kids.length
    const old = kids[index]
    const next = old.containerEl.nextSibling
    if (this.autoManageDOM) old.containerEl.detach()
    old.setParent(null)
    kids[index] = child
    if (this.autoManageDOM) this.containerEl.insertBefore(child.containerEl, next)
    child.setParent(this)
    this.workspace.onLayoutChange(this)
  }

  insertChild(index: number, child: WorkspaceItem): void {
    const kids = this.children
    if (index < 0 || index >= kids.length) index = kids.length
    const before = kids[index]
    kids.splice(index, 0, child)
    if (this.autoManageDOM) this.containerEl.insertBefore(child.containerEl, before ? before.containerEl : null)
    child.setParent(this)
    this.workspace.onLayoutChange(this)
  }

  removeChild(child: WorkspaceItem): void {
    const kids = this.children
    kids.remove(child)
    child.setParent(null)
    if (this.autoManageDOM) child.containerEl.detach()
    const parent = this.parent
    if (parent) {
      if (kids.length === 1 && !this.allowSingleChild) {
        // Collapse: replace this parent by its only child.
        const only = kids[0]
        kids.remove(only)
        if (this.autoManageDOM) only.containerEl.detach()
        only.setParent(null)
        const at = parent.children.indexOf(this)
        if (this.autoManageDOM) parent.replaceChild(at, only)
        only.setDimension(this.dimension)
      } else if (kids.length === 0) {
        parent.removeChild(this)
        return
      }
    }
    this.workspace.onLayoutChange(this)
  }
}
