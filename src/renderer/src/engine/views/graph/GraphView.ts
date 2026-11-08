// Graph views on the workspace: `graph` (global, ItemView) and `localgraph` (follows the active file / linked
// leaf, options in the leaf state).
import { ItemView, type ViewStateResult } from '../../view/View'
import { FileView } from '../../view/FileView'
import { Menu } from '../../workspace/Menu'
import { notice } from '../../workspace/AppLike'
import { debounce } from '../../vault/debounce'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { GraphRenderer, type GraphRendererOptions } from './renderer'
import { GraphEngine, setGraphMenuClass } from './GraphEngine'
import { createPixiScene } from './pixiBackend'
import { S } from './strings'
import type { GraphOptions } from './options'
import './graph.css'

export const VIEW_TYPE_GRAPH = 'graph'
export const VIEW_TYPE_LOCAL_GRAPH = 'localgraph'

setGraphMenuClass(Menu)

/** Renderer construction options used by the views (PIXI scene; overridable in tests). */
export let graphRendererOptions: () => GraphRendererOptions = () => ({ createScene: createPixiScene })
export function setGraphRendererOptions(fn: () => GraphRendererOptions): void {
  graphRendererOptions = fn
}

/** The graph plugin instance the global view reads/writes options through. */
export interface GraphPluginLike {
  options: GraphOptions
  saveOptions(): void
}
let pluginRef: GraphPluginLike | null = null
export function setGraphPluginInstance(p: GraphPluginLike | null): void {
  pluginRef = p
}
function graphPlugin(app: any): GraphPluginLike | null {
  return app.internalPlugins?.getPluginById?.('graph')?.instance ?? pluginRef
}

async function copyScreenshot(app: any, renderer: GraphRenderer): Promise<void> {
  try {
    const canvas = renderer.getTransparentScreenshot()
    await GraphRenderer.copyToClipboard(canvas, 'image/png')
    notice(app, S.msgScreenshotCopied)
  } catch (e) {
    notice(app, String(e))
  }
}

export class GraphView extends ItemView {
  renderer: GraphRenderer
  dataEngine: GraphEngine
  icon = 'lucide-git-fork'
  navigation = true

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.icon = 'lucide-git-fork'
    this.navigation = true
    const r = (this.renderer = new GraphRenderer(this.contentEl, graphRendererOptions()))
    this.dataEngine = new GraphEngine(this.app, this.host(), r)
  }

  private host() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const view = this
    return {
      get app() {
        return view.app
      },
      get leaf() {
        return view.leaf
      },
      get containerEl() {
        return view.containerEl
      },
      isLocal: false,
      registerEvent: (r: any) => view.registerEvent(r),
      registerDomEvent: (el: any, type: string, cb: any) => view.registerDomEvent(el, type, cb),
      registerInterval: (id: number) => view.registerInterval(id),
      onOptionsChange: () => view.onOptionsChange()
    }
  }

  getViewType(): string {
    return VIEW_TYPE_GRAPH
  }

  getDisplayText(): string {
    return S.name
  }

  onload(): void {
    super.onload()
    this.registerEvent((this.app as any).metadataCache.on('resolved', this.update, this))
    this.dataEngine.load()
    const p = graphPlugin(this.app)
    this.dataEngine.setOptions(p ? p.options : {})
    this.dataEngine.requestUpdateSearch.run()
    this.update()
  }

  protected async onClose(): Promise<void> {
    this.renderer.destroy()
  }

  onResize(): void {
    this.renderer.onResize()
  }

  showSearch(): void {
    const f = this.dataEngine.filterOptions
    this.dataEngine.controlsEl.removeClass('is-close')
    void f.setCollapsed(false, true)
    f.search.autoSelect()
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    menu.addItem(i =>
      i
        .setSection('action')
        .setTitle(S.actionCopyScreenshot)
        .setIcon('lucide-image')
        .onClick(() => copyScreenshot(this.app, this.renderer))
    )
  }

  update(): void {
    this.dataEngine.render()
  }

  onOptionsChange(): void {
    if (!(this as any)._loaded) return
    const p = graphPlugin(this.app)
    if (!p) return
    p.options = this.dataEngine.getOptions()
    p.saveOptions()
  }
}

export class LocalGraphView extends FileView {
  renderer: GraphRenderer
  engine: GraphEngine
  renderedFile: any = null
  icon = 'lucide-git-fork'
  navigation = false
  allowNoFile = true
  requestUpdate = debounce(() => this.update(), 10)

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.icon = 'lucide-git-fork'
    this.navigation = false
    this.allowNoFile = true
    const r = (this.renderer = new GraphRenderer(this.contentEl, graphRendererOptions()))
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const view = this
    this.engine = new GraphEngine(
      this.app,
      {
        get app() {
          return view.app
        },
        get leaf() {
          return view.leaf
        },
        get containerEl() {
          return view.containerEl
        },
        isLocal: true,
        registerEvent: (x: any) => view.registerEvent(x),
        registerDomEvent: (el: any, type: string, cb: any) => view.registerDomEvent(el, type, cb),
        registerInterval: (id: number) => view.registerInterval(id),
        onOptionsChange: () => view.onOptionsChange()
      },
      r
    )
  }

  get isLeafBoundToFile(): boolean {
    return this.leaf.pinned || !!this.leaf.group
  }

  getViewType(): string {
    return VIEW_TYPE_LOCAL_GRAPH
  }

  getDisplayText(): string {
    return this.file && this.isLeafBoundToFile ? S.tabTitle(super.getDisplayText()) : S.localName
  }

  canAcceptExtension(_ext: string): boolean {
    return true
  }

  getState(): Record<string, unknown> {
    const s = super.getState()
    s.options = this.engine.getOptions()
    return s
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    if (state && !Object.prototype.hasOwnProperty.call(state, 'group') && !this.leaf.pinned) {
      const active = this.leaf.workspace.getActiveFile()
      if (active) state.file = active.path
    }
    if (state?.options) this.engine.setOptions(state.options)
    await super.setState(state, result)
  }

  load(): void {
    super.load()
    const ws = this.app.workspace
    this.registerEvent(ws.on('file-open', this.onFileOpen, this))
    ws.onLayoutReady(() => this.onFileOpen(ws.getActiveFile()))
    this.registerEvent((this.app as any).metadataCache.on('resolved', this.update, this))
    this.engine.load()
  }

  async onLoadFile(file: any): Promise<void> {
    await super.onLoadFile(file)
    this.update()
  }

  async onUnloadFile(file: any): Promise<void> {
    this.requestUpdate()
    return super.onUnloadFile(file)
  }

  onFileOpen(file: any): void {
    if (this.isLeafBoundToFile) return
    void this.loadFile(file && file.extension !== undefined ? file : null)
  }

  onGroupChange(): void {
    super.onGroupChange()
    const leaf = this.leaf
    if (leaf.group) {
      for (const other of leaf.workspace.getGroupLeaves(leaf.group)) {
        if (other !== leaf && other.view instanceof FileView) {
          void leaf.openFile(other.view.file as any)
          break
        }
      }
    } else void this.loadFile(leaf.workspace.getActiveFile())
  }

  protected async onClose(): Promise<void> {
    this.renderer.destroy()
    await super.onClose()
  }

  onFileChanged(file: any): void {
    if (file === this.file) this.requestUpdate()
  }

  onResize(): void {
    this.renderer.onResize()
  }

  update(): void {
    const f = this.file
    if (this.renderedFile !== f) {
      this.renderer.resetPan()
      this.renderedFile = f
    }
    this.renderer.highlightNode = null
    this.engine.options.localFile = f ? f.path : null
    this.engine.render()
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    menu.addItem(i =>
      i
        .setSection('action')
        .setTitle(S.actionCopyScreenshot)
        .setIcon('lucide-image')
        .onClick(() => copyScreenshot(this.app, this.renderer))
    )
  }

  onOptionsChange(): void {
    this.app.workspace.requestSaveLayout?.()
  }
}
