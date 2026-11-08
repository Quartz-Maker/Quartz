/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.plugins` — the community plugin manager (`Plugins`).
//   <configDir>/plugins/<dir>/manifest.json   discovery (id required; keyed by id)
//   <configDir>/community-plugins.json        JSON array of enabled ids (saved debounced 1 s)
//   localStorage["enable-plugin-<appId>"]     "true" = restricted mode OFF (plugins allowed)
import { Events } from '../core/Events'
import { debounce } from '../vault/debounce'
import { normalizePath } from '../vault/path'
import { Notice } from '../ui/Notice'
import { ConfirmationModal } from '../ui/Modal'
import { Plugin } from './Plugin'
import { normalizeManifest, type PluginManifest } from './PluginManifest'
import { getApiModule } from './apiModule'
import { createRequire } from './requireShim'
import { t } from '../settings/i18n'
import { fetchUrl, rawUrl, releaseAssetUrl, pickVersion, isNewerVersion, loadCommunityPlugins, stripSourceMap } from '../settings/community/registry'

const HANG_MS = 3000

export class TrustModal extends ConfirmationModal {
  constructor(app: any) {
    super(app)
    this.app = app
    this.modalEl.addClass('mod-lg', 'mod-trust-folder')
    this.setTitle('Do you trust the author of this vault?')
    this.contentEl.createEl('p', { text: "You're opening this vault for the first time, and it comes with some plugins." })
    this.contentEl.createEl('p', { text: 'If you obtained this vault from someone else, please note that plugins of unknown origin might pose security risks.' })
    this.contentEl.createEl('p', { text: 'If you do not fully trust the author of this vault, we recommend staying in Restricted Mode, so the plugins in this vault do not run.' })
    this.addButton(b => b.setButtonText('Browse vault in Restricted Mode').setCancel().setInitialFocus())
    this.addButton(b =>
      b.setButtonText('Trust author and enable plugins').onClick(async () => {
        await this.app.plugins.setEnable(true)
        this.app.setting.open()
        this.app.setting.openTabById('community-plugins')
      })
    )
  }
  onClose(): void {
    super.onClose()
    this.app.customCss?.globallyEnable?.()
  }
}

export class Plugins extends Events {
  app: any
  manifests: Record<string, PluginManifest> = {}
  plugins: Record<string, Plugin> = {}
  enabledPlugins = new Set<string>()
  updates: Record<string, any> = {}
  lastUpdateCheck: number | null = null
  /** "Automatically check for plugin updates" (localStorage `plugin-automatically-check-for-updates`). */
  autoCheckForUpdates = false
  requestSaveConfig: () => void
  /** Errors from the last load of each plugin, for the settings UI. */
  loadErrors: Record<string, unknown> = {}

  constructor(app: any) {
    super()
    this.app = app
    this.requestSaveConfig = debounce(() => void this.saveConfig(), 1000, true) as any
    this.autoCheckForUpdates = !!app.loadLocalStorage?.('plugin-automatically-check-for-updates')
  }

  setAutomaticUpdateCheck(v: boolean): void {
    this.autoCheckForUpdates = v
    this.app.saveLocalStorage?.('plugin-automatically-check-for-updates', v)
  }

  get pluginsFolder(): string {
    return normalizePath(this.app.vault.configDir + '/plugins')
  }
  getPluginFolder(): string {
    return this.pluginsFolder
  }

  didChange(): void {
    this.trigger('changed')
  }

  async initialize(): Promise<void> {
    const app = this.app
    let list = await app.vault.readConfigJson('community-plugins')
    if (!list || !Array.isArray(list)) list = []
    this.enabledPlugins = new Set(list)
    await this.loadManifests()
    if (Object.keys(this.manifests).length === 0) return
    if (!this.isEnabled()) {
      if (localStorage.getItem('enable-plugin-' + app.appId) === null) {
        await app.customCss?.globallyDisable?.()
        new TrustModal(app).open()
      }
      return
    }
    for (const id of list) {
      if (!Object.prototype.hasOwnProperty.call(this.manifests, id)) continue
      const hang = window.setTimeout(() => new Notice(`Plugin "${id}" is taking a long time to load…`, 5000), HANG_MS)
      try {
        await this.enablePlugin(id)
      } finally {
        clearTimeout(hang)
      }
    }
    this.requestSaveConfig()
    this.lastUpdateCheck = app.loadLocalStorage?.('last-plugin-update-check') ?? Date.now()
    window.addEventListener('focus', () => {
      if ((window as any).activeWindow === window && this.autoCheckForUpdates && Date.now() > (this.lastUpdateCheck ?? 0) + 2592e5) void this.checkForUpdates(true)
    })
  }

  async loadManifests(): Promise<void> {
    const adapter = this.app.vault.adapter
    this.manifests = {}
    const root = this.pluginsFolder
    if (await adapter.exists(root)) {
      const listed = await adapter.list(root)
      for (const folder of listed.folders) await this.loadManifest(folder)
    }
    this.didChange()
  }

  async loadManifest(dir: string): Promise<PluginManifest | null> {
    const adapter = this.app.vault.adapter
    const file = normalizePath(dir + '/manifest.json')
    try {
      if (!(await adapter.exists(file))) return null
      const m = normalizeManifest(JSON.parse(await adapter.read(file)), dir)
      if (!m) return null
      this.manifests[m.id] = m
      return m
    } catch (e) {
      console.error('Failed to read manifest ' + file, e)
      return null
    }
  }

  isEnabled(): boolean {
    return localStorage.getItem('enable-plugin-' + this.app.appId) === 'true'
  }

  async setEnable(enable: boolean): Promise<void> {
    localStorage.setItem('enable-plugin-' + this.app.appId, enable ? 'true' : 'false')
    if (!enable) {
      for (const id of Object.keys(this.plugins)) await this.disablePlugin(id)
    } else {
      for (const id of Array.from(this.enabledPlugins)) await this.enablePlugin(id)
    }
    this.didChange()
  }

  async enablePlugin(id: string, user = false): Promise<boolean> {
    if (!this.manifests[id]) return false
    try {
      if (!this.plugins[id]) await this.loadPlugin(id, user)
      delete this.loadErrors[id]
      this.didChange()
      return true
    } catch (e) {
      console.error('Plugin failure: ' + id, e)
      this.loadErrors[id] = e
      new Notice(`Failed to load plugin ${this.manifests[id]?.name ?? id}. ${e instanceof Error ? e.message : e}`.slice(0, 200))
      delete this.plugins[id]
      this.didChange()
      return false
    }
  }

  async enablePluginAndSave(id: string): Promise<boolean> {
    if (await this.enablePlugin(id, true)) {
      this.enabledPlugins.add(id)
      this.requestSaveConfig()
      return true
    }
    return false
  }

  async disablePlugin(id: string, user = false): Promise<void> {
    this.unloadPlugin(id, user)
    this.didChange()
  }

  async disablePluginAndSave(id: string): Promise<void> {
    this.enabledPlugins.delete(id)
    this.requestSaveConfig()
    await this.disablePlugin(id, true)
  }

  async uninstallPlugin(id: string): Promise<void> {
    await this.disablePluginAndSave(id)
    const dir = this.manifests[id]?.dir
    if (!dir || !(await this.app.vault.exists(dir))) return
    try {
      await this.app.vault.adapter.rmdir(dir, true)
      delete this.manifests[id]
      delete this.updates[id]
      this.didChange()
    } catch (e) {
      new Notice(t('setting.thirdPartyPlugin.msgFailedToUninstallPlugin', { id }))
      console.error('Plugin failure: ' + id, e)
    }
  }

  /** Downloads manifest.json, main.js and styles.css of release `version` from GitHub `repo` into
   *  `<configDir>/plugins/<id>`, then reloads the plugin if it was running. */
  async installPlugin(repo: string, version: string, manifest: { id: string; name: string }): Promise<void> {
    const T = 'setting.thirdPartyPlugin.'
    const { id, name } = manifest
    const notice = new Notice(t(T + 'msgInstallingPlugin', { name }), 0)
    notice.containerEl.addClass('is-loading')
    const fail = (msg: string): void => {
      notice.containerEl.removeClass('is-loading')
      notice.setMessage(msg)
      setTimeout(() => notice.hide(), 3000)
    }
    let manifestText: string
    try {
      manifestText = await fetchUrl(releaseAssetUrl(repo, version, 'manifest.json')).text
      const m = JSON.parse(manifestText)
      if (!m.id || m.id !== id) return fail('Plugin ID mismatch.')
    } catch (e) {
      console.error(e)
      return fail(t(T + 'msgFailedToInstallPlugin', { name }))
    }
    const vault = this.app.vault
    const root = this.getPluginFolder()
    if (!(await vault.adapter.exists(root))) await vault.adapter.mkdir(root)
    const dir = root + '/' + id
    if (!(await vault.adapter.exists(dir))) await vault.adapter.mkdir(dir)
    const adapter = vault.adapter
    await adapter.write(dir + '/manifest.json', manifestText)
    try {
      const code = await fetchUrl(releaseAssetUrl(repo, version, 'main.js')).text
      await adapter.write(dir + '/main.js', stripSourceMap(code))
    } catch {
      console.log(`${name}: main.js not found`)
    }
    try {
      const css = await fetchUrl(releaseAssetUrl(repo, version, 'styles.css')).text
      await adapter.write(dir + '/styles.css', css)
    } catch {
      console.log(`${name}: styles.css not found`)
    }
    delete this.updates[id]
    notice.containerEl.removeClass('is-loading')
    notice.containerEl.addClass('mod-success')
    notice.setMessage(t(T + 'msgSuccessfullyInstalledPlugin', { name }))
    setTimeout(() => notice.hide(), 3000)
    await this.loadManifest(dir)
    this.didChange()
    if (Object.prototype.hasOwnProperty.call(this.plugins, id)) {
      await this.disablePlugin(id)
      await this.enablePlugin(id, true)
    }
  }

  /** Compares every installed plugin listed in the registry with its repo's manifest (and versions.json).
   *  `silent` (automatic check) skips the offline notice and adds a "View" button. */
  async checkForUpdates(silent = false): Promise<void> {
    const T = 'setting.thirdPartyPlugin.'
    if (!navigator.onLine) {
      if (!silent) new Notice(t('dialogue.msgOffline'))
      return
    }
    this.lastUpdateCheck = Date.now()
    this.app.saveLocalStorage?.('last-plugin-update-check', this.lastUpdateCheck)
    const updates: Record<string, any> = (this.updates = {})
    const notice = new Notice(t(T + 'msgCheckingForUpdates'), 0)
    let list: any[] | null = null
    try {
      list = await loadCommunityPlugins()
    } catch (e) {
      console.error(e)
    }
    if (!list) {
      notice.setMessage(t(T + 'msgFailedLoadPlugins')).setAutoHide(4000)
      return
    }
    for (const entry of list) {
      const id = entry.id
      if (!Object.prototype.hasOwnProperty.call(this.manifests, id)) continue
      const current = this.manifests[id].version
      if (!current) continue
      const repo = entry.repo
      let remote: any = null
      try {
        remote = await fetchUrl(rawUrl(repo, 'manifest.json')).json
      } catch {
        continue
      }
      if (!remote || !remote.id || remote.id !== id) continue
      const version = await pickVersion(repo, remote)
      if (version && isNewerVersion(current, version)) updates[id] = { repo, version, manifest: remote }
    }
    const n = Object.keys(updates).length
    if (n === 0) notice.setMessage(t(T + 'msgNoUpdatesFound')).setAutoHide(4000)
    else {
      notice.setMessage(t(T + 'msgUpdatesFound', { count: n })).setAutoHide(4000)
      if (silent)
        notice.addButton(t('dialogue.buttonView'), () => {
          this.app.setting.open()
          this.app.setting.openTabById('community-plugins')
        })
    }
    this.didChange()
  }

  /** Evaluates `main.js` and runs `onload`. */
  async loadPlugin(id: string, user = false): Promise<Plugin> {
    const manifest = this.manifests[id]
    if (!manifest) throw new Error('Plugin manifest not found: ' + id)
    const adapter = this.app.vault.adapter
    const mainPath = normalizePath(manifest.dir + '/main.js')
    let code = await adapter.read(mainPath)
    code = code.replace(/^\/\/# sourceMappingURL=data:application\/json;base64,.*$/gm, '')
    const module: { exports: any } = { exports: {} }
    const exports = module.exports
    const req = createRequire(getApiModule(), id)
    const fn = (window as any).eval('(function anonymous(require,module,exports){' + code + '\n})\n//# sourceURL=plugin:' + encodeURIComponent(id))
    fn(req, module, exports)
    const Cls = module.exports.default || module.exports
    if (typeof Cls !== 'function') throw new Error('Failed to load plugin ' + id + '. No exports detected.')
    const inst = new Cls(this.app, manifest)
    if (!(inst instanceof Plugin)) throw new Error('Failed to load plugin ' + id)
    this.plugins[id] = inst
    await inst.load()
    await inst.loadCSS()
    if (user) inst.onUserEnable()
    return inst
  }

  unloadPlugin(id: string, user = false): void {
    const p = this.plugins[id]
    if (!p) return
    p._userDisabled = user
    try {
      p.unload()
    } catch (e) {
      console.error('Plugin failure: ' + id, e)
    }
    delete this.plugins[id]
  }

  getPlugin(id: string): Plugin | null {
    return Object.prototype.hasOwnProperty.call(this.plugins, id) ? this.plugins[id] : null
  }

  async saveConfig(): Promise<void> {
    await this.app.vault.writeConfigJson('community-plugins', Array.from(this.enabledPlugins))
  }

  async clearEnabledPlugins(): Promise<void> {
    this.enabledPlugins.clear()
    await this.saveConfig()
  }
}
