/* eslint-disable @typescript-eslint/no-explicit-any */
// Combobox button (`div.combobox-button`) that opens a searchable suggestion popup, plus the property
// picker built on it (note / file / formula properties with their type icons).
import { Scope } from '../../keymap/Keymap'
import { setIcon } from '../../ui/icons'
import { positionNear, onElementGone } from '../../ui/dom'
import { SearchComponent } from '../../ui/setting'
import { SuggestionChooser } from '../../ui/suggest'
import { prepareFuzzySearch, renderMatches } from '../../search/fuzzy'
import { splitPropertyId } from './BaseConfig'
import { L } from './popover'
import { bt } from './strings'

export interface ComboItem {
  value: string
  display?: string
  icon?: string
  [k: string]: any
}

const openCounts = new WeakMap<HTMLElement, number>()
const FILE_ICONS: Record<string, string> = {
  file: 'lucide-file', ctime: 'lucide-clock', mtime: 'lucide-clock', size: 'lucide-binary',
  links: 'lucide-list', backlinks: 'lucide-list', embeds: 'lucide-list', tags: 'lucide-tags'
}

export class Combobox {
  buttonEl: HTMLElement
  iconEl: HTMLElement
  labelEl: HTMLElement
  suggestEl: HTMLElement
  bgEl: HTMLElement
  searchComponent: SearchComponent
  suggestions: SuggestionChooser<any>
  selected: ComboItem | null = null
  isOpen = false
  disabled = false
  clearable = false
  protected _items: ComboItem[] = []
  private selectHandler: ((item: ComboItem | null) => void) | null = null
  private scope: Scope
  private stopWatch: (() => void) | null = null

  constructor(protected app: any, public containerEl: HTMLElement) {
    this.scope = new Scope(app.scope)
    this.scope.register([], 'Escape', e => {
      e.preventDefault()
      this.close()
      this.buttonEl.focus({ preventScroll: true })
      return false
    })
    this.bgEl = createDiv('suggestion-bg')
    this.bgEl.style.opacity = '0'
    this.suggestEl = createDiv('suggestion-container combobox')
    const b = (this.buttonEl = containerEl.createDiv({ cls: 'combobox-button', attr: { tabindex: '0' } }))
    this.iconEl = b.createDiv('combobox-button-icon')
    this.iconEl.hide()
    this.labelEl = b.createDiv('combobox-button-label')
    const clear = b.createDiv('combobox-clear-button')
    setIcon(clear, 'lucide-x')
    clear.addEventListener('mousedown', e => e.preventDefault())
    clear.addEventListener('click', e => {
      e.preventDefault()
      this.buttonEl.blur()
      this.selectSuggestion(null)
    })
    setIcon(b.createDiv('combobox-button-chevron'), 'lucide-chevrons-up-down')
    b.addEventListener('keydown', e => {
      if (this.disabled || e.isComposing) return
      if (e.key.startsWith('Arrow') || e.key.length === 1) this.open()
    })
    b.addEventListener('click', e => {
      if (this.disabled || e.defaultPrevented) return
      e.preventDefault()
      this.toggle()
    })
    this.searchComponent = new SearchComponent(this.suggestEl).setPlaceholder(bt('plugins.search.promptStartSearch')).onChange(v => this.renderList(v))
    const inner = this.suggestEl.createDiv('suggestion')
    this.suggestions = new SuggestionChooser<any>(
      {
        renderSuggestion: (v, el) => this.renderSuggestion(v, el),
        selectSuggestion: v => this.selectSuggestion(v)
      },
      inner,
      this.scope
    )
    this.suggestEl.on('mousedown', '.suggestion', e => e.preventDefault())
    const inp = this.searchComponent.inputEl
    inp.addEventListener('focus', () => this.suggestEl.addClass('has-input-focus'))
    inp.addEventListener('blur', () => this.suggestEl.removeClass('has-input-focus'))
    this.suggestEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.isOpen && b.ownerDocument.activeElement !== b && !this.suggestEl.contains(b.ownerDocument.activeElement)) this.close()
      }, 0)
    })
  }

  setPlaceholder(p: string): this {
    this.labelEl.setAttribute('placeholder', p)
    return this
  }
  setItems(items: ComboItem[]): this {
    this._items = items
    return this
  }
  getItems(): ComboItem[] {
    return this._items
  }
  setClearable(c: boolean): this {
    this.clearable = c
    this.buttonEl.toggleClass('mod-clearable', c && this.selected != null)
    return this
  }
  setDisabled(d: boolean): this {
    this.disabled = d
    this.buttonEl.toggleClass('mod-disabled', d)
    return this
  }
  onSelect(fn: (item: ComboItem | null) => void): this {
    this.selectHandler = fn
    return this
  }
  setValue(item: ComboItem | null): this {
    this.selected = item
    this.labelEl.empty()
    if (item) this.labelEl.setText(item.display ?? item.value)
    const icon = item?.icon
    this.iconEl.empty()
    if (icon) setIcon(this.iconEl, icon)
    this.iconEl.toggle(!!icon)
    this.buttonEl.toggleClass('mod-clearable', this.clearable && item != null)
    return this
  }
  setValueById(id: string | null): this {
    const it = this.getItems().find(i => i.value === id)
    if (it) this.setValue(it)
    return this
  }
  /** Focusing a combobox (after a sibling choice, or "add row") opens its list right away. */
  focus(): void {
    this.buttonEl.focus()
    this.open()
  }
  /** Items matching the search text (matched against the value, then the display text), best first. */
  protected getSuggestions(query: string): ComboItem[] {
    const items = this.getItems()
    const q = query.trim()
    if (!q) return items
    const search = prepareFuzzySearch(q)
    const out: ComboItem[] = []
    for (const item of items) {
      let m = search(item.value)
      let score = m?.score ?? 0
      if (!m && item.display) {
        m = search(item.display)
        score = (m?.score ?? 0) - 10
      }
      if (m) out.push({ ...item, matches: m.matches, score })
    }
    out.sort((a, b) => b.score - a.score)
    return out
  }
  protected renderList(q: string): void {
    this.suggestions.setSuggestions(this.getSuggestions(q))
  }
  renderSuggestion(item: ComboItem, el: HTMLElement): void {
    el.addClasses(['mod-complex', 'mod-toggle'])
    if (this.selected?.value === item.value) setIcon(el.createDiv('suggestion-icon mod-checked'), 'lucide-check')
    if (item.icon) setIcon(el.createDiv('suggestion-icon').createDiv('suggestion-flair'), item.icon)
    const title = el.createSpan('suggestion-content').createDiv('suggestion-title')
    renderMatches(title, item.display ?? item.value, item.matches ?? null)
  }
  selectSuggestion(item: ComboItem | null): void {
    this.setValue(item)
    this.buttonEl.focus({ preventScroll: true })
    this.selectHandler?.(item)
    this.close()
  }
  toggle(): void {
    if (this.isOpen) {
      this.buttonEl.focus({ preventScroll: true })
      this.close()
    } else this.open()
  }
  open(): void {
    if (this.isOpen) return
    this.isOpen = true
    const doc = this.buttonEl.ownerDocument
    doc.body.appendChild(this.bgEl)
    doc.body.appendChild(this.suggestEl)
    this.app.keymap.pushScope(this.scope)
    this.buttonEl.addClass('has-focus')
    this.setContainerFocused(true)
    this.suggestions.setSuggestions(this.getSuggestions(''))
    positionNear(this.buttonEl.getBoundingClientRect(), this.suggestEl, { gap: 4, preventOverlap: true })
    this.searchComponent.autoSelect()
    this.stopWatch?.()
    this.stopWatch = onElementGone(this.buttonEl, 500, () => this.close())
    this.bgEl.addEventListener('click', () => this.close(), { once: true })
  }
  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    this.stopWatch?.()
    this.stopWatch = null
    this.app.keymap.popScope(this.scope)
    this.suggestEl.detach()
    this.bgEl.detach()
    this.buttonEl.removeClass('has-focus')
    this.setContainerFocused(false)
    this.searchComponent.inputEl.value = ''
  }
  /** Parent gets `has-focus` while any combobox inside it has its list open. */
  private setContainerFocused(on: boolean): void {
    const n = (openCounts.get(this.containerEl) ?? 0) + (on ? 1 : -1)
    openCounts.set(this.containerEl, n)
    this.containerEl.toggleClass('has-focus', n > 0)
  }
}

/** Value-type icon of a property id (file props from the evaluation context, notes from the type manager). */
export function propertyIcon(c: any, id: string): string {
  const { type, name } = splitPropertyId(id)
  if (type === 'note') return c.app.metadataTypeManager.getTypeInfo(name).expected.icon
  if (type === 'formula') return 'lucide-square-function'
  return FILE_ICONS[name] ?? 'lucide-text'
}

export class PropertyCombobox extends Combobox {
  private filterExpr: ((id: string) => boolean) | null = null
  constructor(private qc: any, el: HTMLElement) {
    super(qc.app, el)
  }
  filterProperties(f: (id: string) => boolean): this {
    this.filterExpr = f
    return this
  }
  override getItems(): ComboItem[] {
    const c = this.qc
    const cfg = c.getViewConfig()
    const tm = c.app.metadataTypeManager
    const notes = Object.values<any>(tm.getAllProperties()).map(p => 'note.' + p.name)
    let ids: string[] = c.getProperties().filter((p: string) => splitPropertyId(p).type !== 'note').concat(notes)
    if (this.filterExpr) ids = ids.filter(this.filterExpr)
    const seen = new Set<string>()
    return ids
      .filter(i => (seen.has(i) ? false : (seen.add(i), true)))
      .map(id => ({ value: id, display: cfg.getDisplayName(id), icon: propertyIcon(c, id) }))
  }
  override setValueById(id: string | null): this {
    const it = this.getItems().find(i => i.value === id)
    if (it) this.setValue(it)
    else if (id) this.setValue({ value: id, icon: 'lucide-file-question', display: this.qc.getViewConfig().getDisplayName(id) })
    else this.setValue(null)
    return this
  }
  override renderSuggestion(item: ComboItem, el: HTMLElement): void {
    el.addClasses(['mod-complex', 'mod-toggle'])
    if (this.selected?.value === item.value) setIcon(el.createDiv('suggestion-icon mod-checked'), 'lucide-check')
    setIcon(el.createDiv('suggestion-icon').createSpan('suggestion-flair'), item.icon || 'lucide-text')
    const { type, name } = splitPropertyId(item.value)
    const content = el.createDiv('suggestion-content')
    const aux = el.createDiv('suggestion-aux')
    content.createDiv({ cls: 'suggestion-title', text: item.display })
    if ((type === 'file' && name !== 'file') || name !== item.display) aux.createSpan({ cls: 'suggestion-flair u-small', text: item.value })
  }
}

void L
