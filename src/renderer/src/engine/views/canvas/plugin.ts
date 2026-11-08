/* eslint-disable @typescript-eslint/no-explicit-any */
// The `canvas` core plugin: view type + `.canvas` extension, `canvas:*` commands, ribbon,
// file-explorer "New canvas", options in `<configDir>/canvas.json`, per-file local data (read-only),
// canvas embeds, and rewriting of card paths when files are renamed.
import { Keymap } from '../../keymap/Keymap'
import { Notice } from '../../ui/Notice'
import { embedRegistry } from '../../markdown/embeds'
import { CanvasView, VIEW_TYPE_CANVAS } from './CanvasView'
import { CanvasEmbed } from './embed'
import { JumpToGroupModal } from './modals'
import { TextNode } from './CanvasNode'
import { rectToBBox } from './geometry'
import { stringifyCanvas } from './json'
import { S } from './strings'
import type { CanvasOptions } from './Canvas'

export const DEFAULT_CANVAS_OPTIONS: CanvasOptions = { snapToObjects: true, snapToGrid: true }

/** Per-file local data (`<appId>-canvas-<path>` in localStorage, as app local storage). */
export class CanvasLocalData {
  constructor(public app: any) {}
  private key(path: string): string {
    return 'canvas-' + path
  }
  private get(key: string): any {
    if (typeof this.app.loadLocalStorage === 'function') return this.app.loadLocalStorage(key)
    try {
      const v = localStorage.getItem((this.app.appId || '') + '-' + key)
      return v === null ? null : JSON.parse(v)
    } catch {
      return null
    }
  }
  private set(key: string, value: any): void {
    if (typeof this.app.saveLocalStorage === 'function') return this.app.saveLocalStorage(key, value)
    try {
      const k = (this.app.appId || '') + '-' + key
      if (value === null || value === undefined) localStorage.removeItem(k)
      else localStorage.setItem(k, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }
  load(file: any): any {
    return file ? this.get(this.key(file.path)) : null
  }
  save(file: any, data: any): void {
    if (file) this.set(this.key(file.path), data)
  }
  handleRename(oldPath: string, file: any): void {
    const d = this.get(this.key(oldPath))
    if (d) {
      this.remove(oldPath)
      this.save(file, d)
    }
  }
  handleDelete(file: any): void {
    this.remove(file.path)
  }
  remove(path: string): void {
    this.set(this.key(path), null)
  }
}

export class CanvasPlugin {
  id = 'canvas'
  name = S.name
  description = S.desc
  defaultOn = true
  app: any
  options: CanvasOptions = { ...DEFAULT_CANVAS_OPTIONS }
  localData: CanvasLocalData
  renames: [string, string][] = []
  private renameTimer = 0
  private renameChain: Promise<void> = Promise.resolve()
  /** Persistence hooks (the InternalPlugin wrapper's loadData/saveData, or the config dir). */
  io: { load(): Promise<any>; save(d: any): Promise<void> }

  constructor(app: any, io?: { load(): Promise<any>; save(d: any): Promise<void> }) {
    this.app = app
    this.localData = new CanvasLocalData(app)
    this.io = io ?? {
      load: () => app.vault.readConfigJson('canvas'),
      save: d => app.vault.writeConfigJson('canvas', d)
    }
  }

  async loadOptions(): Promise<void> {
    let d: any = null
    try {
      d = await this.io.load()
    } catch {
      d = null
    }
    this.options = Object.assign({ ...DEFAULT_CANVAS_OPTIONS }, d || {})
  }
  saveOptions(): void {
    void this.io.save(this.options)
  }
  async onExternalSettingsChange(): Promise<void> {
    this.options = (await this.io.load()) || {}
    this.rerenderCanvases()
  }
  rerenderCanvases(): void {
    for (const leaf of this.app.workspace?.getLeavesOfType?.(VIEW_TYPE_CANVAS) ?? []) {
      const v = leaf.view
      if (v instanceof CanvasView) v.canvas.rerenderViewport()
    }
  }

  /** Where new canvases go: vault root, the active file's folder, or the configured folder. */
  getNewFileParent(sourcePath?: string): any {
    const vault = this.app.vault
    const { newFileLocation, newFileFolderPath } = this.options
    if (newFileLocation === 'folder') {
      if (newFileFolderPath != null) {
        const f = vault.getAbstractFileByPath(newFileFolderPath)
        if (f && 'children' in f) return f
      }
    } else if (sourcePath && newFileLocation === 'current') {
      const i = sourcePath.lastIndexOf('/')
      const f = vault.getAbstractFileByPath(i === -1 ? '/' : sourcePath.slice(0, i))
      if (f && 'children' in f) return f
    }
    return vault.getRoot()
  }
  createNewCanvasFile(parent: any, name?: string, content?: string): Promise<any> {
    return this.app.fileManager.createNewFile(parent, name, 'canvas', content)
  }
  async newCanvas(evt?: MouseEvent | null, parent?: any): Promise<void> {
    const app = this.app
    const folder = parent ?? this.getNewFileParent(app.workspace?.getActiveFile?.()?.path)
    const f = await this.createNewCanvasFile(folder)
    await app.workspace.getLeaf(evt ? Keymap.isModEvent(evt) : false).openFile(f, { active: true, eState: { rename: 'all' } })
  }

  activeCanvasView(): CanvasView | null {
    return this.app.workspace?.getActiveViewOfType?.(CanvasView) ?? null
  }

  commands(): any[] {
    return [
      { id: 'canvas:new-file', name: S.name + ': ' + S.commandCreateNewCanvas, icon: 'lucide-layout-dashboard', callback: () => void this.newCanvas() },
      {
        id: 'canvas:export-as-image',
        name: S.name + ': ' + S.actionExportPng,
        icon: 'lucide-image',
        checkCallback: (checking: boolean) => {
          const v = this.activeCanvasView()
          if (!v) return false
          if (!checking) void v.canvas.generateHDImage()
          return true
        }
      },
      {
        id: 'canvas:jump-to-group',
        name: S.name + ': ' + S.actionJumpToGroup,
        icon: 'lucide-move',
        checkCallback: (checking: boolean) => {
          const v = this.activeCanvasView()
          if (!v) return false
          if (!checking) new JumpToGroupModal(v.canvas, g => v.canvas.zoomToBbox(rectToBBox(g))).open()
          return true
        }
      },
      {
        id: 'canvas:convert-to-file',
        name: S.name + ': ' + S.commandConvertToFile,
        icon: 'lucide-file-input',
        checkCallback: (checking: boolean) => {
          const v = this.activeCanvasView()
          if (!v) return false
          const sel = v.canvas.selection
          if (sel.size !== 1) return false
          const n = sel.values().next().value
          if (!(n instanceof TextNode)) return false
          if (!checking) n.convertToFile()
          return true
        }
      }
    ]
  }

  onFileMenu = (menu: any, file: any, source: string): void => {
    if (source !== 'file-explorer-context-menu' || !file || !('children' in file)) return
    menu.addItem((i: any) =>
      i
        .setSection('action-primary')
        .setIcon('lucide-layout-dashboard')
        .setTitle(S.actionNewCanvas)
        .onClick((e: MouseEvent) => void this.newCanvas(e, file))
    )
  }
  onRename = (file: any, oldPath: string): void => {
    if (!file || !('extension' in file)) return
    if (file.extension === 'canvas') this.localData.handleRename(oldPath, file)
    this.renames.push([oldPath, file.path])
    clearTimeout(this.renameTimer)
    this.renameTimer = window.setTimeout(() => this.processRenames(), 500)
  }
  onDelete = (file: any): void => {
    if (file && file.extension === 'canvas') this.localData.handleDelete(file)
  }

  /** Rewrite `file` / `background` paths in every canvas referencing a renamed file. */
  processRenames(): Promise<void> {
    const renames = this.renames
    this.renames = []
    this.renameChain = this.renameChain.then(async () => {
      const vault = this.app.vault
      const olds = renames.map(r => r[0])
      const targets: any[] = []
      for (const f of vault.getFiles?.() ?? []) {
        if (f.extension !== 'canvas') continue
        let text = ''
        try {
          text = await vault.cachedRead(f)
        } catch {
          continue
        }
        let d: any
        try {
          d = JSON.parse(text)
        } catch {
          continue
        }
        if ((d?.nodes ?? []).some((n: any) => (n.type === 'file' && olds.includes(n.file)) || (n.type === 'group' && olds.includes(n.background)))) targets.push(f)
      }
      if (targets.length === 0) return
      const notice = new Notice(S.msgUpdatingLinks(targets.length))
      notice.containerEl?.addClass?.('is-loading')
      let count = 0
      for (const f of targets) {
        await vault.process(f, (text: string) => {
          if (!text) return text
          const d = JSON.parse(text)
          for (const n of d.nodes ?? []) {
            for (const [from, to] of renames) {
              if (n.type === 'file' && n.file === from) ((n.file = to), count++)
              else if (n.type === 'group' && n.background === from) ((n.background = to), count++)
            }
          }
          return stringifyCanvas(d) ?? text
        })
      }
      if (count > 0) {
        notice.containerEl?.removeClass?.('is-loading')
        notice.containerEl?.addClass?.('mod-success')
        notice.setMessage?.(S.msgUpdatedLinks(count))
      }
    })
    return this.renameChain
  }

  registerEmbed(): void {
    if (!embedRegistry.isExtensionRegistered('canvas')) embedRegistry.registerExtension('canvas', (ctx, path, sub) => new CanvasEmbed(ctx, path, sub))
  }
  unregisterEmbed(): void {
    embedRegistry.unregisterExtension('canvas')
  }
}

const plugins = new WeakMap<object, CanvasPlugin>()
export function getCanvasPlugin(app: any): CanvasPlugin | null {
  return plugins.get(app) ?? null
}

/**
 * Core plugin definition for `app.internalPlugins` (shell/corePlugins.tsx): registers the native
 * `canvas` view, extension, commands, ribbon item, embeds and the canvas.json options.
 */
export const canvasCorePlugin = {
  id: 'canvas',
  name: S.name,
  description: S.desc,
  defaultOn: true,
  async onEnable(app: any, p: any) {
    const plugin = new CanvasPlugin(app, { load: () => p.loadData(), save: d => p.saveData(d) })
    plugins.set(app, plugin)
    ;(this as any).plugin = plugin
    p.registerViewType(VIEW_TYPE_CANVAS, (leaf: any) => new CanvasView(leaf, plugin))
    p.registerExtensions(['canvas'], VIEW_TYPE_CANVAS)
    for (const c of plugin.commands()) {
      if (c.id === 'canvas:export-as-image' && !(window as any).quartzAPI && !(window as any).require) continue
      p.registerGlobalCommand(c)
    }
    p.addRibbonIcon('lucide-layout-dashboard', S.commandCreateNewCanvas, (evt: MouseEvent) => void plugin.newCanvas(evt))
    if (app.fileManager?.registerFileParentCreator) {
      app.fileManager.registerFileParentCreator('canvas', (src: string) => plugin.getNewFileParent(src))
      p.register(() => app.fileManager.unregisterFileCreator('canvas'))
    }
    plugin.registerEmbed()
    p.register(() => plugin.unregisterEmbed())
    if (app.workspace?.on) p.registerEvent(app.workspace.on('file-menu', plugin.onFileMenu))
    p.registerEvent(app.vault.on('rename', plugin.onRename))
    p.registerEvent(app.vault.on('delete', plugin.onDelete))
    await plugin.loadOptions()
  },
  onUserDisable(app: any) {
    app.workspace?.detachLeavesOfType?.(VIEW_TYPE_CANVAS)
  },
  async onExternalSettingsChange(this: any) {
    await this.plugin?.onExternalSettingsChange()
  }
}

/**
 * Standalone registration (no internal plugin manager): view type + extension + embeds.
 * Returns the plugin (options are loaded from `<configDir>/canvas.json`).
 */
export async function registerCanvasView(app: any): Promise<CanvasPlugin> {
  let plugin = plugins.get(app)
  if (plugin) return plugin
  plugin = new CanvasPlugin(app)
  plugins.set(app, plugin)
  const reg = app.viewRegistry
  if (reg && !reg.getViewCreatorByType(VIEW_TYPE_CANVAS)) {
    reg.registerView(VIEW_TYPE_CANVAS, (leaf: any) => new CanvasView(leaf, plugin!))
    if (!reg.isExtensionRegistered('canvas')) reg.registerExtensions(['canvas'], VIEW_TYPE_CANVAS)
  }
  app.fileManager?.registerFileParentCreator?.('canvas', (src: string) => plugin!.getNewFileParent(src))
  plugin.registerEmbed()
  app.vault.on('rename', plugin.onRename)
  app.vault.on('delete', plugin.onDelete)
  await plugin.loadOptions()
  return plugin
}
