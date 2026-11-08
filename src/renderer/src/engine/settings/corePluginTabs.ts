/* eslint-disable @typescript-eslint/no-explicit-any */
// Option tabs of core plugins. Options live in `instance.options` and are
// persisted to `<configDir>/<plugin-id>.json` (formatted JSON, 2-space indent) on every change.
import { SettingTab } from '../plugins/settingTab'
import { FuzzySuggestModal } from '../ui'
import { t } from './i18n'
import { descWithLink } from './util'

const DEFAULT_DAILY_FORMAT = 'YYYY-MM-DD'

interface TabSpec {
  icon: string
  defs: (tab: CorePluginTab) => any[]
}

class CommandPickerModal extends FuzzySuggestModal<any> {
  constructor(app: any, private cmds: any[], private choose: (c: any) => void) {
    super(app)
  }
  getItems(): any[] {
    return this.cmds
  }
  getItemText(c: any): string {
    return c.name
  }
  onChooseItem(c: any): void {
    this.choose(c)
  }
}

const SPECS: Record<string, TabSpec> = {
  switcher: {
    icon: 'file-search',
    defs: tab => [
      { name: t('plugins.quickSwitcher.optionShowExistingOnly'), desc: t('plugins.quickSwitcher.optionShowExistingOnlyDescription'), control: { type: 'toggle', key: 'showExistingOnly' } },
      { name: t('plugins.quickSwitcher.optionShowAttachments'), desc: t('plugins.quickSwitcher.optionShowAttachmentsDesc'), control: { type: 'toggle', key: 'showAttachments' } },
      {
        name: t('plugins.quickSwitcher.optionShowAllFileTypes'),
        desc: t('plugins.quickSwitcher.optionShowAllFileTypesDesc'),
        visible: () => !!tab.app.vault.getConfig('showUnsupportedFiles'),
        control: { type: 'toggle', key: 'showAllFileTypes' }
      }
    ]
  },
  backlink: {
    icon: 'links-coming-in',
    defs: tab => [
      {
        name: t('plugins.backlinks.optionBacklinkInDocument'),
        desc: t('plugins.backlinks.optionBacklinkInDocumentDesc'),
        render: (s: any) =>
          s.addToggle((tg: any) =>
            tg.setValue(!!tab.options.backlinkInDocument).onChange((v: boolean) => {
              tab.options.backlinkInDocument = v
              tab.app.workspace.backlinkInDocument = v
              tab.save()
            })
          )
      }
    ]
  },
  canvas: {
    icon: 'layout-dashboard',
    defs: tab => {
      const o = tab.options
      const C = 'plugins.canvas.'
      const dd = (name: string, key: string, opts: Record<string, string>, dflt: string, desc?: string): any => ({
        name,
        ...(desc ? { desc } : {}),
        render: (s: any) =>
          s.addDropdown((d: any) => {
            d.addOptions(opts).setValue(o[key] || dflt).onChange((v: string) => {
              o[key] = v
              tab.save()
            })
          })
      })
      return [
        {
          name: t(C + 'optionNewCanvasLocation'),
          control: {
            type: 'dropdown',
            key: 'newFileLocation',
            defaultValue: 'root',
            options: { root: t('setting.file.optionChoiceVaultRoot'), current: t('setting.file.optionChoiceCurrentFolder'), folder: t('setting.file.optionChoiceSpecifiedFolder') }
          },
          refresh: true
        },
        {
          name: t(C + 'optionNewCanvasFolderPath'),
          desc: t(C + 'optionNewCanvasFolderPathDescription'),
          visible: () => o.newFileLocation === 'folder',
          control: { type: 'folder', key: 'newFileFolderPath', placeholder: t('setting.folderPathExamplePlaceholder') }
        },
        dd(t(C + 'optionWheelBehavior'), 'defaultWheelBehavior', { pan: t(C + 'labelPan'), zoom: t(C + 'labelZoom') }, 'pan'),
        dd(
          t(C + 'optionModDragBehavior', { key: (window as any).process?.platform === 'darwin' ? 'Cmd + Drag' : 'Ctrl + Drag' }),
          'defaultModDragBehavior',
          { menu: t(C + 'optionShowMenu'), card: t(C + 'actionAddCard'), note: t(C + 'actionAddNote'), media: t(C + 'actionAddMedia'), webpage: t(C + 'actionAddWebsite'), group: t(C + 'actionCreateGroup') },
          'menu'
        ),
        dd(t(C + 'optionNodeLabel'), 'cardLabelVisibility', { always: t(C + 'labelAlways'), hover: t(C + 'labelHover'), never: t(C + 'labelNever') }, 'always'),
        { name: t(C + 'optionSnapToGrid'), desc: t(C + 'optionSnapToGridDesc'), control: { type: 'toggle', key: 'snapToGrid' } },
        { name: t(C + 'optionSnapToObjects'), desc: t(C + 'optionSnapToObjectsDesc'), control: { type: 'toggle', key: 'snapToObjects' } },
        {
          name: t(C + 'optionZoomBreakpoint'),
          desc: t(C + 'optionZoomBreakpointDesc'),
          control: { type: 'slider', key: 'zoomBreakpoint', min: -0.7, max: 2.3999999999999995, step: 0.01, defaultValue: 0, displayFormat: (v: number) => `${Math.round(100 * Math.pow(1.2, v))}%` }
        }
      ]
    }
  },
  'page-preview': {
    icon: 'scan-eye',
    defs: tab => {
      const sources: Record<string, any> = tab.app.workspace.hoverLinkSources ?? {}
      const items = Object.keys(sources).map(k => ({ name: sources[k].display, control: { type: 'toggle', key: k, defaultValue: sources[k].defaultMod } }))
      const mod = (window as any).process?.platform === 'darwin' ? 'Cmd' : 'Ctrl'
      return [
        {
          type: 'list',
          heading: t('plugins.pagePreview.labelRequireMod', { key: mod }),
          search: { placeholder: t('interface.promptFilter'), match: (d: any, q: string) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()) },
          items
        }
      ]
    }
  },
  'daily-notes': {
    icon: 'calendar',
    defs: tab => {
      const o = tab.options
      const D = 'plugins.dailyNotes.'
      const presets = [DEFAULT_DAILY_FORMAT, 'YYYY.MM.DD', 'YYYY/MM/DD', 'YYYY/MM/YYYY-MM-DD']
      let customRow: any
      const moment = (window as any).moment
      return [
        {
          name: t(D + 'optionDateFormat'),
          desc: t(D + 'optionDateFormatDesc'),
          render: (s: any) => {
            const now = moment()
            const cur = o.format || DEFAULT_DAILY_FORMAT
            const isCustom = !presets.includes(cur)
            s.addDropdown((d: any) => {
              for (const f of presets) d.addOption(f, now.format(f))
              d.addOption('custom', t(D + 'optionCustom')).setValue(isCustom ? 'custom' : cur).onChange((v: string) => {
                if (v === 'custom') customRow.settingEl.show()
                else {
                  customRow.settingEl.hide()
                  o.format = v
                  tab.save()
                }
              })
            })
          }
        },
        {
          name: t(D + 'optionCustomDateFormat'),
          searchable: false,
          render: (s: any) => {
            customRow = s
            const cur = o.format || DEFAULT_DAILY_FORMAT
            let sample!: HTMLElement
            s.setDesc(
              createFragment(f => {
                f.appendText(t(D + 'labelReferToSyntax'))
                f.createEl('a', { text: t(D + 'labelSyntaxLink'), attr: { href: 'https://momentjs.com/docs/#/displaying/format/', target: '_blank', rel: 'noopener' } })
                f.createEl('br')
                f.appendText(t(D + 'labelSyntaxLivePreview'))
                sample = f.createEl('b', 'u-pop')
              })
            )
            s.addMomentFormat((m: any) =>
              m.setSampleEl(sample).setDefaultFormat(DEFAULT_DAILY_FORMAT).setValue(cur).onChange((v: string) => {
                o.format = v.trim()
                tab.save()
              })
            )
            // The row stays visible for presets too (the preset dropdown still hides it on change).
          }
        },
        { name: t(D + 'optionNewFileLocation'), desc: t(D + 'optionNewFileLocationDescription'), control: { type: 'folder', key: 'folder', placeholder: t('setting.folderPathExamplePlaceholder') } },
        { name: t(D + 'optionTemplate'), desc: t(D + 'optionTemplateDescription'), control: { type: 'file', key: 'template', filter: (f: any) => f.extension === 'md' } }
      ]
    }
  },
  templates: {
    icon: 'files',
    defs: tab => {
      const P = 'plugins.templates.'
      const fmt = (name: string, d1: string, d2: string, key: string, dflt: string): any => ({
        name: t(P + name),
        render: (s: any) => {
          let sample!: HTMLElement
          s.setDesc(
            createFragment(f => {
              f.appendText(t(P + d1))
              f.createEl('br')
              f.appendText(t(P + d2))
              f.createEl('br')
              f.appendText(t('plugins.dailyNotes.labelReferToSyntax'))
              f.createEl('a', { text: t('plugins.dailyNotes.labelSyntaxLink'), attr: { href: 'https://momentjs.com/docs/#/displaying/format/', target: '_blank', rel: 'noopener' } })
              f.createEl('br')
              f.appendText(t('plugins.dailyNotes.labelSyntaxLivePreview'))
              sample = f.createEl('b', 'u-pop')
            })
          )
          s.addMomentFormat((m: any) =>
            m.setSampleEl(sample).setDefaultFormat(dflt).setValue(tab.options[key] || '').onChange((v: string) => {
              tab.options[key] = v.trim()
              tab.save()
            })
          )
        }
      })
      return [
        { name: t(P + 'optionTemplateFolderLocation'), desc: t(P + 'optionTemplateFolderLocationDescription'), control: { type: 'folder', key: 'folder', placeholder: t('setting.folderPathExamplePlaceholder') } },
        fmt('optionTemplateDateFormat', 'optionTemplateDateFormatDescription', 'optionTemplateDateFormatDescription2', 'dateFormat', 'YYYY-MM-DD'),
        fmt('optionTemplateTimeFormat', 'optionTemplateTimeFormatDescription', 'optionTemplateTimeFormatDescription2', 'timeFormat', 'HH:mm')
      ]
    }
  },
  'note-composer': {
    icon: 'merge',
    defs: () => {
      const N = 'plugins.noteComposer.'
      return [
        {
          name: t(N + 'optionSplitReplacementText'),
          desc: t(N + 'optionSplitReplacementTextDescription'),
          control: { type: 'dropdown', key: 'replacementText', defaultValue: 'link', options: { link: t(N + 'optionChoiceSplitReplacementTextLink'), embed: t(N + 'optionChoiceSplitReplacementTextEmbed'), none: t(N + 'optionChoiceSplitReplacementTextNone') } }
        },
        { name: t(N + 'optionTemplateFile'), desc: t(N + 'optionTemplateFileDescription'), control: { type: 'file', key: 'template', placeholder: t('setting.filePathExamplePlaceholder'), filter: (f: any) => f.extension === 'md' } },
        { name: t(N + 'optionConfirmFileMerge'), desc: t(N + 'optionConfirmFileMergeDescription'), control: { type: 'toggle', key: 'askBeforeMerging' } }
      ]
    }
  },
  'command-palette': {
    icon: 'terminal',
    defs: tab => {
      const app = tab.app
      const cmds: Record<string, any> = app.commands.commands
      const pinned: string[] = tab.options.pinned ?? []
      const live = pinned.filter(id => !!cmds[id])
      const commit = (): void => {
        tab.options.pinned = pinned.length ? pinned : undefined
        tab.save()
        tab.update()
        app.setting.refreshCurrentPage?.()
      }
      return [
        {
          type: 'list',
          heading: t('plugins.commandPalette.labelPinnedCommands'),
          emptyState: t('plugins.commandPalette.labelNoCommands'),
          addItem: {
            name: t('plugins.commandPalette.actionAddCommand'),
            action: () => {
              const have = new Set(pinned)
              new CommandPickerModal(app, Object.values(cmds).filter(c => !have.has(c.id)), c => (pinned.push(c.id), commit())).open()
            }
          },
          onDelete: (i: number) => {
            const k = pinned.indexOf(live[i])
            if (k >= 0) pinned.splice(k, 1)
            commit()
          },
          items: live.map(id => ({ name: cmds[id].name, icon: cmds[id].icon || 'lucide-help-circle', searchable: false }))
        }
      ]
    }
  },
  'file-recovery': {
    icon: 'history',
    defs: tab => {
      const R = 'plugins.fileRecovery.'
      return [
        { name: t(R + 'optionInterval'), desc: t(R + 'optionIntervalDescription'), control: { type: 'number', key: 'intervalMinutes', min: 0 } },
        { name: t(R + 'optionKeep'), desc: t(R + 'optionKeepDescription'), control: { type: 'number', key: 'keepDays', min: 1 } },
        {
          name: t(R + 'optionOpenHistory'),
          desc: t(R + 'optionOpenHistoryDescription'),
          render: (s: any) => s.addButton((b: any) => b.setButtonText(t(R + 'buttonViewHistory')).onClick(() => tab.plugin.instance.openModal?.()))
        },
        {
          name: t(R + 'optionClear'),
          desc: t(R + 'optionClearDescription'),
          render: (s: any) =>
            s.addButton((b: any) =>
              b.setButtonText(t(R + 'buttonClearHistory')).setClass('mod-destructive').onClick(() => {
                tab.plugin.instance.clearData?.()
              })
            )
        }
      ]
    }
  }
}
void descWithLink

export class CorePluginTab extends SettingTab {
  plugin: any
  spec: TabSpec
  constructor(app: any, plugin: any, spec: TabSpec) {
    super(app)
    this.plugin = plugin
    this.spec = spec
    this.name = plugin.instance.name
    this.id = plugin.id
    this.icon = spec.icon
  }
  get options(): Record<string, any> {
    if (!this.plugin.instance.options) this.plugin.instance.options = {}
    return this.plugin.instance.options
  }
  save(): void {
    void this.plugin.saveData(this.options)
  }
  getSettingDefinitions(): any[] {
    return this.spec.defs(this)
  }
  getControlValue(key: string): unknown {
    return this.options[key]
  }
  setControlValue(key: string, value: unknown): void {
    this.options[key] = value
    this.save()
  }
}

export const hasCorePluginTab = (id: string): boolean => id in SPECS

/** Adds/removes core-plugin option tabs to follow `app.internalPlugins` enable state. */
export function syncCorePluginTabs(app: any): void {
  const tabs = new Map<string, CorePluginTab>()
  const sync = (): void => {
    for (const id of Object.keys(SPECS)) {
      const p = app.internalPlugins.plugins[id]
      const want = !!p && p.enabled
      const have = tabs.get(id)
      if (want && !have) {
        const tab = new CorePluginTab(app, p, SPECS[id])
        tabs.set(id, tab)
        app.setting.addCorePluginTab(tab)
      } else if (!want && have) {
        tabs.delete(id)
        app.setting.removeSettingTab(have)
      }
    }
  }
  app.internalPlugins.on('change', sync)
  sync()
}
