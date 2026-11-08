/* eslint-disable @typescript-eslint/no-explicit-any */
// Community plugin support: `installPlugins(app)` creates `app.plugins`, `app.setting`'s plugin-tab
// manager and the editor state fields; `app.plugins.initialize()` loads enabled plugins.
import { moment } from '../ui/moment'
import { installBuiltinPostProcessors } from '../markdown/postprocessors'
import { Plugins } from './Plugins'
import { SettingsManager } from './settingTab'
import { SecretStorage } from './extras'
import { installEditorFields } from './editorFields'
import { getApiModule } from './apiModule'

export { Plugin } from './Plugin'
export { Plugins, TrustModal } from './Plugins'
export { PluginSettingTab, SettingTab, SettingPage, SettingsManager, displayTab } from './settingTab'
export { getApiModule, createApiModule, API_EXPORT_NAMES, MINIMAL_EXPORTS } from './apiModule'
export { createRequire, DEPRECATED_MODULES, getKnownModules } from './requireShim'
export type { PluginManifest } from './PluginManifest'

export function installPlugins(app: any, _opts: Record<string, unknown> = {}): Plugins {
  ;(window as any).moment = moment
  // Built-in reading post-processors must be registered before any plugin's.
  installBuiltinPostProcessors()
  app.setting = new SettingsManager(app)
  app.secretStorage = new SecretStorage(app)
  installEditorFields(app)
  const plugins = new Plugins(app)
  app.plugins = plugins
  // data.json edited outside of the plugin (Sync, other editor) → onExternalSettingsChange.
  app.vault.on('raw', (path: string) => {
    for (const p of Object.values(plugins.plugins)) {
      if (p.manifest.dir && path === p.manifest.dir + '/data.json') p.onConfigFileChange()
    }
  })
  ;(window as any).__quartz = getApiModule()
  return plugins
}
