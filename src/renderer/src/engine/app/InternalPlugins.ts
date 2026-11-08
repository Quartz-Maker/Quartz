/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.internalPlugins` — the core-plugin registry.
//  - plugins register in a fixed order (CORE_PLUGIN_ORDER);
//  - `core-plugins.json` is `{id: enabled}`; a missing key → the plugin's `defaultOn` + save;
//    unknown keys are preserved on save; the legacy array format is migrated;
//  - each plugin is wrapped in an `InternalPlugin` Component: views, commands, ribbon icons,
//    status bar items and events registered while enabled are removed again on disable.
import { Component } from '../core/Component'
import { Events } from '../core/Events'
import type { Command } from '../commands/Commands'

/** Core plugin registration order. */
export const CORE_PLUGIN_ORDER = [
  'file-explorer', 'global-search', 'switcher', 'graph', 'backlink', 'canvas', 'outgoing-link', 'tag-pane',
  'footnotes', 'properties', 'page-preview', 'daily-notes', 'templates', 'note-composer', 'command-palette',
  'slash-command', 'editor-status', 'bookmarks', 'zk-prefixer', 'random-note', 'outline', 'word-count',
  'slides', 'audio-recorder', 'workspaces', 'file-recovery', 'publish', 'sync', 'bases', 'webviewer'
] as const

/** `instance.options` defaults set in each plugin's constructor. */
export const CORE_OPTION_DEFAULTS: Record<string, Record<string, unknown>> = {
  'global-search': {},
  switcher: { showExistingOnly: false, showAttachments: true, showAllFileTypes: false },
  graph: {},
  backlink: {},
  canvas: { snapToObjects: true, snapToGrid: true },
  'page-preview': {},
  'daily-notes': {},
  templates: {},
  'note-composer': { askBeforeMerging: true },
  'command-palette': {},
  'zk-prefixer': {},
  'file-recovery': { intervalMinutes: 5, keepDays: 7 },
  webviewer: { openExternalURLs: true, enableAdblocking: true }
}

/** Plugin definition (the internal plugin "instance"). */
export interface CorePluginDef {
  id: string
  name: string
  description: string
  defaultOn?: boolean
  hiddenFromList?: boolean
  /** Called once when the plugin is loaded (registered), enabled or not. */
  init?(app: any, plugin: InternalPlugin): void
  /** Called on every enable (startup or user toggle). Registrations go through `plugin`. */
  onEnable?(app: any, plugin: InternalPlugin): void | Promise<void>
  onDisable?(app: any, plugin: InternalPlugin): void
  /** Only when the user turns the plugin on in settings (e.g. re-create its side leaf). */
  onUserEnable?(app: any, plugin: InternalPlugin): void
  onUserDisable?(app: any, plugin: InternalPlugin): void
  [k: string]: any
}

export class InternalPlugin extends Component {
  app: any
  manager: InternalPlugins
  instance: CorePluginDef
  enabled = false
  hasStatusBarItem = false
  statusBarEl: HTMLElement | null = null
  ribbonItems: { id: string; el: HTMLElement }[] = []
  views: string[] = []
  commands: string[] = []

  constructor(app: any, manager: InternalPlugins, instance: CorePluginDef) {
    super()
    this.app = app
    this.manager = manager
    this.instance = instance
    // Option defaults are set in each plugin's constructor, so they exist before the plugin is enabled
    const dflt = CORE_OPTION_DEFAULTS[instance.id]
    if (dflt && (instance as any).options === undefined) (instance as any).options = { ...dflt }
  }

  get id(): string {
    return this.instance.id
  }

  async loadData(): Promise<any> {
    return this.app.vault.readConfigJson(this.instance.id)
  }

  /** `instance.options` = constructor defaults overlaid with `<configDir>/<id>.json` (loadData). */
  async loadOptions(): Promise<void> {
    const dflt = CORE_OPTION_DEFAULTS[this.id]
    if (!dflt || this.optionsLoaded) return
    this.optionsLoaded = true
    let data: any = null
    try {
      data = await this.loadData()
    } catch {
      data = null
    }
    const opts = Object.assign({}, dflt, data && typeof data === 'object' && !Array.isArray(data) ? data : {})
    this.instance.options = Object.assign(this.instance.options ?? {}, opts)
  }
  optionsLoaded = false

  async saveData(data: unknown): Promise<void> {
    await this.app.vault.writeConfigJson(this.instance.id, data)
  }

  async enable(user = false): Promise<void> {
    if (this.enabled) return
    this.enabled = true
    this.load()
    try {
      await this.loadOptions()
      await this.instance.onEnable?.(this.app, this)
      if (user) this.instance.onUserEnable?.(this.app, this)
    } catch (e) {
      console.error(`Failed to enable core plugin "${this.id}"`, e)
    }
    this.manager.trigger('change', this)
  }

  disable(user = false): void {
    if (!this.enabled) return
    this.enabled = false
    try {
      if (user) this.instance.onUserDisable?.(this.app, this)
      this.instance.onDisable?.(this.app, this)
    } catch (e) {
      console.error(e)
    }
    this.unload()
    this.manager.trigger('change', this)
  }

  onunload(): void {
    const ws = this.app.workspace
    for (const type of this.views) {
      ws?.detachLeavesOfType?.(type)
      this.app.viewRegistry.unregisterView(type)
    }
    this.views = []
    for (const id of this.commands) this.app.commands.removeCommand(id)
    this.commands = []
    for (const r of this.ribbonItems) {
      ws?.leftRibbon.removeRibbonAction(r.id)
      r.el.detach()
    }
    this.ribbonItems = []
    ws?.leftRibbon.onChange(false)
    if (this.statusBarEl) {
      this.statusBarEl.detach()
      this.statusBarEl = null
    }
  }

  registerViewType(type: string, creator: (leaf: any) => any): void {
    if (!this.app.viewRegistry.getViewCreatorByType(type)) this.app.viewRegistry.registerView(type, creator)
    this.views.push(type)
  }
  /** Plugin-API name for the same thing. */
  registerView(type: string, creator: (leaf: any) => any): void {
    this.registerViewType(type, creator)
  }

  registerExtensions(exts: string[], type: string): void {
    this.app.viewRegistry.registerExtensions(exts, type)
    this.register(() => this.app.viewRegistry.unregisterExtensions(exts))
  }

  /** Commands are namespaced `<pluginId>:<id>` and their names prefixed with the plugin name. */
  addCommand(cmd: Command): Command {
    const full: Command = { ...cmd, id: `${this.id}:${cmd.id}`, name: `${this.instance.name}: ${cmd.name}` }
    this.app.commands.addCommand(full)
    this.commands.push(full.id)
    return full
  }

  /** A command whose id is used as-is (`registerGlobalCommand`). */
  registerGlobalCommand(cmd: Command): void {
    this.app.commands.addCommand(cmd)
    this.commands.push(cmd.id)
  }

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const id = `${this.id}:${title}`
    const el = this.app.workspace.leftRibbon.addRibbonItemButton(id, icon, title, callback)
    this.ribbonItems.push({ id, el })
    return el
  }

  addStatusBarItem(): HTMLElement {
    if (!this.statusBarEl) this.statusBarEl = this.app.statusBar.createStatusBarItem(this.id)
    return this.statusBarEl!
  }
}

export class InternalPlugins extends Events {
  app: any
  plugins: Record<string, InternalPlugin> = {}
  config: Record<string, any> = {}
  private saveTimer: any = null

  constructor(app: any) {
    super()
    this.app = app
  }

  /** Register a plugin definition (in CORE_PLUGIN_ORDER). */
  loadPlugin(def: CorePluginDef): InternalPlugin {
    const p = new InternalPlugin(this.app, this, def)
    this.plugins[def.id] = p
    try {
      def.init?.(this.app, p)
    } catch (e) {
      console.error(e)
    }
    return p
  }

  getPluginById(id: string): InternalPlugin | null {
    return this.plugins[id] ?? null
  }

  getEnabledPluginById(id: string): CorePluginDef | null {
    const p = this.plugins[id]
    return p && p.enabled ? p.instance : null
  }

  getEnabledPlugins(): CorePluginDef[] {
    return Object.values(this.plugins)
      .filter(p => p.enabled)
      .map(p => p.instance)
  }

  /** Read core-plugins.json and enable plugins per the file (missing → defaultOn + save). */
  async enable(): Promise<void> {
    let data: any = null
    try {
      data = await this.app.vault.readConfigJson('core-plugins')
    } catch {
      data = null
    }
    let needsSave = false
    if (Array.isArray(data)) {
      // Legacy format: array of enabled ids → every registered plugin listed is on, others off.
      const on = new Set<string>(data)
      data = {}
      for (const id of Object.keys(this.plugins)) data[id] = on.has(id)
      needsSave = true
    }
    if (!data || typeof data !== 'object') data = {}
    this.config = data
    for (const id of Object.keys(this.plugins)) {
      const p = this.plugins[id]
      let on: boolean
      if (Object.prototype.hasOwnProperty.call(data, id)) on = !!data[id]
      else {
        on = !!p.instance.defaultOn
        needsSave = true
      }
      if (on) await p.enable(false)
    }
    if (needsSave) this.requestSaveConfig()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const p = this.plugins[id]
    if (!p) return
    if (enabled) await p.enable(true)
    else p.disable(true)
    this.requestSaveConfig()
  }

  requestSaveConfig(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.saveConfig(), 100)
  }

  /** `{id: enabled}` for every registered plugin (registration order), unknown keys preserved. */
  async saveConfig(): Promise<void> {
    const out: Record<string, any> = {}
    for (const id of Object.keys(this.plugins)) out[id] = this.plugins[id].enabled
    for (const k of Object.keys(this.config)) if (!(k in out)) out[k] = this.config[k]
    this.config = out
    try {
      await this.app.vault.writeConfigJson('core-plugins', out)
    } catch (e) {
      console.error('Failed to save core-plugins.json', e)
    }
  }
}
