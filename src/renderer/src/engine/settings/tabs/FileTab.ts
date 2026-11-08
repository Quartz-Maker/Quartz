/* eslint-disable @typescript-eslint/no-explicit-any */
// Files and links tab (id `file`).
import { t } from '../i18n'
import { BuiltinTab, REPO_URL, descWithLink } from '../util'
import { Modal, Setting } from '../../ui'
import { renderFileCombobox } from '../../plugins/settingTab'
import { validateConfigDir } from '../../vault/config'

const F = 'setting.file.'

class AddExclusionModal extends Modal {
  constructor(app: any, private done: (v: string) => void) {
    super(app)
  }
  onOpen(): void {
    this.setTitle(t(F + 'titleAddExcludedFilter'))
    let value = ''
    const s = new Setting(this.contentEl).setDesc(t(F + 'helpExcludedFilter'))
    s.addText(tx => {
      tx.inputEl.addEventListener('keydown', e => e.key === 'Enter' && submit())
      tx.onChange(v => (value = v))
    })
    const submit = (): void => {
      if (!value.trim()) return s.setErrorMessage(t(F + 'messageEmptyFilter')) as any
      this.done(value.trim())
      this.close()
    }
    s.addButton(b => b.setButtonText(t('dialogue.buttonAdd') === 'dialogue.buttonAdd' ? 'Add' : t('dialogue.buttonAdd')).setCta().onClick(submit))
  }
}

export class FileTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'file', t(F + 'name'), 'folder-cog')
  }

  getSettingDefinitions(): any[] {
    const app = this.app
    const vault = app.vault
    const defs: any[] = []
    const openBehavior = (): string => String(vault.getConfig('openBehavior') ?? '')
    let fileChoice = openBehavior().startsWith('file:') ? openBehavior().slice(5) : ''
    const saveOpen = (mode: string): void => vault.setConfig('openBehavior', mode === 'file' ? 'file:' + fileChoice : mode)
    defs.push({
      name: t(F + 'optionDefaultOpenAction'),
      desc: t(F + 'optionDefaultOpenActionDescription'),
      render: (s: any) =>
        s.addDropdown((d: any) => {
          d.addOption('', t(F + 'optionChoiceLastOpened')).addOption('new', t(F + 'optionChoiceNewNote')).addOption('file', t(F + 'optionChoiceSpecificFile'))
          if (app.internalPlugins.getEnabledPluginById('daily-notes')) d.addOption('daily', t(F + 'optionChoiceDailyNote'))
          let cur = openBehavior()
          if (cur.startsWith('file:')) {
            fileChoice = cur.slice(5)
            cur = 'file'
          }
          d.setValue(cur)
          d.onChange((v: string) => {
            saveOpen(v)
            this.refreshDomState()
          })
        })
    })
    defs.push({
      name: t(F + 'optionDefaultOpenFilePath'),
      desc: t(F + 'optionDefaultOpenFilePathDescription'),
      visible: () => openBehavior().startsWith('file:'),
      render: (s: any) =>
        renderFileCombobox(app, s.controlEl, fileChoice, (v: string) => {
          fileChoice = v
          saveOpen('file')
        }, { extension: 'path' })
    })
    defs.push({ name: t('setting.editor.optionOpenTabInForeground'), desc: t('setting.editor.optionOpenTabInForegroundDescription'), control: { type: 'toggle', key: 'focusNewTab' } })
    defs.push({
      name: t(F + 'optionNewNoteLocation'),
      desc: t(F + 'optionNewNoteLocationDescription'),
      control: { type: 'dropdown', key: 'newFileLocation', options: { root: t(F + 'optionChoiceVaultRoot'), current: t(F + 'optionChoiceCurrentFolder'), folder: t(F + 'optionChoiceSpecifiedFolder') } }
    })
    defs.push({
      name: t(F + 'optionNewFileFolderPath'),
      desc: t(F + 'optionNewFileFolderPathDescription'),
      visible: () => vault.getConfig('newFileLocation') === 'folder',
      control: { type: 'folder', key: 'newFileFolderPath', placeholder: t('setting.folderPathExamplePlaceholder') }
    })

    // attachments: one `attachmentFolderPath` value derived from three controls
    const placeholder = t(F + 'optionNewAttachmentLocationDefault')
    const kind = (): string => {
      const v = String(vault.getConfig('attachmentFolderPath') ?? '/')
      return v === '/' ? 'root' : v === '.' || v === './' ? 'current' : v.startsWith('./') ? 'subfolder' : 'folder'
    }
    let dd: any, folderTx: any, subTx: any
    const compute = (): string => {
      const k = dd.getValue()
      return k === 'root' ? '/' : k === 'folder' ? folderTx.getValue() || placeholder : k === 'current' ? './' : k === 'subfolder' ? './' + (subTx.getValue() || placeholder) : ''
    }
    defs.push({
      name: t(F + 'optionNewAttachmentLocation'),
      desc: t(F + 'optionNewAttachmentLocationDescription'),
      render: (s: any) =>
        s.addDropdown((d: any) => {
          dd = d
          d.addOption('root', t(F + 'optionChoiceVaultRoot'))
            .addOption('current', t(F + 'optionChoiceCurrentFolder'))
            .addOption('subfolder', t(F + 'optionChoiceSubdirectory'))
            .addOption('folder', t(F + 'optionChoiceSpecifiedFolder'))
          d.onChange(() => {
            vault.setConfig('attachmentFolderPath', compute())
            this.refreshDomState()
          })
          d.setValue(kind())
        })
    })
    defs.push({
      name: t(F + 'optionAttachmentFolderPath'),
      desc: t(F + 'optionAttachmentFolderPathDescription'),
      visible: () => kind() === 'folder',
      render: (s: any) =>
        s.addText((tx: any) => {
          folderTx = tx
          tx.setPlaceholder(placeholder).onChange(() => vault.setConfig('attachmentFolderPath', compute()))
          const v = String(vault.getConfig('attachmentFolderPath') ?? '/')
          if (kind() === 'folder') tx.setValue(v !== placeholder ? v : '')
        })
    })
    defs.push({
      name: t(F + 'optionAttachmentSubfolderPath'),
      desc: t(F + 'optionAttachmentSubfolderPathDescription'),
      visible: () => kind() === 'subfolder',
      render: (s: any) =>
        s.addText((tx: any) => {
          subTx = tx
          tx.setPlaceholder(placeholder).onChange(() => vault.setConfig('attachmentFolderPath', compute()))
          if (kind() === 'subfolder') {
            const v = String(vault.getConfig('attachmentFolderPath')).slice(2)
            tx.setValue(v !== placeholder ? v : '')
          }
        })
    })

    defs.push({
      type: 'group',
      heading: t(F + 'optionLinks'),
      items: [
        {
          name: t(F + 'optionLinkAutocompletedFormat'),
          desc: t(F + 'optionLinkAutocompletedFormatDescription'),
          control: { type: 'dropdown', key: 'newLinkFormat', options: { shortest: t(F + 'optionChoiceShortestLinktext'), relative: t(F + 'optionChoiceRelativePath'), absolute: t(F + 'optionChoiceAbsolutePath') } }
        },
        { name: t(F + 'optionAlwaysUpdateLinks'), desc: t(F + 'optionAlwaysUpdateLinksDescription'), control: { type: 'toggle', key: 'alwaysUpdateLinks' } },
        {
          name: t(F + 'optionUseWikiLinks'),
          desc: t(F + 'optionUseWikiLinksDescription'),
          render: (s: any) => s.addToggle((tg: any) => tg.setValue(!vault.getConfig('useMarkdownLinks')).onChange((v: boolean) => vault.setConfig('useMarkdownLinks', !v)))
        },
        { name: t(F + 'optionShowUnsupportedFiles'), desc: t(F + 'optionShowUnsupportedFilesDescription'), control: { type: 'toggle', key: 'showUnsupportedFiles' } }
      ]
    })
    defs.push({
      type: 'group',
      heading: t(F + 'optionTrash'),
      items: [
        { name: t(F + 'optionConfirmFileDeletion'), desc: t(F + 'optionConfirmFileDeletionDescription'), control: { type: 'toggle', key: 'promptDelete' } },
        {
          name: t(F + 'optionDeleteUnlinkedAttachments'),
          desc: t(F + 'optionDeleteUnlinkedAttachmentsDescription'),
          control: { type: 'dropdown', key: 'deleteUnlinkedAttachments', options: { ask: t(F + 'optionChoiceAskEveryTime'), always: t(F + 'optionChoiceAlways'), never: t(F + 'optionChoiceNever') } }
        },
        {
          name: t(F + 'optionDeleteDestination'),
          desc: t(F + 'optionDeleteDestinationDescription'),
          control: { type: 'dropdown', key: 'trashOption', options: { system: t(F + 'optionChoiceSystemTrash'), local: t(F + 'optionChoiceVaultTrash'), none: t(F + 'optionChoicePermanentDelete') } }
        }
      ]
    })

    const filters: string[] = (vault.getConfig('userIgnoreFilters') as string[] | null) ?? []
    const save = (list: string[]): void => {
      vault.setConfig('userIgnoreFilters', list.length ? list : null)
      this.update()
      app.setting.refreshCurrentPage?.()
    }
    const advanced: any[] = []
    advanced.push({
      type: 'page',
      name: t(F + 'optionExcludedFiles'),
      desc: t(F + 'optionExcludedFilesDesc'),
      displayValue: () => (filters.length ? t(F + 'labelExcludedFilesCount', { count: filters.length }) : ''),
      items: [
        {
          type: 'list',
          emptyState: t(F + 'labelNoExcludedFilters'),
          addItem: { name: t(F + 'labelAddExcludedFilter'), action: () => new AddExclusionModal(app, v => save([...filters, v])).open() },
          onDelete: (i: number) => save(filters.filter((_, j) => j !== i)),
          items: filters.map(f => ({
            name: f,
            searchable: false,
            ...(f.length > 2 && f.startsWith('/') && f.endsWith('/') ? { render: (s: any) => s.nameEl.createSpan({ text: 'Regex', cls: 'flair mod-flat' }) } : {})
          }))
        }
      ]
    })
    advanced.push({
      name: t('setting.about.optionConfigLocation'),
      desc: t('setting.about.optionConfigLocationDescription'),
      render: (s: any) => {
        const stored = localStorage.getItem(app.appId + '-config') || ''
        let next = stored
        let btn: any
        s.addButton((b: any) => {
          btn = b
          b.setCta().setButtonText(t('setting.about.buttonRelaunch')).onClick(() => {
            if (next) localStorage.setItem(app.appId + '-config', next)
            else localStorage.removeItem(app.appId + '-config')
            window.location.reload()
          })
          b.buttonEl.hide()
        })
        s.addText((tx: any) =>
          tx
            .setPlaceholder('.quartz')
            .setValue(stored)
            .onChange((v: string) => {
              if (!v || validateConfigDir(v, /[\\/:*?"<>|]/)) {
                s.setErrorMessage(null)
                next = v
                btn.buttonEl.toggle(v !== stored)
              } else s.setErrorMessage(t('setting.about.optionConfigLocationWarning'))
            })
        )
      }
    })
    advanced.push({
      name: t(F + 'optionUriCallbacks'),
      desc: descWithLink(t(F + 'optionUriCallbacksDesc') + ' ', t('interface.buttonLearnMore'), REPO_URL, false),
      control: { type: 'toggle', key: 'uriCallbacks' }
    })
    advanced.push({
      name: t('setting.editor.optionReindexVault'),
      desc: createFragment(f => {
        f.createSpan({ cls: 'mod-warning', text: t('setting.editor.optionReindexVaultDescription') })
        f.createEl('br')
        f.createEl('a', { text: t('interface.buttonLearnMore'), attr: { href: REPO_URL, target: '_blank' } })
      }),
      render: (s: any) =>
        s.addButton((b: any) =>
          b.setButtonText(t('setting.editor.labelReindex')).onClick(async () => {
            await app.metadataCache.rebuild?.()
            window.location.reload()
          })
        )
    })
    defs.push({ type: 'group', heading: t('setting.appearance.optionAdvanced'), items: advanced })
    return defs
  }
}
