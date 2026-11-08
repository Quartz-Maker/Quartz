/* eslint-disable @typescript-eslint/no-explicit-any */
// "all-properties" view (properties core plugin): vault-wide property names with counts.
//   .workspace-leaf-content[data-type=all-properties] > .nav-header + .view-header + .view-content
//   .view-content > div > .tree-item > .tree-item-self.is-clickable.tappable > .tree-item-icon + .tree-item-inner > .tree-item-inner-text
//                                                                            + .tree-item-flair-outer > .tree-item-flair
// Leaf state {sortOrder: frequency|frequencyReverse|alphabetical|alphabeticalReverse, showSearch, searchQuery}.
import { ItemView } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { setIcon, setTooltip } from '../../workspace/dom'
import { Menu } from '../../ui/Menu'
import { ConfirmationModal } from '../../ui/Modal'
import type { TypeWidget } from './widgets'

export const VIEW_TYPE_ALL_PROPERTIES = 'all-properties'
const SORTS: [string, string][] = [
  ['alphabetical', 'Property name (A to Z)'],
  ['alphabeticalReverse', 'Property name (Z to A)'],
  ['frequency', 'Frequency (high to low)'],
  ['frequencyReverse', 'Frequency (low to high)']
]
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const LOCKED = ['aliases', 'cssclasses', 'tags']

/** `.nav-header > .nav-buttons-container > .nav-action-button…` + `.search-input-container`. */
export function createNavHeader(parent: HTMLElement): { navHeaderEl: HTMLElement; buttonsEl: HTMLElement; searchEl: HTMLElement; inputEl: HTMLInputElement } {
  const navHeaderEl = createDiv('nav-header')
  parent.prepend(navHeaderEl)
  const buttonsEl = navHeaderEl.createDiv('nav-buttons-container')
  const searchEl = navHeaderEl.createDiv('search-input-container')
  const inputEl = searchEl.createEl('input', { attr: { type: 'search', enterkeyhint: 'search', spellcheck: 'false', placeholder: 'Search...' } }) as HTMLInputElement
  const clear = searchEl.createDiv('search-input-clear-button')
  clear.setAttribute('aria-label', 'Clear search')
  clear.addEventListener('click', () => {
    inputEl.value = ''
    inputEl.dispatchEvent(new Event('input'))
  })
  searchEl.hide()
  return { navHeaderEl, buttonsEl, searchEl, inputEl }
}

export function navButton(parent: HTMLElement, icon: string, label: string, cb: (evt: MouseEvent) => any): HTMLElement {
  const b = parent.createDiv('clickable-icon nav-action-button')
  setIcon(b, icon)
  setTooltip(b, label)
  b.setAttribute('aria-label', label)
  b.addEventListener('click', cb)
  return b
}

export class AllPropertiesView extends ItemView {
  icon = 'lucide-archive'
  sortOrder = 'frequency'
  showSearch = false
  searchQuery = ''
  listEl: HTMLElement
  emptyStateEl: HTMLElement
  nav: ReturnType<typeof createNavHeader>
  private renaming: string | null = null
  private updateTimer: any = 0

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.nav = createNavHeader(this.containerEl)
    navButton(this.nav.buttonsEl, 'lucide-sort-asc', 'Change sort order', evt => {
      const m = new Menu()
      for (const [id, label] of SORTS)
        m.addItem(i =>
          i
            .setTitle(label)
            .setChecked(this.sortOrder === id)
            .onClick(() => {
              this.sortOrder = id
              this.render()
              this.app.workspace.requestSaveLayout()
            })
        )
      m.showAtMouseEvent(evt)
    })
    navButton(this.nav.buttonsEl, 'lucide-search', 'Show search filter', () => this.setShowSearch(!this.showSearch, true))
    this.nav.inputEl.addEventListener('input', () => {
      this.searchQuery = this.nav.inputEl.value
      this.render()
      this.app.workspace.requestSaveLayout()
    })
    this.nav.inputEl.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (this.nav.inputEl.value) {
        this.nav.inputEl.value = ''
        this.nav.inputEl.dispatchEvent(new Event('input'))
      } else this.setShowSearch(false, false)
    })
    this.contentEl.addClass('node-insert-event')
    this.contentEl.style.position = 'relative'
    this.listEl = this.contentEl.createDiv()
    this.emptyStateEl = this.contentEl.createDiv({ cls: 'pane-empty properties-pane-empty', text: 'No properties found.' })
    this.emptyStateEl.hide()
  }

  getViewType(): string {
    return VIEW_TYPE_ALL_PROPERTIES
  }
  getDisplayText(): string {
    return 'All properties'
  }

  private setShowSearch(on: boolean, focus: boolean): void {
    this.showSearch = on
    this.nav.searchEl.toggle(on)
    if (on && focus) this.nav.inputEl.focus()
    this.app.workspace.requestSaveLayout()
  }

  getState(): Record<string, unknown> {
    return { sortOrder: this.sortOrder, showSearch: this.showSearch, searchQuery: this.searchQuery }
  }
  async setState(state: any, result: any): Promise<void> {
    if (state?.sortOrder) this.sortOrder = state.sortOrder
    if (typeof state?.showSearch === 'boolean') this.showSearch = state.showSearch
    if (typeof state?.searchQuery === 'string') this.searchQuery = this.nav.inputEl.value = state.searchQuery
    this.nav.searchEl.toggle(this.showSearch)
    this.render()
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const app: any = this.app
    const later = () => {
      clearTimeout(this.updateTimer)
      this.updateTimer = setTimeout(() => this.render(), 100)
    }
    this.registerEvent(app.metadataCache.on('resolved', later))
    this.registerEvent(app.metadataCache.on('changed', later))
    this.registerEvent(app.metadataTypeManager.on('changed', later))
    this.render()
  }

  render(): void {
    const app: any = this.app
    const tm = app.metadataTypeManager
    const props: Record<string, { name: string; widget: string }> = tm.getAllProperties()
    const occ: Record<string, number> = tm.getPropertyOccurrences()
    let items = Object.entries(props).map(([k, v]) => ({ key: k, name: v.name, widget: v.widget, count: occ[k] ?? 0 }))
    const q = this.searchQuery.toLowerCase()
    if (q) items = items.filter(i => i.name.toLowerCase().includes(q))
    const byName = (a: any, b: any) => collator.compare(a.name, b.name)
    items.sort((a, b) => {
      switch (this.sortOrder) {
        case 'frequencyReverse':
          return a.count - b.count || byName(a, b)
        case 'alphabetical':
          return byName(a, b)
        case 'alphabeticalReverse':
          return byName(b, a)
        default:
          return b.count - a.count || byName(a, b)
      }
    })
    const el = this.listEl
    el.empty()
    this.emptyStateEl.toggle(items.length === 0)
    if (!items.length) return
    el.createDiv({ attr: { style: 'width: 1px; height: 0.1px; margin-bottom: 0px;' } })
    for (const it of items) {
      const item = el.createDiv('tree-item')
      const self = item.createDiv({ cls: 'tree-item-self is-clickable tappable', attr: { style: 'margin-inline-start: 0px !important; padding-inline-start: 24px !important;' } })
      setIcon(self.createDiv('tree-item-icon'), tm.getWidget(it.widget).icon)
      const text = self.createDiv('tree-item-inner').createDiv({ cls: 'tree-item-inner-text', text: it.name })
      self.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(it.count) })
      self.addEventListener('click', () => {
        if (this.renaming) return
        app.internalPlugins?.getEnabledPluginById('global-search')?.openGlobalSearch?.(`[${it.name}]`)
      })
      self.addEventListener('contextmenu', evt => {
        evt.preventDefault()
        const m = new Menu()
        const canEdit = !LOCKED.includes(it.key)
        m.addSections(['action', 'action.changeType', '', 'danger'])
        m.setSectionSubmenu('action.changeType', { title: 'Property type', icon: 'lucide-info' })
        m.addItem(i => i.setSection('action').setTitle('Rename').setIcon('lucide-edit-3').onClick(() => this.startRename(it.name, text)))
        const assigned = tm.getAssignedWidget(it.name)
        if (canEdit)
          m.addItem(i =>
            i
              .setSection('action.changeType')
              .setTitle(assigned ? 'Automatic' : `Automatic (${tm.getWidget(it.widget).name()})`)
              .setIcon('lucide-loader')
              .setChecked(!assigned)
              .onClick(() => void tm.unsetType(it.name))
          )
        for (const w of Object.values<TypeWidget>(tm.registeredTypeWidgets)) {
          if (w.reservedKeys && !w.reservedKeys.includes(it.name)) continue
          m.addItem(i =>
            i
              .setSection('action.changeType')
              .setTitle(w.name())
              .setIcon(w.icon)
              .setDisabled(!canEdit)
              .setChecked(w.type === assigned)
              .onClick(() => void tm.setType(it.name, w.type))
          )
        }
        m.addItem(i => i.setSection('danger').setTitle('Delete property').setIcon('lucide-trash-2').setWarning(true).onClick(() => this.confirmDelete(it.name)))
        m.showAtMouseEvent(evt)
      })
    }
  }

  /** Run `fn` over the frontmatter of every note that has property `key` (case-insensitive). */
  private async eachFileWith(key: string, fn: (fm: Record<string, any>) => void): Promise<void> {
    const app: any = this.app
    const lk = key.toLowerCase()
    for (const f of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter
      if (!fm || !Object.keys(fm).some(k => k.toLowerCase() === lk)) continue
      await app.fileManager.processFrontMatter(f, fn)
    }
  }

  private startRename(oldName: string, textEl: HTMLElement): void {
    this.renaming = oldName
    textEl.contentEditable = 'true'
    textEl.focus()
    const sel = window.getSelection()
    const r = document.createRange()
    r.selectNodeContents(textEl)
    sel?.removeAllRanges()
    sel?.addRange(r)
    let done = false
    const finish = (commit: boolean) => {
      if (done) return
      done = true
      textEl.contentEditable = 'false'
      const next = (textEl.textContent ?? '').trim()
      this.renaming = null
      if (!commit || !next || next === oldName) return this.render()
      void this.acceptRename(oldName, next)
    }
    textEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') (e.preventDefault(), e.stopPropagation(), finish(true))
      else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), (textEl.textContent = oldName), finish(false))
    })
    textEl.addEventListener('blur', () => finish(true))
  }

  private async acceptRename(oldName: string, newName: string): Promise<void> {
    const tm = (this.app as any).metadataTypeManager
    const lo = oldName.toLowerCase()
    const ln = newName.toLowerCase()
    const exists = lo !== ln && Object.keys(tm.getAllProperties()).includes(ln)
    const apply = async () => {
      await this.eachFileWith(oldName, fm => {
        const keys = Object.keys(fm)
        const oldKey = keys.find(k => k.toLowerCase() === lo)!
        const dupKey = lo !== ln ? keys.find(k => k.toLowerCase() === ln) : undefined
        const out: Record<string, any> = {}
        for (const k of keys) {
          if (k === oldKey) {
            if (dupKey) continue
            out[newName] = fm[k]
          } else if (k === dupKey) {
            const a = fm[oldKey]
            const b = fm[k]
            out[k] = Array.isArray(a) && Array.isArray(b) ? Array.from(new Set([...b, ...a])) : a
          } else out[k] = fm[k]
        }
        for (const k of keys) delete fm[k]
        Object.assign(fm, out)
      })
      const assigned = tm.getAssignedWidget(oldName)
      if (assigned) {
        await tm.unsetType(oldName)
        if (!exists) await tm.setType(newName, assigned)
      }
    }
    if (!exists) return apply()
    const m = new ConfirmationModal(this.app as any)
    m.setTitle(`Merge property “${oldName}” with “${newName}”?`)
    m.contentEl.createEl('p', { text: `In case of conflicts, the values will be merged or the value from “${oldName}” will be used.` })
    m.addButton(b => b.setButtonText('Merge').setInitialFocus().onClick(() => void apply()))
    m.addCancelButton()
    m.open()
  }

  private confirmDelete(name: string): void {
    const m = new ConfirmationModal(this.app as any)
    m.setTitle('Delete property')
    m.contentEl.createEl('p', { text: `Delete property “${name}” from all notes?` })
    m.addButton(b =>
      b
        .setButtonText('Delete')
        .setInitialFocus()
        .onClick(async () => {
          const lk = name.toLowerCase()
          await this.eachFileWith(name, fm => {
            for (const k of Object.keys(fm)) if (k.toLowerCase() === lk) delete fm[k]
          })
        })
    )
    m.addCancelButton()
    m.open()
  }
}
