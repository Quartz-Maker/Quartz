// `Setting`, `SettingGroup` and the setting components (plugin API, obsidian.d.ts).
//
// Setting DOM: `div.setting-item[tabindex=-1] > .setting-item-info > (.setting-item-name +
// .setting-item-description) + .setting-item-control`. Components append their controls to the
// control element in call order.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { moment } from './moment'
import { Platform } from '../keymap/Platform'
import { setIcon } from './icons'
import { setTooltip, type TooltipOptions } from './tooltip'
import { onActivate } from './dom'

export interface RGB {
  r: number
  g: number
  b: number
}
export interface HSL {
  h: number
  s: number
  l: number
}
export type HexString = string

// ---- colour helpers -----------------------------------------------------------------------

const HEX_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i

export function hexToRgb(hex: string): (RGB & { a: number }) | null {
  const m = HEX_RE.exec(hex)
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: m[4] ? parseInt(m[4], 16) / 255 : 1 } : null
}

function hex2(n: number): string {
  const s = n.toString(16)
  return s.length === 1 ? '0' + s : s
}

export function rgbToHex(c: RGB): string {
  return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b)
}

function hue(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + 6 * (q - p) * t
  if (t < 0.5) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

export function hslToRgb(c: HSL): RGB {
  const h = c.h / 360
  const s = c.s / 100
  const l = c.l / 100
  let r: number, g: number, b: number
  if (s === 0) r = g = b = l
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }
  return { r: Math.round(255 * r), g: Math.round(255 * g), b: Math.round(255 * b) }
}

export function rgbToHsl(c: RGB): HSL {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h: Math.round(360 * h), s: Math.round(100 * s), l: Math.round(100 * l) }
}

/** Focus + select an input once it is attached (desktop only unless `force`). */
function autoSelect(el: HTMLInputElement, force = false): void {
  if (!force && !Platform.hasPhysicalKeyboard) return
  const run = (): void => {
    el.focus()
    el.select()
  }
  if (el.isShown()) run()
  else (el as any).onNodeInserted(run, true)
}

function vibrate(): void {
  try {
    navigator.vibrate?.(100)
  } catch {
    /* not supported */
  }
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v)
  return Number.isNaN(n) ? fallback : n
}

// ---- components -----------------------------------------------------------------------------

export abstract class BaseComponent {
  disabled = false
  then(cb: (component: this) => any): this {
    cb(this)
    return this
  }
  setDisabled(disabled: boolean): this {
    this.disabled = disabled
    return this
  }
}

export abstract class ValueComponent<T> extends BaseComponent {
  registerOptionListener(listeners: Record<string, (value?: T) => T>, key: string): this {
    listeners[key] = (value?: T) => {
      if (value !== undefined) this.setValue(value)
      return this.getValue()
    }
    return this
  }
  abstract getValue(): T
  abstract setValue(value: T): this
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement
  private clickCallback: ((evt: MouseEvent) => unknown | Promise<unknown>) | null = null

  constructor(containerEl: HTMLElement) {
    super()
    const btn = (this.buttonEl = containerEl.createEl('button'))
    btn.addEventListener('click', async e => {
      const cb = this.clickCallback
      if (this.disabled || !cb) return
      btn.addClass('mod-loading')
      try {
        await cb(e)
      } finally {
        btn.removeClass('mod-loading')
      }
    })
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.buttonEl.disabled = disabled
    return this
  }
  /** @internal */
  setLoading(loading: boolean): this {
    this.buttonEl.toggleClass('mod-loading', loading)
    return this
  }
  setCta(): this {
    this.buttonEl.addClass('mod-cta')
    return this
  }
  removeCta(): this {
    this.buttonEl.removeClass('mod-cta')
    return this
  }
  setWarning(): this {
    return this.setDestructive().setCta()
  }
  setDestructive(): this {
    this.buttonEl.addClass('mod-destructive')
    return this
  }
  removeDestructive(): this {
    this.buttonEl.removeClass('mod-destructive')
    return this
  }
  setTooltip(tooltip: string, options?: TooltipOptions): this {
    setTooltip(this.buttonEl, tooltip, options)
    return this
  }
  setButtonText(name: string): this {
    this.buttonEl.setText(name)
    return this
  }
  setIcon(icon: string): this {
    setIcon(this.buttonEl, icon)
    return this
  }
  setClass(cls: string): this {
    this.buttonEl.addClass(cls)
    return this
  }
  onClick(callback: (evt: MouseEvent) => unknown | Promise<unknown>): this {
    this.clickCallback = callback
    return this
  }
}

export class ExtraButtonComponent extends BaseComponent {
  extraSettingsEl: HTMLElement
  private changeCallback: (() => any) | null = null

  constructor(containerEl: HTMLElement) {
    super()
    const el = (this.extraSettingsEl = containerEl.createDiv({ cls: 'clickable-icon extra-setting-button', attr: { tabIndex: 0 } }))
    setIcon(el, 'lucide-settings')
    onActivate(el, () => {
      const cb = this.changeCallback
      if (!this.disabled && cb) cb()
    })
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.extraSettingsEl.toggleClass('is-disabled', disabled)
    if (disabled) this.extraSettingsEl.removeAttribute('tabindex')
    else this.extraSettingsEl.setAttribute('tabindex', '0')
    return this
  }
  setTooltip(tooltip: string, options?: TooltipOptions): this {
    setTooltip(this.extraSettingsEl, tooltip, options)
    return this
  }
  setIcon(icon: string): this {
    setIcon(this.extraSettingsEl, icon)
    return this
  }
  onClick(callback: () => any): this {
    this.changeCallback = callback
    return this
  }
}

export class DisplayValueComponent {
  valueEl: HTMLElement
  private statusEl: HTMLElement | null = null
  constructor(containerEl: HTMLElement) {
    this.valueEl = containerEl.createDiv('setting-item-value')
  }
  setValue(value: string | null): this {
    this.valueEl.setText(value || '')
    return this
  }
  setStatus(status: 'warning' | null): this {
    if (!status) {
      this.statusEl?.detach()
      this.statusEl = null
      return this
    }
    if (!this.statusEl) {
      this.statusEl = createDiv('setting-item-status')
      this.valueEl.after(this.statusEl)
    }
    if (status === 'warning') {
      this.statusEl.addClass('mod-warning')
      setIcon(this.statusEl, 'lucide-alert-triangle')
    }
    return this
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement
  private on = false
  private changeCallback: ((value: boolean) => any) | null = null

  constructor(containerEl: HTMLElement) {
    super()
    this.toggleEl = containerEl.createEl('label', { cls: 'checkbox-container', attr: { tabIndex: 0 } }, el => {
      el.createEl('input', { attr: { type: 'checkbox', tabIndex: -1 } })
      el.addEventListener('change', this.onClick.bind(this))
      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          this.onClick()
        }
      })
    })
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.toggleEl.toggleClass('is-disabled', disabled)
    return this
  }
  getValue(): boolean {
    return this.on
  }
  setValue(on: boolean): this {
    if (this.on !== on) {
      this.on = on
      this.toggleEl.toggleClass('is-enabled', on)
      this.changeCallback?.(on)
    }
    return this
  }
  /** @internal */
  setSmall(): this {
    this.toggleEl.addClass('mod-small')
    return this
  }
  setTooltip(tooltip: string, options?: TooltipOptions): this {
    setTooltip(this.toggleEl, tooltip, options)
    return this
  }
  onClick(): void {
    if (this.disabled) return
    vibrate()
    this.setValue(!this.getValue())
  }
  onChange(callback: (value: boolean) => any): this {
    this.changeCallback = callback
    return this
  }
}

export class AbstractTextComponent<T extends HTMLInputElement | HTMLTextAreaElement> extends ValueComponent<string> {
  inputEl: T
  protected changeCallback: ((value: string) => any) | null = null

  constructor(inputEl: T) {
    super()
    this.inputEl = inputEl
    inputEl.addEventListener('input', this.onChanged.bind(this))
    inputEl.setAttribute('spellcheck', 'false')
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.inputEl.disabled = disabled
    return this
  }
  getValue(): string {
    return this.inputEl.value
  }
  setValue(value: string): this {
    if (typeof value === 'string') this.inputEl.value = value
    return this
  }
  setPlaceholder(placeholder: string): this {
    this.inputEl.setAttribute('placeholder', placeholder)
    return this
  }
  onChanged(): void {
    const cb = this.changeCallback
    if (cb) cb(this.inputEl.value)
  }
  onChange(callback: (value: string) => any): this {
    this.changeCallback = callback
    return this
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(containerEl: HTMLElement) {
    super(containerEl.createEl('input', { type: 'text' }))
  }
  /** @internal */
  autoSelect(force = false): this {
    autoSelect(this.inputEl, force)
    return this
  }
}

export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(containerEl: HTMLElement) {
    super(containerEl.createEl('textarea'))
  }
}

export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  clearButtonEl: HTMLElement
  containerEl: HTMLElement

  constructor(containerEl: HTMLElement) {
    const container = containerEl.createDiv('search-input-container')
    const input = container.createEl('input', { type: 'search', attr: { enterkeyhint: 'search' } })
    super(input)
    this.containerEl = container
    this.clearButtonEl = container.createDiv('search-input-clear-button', el => {
      el.addEventListener('mousedown', e => e.preventDefault())
      el.addEventListener('click', () => {
        if (this.disabled) return
        input.value = ''
        this.onChanged()
        input.focus()
      })
    })
  }
  onChanged(): void {
    super.onChanged()
  }
  setValue(value: string): this {
    return super.setValue(value)
  }
  /** @internal */
  setClass(cls: string): this {
    this.containerEl.addClass(cls)
    return this
  }
  /** @internal */
  autoSelect(): this {
    autoSelect(this.inputEl)
    return this
  }
  /** @internal */
  addRightDecorator(cb: (el: HTMLElement) => any): this {
    cb(this.containerEl.createDiv('input-right-decorator'))
    return this
  }
}

/** @internal number input (the settings use it for numeric controls). */
export class NumberComponent extends TextComponent {
  constructor(containerEl: HTMLElement) {
    super(containerEl)
    this.inputEl.setAttribute('type', 'number')
  }
  getValueAsNumber(): number {
    return this.inputEl.valueAsNumber
  }
  setValueAsNumber(v: number): this {
    this.inputEl.valueAsNumber = v
    return this
  }
  setLimits(min: number | null, max: number | null, step: number | 'any'): this {
    ;(this.inputEl as any).setAttrs({ min, max, step })
    return this
  }
}

export class MomentFormatComponent extends TextComponent {
  sampleEl!: HTMLElement
  defaultFormat!: string

  setDefaultFormat(defaultFormat: string): this {
    this.defaultFormat = defaultFormat
    this.setPlaceholder(defaultFormat)
    this.updateSample()
    return this
  }
  setSampleEl(sampleEl: HTMLElement): this {
    this.sampleEl = sampleEl
    this.updateSample()
    return this
  }
  setValue(value: string): this {
    super.setValue(value)
    this.updateSample()
    return this
  }
  onChanged(): void {
    super.onChanged()
    this.updateSample()
  }
  updateSample(): void {
    const el = this.sampleEl
    if (!el) return
    const fmt = this.inputEl.value || this.defaultFormat
    if (fmt) el.setText(((window as any).moment || moment)().format(fmt))
    else el.setText('')
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement
  private measureEl: HTMLSelectElement
  private measureOptionEl: HTMLOptionElement
  private changeCallback: ((value: string) => any) | null = null

  constructor(containerEl: HTMLElement) {
    super()
    this.selectEl = containerEl.createEl('select', 'dropdown')
    this.measureEl = containerEl.createEl('select', 'dropdown is-measuring')
    this.measureEl.setAttribute('aria-hidden', 'true')
    this.measureEl.tabIndex = -1
    this.measureOptionEl = this.measureEl.createEl('option')
    ;(this.selectEl as any).onNodeInserted(() => this.resizeToFit(), true)
    this.selectEl.addEventListener('change', () => {
      this.resizeToFit()
      const cb = this.changeCallback
      if (cb) cb(this.getValue())
    })
    this.selectEl.addEventListener('mousedown', () => this.selectEl.addClass('mouse-focus'))
    this.selectEl.addEventListener('blur', () => this.selectEl.removeClass('mouse-focus'))
  }
  /** @internal Sizes the select to its selected option (via a hidden measuring select). */
  resizeToFit(): void {
    const opt = this.selectEl.options[this.selectEl.selectedIndex]
    if (!opt) return
    this.measureOptionEl.text = opt.text
    this.selectEl.style.setProperty('--dropdown-fitted-width', this.measureEl.offsetWidth + 'px')
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.selectEl.disabled = disabled
    return this
  }
  addOption(value: string, display: string): this {
    this.selectEl.createEl('option', { value, text: display })
    return this
  }
  addOptions(options: Record<string, string>): this {
    for (const k in options) if (Object.prototype.hasOwnProperty.call(options, k)) this.selectEl.createEl('option', { value: k, text: options[k] })
    return this
  }
  getValue(): string {
    return this.selectEl.value
  }
  setValue(value: string): this {
    this.selectEl.value = value
    this.resizeToFit()
    return this
  }
  onChange(callback: (value: string) => any): this {
    this.changeCallback = callback
    return this
  }
}

export class ProgressBarComponent extends ValueComponent<number> {
  progressBar: HTMLElement
  lineEl!: HTMLElement
  private value = 0

  constructor(containerEl: HTMLElement) {
    super()
    this.progressBar = containerEl.createDiv('setting-progress-bar', el => {
      this.lineEl = el.createDiv('setting-progress-bar-inner')
    })
  }
  getValue(): number {
    return this.value
  }
  setValue(value: number): this {
    value = Math.min(100, Math.max(0, value))
    this.value = value
    this.lineEl.style.width = `${value}%`
    return this
  }
  /** @internal */
  setVisibility(visible: boolean): this {
    this.progressBar.hidden = !visible
    return this
  }
}

export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement
  valueEl: HTMLElement
  private displayFormat: ((value: number) => string) | null = null
  private changeCallback: ((value: number) => any) | null = null
  private instant = false

  constructor(containerEl: HTMLElement) {
    super()
    this.valueEl = containerEl.createEl('span', 'slider-value')
    const el = (this.sliderEl = containerEl.createEl('input', { type: 'range', cls: 'slider' }))
    el.dataset.ignoreSwipe = 'true'
    el.addEventListener('input', () => {
      vibrate()
      this.updateDisplay()
      if (this.instant) this.changeCallback?.(this.getValue())
    })
    el.addEventListener('change', () => {
      if (!this.instant) this.changeCallback?.(this.getValue())
    })
    this.updateDisplay()
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.sliderEl.disabled = disabled
    return this
  }
  setInstant(instant: boolean): this {
    this.instant = instant
    return this
  }
  setLimits(min: number | null, max: number | null, step: number | 'any'): this {
    ;(this.sliderEl as any).setAttrs({ min, max, step })
    this.updateDisplay()
    return this
  }
  getValue(): number {
    return this.sliderEl.valueAsNumber
  }
  setValue(value: number): this {
    if (this.sliderEl.valueAsNumber !== value) {
      this.sliderEl.valueAsNumber = value
      this.updateDisplay()
      this.changeCallback?.(value)
    }
    return this
  }
  getValuePretty(): string {
    const el = this.sliderEl
    const v = this.getValue()
    if (this.displayFormat) return this.displayFormat(v)
    return el.step === 'any' || parseFloat(el.step) < 1 ? v.toFixed(2) : v.toString()
  }
  /** @since 1.13 */
  setDisplayFormat(format: (value: number) => string): this {
    this.displayFormat = format
    this.updateDisplay()
    return this
  }
  /** @deprecated the value is always displayed */
  setDynamicTooltip(): this {
    return this
  }
  /** @internal */
  updateDisplay(): void {
    const el = this.sliderEl
    this.valueEl.setText(this.getValuePretty())
    const min = num(el.min, 0)
    const max = num(el.max, 100)
    const v = this.getValue()
    const ratio = max > min ? (v - min) / (max - min) : 0
    el.style.setProperty('--slider-fill-ratio', ratio.toString())
  }
  /** @deprecated */
  showTooltip(): void {}
  onChange(callback: (value: number) => any): this {
    this.changeCallback = callback
    return this
  }
}

export class ColorComponent extends ValueComponent<string> {
  colorPickerEl: HTMLInputElement
  private changeCallback: ((value: string) => any) | null = null

  constructor(containerEl: HTMLElement) {
    super()
    this.colorPickerEl = containerEl.createEl('input', { type: 'color' })
    this.colorPickerEl.addEventListener('change', () => this.changeCallback?.(this.getValue()))
  }
  setDisabled(disabled: boolean): this {
    super.setDisabled(disabled)
    this.colorPickerEl.disabled = disabled
    return this
  }
  getValue(): HexString {
    return this.colorPickerEl.value
  }
  getValueRgb(): RGB {
    return hexToRgb(this.getValue()) || { r: 0, g: 0, b: 0 }
  }
  getValueHsl(): HSL {
    return rgbToHsl(this.getValueRgb())
  }
  /** @internal */
  getValueInt(): number {
    return parseInt(this.getValue().slice(1), 16)
  }
  setValue(value: HexString): this {
    if (this.colorPickerEl.value !== value) {
      this.colorPickerEl.value = value
      this.changeCallback?.(this.getValue())
    }
    return this
  }
  setValueRgb(rgb: RGB): this {
    return this.setValue(rgbToHex(rgb))
  }
  setValueHsl(hsl: HSL): this {
    return this.setValueRgb(hslToRgb(hsl))
  }
  /** @internal */
  setValueInt(v: number): this {
    return this.setValue('#' + v.toString(16).padStart(6, '0'))
  }
  onChange(callback: (value: string) => any): this {
    this.changeCallback = callback
    return this
  }
}

// ---- Setting --------------------------------------------------------------------------------

export class Setting {
  settingEl: HTMLElement
  infoEl: HTMLElement
  nameEl: HTMLElement
  descEl: HTMLElement
  controlEl: HTMLElement
  iconEl: HTMLElement | null = null
  components: BaseComponent[] = []
  errorEl: HTMLElement | null = null
  disabled = false
  private rowClick: (() => any) | null = null

  constructor(containerEl: HTMLElement) {
    const el = (this.settingEl = containerEl.createDiv({ cls: 'setting-item', attr: { tabIndex: -1 } }))
    const info = (this.infoEl = el.createDiv('setting-item-info'))
    this.nameEl = info.createDiv('setting-item-name')
    this.descEl = info.createDiv('setting-item-description')
    this.controlEl = el.createDiv('setting-item-control')
  }

  setErrorMessage(message: string | null): this {
    if (!message) {
      this.errorEl?.hide()
      this.settingEl.removeClass('is-invalid')
      return this
    }
    if (!this.errorEl) this.errorEl = this.controlEl.createDiv('setting-item-error')
    this.errorEl.setText(message)
    this.errorEl.show()
    this.settingEl.addClass('is-invalid')
    return this
  }

  addDisplayValue(cb: (component: DisplayValueComponent) => any): this {
    cb(new DisplayValueComponent(this.controlEl))
    return this
  }

  /** @internal */
  setIcon(icon: string | null): this {
    if (!this.iconEl) this.iconEl = this.settingEl.createDiv({ cls: 'setting-item-icon', prepend: true } as any)
    if (icon) setIcon(this.iconEl!, icon)
    else this.iconEl!.empty()
    return this
  }

  setName(name: string | DocumentFragment): this {
    this.nameEl.setText(name as any)
    return this
  }

  setDesc(desc: string | DocumentFragment): this {
    this.descEl.setText(desc as any)
    return this
  }

  setClass(cls: string): this {
    this.settingEl.addClass(...cls.split(' ').filter(Boolean))
    return this
  }

  setTooltip(tooltip: string, options?: TooltipOptions): this {
    setTooltip(this.nameEl, tooltip, options)
    return this
  }

  setHeading(): this {
    this.settingEl.addClass('setting-item-heading')
    return this
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled
    this.settingEl.toggleClass('is-disabled', disabled)
    for (const c of this.components) c.setDisabled(disabled)
    return this
  }

  /** @internal */
  setNoInfo(): this {
    this.infoEl.hide()
    return this
  }

  addButton(cb: (component: ButtonComponent) => any): this {
    const c = new ButtonComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addExtraButton(cb: (component: ExtraButtonComponent) => any): this {
    const c = new ExtraButtonComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addToggle(cb: (component: ToggleComponent) => any): this {
    const c = new ToggleComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    this.settingEl.addClass('mod-toggle')
    return this
  }

  addText(cb: (component: TextComponent) => any): this {
    const c = new TextComponent(this.controlEl)
    if (!Platform.hasPhysicalKeyboard) {
      const input = c.inputEl
      input.addEventListener('keydown', e => {
        if (!e.isComposing && !e.defaultPrevented && e.key === 'Enter') input.blur()
      })
    }
    this.components.push(c)
    cb(c)
    return this
  }

  addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this {
    this.components.push(cb(this.controlEl))
    return this
  }

  addSearch(cb: (component: SearchComponent) => any): this {
    const c = new SearchComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addTextArea(cb: (component: TextAreaComponent) => any): this {
    const c = new TextAreaComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addMomentFormat(cb: (component: MomentFormatComponent) => any): this {
    const c = new MomentFormatComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addDropdown(cb: (component: DropdownComponent) => any): this {
    const c = new DropdownComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addColorPicker(cb: (component: ColorComponent) => any): this {
    const c = new ColorComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addProgressBar(cb: (component: ProgressBarComponent) => any): this {
    const c = new ProgressBarComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  addSlider(cb: (component: SliderComponent) => any): this {
    const c = new SliderComponent(this.controlEl)
    this.components.push(c)
    cb(c)
    return this
  }

  then(cb: (setting: this) => any): this {
    cb(this)
    return this
  }

  clear(): this {
    this.controlEl.empty()
    this.components = []
    this.errorEl = null
    this.settingEl.removeClass('is-invalid')
    return this
  }

  /** @internal */
  setVisibility(visible: boolean): this {
    this.settingEl.toggle(visible)
    return this
  }

  /** @internal sub-page row with a chevron */
  setNavigable(cb: () => any): this {
    this.settingEl.addClass('mod-navigable', 'tappable')
    this.controlEl.createDiv('setting-item-chevron', el => setIcon(el, 'lucide-chevron-right'))
    this.setRowClick(cb)
    return this
  }

  /** @internal clickable row */
  setAction(cb: () => any): this {
    this.settingEl.addClass('mod-action', 'tappable')
    this.setRowClick(cb)
    return this
  }

  private setRowClick(cb: () => any): void {
    if (!this.rowClick) {
      this.settingEl.addEventListener('click', e => {
        if (!e.defaultPrevented && !this.disabled) this.rowClick?.call(this)
      })
    }
    this.rowClick = cb
  }
}

export class SettingGroup {
  groupEl: HTMLElement
  headerEl: HTMLElement
  headerInnerEl: HTMLElement
  controlEl: HTMLElement
  searchContainerEl: HTMLElement
  listEl: HTMLElement
  settings: Setting[] = []
  components: BaseComponent[] = []

  constructor(containerEl: HTMLElement) {
    const g = (this.groupEl = containerEl.createDiv('setting-group'))
    const h = (this.headerEl = createDiv('setting-item setting-item-heading'))
    this.headerInnerEl = h.createDiv('setting-item-name')
    this.controlEl = h.createDiv('setting-item-control')
    this.searchContainerEl = g.createDiv({ cls: 'setting-group-search', attr: { tabIndex: -1 } })
    this.listEl = g.createDiv('setting-items')
  }

  setHeading(text: string | DocumentFragment): this {
    this.headerInnerEl.setText(text as any)
    const want = !!text || this.controlEl.childElementCount > 0
    const shown = this.headerEl.isShown()
    if (want && !shown) this.groupEl.prepend(this.headerEl)
    else if (!want && shown) this.headerEl.detach()
    return this
  }

  addClass(...classes: string[]): this {
    this.groupEl.addClass(...classes)
    return this
  }

  addSetting(cb: (setting: Setting) => void): this {
    const s = new Setting(this.listEl)
    this.settings.push(s)
    cb(s)
    return this
  }

  addSearch(cb: (component: SearchComponent) => any): this {
    const c = new SearchComponent(this.searchContainerEl)
    this.components.push(c)
    cb(c)
    return this
  }

  /** @internal */
  addSearchControl(cb: (el: HTMLElement) => any): this {
    cb(this.searchContainerEl.createDiv('setting-group-search-control'))
    return this
  }

  addExtraButton(cb: (component: ExtraButtonComponent) => any): this {
    if (!this.headerEl.isShown()) this.groupEl.prepend(this.headerEl)
    const c = new ExtraButtonComponent(this.controlEl)
    c.extraSettingsEl.setAttr('tabIndex', 0)
    this.components.push(c)
    cb(c)
    return this
  }
}
