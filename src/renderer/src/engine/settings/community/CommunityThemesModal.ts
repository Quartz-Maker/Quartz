/* eslint-disable @typescript-eslint/no-explicit-any */
// "Community themes" browser (modal `mod-community-theme`).
import { Notice, Setting, ToggleComponent, setIcon, setTooltip, renderMatches, prepareSimpleSearch } from '../../ui'
import { Platform } from '../../keymap/Platform'
import { t, APP_NAME } from '../i18n'
import { CommunityModal, type CommunityItem, countNoun, renderReadme, withLoading } from './CommunityModal'
import { fetchUrl, rawUrl, repoUrl, pickVersion, isNewerVersion, formatCount, loadCommunityThemes, loadCommunityThemeStats } from './registry'

const C = 'plugins.customCss.'
const P = 'setting.thirdPartyPlugin.'
const A = 'setting.appearance.'

interface ThemeItem extends CommunityItem {
  repo: string
  modes: string[]
  screenshot: string
  nameEl: HTMLElement | null
  authorEl: HTMLElement | null
  updateIconEl: HTMLElement | null
}

/** Downsizes large screenshots one at a time so the grid stays light. */
function downsize(img: HTMLImageElement): void {
  if (!img.isShown() || (img.naturalWidth <= 640 && img.naturalHeight <= 320)) return
  try {
    const canvas = img.doc.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    const k = Math.min(512 / img.naturalWidth, 288 / img.naturalHeight)
    canvas.width = Math.floor(img.naturalWidth * k)
    canvas.height = Math.floor(img.naturalHeight * k)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = canvas.toDataURL()
  } catch (e) {
    console.log('Unable to downsize theme image', e)
  }
}

export class CommunityThemesModal extends CommunityModal<ThemeItem> {
  static activeInstance: CommunityThemesModal | null = null
  onlyShowUpdates = false
  declare currentModeToggleSetting: Setting
  declare currentModeToggle: ToggleComponent
  private resizeQueue: HTMLImageElement[] = []
  private resizing = false

  constructor(app: any) {
    super(app)
    this.sortOrderOptions = ['download', 'release', 'alphabetical']
    this.windowTitle = t(C + 'settingCommunityThemes')
    this.setTitle(t(C + 'settingCommunityThemes'))
    this.modalEl.addClass('mod-community-theme')
    this.search.setPlaceholder(t(C + 'promptFilter'))
    this.sortOrder = (localStorage.getItem('communityThemeSortOrder') as any) || 'download'
  }

  private queueResize(img: HTMLImageElement): void {
    this.resizeQueue.push(img)
    if (this.resizing) return
    this.resizing = true
    const next = (): void => {
      const i = this.resizeQueue.shift()
      if (!i) return void (this.resizing = false)
      downsize(i)
      setTimeout(next, 0)
    }
    setTimeout(next, 0)
  }

  open(): void {
    const active = CommunityThemesModal.activeInstance
    if (active && active !== this) {
      if (this.selectedItemId) void active.selectItem(this.selectedItemId)
      active.open()
      return
    }
    CommunityThemesModal.activeInstance = this
    super.open()
  }

  onClose(): void {
    super.onClose()
    localStorage.setItem('communityThemeSortOrder', this.sortOrder)
    this.onlyShowUpdates = false
    if (CommunityThemesModal.activeInstance === this) CommunityThemesModal.activeInstance = null
  }

  async onOpen(): Promise<void> {
    if (this.onlyShowUpdates) {
      this.currentModeToggleSetting.settingEl.detach()
      this.installedOnlyToggleSetting.settingEl.detach()
    } else if (this.app.vault.getConfig('theme') === 'system') {
      this.currentModeToggleSetting.settingEl.detach()
      this.currentModeToggle.setValue(false)
    }
    await super.onOpen()
  }

  addCustomControls(el: HTMLElement): void {
    this.currentModeToggleSetting = new Setting(el)
      .setName(this.app.vault.getConfig('theme') === 'obsidian' ? t(C + 'labelDarkThemeOnly') : t(C + 'labelLightThemeOnly'))
      .addToggle(tg => {
        this.currentModeToggle = tg.setValue(true).onChange(() => this.update())
      })
  }

  setOnlyShowUpdates(v: boolean): this {
    this.onlyShowUpdates = v
    return this
  }

  async loadItems(): Promise<Record<string, ThemeItem>> {
    const css = this.app.customCss
    let loaded = false
    const registry: Record<string, any> = {}
    let stats: Record<string, { download: number }> = {}
    const listP = loadCommunityThemes()
    const statsP = loadCommunityThemeStats()
    try {
      const list = await listP
      if (list === null) throw new Error('Failed to load themes')
      for (const e of list)
        if (e.author && typeof e.author === 'string' && e.name && typeof e.name === 'string' && e.repo && typeof e.repo === 'string' && Array.isArray(e.modes)) registry[e.name] = e
      loaded = true
    } catch (e) {
      console.error(e)
    }
    try {
      stats = await statsP
    } catch (e) {
      console.error(e)
    }
    const downloads = (name: string): number => (stats && Object.hasOwn(stats, name) ? stats[name].download : 0)
    this.listStatusEl.empty()
    this.listStatusEl.toggle(!loaded)
    if (!loaded)
      this.listStatusEl.createDiv('community-modal-search-results-status-content', c => {
        c.createDiv({ text: t(C + 'msgLoadError') })
        c.createDiv({ cls: 'community-modal-search-results-cta', text: t('dialogue.buttonRetry') }).addEventListener('click', async () => {
          this.items = await withLoading(this.emptyStateEl, () => this.loadItems())
          this.update()
        })
      })
    const items: Record<string, ThemeItem> = {}
    items[''] = this.addThemeCard({ name: '', author: APP_NAME, modes: ['dark', 'light'], screenshot: css.isDarkMode() ? 'dark.png' : 'light.png', repo: 'obsidianmd/obsidian-releases', downloads: 0 })
    for (const name in css.themes)
      items[name] = this.addThemeCard({ name, author: '', modes: ['dark', 'light'], screenshot: '', repo: '', ...(registry[name] || {}), ...css.themes[name], downloads: downloads(name) })
    for (const name of css.oldThemes)
      if (!Object.hasOwn(css.themes, name)) items[name] = this.addThemeCard({ name, author: '', modes: ['dark', 'light'], screenshot: '', repo: '', ...(registry[name] || {}), downloads: downloads(name) })
    for (const name in registry) {
      if (Object.hasOwn(items, name)) continue
      const e = registry[name]
      if (!e.legacy) items[name] = this.addThemeCard({ name: e.name, author: e.author, repo: e.repo, modes: e.modes, screenshot: e.screenshot, downloads: downloads(name) })
    }
    return items
  }

  addThemeCard(e: { name: string; author: string; repo: string; modes: string[]; screenshot: string; downloads: number }): ThemeItem {
    const el = createDiv({ cls: 'community-item tappable', attr: { tabIndex: -1 } })
    el.addEventListener('click', () => void this.selectItem(e.name))
    return { name: e.name, author: e.author, repo: e.repo, modes: e.modes, screenshot: e.screenshot, downloads: e.downloads, el, nameEl: null, authorEl: null, updateIconEl: null, updated: 0, init: false, matches: null, score: 0 }
  }

  updateItems(): ThemeItem[] {
    const css = this.app.customCss
    const query = this.search.getValue().trim().toLowerCase()
    const installedOnly = this.installedOnlyToggle.getValue()
    const onlyUpdates = this.onlyShowUpdates
    const modeOnly = !onlyUpdates && this.currentModeToggle.getValue()
    const installed = new Set<string>([...css.oldThemes, ...Object.keys(css.themes), ''])
    const mode = css.isDarkMode() ? 'dark' : 'light'
    const match = query ? prepareSimpleSearch(query) : null
    const out: ThemeItem[] = []
    let def: ThemeItem | null = null
    for (const key in this.items) {
      if (!Object.hasOwn(this.items, key)) continue
      const item = this.items[key]
      if (item.name === '') def = item
      if (installedOnly && !installed.has(item.name)) continue
      if (modeOnly && !item.modes.includes(mode)) continue
      if (onlyUpdates && !Object.hasOwn(css.updates, item.name)) continue
      item.matches = null
      item.score = 0
      if (!match) {
        out.push(item)
        continue
      }
      if (!item.name) continue
      const r = match(item.name.toLowerCase() + (item.author || '').toLowerCase())
      if (r) {
        item.matches = r.matches as any
        item.score = r.score
        out.push(item)
      }
    }
    this.sortItems(out)
    if (def && out.includes(def)) {
      out.remove(def)
      out.unshift(def)
    }
    this.queueRender(out, item => {
      const el = item.el
      let name = item.name
      const isDefault = name === ''
      if (!item.init) {
        item.nameEl = el.createDiv('community-item-name')
        item.authorEl = el.createDiv('community-item-author')
        item.updateIconEl = el.createDiv('community-item-badge mod-update')
        if (!isDefault && item.downloads) {
          const d = el.createDiv('community-item-downloads')
          d.createSpan({}, s => setIcon(s, 'lucide-download-cloud'))
          d.createSpan({ cls: 'community-item-downloads-text', text: formatCount(item.downloads) })
        }
        if (item.repo && item.screenshot) {
          const img = el.createEl('img', { cls: 'community-item-screenshot', attr: { alt: name, loading: 'lazy' } })
          img.crossOrigin = 'anonymous'
          img.style.opacity = '0'
          img.src = rawUrl(item.repo, item.screenshot)
          img.addEventListener('load', () => {
            img.style.opacity = ''
            if (img.naturalWidth > 640 || img.naturalHeight > 320) this.queueResize(img)
          })
        } else el.createDiv('community-item-screenshot mod-unavailable', d => setIcon(d.createDiv('placeholder-icon'), 'lucide-camera-off'))
        item.init = true
      }
      const isInstalled = installed.has(name)
      const active = css.theme === name && (isInstalled || isDefault)
      el.toggleClass('mod-active', active)
      const nameEl = item.nameEl!
      nameEl.empty()
      if (isDefault) name = t(A + 'labelDefaultTheme')
      renderMatches(nameEl, name, item.matches)
      if (active) nameEl.createSpan({ cls: 'flair mod-pop', text: t(A + 'labelCurrentlyActive') })
      else if (css.oldThemes.includes(name) && !Object.hasOwn(css.themes, name)) nameEl.createSpan({ cls: 'flair', text: t(C + 'labelLegacy') })
      else if (isInstalled || isDefault) nameEl.createSpan({ cls: 'flair', text: t(C + 'labelInstalled') })
      const authorEl = item.authorEl!
      authorEl.empty()
      if (item.author) {
        authorEl.setText(t(P + 'labelByAuthor'))
        renderMatches(authorEl, item.author, item.matches, -name.length)
      }
      const badge = item.updateIconEl!
      if (Object.hasOwn(css.updates, item.name)) {
        if (!badge.firstChild) {
          setIcon(badge, 'lucide-alert-triangle')
          setTooltip(badge, t(C + 'labelUpdateAvailable'))
        }
        badge.show()
      } else badge.hide()
    })
    this.searchSummaryEl.setText(t(C + 'labelSearchSummary', { themeCount: countNoun('nouns.themeWithCount', out.length) }))
    return out
  }

  async showItem(item: ThemeItem): Promise<void> {
    const css = this.app.customCss
    const details = this.detailsEl
    let name = item.name
    const repo = item.repo
    const isDefault = name === ''
    const isInstalled = css.isThemeInstalled(name)
    const active = css.theme === name && (isDefault || isInstalled)
    const legacy = css.oldThemes.includes(name) && !Object.hasOwn(css.themes, name)
    if (isDefault) name = t(A + 'labelDefaultTheme')
    const installedVersion: string = Object.hasOwn(css.themes, item.name) ? css.themes[item.name].version || '' : ''
    const manifest = await css.getManifest(item.repo)
    let version = ''
    if (manifest) version = (await pickVersion(repo, manifest)) || manifest.version
    const info = details.createDiv('community-modal-info')
    const meta = info.createDiv('community-modal-meta')
    const nameEl = meta.createDiv({ cls: 'community-modal-info-name', text: name })
    if (isInstalled) nameEl.createSpan({ cls: 'flair mod-pop', text: legacy ? t(C + 'labelLegacy') : t(P + 'labelInstalled') })
    if (item.downloads)
      meta.createDiv('community-modal-info-downloads', d => {
        d.createSpan({}, s => setIcon(s, 'lucide-download-cloud'))
        d.createSpan({ cls: 'community-modal-info-downloads-text', text: formatCount(item.downloads) })
      })
    if (version) {
      const v = meta.createDiv({ cls: 'community-modal-info-version', text: t(P + 'labelVersion', { version }) })
      if (isInstalled && installedVersion) v.appendText(t(P + 'labelCurrentlyInstalledVersion', { version: installedVersion }))
    }
    const author = item.author || manifest?.author
    if (author) {
      const a = meta.createDiv({ cls: 'community-modal-info-author', text: t(P + 'labelByAuthor') })
      if (manifest?.authorUrl) a.createEl('a', { href: manifest.authorUrl, text: author, attr: { target: '_blank', rel: 'noopener' } })
      else a.appendText(author)
    }
    if (repo && !isDefault) {
      const url = repoUrl(repo)
      meta.createDiv({ cls: 'community-modal-info-repo', text: t(P + 'labelRepository') }).createEl('a', { href: url, text: url, attr: { target: '_blank', rel: 'noopener' } })
    }
    const install = async (btn: HTMLElement): Promise<void> => {
      let v: string | null = null
      if (manifest) {
        v = await pickVersion(repo, manifest)
        if (!v) return void new Notice('No appropriate version found.')
      }
      await withLoading(btn, () => css.installTheme(item, v))
      this.update()
      this.onChangeCallback?.()
      await this.selectItem(item.name)
    }
    const buttons = meta.createDiv('community-modal-button-container')
    if (active) {
      if (isDefault) buttons.createEl('button', { text: t(A + 'labelCurrentlyActive'), attr: { disabled: true } })
      else
        buttons.createEl('button', { text: t(C + 'labelStopUse') }).addEventListener('click', async () => {
          css.setTheme('')
          this.update()
          await this.selectItem(item.name)
        })
    } else {
      const use = buttons.createEl('button', { cls: 'mod-cta', text: isDefault || isInstalled ? t(C + 'labelUse') : t(C + 'labelInstallAndUse') })
      use.addEventListener('click', async () => {
        if (!isDefault && !isInstalled) await install(use)
        css.setTheme(item.name)
        this.update()
        await this.selectItem(item.name)
      })
    }
    if (!isDefault && isInstalled) {
      if (Object.hasOwn(css.updates, item.name) || isNewerVersion(installedVersion, version)) {
        const upd = buttons.createEl('button', { cls: 'mod-cta', text: t(C + 'labelUpdate') })
        upd.addEventListener('click', async () => {
          await install(upd)
          this.update()
          await this.selectItem(item.name)
        })
      } else if (!manifest)
        buttons.createEl('button', { text: t(A + 'buttonCheckForUpdates') }).addEventListener('click', async () => {
          if (await css.checkForUpdate(item)) await this.selectItem(item.name)
          else new Notice(t(C + 'msgNoUpdatesFound'))
        })
    }
    if (css.isThemeInstalled(item.name))
      buttons.createEl('button', { text: t(P + 'labelUninstall') }).addEventListener('click', async () => {
        await css.removeTheme(item.name)
        this.update()
        this.onChangeCallback?.()
        await this.selectItem(item.name)
        new Notice(t(C + 'msgDeletedTheme', { title: item.name }))
      })
    let readme: string
    if (isDefault) readme = '\nA simple theme designed to feel intuitive across all platforms. Supports light and dark mode.\n'
    else
      try {
        readme = await fetchUrl(rawUrl(repo, 'README.md')).text
      } catch {
        readme = t(C + 'labelNoReadme')
      }
    renderReadme(info.createDiv('community-modal-readme markdown-rendered'), readme, repo)
    if (item.el && !Platform.isPhone) item.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}
