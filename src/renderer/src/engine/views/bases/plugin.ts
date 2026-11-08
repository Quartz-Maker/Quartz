/* eslint-disable @typescript-eslint/no-explicit-any */
// The `bases` core plugin: `base` file view, view registry (table / cards / list / kanban + plugin
// views), `![[x.base#View]]` embeds, ```base``` code blocks and the six `bases:*` commands.
import { Component } from '../../core/Component'
import { embedRegistry } from '../../markdown/embeds'
import { registerMarkdownCodeBlockProcessor } from '../../markdown/plugin-api'
import { getMarkdownHost } from '../../markdown/host'
import { TextFileView } from '../../view/FileView'
import { Notice } from '../../ui/Notice'
import { Modal } from '../../ui/Modal'
import { FuzzySuggestModal } from '../../ui/suggest'
import { BaseConfig } from './BaseConfig'
import { QueryController } from './QueryController'
import { TableView } from './TableView'
import { CardsView, ListView, KanbanView } from './CardViews'
import { bt } from './strings'
import type { BasesViewRegistration } from './api'

export const VIEW_TYPE_BASES = 'bases'
const L = (k: string, v?: Record<string, string | number>): string => bt('plugins.bases.' + k, v)
export const DEFAULT_BASE_TEXT = 'views:\n  - type: table\n    name: Table\n'

const slider = (key: string, name: string, def: number, min: number, max: number, step: number): any => ({ type: 'slider', key, displayName: name, default: def, min, max, step })
const imageFit = (): any => ({ type: 'dropdown', key: 'imageFit', displayName: bt('plugins.bases.cards.labelImageFit'), options: { '': bt('plugins.bases.cards.optionImageFitCover'), contain: bt('plugins.bases.cards.optionImageFitContain') } })
const imageProp = (): any => ({ type: 'property', key: 'image', displayName: bt('plugins.bases.cards.labelImageProperty'), placeholder: 'Property', filter: (id: string) => id === 'file.file' || !id.startsWith('file.') })

function builtinRegistrations(): Record<string, BasesViewRegistration> {
  return {
    table: {
      name: bt('plugins.bases.table.name'), icon: 'lucide-table',
      factory: (c, el) => new TableView(c, el),
      options: () => [{ type: 'dropdown', key: 'rowHeight', displayName: bt('plugins.bases.table.labelRowHeight'), options: { '': bt('plugins.bases.table.optionShort'), medium: bt('plugins.bases.table.optionMedium'), tall: bt('plugins.bases.table.optionTall'), extra: bt('plugins.bases.table.optionExtraTall') } }]
    },
    cards: {
      name: bt('plugins.bases.cards.name'), icon: 'lucide-layout-grid',
      factory: (c, el) => new CardsView(c, el),
      options: () => [slider('cardSize', bt('plugins.bases.cards.labelCardSize'), 200, 50, 800, 10), imageProp(), imageFit(), slider('imageAspectRatio', bt('plugins.bases.cards.labelImageAspectRatio'), 1, 0.25, 2.5, 0.05)]
    },
    list: {
      name: bt('plugins.bases.list.name'), icon: 'lucide-list',
      factory: (c, el) => new ListView(c, el),
      options: cfg => [
        { type: 'dropdown', key: 'markers', displayName: bt('plugins.bases.list.labelMarkers'), default: 'bullet', options: { bullet: bt('plugins.bases.list.optionBullet'), number: bt('plugins.bases.list.optionNumber'), none: bt('plugins.bases.list.optionNone') } },
        { type: 'toggle', key: 'indentProperties', displayName: bt('plugins.bases.list.labelIndentProperties'), default: false },
        { type: 'text', key: 'separator', displayName: bt('plugins.bases.list.labelPropertySeparator'), default: ', ', shouldHide: () => !!cfg.get('indentProperties') }
      ]
    },
    kanban: {
      name: bt('plugins.bases.kanban.name'), icon: 'lucide-kanban-square',
      factory: (c, el) => new KanbanView(c, el),
      options: () => [slider('columnWidth', bt('plugins.bases.kanban.labelColumnWidth'), 280, 200, 500, 10), imageProp(), imageFit(), slider('imageAspectRatio', bt('plugins.bases.cards.labelImageAspectRatio'), 0.5, 0.25, 2.5, 0.05)]
    }
  }
}

/** Generic "Configure view" dialog driven by a registration's `options`. */
export class ConfigureViewModal extends Modal {
  constructor(private c: QueryController) {
    super(c.app)
  }
  onOpen(): void {
    this.titleEl.setText(L('labelConfigureView'))
    this.render()
  }
  private render(): void {
    const cfg = this.c.getViewConfig()!
    const reg = this.c.plugin.getRegistration(cfg.type)
    const el = this.contentEl
    el.empty()
    for (const o of reg?.options?.(cfg) ?? []) {
      const row = el.createDiv('setting-item')
      row.createDiv({ cls: 'setting-item-info' }).createDiv({ cls: 'setting-item-name', text: o.displayName })
      const ctl = row.createDiv('setting-item-control')
      const cur = cfg.get(o.key) ?? o.default
      const save = (v: any): void => {
        cfg.set(o.key, v === o.default || v === '' || v === undefined ? null : v)
        this.render()
      }
      if (o.type === 'slider') {
        const i = ctl.createEl('input', { type: 'range', cls: 'slider', attr: { min: String(o.min), max: String(o.max), step: String(o.step) } }) as HTMLInputElement
        i.value = String(cur ?? o.default)
        i.addEventListener('change', () => save(Number(i.value)))
      } else if (o.type === 'dropdown') {
        const s = ctl.createEl('select', { cls: 'dropdown' }) as HTMLSelectElement
        for (const k of Object.keys(o.options)) s.createEl('option', { value: k, text: o.options[k] })
        s.value = cur ?? ''
        s.addEventListener('change', () => save(s.value))
      } else if (o.type === 'toggle') {
        const t = ctl.createDiv({ cls: 'checkbox-container' + (cur ? ' is-enabled' : '') })
        t.addEventListener('click', () => save(!cur))
      } else if (o.type === 'property') {
        const s = ctl.createEl('select', { cls: 'dropdown' }) as HTMLSelectElement
        s.createEl('option', { value: '', text: '' })
        for (const p of this.c.getAllProperties()) s.createEl('option', { value: p, text: this.c.query.getPropertyConfig(p).getDisplayName() })
        s.value = cfg.getAsPropertyId(o.key) ?? ''
        s.addEventListener('change', () => save(s.value ? s.value.replace(/^note\./, '') : null))
      } else {
        const i = ctl.createEl('input', { type: 'text' }) as HTMLInputElement
        i.value = cur ?? ''
        i.addEventListener('change', () => save(i.value))
      }
    }
  }
}

/** The view for `.base` files. */
export class BaseFileView extends TextFileView {
  controller: QueryController
  plugin: any
  /** `editor:open-search` (Ctrl+F) opens the toolbar search. */
  showSearch(): void {
    this.controller?.toolbar?.openSearch()
  }
  private parsedOk = true
  constructor(leaf: any, plugin: any) {
    super(leaf)
    this.plugin = plugin
    this.icon = 'lucide-table'
    this.navigation = true
    const view = this
    this.controller = new QueryController(this.app, plugin, this.contentEl, BaseConfig.fromString(''), {
      currentFile: null,
      save: q => {
        view.data = q.toString()
        view.requestSave()
      }
    })
    this.addChild(this.controller)
  }
  getViewType(): string {
    return VIEW_TYPE_BASES
  }
  getIcon(): string {
    const cfg = this.controller?.getViewConfig()
    return (cfg && this.plugin.getRegistration(cfg.type)?.icon) || 'lucide-table'
  }
  getViewData(): string {
    return this.data
  }
  clear(): void {
    this.data = ''
  }
  setViewData(data: string, _clear: boolean): void {
    this.data = data
    try {
      const q = BaseConfig.fromString(data)
      this.parsedOk = true
      this.controller.currentFile = this.file
      this.controller.setQuery(q)
    } catch (e: any) {
      this.parsedOk = false
      this.controller.displayError(`${L('msgErrorUnableToParse')} ${e.message}`)
    }
  }
  async save(clear?: boolean): Promise<void> {
    if (!this.parsedOk) return
    await super.save(clear)
  }
  getEphemeralState(): any {
    return { viewName: this.controller.viewName }
  }
  setEphemeralState(s: any): void {
    if (s?.viewName) void this.controller.selectView(s.viewName)
  }
}

/** `![[x.base#View]]` */
class BaseEmbed extends Component {
  controller: QueryController | null = null
  constructor(private ctx: any, private path: string, private subpath: string, private plugin: any) {
    super()
    ctx.containerEl.addClass('bases-embed')
  }
  async loadFile(): Promise<void> {
    const app = this.plugin.app
    const file = app.metadataCache.getFirstLinkpathDest(this.path, this.ctx.sourcePath) ?? app.vault.getAbstractFileByPath(this.path)
    const el: HTMLElement = this.ctx.containerEl
    el.empty()
    if (!file) return
    let viewName: string | null = this.subpath ? decodeURIComponent(this.subpath.replace(/^#/, '')) : null
    if (viewName && viewName.startsWith('^')) viewName = null
    const text = await app.vault.read(file)
    let q: BaseConfig
    try {
      q = BaseConfig.fromString(text)
    } catch (e: any) {
      el.createDiv({ cls: 'bases-error', text: `${L('msgErrorUnableToParse')} ${e.message}` })
      return
    }
    this.controller?.unload()
    this.controller = new QueryController(app, this.plugin, el, q, {
      currentFile: file,
      viewName,
      embedded: true,
      save: query => void app.vault.modify(file, query.toString())
    })
    this.addChild(this.controller)
    this.registerEvent(app.vault.on('modify', (f: any) => {
      if (f === file) void app.vault.read(f).then((t: string) => {
        if (t !== this.controller?.query.toString()) try { this.controller?.setQuery(BaseConfig.fromString(t)) } catch { /* ignore */ }
      })
    }))
  }
}

class ChangeViewModal extends FuzzySuggestModal<any> {
  constructor(private c: QueryController) {
    super(c.app)
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to use' },
      { command: 'esc', purpose: 'to dismiss' }
    ])
  }
  renderSuggestion(item: any, el: HTMLElement): void {
    super.renderSuggestion(item, el)
    if (item.item === this.c.getViewConfig()) el.createSpan({ cls: 'flair toolbar-badge', text: 'Active' })
  }
  getItems(): any[] {
    return this.c.query.views
  }
  getItemText(v: any): string {
    return v.name
  }
  onChooseItem(v: any): void {
    void this.c.selectView(v.name)
  }
}

export const basesCorePlugin: any = {
  id: 'bases',
  name: 'Bases',
  description: 'Create custom views that let you edit, sort, and filter files using their properties.',
  defaultOn: true,
  registrations: {} as Record<string, BasesViewRegistration>,
  ConfigureViewModal,

  registerView(id: string, reg: BasesViewRegistration): void {
    if (this.registrations[id]) throw new Error(L('msgErrorRegisterView', { viewId: id }))
    this.registrations[id] = reg
  },
  deregisterView(id: string): void {
    delete this.registrations[id]
  },
  getRegistration(id: string): BasesViewRegistration | null {
    return this.registrations[id] ?? null
  },
  getRegistrations(): Record<string, BasesViewRegistration> {
    return this.registrations
  },
  getViewFactory(id: string): any {
    return this.registrations[id]?.factory ?? null
  },

  async createNewBasesFile(app: any, parent?: any): Promise<any> {
    const folder = parent ?? app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '')
    const path = app.vault.getAvailablePath(`${folder.path === '/' ? '' : folder.path + '/'}Untitled`, 'base')
    return app.vault.create(path, '')
  },
  async createAndOpenBase(app: any, parent?: any, newLeaf = false): Promise<void> {
    const f = await this.createNewBasesFile(app, parent)
    await app.workspace.getLeaf(newLeaf).openFile(f, { active: true, state: { rename: 'all' } })
  },
  async createAndEmbedBase(app: any, editor: any, source: any): Promise<void> {
    const f = await this.createNewBasesFile(app, app.fileManager.getNewFileParent(source?.path ?? ''))
    const link = app.fileManager.generateMarkdownLink(f, source?.path ?? '')
    editor.replaceSelection(link.startsWith('!') ? link : '!' + link)
  },

  onEnable(app: any, p: any): void {
    this.app = app
    this.registrations = {}
    const regs = builtinRegistrations()
    for (const k of Object.keys(regs)) this.registerView(k, regs[k])
    const self = this
    p.registerViewType(VIEW_TYPE_BASES, (leaf: any) => new BaseFileView(leaf, self))
    p.registerExtensions(['base'], VIEW_TYPE_BASES)
    if (!embedRegistry.isExtensionRegistered('base')) embedRegistry.registerExtension('base', (ctx, path, sub) => new BaseEmbed(ctx, path, sub, self) as any)
    p.register(() => embedRegistry.unregisterExtension('base'))
    registerMarkdownCodeBlockProcessor(p, 'base', (source: string, el: HTMLElement, ctx: any) => {
      let q: BaseConfig
      try {
        q = BaseConfig.fromString(source)
      } catch (e: any) {
        el.createDiv({ cls: 'bases-error', text: `${L('msgErrorUnableToParse')} ${e.message}` })
        return
      }
      const file = app.vault.getAbstractFileByPath(ctx.sourcePath)
      el.addClass('bases-embed')
      const c = new QueryController(app, self, el, q, {
        currentFile: file,
        embedded: true,
        save: query => ctx.replaceCode?.(query.toString())
      })
      ctx.addChild(c)
    })
    const activeController = (): QueryController | null => {
      const v = app.workspace.getActiveViewOfType?.(BaseFileView) ?? app.workspace.activeLeaf?.view
      return v instanceof BaseFileView ? v.controller : null
    }
    p.addRibbonIcon('lucide-layout-list', L('actionNewBase').replace('New base', 'Create new base'), () => void self.createAndOpenBase(app))
    p.registerGlobalCommand({ id: 'bases:new-file', name: 'Bases: ' + L('commandCreateNew'), icon: 'lucide-layout-list', callback: () => void self.createAndOpenBase(app) })
    p.registerGlobalCommand({
      id: 'bases:insert', name: 'Bases: ' + L('commandInsertNew'), icon: 'lucide-layout-list',
      editorCheckCallback: (checking: boolean, editor: any, ctx: any) => {
        if (checking) return !!editor
        void self.createAndEmbedBase(app, editor, ctx?.file)
        return true
      }
    })
    p.registerGlobalCommand({
      id: 'bases:copy-table', name: 'Bases: ' + L('commandCopyTable'), icon: 'lucide-copy',
      checkCallback: (checking: boolean) => {
        const c = activeController()
        if (!c || !(c.view instanceof TableView)) return false
        if (!checking) void navigator.clipboard.writeText((c.view as TableView).copyTable()).then(() => new Notice(bt('dialogue.buttonConfirm')))
        return true
      }
    })
    for (const [id, name, fn] of [
      ['bases:change-view', L('commandChangeView'), (c: QueryController) => new ChangeViewModal(c).open()],
      ['bases:add-view', L('commandAddView'), (c: QueryController) => c.promptForAddView()],
      ['bases:add-item', L('commandAddItem'), (c: QueryController) => void c.createFileForView()]
    ] as const) {
      p.registerGlobalCommand({
        id, name: 'Bases: ' + name, icon: 'lucide-shapes',
        checkCallback: (checking: boolean) => {
          const c = activeController()
          if (!c) return false
          if (!checking) fn(c)
          return true
        }
      })
    }
    p.registerEvent(app.workspace.on('file-menu', (menu: any, file: any, source: string) => {
      if (file && 'children' in file && source === 'file-explorer-context-menu') menu.addItem((i: any) => i.setSection('action-primary').setTitle(L('actionNewBase')).setIcon('lucide-layout-list').onClick(() => void self.createAndOpenBase(app, file)))
    }))
    void getMarkdownHost
  },
  onUserDisable(app: any): void {
    app.workspace?.detachLeavesOfType?.(VIEW_TYPE_BASES)
  }
}
