/* eslint-disable @typescript-eslint/no-explicit-any */
// Workspaces core plugin: `.quartz/workspaces.json` = {workspaces:{name: layout+mtime}, active}.
import type { CorePluginDef } from '../app/InternalPlugins'
import { FuzzySuggestModal, Modal, Notice, SuggestModal, moment, setIcon, setTooltip } from '../ui'
import { t } from '../settings/i18n'

class NamePrompt extends Modal {
  constructor(app: any, private onSubmit: (name: string) => void) {
    super(app)
  }
  onOpen(): void {
    this.titleEl.setText(t('plugins.workspaces.actionSave'))
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'prompt-input', placeholder: t('plugins.workspaces.placeholderSaveCurrentLayoutAs') })
    const go = (): void => {
      const n = input.value.trim()
      if (!n) return void new Notice(t('plugins.workspaces.msgEnterName'))
      this.close()
      this.onSubmit(n)
    }
    input.addEventListener('keydown', e => e.key === 'Enter' && go())
    this.modalEl.createDiv('modal-button-container').createEl('button', { cls: 'mod-cta', text: t('plugins.workspaces.buttonSave') }).addEventListener('click', go)
    input.focus()
  }
}

class LayoutSuggest extends FuzzySuggestModal<string> {
  constructor(app: any, private names: string[], private pick: (n: string) => void) {
    super(app)
    this.setPlaceholder(t('plugins.workspaces.placeholderTypeToSearchLayouts'))
    this.emptyStateText = t('plugins.workspaces.labelNoLayoutFound')
  }
  getItems(): string[] {
    return this.names
  }
  getItemText(n: string): string {
    return n
  }
  onChooseItem(n: string): void {
    this.pick(n)
  }
}

export const workspacesPlugin: CorePluginDef = {
  id: 'workspaces',
  name: t('plugins.workspaces.name'),
  description: t('plugins.workspaces.desc'),
  defaultOn: false,
  async onEnable(app, p) {
    let data: { workspaces: Record<string, any>; active: string } = { workspaces: {}, active: '' }
    try {
      const d = await p.loadData()
      if (d && typeof d === 'object') data = { workspaces: d.workspaces ?? {}, active: d.active ?? '' }
    } catch {
      /* none */
    }
    const save = (): Promise<void> => p.saveData(data)
    const names = (): string[] => Object.keys(data.workspaces).sort((a, b) => a.localeCompare(b))
    const saveLayout = async (name: string): Promise<void> => {
      data.workspaces[name] = { ...app.workspace.getLayout(), mtime: new Date().toISOString() }
      data.active = name
      await save()
      new Notice(t('plugins.workspaces.msgSaveLayoutSuccess', { name }))
    }
    const load = async (name: string): Promise<void> => {
      const l = data.workspaces[name]
      if (!l) return
      data.active = name
      await save()
      await app.workspace.changeLayout(l)
    }
    const prompt = (cb: (n: string) => void): void => new NamePrompt(app, cb).open()
    const pre = p.instance.name + ': '
    p.instance.getWorkspaces = () => data
    p.registerGlobalCommand({
      id: 'workspaces:load',
      name: pre + t('plugins.workspaces.actionLoadLayout'),
      icon: 'lucide-layout',
      callback: () => new LayoutSuggest(app, names(), n => void load(n)).open()
    })
    p.registerGlobalCommand({
      id: 'workspaces:save',
      name: pre + t('plugins.workspaces.actionSave'),
      icon: 'lucide-save',
      callback: () => (data.active ? void saveLayout(data.active) : prompt(n => void saveLayout(n)))
    })
    p.registerGlobalCommand({
      id: 'workspaces:save-and-load',
      name: pre + t('plugins.workspaces.actionSaveAndLoadLayout'),
      icon: 'lucide-layout',
      callback: async () => {
        if (data.active) await saveLayout(data.active)
        new LayoutSuggest(app, names().filter(n => n !== data.active), n => void load(n)).open()
      }
    })
    p.registerGlobalCommand({
      id: 'workspaces:open-modal',
      name: pre + t('plugins.workspaces.actionManageLayouts'),
      icon: 'lucide-layout',
      callback: () => {
        const m = new Modal(app)
        m.titleEl.setText(t('plugins.workspaces.actionManageLayouts'))
        const render = (): void => {
          m.contentEl.empty()
          const bar = m.contentEl.createDiv('setting-item')
          const input = bar.createEl('input', { type: 'text', placeholder: t('plugins.workspaces.placeholderSaveCurrentLayoutAs') })
          bar.createEl('button', { cls: 'mod-cta', text: t('plugins.workspaces.buttonSave') }).addEventListener('click', async () => {
            const n = input.value.trim()
            if (!n) return void new Notice(t('plugins.workspaces.msgEnterName'))
            await saveLayout(n)
            render()
          })
          if (!names().length) m.contentEl.createDiv('workspace-empty').setText(t('plugins.workspaces.labelNoLayoutFound'))
          for (const n of names()) {
            const row = m.contentEl.createDiv('setting-item mod-clickable')
            const info = row.createDiv('setting-item-info')
            info.createDiv('setting-item-name').setText(n)
            const mt = data.workspaces[n].mtime
            if (mt) info.createDiv('setting-item-description').setText(t('plugins.workspaces.labelWorkspaceModifiedTime', { time: moment(mt).fromNow() }))
            const ctl = row.createDiv('setting-item-control')
            ctl.createEl('button', { text: t('plugins.workspaces.buttonLoad') }).addEventListener('click', () => (m.close(), void load(n)))
            const del = ctl.createDiv('clickable-icon')
            setIcon(del, 'lucide-trash-2')
            setTooltip(del, t('plugins.workspaces.tooltipDeleteLayout'))
            del.addEventListener('click', async () => {
              delete data.workspaces[n]
              if (data.active === n) data.active = ''
              await save()
              render()
            })
          }
        }
        m.onOpen = render
        m.open()
      }
    })
    p.register(() => void save())
  }
}

void SuggestModal
