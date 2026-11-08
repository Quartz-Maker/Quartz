/* eslint-disable @typescript-eslint/no-explicit-any */
// `SettingTab`, `PluginSettingTab`, `SettingPage` (plugin API). The settings window itself is
// `app.setting` (settings/SettingsManager.ts, a Modal); it appends `tab.containerEl` and calls
// `tab.display()` / `tab.hide()`. Declarative `getSettingDefinitions()` is rendered here with the
// ui/ Setting components (DOM: `.setting-group > .setting-items > .setting-item`).
import { Combobox } from '../views/bases/combobox'
import { Setting, SettingGroup, type SliderComponent } from '../ui/setting'
import { setIcon } from '../ui/icons'
import { AbstractInputSuggest } from '../ui/suggest'
import { t } from '../settings/i18n'

/** A sub-page inside a settings tab (`.setting-page.vertical-tab-content`). */
export abstract class SettingPage {
  rootEl: HTMLElement
  titlebarEl: HTMLElement
  backButtonEl: HTMLElement
  titleEl: HTMLElement
  containerEl: HTMLElement
  title = ''
  /** Set by app.setting while the page is on screen. */
  settingManager: any = null

  constructor(title = '') {
    this.title = title
    this.rootEl = createDiv('setting-page vertical-tab-content')
    this.titlebarEl = this.rootEl.createDiv('setting-page-titlebar')
    this.backButtonEl = this.titlebarEl.createDiv('clickable-icon setting-page-back-button')
    setIcon(this.backButtonEl, 'lucide-chevron-left')
    this.titleEl = this.titlebarEl.createDiv({ cls: 'setting-page-title', text: title })
    this.containerEl = this.rootEl.createDiv('setting-page-content')
    this.backButtonEl.addEventListener('click', () => this.settingManager?.closePage?.())
  }
  abstract display(): void
  hide(): void {
    this.containerEl.empty()
  }
}

/** A page whose content is a list of setting definitions. */
class DefinitionPage extends SettingPage {
  constructor(title: string, private render: (el: HTMLElement) => void) {
    super(title)
  }
  display(): void {
    this.containerEl.empty()
    this.render(this.containerEl)
  }
}

export abstract class SettingTab {
  icon = ''
  app: any
  containerEl: HTMLElement
  settingItems: any[] = []
  /** Display name in the settings sidebar. */
  name = ''
  id = ''
  /** Rendered definition -> its DOM row (used by search to scroll to / flash an item). */
  defEls = new Map<any, HTMLElement>()

  constructor(app?: any) {
    this.app = app
    this.containerEl = createDiv('vertical-tab-content')
  }

  getSettingDefinitions(): any[] {
    return []
  }
  update(): void {
    this.settingItems = this.getSettingDefinitions() || []
  }
  getControlValue(key: string): unknown {
    return this.app?.vault?.getConfig?.(key)
  }
  setControlValue(key: string, value: unknown): void | Promise<void> {
    this.app?.vault?.setConfig?.(key, value)
  }
  /** Re-evaluates `visible` predicates in place. */
  refreshDomState(): void {
    for (const v of this.visibles) v.el.toggle(!!this.ev(v.def.visible))
  }
  isDisplayed = false
  private visibles: { def: any; el: HTMLElement }[] = []

  /** Imperative fallback; declarative tabs render from `getSettingDefinitions()`. */
  display(): void {
    const defs = this.getSettingDefinitions()
    if (!defs || !defs.length) return
    this.settingItems = defs
    this.containerEl.empty()
    this.defEls.clear()
    this.visibles = []
    this.renderDefinitions(defs, this.containerEl)
    this.isDisplayed = true
  }
  hide(): void {
    this.containerEl.empty()
    this.isDisplayed = false
  }

  protected ev<T>(v: T | (() => T)): T {
    return typeof v === 'function' ? (v as any)() : v
  }

  renderDefinitions(defs: any[], parent: HTMLElement): void {
    let loose: SettingGroup | null = null
    for (const def of defs) {
      if (def.type === 'group' || def.type === 'list') {
        loose = null
        const group = new SettingGroup(parent)
        this.trackVisible(def, group.groupEl)
        if (def.type === 'list') group.addClass('mod-list')
        if (def.heading) group.setHeading(def.heading)
        if (def.cls) group.addClass(...String(def.cls).split(' '))
        for (const b of def.extraButtons || []) group.addExtraButton(b)
        // items may be a function, re-read on every render (lists that change, e.g. CSS snippets)
        const items: any[] = (typeof def.items === 'function' ? def.items() : def.items) || []
        if (def.type === 'list' && !items.some(it => it.icon)) group.addClass('mod-no-icon')
        let rows: Setting[] = []
        if (def.search && items.length) {
          group.addSearch(sc => {
            sc.setPlaceholder(def.search.placeholder ?? '')
            sc.onChange(q => {
              const query = q.trim().toLowerCase()
              items.forEach((it, i) => {
                const row = rows[i]
                if (!row) return
                const ok = !query || (def.search.match ? def.search.match(it, query) : String(it.name ?? '').toLowerCase().includes(query) || String(typeof it.desc === 'string' ? it.desc : '').toLowerCase().includes(query))
                row.settingEl.toggle(!!ok)
              })
            })
          })
        }
        if (!items.length && def.emptyState) group.addSetting(s => (s.setClass('mod-empty-state'), s.nameEl.empty(), s.nameEl.append(typeof def.emptyState === 'string' ? document.createTextNode(def.emptyState) : def.emptyState)))
        items.forEach((it: any, i: number) => {
          group.addSetting(s => {
            rows[i] = s
            this.trackVisible(it, s.settingEl)
            if (it.type === 'page') this.renderPage(s, it)
            else {
              this.renderSetting(s, it, group, i, def)
              if (def.type === 'list') s.setIcon(it.icon ?? null) // list rows always carry an icon cell (hidden in mod-no-icon groups)
              else if (it.icon) s.setIcon(it.icon)
              if (def.onDelete) s.addExtraButton(b => b.setIcon('lucide-x').setTooltip(t('dialogue.buttonDelete')).onClick(() => def.onDelete(i)))
              if (def.onReorder)
                s.addExtraButton(b => {
                  b.setIcon('lucide-menu').setTooltip(t('interface.dragToRearrange'))
                  b.extraSettingsEl.addClass('mod-drag-handle')
                  b.extraSettingsEl.tabIndex = -1
                  b.extraSettingsEl.addEventListener('pointerdown', e => dragReorder(e, s.settingEl, (from, to) => def.onReorder(from, to)))
                })
            }
          })
        })
        if (def.addItem) group.addExtraButton(b => b.setIcon('lucide-plus').setTooltip(def.addItem.name).onClick(() => def.addItem.action(group.groupEl)))
      } else {
        if (!loose) loose = new SettingGroup(parent)
        const g = loose
        g.addSetting(s => {
          this.trackVisible(def, s.settingEl)
          if (def.type === 'page') this.renderPage(s, def)
          else this.renderSetting(s, def, g, 0)
        })
      }
    }
  }

  private trackVisible(def: any, el: HTMLElement): void {
    if (def.visible === undefined) return
    this.visibles.push({ def, el })
    el.toggle(!!this.ev(def.visible))
  }

  private renderPage(s: Setting, def: any): void {
    s.setName(def.name ?? '')
    if (def.desc) s.setDesc(def.desc)
    const status = def.status !== undefined ? this.ev(def.status) : null
    const value = def.displayValue !== undefined ? String(this.ev(def.displayValue) ?? '') : null
    if (value) s.addDisplayValue(c => (c.setValue(value), status && c.setStatus(status)))
    s.setNavigable(() => {
      const mgr = this.app?.setting
      const page: SettingPage = def.page ? def.page() : new DefinitionPage(def.name, el => this.renderDefinitions((typeof def.items === 'function' ? def.items() : def.items) || [], el))
      mgr?.openPage?.(page)
    })
    this.defEls.set(def, s.settingEl)
  }

  private renderSetting(s: Setting, def: any, group: SettingGroup, index: number, parentDef?: any): void {
    this.defEls.set(def, s.settingEl)
    s.setName(def.name ?? '')
    if (def.desc) s.setDesc(def.desc)
    if (def.cls) s.setClass(def.cls)
    if (def.render) {
      def.render(s, group)
      return
    }
    if (def.action) {
      const action = (): void => def.action(s.settingEl, index)
      if (parentDef?.type === 'list' || def.mod === 'action') s.setAction(action)
      else s.addButton(b => b.setButtonText(def.buttonText ?? def.name).onClick(action))
      return
    }
    const c = def.control
    if (!c) return
    const set = async (v: any): Promise<void> => {
      if (c.validate) {
        const err = await c.validate(v)
        if (typeof err === 'string' && err) {
          s.setErrorMessage(err)
          return
        }
        s.setErrorMessage(null)
      }
      await this.setControlValue(c.key, v)
      this.refreshDomState()
    }
    const cur: any = this.getControlValue(c.key) ?? c.defaultValue
    const disabled = !!this.ev(c.disabled)
    const addRestore = (get: () => any, apply: (v: any) => void): (() => void) => {
      if (c.defaultValue === undefined) return () => {}
      let sync = (): void => {}
      s.addExtraButton(b => {
        b.setIcon('lucide-rotate-ccw').setTooltip(t('setting.hotkeys.tooltipRestoreDefault'))
        sync = (): void => {
          const same = JSON.stringify(get()) === JSON.stringify(c.defaultValue)
          b.extraSettingsEl.setAttribute('aria-disabled', String(same))
        }
        b.onClick(() => {
          apply(c.defaultValue)
          sync()
        })
        s.controlEl.addEventListener('input', () => sync())
        s.controlEl.addEventListener('change', () => sync())
      })
      return () => sync()
    }
    switch (c.type) {
      case 'toggle':
        s.addToggle(tg => tg.setValue(!!cur).setDisabled(disabled).onChange(set))
        break
      case 'dropdown':
        s.addDropdown(d => d.addOptions(c.options).setValue(String(cur ?? '')).setDisabled(disabled).onChange(set))
        break
      case 'textarea':
        s.addTextArea(ta => {
          ta.setValue(String(cur ?? '')).onChange(set)
          if (c.placeholder) ta.setPlaceholder(c.placeholder)
          if (c.rows) ta.inputEl.rows = c.rows
        })
        break
      case 'number':
        s.addText(tx => {
          tx.setValue(cur === undefined || cur === null ? '' : String(cur))
          tx.inputEl.type = 'number'
          tx.inputEl.inputMode = 'decimal'
          tx.inputEl.step = 'any'
          if (c.min != null) tx.inputEl.min = String(c.min)
          if (c.max != null) tx.inputEl.max = String(c.max)
          if (c.placeholder) tx.setPlaceholder(c.placeholder)
          tx.inputEl.addEventListener('change', () => {
            const raw = tx.inputEl.value.trim()
            if (raw === '') {
              s.setErrorMessage(null)
              return void set(undefined)
            }
            const n = Number(raw)
            if (!Number.isFinite(n)) return void s.setErrorMessage(t('setting.msgInvalidNumber'))
            if (c.min != null && n < c.min) return void s.setErrorMessage(t('setting.msgValueAtLeast', { min: c.min }))
            if (c.max != null && n > c.max) return void s.setErrorMessage(t('setting.msgValueAtMost', { max: c.max }))
            s.setErrorMessage(null)
            void set(n)
          })
        })
        break
      case 'slider': {
        let sl!: SliderComponent
        const sync = addRestore(() => sl.getValue(), v => sl.setValue(v))
        s.addSlider(x => {
          sl = x
          x.setLimits(c.min, c.max, c.step).setValue(Number(cur ?? c.defaultValue ?? c.min)).setDynamicTooltip().onChange(set)
          if (c.displayFormat) x.setDisplayFormat(c.displayFormat)
        })
        sync()
        break
      }
      case 'color': {
        let cp: any
        const sync = addRestore(() => cp.getValue(), v => (cp.setValue(v), set(v)))
        s.addColorPicker(x => {
          cp = x
          x.setValue(String(cur ?? '#000000')).onChange(set)
        })
        sync()
        s.setClass('mod-toggle')
        break
      }
      case 'file':
        this.renderFileControl(s, cur, set, c)
        break
      case 'folder':
        s.addText(tx => {
          // the vault root ("/") shows as an empty field with the placeholder
          tx.setValue(cur === '/' ? '' : String(cur ?? '')).onChange(set)
          if (c.placeholder) tx.setPlaceholder(c.placeholder)
          new FolderInputSuggest(this.app, tx.inputEl).onSelect(f => {
            tx.setValue(f)
            void set(f)
          })
        })
        break
      default:
        s.addText(tx => {
          tx.setValue(String(cur ?? '')).onChange(set)
          if (c.placeholder) tx.setPlaceholder(c.placeholder)
        })
    }
  }

  private renderFileControl(s: Setting, cur: any, set: (v: any) => any, c: any): void {
    renderFileCombobox(this.app, s.controlEl, cur, set, c)
  }
}

/** `.combobox-button.mod-file` file chooser: a clearable combobox listing vault files
 *  (shown without ".md"), label split into folder / name parts, a "?" icon when the stored path no longer exists.
 *  Stores the chosen file's path. */
export function renderFileCombobox(app: any, controlEl: HTMLElement, cur: any, set: (v: any) => any, c: any = {}): HTMLElement {
  const display = (path: string): string => path.replace(/\.md$/, '')
  const box = new (class extends Combobox {
    setValue(item: any): this {
      super.setValue(item)
      this.labelEl.empty()
      if (item) {
        const parts = String(item.display ?? item.value).split('/')
        const name = parts.pop()
        parts.forEach((d, i) => {
          this.labelEl.createSpan({ cls: i === 0 ? 'file-combobox-dir mod-first' : 'file-combobox-dir', text: d })
          this.labelEl.createSpan({ cls: 'file-combobox-sep', text: '/' })
        })
        this.labelEl.createSpan({ cls: 'file-combobox-name', text: name })
      }
      return this
    }
    getItems(): any[] {
      return app.vault
        .getFiles()
        .filter((f: any) => !c.filter || c.filter(f))
        .map((f: any) => ({ value: f.path, display: display(f.path) }))
    }
  })(app, controlEl)
  box.buttonEl.addClass('mod-file')
  box.setClearable(true)
  box.setPlaceholder(c.placeholder ?? t('setting.noFilePlaceholder'))
  const path = String(cur ?? '')
  if (path) {
    const f = app.vault.getFileByPath?.(path)
    box.setValue(f ? { value: f.path, display: display(f.path) } : { value: path, display: display(path), icon: 'lucide-file-question' })
  } else box.setValue(null)
  box.onSelect(item => void set(item?.value ?? ''))
  return box.buttonEl
}

/** Suggests vault folder paths for `control: {type:'folder'}` inputs. */
class FolderInputSuggest extends AbstractInputSuggest<string> {
  constructor(private vaultApp: any, el: HTMLInputElement) {
    super(vaultApp, el)
  }
  protected getSuggestions(q: string): string[] {
    const lq = q.toLowerCase()
    return this.vaultApp.vault
      .getAllFolders(true)
      .map((f: any) => f.path)
      .filter((p: string) => p.toLowerCase().includes(lq))
  }
  renderSuggestion(v: string, el: HTMLElement): void {
    el.setText(v || '/')
  }
}

export abstract class PluginSettingTab extends SettingTab {
  plugin: any
  constructor(app: any, plugin: any) {
    super(app)
    this.plugin = plugin
    this.name = plugin?.manifest?.name ?? ''
    this.id = plugin?.manifest?.id ?? ''
  }
  getControlValue(key: string): unknown {
    return this.plugin?.settings?.[key]
  }
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!this.plugin.settings) this.plugin.settings = {}
    this.plugin.settings[key] = value
    await this.plugin.saveData(this.plugin.settings)
  }
}

/** Shows a tab: declarative definitions render through the base class, otherwise `display()`. */
export function displayTab(tab: SettingTab): void {
  let defs: any[] = []
  try {
    defs = tab.getSettingDefinitions?.() || []
  } catch (e) {
    console.error(e)
  }
  tab.containerEl.empty()
  if (defs.length) SettingTab.prototype.display.call(tab)
  else tab.display()
}

export { SettingsManager } from '../settings/SettingsManager'

/** Drag a list row by its handle; on drop calls `done(fromIndex, toIndex)` (drag-to-rearrange lists). */
function dragReorder(evt: PointerEvent, rowEl: HTMLElement, done: (from: number, to: number) => void): void {
  if (evt.button !== 0) return
  evt.preventDefault()
  const listEl = rowEl.parentElement
  if (!listEl) return
  const rows = (): HTMLElement[] => Array.from(listEl.children).filter(c => c.classList.contains('setting-item')) as HTMLElement[]
  const from = rows().indexOf(rowEl)
  const doc = rowEl.ownerDocument
  const box = rowEl.getBoundingClientRect()
  const ghost = doc.body.createDiv('drag-reorder-ghost')
  const clone = rowEl.cloneNode(true) as HTMLElement
  clone.addClass('mod-dragged-item')
  ghost.appendChild(clone)
  Object.assign(ghost.style, { position: 'fixed', left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', pointerEvents: 'none', zIndex: 'var(--layer-dragged-item)' })
  const dy = evt.clientY - box.top
  rowEl.addClass('is-being-dragged')
  doc.body.addClass('is-grabbing')
  const move = (e: PointerEvent): void => {
    ghost.style.top = e.clientY - dy + 'px'
    for (const r of rows()) {
      if (r === rowEl) continue
      const b = r.getBoundingClientRect()
      if (e.clientY > b.top && e.clientY < b.bottom) {
        if (e.clientY < b.top + b.height / 2) listEl.insertBefore(rowEl, r)
        else listEl.insertBefore(rowEl, r.nextSibling)
        break
      }
    }
  }
  const up = (): void => {
    doc.removeEventListener('pointermove', move)
    doc.removeEventListener('pointerup', up)
    ghost.remove()
    rowEl.removeClass('is-being-dragged')
    doc.body.removeClass('is-grabbing')
    const to = rows().indexOf(rowEl)
    if (to !== from && from >= 0) done(from, to)
  }
  doc.addEventListener('pointermove', move)
  doc.addEventListener('pointerup', up)
}
