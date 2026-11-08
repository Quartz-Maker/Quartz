/* eslint-disable @typescript-eslint/no-explicit-any */
// The `canvas` view (TextFileView, extension `canvas`): file text ⇄ canvas data, view state (viewport),
// read-only per-file local data, canvas shortcuts in the view scope.
import { TextFileView } from '../../view/FileView'
import { Scope, Keymap } from '../../keymap/Keymap'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { Canvas } from './Canvas'
import { stringifyCanvas } from './json'
import { isEditableTarget } from './dom'
import { S } from './strings'
import { TextNode } from './CanvasNode'
import type { CanvasPlugin } from './plugin'
import './canvas.css'

export const VIEW_TYPE_CANVAS = 'canvas'

/** Registers Mod+Z / Mod+A / Mod+Shift+Z / Mod+Y / Shift+1 / Shift+2 / arrow nudges on `scope`. */
export function registerCanvasKeys(scope: Scope, canvas: () => Canvas): void {
  scope.register(['Mod'], 'Z', e => {
    if (isEditableTarget(e.target)) return
    e.preventDefault()
    canvas().undo()
    return false
  })
  scope.register(['Mod'], 'A', e => {
    if (isEditableTarget(e.target)) return
    canvas().selectAll()
    return false
  })
  const redo = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return
    e.preventDefault()
    canvas().redo()
    return false
  }
  scope.register(['Mod', 'Shift'], 'Z', redo)
  scope.register(['Mod'], 'Y', redo)
  scope.register(['Shift'], '1', e => {
    if (isEditableTarget(e.target)) return
    canvas().zoomToFit()
    return false
  })
  scope.register(['Shift'], '2', e => {
    if (isEditableTarget(e.target)) return
    canvas().zoomToSelection()
    return false
  })
  const dirs: [string, 'right' | 'left' | 'up' | 'down'][] = [
    ['ArrowRight', 'right'],
    ['ArrowLeft', 'left'],
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down']
  ]
  for (const [key, dir] of dirs) {
    for (const mods of [[], ['Shift']] as any[]) {
      scope.register(mods, key, e => {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        canvas().nudgeSelection(e, dir)
        return false
      })
    }
  }
}

/**
 * While focus is inside the canvas, its scope is the active keymap scope; clipboard events on the
 * wrapper go to the canvas.
 */
export function bindCanvasHostEvents(canvas: Canvas, scope: Scope, host: { handleCut(e: ClipboardEvent): void; handleCopy(e: ClipboardEvent): void; handlePaste(e: ClipboardEvent): void }): void {
  const wrap = canvas.wrapperEl
  const km = () => canvas.app?.keymap ?? Keymap.init()
  let pushed = false
  wrap.addEventListener('focusin', () => {
    if (pushed) return
    km().pushScope(scope)
    pushed = true
  })
  wrap.addEventListener('focusout', (e: FocusEvent) => {
    if (!pushed || (e.relatedTarget instanceof Node && wrap.contains(e.relatedTarget))) return
    km().popScope(scope)
    pushed = false
  })
  wrap.addEventListener('cut', e => host.handleCut(e))
  wrap.addEventListener('copy', e => host.handleCopy(e))
  wrap.addEventListener('paste', e => host.handlePaste(e))
}

export class CanvasView extends TextFileView {
  icon = 'lucide-layout-dashboard'
  hoverPopover: any = null
  isPlaintext = false
  plugin: CanvasPlugin
  canvas: Canvas
  scope: Scope

  constructor(leaf: WorkspaceLeaf, plugin: CanvasPlugin) {
    super(leaf)
    this.icon = 'lucide-layout-dashboard'
    this.isPlaintext = false
    this.plugin = plugin
    this.canvas = new Canvas(this as any)
    this.scope = new Scope((this.app as any).scope)
    registerCanvasKeys(this.scope, () => this.canvas)
    bindCanvasHostEvents(this.canvas, this.scope, this as any)
  }

  getViewType(): string {
    return VIEW_TYPE_CANVAS
  }
  canAcceptExtension(ext: string): boolean {
    return ext === 'canvas'
  }

  async setState(state: any, result: any): Promise<void> {
    await super.setState(state, result)
    if (state?.viewState) this.canvas.setState(state.viewState)
  }
  getState(): Record<string, unknown> {
    const s = super.getState()
    s.viewState = this.canvas.getState()
    return s
  }
  setEphemeralState(state: any): void {
    super.setEphemeralState(state)
    if (state?.focus) this.canvas.wrapperEl.focus({ preventScroll: true })
    if (state?.match !== undefined) {
      const c = this.canvas
      const { nodeId } = state.match
      const node = nodeId && c.nodes.get(nodeId)
      if (node) {
        c.selectOnly(node)
        c.panIntoView(node.getBBox())
        if (node instanceof TextNode && node.child && state.match.matches?.length > 0) {
          const off = state.match.matches[0][0]
          const line = (state.match.content as string).slice(0, off).split('\n').length - 1
          node.child.previewMode.renderer.applyScrollDelayed?.(line, { center: true, highlight: true })
        }
      }
    }
  }
  onResize(): void {
    this.canvas.onResize()
  }

  getViewData(): string {
    return stringifyCanvas(this.canvas.data) ?? ''
  }
  setViewData(data: string, clear: boolean): void {
    const c = this.canvas
    if (clear) this.clear()
    if (data) {
      c.setData(JSON.parse(data))
      if (clear) {
        c.zoomToFitQueued = true
        c.onResize()
      }
    } else {
      c.createPlaceholder()
      c.requestFrame()
    }
    if (clear) {
      const local = this.getLocalData()
      if (local && typeof local.readonly === 'boolean') c.setReadonly(local.readonly)
    }
  }
  clear(): void {
    this.canvas.clear()
  }

  protected async onOpen(): Promise<void> {
    this.canvas.load()
    await super.onOpen()
  }
  protected async onClose(): Promise<void> {
    await super.onClose()
    this.canvas.unload()
  }

  handleCut(e: ClipboardEvent): void {
    this.canvas.handleCut(e)
  }
  handleCopy(e: ClipboardEvent): void {
    this.canvas.handleCopy(e)
  }
  handlePaste(e: ClipboardEvent): void {
    this.canvas.handlePaste(e)
  }

  onPaneMenu(menu: any, source: string): void {
    super.onPaneMenu(menu, source)
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle(S.actionExportPng)
        .setIcon('lucide-image')
        .onClick(() => void this.canvas.generateHDImage())
    )
  }

  getLocalData(): any {
    return this.plugin.localData.load(this.file)
  }
  saveLocalData(): void {
    let d: any = {}
    if (this.canvas.readonly) d.readonly = true
    if (Object.keys(d).length === 0) d = null
    this.plugin.localData.save(this.file, d)
  }
}
