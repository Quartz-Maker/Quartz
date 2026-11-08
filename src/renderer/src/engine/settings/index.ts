/* eslint-disable @typescript-eslint/no-explicit-any */
// Native settings window: `installSettings(app)` registers the nine built-in tabs (in
// order), `app.customCss`, and keeps the core-plugin option tabs in sync with app.internalPlugins.
import { AboutTab } from './tabs/AboutTab'
import { AppearanceTab } from './tabs/AppearanceTab'
import { InterfaceTab } from './tabs/InterfaceTab'
import { EditorTab } from './tabs/EditorTab'
import { FileTab } from './tabs/FileTab'
import { HotkeysTab } from './tabs/HotkeysTab'
import { CorePluginsTab, CommunityPluginsTab, KeychainTab } from './tabs/PluginTabs'
import { syncCorePluginTabs } from './corePluginTabs'
import { CustomCss } from './customCss'

export { SettingsManager } from './SettingsManager'
export { CustomCss } from './customCss'

export function installSettings(app: any): void {
  app.customCss = new CustomCss(app)
  const s = app.setting
  if (!s.settingTabs.length) {
    for (const tab of [
      new AboutTab(app),
      new AppearanceTab(app),
      new InterfaceTab(app),
      new EditorTab(app),
      new FileTab(app),
      new HotkeysTab(app),
      new KeychainTab(app),
      new CorePluginsTab(app),
      new CommunityPluginsTab(app)
    ])
      s.addBuiltinTab(tab)
  }
  syncCorePluginTabs(app)
  void app.customCss.load()
  installBehaviors(app)
}

/** App-level reactions to settings that are not owned by one view. */
function installBehaviors(app: any): void {
  // baseFontSizeAction: Ctrl + wheel (or pinch-zoom, which arrives as ctrl+wheel) changes the font size.
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!e.ctrlKey || !app.vault.getConfig('baseFontSizeAction')) return
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('.workspace-leaf-content[data-type="markdown"]')) return
      e.preventDefault()
      const cur = app.getBaseFontSize?.() ?? 16
      app.setBaseFontSize?.(Math.min(30, Math.max(10, cur + (e.deltaY < 0 ? 1 : -1))))
    },
    { passive: false }
  )
  // openBehavior: what to open when the app starts ('' = last opened, 'new', 'daily', 'file:<path>').
  app.workspace.onLayoutReady?.(() => {
    const ob = String(app.vault.getConfig('openBehavior') ?? '')
    if (!ob) return
    if (ob === 'new') void app.commands.executeCommandById('file-explorer:new-file')
    else if (ob === 'daily') void app.commands.executeCommandById('daily-notes')
    else if (ob.startsWith('file:')) void app.workspace.openLinkText(ob.slice(5), '', false)
  })
}
