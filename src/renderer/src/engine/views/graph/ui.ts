// Minimal setting components for the graph controls
// (Setting, Toggle, Slider, Search, Text, ColorPicker, Button, collapsible tree-item section).
// TODO(ui-kit): switch to `engine/ui` Setting & components once that area is merged — same DOM, same semantics.
import { setIcon, setTooltip } from '../../workspace/dom'

type OptionListeners = Record<string, (v?: any) => any>

abstract class ValueComponent<T> {
  disabled = false
  then(cb: (c: this) => any): this {
    cb(this)
    return this
  }
  setDisabled(d: boolean): this {
    this.disabled = d
    return this
  }
  abstract getValue(): T
  abstract setValue(v: T): this
  /** listeners[key] = v => (v !== undefined && setValue(v), getValue()) */
  registerOptionListener(listeners: OptionListeners, key: string): this {
    listeners[key] = (v?: any) => {
      if (v !== undefined) this.setValue(v)
      return this.getValue()
    }
    return this
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  on = false
  toggleEl: HTMLElement
  changeCallback: ((v: boolean) => any) | null = null
  constructor(parent: HTMLElement) {
    super()
    this.toggleEl = parent.createEl('label', { cls: 'checkbox-container', attr: { tabIndex: 0 } }, el => {
      el.createEl('input', { attr: { type: 'checkbox', tabIndex: -1 } })
      el.addEventListener('change', () => this.onClick())
      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          this.onClick()
        }
      })
    })
  }
  getValue(): boolean {
    return this.on
  }
  setValue(v: boolean): this {
    if (this.on !== v) {
      this.on = v
      this.toggleEl.toggleClass('is-enabled', v)
      this.changeCallback?.(v)
    }
    return this
  }
  onClick(): void {
    if (!this.disabled) this.setValue(!this.getValue())
  }
  onChange(cb: (v: boolean) => any): this {
    this.changeCallback = cb
    return this
  }
}

/** HTML range sanitisation: clamp to [min, max], snap to the step grid from min. */
function sanitizeRange(v: number, min: number, max: number, step: number | 'any'): number {
  if (isNaN(v)) v = min + (max - min) / 2
  v = Math.min(max, Math.max(min, v))
  if (step !== 'any' && step > 0) {
    const n = Math.round((v - min) / step)
    v = min + n * step
    if (v > max) v -= step
    v = parseFloat(v.toFixed(12))
  }
  // the browser serialises the range value as a string: 15 significant digits
  return parseFloat(v.toPrecision(15))
}

export class SliderComponent extends ValueComponent<number> {
  valueEl: HTMLElement
  sliderEl: HTMLInputElement
  changeCallback: ((v: number) => any) | null = null
  instant = false
  private min = 0
  private max = 100
  private step: number | 'any' = 1
  private value = 50
  constructor(parent: HTMLElement) {
    super()
    this.valueEl = parent.createEl('span', 'slider-value')
    const el = (this.sliderEl = parent.createEl('input', { type: 'range', cls: 'slider' }) as HTMLInputElement)
    el.dataset.ignoreSwipe = 'true'
    el.addEventListener('input', () => {
      this.value = sanitizeRange(parseFloat(el.value), this.min, this.max, this.step)
      this.updateDisplay()
      if (this.instant) this.changeCallback?.(this.getValue())
    })
    el.addEventListener('change', () => {
      if (!this.instant) this.changeCallback?.(this.getValue())
    })
    this.updateDisplay()
  }
  setInstant(i: boolean): this {
    this.instant = i
    return this
  }
  setLimits(min: number, max: number, step: number | 'any'): this {
    this.min = min
    this.max = max
    this.step = step
    this.sliderEl.setAttrs({ min: String(min), max: String(max), step: String(step) })
    this.value = sanitizeRange(this.value, min, max, step)
    this.updateDisplay()
    return this
  }
  getValue(): number {
    return this.value
  }
  setValue(v: number): this {
    if (this.value !== v) {
      this.value = sanitizeRange(v, this.min, this.max, this.step)
      this.sliderEl.value = String(this.value)
      this.updateDisplay()
      this.changeCallback?.(v)
    }
    return this
  }
  getValuePretty(): string {
    const v = this.getValue()
    return this.step === 'any' || this.step < 1 ? v.toFixed(2) : v.toString()
  }
  updateDisplay(): void {
    this.valueEl.setText(this.getValuePretty())
    const r = this.max > this.min ? (this.getValue() - this.min) / (this.max - this.min) : 0
    this.sliderEl.style.setProperty('--slider-fill-ratio', r.toString())
  }
  onChange(cb: (v: number) => any): this {
    this.changeCallback = cb
    return this
  }
}

export class TextComponent extends ValueComponent<string> {
  inputEl: HTMLInputElement
  changeCallback: ((v: string) => any) | null = null
  constructor(parent: HTMLElement, type = 'text') {
    super()
    this.inputEl = parent.createEl('input', { type }) as HTMLInputElement
    this.inputEl.setAttribute('spellcheck', 'false')
    this.inputEl.addEventListener('input', () => this.changeCallback?.(this.getValue()))
  }
  getValue(): string {
    return this.inputEl.value
  }
  setValue(v: string): this {
    this.inputEl.value = v
    return this
  }
  setPlaceholder(p: string): this {
    this.inputEl.setAttribute('placeholder', p)
    return this
  }
  onChange(cb: (v: string) => any): this {
    this.changeCallback = cb
    return this
  }
}

export class SearchComponent extends TextComponent {
  containerEl: HTMLElement
  clearButtonEl: HTMLElement
  constructor(parent: HTMLElement) {
    const container = parent.createDiv('search-input-container')
    super(container, 'search')
    this.containerEl = container
    this.inputEl.setAttribute('enterkeyhint', 'search')
    this.inputEl.remove()
    // Attribute order: enterkeyhint, type, spellcheck
    const input = createEl('input', { attr: { enterkeyhint: 'search', type: 'search', spellcheck: 'false' } }) as HTMLInputElement
    input.addEventListener('input', () => {
      this.onChanged()
    })
    container.appendChild(input)
    this.inputEl = input
    this.clearButtonEl = container.createDiv('search-input-clear-button', el => {
      el.addEventListener('click', () => {
        this.setValue('')
        this.onChanged()
        this.inputEl.focus()
      })
    })
  }
  onChanged(): void {
    this.clearButtonEl.toggle(this.getValue() !== '')
    this.changeCallback?.(this.getValue())
  }
  setValue(v: string): this {
    super.setValue(v)
    if (this.clearButtonEl) this.clearButtonEl.toggle(v !== '')
    return this
  }
  autoSelect(): void {
    this.inputEl.focus()
    this.inputEl.select()
  }
}

export class ColorComponent extends ValueComponent<string> {
  colorPickerEl: HTMLInputElement
  changeCallback: ((v: string) => any) | null = null
  constructor(parent: HTMLElement) {
    super()
    this.colorPickerEl = parent.createEl('input', { type: 'color' }) as HTMLInputElement
    this.colorPickerEl.addEventListener('change', () => this.changeCallback?.(this.getValue()))
  }
  getValue(): string {
    return this.colorPickerEl.value
  }
  setValue(v: string): this {
    this.colorPickerEl.value = v
    return this
  }
  getValueInt(): number {
    return parseInt(this.getValue().slice(1), 16) || 0
  }
  setValueInt(n: number): this {
    return this.setValue('#' + (n & 0xffffff).toString(16).padStart(6, '0'))
  }
  onChange(cb: (v: string) => any): this {
    this.changeCallback = cb
    return this
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement
  private cb: ((e: MouseEvent) => any) | null = null
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl('button') as HTMLButtonElement
    this.buttonEl.addEventListener('click', e => this.cb?.(e))
  }
  setButtonText(t: string): this {
    this.buttonEl.setText(t)
    return this
  }
  onClick(cb: (e: MouseEvent) => any): this {
    this.cb = cb
    return this
  }
}

export class Setting {
  settingEl: HTMLElement
  infoEl: HTMLElement
  nameEl: HTMLElement
  descEl: HTMLElement
  controlEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv('setting-item')
    this.settingEl.setAttribute('tabindex', '-1')
    this.infoEl = this.settingEl.createDiv('setting-item-info')
    this.nameEl = this.infoEl.createDiv('setting-item-name')
    this.descEl = this.infoEl.createDiv('setting-item-description')
    this.controlEl = this.settingEl.createDiv('setting-item-control')
  }
  setName(n: string): this {
    this.nameEl.setText(n)
    return this
  }
  setTooltip(t: string): this {
    setTooltip(this.nameEl, t)
    return this
  }
  setClass(c: string): this {
    this.settingEl.addClass(c)
    return this
  }
  addToggle(cb: (c: ToggleComponent) => any): this {
    cb(new ToggleComponent(this.controlEl))
    return this
  }
  addSlider(cb: (c: SliderComponent) => any): this {
    cb(new SliderComponent(this.controlEl))
    return this
  }
  addSearch(cb: (c: SearchComponent) => any): this {
    cb(new SearchComponent(this.controlEl))
    return this
  }
  addButton(cb: (c: ButtonComponent) => any): this {
    cb(new ButtonComponent(this.controlEl))
    return this
  }
}

/** Collapsible `.tree-item` (children element is detached while collapsed). */
export class CollapsibleSection {
  el: HTMLElement
  selfEl: HTMLElement
  collapseEl: HTMLElement
  innerEl: HTMLElement
  childrenEl: HTMLElement
  collapsible = false
  collapsed = false
  constructor() {
    this.el = createDiv('tree-item')
    this.selfEl = this.el.createDiv('tree-item-self')
    this.collapseEl = this.selfEl.createDiv('tree-item-icon collapse-icon')
    setIcon(this.collapseEl, 'right-triangle')
    this.innerEl = this.selfEl.createDiv('tree-item-inner')
    this.childrenEl = this.el.createDiv('tree-item-children')
    this.selfEl.addEventListener('click', e => this.onSelfClick(e))
  }
  setCollapsible(c: boolean): this {
    this.collapsible = c
    this.selfEl.toggleClass('mod-collapsible', c)
    return this
  }
  onSelfClick(_e: MouseEvent): any {
    return this.toggleCollapsed(true)
  }
  toggleCollapsed(animate: boolean): Promise<void> {
    return this.setCollapsed(!this.collapsed, animate)
  }
  async setCollapsed(collapsed: boolean, animate: boolean): Promise<void> {
    if (this.collapsed === collapsed && (collapsed ? !this.childrenEl.parentElement : !!this.childrenEl.parentElement)) return
    this.collapsed = collapsed
    this.el.toggleClass('is-collapsed', collapsed)
    this.collapseEl.toggleClass('is-collapsed', collapsed)
    if (collapsed) this.childrenEl.detach()
    else {
      this.el.appendChild(this.childrenEl)
      this.childrenEl.setAttribute('style', '')
    }
    await this.updateCollapsed(animate)
  }
  async updateCollapsed(_animate: boolean): Promise<void> {}
}
