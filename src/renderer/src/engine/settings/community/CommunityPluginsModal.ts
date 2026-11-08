/* eslint-disable @typescript-eslint/no-explicit-any */
// "Community plugins" browser (modal `mod-community-plugin`) and the donation modal.
import { ConfirmationModal, Notice, setIcon, setTooltip, renderMatches, prepareSimpleSearch } from '../../ui'
import { Platform } from '../../keymap/Platform'
import { t } from '../i18n'
import { CommunityModal, type CommunityItem, countNoun, renderReadme, withButtonLoading } from './CommunityModal'
import { fetchUrl, rawUrl, repoUrl, pickVersion, isNewerVersion, formatCount, truncate, loadCommunityPlugins, loadCommunityPluginStats } from './registry'

const P = 'setting.thirdPartyPlugin.'

interface PluginItem extends CommunityItem {
  id: string
  description?: string
  repo: string
  nameEl: HTMLElement | null
  authorEl: HTMLElement | null
  descEl: HTMLElement | null
}

/** "Donate to support <plugin>". */
export class DonateModal extends ConfirmationModal {
  constructor(app: any, name: string, funding: string | Record<string, string>) {
    super(app)
    this.setTitle(t(P + 'labelDonateModalTitle', { name }))
    const f = document.createDocumentFragment()
    f.createEl('p', { text: t(P + 'labelDonateModalText1') })
    f.createEl('p', { text: t(P + 'labelDonateModalText2') })
    f.createEl('p', { text: t(P + 'labelDonateModalText3') })
    f.createEl('hr')
    const link = (p: HTMLElement, url: string): void => void p.createEl('a', { text: url, href: url, cls: 'external-link', attr: { target: '_blank' } })
    if (typeof funding === 'string') f.createEl('p', { text: t(P + 'labelSupportThisPlugin') + ' ' }, p => link(p, funding))
    else if (funding && typeof funding === 'object')
      for (const k of Object.keys(funding)) f.createEl('p', { text: k + ': ' }, p => link(p, funding[k]))
    this.setContent(f)
    this.addButton(b => b.setCta().setButtonText(t('dialogue.buttonDone')).onClick(() => this.close()))
  }
}

export class CommunityPluginsModal extends CommunityModal<PluginItem> {
  static activeInstance: CommunityPluginsModal | null = null

  constructor(app: any) {
    super(app)
    this.sortOrderOptions = ['download', 'update', 'release', 'alphabetical']
    this.windowTitle = t(P + 'name')
    this.setTitle(t(P + 'name'))
    this.modalEl.addClass('mod-community-plugin')
    this.search.setPlaceholder(t(P + 'placeholderCommunityPlugins'))
    this.sortOrder = (localStorage.getItem('communityPluginSortOrder') as any) || 'download'
  }

  open(): void {
    const active = CommunityPluginsModal.activeInstance
    if (active && active !== this) {
      if (this.selectedItemId) void active.selectItem(this.selectedItemId)
      active.open()
      return
    }
    CommunityPluginsModal.activeInstance = this
    super.open()
  }

  onClose(): void {
    super.onClose()
    localStorage.setItem('communityPluginSortOrder', this.sortOrder)
    if (CommunityPluginsModal.activeInstance === this) CommunityPluginsModal.activeInstance = null
  }

  async loadItems(): Promise<Record<string, PluginItem>> {
    let list: any[] | null = null
    try {
      list = await loadCommunityPlugins()
    } catch (e) {
      console.error(e)
    }
    if (!list) throw new Error(t(P + 'msgFailedLoadPlugins'))
    let stats: Record<string, any> = {}
    try {
      stats = (await loadCommunityPluginStats()) || {}
    } catch (e) {
      console.error(e)
    }
    const items: Record<string, PluginItem> = {}
    for (const entry of list) {
      const id = entry.id
      let downloads = 0
      let updated = 0
      if (Object.prototype.hasOwnProperty.call(stats, id)) {
        downloads = stats[id].downloads ?? 0
        updated = stats[id].updated ?? 0
      }
      const el = createDiv({ cls: 'community-item tappable', attr: { tabIndex: -1 } })
      el.addEventListener('click', () => void this.selectItem(id))
      items[id] = { ...entry, downloads, updated, el, nameEl: null, authorEl: null, descEl: null, init: false, matches: null, score: 0 }
    }
    const sel = this.selectedItemId
    if (sel && !Object.prototype.hasOwnProperty.call(items, sel)) this.search.setValue(sel.split('-').join(' '))
    return items
  }

  updateItems(): PluginItem[] {
    const query = this.search.getValue().trim().toLowerCase()
    const installedOnly = this.installedOnlyToggle.getValue()
    const manifests = this.app.plugins.manifests
    const match = query ? prepareSimpleSearch(query) : null
    const out: PluginItem[] = []
    for (const id in this.items) {
      if (!Object.prototype.hasOwnProperty.call(this.items, id)) continue
      const item = this.items[id]
      if (!item.id || !item.name || !item.repo) continue
      item.matches = null
      item.score = 0
      if (installedOnly && !Object.prototype.hasOwnProperty.call(manifests, item.id)) continue
      if (!match) {
        out.push(item)
        continue
      }
      const text = item.name.toLowerCase() + (item.author || '').toLowerCase() + (item.description || '').toLowerCase()
      const r = match(text)
      if (r) {
        item.matches = r.matches as any
        item.score = r.score
        out.push(item)
      }
    }
    this.sortItems(out)
    this.queueRender(out, item => {
      const { el, id, name, matches } = item
      const author = item.author || ''
      const desc = item.description || ''
      if (!item.init) {
        item.nameEl = el.createDiv('community-item-name')
        item.authorEl = el.createDiv('community-item-author')
        if (item.downloads) {
          const d = el.createDiv('community-item-downloads')
          d.createSpan({}, s => setIcon(s, 'lucide-download-cloud'))
          d.createSpan({ cls: 'community-item-downloads-text', text: formatCount(item.downloads) })
        }
        if (item.updated !== 0) el.createDiv({ cls: 'community-item-updated', text: t(P + 'labelLastUpdated', { time: (window as any).moment(item.updated).fromNow() }) })
        item.descEl = el.createDiv({ cls: 'community-item-desc' })
        item.init = true
      }
      const nameEl = item.nameEl!
      const authorEl = item.authorEl!
      const descEl = item.descEl!
      nameEl.empty()
      authorEl.empty()
      descEl.empty()
      renderMatches(nameEl, name, matches)
      if (Object.prototype.hasOwnProperty.call(manifests, id)) nameEl.createSpan({ cls: 'flair mod-pop', text: t(P + 'labelInstalled') })
      if (author) {
        authorEl.setText(t(P + 'labelByAuthor'))
        renderMatches(authorEl, author, matches, -name.length)
      }
      if (desc) renderMatches(descEl, truncate(desc, 200), matches, -(name.length + author.length))
    })
    this.searchSummaryEl.setText(t(P + 'labelSearchSummary', { pluginCount: countNoun('nouns.pluginWithCount', out.length) }))
    return out
  }

  async showItem(item: PluginItem): Promise<void> {
    const app = this.app
    const details = this.detailsEl
    const { id, name, description, repo } = item
    let manifest: any = null
    try {
      manifest = await fetchUrl(rawUrl(repo, 'manifest.json')).json
      if (!manifest.id || manifest.id !== id) {
        new Notice('Plugin ID mismatch.')
        return
      }
    } catch (e) {
      console.error(e)
      new Notice(t(P + 'msgFailedToLoadManifest'))
      return
    }
    const version = (await pickVersion(repo, manifest)) || manifest.version
    const info = details.createDiv('community-modal-info')
    const meta = info.createDiv('community-modal-meta')
    const nameEl = meta.createDiv({ cls: 'community-modal-info-name', text: name })
    const installed = app.plugins.manifests[id]
    if (installed) nameEl.createSpan({ cls: 'flair mod-pop', text: t(P + 'labelInstalled') })
    if (item.downloads)
      meta.createDiv('community-modal-info-downloads', d => {
        d.createSpan({}, s => setIcon(s, 'lucide-download-cloud'))
        d.createSpan({ cls: 'community-modal-info-downloads-text', text: formatCount(item.downloads) })
      })
    if (version) {
      const v = meta.createDiv({ cls: 'community-modal-info-version', text: t(P + 'labelVersion', { version }) })
      if (installed && installed.version) v.appendText(t(P + 'labelCurrentlyInstalledVersion', { version: installed.version }))
    }
    const author = item.author || manifest.author
    if (author) {
      const a = meta.createDiv({ cls: 'community-modal-info-author', text: t(P + 'labelByAuthor') })
      if (manifest.authorUrl) a.createEl('a', { href: manifest.authorUrl, text: author, attr: { target: '_blank', rel: 'noopener' } })
      else a.appendText(author)
    }
    const url = repoUrl(repo)
    meta.createDiv({ cls: 'community-modal-info-repo', text: t(P + 'labelRepository') }).createEl('a', { href: url, text: url, attr: { target: '_blank', rel: 'noopener' } })
    if (item.updated !== 0)
      meta.createDiv({ cls: 'community-modal-info-repo', text: t(P + 'labelLastUpdate') }, d => {
        d.createEl('a', { href: url + '/releases/latest', text: (window as any).moment(item.updated).fromNow(), attr: { target: '_blank', rel: 'noopener' } }, a =>
          setTooltip(a, t(P + 'tooltipViewLastUpdate'))
        )
      })
    if (description) meta.createDiv({ cls: 'community-modal-info-desc', text: description })
    const unsupported = !Platform.isDesktopApp && manifest.isDesktopOnly
    if (unsupported) meta.createDiv({ cls: 'mod-warning', text: t(P + 'labelUnsupported') })
    const buttons = meta.createDiv('community-modal-button-container')
    const install = buttons.createEl('button', { cls: 'mod-cta', text: t(P + 'buttonInstall') })
    install.addEventListener('click', async () => {
      if (unsupported) return void new Notice(t(P + 'labelUnsupported'))
      const v = await pickVersion(repo, manifest)
      if (!v) return void new Notice('No appropriate version found.')
      await withButtonLoading(install, () => app.plugins.installPlugin(repo, v, manifest))
      this.update()
      this.onChangeCallback?.()
      await this.selectItem(item.id)
    })
    if (installed) {
      if (isNewerVersion(installed.version, version)) install.setText(t(P + 'buttonUpdate'))
      else install.detach()
      const running = app.plugins.getPlugin(id)
      if (running) {
        if (app.setting.pluginTabs.some((tab: any) => tab.id === id))
          buttons.createEl('button', { text: t('setting.options') }).addEventListener('click', () => {
            this.openSettings()
            app.setting.openTabById(manifest.id)
          })
        if (Object.keys(app.commands.commands).some(c => c.startsWith(id + ':')))
          buttons.createEl('button', { text: t('setting.hotkeys.name') }).addEventListener('click', () => {
            this.openSettings()
            const tab = app.setting.openTabById('hotkeys')
            tab?.setQuery?.(manifest.id)
          })
      }
      buttons.createEl('button', { cls: running ? 'mod-destructive' : 'mod-cta', text: t(P + (running ? 'buttonDisable' : 'buttonEnable')) }).addEventListener('click', async () => {
        if (running) await app.plugins.disablePluginAndSave(id)
        else await app.plugins.enablePluginAndSave(id)
        this.onChangeCallback?.()
        await this.selectItem(item.id)
      })
      buttons.createEl('button', { cls: 'mod-destructive', text: t(P + 'labelUninstall') }).addEventListener('click', async () => {
        await app.plugins.uninstallPlugin(id)
        this.update()
        this.onChangeCallback?.()
        await this.selectItem(item.id)
      })
    }
    buttons.createEl('button', { text: t(P + 'buttonCopyShareLink') }).addEventListener('click', async () => {
      await navigator.clipboard.writeText('quartz://show-plugin?id=' + encodeURIComponent(id))
      new Notice(t('interface.copied', { item: '' }))
    })
    if (manifest.fundingUrl)
      buttons.createEl('button', { text: t(P + 'buttonDonate') }).addEventListener('click', () => new DonateModal(app, item.name, manifest.fundingUrl).open())
    let readme: string
    try {
      readme = await fetchUrl(rawUrl(repo, 'README.md')).text
    } catch {
      readme = t(P + 'labelNoReadme')
    }
    renderReadme(info.createDiv('community-modal-readme markdown-rendered'), readme, repo)
    this.scrollIntoView(id)
  }
}
