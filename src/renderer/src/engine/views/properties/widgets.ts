/* eslint-disable @typescript-eslint/no-explicit-any */
// Property value widgets of the metadata editor (text, list, number, checkbox, date, datetime, tags,
// aliases, plus the Bases-oriented file/folder/property types).
import { setIcon } from '../../ui/icons'
import { moment } from '../../ui/moment'

export interface WidgetContext {
  app: any
  key: string
  onChange: (value: any) => void
  sourcePath: string
  blur: () => void
  hoverSource?: string
}
export interface RenderedWidget {
  type: string
  containerEl: HTMLElement
  focus(mode?: 'both' | 'start' | 'end'): void
  setValue(v: any): void
}
export interface TypeWidget {
  /** Localised display name. */
  name: () => string
  type: string
  icon: string
  reservedKeys?: string[]
  validate: (v: any) => boolean
  render: (el: HTMLElement, value: any, ctx: WidgetContext) => RenderedWidget
}

const NO_VALUE = 'Empty'
const DATE_FORMATS = ['YYYY-MM-DD']
const DATETIME_FORMATS = ['YYYY-MM-DD[T]HH:mm:ss', 'YYYY-MM-DD[T]HH:mm', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm']

/** Move the caret into a contenteditable / input (and select nothing). */
function focusEnd(el: HTMLElement, atStart?: boolean): void {
  el.focus()
  const sel = el.ownerDocument.defaultView?.getSelection()
  if (!sel || el.tagName === 'INPUT') return
  const r = el.ownerDocument.createRange()
  r.selectNodeContents(el)
  r.collapse(atStart === true)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** Brief red tooltip-ish error next to an input (`mod-error` tooltip). */
function showError(el: HTMLElement, msg: string): void {
  const win = el.ownerDocument.defaultView as any
  const tip = el.ownerDocument.body.createDiv({ cls: 'tooltip mod-error', text: msg })
  const r = el.getBoundingClientRect()
  tip.style.left = r.left + 'px'
  tip.style.top = r.bottom + 4 + 'px'
  tip.style.position = 'fixed'
  win.setTimeout(() => tip.remove(), 2000)
}

/** Render a `[[wikilink]]`, `[text](path)`, URL or e-mail value as a clickable link. Returns true if it was one. */
function renderLink(text: string, inner: HTMLElement, ctx: WidgetContext): boolean {
  const app = ctx.app
  let internal = false
  let external = false
  let href = ''
  let title = ''
  if (text.startsWith('[[') && text.endsWith(']]')) {
    internal = true
    const body = text.slice(2, -2)
    const bar = body.indexOf('|')
    href = bar < 0 ? body : body.slice(0, bar)
    title = bar < 0 ? body : body.slice(bar + 1)
  } else if (text.startsWith('[') && text.endsWith(')')) {
    const m = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(text)
    if (m) {
      title = m[1]
      href = m[2].trim()
      if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1).trim()
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?|mailto|obsidian):/i.test(href)) external = true
      else if (/^(https?|mailto|obsidian):/i.test(href)) external = true
      else {
        internal = true
        try {
          href = decodeURI(href)
        } catch {
          /* keep */
        }
      }
    }
  } else if (/^https?:\/\/\S+$/i.test(text)) {
    external = true
    href = title = text
  } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    external = true
    href = 'mailto:' + text
    title = text
  }
  if (!internal && !external) return false
  inner.setText(title)
  inner.setAttr('data-href', href)
  inner.toggleClass('internal-link', internal)
  inner.toggleClass('external-link', external)
  if (internal) inner.toggleClass('is-unresolved', app.metadataCache.isUnresolved?.(href.split('#')[0], ctx.sourcePath) ?? !app.metadataCache.getFirstLinkpathDest(href.split('#')[0], ctx.sourcePath))
  inner.addEventListener('click', (e: MouseEvent) => {
    if (e.defaultPrevented || (e.button !== 0 && e.button !== 1)) return
    e.preventDefault()
    if (internal) void app.workspace.openLinkText(href, ctx.sourcePath, e.ctrlKey || e.metaKey)
    else window.open(href, '_blank')
  })
  if (internal)
    inner.addEventListener('mouseover', e => app.workspace.trigger('hover-link', { event: e, source: ctx.hoverSource, hoverParent: inner, targetEl: inner, linktext: href, sourcePath: ctx.sourcePath }))
  return true
}

/* ---------------------------------------------------------------------------------------------
 * Multi-select (pill list)
 * ------------------------------------------------------------------------------------------- */
export class MultiSelect {
  rootEl: HTMLElement
  inputEl: HTMLElement
  values: string[] = []
  elements: HTMLElement[] = []
  private optionRenderer: ((v: string, o: { el: HTMLElement; pillEl: HTMLElement }) => void) | null = null
  private createOption: ((text: string) => string | null | undefined) | null = null
  private findDuplicate: ((v: string, others: string[]) => number) | null = null
  private changeCb: ((values: string[]) => void) | null = null

  constructor(containerEl: HTMLElement) {
    this.rootEl = containerEl.createDiv({ cls: 'multi-select-container', attr: { tabindex: '-1' } })
    this.inputEl = this.rootEl.createDiv({ cls: 'multi-select-input', attr: { contenteditable: 'true', tabindex: '0', placeholder: '' } })
    this.inputEl.addEventListener('keydown', e => this.onInputKey(e))
    this.inputEl.addEventListener('blur', () => this.commitInput())
    this.rootEl.addEventListener('click', e => {
      if (e.target === this.rootEl) this.inputEl.focus()
    })
  }
  setOptionRenderer(fn: (v: string, o: { el: HTMLElement; pillEl: HTMLElement }) => void): this {
    this.optionRenderer = fn
    return this
  }
  allowCreatingOptions(fn: (text: string) => string | null | undefined): this {
    this.createOption = fn
    return this
  }
  preventDuplicates(fn: (v: string, others: string[]) => number): this {
    this.findDuplicate = fn
    return this
  }
  onChange(fn: (values: string[]) => void): this {
    this.changeCb = fn
    return this
  }
  setValues(values: string[] | null): this {
    this.values = values ? values.slice() : []
    this.render()
    return this
  }
  setInputText(text: string): void {
    this.inputEl.setText(text)
  }
  getInputText(): string {
    return this.inputEl.textContent ?? ''
  }

  private onInputKey(e: KeyboardEvent): void {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      this.commitInput()
    } else if (e.key === 'Backspace' && !this.getInputText()) {
      e.preventDefault()
      this.focusElement(this.values.length - 1)
    } else if (e.key === 'ArrowLeft' && this.caretAtStart()) {
      e.preventDefault()
      this.focusElement(this.values.length - 1)
    }
  }
  private caretAtStart(): boolean {
    const sel = this.inputEl.ownerDocument.defaultView?.getSelection()
    return !this.getInputText() || (!!sel && sel.isCollapsed && sel.anchorOffset === 0)
  }
  commitInput(): void {
    const text = this.getInputText()
    if (!text.trim()) return this.setInputText('')
    if (this.addElement(text)) this.setInputText('')
  }
  /** Add a value (through allowCreatingOptions + duplicate check). */
  addElement(text: string): boolean {
    let v: string | null | undefined = text
    if (this.createOption) v = this.createOption(text)
    if (v == null || v === '') return false
    if (this.findDuplicate && this.findDuplicate(v, this.values) >= 0) return false
    this.values.push(v)
    this.render()
    this.changeCb?.(this.values.slice())
    return true
  }
  removeElement(index: number, focusPrev = false): void {
    if (index < 0 || index >= this.values.length) return
    this.values.splice(index, 1)
    this.render()
    this.changeCb?.(this.values.slice())
    if (focusPrev) {
      if (this.values.length === 0) this.inputEl.focus()
      else this.focusElement(Math.max(0, index - 1))
    }
  }
  focusElement(index: number): void {
    if (index < 0) return void this.inputEl.focus()
    if (index >= this.elements.length) return void this.inputEl.focus()
    this.elements[index].focus()
  }
  editElement(index: number): void {
    const pill = this.elements[index]
    const content = pill?.querySelector<HTMLElement>('.multi-select-pill-content')
    if (!content) return
    const old = this.values[index]
    content.setText(old)
    content.contentEditable = 'true'
    focusEnd(content)
    let done = false
    const finish = (commit: boolean) => {
      if (done) return
      done = true
      content.contentEditable = 'false'
      const text = (content.textContent ?? '').trim()
      if (commit && text && text !== old) {
        let v: string | null | undefined = text
        if (this.createOption) v = this.createOption(text)
        if (v && !(this.findDuplicate && this.findDuplicate(v, this.values.filter((_, i) => i !== index)) >= 0)) {
          this.values[index] = v
          this.render()
          this.changeCb?.(this.values.slice())
          return this.focusElement(index)
        }
      }
      this.render()
      this.focusElement(index)
    }
    content.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(false)
      }
    })
    content.addEventListener('blur', () => finish(true))
  }

  render(): void {
    this.elements = []
    for (let i = 0; i < this.values.length; i++) {
      const v = this.values[i]
      const pill = createDiv({ cls: 'multi-select-pill', attr: { tabindex: '0' } })
      const content = pill.createDiv('multi-select-pill-content')
      const remove = pill.createDiv('multi-select-pill-remove-button')
      setIcon(remove, 'lucide-x')
      pill.addEventListener('keydown', e => {
        if (e.isComposing || e.target !== pill) return
        const idx = this.elements.indexOf(pill)
        if (e.key === 'Enter') (e.preventDefault(), this.editElement(idx))
        else if (e.key === 'Escape') (e.preventDefault(), this.inputEl.focus())
        else if (e.key === 'Backspace') (e.preventDefault(), this.removeElement(idx, true))
        else if (e.key === 'ArrowUp') (e.preventDefault(), this.focusElement(0))
        else if (e.key === 'ArrowDown') (e.preventDefault(), this.inputEl.focus())
        else if (e.key === 'ArrowLeft') (e.preventDefault(), this.focusElement(idx - 1))
        else if (e.key === 'ArrowRight') (e.preventDefault(), this.focusElement(idx + 1))
      })
      if (this.optionRenderer) this.optionRenderer(v, { el: content, pillEl: pill })
      else content.createSpan({ text: String(v) })
      if (this.findDuplicate) {
        const dup = this.findDuplicate(v, this.values.slice(0, i))
        if (dup >= 0 && dup < i) pill.addClass('is-invalid')
      }
      remove.addEventListener('mousedown', e => e.preventDefault())
      remove.addEventListener('click', e => {
        e.preventDefault()
        this.removeElement(this.elements.indexOf(pill))
        this.inputEl.dispatchEvent(new Event('input'))
      })
      this.elements.push(pill)
    }
    this.rootEl.replaceChildren(...this.elements, this.inputEl)
    this.inputEl.setAttr('placeholder', this.elements.length > 0 ? '' : NO_VALUE)
  }
}

/** Frontmatter value -> list of strings (null when empty). */
export function toStringList(v: unknown): string[] | null {
  if (v === null || v === undefined || v === '') return null
  if (Array.isArray(v)) {
    const l = v.filter(x => x != null).map(x => String(x))
    return l.length ? l : null
  }
  return [String(v)]
}

/* ---------------------------------------------------------------------------------------------
 * Widgets
 * ------------------------------------------------------------------------------------------- */
abstract class BaseWidget implements RenderedWidget {
  abstract type: string
  constructor(public containerEl: HTMLElement) {}
  abstract setValue(v: any): void
  abstract onFocus(mode: 'both' | 'start' | 'end'): void
  focus(mode: 'both' | 'start' | 'end' = 'both'): void {
    this.onFocus(mode)
  }
}

class TextWidget extends BaseWidget {
  type = 'text'
  inputEl: HTMLElement
  value = ''
  private saving = false
  constructor(private ctx: WidgetContext, el: HTMLElement) {
    super(el)
    const o = (this.inputEl = el.createDiv({
      cls: 'metadata-input-longtext',
      attr: { placeholder: NO_VALUE, contenteditable: 'true', spellcheck: String(ctx.app.vault.getConfig('spellcheck')), tabindex: '0' }
    }))
    o.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Enter') {
        if (e.shiftKey || e.defaultPrevented) return
        e.preventDefault()
        this.commit(o.textContent ?? '')
        ctx.blur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.setValue(this.value)
        ctx.blur()
      }
    })
    o.addEventListener('blur', e => {
      if (e.defaultPrevented || this.saving) return
      this.commit((o.textContent ?? '').trimEnd())
    })
    o.addEventListener('paste', e => {
      e.preventDefault()
      const t = e.clipboardData?.getData('text/plain') ?? ''
      o.ownerDocument.execCommand('insertText', false, t)
    })
  }
  commit(v: string): void {
    this.saving = true
    this.ctx.onChange(v)
    this.setValue(v)
  }
  render(): void {
    let input = this.inputEl
    const inner = createDiv('metadata-link-inner')
    if (renderLink(this.value, inner, this.ctx)) {
      input = createDiv('metadata-link')
      input.appendChild(inner)
      setIcon(input.createDiv('metadata-link-flair'), 'lucide-pencil')
      input.addEventListener('click', e => {
        if (!e.defaultPrevented) this.onFocus('both')
      })
    }
    this.containerEl.replaceChildren(input)
  }
  setValue(v: any): void {
    if (!v) v = ''
    this.saving = true
    this.value = String(v)
    this.inputEl.textContent = v
    this.render()
    this.saving = false
  }
  onFocus(mode: 'both' | 'start' | 'end'): void {
    this.containerEl.replaceChildren(this.inputEl)
    focusEnd(this.inputEl, mode === 'start')
  }
}

class MultitextWidget extends BaseWidget {
  type = 'multitext'
  multiselect: MultiSelect
  constructor(ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    const list = toStringList(value)
    this.multiselect = new MultiSelect(el)
      .setOptionRenderer((v, { el: c }) => {
        if (!renderLink(v, c, ctx)) c.setText(v)
      })
      .setValues(list)
      .allowCreatingOptions(t => t)
      .onChange(vals => ctx.onChange(vals.slice()))
    this.multiselect.inputEl.addEventListener('keydown', e => {
      if (!e.isComposing && e.key === 'Escape') {
        e.preventDefault()
        ctx.blur()
      }
    })
  }
  onFocus(): void {
    this.multiselect.inputEl.focus()
  }
  setValue(v: any): void {
    this.multiselect.setValues(toStringList(v))
  }
}

const TAG_RE = /^#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+$/
const hasNonNumeric = (t: string) => /[^0-9/]/.test(t.slice(1))
function isValidTag(t: string): boolean {
  return TAG_RE.test(t) && hasNonNumeric(t)
}

class TagsWidget extends BaseWidget {
  type = 'tags'
  multiselect: MultiSelect
  constructor(ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    const strip = (t: string) => (t.startsWith('#') ? t.slice(1) : t)
    const ms = (this.multiselect = new MultiSelect(el)
      .setOptionRenderer((v, { el: c, pillEl }) => {
        const t = strip(v)
        c.createEl('span', { text: t })
        if (!isValidTag('#' + t)) {
          pillEl.addClass('is-invalid')
          pillEl.setAttribute('aria-label', 'Invalid tag name')
        }
        c.addEventListener('click', () => ctx.app.internalPlugins?.getEnabledPluginById?.('global-search')?.openGlobalSearch?.('tag:' + t))
      })
      .preventDuplicates((v, others) => others.map(strip).indexOf(strip(v)))
      .allowCreatingOptions(text => {
        let t = text
        if (!t.trim()) return null
        if (!t.startsWith('#')) t = '#' + t
        if (isValidTag(t)) return text
        showError(ms.inputEl, 'Invalid tag name')
        return null
      })
      .setValues(toStringList(value) ?? [])
      .onChange(vals => ctx.onChange(vals.slice())))
    ms.inputEl.setAttr('autocapitalize', 'none')
    ms.inputEl.addEventListener('keydown', e => {
      if (!e.isComposing && e.key === 'Escape') {
        e.preventDefault()
        ctx.blur()
      }
    })
  }
  onFocus(): void {
    this.multiselect.inputEl.focus()
  }
  setValue(v: any): void {
    this.multiselect.setValues(toStringList(v))
  }
}

class AliasesWidget extends BaseWidget {
  type = 'aliases'
  multiselect: MultiSelect
  constructor(ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    this.multiselect = new MultiSelect(el)
      .setOptionRenderer((v, { el: c, pillEl }) => {
        c.setText(v)
        if (v.trim().length === 0) pillEl.addClass('is-invalid')
      })
      .preventDuplicates((v, others) => others.indexOf(v))
      .allowCreatingOptions(t => t.trim())
      .setValues(toStringList(value))
      .onChange(vals => ctx.onChange(vals.slice()))
    this.multiselect.inputEl.addEventListener('keydown', e => {
      if (!e.isComposing && e.key === 'Escape') {
        e.preventDefault()
        ctx.blur()
      }
    })
  }
  onFocus(): void {
    this.multiselect.inputEl.focus()
  }
  setValue(v: any): void {
    this.multiselect.setValues(toStringList(v))
  }
}

class DateWidget extends BaseWidget {
  type = 'date'
  inputEl: HTMLInputElement
  buttonEl: HTMLElement | null = null
  value = ''
  date: any
  dirty = false
  constructor(protected ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    this.value = value ?? ''
    this.parse(value)
    this.dirty = false
    const o = (this.inputEl = this.buildInput(el))
    o.toggleClass('is-empty', !value)
    o.addEventListener('input', () => {
      o.toggleClass('is-empty', !o.value)
      this.parse(o.value)
      this.dirty = true
    })
    o.addEventListener('blur', () => {
      if (this.dirty && (o.value === '' || this.date.isValid())) {
        this.value = o.value
        ctx.onChange(this.format(this.date))
        this.dirty = false
      }
    })
    o.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Enter') (e.preventDefault(), ctx.blur())
      else if (e.key === 'Escape') (e.preventDefault(), this.setValue(this.value), ctx.blur())
    })
    this.addExtras(el)
  }
  protected addExtras(el: HTMLElement): void {
    const daily = this.ctx.app.internalPlugins?.getEnabledPluginById?.('daily-notes')
    if (!daily) return
    this.buttonEl = el.createDiv('clickable-icon', b => {
      setIcon(b, 'lucide-link')
      b.setAttribute('aria-label', 'Open daily note')
      b.addEventListener('click', async e => {
        const f = await daily.getDailyNote?.(this.date)
        if (f) void this.ctx.app.workspace.getLeaf(e.ctrlKey || e.metaKey).openFile(f)
      })
      b.toggle(!!this.value)
    })
  }
  protected buildInput(el: HTMLElement): HTMLInputElement {
    return el.createEl('input', { cls: 'metadata-input metadata-input-text mod-date', type: 'date', placeholder: NO_VALUE, value: this.format(this.date), attr: { max: '9999-12-31' } }) as HTMLInputElement
  }
  parse(v: any): void {
    this.date = (moment as any)(v, DATE_FORMATS)
    this.buttonEl?.toggle(this.date.isValid())
  }
  format(d: any): string {
    return d.isValid() ? d.format('YYYY-MM-DD') : ''
  }
  setValue(v: any): void {
    this.dirty = false
    this.inputEl.value = this.value = v ?? ''
    this.inputEl.toggleClass('is-empty', !v)
    this.parse(v)
  }
  onFocus(): void {
    this.inputEl.focus()
  }
}

class DatetimeWidget extends DateWidget {
  type = 'datetime'
  protected addExtras(): void {}
  protected buildInput(el: HTMLElement): HTMLInputElement {
    return el.createEl('input', { cls: 'metadata-input metadata-input-text mod-datetime', type: 'datetime-local', placeholder: NO_VALUE, value: this.format(this.date), attr: { max: '9999-12-31T23:59' } }) as HTMLInputElement
  }
  parse(v: any): void {
    this.date = (moment as any)(v, DATETIME_FORMATS)
  }
  format(d: any): string {
    return d.isValid() ? d.format('YYYY-MM-DD[T]HH:mm:ss') : ''
  }
}

class NumberWidget extends BaseWidget {
  type = 'number'
  inputEl: HTMLInputElement
  constructor(ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    let cur = value
    const o = (this.inputEl = el.createEl('input', {
      cls: 'metadata-input metadata-input-number',
      type: 'number',
      placeholder: NO_VALUE,
      value: value == null || Number.isNaN(value) ? '' : '' + value,
      attr: { inputmode: 'decimal', step: 'any' }
    }) as HTMLInputElement)
    const commit = (raw: string) => {
      cur = null
      if (raw && ((cur = +o.value), Number.isNaN(cur))) return showError(o, 'Invalid number')
      ctx.onChange(cur)
    }
    o.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (o.validity.valid) (commit(o.value), ctx.blur())
        else showError(o, 'Invalid number')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        o.value = cur != null ? String(cur) : ''
        ctx.blur()
      }
    })
    o.addEventListener('blur', e => {
      if (e.defaultPrevented) return
      if (o.validity.valid) commit(o.value)
      else o.value = cur != null ? String(cur) : ''
    })
  }
  onFocus(): void {
    this.inputEl.focus()
  }
  setValue(v: any): void {
    this.inputEl.value = v === null ? '' : String(v)
  }
}

class CheckboxWidget extends BaseWidget {
  type = 'checkbox'
  checkboxEl: HTMLInputElement
  constructor(ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    const o = (this.checkboxEl = el.createEl('input', { type: 'checkbox', cls: 'metadata-input-checkbox' }) as HTMLInputElement)
    o.checked = !!value
    o.setAttr('data-indeterminate', String(value == null))
    o.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Enter' || e.key === 'Escape') (e.preventDefault(), ctx.blur())
    })
    o.addEventListener('change', () => {
      ctx.onChange(o.checked)
      o.setAttr('data-indeterminate', 'false')
    })
  }
  onFocus(): void {
    this.checkboxEl.focus()
  }
  setValue(v: any): void {
    if (v === null) {
      this.checkboxEl.checked = false
      this.checkboxEl.setAttr('data-indeterminate', 'true')
      return
    }
    this.checkboxEl.checked = v
  }
}

/** file / folder / property types (Bases): plain text input. */
class PlainInputWidget extends BaseWidget {
  type: string
  inputEl: HTMLInputElement
  constructor(type: string, ctx: WidgetContext, el: HTMLElement, value: any) {
    super(el)
    this.type = type
    const o = (this.inputEl = el.createEl('input', { cls: 'metadata-input metadata-input-text', type: 'text', placeholder: NO_VALUE, value: value ?? '' }) as HTMLInputElement)
    o.addEventListener('change', () => ctx.onChange(o.value))
    o.addEventListener('keydown', e => {
      if (!e.isComposing && (e.key === 'Enter' || e.key === 'Escape')) (e.preventDefault(), ctx.blur())
    })
  }
  onFocus(): void {
    this.inputEl.focus()
  }
  setValue(v: any): void {
    this.inputEl.value = v ?? ''
  }
}

const str = (v: any) => typeof v === 'string'
export const widgets: Record<string, TypeWidget> = {
  aliases: { name: () => 'Aliases', type: 'aliases', icon: 'lucide-forward', reservedKeys: ['aliases'], validate: v => Array.isArray(v) || str(v) || v == null, render: (el, v, c) => new AliasesWidget(c, el, v) },
  checkbox: { name: () => 'Checkbox', type: 'checkbox', icon: 'lucide-check-square', validate: v => typeof v === 'boolean', render: (el, v, c) => new CheckboxWidget(c, el, v) },
  date: { name: () => 'Date', type: 'date', icon: 'lucide-calendar', validate: v => !v || (moment as any)(v, DATE_FORMATS).isValid(), render: (el, v, c) => new DateWidget(c, el, v) },
  datetime: { name: () => 'Date & time', type: 'datetime', icon: 'lucide-clock', validate: v => !v || (moment as any)(v, DATETIME_FORMATS).isValid(), render: (el, v, c) => new DatetimeWidget(c, el, v) },
  file: { name: () => 'File', type: 'file', icon: 'lucide-file', reservedKeys: [], validate: str, render: (el, v, c) => new PlainInputWidget('file', c, el, v) },
  folder: { name: () => 'Folder', type: 'folder', icon: 'lucide-folder', reservedKeys: [], validate: str, render: (el, v, c) => new PlainInputWidget('folder', c, el, v) },
  multitext: { name: () => 'List', type: 'multitext', icon: 'lucide-list', validate: v => Array.isArray(v) && v.every(x => typeof x !== 'object' || x == null), render: (el, v, c) => new MultitextWidget(c, el, v) },
  property: { name: () => 'Property', type: 'property', icon: 'lucide-badge', reservedKeys: [], validate: str, render: (el, v, c) => new PlainInputWidget('property', c, el, v) },
  number: { name: () => 'Number', type: 'number', icon: 'lucide-binary', validate: v => typeof v === 'number' && !Number.isNaN(v), render: (el, v, c) => new NumberWidget(c, el, v) },
  tags: { name: () => 'Tags', type: 'tags', icon: 'lucide-tags', reservedKeys: ['tags'], validate: v => Array.isArray(v) || str(v) || v == null, render: (el, v, c) => new TagsWidget(c, el, v) },
  text: { name: () => 'Text', type: 'text', icon: 'lucide-text', validate: str, render: (el, v, c) => { const w = new TextWidget(c, el); w.setValue(v ?? ''); return w } }
}
/** Fallback for unregistered / un-inferable types. */
export const UNKNOWN_WIDGET: TypeWidget = {
  name: () => 'Unknown',
  type: 'unknown',
  icon: 'lucide-file-question',
  validate: () => true,
  render: (el, v, c) => {
    const w = new TextWidget(c, el)
    w.setValue(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
    return w
  }
}
