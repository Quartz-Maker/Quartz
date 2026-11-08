/* eslint-disable @typescript-eslint/no-explicit-any */
// Pages of the Bases toolbar popovers: views, view configuration, results, sort, group, properties
// and property editing.
import { Menu } from '../../ui/Menu'
import { Notice } from '../../ui/Notice'
import type { SearchComponent } from '../../ui/setting'
import { setIcon } from '../../ui/icons'
import { prepareFuzzySearch } from '../../search/fuzzy'
import { CustomArrayDict } from '../../metadata/helpers'
import { parseLinktext, stripHeading, stripHeadingForLink } from '../../metadata/linktext'
import { replaceReference, type LinkChange } from '../../metadata/linkUpdate'
import { ViewConfig, splitPropertyId, joinPropertyId, FILE_PROPERTIES } from './BaseConfig'
import { Combobox, PropertyCombobox, type ComboItem } from './combobox'
import { appendHelpIcon, FormulaEditor } from './formulaEditor'
import { Formula } from './expr/Formula'
import {
  ActionRow, GroupedChooser, L, MenuPage, ToolbarMenu, dropdownControl, inputRow, searchBox, sliderControl, textControl, toggleControl
} from './popover'
import { bt } from './strings'
import { NullValue } from './values'
import type { QueryController } from './QueryController'

export const INVALID_VIEW_NAME = /[\\/:]/
const INVALID_CHARS = ['#', ':', '|', '^', '%%', '[[', ']]'].join(' ')
const collator = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true })

/** "Name", "Name 2", "Name 3"... first one not in `taken`. */
export function uniqueName(taken: Set<string>, base: string): string {
  let n = base
  for (let i = 2; taken.has(n); i++) n = `${base} ${i}`
  return n
}
function moveItem<T>(arr: T[], from: number, to: number): void {
  const [x] = arr.splice(from, 1)
  arr.splice(to, 0, x)
}
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

// ---------------------------------------------------------------------------------------------- views
export class ViewsPage extends MenuPage {
  chooser: GroupedChooser<{ config: ViewConfig | null; group: string }>
  searchEl: HTMLInputElement
  searchComp: SearchComponent
  private handleSelect: ((v: ViewConfig) => void) | null = null
  private handleNext: ((v: ViewConfig) => void) | null = null
  constructor(host: ToolbarMenu, private c: QueryController) {
    super(host)
    this.containerEl.addClass('bases-views-page')
    const s = searchBox(this.containerEl, bt('plugins.search.promptStartSearch'), () => this.renderViews())
    this.searchEl = s.inputEl
    this.searchComp = s
    const list = this.containerEl.createDiv('bases-toolbar-items')
    this.chooser = new GroupedChooser<any>(
      { renderSuggestion: (v, el) => this.renderSuggestion(v, el), selectSuggestion: v => (v.config ? this.handleSelect?.(v.config) : this.addView()) },
      list,
      this.scope
    )
    this.scope.register([], 'ArrowRight', () => {
      const v = this.chooser.getSelectedValue()
      if (v?.config) this.handleNext?.(v.config)
    })
  }
  onSelect(fn: (v: ViewConfig) => void): this {
    this.handleSelect = fn
    return this
  }
  onNext(fn: (v: ViewConfig) => void): this {
    this.handleNext = fn
    return this
  }
  override onShow(): void {
    this.searchComp.autoSelect()
    this.renderViews()
  }
  renderViews(): void {
    const q = this.searchEl.value.trim()
    const match = q ? prepareFuzzySearch(q) : null
    const items: { config: ViewConfig | null; group: string }[] = []
    for (const v of this.c.query.views) if (!match || match(v.name)) items.push({ config: v, group: 'views' })
    items.push({ config: null, group: 'actions' })
    this.chooser.setSuggestions(items)
  }
  renderSuggestion(item: { config: ViewConfig | null }, el: HTMLElement): void {
    el.addClass('bases-toolbar-menu-item')
    const info = el.createDiv('bases-toolbar-menu-item-info')
    const icon = info.createDiv('bases-toolbar-menu-item-info-icon')
    const cfg = item.config
    if (!cfg) {
      setIcon(icon, 'lucide-plus')
      info.createDiv({ cls: 'bases-toolbar-menu-item-name', text: L('buttonAddView') })
      return
    }
    setIcon(icon, this.c.plugin.getRegistration(cfg.type)?.icon || 'lucide-table')
    info.createDiv({ cls: 'bases-toolbar-menu-item-name', text: cfg.name })
    el.toggleClass('mod-active', this.c.viewName === cfg.name)
    const next = el.createDiv('clickable-icon bases-toolbar-menu-item-icon')
    setIcon(next, 'lucide-chevron-right')
    next.addEventListener('click', e => {
      e.preventDefault()
      if (this.chooser.getSelectedValue()) this.handleNext?.(cfg)
    })
    dragReorder(icon, el, el.parentElement!, to => {
      const q = this.c.query
      moveItem(q.views, q.views.indexOf(cfg), to)
      q.save()
    })
  }
  addView(): void {
    const q = this.c.query
    const base = this.searchEl.value.trim() || L('labelDefaultView')
    const name = uniqueName(new Set(q.views.map(v => v.name)), base)
    const cfg = new ViewConfig(q, 'table', name)
    this.host.show(new ViewConfigPage(this.host, this.c, cfg, true))
  }
}

/** Pointer drag on a grip: calls `move(newIndex)` when the row crosses its siblings. */
export function dragReorder(handle: HTMLElement, row: HTMLElement, container: HTMLElement, move: (to: number) => void): void {
  handle.addEventListener('mousedown', down => {
    if (down.button !== 0) return
    const siblings = (): HTMLElement[] => Array.from(container.children) as HTMLElement[]
    const start = siblings().indexOf(row)
    let moved = false
    const onMove = (e: MouseEvent): void => {
      moved = true
      row.addClass('is-being-dragged')
      void e
    }
    const onUp = (e: MouseEvent): void => {
      win.removeEventListener('mousemove', onMove)
      win.removeEventListener('mouseup', onUp)
      row.removeClass('is-being-dragged')
      if (!moved) return
      const els = siblings()
      let to = els.findIndex(el => el !== row && e.clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)
      if (to === -1) to = els.length - 1
      else if (to > start) to -= 1
      if (to !== start) move(to)
    }
    const win = handle.ownerDocument.defaultView || window
    win.addEventListener('mousemove', onMove)
    win.addEventListener('mouseup', onUp)
  })
}

// ---------------------------------------------------------------------------------------------- view configuration
export class ViewConfigPage extends MenuPage {
  private formEl: HTMLElement
  private controls = new Map<any, HTMLElement>()
  constructor(host: ToolbarMenu, private c: QueryController, private view: ViewConfig, isNew: boolean) {
    super(host)
    this.setTitle(L('labelConfigureView'))
    this.addAction('lucide-more-vertical', (e, el) => this.showActions(e, el))
    this.scope.register([], 'Escape', e => {
      if (!e.defaultPrevented && !isEditable(this.containerEl.ownerDocument.activeElement)) this.host.back()
    })
    this.formEl = this.containerEl.createDiv('bases-toolbar-menu-form view-config-menu')
    this.display(view, isNew, true)
  }
  private display(view: ViewConfig, isNew = false, first = false): void {
    const c = this.c
    const q = c.query
    this.controls.clear()
    const form = this.formEl
    form.empty()
    let name = view.name
    let error = ''
    const nameRow = inputRow(form)
    const input = textControl(nameRow.content, { placeholder: L('labelViewName'), value: view.name })
    if (first) input.addClass('node-insert-event')
    input.addEventListener('input', () => {
      name = input.value.trim()
      error = !name ? L('msgEmptyViewName') : INVALID_VIEW_NAME.test(name) ? L('msgInvalidViewName') + INVALID_CHARS : q.views.some(v => v.name === name && v !== view) ? L('msgDuplicateViewName') : ''
      if (error) input.setAttribute('aria-label', error)
      else input.removeAttribute('aria-label')
    })
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        input.value = name = view.name
        input.blur()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (!error) input.blur()
      }
    })
    input.addEventListener('blur', () => {
      if ((isNew || view.name !== name) && !error) {
        const oldName = view.name
        view.name = name
        const wasNew = isNew
        if (isNew) {
          q.views.push(view)
          isNew = false
        }
        void c.selectView(name)
        q.save()
        const bf = (q as any).file ?? c.getCurrentFile()
        if (!wasNew && bf?.extension === 'base') void updateViewLinks(c.app, bf, oldName, name)
      }
    })
    if (isNew) {
      input.focus()
      input.select()
    }
    const regs = c.plugin.getRegistrations() as Record<string, any>
    const layout = inputRow(form, L('labelViewLayout'))
    new Combobox(c.app, layout.content)
      .setItems(Object.keys(regs).map(id => ({ value: id, display: regs[id].name, icon: regs[id].icon })))
      .setValueById(view.type)
      .onSelect(it => {
        if (!it) return
        view.type = it.value
        this.display(view)
        q.save()
      })
    const reg = c.plugin.getRegistration(view.type)
    const save = (k: string, v: any): void => {
      view.set(k, v)
      this.updateHidden(view)
    }
    const build = (parent: HTMLElement, o: any): void => {
      if (o.type === 'group') {
        let collapsed = true
        const box = parent.createDiv('input-group-container')
        this.controls.set(o, box)
        if (parent.hasChildNodes()) box.createDiv('input-group-divider')
        const head = box.createDiv('input-group').createDiv('input-group-header')
        const arrow = head.createDiv({ cls: 'collapse-icon is-collapsed' })
        setIcon(arrow, 'right-triangle')
        head.createDiv({ cls: 'input-group-header-text', text: o.displayName })
        const content = box.createDiv('input-group-content')
        content.hide()
        for (const it of o.items) build(content, it)
        head.addEventListener('click', e => {
          e.preventDefault()
          collapsed = !collapsed
          arrow.toggleClass('is-collapsed', collapsed)
          content.toggle(!collapsed)
        })
        return
      }
      const cur = view.get(o.key) ?? o.default
      const { row, labelEl, content } = inputRow(parent, o.displayName)
      this.controls.set(o, row)
      switch (o.type) {
        case 'dropdown':
          dropdownControl(content, o.options, typeof cur === 'string' ? cur : '', v => save(o.key, v === '' ? null : v))
          break
        case 'slider':
          sliderControl(content, { min: o.min, max: o.max, step: o.step, value: typeof cur === 'number' ? cur : null, onChange: v => save(o.key, v) })
          break
        case 'text':
          textControl(content, { placeholder: String(o.placeholder), value: typeof cur === 'string' ? cur : '', onChange: v => save(o.key, v) })
          break
        case 'toggle':
          toggleControl(content, typeof cur === 'boolean' && cur, v => save(o.key, v))
          break
        case 'property':
          new PropertyCombobox(c, content)
            .setPlaceholder(o.placeholder ?? bt('plugins.bases.labelPropertyKey'))
            .filterProperties(o.filter ?? (() => true))
            .setClearable(true)
            .setValueById(typeof cur === 'string' ? cur : '')
            .onSelect(it => save(o.key, it?.value ? it.value.replace(/^note\./, '') : null))
          break
        case 'file':
        case 'folder':
          textControl(content, { placeholder: o.placeholder ?? '', value: typeof cur === 'string' ? cur : '', onChange: v => save(o.key, v) })
          break
        case 'formula':
          new FormulaEditor(content, new Formula(typeof cur === 'string' ? cur : ''), { placeholder: o.placeholder, updateFormula: f => view.set(o.key, f.toString()) })
          if (labelEl) appendHelpIcon(labelEl)
          break
      }
    }
    for (const o of reg?.options?.(view) ?? []) build(form, o)
    this.updateHidden(view)
  }
  private updateHidden(view: ViewConfig): void {
    this.controls.forEach((el, o) => {
      const hide = o.shouldHide?.(view)
      el.toggle(!hide)
      if (o.type === 'group' && !hide) el.toggle(o.items.some((i: any) => !i.shouldHide?.(view)))
    })
  }
  showActions(e: MouseEvent, el: HTMLElement): void {
    if (el.hasClass('has-active-menu')) return
    const { c, view, host } = this
    const q = c.query
    const m = Menu.forEvent(e)
    m.addSections(['action', '', 'danger'])
    m.setParentElement(el)
    m.addItem(i =>
      i.setTitle(L('actionSetDefaultView')).setIcon('lucide-layers-2').setSection('action').setChecked(q.views.indexOf(view) === 0).onClick(() => {
        moveItem(q.views, q.views.indexOf(view), 0)
        q.save()
      })
    )
    m.addItem(i =>
      i.setTitle(L('actionDuplicateView')).setIcon('lucide-files').setSection('action').onClick(() => {
        host.back()
        const copy = view.clone(uniqueName(new Set(q.views.map(v => v.name)), view.name))
        host.show(new ViewConfigPage(host, c, copy, true))
        q.save()
      })
    )
    m.addItem(i =>
      i.setTitle(L('actionDeleteView')).setIcon('lucide-trash-2').setSection('danger').setWarning(true).onClick(() => {
        const idx = q.views.indexOf(view)
        if (idx >= 0) {
          q.views.splice(idx, 1)
          const next = q.views[clamp(idx - 1, 0, q.views.length)]
          if (next) void c.selectView(next.name)
        }
        host.back()
        q.save()
      })
    )
  }
}
/** Renaming a view also rewrites `[[file.base#View]]` links elsewhere in the vault. */
async function updateViewLinks(app: any, file: any, oldName: string, newName: string): Promise<void> {
  const mc = app.metadataCache
  const changes = new CustomArrayDict<LinkChange>()
  const oldKey = stripHeadingForLink(oldName).toLowerCase()
  const next = stripHeading(newName)
  mc.iterateAllRefs((src: string, ref: any) => {
    const { path, subpath } = parseLinktext(ref.link)
    if (!subpath || stripHeadingForLink(subpath.substring(1)).toLowerCase() !== oldKey) return
    if (mc.getFirstLinkpathDest(path, src) !== file) return
    changes.add(src, { sourcePath: src, reference: ref, change: replaceReference(ref, path + '#' + next) })
  })
  const count = changes.count()
  if (count === 0) return
  await mc.updateInternalLinks(changes)
  new Notice(bt('dialogue.msgUpdatedLinks', { links: `${count} link${count === 1 ? '' : 's'}`, files: `${changes.data.size} file${changes.data.size === 1 ? '' : 's'}` }))
}

const isEditable = (el: Element | null): boolean => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)

// ---------------------------------------------------------------------------------------------- results
export class ResultsPage extends MenuPage {
  constructor(host: ToolbarMenu, private results: ResultsHost) {
    super(host, 'bases-results-page')
    this.setTitle(L('labelResults'))
  }
  override onShow(): void {
    const { host, results } = this
    const cfg = results.viewConfig!
    const el = this.containerEl
    el.empty()
    const form = el.createDiv('bases-toolbar-menu-form')
    const actions = el.createDiv('bases-toolbar-section').createDiv('bases-toolbar-items').createDiv('bases-menu-group mod-actions')
    const row = inputRow(form, L('labelLimit'))
    const lim = cfg.getLimit()
    const input = row.content.createEl('input', { type: 'number', attr: { min: '1', step: '1' } }) as HTMLInputElement
    input.placeholder = L('placeholderLimit')
    input.value = lim !== 0 ? String(lim) : ''
    const showAll = new ActionRow(actions).setIcon('lucide-rotate-ccw').onClick(() => {
      cfg.setLimit(0)
      host.close()
    })
    const upd = (): void => {
      const n = cfg.getLimit()
      showAll.setText(n === 0 ? L('buttonShowAll') : L('buttonShowAllCount', { count: results.resultCount }))
      showAll.rowEl.toggleClass('mod-hidden', n === 0)
    }
    upd()
    input.addEventListener('input', () => {
      input.removeClass('mod-error')
      if (input.value === '') cfg.setLimit(0)
      else {
        const n = parseInt(input.value)
        if (!isNaN(n) && n >= 0) cfg.setLimit(n)
        else input.addClass('mod-error')
      }
      upd()
    })
    input.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        host.close()
      }
    })
    const list: { name: string; icon?: string; callback: () => void; destructive?: boolean }[] = [
      { name: bt('interface.labelCopy'), icon: 'lucide-copy', callback: () => results.copyToClipboard() },
      { name: L('actionExportCSV'), icon: 'lucide-file-down', callback: () => results.exportCsv() }
    ]
    for (const a of list) {
      const r = new ActionRow(actions).setText(a.name).onClick(() => {
        host.close()
        a.callback()
      })
      if (a.icon) r.setIcon(a.icon)
    }
  }
}
export interface ResultsHost {
  viewConfig: ViewConfig | null
  resultCount: number
  copyToClipboard(): void
  exportCsv(): void
}

// ---------------------------------------------------------------------------------------------- sort / group rows
export type Dir = 'ASC' | 'DESC' | 'MANUAL'

export abstract class SortRowBase {
  rowEl!: HTMLElement
  wrapperEl!: HTMLElement
  propertyCombobox!: PropertyCombobox
  sortDirectionCombobox!: Combobox
  constructor(protected c: QueryController, public property: string | null, public direction: Dir) {}
  abstract propertyFilter(id: string): boolean
  abstract handleSave(): void
  abstract handleDelete(): void
  getDirectionItems(labels: { ASC: string; DESC: string }): ComboItem[] {
    return [
      { value: 'ASC', display: labels.ASC },
      { value: 'DESC', display: labels.DESC }
    ]
  }
  render(parent: HTMLElement): void {
    const c = this.c
    const row = (this.rowEl = parent.createDiv('base-toolbar-sort-item'))
    const wrap = (this.wrapperEl = row.createDiv('metadata-property bases-sort-property-container'))
    this.propertyCombobox = new PropertyCombobox(c, wrap)
      .filterProperties(id => this.propertyFilter(id))
      .setValueById(this.property)
      .setPlaceholder(L('labelPropertyKey'))
      .onSelect(it => {
        const v = it?.value ?? null
        if (this.property !== v) {
          this.property = v
          this.configure()
          this.handleSave()
        }
        this.sortDirectionCombobox.focus()
      }) as PropertyCombobox
    this.propertyCombobox.buttonEl.addClass('bases-sort-property')
    this.sortDirectionCombobox = new Combobox(c.app, wrap).onSelect(it => {
      if (it && this.direction !== it.value) {
        this.direction = it.value as Dir
        this.handleSave()
      }
    })
    this.sortDirectionCombobox.buttonEl.addClass('bases-sort-direction')
    this.configure()
    const del = row.createDiv('clickable-icon')
    setIcon(del, 'lucide-trash-2')
    del.addEventListener('click', () => this.handleDelete())
  }
  update(property: string | null, direction: Dir): void {
    this.property = property
    this.direction = direction
    this.propertyCombobox.setValueById(property)
    this.configure()
  }
  configure(): void {
    const c = this.c
    let labels = { ASC: L('labelSortAZ'), DESC: L('labelSortZA') }
    if (this.property) {
      const w = c.getWidgetForIdent(this.property)
      if (w === 'date' || w === 'datetime') labels = { ASC: L('labelSortOldNew'), DESC: L('labelSortNewOld') }
      else if (w === 'number') labels = { ASC: L('labelSort01'), DESC: L('labelSort10') }
    }
    const bad = (() => {
      if (!this.property) return false
      const { type, name } = splitPropertyId(this.property)
      return type === 'formula' && !Object.hasOwn(c.query.formulas ?? {}, name)
    })()
    this.wrapperEl.toggleClass('mod-error', bad)
    const icon = this.propertyCombobox.iconEl
    icon.setAttribute('aria-label', bad ? L('msgErrorInvalidProperty') : '')
    if (bad) {
      icon.empty()
      setIcon(icon, 'lucide-alert-triangle')
    }
    this.sortDirectionCombobox.setItems(this.getDirectionItems(labels))
    this.sortDirectionCombobox.setValueById(this.direction)
  }
}

export class SortRow extends SortRowBase {
  constructor(private page: SortPage, c: QueryController, p: string | null, d: Dir) {
    super(c, p, d)
  }
  override render(parent: HTMLElement): void {
    super.render(parent)
    const grip = createDiv('grip-handle')
    setIcon(grip, 'lucide-grip-vertical')
    dragReorder(grip, this.rowEl, parent, to => this.page.moveRow(this, to))
    this.rowEl.insertBefore(grip, this.rowEl.firstChild)
  }
  propertyFilter(id: string): boolean {
    return id !== 'file.file' && id !== 'file.backlinks'
  }
  handleSave(): void {
    this.page.saveSort()
  }
  handleDelete(): void {
    this.page.removeRow(this)
  }
}

export class SortPage extends MenuPage {
  rows: SortRow[] = []
  private rowsEl: HTMLElement
  constructor(host: ToolbarMenu, private c: QueryController) {
    super(host, 'bases-sort-page')
    this.setTitle(L('labelSort'))
    const sec = this.containerEl.createDiv('bases-toolbar-section bases-sort-container')
    sec.createDiv({ cls: 'bases-toolbar-section-header', text: L('labelSortBy') })
    this.rowsEl = sec.createDiv('bases-toolbar-section-content').createDiv('bases-toolbar-items')
    const act = this.containerEl.createDiv('bases-toolbar-section bases-toolbar-menu-actions')
    new ActionRow(act).setIcon('lucide-plus').setText(L('labelAddSort')).onClick(() => this.addRow().propertyCombobox.focus())
  }
  override onShow(): void {
    this.display()
  }
  display(): void {
    const empty = this.rows.filter(r => !r.property)
    const cur = this.c.getViewConfig()?.getSort() ?? []
    const keep: SortRow[] = []
    for (const s of cur) {
      let r = this.rows.find(x => x.property === s.property && !keep.includes(x))
      if (!r) {
        r = new SortRow(this, this.c, s.property, s.direction)
        r.render(this.rowsEl)
      } else if (r.direction !== s.direction) r.update(s.property, s.direction)
      keep.push(r)
    }
    this.rows = [...keep, ...empty]
    this.rowsEl.setChildrenInPlace(this.rows.map(r => r.rowEl))
    if (this.rows.length === 0) this.addRow()
  }
  addRow(): SortRow {
    const r = new SortRow(this, this.c, null, 'ASC')
    this.rows.push(r)
    r.render(this.rowsEl)
    return r
  }
  removeRow(r: SortRow): void {
    this.rows = this.rows.filter(x => x !== r)
    r.rowEl.detach()
    this.saveSort()
    if (this.rows.length === 0) this.addRow()
  }
  moveRow(r: SortRow, to: number): void {
    const i = this.rows.indexOf(r)
    if (to === -1 || to === i) return
    moveItem(this.rows, i, to)
    this.rowsEl.setChildrenInPlace(this.rows.map(x => x.rowEl))
    this.saveSort()
  }
  saveSort(): void {
    const cfg = this.c.getViewConfig()
    if (!cfg) return
    cfg.sort = this.rows.filter(r => !!r.property).map(r => ({ property: r.property!, direction: r.direction as 'ASC' | 'DESC' }))
    this.c.query.save()
  }
}

// ---------------------------------------------------------------------------------------------- group
export class GroupRow extends SortRowBase {
  constructor(private page: GroupPage, c: QueryController, p: string | null, d: Dir) {
    super(c, p, d)
  }
  propertyFilter(id: string): boolean {
    return this.c.canGroupBy(id)
  }
  override getDirectionItems(labels: { ASC: string; DESC: string }): ComboItem[] {
    return [...super.getDirectionItems(labels), { value: 'MANUAL', display: L('labelSortManual') }]
  }
  handleSave(): void {
    if (this.property) this.page.setGroupBy(this.property, this.direction)
  }
  handleDelete(): void {
    this.page.setGroupBy(null, 'ASC')
  }
}

interface GroupItem {
  group: 'rows' | 'actions'
  row?: { key: any; label: string; id: string; count: number; isChecked: boolean }
  icon?: string
  name?: string
  callback?: () => void
}

export class GroupPage extends MenuPage {
  private groupByRowEl: HTMLElement
  private listSectionEl: HTMLElement
  private groupRow: GroupRow | null = null
  private chooser: GroupedChooser<GroupItem>
  private items: GroupItem[] = []
  private removedOrder: any[] | null = null
  constructor(host: ToolbarMenu, private c: QueryController) {
    super(host, 'bases-group-page')
    this.setTitle(L('labelGroup'))
    const sec = this.containerEl.createDiv('bases-toolbar-section bases-groupby-container')
    sec.createDiv({ cls: 'bases-toolbar-section-header', text: L('labelGroupBy') })
    this.groupByRowEl = sec.createDiv('bases-toolbar-section-content').createDiv('bases-toolbar-items')
    this.listSectionEl = this.containerEl.createDiv('bases-toolbar-section bases-group-list-container')
    const list = this.listSectionEl.createDiv('bases-toolbar-items bases-group-list')
    this.chooser = new GroupedChooser<GroupItem>(
      { renderSuggestion: (v, el) => this.renderSuggestion(v, el), selectSuggestion: (v, e) => this.selectSuggestion(v, e) },
      list,
      this.scope
    ).setGroups(['rows', 'actions'])
  }
  private get cfg(): ViewConfig {
    return this.c.getViewConfig()!
  }
  get isManual(): boolean {
    return !!this.cfg.groupOrder
  }
  override onShow(): void {
    this.display()
  }
  override onHide(): void {
    this.removedOrder = null
  }
  refresh(): void {
    this.display()
  }
  display(): void {
    const g = this.cfg.groupBy
    const prop = g?.property ?? null
    const dir: Dir = this.isManual ? 'MANUAL' : g?.direction ?? 'ASC'
    if (!this.groupRow) {
      this.groupRow = new GroupRow(this, this.c, prop, dir)
      this.groupRow.render(this.groupByRowEl)
    }
    this.groupRow.update(prop, dir)
    this.listSectionEl.toggle(this.isManual)
    this.renderRows()
  }
  setGroupBy(prop: string | null, dir: Dir): void {
    const cfg = this.cfg
    if (prop !== (cfg.groupBy?.property ?? null)) this.removedOrder = null
    if (prop) {
      const d = dir === 'MANUAL' ? cfg.groupBy?.direction ?? 'ASC' : dir
      cfg.setGroupBy({ property: prop, direction: d })
      if (dir === 'MANUAL') {
        if (!cfg.groupOrder) {
          cfg.setGroupOrder(this.removedOrder ?? [])
          this.removedOrder = null
        }
      } else if (cfg.groupOrder) {
        this.removedOrder = cfg.groupOrder.slice()
        cfg.setGroupOrder(null)
      }
    } else cfg.setGroupBy(null)
    this.display()
  }
  private renderRows(): void {
    this.items = []
    if (this.isManual) {
      const groups = this.c.getAllGroups()
      for (const g of groups) this.items.push({ group: 'rows', row: g })
      const anyOn = groups.some((g: any) => g.isChecked)
      this.items.push({ group: 'actions', icon: 'lucide-plus', name: L('actionAddGroup'), callback: () => this.addGroup() })
      this.items.push({ group: 'actions', icon: anyOn ? 'lucide-eye-off' : 'lucide-eye', name: anyOn ? L('actionHideAll') : bt('plugins.bases.buttonShowAll'), callback: () => this.toggleAll() })
    }
    this.chooser.setSuggestions(this.items)
  }
  renderSuggestion(item: GroupItem, el: HTMLElement): void {
    el.addClass('bases-toolbar-menu-item')
    el.addEventListener('mousedown', e => e.preventDefault())
    if (item.group === 'actions') {
      const info = el.createDiv('bases-toolbar-menu-item-info')
      setIcon(info.createDiv('bases-toolbar-menu-item-info-icon'), item.icon!)
      info.createDiv({ cls: 'bases-toolbar-menu-item-name', text: item.name })
      return
    }
    const row = item.row!
    el.addClass('bases-group-row')
    el.toggleClass('mod-hidden', !row.isChecked)
    setIcon(el.createDiv('grip-handle'), 'lucide-grip-vertical')
    const cb = el.createEl('input', { type: 'checkbox' }) as HTMLInputElement
    cb.checked = row.isChecked
    const nameEl = el.createDiv('bases-toolbar-menu-item-info').createDiv('bases-toolbar-menu-item-name')
    if (!row.key || row.key instanceof NullValue) nameEl.setText(L('labelGroupKeyNone'))
    else (row.key as any).renderTo(nameEl, this.c.renderCtx)
    el.createDiv({ cls: 'bases-group-row-count', text: row.count.toLocaleString() })
  }
  selectSuggestion(item: GroupItem, e: MouseEvent | KeyboardEvent): void {
    e?.preventDefault?.()
    if (item.group === 'actions') return item.callback?.()
    item.row!.isChecked = !item.row!.isChecked
    this.saveOrder()
    this.renderRows()
  }
  /** Offers the groups that are currently hidden so they can be added back to the manual order. */
  private addGroup(): void {
    const hidden = this.items.filter(i => i.group === 'rows' && !i.row!.isChecked)
    if (!hidden.length) return
    const m = new Menu()
    for (const i of hidden) {
      m.addItem(mi => {
        const key = i.row!.key
        mi.setTitle(!key || key instanceof NullValue ? L('labelGroupKeyNone') : String((key as any).toString())).onClick(() => {
          i.row!.isChecked = true
          this.saveOrder()
          this.renderRows()
        })
      })
    }
    const el = this.containerEl.querySelector('.bases-toolbar-menu-item:last-child') as HTMLElement | null
    const r = (el ?? this.containerEl).getBoundingClientRect()
    m.showAtPosition({ x: r.left, y: r.bottom })
  }
  private toggleAll(): void {
    const on = !this.items.some(i => i.group === 'rows' && i.row!.isChecked)
    for (const i of this.items) if (i.group === 'rows') i.row!.isChecked = on
    this.saveOrder()
    this.renderRows()
  }
  private saveOrder(): void {
    const order = this.items.filter(i => i.group === 'rows' && i.row!.isChecked).map(i => i.row!.id)
    this.cfg.setGroupOrder(order)
  }
}

// ---------------------------------------------------------------------------------------------- properties
interface PropItem {
  group: 'properties' | 'actions'
  type: 'property' | 'action'
  propId?: string
  name?: string
  icon?: string
  callback?: () => void
}

export class PropertiesPage extends MenuPage {
  private query = ''
  private searchEl: HTMLInputElement
  private searchComp: SearchComponent
  private chooser: GroupedChooser<PropItem>
  constructor(host: ToolbarMenu, private c: QueryController) {
    super(host)
    this.setTitle(L('labelProperties'))
    this.containerEl.addClass('bases-properties-page')
    const s = searchBox(this.containerEl, L('placeholderSearchProperty'), v => {
      this.query = v
      this.renderProperties()
    })
    this.searchEl = s.inputEl
    this.searchComp = s
    const list = this.containerEl.createDiv('bases-toolbar-items')
    this.chooser = new GroupedChooser<PropItem>(
      { renderSuggestion: (v, el) => this.renderSuggestion(v, el), selectSuggestion: (v, e) => this.selectSuggestion(v, e) },
      list,
      this.scope
    )
    this.scope.register([], 'ArrowRight', () => {
      const v = this.chooser.getSelectedValue()
      if (v?.type === 'property') this.showEditPage(v.propId!)
    })
    this.scope.register(['Alt'], 'ArrowUp', () => this.moveSelected(-1))
    this.scope.register(['Alt'], 'ArrowDown', () => this.moveSelected(1))
  }
  override onShow(): void {
    this.searchComp.autoSelect()
    this.renderProperties()
  }
  private get cfg(): ViewConfig {
    return this.c.getViewConfig()!
  }
  private moveSelected(d: number): false {
    const v = this.chooser.getSelectedValue()
    if (v?.type === 'property') {
      const order = this.cfg.getOrder()
      const i = order.indexOf(v.propId!)
      if (i !== -1) {
        moveItem(order, i, clamp(i + d, 0, order.length - 1))
        this.cfg.setOrder(order)
        this.renderProperties()
        this.chooser.setSelectedItem(this.chooser.values!.findIndex(x => x.type === 'property' && x.propId === v.propId), null)
      }
    }
    return false
  }
  showEditPage(id: string, isNew = false): void {
    this.host.show(new PropertyEditPage(this.host, this.c, id, isNew))
  }
  private toggleVisibility(id: string): void {
    const order = this.cfg.getOrder()
    const i = order.indexOf(id)
    if (i !== -1) order.splice(i, 1)
    else order.push(id)
    this.cfg.setOrder(order)
  }
  private setVisible(id: string, vis: boolean): void {
    if (this.cfg.getOrder().includes(id) !== vis) this.toggleVisibility(id)
  }
  renderProperties(): void {
    const c = this.c
    const cfg = this.cfg
    const order = cfg.getOrder()
    const q = this.query.trim()
    const match = this.query ? prepareFuzzySearch(this.query.trim()) : null
    const tm = c.app.metadataTypeManager
    const all = tm.getAllProperties()
    const ids = c.getProperties().filter(p => p !== 'file.file')
    if (this.query) for (const k of Object.keys(all)) {
      const id = joinPropertyId('note', all[k].name)
      if (!ids.includes(id)) ids.push(id)
    }
    for (const p of order) if (!ids.includes(p)) ids.push(p)
    ids.sort((a, b) => collator.compare(a, b))
    const pos = new Map(order.map((p, i) => [p, i]))
    ids.sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity))
    const items: PropItem[] = []
    for (const id of ids) {
      const name = splitPropertyId(id).name
      const disp = cfg.getDisplayName(id)
      if (!match || match(disp) || (disp !== name && match(name))) items.push({ type: 'property', propId: id, group: 'properties' })
    }
    if (q && !Object.hasOwn(all, q)) {
      items.push({
        type: 'action', group: 'actions', name: L('actionAddProperty', { name: q }), icon: 'lucide-plus',
        callback: () => {
          const id = joinPropertyId('note', this.query.trim() || L('labelUntitledProperty'))
          this.setVisible(id, true)
          this.showEditPage(id, true)
        }
      })
    }
    items.push({
      type: 'action', group: 'actions', name: L('actionAddFormula'), icon: 'lucide-square-function',
      callback: () => {
        const name = uniqueName(new Set(Object.keys(c.query.formulas ?? {})), this.query.trim() || L('labelUntitledProperty'))
        const id = joinPropertyId('formula', name)
        this.updateFormula(name, new Formula(''))
        this.setVisible(id, true)
        this.showEditPage(id, true)
      }
    })
    items.push({
      type: 'action', group: 'actions', name: L('actionHideAll'), icon: 'lucide-eye-off',
      callback: () => {
        cfg.setOrder([])
        this.renderProperties()
      }
    })
    this.chooser.setSuggestions(items)
  }
  private updateFormula(name: string, f: Formula): void {
    const q = this.c.query
    const fs = q.formulas ?? {}
    fs[name] = f
    q.setFormulas(fs)
  }
  selectSuggestion(item: PropItem, _e: MouseEvent | KeyboardEvent): void {
    const el = this.chooser.getSelectedElement()
    if (item.type === 'action') item.callback!()
    else this.toggleVisibility(item.propId!)
    if (el && this.chooser.suggestions.includes(el)) {
      el.empty()
      this.renderSuggestion(item, el)
    }
  }
  renderSuggestion(item: PropItem, el: HTMLElement): void {
    const c = this.c
    el.addClass('bases-toolbar-menu-item')
    el.addEventListener('mousedown', e => e.preventDefault())
    const info = el.createDiv('bases-toolbar-menu-item-info')
    const icon = info.createDiv('bases-toolbar-menu-item-info-icon')
    if (item.type === 'action') {
      setIcon(icon, item.icon!)
      info.createDiv({ cls: 'bases-toolbar-menu-item-name', text: item.name })
      return
    }
    const id = item.propId!
    const { type, name } = splitPropertyId(id)
    const cb = el.createEl('input', { type: 'checkbox' }) as HTMLInputElement
    el.prepend(cb)
    if (type === 'note') setIcon(icon, c.app.metadataTypeManager.getTypeInfo(name).expected.icon)
    else if (type === 'formula') {
      setIcon(icon, 'lucide-square-function')
      const f = c.query.formulas?.[name]
      if (f?.isInvalid) {
        icon.addClass('mod-error')
        icon.setAttribute('aria-label', f.parseError ?? '')
      }
    } else setIcon(icon, 'lucide-info')
    el.toggleClass('mod-implicit', type === 'file')
    el.toggleClass('mod-formula', type === 'formula')
    info.createDiv({ cls: 'bases-toolbar-menu-item-name', text: this.cfg.getDisplayName(id) })
    const vis = this.cfg.getOrder().includes(id)
    el.toggleClass('mod-hidden', !vis)
    cb.checked = vis
    const next = el.createDiv('clickable-icon bases-toolbar-menu-item-icon')
    setIcon(next, 'lucide-chevron-right')
    next.addEventListener('click', e => {
      e.preventDefault()
      const sel = this.chooser.values![this.chooser.selectedItem]
      if (sel?.type === 'property') this.showEditPage(id)
    })
    if (vis) {
      dragReorder(icon, el, el.parentElement!, to => {
        const order = this.cfg.getOrder()
        moveItem(order, order.indexOf(id), to)
        this.cfg.setOrder(order)
      })
    }
  }
}

export class PropertyEditPage extends MenuPage {
  private form: HTMLElement
  private handleDelete: (() => void) | null = null
  constructor(host: ToolbarMenu, private c: QueryController, private propId: string, private isNew: boolean) {
    super(host)
    const { name } = splitPropertyId(propId)
    this.setTitle(isNew ? L('labelEditProperty') : L('titleEditProperty', { name }))
    this.scope.register([], 'Escape', () => this.host.back())
    this.handleDelete = () => this.host.back()
    this.addAction('lucide-more-vertical', (e, el) => this.showActions(e, el))
    this.form = this.containerEl.createDiv('bases-toolbar-menu-form')
    this.build()
  }
  private build(): void {
    const { c, propId, isNew } = this
    const q = c.query
    const cfg = c.getViewConfig()!
    const tm = c.app.metadataTypeManager
    const sp = splitPropertyId(propId)
    let name = sp.name
    const { content } = inputRow(this.form, isNew ? undefined : L('labelDisplayName'))
    const input = textControl(content, { placeholder: name, value: cfg.getDisplayName(propId) })
    input.addClass('node-insert-event')
    input.addEventListener('focus', () => input.select())
    input.addEventListener('blur', () => {
      const v = input.value.trim()
      if (v === cfg.getDisplayName(propId)) return
      if (isNew) {
        if (sp.type === 'formula') {
          const fs = q.formulas ?? {}
          const f = fs[name]
          delete fs[name]
          fs[v] = f
          q.setFormulas(fs)
        } else if (sp.type === 'note') void c.app.fileManager.renameProperty?.(name, v)
        const nid = joinPropertyId(sp.type, v)
        cfg.setOrder(cfg.getOrder().map(x => (x === propId ? nid : x)))
        name = v
      } else cfg.getPropertyConfig(propId).setDisplayName(v)
    })
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        input.value = name
        input.blur()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        input.blur()
      }
    })
    if (sp.type === 'note') {
      const inferred = tm.getTypeInfo(name).inferred
      const widgets = Object.entries<any>(tm.registeredTypeWidgets).filter(([, w]) => !w.reservedKeys || w.reservedKeys.includes(inferred.type))
      const opts = Object.fromEntries(widgets.map(([k, w]) => [k, w.name()]))
      const r = inputRow(this.form, L('labelPropertyType'))
      dropdownControl(r.content, opts, inferred.type, v => void tm.setType(name, v)).addClass('node-insert-event')
    } else if (sp.type === 'formula') {
      const fs = q.formulas ?? {}
      const cur = Object.hasOwn(fs, name) ? fs[name] : null
      const r = inputRow(this.form, L('labelFormula'))
      appendHelpIcon(r.labelEl!)
      new FormulaEditor(r.content, cur, { updateFormula: f => { fs[name] = f; q.setFormulas(fs) } })
    }
  }
  showActions(e: MouseEvent, el: HTMLElement): void {
    if (el.hasClass('has-active-menu')) return
    const { c, propId } = this
    const q = c.query
    const { type, name } = splitPropertyId(propId)
    const cfg = c.getViewConfig()!
    const vis = cfg.getOrder().includes(propId)
    const m = Menu.forEvent(e)
    m.addSections(['action', '', 'danger'])
    m.setParentElement(el)
    m.addItem(i =>
      i.setTitle(vis ? L('labelHideProperty') : L('labelShowProperty')).setSection('action').setIcon('lucide-eye-off').onClick(() => {
        const o = cfg.getOrder()
        if (o.includes(propId)) o.splice(o.indexOf(propId), 1)
        else o.push(propId)
        cfg.setOrder(o)
      })
    )
    if (type === 'formula') {
      m.addItem(i =>
        i.setTitle(L('actionDeleteFormula')).setSection('danger').setIcon('lucide-trash-2').setWarning(true).onClick(() => {
          const o = cfg.getOrder()
          const idx = o.indexOf(propId)
          if (idx !== -1) {
            o.splice(idx, 1)
            cfg.setOrder(o)
          }
          cfg.getPropertyConfig(propId).setDisplayName(null as any)
          delete q.formulas![name]
          q.setFormulas(q.formulas!)
          this.handleDelete?.()
        })
      )
    }
  }
}

void Notice
void FILE_PROPERTIES
