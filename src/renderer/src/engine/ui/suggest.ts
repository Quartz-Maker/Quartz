// Suggestion UIs (plugin API, obsidian.d.ts: `SuggestModal`, `FuzzySuggestModal`, `PopoverSuggest`,
// `AbstractInputSuggest`).
//
// A shared chooser renders `.suggestion-item` rows (first one `.is-selected`) and handles keys in
// the owner's scope: ↑/↓ and Ctrl+P/Ctrl+N wrap, PageUp/PageDown, Home/End, Enter uses the selected
// item; hovering a row selects it, clicking uses it.
// SuggestModal DOM: `.modal-container > .modal-bg + .prompt > .prompt-input-container.mod-raised >
// input.prompt-input + .prompt-input-cta + .search-input-clear-button` + `.prompt-results`
// [+ `.prompt-instructions`]. PopoverSuggest DOM: `body > .suggestion-container > .suggestion`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Scope } from '../keymap/Keymap'
import { Platform } from '../keymap/Platform'
import { Modal, type AppWithKeymap } from './Modal'
import { animate, CssAnimation, onElementGone, positionNear, type Rect } from './dom'
import { prepareQuery, fuzzySearch, sortSearchResults, renderResults, type SearchResult } from '../search/fuzzy'

export interface Instruction {
  command: string
  purpose: string
}

export interface ISuggestOwner<T> {
  renderSuggestion(value: T, el: HTMLElement): void
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void
  /** @internal */
  onSelectedChange?(value: T, evt: MouseEvent | KeyboardEvent | null): void
}

export interface FuzzyMatch<T> {
  item: T
  match: SearchResult
}

/** @internal The list/selection controller behind every suggestion UI. */
export class SuggestionChooser<T> {
  selectOnHover = true
  values: T[] | null = []
  suggestions: HTMLElement[] = []
  selectedItem = 0

  constructor(public chooser: ISuggestOwner<T>, public containerEl: HTMLElement, scope: Scope) {
    const c = containerEl as any
    c.on('click', '.suggestion-item', this.onSuggestionClick.bind(this))
    c.on('auxclick', '.suggestion-item', this.onSuggestionClick.bind(this))
    c.on('mousemove', '.suggestion-item', this.onSuggestionMouseover.bind(this))
    this.moveUp = this.moveUp.bind(this)
    this.moveDown = this.moveDown.bind(this)
    scope.register([], 'ArrowUp', this.moveUp)
    scope.register([], 'ArrowDown', this.moveDown)
    scope.register([], 'PageUp', this.pageUp.bind(this))
    scope.register([], 'PageDown', this.pageDown.bind(this))
    scope.register([], 'Home', e => {
      this.setSelectedItem(0, e)
      return false
    })
    scope.register([], 'End', e => {
      this.setSelectedItem(this.suggestions.length - 1, e)
      return false
    })
    scope.register(['Ctrl'], 'P', this.moveUp)
    scope.register(['Ctrl'], 'N', this.moveDown)
    scope.register([], 'Enter', e => {
      if (e.isComposing) return
      this.useSelectedItem(e)
      return false
    })
  }

  getSelectedElement(): HTMLElement | null {
    return this.suggestions[this.selectedItem] ?? null
  }

  getSelectedValue(): T | null {
    return this.values?.[this.selectedItem] ?? null
  }

  moveUp(e: KeyboardEvent): false | void {
    if (e.isComposing) return
    this.setSelectedItem(this.selectedItem - 1, e)
    return false
  }

  moveDown(e: KeyboardEvent): false | void {
    if (e.isComposing) return
    this.setSelectedItem(this.selectedItem + 1, e)
    return false
  }

  get rowHeight(): number {
    return this.suggestions[this.selectedItem].clientHeight
  }

  get numVisibleItems(): number {
    return Math.floor(this.containerEl.clientHeight / this.rowHeight)
  }

  pageUp(e: KeyboardEvent): false | void {
    if (e.isComposing) return
    const el = this.containerEl
    const visible = this.numVisibleItems
    const row = this.rowHeight
    const top = el.scrollTop - parseFloat(getComputedStyle(el).paddingTop)
    let first = Math.floor(top / row)
    if (this.selectedItem <= first) first -= visible
    this.setSelectedItem(Math.max(0, first), e)
    return false
  }

  pageDown(e: KeyboardEvent): false | void {
    if (e.isComposing) return
    const el = this.containerEl
    const visible = this.numVisibleItems
    const row = this.rowHeight
    const top = el.scrollTop - parseFloat(getComputedStyle(el).paddingTop)
    let last = Math.floor(top / row) + (visible - 1)
    if (this.selectedItem >= last) last += visible
    this.setSelectedItem(Math.min(this.suggestions.length - 1, last), e)
    return false
  }

  renderSuggestions(): void {
    const el = this.containerEl
    el.empty()
    const rows: HTMLElement[] = []
    if (this.values) {
      for (const v of this.values) {
        const row = el.createDiv('suggestion-item')
        this.chooser.renderSuggestion(v, row)
        rows.push(row)
      }
    }
    rows[this.selectedItem]?.addClass('is-selected')
    this.suggestions = rows
  }

  setSuggestions(values: T[] | null): void {
    this.values = values
    this.renderSuggestions()
    this.setSelectedItem(0, null)
  }

  addSuggestion(value: T): void {
    if (!this.values) return
    const row = this.containerEl.createDiv('suggestion-item')
    this.chooser.renderSuggestion(value, row)
    this.values.push(value)
    this.suggestions.push(row)
  }

  addMessage(text: string): HTMLElement {
    return this.containerEl.createDiv({ cls: 'suggestion-empty', text })
  }

  shouldSelectOnHover(v: boolean): this {
    this.selectOnHover = v
    return this
  }

  setSelectedItem(index: number, evt: MouseEvent | KeyboardEvent | null): void {
    const n = this.suggestions.length
    if (n === 0) return
    if (index < 0) index = n - 1
    else if (index >= n) index = 0
    this.forceSetSelectedItem(index, evt)
  }

  forceSetSelectedItem(index: number, evt: MouseEvent | KeyboardEvent | null): void {
    const rows = this.suggestions
    rows[this.selectedItem]?.removeClass('is-selected')
    this.selectedItem = index
    const row = rows[index]
    if (row) {
      row.addClass('is-selected')
      if (!evt || evt instanceof KeyboardEvent) row.scrollIntoView?.({ block: 'nearest' })
    }
    this.chooser.onSelectedChange?.(this.values![index], evt)
  }

  onSuggestionClick(e: MouseEvent, el: HTMLElement): void {
    if (e.defaultPrevented) return
    e.preventDefault()
    this.setSelectedItem(this.suggestions.indexOf(el), e)
    this.useSelectedItem(e)
  }

  onSuggestionMouseover(e: MouseEvent, el: HTMLElement): void {
    if (this.selectOnHover) this.setSelectedItem(this.suggestions.indexOf(el), e)
  }

  useSelectedItem(evt: MouseEvent | KeyboardEvent): boolean {
    if (!this.values) return false
    const v = this.values[this.selectedItem]
    if (v === undefined) return false
    this.chooser.selectSuggestion(v, evt)
    return true
  }
}

function renderInstructions(el: HTMLElement, instructions: Instruction[]): HTMLElement {
  el.empty()
  for (const ins of instructions) {
    el.createDiv('prompt-instruction', row => {
      row.createSpan({ cls: 'prompt-instruction-command', text: ins.command })
      row.createSpan({ text: ins.purpose })
    })
  }
  return el
}

export abstract class SuggestModal<T> extends Modal implements ISuggestOwner<T> {
  limit = 100
  emptyStateText = 'No results found.'
  inputEl!: HTMLInputElement
  resultContainerEl!: HTMLElement
  /** @internal */ ctaEl!: HTMLElement
  /** @internal */ clearButtonEl!: HTMLElement
  /** @internal */ instructionsEl: HTMLElement
  /** @internal */ chooser: SuggestionChooser<T>

  constructor(app: AppWithKeymap) {
    super(app)
    this.instructionsEl = createDiv('prompt-instructions')
    const m = this.modalEl
    m.removeClass('modal')
    m.addClass('prompt')
    m.empty()
    m.createDiv('prompt-input-container mod-raised', box => {
      const input = (this.inputEl = box.createEl('input', {
        cls: 'prompt-input',
        type: 'text',
        attr: { autocapitalize: 'off', spellcheck: 'false', enterkeyhint: Platform.isAndroidApp ? 'enter' : 'done' }
      }))
      this.ctaEl = box.createDiv('prompt-input-cta')
      this.clearButtonEl = box.createDiv('search-input-clear-button', btn => {
        btn.addEventListener('mousedown', e => {
          if (input.value !== '') e.preventDefault()
        })
        btn.addEventListener('click', () => {
          if (input.value !== '') {
            input.value = ''
            ;(input as any).trigger('input')
          } else this.close()
        })
      })
    })
    this.resultContainerEl = m.createDiv('prompt-results')
    this.chooser = new SuggestionChooser<T>(this, this.resultContainerEl, this.scope)
    this.inputEl.addEventListener('input', this.onInput.bind(this))
  }

  setPlaceholder(placeholder: string): void {
    this.inputEl.placeholder = placeholder
  }

  setInstructions(instructions: Instruction[]): void {
    if (instructions.length > 0) {
      renderInstructions(this.instructionsEl, instructions)
      this.modalEl.appendChild(this.instructionsEl)
    } else this.instructionsEl.detach()
  }

  onOpen(): void {
    const input = this.inputEl
    input.value = ''
    input.focus()
    this.updateSuggestions()
  }

  /** @internal */
  onInput(): void {
    this.updateSuggestions()
  }

  /** @internal */
  updateSuggestions(): void {
    const res = this.getSuggestions(this.inputEl.value)
    const apply = (list: T[]): void => {
      if (!list || list.length === 0) {
        this.onNoSuggestion()
        return
      }
      const n = this.limit
      if (n && n > 0) list = list.slice(0, n)
      this.chooser.setSuggestions(list)
    }
    if (Array.isArray(res)) apply(res)
    else void Promise.resolve(res).then(apply)
  }

  onNoSuggestion(): void {
    this.chooser.setSuggestions(null)
    this.chooser.addMessage(this.emptyStateText)
  }

  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.app.keymap.updateModifiers?.(evt)
    this.close()
    this.onChooseSuggestion(value, evt)
  }

  /** @internal */
  selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void {
    this.chooser.useSelectedItem(evt)
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>
  abstract renderSuggestion(value: T, el: HTMLElement): void
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
  /** @internal */
  sortSuggestions(results: FuzzyMatch<T>[]): void {
    sortSearchResults(results)
  }

  getSuggestions(query: string): FuzzyMatch<T>[] {
    query = query.trim()
    const q = prepareQuery(query)
    const out: FuzzyMatch<T>[] = []
    for (const item of this.getItems()) {
      const match = fuzzySearch(q, this.getItemText(item))
      if (match) out.push({ match, item })
    }
    this.sortSuggestions(out)
    return out
  }

  renderSuggestion(item: FuzzyMatch<T>, el: HTMLElement): void {
    renderResults(el, this.getItemText(item.item), item.match)
  }

  onChooseSuggestion(item: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent): void {
    this.onChooseItem(item.item, evt)
  }

  abstract getItems(): T[]
  abstract getItemText(item: T): string
  abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void
}

export abstract class PopoverSuggest<T> implements ISuggestOwner<T> {
  app: AppWithKeymap
  scope: Scope
  /** @internal */ isOpen = false
  /** @internal */ win: Window | null = null
  /** @internal */ suggestEl: HTMLElement
  /** @internal */ suggestInnerEl: HTMLElement
  /** @internal */ suggestions: SuggestionChooser<T>
  /** @internal */ autoDestroy: (() => void) | null = null

  constructor(app: AppWithKeymap, scope?: Scope) {
    this.app = app
    this.scope = new Scope(scope || (app as any).scope)
    this.suggestEl = createDiv('suggestion-container')
    this.suggestInnerEl = this.suggestEl.createDiv('suggestion')
    this.suggestions = new SuggestionChooser<T>(this, this.suggestInnerEl, this.scope)
    this.scope.register([], 'Escape', e => {
      this.onEscapeKey(e)
      return false
    })
  }

  /** @internal */
  onEscapeKey(_e: KeyboardEvent): void {
    this.close()
  }

  /** @internal HistoryHandler */
  onHistoryBack(): void {
    this.close()
  }

  /** @internal */
  attachDom(): void {
    const el = this.suggestEl
    this.win!.document.body.appendChild(el)
    animate(el, new CssAnimation({ fn: 'var(--anim-motion-swing)', duration: 80 }).addProp('opacity', '0', '1', ''))
  }

  /** @internal */
  detachDom(): void {
    this.suggestEl.detach()
  }

  open(): void {
    if (this.isOpen) return
    this.isOpen = true
    this.win = ((window as any).activeWindow as Window) || window
    this.app.keymap.pushScope(this.scope)
    this.attachDom()
  }

  close(): void {
    if (this.autoDestroy) {
      this.autoDestroy()
      this.autoDestroy = null
    }
    this.app.keymap.popScope(this.scope)
    if (!this.isOpen) return
    this.isOpen = false
    this.suggestions.setSuggestions([])
    this.detachDom()
    this.win = null
  }

  /** @internal Places the popover under/over `rect`. */
  reposition(rect: Rect, align: 'auto' | 'ltr' | 'rtl' = 'auto'): void {
    const el = this.suggestEl
    const map = { rtl: 'right', ltr: 'left', auto: getComputedStyle(el).direction === 'rtl' ? 'right' : 'left' } as const
    positionNear(rect, el, { gap: 5, preventOverlap: true, horizontalAlignment: map[align] })
  }

  /** @internal Close once `el` disappears. */
  setAutoDestroy(el: HTMLElement | null): void {
    this.autoDestroy?.()
    if (el) this.autoDestroy = onElementGone(el, 500, () => this.close())
  }

  abstract renderSuggestion(value: T, el: HTMLElement): void
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void
}

export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
  limit = 100
  /** @internal */ textInputEl: HTMLInputElement | HTMLDivElement
  /** @internal */ lastRect: Rect | null = null
  private selectCb: ((value: T, evt: MouseEvent | KeyboardEvent) => any) | null = null
  private generation = 0

  constructor(app: AppWithKeymap, textInputEl: HTMLInputElement | HTMLDivElement) {
    super(app)
    this.textInputEl = textInputEl
    this.autoReposition = this.autoReposition.bind(this)
    textInputEl.addEventListener('input', this.onInputChange.bind(this))
    textInputEl.addEventListener('focus', this.onInputFocus.bind(this))
    textInputEl.addEventListener('blur', this.close.bind(this))
    ;(this.suggestEl as any).on('mousedown', '.suggestion-item', (e: MouseEvent) => e.preventDefault())
  }

  /** @internal */
  showSuggestions(list: T[]): void {
    const input = this.textInputEl
    if (list.length === 0) {
      this.close()
      return
    }
    if (!input.isShown()) return
    const n = this.limit
    if (n > 0 && list.length > n) list = list.slice(0, n)
    this.suggestions.setSuggestions(list)
    this.open()
    this.setAutoDestroy(input)
  }

  setValue(value: string): void {
    if (this.textInputEl instanceof HTMLInputElement) this.textInputEl.value = value
    else this.textInputEl.innerText = value
  }

  getValue(): string {
    return this.textInputEl instanceof HTMLInputElement ? this.textInputEl.value : this.textInputEl.innerText
  }

  /** @internal */
  onInputFocus(): void {
    this.onInputChange()
  }

  /** @internal */
  onInputChange(): void {
    if (!(this.textInputEl as any).isActiveElement()) return
    const gen = ++this.generation
    const res = this.getSuggestions(this.getValue())
    if (Array.isArray(res)) this.showSuggestions(res)
    else if (res) void res.then(list => {
      if (gen === this.generation) this.showSuggestions(list)
    })
  }

  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.selectCb?.call(this, value, evt)
  }

  onSelect(callback: (value: T, evt: MouseEvent | KeyboardEvent) => any): this {
    this.selectCb = callback
    return this
  }

  close(): void {
    super.close()
    this.textInputEl.ownerDocument.removeEventListener('scroll', this.autoReposition, { capture: true } as any)
  }

  reposition(rect: Rect, align?: 'auto' | 'ltr' | 'rtl'): void {
    super.reposition(rect, align)
    this.lastRect = rect
  }

  open(): void {
    super.open()
    const input = this.textInputEl
    this.reposition(rectOf(input))
    input.ownerDocument.addEventListener('scroll', this.autoReposition, { capture: true, passive: true })
  }

  /** @internal */
  autoReposition(): void {
    const prev = this.lastRect
    const r = rectOf(this.textInputEl)
    if (!prev || r.bottom !== prev.bottom || r.top !== prev.top || r.left !== prev.left || r.right !== prev.right) this.reposition(r)
  }

  protected abstract getSuggestions(query: string): T[] | Promise<T[]>
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
}
