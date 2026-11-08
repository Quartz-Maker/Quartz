/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.customCss`: community themes + CSS snippets.
//   <configDir>/themes/<Name>/{manifest.json,theme.css}  (accepted when manifest.name === folder name)
//   <configDir>/themes/<Name>.css                        (legacy single file, listed "(Legacy)")
//   <configDir>/snippets/*.css                           (names starting with "." ignored, natural sort)
// Cascade (engine/theme/styleOrder): app < plugins < theme < snippets. The active theme is
// `cssTheme`, enabled snippets are `enabledCssSnippets` (both in appearance.json).
import { setThemeCss, setSnippetStyles, naturalCompare } from '../theme/styleOrder'
import { debounce } from '../vault/debounce'
import { Notice } from '../ui/Notice'
import { RequestUrlError } from '../ui/request'
import { t } from './i18n'
import { fetchUrl, rawUrl, releaseAssetUrl, pickVersion, isNewerVersion, loadCommunityThemes, type CommunityThemeEntry } from './community/registry'

const C = 'plugins.customCss.'

export interface ThemeManifest {
  name: string
  version?: string
  minAppVersion?: string
  author?: string
  authorUrl?: string
}

export class CustomCss {
  app: any
  themes: Record<string, ThemeManifest> = {}
  oldThemes: string[] = []
  snippets: string[] = []
  enabledSnippets = new Set<string>()
  theme = ''
  updates: Record<string, any> = {}
  csscache = new Map<string, string>()
  private reloadThemeSoon = debounce(() => void this.reloadTheme(), 100, true)
  private rescanThemesSoon = debounce(() => void this.readThemes().then(() => this.app.setting?.refreshCurrentPage?.()), 2000, true)

  constructor(app: any) {
    this.app = app
    app.vault.on('raw', (path: string) => this.onRaw(path))
  }

  private get dir(): string {
    return this.app.vault.configDir
  }
  getThemeFolder(): string {
    return this.dir + '/themes'
  }
  getSnippetsFolder(): string {
    return this.dir + '/snippets'
  }
  getThemePath(name: string): string {
    return `${this.getThemeFolder()}/${name}/theme.css`
  }
  getSnippetPath(name: string): string {
    return `${this.getSnippetsFolder()}/${name}.css`
  }

  private trigger(): void {
    try {
      this.app.workspace?.trigger?.('css-change')
      window.dispatchEvent(new Event('resize'))
    } catch {
      /* no workspace yet */
    }
  }

  private onRaw(path: string): void {
    if (!path.startsWith(this.dir + '/')) return
    if (this.theme && (path === this.getThemePath(this.theme) || path === `${this.getThemeFolder()}/${this.theme}.css`)) {
      this.csscache.delete(path)
      this.reloadThemeSoon()
    } else if (path.startsWith(this.getThemeFolder() + '/')) this.rescanThemesSoon()
    else if (path.startsWith(this.getSnippetsFolder() + '/') && path.endsWith('.css')) {
      this.csscache.delete(path)
      void this.readSnippets().then(() => this.applySnippets())
    }
  }

  /** Startup: scan folders, apply the configured theme and snippets. */
  async load(): Promise<void> {
    const cfg = this.app.vault.getConfig.bind(this.app.vault)
    this.theme = cfg('cssTheme') || ''
    this.enabledSnippets = new Set(cfg('enabledCssSnippets') || [])
    await this.readThemes()
    await this.readSnippets()
    await this.reloadTheme()
    await this.applySnippets()
  }

  async readThemes(): Promise<void> {
    const ad = this.app.vault.adapter
    const themes: Record<string, ThemeManifest> = {}
    const old: string[] = []
    try {
      if (await ad.exists(this.getThemeFolder())) {
        const list = await ad.list(this.getThemeFolder())
        for (const folder of list.folders) {
          const name = folder.split('/').pop()!
          try {
            const m = JSON.parse(await ad.read(folder + '/manifest.json')) as ThemeManifest
            if (m && m.name === name && (await ad.exists(folder + '/theme.css'))) themes[name] = m
          } catch {
            /* not a theme */
          }
        }
        for (const f of list.files) if (f.endsWith('.css')) old.push(f.split('/').pop()!.replace(/\.css$/, ''))
      }
    } catch {
      /* no themes folder */
    }
    this.themes = themes
    this.oldThemes = old.sort(naturalCompare)
  }

  async readSnippets(): Promise<void> {
    const ad = this.app.vault.adapter
    const out: string[] = []
    try {
      if (await ad.exists(this.getSnippetsFolder())) {
        const list = await ad.list(this.getSnippetsFolder())
        for (const f of list.files) {
          const base = f.split('/').pop()!
          if (base.endsWith('.css') && !base.startsWith('.')) out.push(base.slice(0, -4))
        }
      }
    } catch {
      /* no snippets folder */
    }
    this.snippets = out.sort(naturalCompare)
  }

  private async readCss(path: string): Promise<string | null> {
    if (this.csscache.has(path)) return this.csscache.get(path)!
    try {
      const css = await this.app.vault.adapter.read(path)
      this.csscache.set(path, css)
      return css
    } catch {
      return null
    }
  }

  async reloadTheme(): Promise<void> {
    let css = ''
    if (this.theme) {
      css = (await this.readCss(this.getThemePath(this.theme))) ?? (await this.readCss(`${this.getThemeFolder()}/${this.theme}.css`)) ?? ''
    }
    if (setThemeCss(css)) this.trigger()
  }

  async applySnippets(): Promise<void> {
    const m = new Map<string, string>()
    for (const name of this.snippets) {
      if (!this.enabledSnippets.has(name)) continue
      const css = await this.readCss(this.getSnippetPath(name))
      if (css !== null) m.set(name, css)
    }
    setSnippetStyles(m)
    this.trigger()
  }

  setTheme(name: string): void {
    this.theme = name
    this.app.vault.setConfig('cssTheme', name)
    void this.reloadTheme()
  }

  /** Same as `setTheme('')`. */
  reloadThemeList(): Promise<void> {
    return this.readThemes()
  }

  setCssEnabledStatus(name: string, enabled: boolean): void {
    if (enabled) this.enabledSnippets.add(name)
    else this.enabledSnippets.delete(name)
    this.app.vault.setConfig('enabledCssSnippets', [...this.enabledSnippets])
    void this.applySnippets()
  }

  isDarkMode(): boolean {
    return document.body.hasClass('theme-dark')
  }

  isThemeInstalled(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.themes, name) || this.oldThemes.includes(name)
  }

  hasUpdates(): boolean {
    return !!this.updates && Object.keys(this.updates).length > 0
  }

  /** The theme repo's manifest.json at HEAD, or undefined. */
  async getManifest(repo: string): Promise<any> {
    try {
      return await fetchUrl(rawUrl(repo, 'manifest.json')).json
    } catch {
      return undefined
    }
  }

  async removeTheme(name: string): Promise<void> {
    const ad = this.app.vault.adapter
    const dir = this.getThemeFolder()
    if (await ad.exists(`${dir}/${name}`)) await ad.rmdir(`${dir}/${name}`, true)
    const legacy = `${dir}/${name}.css`
    if (this.oldThemes.includes(name) && (await ad.exists(legacy))) await ad.remove(legacy)
    await this.readThemes()
    if (this.theme === name) this.setTheme('')
  }

  private downloadLegacyTheme(theme: { repo: string }): Promise<string> {
    return fetchUrl(rawUrl(theme.repo, 'obsidian.css')).text
  }

  private async installLegacyTheme(theme: { name: string; author?: string; repo: string }): Promise<void> {
    const vault = this.app.vault
    const css = await this.downloadLegacyTheme(theme)
    const root = this.getThemeFolder()
    if (!(await vault.adapter.exists(root))) await vault.adapter.mkdir(root)
    const dir = `${root}/${theme.name}`
    if (!(await vault.adapter.exists(dir))) await vault.adapter.mkdir(dir)
    const manifest = { name: theme.name, version: '0.0.0', minAppVersion: '0.16.0', author: theme.author }
    await vault.adapter.write(dir + '/theme.css', css)
    await vault.adapter.write(dir + '/manifest.json', JSON.stringify(manifest, null, 4))
    const legacy = `${root}/${theme.name}.css`
    if (await vault.adapter.exists(legacy)) await vault.adapter.remove(legacy)
    await this.readThemes()
  }

  /** Downloads manifest.json + theme.css of release `version` (falling back to the repo HEAD when the release
   *  has no such assets; no version = legacy obsidian.css theme) into `<configDir>/themes/<name>/`. */
  async installTheme(theme: { name: string; author?: string; repo: string }, version: string | null): Promise<void> {
    const { name, repo } = theme
    const notice = new Notice(t(C + 'msgInstallingTheme', { name }), 0)
    notice.containerEl.addClass('is-loading')
    const fail = (suffix = ''): void => {
      notice.containerEl.removeClass('is-loading')
      notice.containerEl.addClass('mod-error')
      notice.setMessage(t(C + 'msgFailedToInstallTheme', { name }) + suffix)
      setTimeout(() => notice.hide(), 3000)
    }
    if (!version) {
      await this.installLegacyTheme(theme)
      delete this.updates[name]
      notice.hide()
      return
    }
    let manifest = ''
    let css = ''
    try {
      manifest = await fetchUrl(releaseAssetUrl(repo, version, 'manifest.json')).text
      css = await fetchUrl(releaseAssetUrl(repo, version, 'theme.css')).text
    } catch (e) {
      if (manifest || !(e instanceof RequestUrlError) || e.status !== 404) {
        console.error(e)
        return fail()
      }
      try {
        manifest = await fetchUrl(rawUrl(repo, 'manifest.json')).text
        css = await fetchUrl(rawUrl(repo, 'theme.css')).text
      } catch (e2) {
        console.error(e2)
        return fail()
      }
    }
    if (JSON.parse(manifest).name !== name) {
      notice.containerEl.removeClass('is-loading')
      notice.setMessage(t(C + 'msgFailedToInstallTheme', { name }) + ' Theme name mismatch.')
      setTimeout(() => notice.hide(), 3000)
      return
    }
    const ad = this.app.vault.adapter
    const root = this.getThemeFolder()
    if (!(await ad.exists(root))) await ad.mkdir(root)
    const dir = root + '/' + name
    if (!(await ad.exists(dir))) await ad.mkdir(dir)
    await ad.write(dir + '/manifest.json', manifest)
    await ad.write(dir + '/theme.css', css)
    const legacy = `${root}/${name}.css`
    if (await ad.exists(legacy)) await ad.remove(legacy)
    notice.setMessage(t(C + 'msgSuccessfullyInstalledTheme', { name }))
    notice.containerEl.removeClass('is-loading')
    notice.containerEl.addClass('mod-success')
    setTimeout(() => notice.hide(), 3000)
    delete this.updates[name]
    this.csscache.delete(dir + '/theme.css')
    await this.readThemes()
    if (this.theme === name) await this.reloadTheme()
  }

  /** Records an update for one installed registry theme; resolves true when one is available. */
  async checkForUpdate(theme: CommunityThemeEntry): Promise<boolean | undefined> {
    const { name, repo } = theme
    if (!this.isThemeInstalled(name)) return
    const updates = this.updates || {}
    const installed = this.themes[name]?.version
    let remote: any = null
    try {
      remote = await fetchUrl(rawUrl(repo, 'manifest.json')).json
      if (!remote || !remote.name || remote.name !== name) return
    } catch {
      /* legacy theme: compare the css itself */
    }
    if (!remote) {
      const css = await this.downloadLegacyTheme(theme)
      const path = this.themes[name] ? this.getThemePath(name) : `${this.getThemeFolder()}/${name}.css`
      let local = ''
      try {
        local = await this.app.vault.adapter.read(path)
      } catch {
        return false
      }
      if (css !== local) {
        updates[name] = { themeInfo: theme }
        return true
      }
      return false
    }
    const version = await pickVersion(repo, remote)
    if (!installed || (version && isNewerVersion(installed, version))) {
      updates[name] = { themeInfo: theme, version }
      return true
    }
    return false
  }

  async checkForUpdates(): Promise<void> {
    this.updates = {}
    let list: CommunityThemeEntry[] | null = null
    try {
      list = await loadCommunityThemes()
    } catch (e) {
      console.error(e)
    }
    if (!list) {
      new Notice(t(C + 'msgFailedToInstallTheme'))
      return
    }
    for (const theme of list) {
      try {
        await this.checkForUpdate(theme)
      } catch (e) {
        console.error(e)
      }
    }
    const n = Object.keys(this.updates).length
    new Notice(n === 0 ? t(C + 'msgNoUpdatesFound') : t(C + 'msgUpdatesFound', { count: n }))
  }
}
