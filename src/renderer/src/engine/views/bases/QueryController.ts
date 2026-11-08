/* eslint-disable @typescript-eslint/no-explicit-any */
// QueryController: owns a BaseConfig, runs it against the vault, hosts the toolbar and the active
// view (table / cards / list / kanban / plugin views).
import { Component } from '../../core/Component'
import { debounce } from '../../vault/debounce'
import { BaseConfig, type ViewConfig, joinPropertyId, splitPropertyId, NO_GROUP_PROPS } from './BaseConfig'
import { BasesContext, BasesEntry } from './context'
import { runQuery, allPropertyIds, BasesQueryResult, knownProperties, parseGroupKey, groupKeyEquals as groupKeyMatches, valueClassOf } from './query'
import { Notice } from '../../ui/Notice'
import { NullValue, NULL, NumberValue, DateValue, BooleanValue, ListValue, Value, compareNatural } from './values'
import { Toolbar } from './toolbar'
import { createRenderContext } from './render'
import { bt } from './strings'
import type { BasesView } from './api'
import { Formula } from './expr/Formula'
import { deriveNewItem } from './newItem'
import type { RenderContext } from './values'

export interface ControllerOptions {
  /** The file `this` refers to (the base file itself, or the note embedding the block). */
  currentFile: any | null
  /** Persist the (edited) config. */
  save: (query: BaseConfig) => void
  /** Initial view name (embeds with `#View`). */
  viewName?: string | null
  /** Embeds hide the "New"/search chrome? */
  embedded?: boolean
}

export class QueryController extends Component {
  app: any
  plugin: any
  query: BaseConfig
  ctx!: BasesContext
  results = new Map<any, BasesEntry>()
  errors: string[] = []
  error: string | null = null
  view: BasesView | null = null
  viewName: string | null
  searchQuery: string | null = null
  viewHeaderEl: HTMLElement
  viewContainerEl: HTMLElement
  errorEl: HTMLElement
  toolbar: Toolbar
  currentFile: any | null
  groupFolds: Record<string, boolean> = {}
  renderCtx!: RenderContext
  private opts: ControllerOptions
  private mountedName: string | null = null
  private allEntries: BasesEntry[] = []
  relevantProperties = new Set<string>()
  resultCount = 0
  searchCount = 0
  private lastResult: BasesQueryResult | null = null
  private runQueued = debounce(() => this.runNow(), 50, false)

  constructor(app: any, plugin: any, public containerEl: HTMLElement, query: BaseConfig, opts: ControllerOptions) {
    super()
    this.app = app
    this.plugin = plugin
    this.opts = opts
    this.currentFile = opts.currentFile
    this.viewName = opts.viewName ?? null
    this.query = query
    this.viewHeaderEl = containerEl.createDiv('bases-header')
    this.errorEl = containerEl.createDiv({ cls: 'bases-error', attr: { style: 'display:none' } })
    this.viewContainerEl = containerEl.createDiv('bases-view')
    this.toolbar = new Toolbar(this)
    this.attachQuery(query)
  }

  onload(): void {
    const rerun = (): void => this.update()
    const { vault, metadataCache } = this.app
    this.registerEvent(metadataCache.on('changed', rerun))
    this.registerEvent(metadataCache.on('resolved', rerun))
    this.registerEvent(vault.on('create', rerun))
    this.registerEvent(vault.on('delete', rerun))
    this.registerEvent(vault.on('rename', rerun))
    this.update()
  }
  onunload(): void {
    this.view?.unload()
    this.view = null
  }

  private attachQuery(q: BaseConfig): void {
    this.query = q
    q.saveFn = () => this.onConfigChanged()
  }
  /** Replace the config (file changed on disk / code block edited) and refresh. */
  setQuery(q: BaseConfig): void {
    this.attachQuery(q)
    this.update(true)
  }
  setQueryAndView(q: BaseConfig, viewName: string | null): void {
    this.viewName = viewName
    this.setQuery(q)
  }
  onConfigChanged(): void {
    this.opts.save(this.query)
    this.update()
  }

  getCurrentFile(): any | null {
    return this.currentFile
  }
  sourcePath(): string {
    return this.currentFile?.path ?? ''
  }
  getViewConfig(): ViewConfig | null {
    return this.query.getViewConfig(this.viewName)
  }
  getQueryViewNames(): string[] {
    return this.query.views.map(v => v.name)
  }
  getSearchQuery(): string | null {
    return this.searchQuery
  }
  updateSearchQuery(q: string | null): void {
    this.searchQuery = q || null
    this.update()
  }
  updateCurrentFile(file: any): void {
    this.currentFile = file
    this.update(true)
  }
  getGroupFolds(): Record<string, boolean> {
    return this.groupFolds
  }
  getAllProperties(): string[] {
    return allPropertyIds(this.app, this.query, this.allEntries)
  }
  /** File properties, the note properties used by the current rows, then formulas. */
  getProperties(): string[] {
    return knownProperties(this.app, this.query, this.relevantProperties)
  }
  getPropertyType(prop: string): string {
    const { type, name } = splitPropertyId(prop)
    if (type === 'formula') return 'formula'
    if (type === 'file') return 'file'
    return this.app.metadataTypeManager?.getPropertyInfo?.(name)?.widget ?? 'text'
  }
  /** Widget type used to edit / sort values of a property (`note.x`, `file.x`, `formula.x` or a bare note name). */
  getWidgetForIdent(ident: string): string {
    const id = ident.includes('.') || ident === 'file' ? (ident === 'file' ? 'file.file' : ident) : 'note.' + ident
    const { type, name } = splitPropertyId(id)
    const tm = this.app.metadataTypeManager
    if (type === 'note') return tm.getTypeInfo(name).inferred.type
    if (type === 'file') {
      if (name === 'ctime' || name === 'mtime') return 'datetime'
      if (name === 'size') return 'number'
      if (name === 'links' || name === 'backlinks' || name === 'embeds' || name === 'tags') return name === 'tags' ? 'tags' : 'multitext'
      return name === 'file' ? 'file' : 'text'
    }
    // formula: look at the first non-null value it produces
    const cls = valueClassOf(this.allEntries.map(e => e.getValue(id) as any).filter(v => v && !(v instanceof NullValue)))
    if (cls === NumberValue) return 'number'
    if (cls === DateValue) return this.allEntries.some(e => (e.getValue(id) as any)?.time) ? 'datetime' : 'date'
    if (cls === BooleanValue) return 'checkbox'
    if (cls === ListValue) return 'multitext'
    return cls === Value ? 'unknown' : 'text'
  }
  canGroupBy(id: string): boolean {
    if (NO_GROUP_PROPS.includes(id)) return false
    const { type, name } = splitPropertyId(id)
    return !(type === 'note' && this.app.metadataTypeManager.getTypeInfo(name).expected.type === 'aliases')
  }
  getSearchCount(): number {
    return this.searchCount
  }
  /** All groups of the current group-by property (listed ones in order, then the rest) for the manual group editor. */
  getAllGroups(): { key: any; id: string; label: string; count: number; isChecked: boolean }[] {
    const cfg = this.getViewConfig()
    const g = cfg?.groupBy
    if (!cfg || !g || !cfg.groupOrder) return []
    const entries = Array.from(this.results.values())
    const label = (v: any): string => (!v || v instanceof NullValue ? bt('plugins.bases.labelGroupKeyNone') : v.toString())
    const listed = cfg.groupOrder.map(o => {
      const key = parseGroupKey(this.app, this.query.file, g.property, o)
      const rows = entries.filter(e => groupKeyMatches(key, e.getValue(g.property) || NULL))
      return { key, id: o, label: label(key), count: rows.length, isChecked: true }
    })
    const rest = entries.filter(e => !listed.some(l => groupKeyMatches(l.key, e.getValue(g.property) || NULL)))
    const other: { key: any; id: string; label: string; count: number; isChecked: boolean }[] = []
    for (const e of rest) {
      const v = e.getValue(g.property) || NULL
      const hit = other.find(o => Value.looseEquals(o.key, v))
      if (hit) hit.count++
      else other.push({ key: v, id: v instanceof NullValue ? '' : v.toString(), label: label(v), count: 1, isChecked: false })
    }
    other.sort((a, b) => compareNatural(a.label, b.label))
    return [...listed, ...other]
  }

  // ------------------------------------------------------------------ export
  exportTable(): { headers: string[]; rows: string[][] } {
    const cfg = this.getViewConfig()!
    const props: string[] = (this.view as any)?.data?.properties ?? cfg.getOrder()
    const headers = props.map(p => cfg.getDisplayName(p))
    const rows = (this.view as any)?.data?.data.map((e: BasesEntry) =>
      props.map(p => {
        try {
          const v = e.getValue(p)
          return v == null || v instanceof NullValue ? '' : v.toString()
        } catch {
          return ''
        }
      })
    )
    return { headers, rows: rows ?? [] }
  }
  copyToClipboard(): void {
    const { headers, rows } = this.exportTable()
    const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n')
    void navigator.clipboard?.writeText?.(tsv)
    new Notice(bt('interface.copied', { item: '' }).trim())
  }
  async exportCsv(): Promise<void> {
    const { headers, rows } = this.exportTable()
    const esc = (s: string): string => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
    const name = (this.getViewConfig()?.name ?? 'Export') + '.csv'
    try {
      await this.app.vault.adapter.exportTextFile?.(csv, name)
    } catch (e) {
      console.error(e)
      new Notice(bt('interface.msgFailedToExport', { filename: name }))
    }
  }

  async selectView(name: string): Promise<void> {
    this.viewName = name
    this.update(true)
  }
  promptForAddView(): void {
    this.toolbar.promptAddView()
  }

  update(force = false): void {
    if (force) this.runNow()
    else this.runQueued()
  }

  private mountView(): void {
    this.view && this.removeChild(this.view)
    this.view = null
    this.viewContainerEl.empty()
    this.viewContainerEl.className = 'bases-view'
    const cfg = this.getViewConfig()
    if (!cfg) {
      this.displayError(bt('plugins.bases.msgErrorViewNotFound', { view: this.viewName ?? '' }))
      return
    }
    const reg = this.plugin.getRegistration(cfg.type)
    if (!reg) {
      this.displayError(bt('plugins.bases.msgErrorUnknownViewType', { viewtype: cfg.type }))
      return
    }
    this.clearError()
    const v = reg.factory(this, this.viewContainerEl)
    this.view = v
    this.addChild(v)
  }

  runNow(): void {
    if (!this._loaded) return
    const cfg = this.getViewConfig()
    if (!cfg) {
      this.displayError(bt('plugins.bases.msgErrorViewNotFound', { view: this.viewName ?? '' }))
      return
    }
    if (!this.viewName) this.viewName = cfg.name
    this.renderCtx = createRenderContext(this.app, this.sourcePath())
    this.ctx = new BasesContext(this.app, null, this.query.formulas || {}, this.currentFile)
    const run = runQuery(this.app, this.query, cfg, this.ctx, { search: this.searchQuery })
    const { all, result, errors } = run
    this.allEntries = all
    this.relevantProperties = run.relevant
    this.resultCount = run.resultCount
    this.searchCount = run.searchCount
    this.results = new Map(all.map(e => [e.file, e]))
    this.errors = errors
    this.lastResult = result
    if (!this.view || this.view.type !== cfg.type || this.mountedName !== cfg.name) {
      this.mountView()
      this.mountedName = cfg.name
    }
    if (errors.length) this.displayError(bt('plugins.bases.msgErrorFilterFailedToEvaluate', { message: errors[0] }))
    else if (this.view) this.clearError()
    this.toolbar.update(result, cfg, this.resultCount)
    this.notifyView()
  }
  notifyView(): void {
    const v = this.view
    const cfg = this.getViewConfig()
    if (!v || !this.lastResult || !cfg) return
    v.data = this.lastResult
    v.allProperties = this.getAllProperties()
    this.viewContainerEl.toggleClass('is-grouped', !!cfg.groupBy)
    try {
      v.onDataUpdated()
    } catch (e: any) {
      console.error(e)
      this.displayError(String(e?.message ?? e))
    }
  }
  displayError(msg: string): void {
    this.error = msg
    this.errorEl.setText(msg)
    this.errorEl.style.display = ''
  }
  clearError(): void {
    this.error = null
    this.errorEl.style.display = 'none'
  }

  // ------------------------------------------------------------------ item creation
  async createFileForView(baseFileName?: string, fmProcessor?: (fm: any, file: any) => void): Promise<void> {
    const app = this.app
    const q = this.query
    const view = this.getViewConfig()
    if (!view) return
    let fm: Record<string, any> = {}
    let folder = q.newItemFolder || ''
    let fromTemplate = false
    const tpl = q.newItemTemplate ? app.vault.getFileByPath?.(q.newItemTemplate) ?? app.vault.getAbstractFileByPath(q.newItemTemplate) : null
    if (tpl && 'extension' in tpl) {
      if (folder === '') folder = tpl.parent?.path || ''
      fm = app.metadataCache.getFileCache(tpl)?.frontmatter || {}
      fromTemplate = true
    }
    if (folder === '') folder = deriveNewItem(app, q, view).folder
    if (folder === '') folder = app.fileManager.getNewFileParent(this.sourcePath()).path
    if (folder && !folder.endsWith('/')) folder += '/'
    const parent = folder ? await app.fileManager.getOrCreateFolder(folder.replace(/^\/+|\/+$/g, '') || '/') : null
    const file = await app.fileManager.createNewFile(parent, baseFileName)
    if (!fromTemplate) fm = deriveNewItem(app, q, view, new BasesEntry(this.ctx, file)).frontmatter
    await app.fileManager.processFrontMatter(file, (f: any) => {
      for (const k in fm) f[k] = fm[k]
      fmProcessor?.(f, file)
    })
    await app.workspace.getLeaf(false).openFile(file, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } })
  }

  // ------------------------------------------------------------------ editing helpers (views / toolbar)
  addFormula(name: string, text: string): void {
    const q = this.query
    q.formulas = q.formulas || {}
    q.formulas[name] = new Formula(text)
    const cfg = this.getViewConfig()
    const id = joinPropertyId('formula', name)
    if (cfg) cfg.setOrder([...cfg.getOrder(), id])
    else q.save()
  }
}
