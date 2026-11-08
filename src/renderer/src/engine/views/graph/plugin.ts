// Graph core plugin (`graph` internal plugin): view types, commands, file-menu item, hover-link
// source, and the global graph options persisted in `<configDir>/graph.json`.
import { Keymap } from '../../keymap/Keymap'
import type { Command } from '../../commands/Commands'
import { GraphView, LocalGraphView, VIEW_TYPE_GRAPH, VIEW_TYPE_LOCAL_GRAPH, setGraphPluginInstance } from './GraphView'
import { serializeOptions, type GraphOptions } from './options'
import { S } from './strings'
import type { GraphEngine } from './GraphEngine'

/** Engines mounted outside the workspace (React shell host); `graph:animate` targets the active one. */
let embeddedEngine: GraphEngine | null = null
export function setActiveEmbeddedGraph(e: GraphEngine | null): void {
  embeddedEngine = e
}
export function getActiveEmbeddedGraph(): GraphEngine | null {
  return embeddedEngine
}

export class GraphPlugin {
  id = 'graph'
  name = S.name
  description = S.desc
  options: GraphOptions = {}
  app: any

  constructor(app: any) {
    this.app = app
  }

  get dataPath(): string {
    return (this.app.vault.configDir || '.quartz') + '/graph.json'
  }

  async loadData(): Promise<GraphOptions | null> {
    try {
      const text = await this.app.vault.adapter.read(this.dataPath)
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  async saveData(data: GraphOptions): Promise<void> {
    try {
      await this.app.vault.adapter.write(this.dataPath, serializeOptions(data))
    } catch (e) {
      console.error('Failed to save graph options', e)
    }
  }

  /** Registers the view types (call once per app). */
  registerViews(): void {
    const reg = this.app.viewRegistry
    if (!reg) return
    if (!reg.getViewCreatorByType(VIEW_TYPE_GRAPH)) reg.registerView(VIEW_TYPE_GRAPH, (leaf: any) => new GraphView(leaf))
    if (!reg.getViewCreatorByType(VIEW_TYPE_LOCAL_GRAPH)) reg.registerView(VIEW_TYPE_LOCAL_GRAPH, (leaf: any) => new LocalGraphView(leaf))
  }

  /** onEnable: file-menu item, options, hover source. */
  async enable(): Promise<void> {
    setGraphPluginInstance(this)
    this.registerViews()
    const ws = this.app.workspace
    if (ws) ws.on('file-menu', this.onFileMenu, this)
    this.options = (await this.loadData()) || {}
    ws?.registerHoverLinkSource?.('graph', { display: this.name, defaultMod: true })
  }

  disable(): void {
    this.app.workspace?.unregisterHoverLinkSource?.('graph')
    this.app.workspace?.off?.('file-menu', this.onFileMenu)
    setGraphPluginInstance(null)
  }

  async onExternalSettingsChange(): Promise<void> {
    this.options = (await this.loadData()) || {}
  }

  saveOptions(): void {
    void this.saveData(this.options)
  }

  onFileMenu(menu: any, file: any, source: string, leaf?: any): void {
    if (!file || file.extension !== 'md' || !leaf || source === 'sidebar-context-menu') return
    menu.addItem((i: any) =>
      i
        .setSection('view.linked')
        .setTitle(S.actionOpenLocal)
        .setIcon('lucide-git-fork')
        .onClick(async () => {
          await this.app.workspace.splitLeafOrActive(leaf, 'vertical').setViewState({ type: VIEW_TYPE_LOCAL_GRAPH, active: true, group: leaf, state: { file: file.path } })
        })
    )
  }

  openGraphView(evt?: any): void {
    void this.app.workspace.getLeaf(Keymap.isModEvent(evt ?? this.app.lastEvent)).setViewState({ type: VIEW_TYPE_GRAPH, active: true, state: {} })
  }

  openLocalGraph(checking: boolean): boolean | void {
    const ws = this.app.workspace
    const file = ws.getActiveFile()
    if (!file) return
    if (!checking) {
      const source = ws.activeLeaf
      void ws.splitActiveLeaf('vertical').setViewState({ type: VIEW_TYPE_LOCAL_GRAPH, active: true, group: source, state: { file: file.path } })
    }
    return true
  }
}

export interface GraphCommandFallbacks {
  /** React shell: open the graph tab when there's no workspace. */
  openGraph?: () => void
  /** React shell: is a graph tab active (for graph:animate)? */
  isGraphActive?: () => boolean
}

/** `graph:open` (Mod+G), `graph:open-local`, `graph:animate` with their names/icons/flags. */
export function graphCommands(getApp: () => any, getPlugin: () => GraphPlugin | null, fb: GraphCommandFallbacks = {}): Command[] {
  const hasWorkspace = () => !!getApp()?.workspace && !!getPlugin()
  return [
    {
      id: 'graph:open',
      name: 'Graph view: ' + S.actionOpen,
      icon: 'lucide-git-fork',
      callback: () => {
        if (hasWorkspace()) getPlugin()!.openGraphView()
        else fb.openGraph?.()
      },
      hotkeys: [{ modifiers: ['Mod'], key: 'G' }] as any
    },
    {
      id: 'graph:open-local',
      name: 'Graph view: ' + S.actionOpenLocal,
      icon: 'lucide-git-fork',
      checkCallback: (checking: boolean) => {
        if (!hasWorkspace()) return false
        return getPlugin()!.openLocalGraph(checking)
      }
    },
    {
      id: 'graph:animate',
      name: 'Graph view: ' + S.actionTimelapse,
      icon: 'lucide-wand',
      checkCallback: (checking: boolean) => {
        const app = getApp()
        if (hasWorkspace()) {
          const v = app.workspace.getActiveViewOfType(GraphView)
          if (!v) return
          if (!checking) void v.dataEngine.renderProgression()
          return true
        }
        const e = embeddedEngine
        if (!e || (fb.isGraphActive && !fb.isGraphActive())) return false
        if (!checking) void e.renderProgression()
        return true
      }
    }
  ]
}

const plugins = new WeakMap<object, Promise<GraphPlugin>>()
/** One enabled graph plugin per app (options loaded from graph.json). */
export function getGraphPlugin(app: any): Promise<GraphPlugin> {
  let p = plugins.get(app)
  if (!p) {
    const plugin = new GraphPlugin(app)
    p = plugin.enable().then(() => plugin)
    plugins.set(app, p)
  }
  return p
}
