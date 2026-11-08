/* eslint-disable @typescript-eslint/no-explicit-any */
// Native starter page (vault chooser, `body.starter > .starter-screen`). `app:open-vault` ("Manage vaults")
// opens this page in its own 800x650 window.
import { Modal, Notice, Setting, setIcon, setTooltip, Menu } from '../ui'
import { t } from '../settings/i18n'
import { useVaultRegistryStore } from '@/stores/vaultRegistry'
import { quartzLogoSvg } from './quartzLogo'
import pkg from '../../../../../package.json'

const APP_VERSION: string = pkg.version

const reg = () => useVaultRegistryStore.getState()

function remember(path: string): void {
  try {
    localStorage.setItem('quartz:lastVault', path)
  } catch {
    /* ignore */
  }
}

/** Create-vault prompt: name + (system dialog) location. */
class CreateVaultModal extends Modal {
  private name = ''
  onOpen(): void {
    this.titleEl.setText(t('interface.startScreen.labelCreateLocalVault'))
    new Setting(this.contentEl)
      .setName(t('interface.startScreen.optionNewVaultName'))
      .addText(tx => tx.setPlaceholder(t('interface.startScreen.optionNewVaultName')).onChange(v => (this.name = v)))
    new Setting(this.contentEl).addButton(b =>
      b
        .setButtonText(t('interface.startScreen.buttonCreateVault'))
        .setCta()
        .onClick(async () => {
          const n = this.name.trim()
          if (!n) return void new Notice(t('interface.startScreen.msgEmptyVaultName'))
          if (n.endsWith('.')) return void new Notice(t('interface.startScreen.msgTrailingDotVaultName'))
          const parent = await (window as any).quartzAPI.vault.open()
          if (!parent) return
          const path = `${parent}/${n}`
          const r = reg().createVault(path)
          if (r !== true) return void new Notice(`${t('interface.startScreen.msgFailedToCreateVault')} ${r}`)
          remember(path)
          window.close()
        })
    )
  }
}

/** Starter window: splash brand, quick start, create / open actions. */
export function mountStarter(): void {
  document.getElementById('root')?.remove()
  document.body.addClass('starter')
  const screen = document.body.createDiv('starter-screen')
  const inner = screen.createDiv('starter-screen-inner')
  const recent = inner.createDiv('recent-vaults')
  const list = recent.createDiv('recent-vaults-list')
  const splash = inner.createDiv('splash')
  const brand = splash.createDiv('splash-brand')
  brand.createDiv('splash-brand-logo').innerHTML = quartzLogoSvg('', 90)
  brand.createDiv({ cls: 'splash-brand-logo-text', text: 'Quartz' })
  brand.createDiv({ cls: 'splash-brand-version', text: `${t('interface.startScreen.labelVersion')} ${APP_VERSION}` })
  const opts = splash.createDiv('open-vault-options-container').createDiv('open-vault-options mod-open-vault')
  const quick = opts.createDiv('quick-start-container u-center-text').createEl('button', { cls: 'mod-cta', text: t('interface.startScreen.buttonQuickStart') })
  const group = opts.createDiv('setting-group')
  group.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } })
  const items = group.createDiv('setting-items')

  const openVault = (path: string): void => {
    const r = reg().openVault(path)
    if (r !== true) return void new Notice(`${t('interface.startScreen.msgErrorFailedToOpenVault')} ${r}`)
    remember(path)
    window.close()
  }
  quick.addEventListener('click', () => {
    const home: string = (window as any).require('os').homedir()
    const path = `${home}/Quartz Vault`
    const r = reg().createVault(path)
    if (r !== true) return void new Notice(`${t('interface.startScreen.msgFailedToCreateVault')} ${r}`)
    remember(path)
    window.close()
  })
  new Setting(items)
    .setName(t('interface.startScreen.optionCreateVault'))
    .setDesc(t('interface.startScreen.optionCreateVaultDescription'))
    .addButton(b => b.setButtonText(t('interface.startScreen.buttonCreateVault')).setCta().onClick(() => new CreateVaultModal({ keymap: { pushScope() {}, popScope() {} } }).open()))
  new Setting(items)
    .setName(t('interface.startScreen.optionOpenFolderAsVault'))
    .setDesc(t('interface.startScreen.optionOpenFolderAsVaultDescription'))
    .addButton(b =>
      b.setButtonText(t('interface.startScreen.buttonOpen')).onClick(async () => {
        const p = await (window as any).quartzAPI.vault.open()
        if (p) openVault(p)
      })
    )
  const lang = new Setting(items).addDropdown(d => d.addOption('en', 'English').setValue('en'))
  lang.settingEl.addClass('mod-change-language')
  lang.nameEl.setAttribute('aria-label', 'Get Help')
  setIcon(lang.nameEl, 'help')

  const ipc = (window as any).require('electron').ipcRenderer
  const remote = (): any => (window as any).electron?.remote ?? (window as any).require('@electron/remote')
  const path = (window as any).require('path')
  const fs = (window as any).require('fs')
  const pickFolder = (title: string, defaultPath: string): string | null => {
    const r = remote().dialog.showOpenDialogSync({ title, properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'], defaultPath })
    return r && r.length ? r[0] : null
  }
  const fill = (): void => {
    list.empty()
    const vaults: Record<string, { path: string; ts: number }> = ipc.sendSync('vault-list') || {}
    const entries = Object.entries(vaults).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.ts - a.ts)
    recent.toggle(entries.length > 0)
    quick.parentElement!.toggle(entries.length === 0)
    for (const v of entries) {
      const item = list.createDiv('recent-vaults-list-item')
      const base = path.basename(v.path)
      const dir = path.dirname(v.path)
      const nameEl = item.createDiv({ cls: 'recent-vaults-list-item-name', text: base })
      item.createDiv({ cls: 'recent-vaults-list-item-path', text: dir })
      // Rename and move share one path: refuse existing targets and nesting, then `vault-move`.
      const relocate = (to: string, kind: 'Rename' | 'Move'): void => {
        if (to === v.path) return
        if (fs.existsSync(to)) return void new Notice(t(`interface.startScreen.msgError${kind}Exists`))
        const rel = path.relative(v.path, to)
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return void new Notice(t('interface.startScreen.msgErrorNested'))
        const r = ipc.sendSync('vault-move', v.path, to)
        new Notice(
          r === 'EVAULTOPEN'
            ? t(`interface.startScreen.msgError${kind}Open`)
            : r
              ? `${t(`interface.startScreen.msg${kind}Failed`)} ${r}`
              : t(`interface.startScreen.msg${kind}Success`)
        )
        fill()
      }
      const rename = (): void => {
        nameEl.contentEditable = 'true'
        nameEl.tabIndex = -1
        nameEl.focus()
        const range = document.createRange()
        range.selectNodeContents(nameEl)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
        const done = (commit: boolean): void => {
          nameEl.removeAttribute('contenteditable')
          nameEl.removeAttribute('tabindex')
          nameEl.removeEventListener('blur', onBlur)
          nameEl.removeEventListener('keydown', onKey)
          const next = nameEl.innerText
          nameEl.setText(base)
          if (commit) relocate(path.join(dir, next), 'Rename')
        }
        const onBlur = (): void => done(true)
        const onKey = (e: KeyboardEvent): void => {
          if (!e.isComposing && (e.key === 'Enter' || e.key === 'Escape')) done(e.key === 'Enter')
        }
        nameEl.addEventListener('blur', onBlur)
        nameEl.addEventListener('keydown', onKey)
        nameEl.addEventListener('click', e => e.preventDefault())
      }
      const showMenu = (evt: MouseEvent): void => {
        evt.preventDefault()
        if (item.hasClass('has-active-menu')) return
        Menu.forEvent(evt)
          .setParentElement(item)
          .addSections(['open', 'info', 'action', 'system', '', 'danger'])
          .addItem(i => i.setIcon('lucide-edit-3').setSection('action').setTitle(t('interface.startScreen.optionRenameVault')).onClick(rename))
          .addItem(i =>
            i
              .setIcon('lucide-folder-tree')
              .setSection('action')
              .setTitle(t('interface.startScreen.optionMoveVault'))
              .onClick(() => {
                const dest = pickFolder(t('interface.startScreen.msgMoveSelectDest'), dir)
                if (dest) relocate(path.join(dest, base), 'Move')
              })
          )
          .addItem(i =>
            i
              .setIcon('lucide-copy')
              .setSection('info')
              .setTitle(t('interface.startScreen.optionCopyVaultID'))
              .onClick(() => {
                void navigator.clipboard.writeText(v.id)
                new Notice(t('interface.copied_generic'))
              })
          )
          .addItem(i =>
            i
              .setIcon('lucide-folder-open')
              .setSection('system')
              .setTitle(t(process.platform === 'darwin' ? 'interface.startScreen.optionRevealVaultInExplorerMac' : 'interface.startScreen.optionRevealVaultInExplorer'))
              .onClick(() => remote().shell.showItemInFolder(v.path))
          )
          .addItem(i =>
            i
              .setIcon('lucide-x')
              .setSection('danger')
              .setWarning(true)
              .setTitle(t('interface.startScreen.optionRemove'))
              .onClick(() => {
                if (!ipc.sendSync('vault-remove', v.path)) new Notice(t('interface.startScreen.msgErrorRemoveCurrentOpenVault'))
                fill()
              })
          )
          .showAtMouseEvent(evt)
      }
      item.addEventListener('contextmenu', showMenu)
      const more = item.createDiv('recent-vaults-list-item-option-button')
      setIcon(more, 'lucide-more-vertical')
      setTooltip(more, t('interface.menu.moreOptions'))
      more.addEventListener('click', showMenu)
      item.addEventListener('click', evt => {
        if (evt.defaultPrevented) return
        evt.preventDefault()
        openVault(v.path)
      })
      setTooltip(item, v.path, { placement: 'right' })
    }
  }
  window.addEventListener('focus', fill)
  fill()
}

/** `app:open-vault`: "Manage vaults" focuses (or opens) the separate starter window. */
export function openVaultManager(): void {
  ;(window as any).require('electron').ipcRenderer.sendSync('starter')
}
