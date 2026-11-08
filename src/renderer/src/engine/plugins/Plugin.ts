/* eslint-disable @typescript-eslint/no-explicit-any */
// Plugin API `Plugin`: a Component with the registration
// helpers community plugins use. Everything registered is removed again on unload.
import { Component } from '../core/Component'
import { registry } from '../views/bases/functions'
import { debounce } from '../vault/debounce'
import { normalizePath } from '../vault/path'
import { registerMarkdownPostProcessor, registerMarkdownCodeBlockProcessor } from '../markdown/plugin-api'
import { MarkdownPreviewRenderer } from '../markdown/MarkdownPreviewRenderer'
import { insertPluginStyle } from '../theme/styleOrder'
import type { PluginManifest } from './PluginManifest'
import type { SettingTab } from './settingTab'
import { installEditorSuggest } from './editorSuggest'

export class Plugin extends Component {
  app: any
  manifest: PluginManifest
  settingTab: SettingTab | null = null
  /** @internal */ _lastDataModifiedTime = 0
  /** @internal */ _userDisabled = false
  /** @internal */ onConfigFileChange: () => void
  onExternalSettingsChange?(): any
  /** Commonly assigned by plugins in onload (`this.settings`); used by PluginSettingTab. */
  settings?: any

  constructor(app: any, manifest: PluginManifest) {
    super()
    this.app = app
    this.manifest = manifest
    this.onConfigFileChange = debounce(() => void this._onConfigFileChange(), 50, false) as any
  }

  async load(): Promise<void> {
    if (this._loaded) return
    this._loaded = true
    await this.onload()
    for (const c of this._children.slice()) c.load()
  }

  onload(): any {}

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const ribbon = this.app.workspace.leftRibbon
    const id = this.manifest.id + ':' + title
    const el = ribbon.addRibbonItemButton(id, icon, title, callback)
    this.register(() => {
      ribbon.removeRibbonAction(id)
      el.detach()
    })
    return el
  }

  addStatusBarItem(): HTMLElement {
    const el: HTMLElement = this.app.statusBar.containerEl.createDiv('status-bar-item')
    el.addClass('plugin-' + this.manifest.id.toLowerCase().replace(/[^_a-zA-Z0-9-]/, '-'))
    this.register(() => el.detach())
    return el
  }

  addCommand(command: any): any {
    command.id = this.manifest.id + ':' + command.id
    command.name = this.manifest.name + ': ' + command.name
    this.app.commands.addCommand(command)
    this.register(() => this.app.commands.removeCommand(command.id))
    return command
  }

  removeCommand(commandId: string): void {
    this.app.commands.removeCommand(this.manifest.id + ':' + commandId)
  }

  addSettingTab(tab: SettingTab): void {
    this.settingTab = tab
    this.app.setting.addSettingTab(tab)
    this.register(() => {
      this.app.setting.removeSettingTab(tab)
      this.settingTab = null
    })
  }

  registerView(type: string, viewCreator: (leaf: any) => any): void {
    this.app.viewRegistry.registerView(type, viewCreator)
    this.register(() => {
      this.app.viewRegistry.unregisterView(type)
      if (this._userDisabled) this.app.workspace.detachLeavesOfType(type)
    })
  }

  registerHoverLinkSource(id: string, info: { display: string; defaultMod: boolean }): void {
    this.app.workspace.registerHoverLinkSource(id, info)
    this.register(() => this.app.workspace.unregisterHoverLinkSource(id))
  }

  registerExtensions(extensions: string[], viewType: string): void {
    this.app.viewRegistry.registerExtensions(extensions, viewType)
    this.register(() => this.app.viewRegistry.unregisterExtensions(extensions))
  }

  registerMarkdownPostProcessor(postProcessor: any, sortOrder?: number): any {
    return registerMarkdownPostProcessor(this, postProcessor, sortOrder)
  }

  registerMarkdownCodeBlockProcessor(language: string, handler: any, sortOrder?: number): any {
    return registerMarkdownCodeBlockProcessor(this, language, handler, sortOrder)
  }

  registerBasesView(viewId: string, registration: any): boolean {
    const bases = this.app.internalPlugins?.getEnabledPluginById?.('bases')
    if (!bases?.registerView) return false
    bases.registerView(viewId, registration)
    this.register(() => bases.deregisterView?.(viewId))
    return true
  }

  registerGlobalFunc(fn: any): void {
    registry.addGlobal(fn)
    this.register(() => registry.removeGlobal(fn.name))
  }
  registerInstanceFunc(type: any, fn: any): void {
    registry.addForType(type, fn)
    this.register(() => registry.removeForType(type, fn.name))
  }
  registerCodeMirror(_callback: (cm: any) => any): void {
    /* legacy CM5 hook; a no-op */
  }

  registerEditorExtension(extension: any): void {
    this.app.workspace.registerEditorExtension(extension)
    this.register(() => this.app.workspace.unregisterEditorExtension(extension))
  }

  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => any): void {
    const ph = this.app.workspace.protocolHandler
    ph.register(action, handler)
    this.register(() => ph.unregister(action, handler))
  }

  registerEditorSuggest(editorSuggest: any): void {
    const mgr = installEditorSuggest(this.app)
    mgr.add(editorSuggest)
    this.register(() => mgr.remove(editorSuggest))
  }

  registerCliHandler(command: string, description: string, flags: any, handler: any): void {
    const cli = this.app.cli
    if (!cli?.registerHandler) return
    cli.registerHandler(command, `[${this.manifest.name}]: ${description}`, flags, handler)
    this.register(() => cli.unregisterHandler(command, handler))
  }

  private dataPath(): string {
    return normalizePath(this.manifest.dir + '/data.json')
  }

  async loadData(): Promise<any> {
    const adapter = this.app.vault.adapter
    let data: any = null
    try {
      if (await adapter.exists(this.dataPath())) data = JSON.parse(await adapter.read(this.dataPath()))
    } catch {
      data = null
    }
    if (data && this.onExternalSettingsChange) this._lastDataModifiedTime = await this.getModifiedTime()
    return data
  }

  async saveData(data: any): Promise<void> {
    const t = Date.now()
    this._lastDataModifiedTime = t
    const adapter = this.app.vault.adapter
    try {
      if (!(await adapter.exists(this.manifest.dir))) await adapter.mkdir(this.manifest.dir)
      await adapter.write(this.dataPath(), JSON.stringify(data, undefined, 2), { mtime: t })
    } catch (e) {
      console.error(e)
    }
  }

  async loadCSS(): Promise<void> {
    const adapter = this.app.vault.adapter
    const p = normalizePath(this.manifest.dir + '/styles.css')
    if (!(await adapter.exists(p))) return
    const css = await adapter.read(p)
    const el = createEl('style', { type: 'text/css' } as any)
    el.textContent = css
    insertPluginStyle(el)
    this.register(() => el.detach())
  }

  onUserEnable(): void {}

  async getModifiedTime(): Promise<number> {
    try {
      return (await this.app.vault.adapter.stat(this.dataPath())).mtime
    } catch {
      return 0
    }
  }

  /** @internal Sync/external edits of data.json. */
  async _onConfigFileChange(): Promise<void> {
    if (!this.onExternalSettingsChange) return
    const mtime = await this.getModifiedTime()
    if (this._lastDataModifiedTime < mtime) {
      await this.onExternalSettingsChange()
      this.settingTab?.update?.()
    }
    this._lastDataModifiedTime = mtime
  }
}

// Keep a reference so tree-shaking never drops the renderer the post-processor helpers rely on.
void MarkdownPreviewRenderer
