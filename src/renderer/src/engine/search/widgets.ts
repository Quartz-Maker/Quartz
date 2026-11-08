// Minimal widgets used by the search view (SearchComponent, toggle Setting,
// dropdown Setting). The full UI kit lives in engine/ui (separate area); these produce the
// same markup so themes apply.
import { setTooltip } from '../workspace/dom'

export interface SearchInput {
  containerEl: HTMLElement
  inputEl: HTMLInputElement
  clearButtonEl: HTMLElement
  getValue(): string
  setValue(v: string): void
  addRightDecorator(cb: (el: HTMLElement) => void): HTMLElement
}

export function createSearchInput(
  parent: HTMLElement,
  opts: { placeholder: string; cls?: string; clearTooltip?: string; onChange?: (v: string) => void }
): SearchInput {
  const containerEl = parent.createDiv('search-input-container')
  if (opts.cls) containerEl.addClass(opts.cls)
  const inputEl = containerEl.createEl('input', { attr: { enterkeyhint: 'search', type: 'search', spellcheck: 'false', placeholder: opts.placeholder } })
  const clearButtonEl = containerEl.createDiv('search-input-clear-button')
  if (opts.clearTooltip) setTooltip(clearButtonEl, opts.clearTooltip)
  let last = ''
  const changed = (): void => {
    if (inputEl.value === last) return
    last = inputEl.value
    clearButtonEl.toggle(last !== '')
    opts.onChange?.(last)
  }
  inputEl.addEventListener('input', changed)
  clearButtonEl.addEventListener('click', () => {
    inputEl.value = ''
    changed()
    inputEl.focus()
  })
  clearButtonEl.toggle(false)
  return {
    containerEl,
    inputEl,
    clearButtonEl,
    getValue: () => inputEl.value,
    setValue: (v) => {
      inputEl.value = v
      last = v
      clearButtonEl.toggle(v !== '')
    },
    addRightDecorator(cb) {
      const el = containerEl.createDiv('input-right-decorator')
      cb(el)
      return el
    }
  }
}

export interface ToggleSetting {
  settingEl: HTMLElement
  toggleEl: HTMLElement
  getValue(): boolean
  setValue(v: boolean): void
}

function settingItem(parent: HTMLElement, name: string, desc = '', cls?: string): { settingEl: HTMLElement; controlEl: HTMLElement } {
  const settingEl = parent.createDiv('setting-item')
  if (cls) settingEl.addClass(cls)
  settingEl.setAttribute('tabindex', '-1')
  const info = settingEl.createDiv('setting-item-info')
  info.createDiv({ cls: 'setting-item-name', text: name })
  info.createDiv({ cls: 'setting-item-description', text: desc })
  const controlEl = settingEl.createDiv('setting-item-control')
  return { settingEl, controlEl }
}

export function createToggleSetting(parent: HTMLElement, name: string, onChange: (v: boolean) => void, desc = ''): ToggleSetting {
  const { settingEl, controlEl } = settingItem(parent, name, desc, 'mod-toggle')
  const toggleEl = controlEl.createEl('label', { cls: 'checkbox-container', attr: { tabindex: '0' } })
  const input = toggleEl.createEl('input', { type: 'checkbox', attr: { tabindex: '-1' } })
  let value = false
  const set = (v: boolean, notify: boolean): void => {
    if (v === value) return
    value = v
    input.checked = v
    toggleEl.toggleClass('is-enabled', v)
    if (notify) onChange(v)
  }
  toggleEl.addEventListener('click', (e) => {
    e.preventDefault()
    set(!value, true)
  })
  toggleEl.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      set(!value, true)
    }
  })
  return { settingEl, toggleEl, getValue: () => value, setValue: (v) => set(v, true) }
}

export function createDropdownSetting(
  parent: HTMLElement,
  name: string,
  desc: string,
  options: Array<[string, string]>,
  value: string,
  onChange: (v: string) => void
): { settingEl: HTMLElement; selectEl: HTMLSelectElement; getValue(): string } {
  const { settingEl, controlEl } = settingItem(parent, name, desc)
  const selectEl = controlEl.createEl('select', 'dropdown')
  for (const [v, label] of options) selectEl.createEl('option', { value: v, text: label })
  selectEl.value = value
  selectEl.addEventListener('change', () => onChange(selectEl.value))
  return { settingEl, selectEl, getValue: () => selectEl.value }
}

export function createToggleSettingWithValue(parent: HTMLElement, name: string, desc: string, value: boolean, onChange: (v: boolean) => void): ToggleSetting {
  const t = createToggleSetting(parent, name, () => onChange(t.getValue()), desc)
  if (value) t.setValue(true)
  return t
}
