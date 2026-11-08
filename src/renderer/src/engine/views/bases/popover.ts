/* eslint-disable @typescript-eslint/no-explicit-any */
// Building blocks for the Bases toolbar popovers: toolbar item + page-stack popover, text/icon button,
// grouped suggestion chooser, combobox button and the small form controls used by the pages.
import { Scope } from '../../keymap/Keymap'
import { setIcon } from '../../ui/icons'
import { positionNear, onElementGone } from '../../ui/dom'
import { SearchComponent } from '../../ui/setting'
import { SuggestionChooser } from '../../ui/suggest'
import { bt } from './strings'

export const L = (k: string, v?: Record<string, string | number>): string => bt('plugins.bases.' + k, v)

// ---------------------------------------------------------------------------------------------- buttons
/** `div.text-icon-button` (icon + label), used by the toolbar items and the "add" rows. */
export class TextButton {
  buttonEl: HTMLElement
  iconEl: HTMLElement
  labelEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createDiv({ cls: 'text-icon-button tappable', attr: { tabindex: '0', role: 'button' } })
    this.iconEl = this.buttonEl.createSpan('text-button-icon')
    this.labelEl = this.buttonEl.createSpan('text-button-label')
    this.buttonEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.buttonEl.click()
      }
    })
  }
  setIcon(icon: string): this {
    this.iconEl.empty()
    setIcon(this.iconEl, icon)
    return this
  }
  setText(text: string): this {
    this.labelEl.setText(text)
    return this
  }
  onClick(fn: (e: MouseEvent) => void): this {
    this.buttonEl.addEventListener('click', fn)
    return this
  }
  setDisabled(d: boolean): this {
    this.buttonEl.toggleClass('is-disabled', d)
    return this
  }
}

/** Menu-like action row: `div.bases-toolbar-menu-item.bases-toolbar-menu-action`. */
export class ActionRow {
  rowEl: HTMLElement
  iconEl: HTMLElement
  nameEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.rowEl = parent.createDiv({ cls: 'bases-toolbar-menu-item bases-toolbar-menu-action tappable', attr: { tabindex: '0' } })
    const info = this.rowEl.createDiv('bases-toolbar-menu-item-info')
    this.iconEl = info.createDiv('bases-toolbar-menu-item-info-icon')
    this.nameEl = info.createDiv('bases-toolbar-menu-item-name')
    this.rowEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.rowEl.click()
      }
    })
  }
  setIcon(icon: string): this {
    setIcon(this.iconEl, icon)
    return this
  }
  setText(t: string): this {
    this.nameEl.setText(t)
    return this
  }
  onClick(fn: (e: MouseEvent) => void): this {
    this.rowEl.addEventListener('click', fn)
    return this
  }
}

// ---------------------------------------------------------------------------------------------- pages
/** A page shown inside a ToolbarMenu (`div.bases-toolbar-menu-container` by default). */
export class MenuPage {
  title = ''
  actionEls: HTMLElement[] = []
  containerEl: HTMLElement
  scope: Scope
  constructor(public host: ToolbarMenu, cls = 'bases-toolbar-menu-container') {
    this.containerEl = createDiv(cls)
    this.scope = new Scope(host.scope)
  }
  get isShown(): boolean {
    return this.host.isCurrentPage(this)
  }
  setTitle(t: string): this {
    this.title = t
    return this
  }
  addAction(icon: string, fn: (e: MouseEvent, el: HTMLElement) => void): void {
    const el = createDiv('clickable-icon')
    setIcon(el, icon)
    el.addEventListener('click', e => fn(e, el))
    this.actionEls.push(el)
  }
  onShow(): void {}
  onHide(): void {}
}

/** The popover (`div.menu.bases-toolbar-menu`) with a stack of pages and a back/close header. */
export class ToolbarMenu {
  enabled = true
  menuEl: HTMLElement
  scrollEl: HTMLElement
  bgEl: HTMLElement
  scope: Scope
  isOpen = false
  handleOpen: (() => void) | null = null
  handleClose: (() => void) | null = null
  private pageStack: MenuPage[] = []
  private createRootPage: (() => MenuPage) | null = null
  private pageHeaderEl: HTMLElement
  private pageBackEl: HTMLElement
  private pageTitleEl: HTMLElement
  private pageCloseEl: HTMLElement
  private cleanupOutside: (() => void) | null = null
  private autoDestroy: (() => void) | null = null
  private observer: ResizeObserver | null = null

  constructor(public app: any, public parentEl: HTMLElement, public title: string) {
    this.scope = new Scope(app.scope)
    this.scope.register([], 'Escape', () => this.setOpen(false))
    this.bgEl = createDiv('suggestion-bg')
    this.bgEl.style.opacity = '0'
    this.bgEl.addEventListener('mousedown', e => e.preventDefault())
    this.bgEl.addEventListener('click', () => this.setOpen(false))
    this.menuEl = createDiv('menu bases-toolbar-menu')
    this.menuEl.createDiv('menu-grabber')
    this.scrollEl = this.menuEl.createDiv('menu-scroll')
    this.pageHeaderEl = createDiv('bases-toolbar-menu-container-header')
    this.pageBackEl = this.pageHeaderEl.createDiv('back-button')
    setIcon(this.pageBackEl.createDiv('back-icon'), 'lucide-chevron-left')
    this.pageTitleEl = this.pageBackEl.createDiv('back-label')
    this.pageBackEl.addEventListener('click', () => this.back())
    this.pageCloseEl = this.pageHeaderEl.createDiv('close-icon clickable-icon')
    setIcon(this.pageCloseEl, 'lucide-x')
    this.pageCloseEl.addEventListener('click', () => this.close())
  }

  setRootPage(fn: () => MenuPage): this {
    this.createRootPage = fn
    return this
  }
  show(page: MenuPage): void {
    this.pageStack[this.pageStack.length - 1]?.onHide()
    this.pageStack.push(page)
    this.app.keymap.pushScope(page.scope)
    this.displayPage(page)
  }
  back(): void {
    const p = this.pageStack.pop()
    if (p) {
      p.onHide()
      this.app.keymap.popScope(p.scope)
    }
    const t = this.pageStack[this.pageStack.length - 1]
    if (t) this.displayPage(t)
  }
  backToRoot(): void {
    while (this.pageStack.length > 1) this.back()
  }
  isCurrentPage(p: MenuPage): boolean {
    return this.pageStack[this.pageStack.length - 1] === p
  }
  close(): void {
    this.setOpen(false)
  }
  private displayPage(page: MenuPage): void {
    const sub = this.pageStack.length > 1
    if (sub) {
      this.pageTitleEl.setText(page.title)
      this.pageHeaderEl.setChildrenInPlace([this.pageBackEl, ...page.actionEls, this.pageCloseEl])
      page.containerEl.prepend(this.pageHeaderEl)
    } else this.pageHeaderEl.detach()
    this.scrollEl.setChildrenInPlace([page.containerEl])
    page.onShow()
  }
  private clearPages(): void {
    this.pageStack[this.pageStack.length - 1]?.onHide()
    let p: MenuPage | undefined
    while ((p = this.pageStack.pop())) this.app.keymap.popScope(p.scope)
  }
  private isOutside(n: Node): boolean {
    return !(n as Element).closest?.('.suggestion-container') && !this.parentEl.contains(n) && !this.menuEl.contains(n)
  }
  private registerOutside(): void {
    const win = this.parentEl.ownerDocument.defaultView || window
    let down = false
    const md = (e: MouseEvent): void => {
      down = !e.defaultPrevented && this.isOutside(e.target as Node)
    }
    const click = (): void => {
      if (!this.isOpen) return
      if (down) {
        this.setOpen(false)
        down = false
      }
    }
    win.addEventListener('mousedown', md)
    win.addEventListener('click', click)
    this.cleanupOutside?.()
    this.cleanupOutside = () => {
      win.removeEventListener('mousedown', md)
      win.removeEventListener('click', click)
    }
  }
  position(): void {
    positionNear(this.parentEl.getBoundingClientRect(), this.menuEl, { preventOverlap: true, gap: 4 })
  }
  setAutoDestroy(el: HTMLElement): void {
    this.autoDestroy?.()
    this.autoDestroy = onElementGone(el, 500, () => this.setOpen(false))
  }
  setOpen(open: boolean): void {
    if (this.isOpen === open || (open && !this.enabled)) return
    this.isOpen = open
    this.parentEl.toggleClass('has-active-menu', open)
    const doc = this.parentEl.ownerDocument
    if (open) {
      this.app.keymap.pushScope(this.scope)
      setTimeout(() => this.registerOutside(), 0)
      this.handleOpen?.()
      if (this.createRootPage) this.show(this.createRootPage())
      doc.body.appendChild(this.bgEl)
      doc.body.appendChild(this.menuEl)
      this.position()
      if (!this.observer) {
        this.observer = new ResizeObserver(() => this.position())
      }
      this.observer.observe(this.menuEl)
    } else {
      this.autoDestroy?.()
      this.autoDestroy = null
      this.handleClose?.()
      this.clearPages()
      this.cleanupOutside?.()
      this.cleanupOutside = null
      this.app.keymap.popScope(this.scope)
      const hadFocus = this.menuEl.contains(doc.activeElement)
      this.bgEl.detach()
      this.menuEl.detach()
      this.observer?.disconnect()
      this.observer = null
      if (hadFocus) this.parentEl.focus()
    }
  }
  toggle(): void {
    this.setOpen(!this.isOpen)
  }
}

/** A toolbar entry: `div.bases-toolbar-item` with a text/icon button that opens a ToolbarMenu. */
export class ToolbarItem {
  enabled = true
  containerEl: HTMLElement
  button: TextButton
  menu: ToolbarMenu
  constructor(app: any, parent: HTMLElement, public name: string, public icon: string) {
    this.containerEl = parent.createDiv('bases-toolbar-item')
    this.button = new TextButton(this.containerEl).setIcon(icon).setText(name).onClick(() => this.toggle())
    this.menu = new ToolbarMenu(app, this.button.buttonEl, name)
  }
  addClass(c: string): void {
    this.containerEl.addClass(c)
    this.menu.menuEl.addClass(c)
  }
  get scrollEl(): HTMLElement {
    return this.menu.scrollEl
  }
  setEnabled(e: boolean): this {
    this.enabled = e
    this.button.setDisabled(!e)
    if (!e && this.menu.isOpen) this.setOpen(false)
    return this
  }
  setOpen(o: boolean): void {
    if (o && !this.enabled) return
    if (o) this.menu.setAutoDestroy(this.button.buttonEl)
    this.menu.setOpen(o)
  }
  toggle(): void {
    this.setOpen(!this.menu.isOpen)
  }
}

// ---------------------------------------------------------------------------------------------- lists
/** Suggestion list that groups its items into `div.suggestion-group[data-group]` blocks. */
export class GroupedChooser<T extends { group: string }> extends SuggestionChooser<T> {
  groups: string[] | null = null
  groupEls: Record<string, HTMLElement> = {}
  setGroups(g: string[]): this {
    this.groups = g
    return this
  }
  getGroupEl(g: string): HTMLElement | null {
    return this.groupEls[g] ?? null
  }
  override renderSuggestions(): void {
    const el = this.containerEl
    el.empty()
    const rows: HTMLElement[] = []
    const els: Record<string, HTMLElement> = (this.groupEls = {})
    const mk = (g: string): HTMLElement => (els[g] = el.createDiv({ cls: 'suggestion-group', attr: { 'data-group': g } }))
    for (const g of this.groups ?? []) mk(g)
    for (const v of this.values ?? []) {
      const row = (els[v.group] ?? mk(v.group)).createDiv('suggestion-item')
      this.chooser.renderSuggestion(v, row)
      rows.push(row)
    }
    rows[this.selectedItem]?.addClass('is-selected')
    this.suggestions = rows
  }
}

/** `div.mod-raised.search-input-container` filter box shown at the top of list pages. */
export function searchBox(parent: HTMLElement, placeholder: string, onChange: (v: string) => void): SearchComponent {
  const s = new SearchComponent(parent).setClass('mod-raised').setPlaceholder(placeholder).onChange(onChange)
  s.inputEl.addEventListener('focus', () => parent.addClass('has-input-focus'))
  s.inputEl.addEventListener('blur', () => parent.removeClass('has-input-focus'))
  return s
}

// ---------------------------------------------------------------------------------------------- form controls
export function inputRow(form: HTMLElement, label?: string): { row: HTMLElement; labelEl: HTMLElement | null; content: HTMLElement } {
  const row = form.createDiv('input-row')
  const labelEl = label !== undefined ? row.createDiv({ cls: 'input-row-label', text: label }) : null
  return { row, labelEl, content: row.createDiv('input-row-content') }
}

export function textControl(parent: HTMLElement, o: { value?: string; placeholder?: string; onChange?: (v: string) => void }): HTMLInputElement {
  const i = parent.createEl('input', { type: 'text' }) as HTMLInputElement
  if (o.placeholder !== undefined) i.placeholder = o.placeholder
  i.value = o.value ?? ''
  if (o.onChange) i.addEventListener('input', () => o.onChange!(i.value))
  return i
}

/** Dropdown with the hidden "measuring" twin used to size it. */
export function dropdownControl(parent: HTMLElement, options: Record<string, string>, value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = parent.createEl('select', { cls: 'dropdown node-insert-event' }) as HTMLSelectElement
  for (const k of Object.keys(options)) s.createEl('option', { value: k, text: options[k] })
  s.value = value in options ? value : Object.keys(options)[0] ?? ''
  const m = parent.createEl('select', { cls: 'dropdown is-measuring' }) as HTMLSelectElement
  const sync = (): void => {
    m.empty()
    m.createEl('option', { text: options[s.value] ?? '' })
  }
  sync()
  s.addEventListener('change', () => {
    sync()
    onChange(s.value)
  })
  return s
}

export function sliderControl(parent: HTMLElement, o: { min: number; max: number; step: number; value: number | null; onChange: (v: number) => void }): HTMLInputElement {
  const decimals = (String(o.step).split('.')[1] ?? '').length
  const out = parent.createSpan({ cls: 'slider-value', text: o.value === null ? '' : o.value.toFixed(decimals) })
  const i = parent.createEl('input', { type: 'range', cls: 'slider', attr: { min: String(o.min), max: String(o.max), step: String(o.step) } }) as HTMLInputElement
  i.value = String(o.value ?? o.min)
  i.addEventListener('input', () => out.setText(Number(i.value).toFixed(decimals)))
  i.addEventListener('change', () => o.onChange(Number(i.value)))
  return i
}

export function toggleControl(parent: HTMLElement, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const label = parent.createEl('label', { cls: 'checkbox-container' + (value ? ' is-enabled' : '') })
  const i = label.createEl('input', { type: 'checkbox' }) as HTMLInputElement
  i.checked = value
  i.addEventListener('change', () => {
    label.toggleClass('is-enabled', i.checked)
    onChange(i.checked)
  })
  return label
}
