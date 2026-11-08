/* eslint-disable @typescript-eslint/no-explicit-any */
// Vault-window boot:
//   App(adapter) → config (app.json/appearance.json) → Workspace + StatusBar + view registry +
//   commands/hotkeys → core plugins (core-plugins.json) → community plugins → vault.load →
//   metadataCache.initialize → workspace.loadLayout (workspace.json) → onLayoutReady.
// DOM: body > .titlebar + .app-container > .horizontal-main-container > .workspace, + .status-bar.
import { ProtocolHandler } from '../engine/workspace/ProtocolHandler'
import { applySpellcheckLanguages } from '../engine/settings/spellcheck'
import { DragManager } from '@/engine/app/DragManager'
import { createApp, setCurrentApp, type App } from '@/engine/App'
import { commandApp, loadVaultHotkeys, setActiveEditorProvider } from '@/engine/commands'
import { getBuiltinCommands } from '@/engine/commands/builtin'
import { mountWorkspace } from '@/engine/workspace/mountWorkspace'
import { installAppRegionRefresh } from '@/engine/app/appRegionRefresh'
import { Workspace } from '@/engine/workspace/Workspace'
import { registerCoreFileMenu } from '@/engine/app/fileMenu'
import { workspaceCommands } from '@/engine/workspace/commands'
import { ViewRegistry } from '@/engine/view/ViewRegistry'
import { InternalPlugins } from '@/engine/app/InternalPlugins'
import { StatusBar } from '@/engine/app/StatusBar'
import { MarkdownView, VIEW_TYPE_MARKDOWN } from '@/engine/views/markdown/MarkdownView'
import { registerMediaViews } from '@/engine/views/media/MediaViews'
import { Notice } from '@/engine/ui/Notice'
import { initUiKit, updateUseNativeMenu } from '@/engine/ui'
import { Platform } from '@/engine/keymap/Platform'
import { electron } from '@/engine/node'
import { setActiveEditorView } from '@/core/editorRef'
import { bindMetadataStore } from '@/stores/metadata'
import { bindWorkspaceStore } from '@/stores/workspace'
import { useVaultStore } from '@/stores/vault'
import { useSettingsStore } from '@/stores/settings'
import { useAppearanceStore } from '@/stores/appearance'
import { useGraphSettingsStore } from '@/stores/graphSettings'
import { useCorePluginsStore } from '@/stores/corePlugins'
import { useHotkeysStore } from '@/stores/hotkeys'
import { usePropertyTypesStore } from '@/stores/propertyTypes'
import { installPlugins } from '@/engine/plugins'
import { installSettings } from '@/engine/settings'
import { installUriReceivers } from '@/engine/app/uriReceivers'
import { registerCorePlugins } from './corePlugins'
import { installAppReadingHost } from './readingHost'
import { openVaultManager } from '@/engine/app/starter'
import '@/engine/ui/ui.css'
import './shell.css'

function platformClass(): string {
  return Platform.isMacOS ? 'mod-macos' : Platform.isWin ? 'mod-windows' : 'mod-linux'
}

/** Body classes derived from config (show-ribbon, show-inline-title, …) and theme. */
function syncBodyClasses(app: App): void {
  const b = document.body
  const v: any = app.vault
  b.addClass('obsidian-app', platformClass(), 'styled-scrollbars', 'is-floating-nav', 'auto-full-screen')
  b.toggleClass('show-inline-title', v.getConfig('showInlineTitle') !== false)
  b.toggleClass('show-view-header', v.getConfig('showViewHeader') !== false)
  const ribbon = v.getConfig('showRibbon') !== false
  b.toggleClass('show-ribbon', ribbon)
  const ws: any = (app as any).workspace
  if (ws?.leftRibbon) {
    if (ribbon) ws.leftRibbon.show()
    else ws.leftRibbon.hide()
    ws.updateFrameless?.()
  }
  const theme = useAppearanceStore.getState().appearance.theme
  b.toggleClass('theme-dark', theme !== 'light')
  b.toggleClass('theme-light', theme === 'light')
}

export async function bootVaultWindow(vaultPath: string, configPath?: string): Promise<App> {
  const app: any = createApp(vaultPath, configPath ? { configPath } : {})
  setCurrentApp(app)
  // startup stage timings for Settings > General > "Check now" (Startup time report)
  const timings = (app.startupTimings = { start: performance.now(), stages: {} as Record<string, number>, total: 0 })
  let mark = timings.start
  const stage = (key: string): void => {
    const now = performance.now()
    timings.stages[key] = (timings.stages[key] ?? 0) + (now - mark)
    mark = now
  }

  // Keymap / commands / hotkeys are app-wide singletons (engine/commands).
  app.keymap = commandApp.keymap
  app.scope = commandApp.scope
  app.commands = commandApp.commands
  app.hotkeyManager = commandApp.hotkeyManager
  app.dragManager = new DragManager(app)
  Object.defineProperty(app, 'lastEvent', { get: () => commandApp.lastEvent, set: v => ((commandApp as any).lastEvent = v), configurable: true })
  app.isMobile = false
  app.loadLocalStorage = (key: string) => {
    try {
      const v = localStorage.getItem(`${app.appId}-${key}`)
      return v === null ? null : JSON.parse(v)
    } catch {
      return null
    }
  }
  app.saveLocalStorage = (key: string, value: unknown) => {
    try {
      if (value === null || value === undefined) localStorage.removeItem(`${app.appId}-${key}`)
      else localStorage.setItem(`${app.appId}-${key}`, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }
  app.showNotice = (msg: string) => new Notice(msg)
  app.openWithDefaultApp = (p: string) => void (electron() as any).shell.openPath(app.vault.adapter.getFullPath(p))
  app.showInFolder = (p: string) => (electron() as any).shell.showItemInFolder(app.vault.adapter.getFullPath(p))
  app.openVaultChooser = () => openVaultManager()
  app.getAppTitle = (leafTitle: string) => [leafTitle, app.vault.getName(), 'Quartz'].filter(Boolean).join(' - ')
  app.viewRegistry = new ViewRegistry()
  app.internalPlugins = new InternalPlugins(app)
  ;(window as any).__quartzVaultPath = vaultPath
  useVaultStore.getState().setVaultPath(vaultPath)

  // 1. config
  await app.vault.setupConfig()
  updateUseNativeMenu(k => app.vault.getConfig(k))

  // 2. shell DOM: workspace + status bar
  document.getElementById('root')?.remove()
  initUiKit(document)
  const titlebarStyle = ((window as any).titlebarStyle || 'hidden') as any
  const mounted = await mountWorkspace(document.body, app, { loadLayout: false, titlebarStyle, isMacOS: Platform.isMacOS, canPopoutWindow: Platform.canPopoutWindow })
  if (document.body.hasClass('is-frameless')) installAppRegionRefresh(document)
  const ws: Workspace = mounted.workspace
  registerCoreFileMenu(app)
  app.statusBar = new StatusBar(mounted.appContainerEl)
  ;(app as any).appContainerEl = mounted.appContainerEl

  // 3. views
  Workspace.markdownViewClass = MarkdownView
  app.viewRegistry.registerViewWithExtensions(['md'], VIEW_TYPE_MARKDOWN, (leaf: any) => new MarkdownView(leaf))
  registerMediaViews(app)
  installAppReadingHost(app)
  ws.registerEditorExtension = function (ext: any) {
    Workspace.prototype.registerEditorExtension.call(this, ext)
    this.trigger('editor-extensions-change')
  }
  ws.unregisterEditorExtension = function (ext: any) {
    Workspace.prototype.unregisterEditorExtension.call(this, ext)
    this.trigger('editor-extensions-change')
  }

  ;(ws as any).protocolHandler = new ProtocolHandler(app, ws)
  ;(ws as any).protocolHandler.registerDefaultHandlers()
  installPlugins(app)
  installSettings(app)
  applySpellcheckLanguages(app.getSpellcheckLanguages())

  // 4. hotkeys + app/workspace commands
  setActiveEditorProvider(() => {
    const v: any = ws.activeEditor
    if (!v || !v.editor) return null
    if (typeof v.getMode === 'function') return Object.assign(v, { isMarkdownView: v instanceof MarkdownView, titleEl: v.titleEl, inlineTitleEl: v.inlineTitleEl })
    return v
  })
  await loadVaultHotkeys(vaultPath, app.vault.configDir)
  for (const c of getBuiltinCommands({ openVaultSwitcher: () => openVaultManager(), openSettings: () => app.setting.open(), openPluginManager: () => (app.setting.open(), app.setting.openTabById('community-plugins')) })) app.commands.addCommand(c)
  for (const c of workspaceCommands(ws, { isMacOS: Platform.isMacOS })) {
    if (!app.commands.findCommand(c.id)) app.commands.addCommand(c as any)
  }

  stage('init')
  // 5. core plugins
  registerCorePlugins(app)
  await app.internalPlugins.enable()

  // React stores that still back bridged panels / the settings overlay.
  bindMetadataStore(app)
  void useSettingsStore.getState().loadSettings(vaultPath)
  void useAppearanceStore.getState().loadAppearance(vaultPath).then(() => syncBodyClasses(app))
  useGraphSettingsStore.getState().loadGraphSettings(vaultPath)
  void useCorePluginsStore.getState().loadCorePlugins(vaultPath)
  useHotkeysStore.getState().loadHotkeys(vaultPath)
  void usePropertyTypesStore.getState().loadTypes(vaultPath)

  stage('core')
  // 6. community plugins
  await app.plugins.initialize()

  stage('community')
  // 7. vault + metadata cache
  app.metadataCache.preload()
  await app.vault.load()
  await app.metadataCache.initialize()
  await app.metadataTypeManager.load()
  const refreshFiles = () => {
    const vs = useVaultStore.getState()
    void vs.loadFiles(vaultPath).then(vs.setFiles)
  }
  let t: any = null
  const schedule = () => {
    clearTimeout(t)
    t = setTimeout(refreshFiles, 100)
  }
  refreshFiles()
  for (const ev of ['create', 'delete', 'rename']) app.vault.on(ev, schedule)

  stage('vault')
  // 8. workspace layout (workspace.json) → layout-ready → onLayoutReady callbacks
  bindWorkspaceStore(ws)
  ws.on('active-leaf-change', () => {
    const v: any = ws.getActiveViewOfType(MarkdownView)
    if (v) setActiveEditorView(v.cm)
  })
  await ws.loadLayout()
  stage('workspace')
  timings.total = performance.now()
  syncBodyClasses(app)
  app.vault.on('config-changed', (k: string) => {
    if (k === 'nativeMenus') updateUseNativeMenu(key => app.vault.getConfig(key))
    if (['showInlineTitle', 'showViewHeader', 'showRibbon'].includes(k)) syncBodyClasses(app)
  })
  useAppearanceStore.subscribe(() => syncBodyClasses(app))

  // 9. hooks
  installUriReceivers(app)
  window.addEventListener('beforeunload', () => {
    ws.requestSaveLayout.run?.()
    ws.iterateAllLeaves((l: any) => void l.view?.saveImmediately?.())
  })
  // Mouse back/forward buttons navigate the active leaf.
  window.addEventListener('mouseup', evt => {
    if (evt.button === 3) void ws.activeLeaf?.history.back()
    else if (evt.button === 4) void ws.activeLeaf?.history.forward()
  })
  return app
}
