/* eslint-disable @typescript-eslint/no-explicit-any */
// Core plugins (id `plugins`), Community plugins (id `community-plugins`) and Keychain
// (id `keychain`) tabs.
import { t } from '../i18n'
import { BuiltinTab } from '../util'
import { Modal, Notice, Setting, SettingGroup, Menu, ConfirmationModal } from '../../ui'
import { electron } from '../../node'
import { CommunityPluginsModal, DonateModal } from '../community/CommunityPluginsModal'
import { withLoading } from '../community/CommunityModal'

// ----------------------------------------------------------------------------------------------
export class CorePluginsTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'plugins', t('setting.builtinPlugins'), 'toy-brick')
    app.internalPlugins?.on?.('change', () => this.app.setting.activeTab === this && !this.togglingId && this.app.setting.refreshCurrentPage())
  }
  private togglingId: string | null = null

  getSettingDefinitions(): any[] {
    const app = this.app
    const plugins = Object.values<any>(app.internalPlugins.plugins)
      .filter(p => !p.instance.hiddenFromList)
      .sort((a, b) => a.instance.name.localeCompare(b.instance.name))
    return [
      {
        type: 'list',
        search: {
          placeholder: t('setting.corePlugin.placeholderSearchPlugin'),
          match: (d: any, q: string) => !q.trim() || (d.name + ' ' + (d.desc ?? '')).toLowerCase().includes(q.trim().toLowerCase())
        },
        items: plugins.map(p => ({
          name: p.instance.name,
          desc: p.instance.description ?? '',
          render: (s: Setting) => {
            s.setIcon(null)
            let gear: HTMLElement | undefined
            s.addExtraButton(b => {
              b.setIcon('lucide-settings').setTooltip(t('setting.pluginOptions')).onClick(() => {
                const tb = app.setting.findTabById(p.id)
                if (tb) app.setting.openTab(tb)
              })
              gear = b.extraSettingsEl
              if (!p.enabled || !app.setting.findTabById(p.id)) gear.hide()
            })
            s.addExtraButton(b => {
              b.setIcon('lucide-plus-circle').setTooltip(t('setting.hotkeys.name')).onClick(() => {
                const hk = app.setting.findTabById('hotkeys')
                if (!hk) return
                hk.setQuery?.(p.instance.name + ':')
                app.setting.openTab(hk)
              })
              b.extraSettingsEl.addClass('mod-hotkeys')
              if (!p.enabled) b.extraSettingsEl.hide()
            })
            s.addToggle(tg =>
              tg.setValue(p.enabled).onChange(async (v: boolean) => {
                this.togglingId = p.id
                await app.internalPlugins.setEnabled(p.id, v)
                this.togglingId = null
                gear?.toggle(v && !!app.setting.findTabById(p.id))
              })
            )
          }
        }))
      }
    ]
  }
}

// ----------------------------------------------------------------------------------------------
export class CommunityPluginsTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'community-plugins', t('setting.thirdPartyPlugin.name'), 'puzzle')
    app.plugins?.on?.('changed', () => this.app.setting.activeTab === this && this.app.setting.refreshCurrentPage())
    // right-click a plugin row: its actions menu; click its name/description: its page in the browser
    this.containerEl.addEventListener('contextmenu', (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest?.('.setting-item[data-plugin-id]')
      const m = row && this.app.plugins.manifests[row.getAttribute('data-plugin-id')!]
      if (m) this.buildPluginActionsMenu(Menu.forEvent(e), m)
    })
    this.containerEl.addEventListener('click', (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const info = (e.target as HTMLElement).closest?.('.setting-item[data-plugin-id] .setting-item-info')
      const row = info?.closest('[data-plugin-id]')
      const m = row && this.app.plugins.manifests[row.getAttribute('data-plugin-id')!]
      if (m) new CommunityPluginsModal(this.app).setAutoOpen(m.id).open()
    })
  }

  private refresh(): void {
    this.app.setting.refreshCurrentPage()
  }

  getSettingDefinitions(): any[] {
    const app = this.app
    const plugins = app.plugins
    const T = 'setting.thirdPartyPlugin.'
    if (!plugins.isEnabled()) return this.restricted()
    const defs: any[] = []
    defs.push({
      name: t(T + 'optionRestrictedMode'),
      desc: t(T + 'optionRestrictedModeDescription'),
      render: (s: any) =>
        s.addButton((b: any) =>
          b.setButtonText(t(T + 'buttonTurnOn')).onClick(async () => {
            await plugins.setEnable(false)
            window.location.reload()
          })
        )
    })
    defs.push({
      name: t(T + 'optionBrowseCommunityPlugins'),
      desc: t(T + 'optionBrowseCommunityPluginsDescription'),
      render: (s: any) => s.addButton((b: any) => b.setButtonText(t(T + 'buttonBrowse')).onClick(() => new CommunityPluginsModal(app).open()))
    })
    const manifests: Record<string, any> = plugins.manifests
    const updates: Record<string, any> = plugins.updates
    const nUpdates = Object.keys(updates).length
    const ids = Object.keys(manifests).sort((a, b) => manifests[a].name.localeCompare(manifests[b].name))
    defs.push({
      name: t(T + 'labelCurrentPlugins'),
      render: (s: any) => {
        s.setDesc(t(T + 'labelCurrentlyInstalled', { count: ids.length }) + ' ' + (nUpdates > 0 ? t(T + 'msgUpdatesFound', { count: nUpdates }) : ''))
        if (nUpdates > 0)
          s.addButton((b: any) =>
            b.setButtonText(t(T + 'buttonUpdateAllPlugins')).onClick(() =>
              withLoading(this.containerEl, async () => {
                for (const id of Object.keys(updates)) {
                  const u = updates[id]
                  if (u) await plugins.installPlugin(u.repo, u.version, u.manifest)
                }
                this.refresh()
              })
            )
          )
        else if (ids.length)
          s.addButton((b: any) =>
            b.setButtonText(t(T + 'buttonCheckForUpdates')).onClick(() =>
              withLoading(this.containerEl, async () => {
                await plugins.checkForUpdates(false)
                this.refresh()
              })
            )
          )
      }
    })
    defs.push({
      name: t(T + 'optionAutomaticUpdateCheck'),
      desc: t(T + 'optionAutomaticUpdateCheckDesc'),
      render: (s: any) => s.addToggle((tg: any) => tg.setValue(!!plugins.autoCheckForUpdates).onChange((v: boolean) => plugins.setAutomaticUpdateCheck(v)))
    })
    const items: any[] = []
    // running plugins whose folder is gone (e.g. deleted on disk) can still be turned off
    for (const id of Object.keys(plugins.plugins)) {
      if (Object.hasOwn(manifests, id)) continue
      const m = plugins.plugins[id].manifest
      items.push({
        name: m.name,
        desc: m.description,
        render: (s: any) =>
          s.addToggle((tg: any) =>
            tg.setValue(true).onChange(async () => {
              await plugins.disablePluginAndSave(m.id)
              this.refresh()
            })
          )
      })
    }
    for (const id of ids) {
      const m = manifests[id]
      items.push({ name: m.name, desc: m.description, aliases: m.author ? [m.author] : undefined, render: (s: any) => this.renderInstalled(s, m) })
    }
    defs.push({
      type: 'list',
      heading: t(T + 'labelInstalledPlugins'),
      extraButtons: [
        (b: any) =>
          b.setIcon('lucide-refresh-cw').setTooltip(t(T + 'buttonReloadPlugins')).onClick(async () => {
            await plugins.loadManifests()
            new Notice(t(T + 'msgReloadedThirdPartyPlugins'))
            this.refresh()
          }),
        (b: any) =>
          b.setIcon('lucide-folder-open').setTooltip(t(T + 'buttonOpenPluginsFolder')).onClick(async () => {
            const dir = plugins.getPluginFolder()
            if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir)
            app.openWithDefaultApp ? app.openWithDefaultApp(dir) : (electron() as any).shell?.openPath?.(app.vault.adapter.getFullPath(dir))
          })
      ],
      search: {
        placeholder: t(T + 'placeholderSearchInstalledPlugin'),
        match: (d: any, q: string) => {
          const words = q.trim().toLowerCase()
          if (!words) return true
          const ws = words.split(' ')
          const has = (x: string): boolean => ws.every(w => !w || x.includes(w))
          return has((d.name ?? '').toLowerCase()) || has(typeof d.desc === 'string' ? d.desc.toLowerCase() : '') || has((d.aliases?.[0] ?? '').toLowerCase())
        }
      },
      items,
      emptyState: t(T + 'labelNoInstalledPlugins')
    })
    return defs
  }

  private renderInstalled(s: Setting, m: any): void {
    const app = this.app
    const plugins = app.plugins
    const T = 'setting.thirdPartyPlugin.'
    s.settingEl.setAttr('data-plugin-id', m.id)
    s.setIcon(null)
    s.nameEl.empty()
    s.nameEl.appendText(m.name)
    if (m.version) {
      s.nameEl.appendText(' ')
      s.nameEl.createSpan({ cls: 'u-muted u-small u-numeric', text: 'v' + m.version })
    }
    if (m.author) {
      s.nameEl.appendText(' ')
      s.nameEl.createSpan({ cls: 'u-muted u-small', text: t(T + 'labelByAuthor') + m.author })
    }
    const u = plugins.updates[m.id]
    if (u)
      s.addButton(b =>
        b
          .setButtonText(t(T + 'buttonUpdate'))
          .setTooltip(t(T + 'msgUpdatePlugin', { version: u.version }))
          .onClick(() =>
            withLoading(s.settingEl, async () => {
              await plugins.installPlugin(u.repo, u.version, u.manifest)
              this.refresh()
            })
          )
      )
    s.addExtraButton(b => {
      const el = b.extraSettingsEl
      b.setIcon('lucide-more-vertical')
        .setTooltip(t('interface.menu.moreOptions'))
        .onClick(() => {
          if (el.hasClass('has-active-menu')) return
          const menu = new Menu()
          this.buildPluginActionsMenu(menu, m)
          const r = el.getBoundingClientRect()
          menu.setParentElement(el).showAtPosition({ x: r.x, y: r.bottom, width: r.width, overlap: true, left: true })
        })
    })
    s.addToggle(tg =>
      tg.setValue(Object.hasOwn(plugins.plugins, m.id)).onChange(async (v: boolean) => {
        if (v) {
          if (!(await plugins.enablePluginAndSave(m.id))) tg.setValue(false)
        } else await plugins.disablePluginAndSave(m.id)
      })
    )
    s.infoEl.style.cursor = 'pointer'
  }

  /** The ⋮ / right-click menu of an installed plugin (`buildPluginActionsMenu`). */
  buildPluginActionsMenu(menu: Menu, m: any): void {
    const app = this.app
    const plugins = app.plugins
    const T = 'setting.thirdPartyPlugin.'
    let hasTab = false
    let hasCommands = false
    if (plugins.getPlugin(m.id)) {
      hasTab = app.setting.pluginTabs.some((tab: any) => tab.id === m.id)
      hasCommands = Object.keys(app.commands.commands).some(c => c.startsWith(m.id + ':'))
    }
    menu.addSections(['info', 'view', 'system', 'danger'])
    if (hasTab) menu.addItem(i => i.setSection('info').setIcon('lucide-settings').setTitle(t(T + 'actionSettings')).onClick(() => app.setting.openTabById(m.id)))
    if (hasCommands)
      menu.addItem(i =>
        i
          .setSection('info')
          .setIcon('lucide-keyboard')
          .setTitle(t('setting.hotkeys.name'))
          .onClick(() => app.setting.openTabById('hotkeys')?.setQuery?.(m.id))
      )
    menu.addItem(i => i.setSection('view').setIcon('lucide-info').setTitle(t(T + 'actionViewDetails')).onClick(() => new CommunityPluginsModal(app).setAutoOpen(m.id).open()))
    menu.addItem(i =>
      i
        .setSection('view')
        .setIcon('lucide-globe')
        .setTitle(t(T + 'actionOpenCommunityPage'))
        .onClick(() => window.open('https://community.obsidian.md/plugins/' + m.id, '_external'))
    )
    if (m.fundingUrl) menu.addItem(i => i.setSection('view').setIcon('lucide-heart').setTitle(t(T + 'buttonDonate')).onClick(() => new DonateModal(app, m.name, m.fundingUrl).open()))
    if (m.dir)
      menu.addItem(i =>
        i
          .setSection('system')
          .setIcon('lucide-folder-open')
          .setTitle(t('plugins.openWithDefaultApp.actionShowInFolder'))
          .onClick(() => app.showInFolder(m.dir))
      )
    menu.addItem(i =>
      i
        .setSection('danger')
        .setWarning(true)
        .setIcon('lucide-trash-2')
        .setTitle(t(T + 'labelUninstall'))
        .onClick(() =>
          new ConfirmationModal(app)
            .setTitle(t(T + 'labelUninstallPlugin'))
            .setContent(t(T + 'labelUninstallPluginConfirmation'))
            .addButton(b =>
              b
                .setDestructive()
                .setCta()
                .setButtonText(t(T + 'labelUninstall'))
                .onClick(async () => {
                  await plugins.uninstallPlugin(m.id)
                  this.refresh()
                })
            )
            .addCancelButton()
            .open()
        )
    )
  }

  private restricted(): any[] {
    const app = this.app
    const T = 'setting.thirdPartyPlugin.'
    return [
      {
        name: '',
        searchable: false,
        render: (s: any) => {
          s.setName(createFragment(f => f.appendText(t(T + 'labelExitRestrictedModeDescription_1') + ' ' + t(T + 'labelExitRestrictedModeDescription_2'))))
          s.settingEl.addClass('community-plugins-intro')
          s.settingEl.closest('.setting-group')?.addClass('community-plugins-banner')
        }
      },
      {
        name: t(T + 'labelAllowCommunityPlugins'),
        desc: t(T + 'labelEnableCommunityPluginsDesc'),
        render: (s: any) =>
          s.addButton((b: any) =>
            b.setButtonText(t(T + 'labelExitRestrictedMode')).setCta().onClick(async () => {
              await app.plugins.setEnable(true)
              app.setting.refreshCurrentPage()
            })
          )
      }
    ]
  }
}

// ----------------------------------------------------------------------------------------------
class SecretModal extends Modal {
  constructor(app: any, private existing: string | null) {
    super(app)
  }
  onOpen(): void {
    const K = 'setting.keychain.'
    const store = this.app.secretStorage
    this.setTitle(this.existing ? t(K + 'actionEditSecret') : t(K + 'actionAddSecret'))
    let id = this.existing ?? ''
    let value = this.existing ? store.getSecret?.(this.existing) ?? '' : ''
    const idS = new Setting(this.contentEl).setName(t(K + 'labelSecretId')).setDesc(t(K + 'optionSecretIdDescription'))
    idS.addText(tx => tx.setPlaceholder(t(K + 'placeholderSecretId')).setValue(id).onChange(v => (id = v)).setDisabled(!!this.existing))
    new Setting(this.contentEl)
      .setName(t(K + 'labelSecretValue'))
      .setDesc(t(K + 'optionSecretValueDescription'))
      .addText(tx => {
        tx.inputEl.type = 'password'
        tx.setValue(value).onChange(v => (value = v))
      })
    new Setting(this.contentEl).addButton(b =>
      b.setCta().setButtonText(t('dialogue.buttonSave') === 'dialogue.buttonSave' ? 'Save' : t('dialogue.buttonSave')).onClick(() => {
        if (!/^[a-z0-9-]{1,64}$/.test(id)) return new Notice(t(K + 'msgErrorSecretIdInvalid'))
        if (!this.existing && store.listSecrets().includes(id)) return new Notice(t(K + 'msgErrorSecretIdExists'))
        if (!value) return new Notice(t(K + 'msgErrorSecretValueEmpty'))
        store.setSecret(id, value)
        this.close()
      })
    )
  }
}

export class KeychainTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'keychain', t('setting.keychain.name'), 'key-round')
    app.secretStorage?.on?.('changed', () => this.app.setting.activeTab === this && this.app.setting.refreshCurrentPage())
  }
  getSettingDefinitions(): any[] {
    const K = 'setting.keychain.'
    const app = this.app
    const store = app.secretStorage
    const ids: string[] = store?.listSecrets?.() ?? []
    return [
      {
        type: 'list',
        heading: t(K + 'secrets'),
        addItem: { name: t(K + 'actionAddSecret'), action: () => new SecretModal(app, null).open() },
        search: { placeholder: t(K + 'placeholderSearchSecret'), match: (d: any, q: string) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()) },
        emptyState: t(K + 'keychainEmptyState'),
        items: ids.map(id => ({
          name: id,
          render: (s: any) => {
            const last = store.getLastAccess?.(id)
            s.setDesc(last ? (window as any).moment(last).fromNow(false) : t(K + 'msgNeverAccessed'))
            s.addExtraButton((b: any) => b.setIcon('lucide-pen-line').setTooltip(t(K + 'actionEditSecret')).onClick(() => new SecretModal(app, id).open()))
            s.addExtraButton((b: any) => b.setIcon('lucide-trash-2').setTooltip(t('dialogue.buttonDelete')).onClick(() => store.deleteSecret(id)))
          }
        }))
      }
    ]
  }
}
