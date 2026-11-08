// Mount the graph (renderer + engine + controls) into an arbitrary element, without a workspace leaf.
// Used by the React shell until it switches to real workspace leaves; the DOM inside is the same as the views'
// `.view-content`.
import { Component } from '../../core/Component'
import { GraphRenderer } from './renderer'
import { GraphEngine, type GraphViewHost } from './GraphEngine'
import { createPixiScene } from './pixiBackend'
import { GraphPlugin, setActiveEmbeddedGraph } from './plugin'
import type { GraphOptions } from './options'
import './graph.css'

export interface EmbeddedGraphOptions {
  local?: boolean
  /** Global graph: persist options in <configDir>/graph.json through this plugin. */
  plugin?: GraphPlugin | null
  onOpenFile?: (path: string, newLeaf: boolean | string) => void
  onOpenSearch?: (query: string) => void
}

export class EmbeddedGraph extends Component {
  renderer: GraphRenderer
  engine: GraphEngine
  containerEl: HTMLElement
  localOptions: GraphOptions = {}
  private resizeObserver: ResizeObserver | null = null

  constructor(
    public app: any,
    parent: HTMLElement,
    public opts: EmbeddedGraphOptions = {}
  ) {
    super()
    this.containerEl = parent.createDiv('workspace-leaf-content')
    this.containerEl.setAttribute('data-type', opts.local ? 'localgraph' : 'graph')
    this.containerEl.style.height = '100%'
    const content = this.containerEl.createDiv('view-content')
    content.style.height = '100%'
    this.renderer = new GraphRenderer(content, { createScene: createPixiScene })
    const host: GraphViewHost = {
      app,
      containerEl: this.containerEl,
      isLocal: !!opts.local,
      registerEvent: r => this.registerEvent(r),
      registerDomEvent: (el, type, cb) => this.registerDomEvent(el, type, cb),
      registerInterval: id => this.registerInterval(id),
      onOptionsChange: () => this.onOptionsChange()
    }
    this.engine = new GraphEngine(app, host, this.renderer)
    this.engine.onOpenFile = opts.onOpenFile ?? null
    this.engine.onOpenSearch = opts.onOpenSearch ?? null
    // DevTools/testing handle (like a leaf's `.view`): containerEl.__graph
    Object.defineProperty(this.containerEl, '__graph', { value: this, configurable: true })
  }

  onload(): void {
    this.engine.load()
    if (this.app.metadataCache) this.registerEvent(this.app.metadataCache.on('resolved', () => this.engine.render()))
    const p = this.opts.plugin
    this.engine.setOptions(this.opts.local ? this.localOptions : p ? p.options : {})
    this.engine.requestUpdateSearch.run()
    this.engine.render()
    if (!this.opts.local) setActiveEmbeddedGraph(this.engine)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.renderer.onResize())
      this.resizeObserver.observe(this.containerEl)
    }
  }

  onunload(): void {
    this.resizeObserver?.disconnect()
    if (!this.opts.local) setActiveEmbeddedGraph(null)
    this.engine.requestUpdateSearch.cancel()
    this.engine.onOptionsChange.cancel()
    this.renderer.destroy()
    this.containerEl.detach()
  }

  /** Local graph: centre file (vault path) or null. */
  setLocalFile(path: string | null): void {
    if (this.engine.options.localFile !== path) this.renderer.resetPan()
    this.renderer.highlightNode = null
    this.engine.options.localFile = path
    this.engine.render()
  }

  setFocusFile(path: string | null): void {
    this.engine.onFileOpen(path ? { path } : null)
  }

  onOptionsChange(): void {
    if (!this._loaded) return
    if (this.opts.local) {
      this.localOptions = this.engine.getOptions()
      return
    }
    const p = this.opts.plugin
    if (!p) return
    p.options = this.engine.getOptions()
    p.saveOptions()
  }
}
