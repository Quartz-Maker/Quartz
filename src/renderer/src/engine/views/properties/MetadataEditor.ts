/* eslint-disable @typescript-eslint/no-explicit-any */
// The Properties editor: `.metadata-container` (in-document in Live Preview / reading view, and the
// body of the `file-properties` view).
//   .metadata-container > .metadata-error-container + .metadata-properties-heading + .metadata-content
//   .metadata-content > .metadata-properties > .metadata-property > (.metadata-property-key | .metadata-property-value | .metadata-property-warning-icon)
import { Component } from '../../core/Component'
import { Menu } from '../../ui/Menu'
import { Modal } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'
import type { RenderedWidget, TypeWidget } from './widgets'
import { stringifyFrontmatterYaml, getFrontMatterInfo } from '../../metadata/linkUpdate'

export interface MetadataOwner {
  getFile(): { path: string } | null
  saveFrontmatter(fm: Record<string, any>): void
  focusAfterMetadata(): void
  focusBeforeMetadata(): void
  getHoverSource(): string
  onMarkdownFold?(): void
  undo?(): void
  redo?(): void
}
interface Entry {
  key: string
  value: any
}
const DEFAULT_KEYS = new Set(['aliases', 'cssclasses', 'tags'])
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const isMod = (e: KeyboardEvent) => (navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey)

/** Replace (or insert / remove) the frontmatter block of `text` with `fm`. Empty object removes it. */
export function replaceFrontmatter(text: string, fm: Record<string, any>): string {
  const info = getFrontMatterInfo(text)
  const rest = info.exists ? text.slice(info.contentStart) : text
  if (!fm || Object.keys(fm).length === 0) return rest
  return '---\n' + stringifyFrontmatterYaml(fm).trim() + '\n---\n' + rest
}

export class MetadataEditor extends Component {
  app: any
  owner: MetadataOwner
  containerEl: HTMLElement
  errorEl: HTMLElement
  headingEl: HTMLElement
  foldEl: HTMLElement
  contentEl: HTMLElement
  propertyListEl: HTMLElement
  addPropertyButtonEl: HTMLElement
  properties: Entry[] = []
  rendered: MetadataProperty[] = []
  selectedLines = new Set<MetadataProperty>()
  collapsed = false
  invalidFrontmatter = false

  constructor(app: any, owner: MetadataOwner) {
    super()
    this.app = app
    this.owner = owner
    const c = (this.containerEl = createDiv({ cls: 'metadata-container', attr: { tabindex: '-1' } }))
    this.errorEl = c.createDiv('metadata-error-container')
    c.setAttr('data-property-count', '0')
    c.addEventListener('keydown', e => {
      if (!e.isComposing && e.target === c) this.handleKeypress(e)
    })
    c.addEventListener('focusin', e => {
      for (const r of this.rendered) if (r.containerEl === (e.target as Node)) return
      this.clearSelection()
    })
    const h = (this.headingEl = c.createDiv({ cls: 'metadata-properties-heading', attr: { tabindex: '0' } }))
    setIcon((this.foldEl = h.createDiv({ cls: 'collapse-indicator collapse-icon' })), 'right-triangle')
    h.createDiv({ cls: 'metadata-properties-title', text: 'Properties' })
    h.addEventListener('click', e => {
      e.preventDefault()
      this.toggleCollapse()
    })
    h.addEventListener('contextmenu', e => this.showPropertiesMenu(e))
    h.addEventListener('mousedown', e => e.preventDefault())
    h.addEventListener('keydown', e => {
      if (e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowLeft') (e.preventDefault(), this.setCollapse(true))
      else if (e.key === 'ArrowRight') (e.preventDefault(), this.setCollapse(false))
      else if (e.key === 'ArrowUp') (e.preventDefault(), this.owner.focusBeforeMetadata())
      else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        if (this.collapsed) this.owner.focusAfterMetadata()
        else this.focusPropertyAtIndex(0)
      }
    })
    const content = (this.contentEl = c.createDiv('metadata-content'))
    this.propertyListEl = content.createDiv('metadata-properties')
    this.addPropertyButtonEl = content.createDiv({ cls: 'metadata-add-button text-icon-button', attr: { tabindex: '0' } })
    setIcon(this.addPropertyButtonEl.createSpan('text-button-icon'), 'lucide-plus')
    this.addPropertyButtonEl.createSpan({ cls: 'text-button-label', text: 'Add property' })
    this.addPropertyButtonEl.addEventListener('click', () => this.addProperty())
    this.addPropertyButtonEl.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === ' ' || e.key === 'Enter') (e.preventDefault(), this.addProperty())
      else if (e.key === 'ArrowUp' || e.key === 'k' || (e.shiftKey && e.key === 'Tab')) (e.preventDefault(), this.focusPropertyAtIndex(-1))
      else if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'Tab') (e.preventDefault(), this.owner.focusAfterMetadata())
      else this.handleKeypress(e)
    })
  }

  onload(): void {
    this.registerEvent(this.app.metadataTypeManager.on('changed', (k: string) => this.onMetadataTypeChange(k)))
  }

  get focusedLine(): MetadataProperty | null {
    const a = this.containerEl.ownerDocument.activeElement
    return this.rendered.find(r => r.containerEl.contains(a)) ?? null
  }
  hasFocus(): boolean {
    return this.containerEl.contains(this.containerEl.ownerDocument.activeElement)
  }
  hasPropertyFocused(): boolean {
    const a = this.containerEl.ownerDocument.activeElement
    return this.rendered.some(r => r.containerEl === a)
  }

  handleKeypress(e: KeyboardEvent): void {
    if (e.key === 'o') {
      e.preventDefault()
      this.addProperty()
    } else if (e.key === 'Home' || (e.key === 'ArrowDown' && e.altKey)) {
      e.preventDefault()
      this.owner.focusAfterMetadata()
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey) {
      e.preventDefault()
      const cur = this.focusedLine
      const dir = e.key === 'ArrowDown' ? 1 : -1
      if (cur) {
        const i = this.rendered.indexOf(cur)
        const next = this.rendered[i + dir]
        const both = this.selectedLines.has(cur) && this.selectedLines.has(next)
        if (next) {
          if (both) this.selectProperty(cur, false)
          else (this.selectProperty(cur, true), this.selectProperty(next, true))
          next.focusProperty()
        }
      }
    } else if (e.key === 'ArrowUp' || e.key === 'k' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      this.clearSelection()
      const cur = this.focusedLine
      const i = cur ? this.rendered.indexOf(cur) : -1
      const prev = this.rendered[i - 1]
      if (prev) prev.focusProperty()
      else this.headingEl.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'Tab') {
      e.preventDefault()
      this.clearSelection()
      const cur = this.focusedLine
      const i = cur ? this.rendered.indexOf(cur) : -1
      const next = this.rendered[i + 1]
      if (next) next.focusProperty()
      else if (this.addPropertyButtonEl.isShown()) this.addPropertyButtonEl.focus()
      else this.owner.focusAfterMetadata()
    } else if (e.key === 'a' && isMod(e)) {
      e.preventDefault()
      this.selectAll()
    } else if (e.key === 'z' && e.shiftKey && isMod(e)) {
      e.preventDefault()
      this.owner.redo?.()
    } else if (e.key === 'z' && isMod(e)) {
      e.preventDefault()
      this.owner.undo?.()
    } else if (e.key === 'Escape' && this.selectedLines.size > 0) {
      e.preventDefault()
      this.clearSelection()
    } else if ((navigator.platform.includes('Mac') && e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') {
      e.preventDefault()
      const f = this.focusedLine
      const sel = Array.from(this.selectedLines)
      if (sel.length === 0 && f) sel.push(f)
      this.removeProperties(sel)
      this.clearSelection()
    }
  }

  showPropertiesMenu(e: MouseEvent): void {
    if (this.headingEl.hasClass('has-active-menu')) return
    const m = Menu.forEvent(e)
    m.addSections(['title', 'action-primary', 'action', 'action.sort', '', 'danger'])
    m.setSectionSubmenu('action.sort', { title: 'Sort', icon: 'lucide-sort-asc' })
    m.addItem(i => i.setTitle('Add property').setSection('action-primary').onClick(() => this.addProperty()))
    m.addItem(i => i.setTitle('Sort properties A to Z').setSection('action.sort').onClick(() => this.sortProperties()))
    m.addItem(i => i.setTitle('Sort properties Z to A').setSection('action.sort').onClick(() => this.sortProperties(true)))
    m.addItem(i =>
      i
        .setTitle('Clear properties')
        .setSection('danger')
        .setWarning(true)
        .onClick(() => this.removeProperties(this.rendered))
    )
    this.app.workspace.trigger('markdown-properties-menu', m, this.owner.getFile())
  }

  toggleCollapse(): void {
    this.setCollapse(!this.collapsed)
  }
  setCollapse(collapsed: boolean, animate = true): void {
    if (this.collapsed === collapsed) return
    this.collapsed = collapsed
    this.containerEl.toggleClass('is-collapsed', collapsed)
    this.headingEl.toggleClass('is-collapsed', collapsed)
    this.foldEl.toggleClass('is-collapsed', collapsed)
    this.contentEl.style.display = collapsed ? 'none' : ''
    if (animate) this.owner.onMarkdownFold?.()
  }
  selectAll(): void {
    for (const r of this.rendered) this.selectProperty(r, true)
  }
  focusPropertyAtIndex(i: number): void {
    const r = this.rendered.at(i)
    if (r) r.focusProperty()
    else if (this.addPropertyButtonEl.isShown()) this.addPropertyButtonEl.focus()
  }

  private copyToClipboard(e: ClipboardEvent, lines: MetadataProperty[]): void {
    const d = e.clipboardData
    if (!d) return
    const o: Record<string, any> = {}
    for (const l of lines) o[l.entry.key] = l.entry.value
    try {
      d.setData('Text', stringifyFrontmatterYaml(o))
      d.setData('obsidian/properties', JSON.stringify(o))
    } catch (err) {
      console.error('Failed to copy properties', err)
    }
  }
  handleCut(e: ClipboardEvent): void {
    if (!this.hasPropertyFocused()) return
    const lines = Array.from(this.selectedLines)
    if (lines.length === 0 && this.focusedLine) lines.push(this.focusedLine)
    if (!lines.length) return
    e.preventDefault()
    this.copyToClipboard(e, lines)
    this.removeProperties(lines)
  }
  handleCopy(e: ClipboardEvent): void {
    if (!this.hasPropertyFocused()) return
    const lines = Array.from(this.selectedLines)
    if (lines.length === 0 && this.focusedLine) lines.push(this.focusedLine)
    if (!lines.length) return
    e.preventDefault()
    this.copyToClipboard(e, lines)
  }
  handlePaste(e: ClipboardEvent): void {
    const t = e.clipboardData?.getData('obsidian/properties')
    if (!t) return
    e.preventDefault()
    let o: any = null
    try {
      o = JSON.parse(t)
    } catch (err) {
      console.error(err)
    }
    if (o) this.insertProperties(o)
  }
  insertProperties(add: Record<string, any>): void {
    const cur = this.serialize()
    for (const k of Object.keys(add)) {
      const existing = Object.keys(cur).find(x => x.toLowerCase() === k.toLowerCase())
      if (existing) {
        const a = cur[existing]
        const b = add[k]
        cur[existing] = Array.isArray(a) && Array.isArray(b) ? Array.from(new Set([...a, ...b])) : b
      } else cur[k] = add[k]
    }
    this.synchronize(cur)
    this.save()
  }

  handleItemSelection(e: MouseEvent, line: MetadataProperty): boolean {
    const sel = this.selectedLines
    const focused = this.focusedLine
    line.focusProperty()
    if (e.altKey && !e.shiftKey) {
      this.selectProperty(line, !sel.has(line))
      return true
    }
    if (e.shiftKey) {
      if (focused) {
        const [a, b] = [this.rendered.indexOf(focused), this.rendered.indexOf(line)].sort((x, y) => x - y)
        const both = sel.has(focused) && sel.has(line)
        for (let i = a; i <= b; i++) this.selectProperty(this.rendered[i], !both)
      } else this.selectProperty(line, true)
      return true
    }
    this.clearSelection()
    return false
  }
  selectProperty(line: MetadataProperty | undefined, on: boolean): void {
    if (!line) return
    if (on) {
      this.selectedLines.add(line)
      line.setSelected(true)
    } else {
      this.selectedLines.delete(line)
      line.setSelected(false)
    }
  }
  clearSelection(): void {
    this.selectedLines.forEach(l => l.setSelected(false))
    this.selectedLines.clear()
  }
  /** Called when the file is unloaded. */
  clear(): void {
    if (this.hasFocus()) {
      ;(this.containerEl.ownerDocument.activeElement as HTMLElement | null)?.blur()
      this.containerEl.focus({ preventScroll: true })
    }
    this.selectedLines = new Set()
  }
  focus(opts: { bottom: boolean } = { bottom: false }): boolean {
    if (this.properties.length === 0) return false
    if (this.collapsed || !opts.bottom) this.headingEl.focus()
    else if (this.addPropertyButtonEl.isShown()) this.addPropertyButtonEl.focus()
    else this.focusPropertyAtIndex(-1)
    return true
  }
  focusProperty(key: string): void {
    this.rendered.find(r => r.entry.key === key)?.focusProperty()
  }
  focusKey(key: string): void {
    this.rendered.find(r => r.entry.key === key)?.focusKey()
  }
  focusValue(key: string, mode: 'both' | 'start' | 'end' = 'both'): void {
    this.rendered.find(r => r.entry.key === key)?.focusValue(mode)
  }
  onMetadataTypeChange(lowerKey: string): void {
    const r = this.rendered.find(x => x.entry.key.toLowerCase() === lowerKey)
    r?.renderProperty(r.entry, true)
  }

  /** Re-render from a frontmatter object (null = invalid YAML). */
  synchronize(fm: Record<string, any> | null): void {
    const valid = !!fm
    const entries: Entry[] = []
    const rendered: MetadataProperty[] = []
    if (fm) for (const k of Object.keys(fm)) entries.push({ key: k, value: fm[k] })
    for (const entry of entries) {
      let r = this.rendered.find(x => x.entry.key === entry.key)
      if (!r) r = new MetadataProperty(this.app, this, entry)
      r.renderProperty(entry)
      rendered.push(r)
    }
    // Keep a freshly added, still-unnamed row alive while it holds focus.
    const blank = this.rendered.find(x => x.entry.key === '')
    if (blank && this.containerEl.ownerDocument.activeElement && blank.containerEl.contains(this.containerEl.ownerDocument.activeElement)) {
      rendered.push(blank)
      entries.push(blank.entry)
    }
    this.propertyListEl.replaceChildren(...rendered.map(r => r.containerEl))
    this.properties = entries
    this.rendered = rendered
    this.invalidFrontmatter = !valid
    this.containerEl.setAttr('data-property-count', String(entries.length))
    this.containerEl.toggleClass('mod-error', !valid)
    this.headingEl.toggle(valid)
    this.addPropertyButtonEl.toggle(valid)
    this.errorEl.toggle(!valid)
    if (!valid && !this.errorEl.firstChild) {
      this.errorEl.createDiv({ cls: 'metadata-error-title', text: 'Invalid properties' })
      const b = this.errorEl.createDiv('text-icon-button metadata-show-source-button')
      b.createSpan({ cls: 'text-button-label', text: 'Show source' })
      b.addEventListener('click', () => {
        const file = this.owner.getFile()
        if (!file) return
        const leaf = this.app.workspace.getLeaf()
        const v = this.app.workspace.getActiveFileView?.()
        const view = v && v.file === file ? v : null
        const target = view?.leaf ?? leaf
        const open = async () => {
          if (!view) await leaf.openFile(file)
          const st = target.getViewState()
          st.state.mode = 'source'
          await target.setViewState(st, { focus: true, cursor: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } } } as any)
        }
        void open()
      })
    }
  }

  serialize(): Record<string, any> {
    const o: Record<string, any> = {}
    for (const p of this.properties) o[p.key] = p.value
    return o
  }
  sortProperties(reverse = false): void {
    const o = this.serialize()
    const keys = Object.keys(o).sort((a, b) => (reverse ? collator.compare(b, a) : collator.compare(a, b)))
    const out: Record<string, any> = {}
    for (const k of keys) out[k] = o[k]
    this.synchronize(out)
    this.save()
  }

  addProperty(key = ''): void {
    if (this.invalidFrontmatter) {
      new Notice('Failed to read properties.')
      return
    }
    const o = this.serialize()
    if (!Object.prototype.hasOwnProperty.call(o, key)) {
      o[key] = null
      this.synchronize(o)
      if (key) this.owner.saveFrontmatter(o)
    }
    if (key) this.focusValue(key, 'both')
    else this.focusKey(key)
  }
  removeProperties(lines: MetadataProperty[], refocus = true): void {
    let before = 0
    const f = this.focusedLine
    let idx = f ? this.rendered.indexOf(f) : -1
    const o = this.serialize()
    for (const l of lines) {
      if (this.rendered.indexOf(l) <= idx) before++
      delete o[l.entry.key]
    }
    idx -= before
    this.synchronize(o)
    if (refocus) {
      if (Object.keys(o).length > 0) this.focusPropertyAtIndex(Math.max(0, Math.min(idx, this.rendered.length - 1)))
      else this.owner.focusAfterMetadata()
    }
    this.owner.saveFrontmatter(o)
  }
  save(): void {
    this.owner.saveFrontmatter(this.serialize())
  }
  reorderKey(entry: Entry, index: number): void {
    const o = this.serialize()
    delete o[entry.key]
    const out: Record<string, any> = {}
    const keys = Object.keys(o)
    for (let i = 0; i < keys.length; i++) {
      if (i === index) out[entry.key] = entry.value
      out[keys[i]] = o[keys[i]]
    }
    if (index >= keys.length) out[entry.key] = entry.value
    this.owner.saveFrontmatter(out)
  }
}

/** Modal asking whether to re-type a property whose value does not fit the assigned type. */
class TypeMismatchModal extends Modal {
  constructor(app: any, private prop: MetadataProperty) {
    super(app)
    const w: TypeWidget = prop.typeInfo.expected
    this.setTitle(`Display as ${w.name()}?`)
    this.contentEl.createEl('p', { text: `Your ${prop.typeInfo.inferred.name()} data is not compatible. It will be adapted to fit the new format.` })
    const btns = this.contentEl.createDiv('modal-button-container')
    btns.createEl('button', { cls: 'mod-cta', text: `Display as ${w.name()}` }, b => b.addEventListener('click', () => (this.close(), prop.renderProperty(prop.entry, true, true))))
    btns.createEl('button', { text: 'Cancel' }, b => b.addEventListener('click', () => this.close()))
  }
}

export class MetadataProperty {
  app: any
  metadataEditor: MetadataEditor
  entry: Entry
  typeInfo: { expected: TypeWidget; inferred: TypeWidget }
  containerEl: HTMLElement
  keyEl: HTMLElement
  iconEl: HTMLElement
  keyInputEl: HTMLInputElement
  valueEl: HTMLElement
  warningEl: HTMLElement
  rendered: RenderedWidget | null = null

  constructor(app: any, editor: MetadataEditor, entry: Entry) {
    this.app = app
    this.metadataEditor = editor
    this.entry = entry
    this.typeInfo = app.metadataTypeManager.getTypeInfo(entry.key, entry.value)
    const c = (this.containerEl = createDiv({ cls: 'metadata-property', attr: { tabindex: '0' } }))
    c.setAttr('data-property-key', entry.key.toLowerCase())
    c.addEventListener('keydown', e => {
      if (e.isComposing || e.defaultPrevented || e.target !== c) return
      if (editor.selectedLines.size > 1) editor.handleKeypress(e)
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'A' || e.key === 'i') {
        e.preventDefault()
        editor.focusValue(this.entry.key, e.key === 'A' ? 'end' : e.key === 'i' ? 'start' : 'both')
      } else if (e.key === 'ArrowLeft' || e.key === 'h') (e.preventDefault(), this.focusKey())
      else if (e.key === 'ArrowRight' || e.key === 'l') (e.preventDefault(), this.focusValue())
      else editor.handleKeypress(e)
    })
    this.keyEl = c.createDiv('metadata-property-key')
    this.iconEl = this.keyEl.createSpan({ cls: 'metadata-property-icon', attr: { 'aria-disabled': String(!entry.key) } })
    this.iconEl.addEventListener('mousedown', e => e.preventDefault())
    this.iconEl.addEventListener('click', e => {
      e.preventDefault()
      if (this.iconEl.getAttr('aria-disabled') === 'true' || c.hasClass('has-active-menu')) return
      this.handleItemClick(e)
    })
    this.iconEl.addEventListener('contextmenu', e => {
      if (this.iconEl.getAttr('aria-disabled') === 'true' || c.hasClass('has-active-menu')) return
      e.preventDefault()
      this.focusProperty()
      this.showPropertyMenu(e)
    })
    const k = (this.keyInputEl = this.keyEl.createEl('input', {
      cls: 'metadata-property-key-input',
      type: 'text',
      attr: { autocapitalize: 'none', enterkeyhint: 'next' }
    }) as HTMLInputElement)
    k.value = entry.key
    setTooltip(k, entry.key)
    k.setAttribute('aria-label', entry.key)
    k.addEventListener('blur', () => {
      if (k === k.ownerDocument.activeElement) return
      const v = k.value.trim()
      if (v === '' && this.entry.key === '') this.metadataEditor.removeProperties([this], false)
      else if (!this.handleUpdateKey(v)) k.value = this.entry.key
    })
    k.addEventListener('keydown', e => {
      if (e.isComposing || e.defaultPrevented) return
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        const v = k.value.trim()
        if (this.handleUpdateKey(v)) requestAnimationFrame(() => (this.renderProperty(this.entry, true), this.focusValue()))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        k.value = this.entry.key
        if (this.entry.key) this.focusProperty()
        else this.metadataEditor.removeProperties([this])
      }
    })
    k.addEventListener('input', () => this.iconEl.setAttr('aria-disabled', String(!(this.entry.key || k.value.trim()))))
    attachKeySuggest(app, k, editor, key => {
      k.value = key
      if (this.handleUpdateKey(key)) requestAnimationFrame(() => (this.renderProperty(this.entry, true), this.focusValue()))
    })
    this.valueEl = c.createDiv('metadata-property-value')
    const w = (this.warningEl = c.createDiv({ cls: 'clickable-icon metadata-property-warning-icon' }))
    setTooltip(w, `Type mismatch, expected ${this.typeInfo.expected.name()}`)
    w.setAttribute('aria-label', `Type mismatch, expected ${this.typeInfo.expected.name()}`)
    setIcon(w, 'lucide-alert-triangle')
    w.toggle(this.typeInfo.expected !== this.typeInfo.inferred)
    w.addEventListener('click', () => new TypeMismatchModal(app, this).open())
    this.attachDrag()
  }

  /** Drag the icon to reorder (writes the new key order). */
  private attachDrag(): void {
    const list = this.metadataEditor.propertyListEl
    this.iconEl.addEventListener('pointerdown', down => {
      if (down.button !== 0 || this.iconEl.getAttr('aria-disabled') === 'true') return
      const startY = down.clientY
      let dragging = false
      let target = -1
      const move = (e: PointerEvent) => {
        if (!dragging && Math.abs(e.clientY - startY) > 10) {
          dragging = true
          this.containerEl.addClass('is-being-dragged')
        }
        if (!dragging) return
        const rows = this.metadataEditor.rendered.filter(r => r !== this)
        target = rows.findIndex(r => e.clientY < r.containerEl.getBoundingClientRect().top + r.containerEl.offsetHeight / 2)
        if (target < 0) target = rows.length
        rows.forEach((r, i) => r.containerEl.toggleClass('is-drop-before', i === target))
        list.toggleClass('is-drop-end', target === rows.length)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        this.containerEl.removeClass('is-being-dragged')
        this.metadataEditor.rendered.forEach(r => r.containerEl.removeClass('is-drop-before'))
        list.removeClass('is-drop-end')
        if (dragging && target >= 0) {
          this.iconEl.addEventListener('click', ev => ev.stopImmediatePropagation(), { once: true, capture: true })
          this.metadataEditor.reorderKey(this.entry, target)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    })
  }

  setSelected(on: boolean): void {
    this.containerEl.toggleClass('is-selected', on)
  }
  handleItemClick(e: MouseEvent): void {
    if (!this.metadataEditor.handleItemSelection(e, this)) this.showPropertyMenu(e)
  }
  focusKey(): void {
    if (this.metadataEditor.collapsed) this.metadataEditor.setCollapse(false, true)
    this.keyInputEl.focus()
  }
  focusProperty(): void {
    if (this.metadataEditor.collapsed) this.metadataEditor.setCollapse(false, true)
    this.containerEl.focus()
  }
  focusValue(mode: 'both' | 'start' | 'end' = 'both'): void {
    if (this.metadataEditor.collapsed) this.metadataEditor.setCollapse(false, true)
    this.rendered?.focus(mode)
  }

  showPropertyMenu(e: MouseEvent): void {
    e.preventDefault()
    const m = new Menu()
    m.addSections(['title', 'action', 'action.changeType', 'selection', 'clipboard', '', 'danger'])
    const tm = this.app.metadataTypeManager
    const canChange = !DEFAULT_KEYS.has(this.entry.key)
    m.setSectionSubmenu('action.changeType', { title: 'Property type', icon: 'lucide-info' })
    const assigned = tm.getAssignedWidget(this.entry.key)
    const isAssigned = !!assigned
    const inferred = this.typeInfo.inferred
    if (canChange)
      m.addItem(i =>
        i
          .setSection('action.changeType')
          .setIcon('lucide-loader')
          .setTitle(isAssigned ? 'Automatic' : `Automatic (${inferred.name()})`)
          .setChecked(!isAssigned)
          .onClick(() => {
            void tm.unsetType(this.entry.key)
            this.renderProperty(this.entry, true)
          })
      )
    for (const w of Object.values(tm.registeredTypeWidgets) as TypeWidget[]) {
      if (w.reservedKeys && !w.reservedKeys.includes(this.entry.key)) continue
      m.addItem(i =>
        i
          .setTitle(w.name())
          .setIcon(w.icon)
          .setSection('action.changeType')
          .setDisabled(!canChange)
          .setChecked(w.type === assigned)
          .onClick(() => {
            void tm.setType(this.entry.key, w.type)
            this.renderProperty(this.entry, true)
            if (this.entry.value != null && !w.validate(this.entry.value)) new TypeMismatchModal(this.app, this).open()
          })
      )
    }
    const exec = (cmd: string) => (document as any).execCommand?.(cmd)
    m.addItem(i => i.setTitle('Cut').setSection('clipboard').setIcon('lucide-scissors').onClick(() => exec('cut')))
    m.addItem(i => i.setTitle('Copy').setSection('clipboard').setIcon('lucide-copy').onClick(() => exec('copy')))
    m.addItem(i => i.setTitle('Paste').setSection('clipboard').setIcon('lucide-clipboard-check').onClick(() => void navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t))))
    m.addItem(i =>
      i
        .setTitle('Remove')
        .setWarning(true)
        .setSection('danger')
        .setIcon('lucide-trash-2')
        .onClick(() => this.metadataEditor.removeProperties([this]))
    )
    m.setParentElement(this.containerEl).showAtMouseEvent(e)
  }

  handleUpdateKey(key: string): boolean {
    const ed = this.metadataEditor
    if (key === '') {
      if (this.keyInputEl === this.keyInputEl.ownerDocument.activeElement) flashError(this.keyInputEl, 'Property name cannot be empty.')
      return false
    }
    if (this.entry.key !== key) {
      const dup = ed.rendered.find(r => r.entry.key.toLowerCase() === key.toLowerCase())
      if (dup && dup !== ed.focusedLine) {
        dup.containerEl.focus()
        flashError(this.keyInputEl, 'Property already exists')
        return false
      }
      this.entry.key = key
      this.containerEl.setAttr('data-property-key', key.toLowerCase())
      ed.save()
    }
    this.iconEl.setAttr('aria-disabled', 'false')
    return true
  }
  handleUpdateValue(v: any): void {
    if (this.entry.value === v) return
    if (v === '' || (Array.isArray(v) && v.length === 0)) v = Array.isArray(v) ? v : ''
    this.entry.value = v
    this.metadataEditor.save()
  }
  handlePropertyBlur(): void {
    ;(this.containerEl.ownerDocument.activeElement as HTMLElement | null)?.blur()
    this.focusProperty()
  }

  renderProperty(entry: Entry, force = false, useExpected = false): void {
    const prevType = this.typeInfo.inferred.type
    const prevValue = this.entry?.value
    this.entry = entry
    const info = (this.typeInfo = this.app.metadataTypeManager.getTypeInfo(entry.key, entry.value))
    const w = useExpected ? info.expected : info.inferred
    if (!force && (this.valueEl.contains(this.containerEl.ownerDocument.activeElement) || (this.valueEl.hasChildNodes() && prevValue === entry.value && prevType === info.inferred.type))) return
    setIcon(this.iconEl, info.expected.icon)
    const msg = `Type mismatch, expected ${info.expected.name()}`
    setTooltip(this.warningEl, msg)
    this.warningEl.setAttribute('aria-label', msg)
    this.warningEl.toggle(!useExpected && info.expected !== info.inferred)
    this.valueEl.empty()
    this.valueEl.setAttr('data-property-type', w.type)
    this.rendered = w.render(this.valueEl, entry.value, {
      app: this.app,
      key: entry.key,
      onChange: (v: any) => this.handleUpdateValue(v),
      sourcePath: this.metadataEditor.owner.getFile()?.path ?? '',
      blur: () => this.handlePropertyBlur(),
      hoverSource: this.metadataEditor.owner.getHoverSource()
    })
  }
}

function flashError(el: HTMLElement, msg: string): void {
  const tip = el.ownerDocument.body.createDiv({ cls: 'tooltip mod-error', text: msg })
  const r = el.getBoundingClientRect()
  tip.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px`
  setTimeout(() => tip.remove(), 2000)
}

/** Property-name autocomplete: the vault's known properties, filtered by the typed text. */
function attachKeySuggest(app: any, input: HTMLInputElement, editor: MetadataEditor, onSelect: (key: string) => void): void {
  let box: HTMLElement | null = null
  let sel = 0
  let items: string[] = []
  const close = () => {
    box?.remove()
    box = null
  }
  const open = () => {
    const q = input.value.trim().toLowerCase()
    const used = new Set(editor.properties.map(p => p.key.toLowerCase()))
    items = Object.values<any>(app.metadataTypeManager.getAllProperties() as Record<string, { name: string }>)
      .map(p => p.name)
      .filter(n => !used.has(n.toLowerCase()) && (!q || n.toLowerCase().includes(q)))
      .sort((a, b) => collator.compare(a, b))
      .slice(0, 50)
    if (!items.length) return close()
    if (!box) {
      box = input.ownerDocument.body.createDiv({ cls: 'suggestion-container mod-property-key' })
      box.createDiv('suggestion')
      const r = input.getBoundingClientRect()
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom}px;min-width:${r.width}px`
    }
    box.empty()
    const list = box.createDiv('suggestion')
    sel = Math.min(sel, items.length - 1)
    items.forEach((n, i) => {
      const it = list.createDiv({ cls: 'suggestion-item mod-complex' + (i === sel ? ' is-selected' : '') })
      const content = it.createDiv('suggestion-content')
      content.createDiv({ cls: 'suggestion-title', text: n })
      const aux = it.createDiv('suggestion-aux')
      setIcon(aux.createSpan('suggestion-flair'), app.metadataTypeManager.getWidget(app.metadataTypeManager.getPropertyInfo(n).widget).icon)
      it.addEventListener('mousedown', e => {
        e.preventDefault()
        close()
        onSelect(n)
      })
    })
  }
  input.addEventListener('input', () => ((sel = 0), open()))
  input.addEventListener('focus', () => ((sel = 0), open()))
  input.addEventListener('blur', close)
  input.addEventListener(
    'keydown',
    e => {
      if (!box) return
      if (e.key === 'ArrowDown') (e.preventDefault(), (sel = (sel + 1) % items.length), open())
      else if (e.key === 'ArrowUp') (e.preventDefault(), (sel = (sel - 1 + items.length) % items.length), open())
      else if (e.key === 'Enter' && items[sel] && input.value.trim() !== items[sel] && items[sel].toLowerCase().startsWith(input.value.trim().toLowerCase()) && input.value.trim()) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const n = items[sel]
        close()
        onSelect(n)
      } else if (e.key === 'Escape') close()
    },
    true
  )
}
