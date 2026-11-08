/* eslint-disable @typescript-eslint/no-explicit-any */
// Hotkeys tab (id `hotkeys`): filter box (+ press-a-hotkey filter),
// status filters, per-command chips with delete / restore default / customize (record), conflicts.
// Writes `<configDir>/hotkeys.json` through app.hotkeyManager.
import { t } from '../i18n'
import { BuiltinTab } from '../util'
import { Keymap, printHotkey, getEventVKey, type Hotkey } from '../../keymap'
import { prepareSimpleSearch, setIcon, setTooltip } from '../../ui'

type Filter = 'all' | 'conflicts' | 'assigned' | 'user' | 'unassigned'
const H = 'setting.hotkeys.'

const norm = (hk: Hotkey): string => printHotkey(hk).toLowerCase()
const same = (a: Hotkey, b: Hotkey): boolean => norm(a) === norm(b)

export class HotkeysTab extends BuiltinTab {
  query = ''
  filter: Filter = 'all'
  private hotkeyFilter: Hotkey | null = null
  private recording: { id: string; stop: () => void } | null = null
  private listEl!: HTMLElement
  private filterEls: Partial<Record<Filter, HTMLElement>> = {}
  private conflicts = new Map<string, string[]>()

  constructor(app: any) {
    super(app, 'hotkeys', t(H + 'name'), 'command')
  }

  /** Used by the core-plugins tab ("Hotkeys" button): show only a plugin's commands. */
  setQuery(q: string): this {
    this.query = q
    return this
  }

  getSettingDefinitions(): any[] {
    return []
  }

  hide(): void {
    this.stopRecording()
    super.hide()
  }

  display(): void {
    const el = this.containerEl
    el.empty()
    const group = el.createDiv('setting-group mod-list mod-hotkeys')
    const search = group.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } })
    const sc = search.createDiv('search-input-container mod-hotkey')
    const input = sc.createEl('input', { type: 'search', attr: { enterkeyhint: 'search', spellcheck: 'false', placeholder: t('interface.promptFilter') } })
    sc.createDiv('search-input-clear-button').addEventListener('click', () => {
      input.value = ''
      this.query = ''
      this.hotkeyFilter = null
      this.renderList()
    })
    const dec = sc.createDiv('input-right-decorator clickable-icon')
    setIcon(dec, 'lucide-keyboard')
    input.value = this.query
    input.addEventListener('input', () => {
      this.query = input.value
      this.hotkeyFilter = null
      this.renderList()
    })
    dec.addEventListener('click', () => {
      input.value = ''
      input.placeholder = t(H + 'labelWaitingForHotkeyPress')
      this.filterRecording = true
      const onKey = (e: KeyboardEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') {
          done()
          return
        }
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
        this.hotkeyFilter = { modifiers: Keymap.decompileModifiers(Keymap.getModifiers(e)), key: getEventVKey(e) } as Hotkey
        input.value = printHotkey(this.hotkeyFilter)
        done()
        this.renderList()
      }
      const done = (): void => {
        input.placeholder = t('interface.promptFilter')
        this.filterRecording = false
        window.removeEventListener('keydown', onKey, true)
      }
      window.addEventListener('keydown', onKey, true)
    })

    const ctl = search.createDiv('setting-group-search-control')
    const filters = ctl.createDiv('setting-group-filters')
    const mk = (f: Filter, label: string, cls = ''): void => {
      const fe = filters.createDiv({ cls: ['setting-group-filter', cls].filter(Boolean).join(' '), attr: { tabindex: '0' } })
      if (f === 'conflicts') {
        fe.createSpan({ text: label })
        fe.createSpan({ cls: 'setting-group-filter-badge', text: '0' })
      } else fe.setText(label)
      const activate = (): void => {
        this.filter = f
        this.renderList()
      }
      fe.addEventListener('click', activate)
      fe.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') activate()
      })
      this.filterEls[f] = fe
    }
    mk('conflicts', t(H + 'labelShowConflicts'), 'mod-error')
    mk('all', t(H + 'labelShowAll'))
    mk('assigned', t(H + 'labelShowAssigned'))
    mk('user', t(H + 'labelShowUserAssigned'))
    mk('unassigned', t(H + 'labelShowUnassigned'))
    this.listEl = group.createDiv('setting-items')
    this.renderList()
  }

  private get hm(): any {
    return this.app.hotkeyManager
  }

  private effective(id: string): Hotkey[] {
    return this.hm.getEffectiveHotkeys(id)
  }

  private recomputeConflicts(cmds: any[]): void {
    const by = new Map<string, string[]>()
    for (const c of cmds) for (const hk of this.effective(c.id)) {
      const k = norm(hk)
      by.set(k, [...(by.get(k) ?? []), c.id])
    }
    this.conflicts = new Map([...by].filter(([, ids]) => new Set(ids).size > 1))
  }

  private renderList(): void {
    this.stopRecording()
    const cmds: any[] = Object.values(this.app.commands.commands as Record<string, any>).sort((a: any, b: any) => a.name.localeCompare(b.name))
    this.recomputeConflicts(cmds)
    const conflictCmds = new Set<string>()
    for (const ids of this.conflicts.values()) ids.forEach(i => conflictCmds.add(i))
    const badge = this.filterEls.conflicts?.querySelector('.setting-group-filter-badge')
    badge?.setText(String(conflictCmds.size))
    this.filterEls.conflicts?.toggle(conflictCmds.size > 0)
    for (const [f, el] of Object.entries(this.filterEls)) el!.toggleClass('is-active', f === this.filter)
    const search = this.query.trim() && !this.hotkeyFilter ? prepareSimpleSearch(this.query.trim()) : null
    this.listEl.empty()
    let shown = 0
    for (const c of cmds) {
      const eff = this.effective(c.id)
      const custom = this.hm.getHotkeys(c.id) !== undefined
      if (search && !search(c.name) && !search(c.id)) continue
      if (this.hotkeyFilter && !eff.some((h: Hotkey) => same(h, this.hotkeyFilter!))) continue
      if (this.filter === 'conflicts' && !conflictCmds.has(c.id)) continue
      if (this.filter === 'assigned' && eff.length === 0) continue
      if (this.filter === 'user' && !custom) continue
      if (this.filter === 'unassigned' && eff.length > 0) continue
      shown++
      this.renderRow(c)
    }
    if (!shown) this.listEl.createDiv({ cls: 'setting-item mod-empty-state', text: t(H + 'labelNoResultsFound') })
  }

  private renderRow(c: any): void {
    const row = this.listEl.createDiv('setting-item')
    const info = row.createDiv('setting-item-info')
    info.createDiv({ cls: 'setting-item-name', text: c.name })
    info.createDiv('setting-item-description')
    const ctl = row.createDiv('setting-item-control')
    const chips = ctl.createDiv('setting-command-hotkeys')
    const eff = this.effective(c.id)
    const custom = this.hm.getHotkeys(c.id) !== undefined
    if (!eff.length) chips.createSpan({ cls: 'setting-hotkey mod-empty', text: t(H + 'labelBlankHotkey') })
    eff.forEach((hk: Hotkey, i: number) => {
      const conflict = this.conflicts.get(norm(hk))
      const chip = chips.createSpan({ cls: 'setting-hotkey' + (conflict ? ' has-conflict' : ''), text: ' ' + printHotkey(hk) + ' ' })
      if (conflict) {
        const others = [...new Set(conflict)].filter(id => id !== c.id)
        setTooltip(chip, others.length === 1 ? t(H + 'tooltipHotkeySingleConflict', { command: this.app.commands.findCommand(others[0])?.name ?? others[0] }) : t(H + 'tooltipHotkeyMultipleConflicts', { count: others.length }))
        chip.addEventListener('click', () => {
          this.hotkeyFilter = hk
          this.renderList()
        })
      }
      const del = chip.createSpan({ cls: 'setting-hotkey-icon setting-delete-hotkey', attr: { 'aria-label': t(H + 'tooltipDeleteHotkey') } })
      setIcon(del, 'lucide-x')
      del.addEventListener('click', e => {
        e.stopPropagation()
        const list = eff.filter((_: Hotkey, j: number) => j !== i)
        if (!list.length && this.hm.getDefaultHotkeys(c.id) === undefined) this.hm.removeHotkeys(c.id)
        else this.hm.setHotkeys(c.id, list)
        void this.hm.save()
        this.renderList()
      })
    })
    if (custom) {
      const restore = ctl.createSpan({ cls: 'clickable-icon setting-restore-hotkey-button', attr: { 'aria-label': t(H + 'tooltipRestoreDefault') } })
      setIcon(restore, 'lucide-rotate-ccw')
      restore.addEventListener('click', () => {
        this.hm.removeHotkeys(c.id)
        void this.hm.save()
        this.renderList()
      })
    }
    const add = ctl.createSpan({ cls: 'clickable-icon setting-add-hotkey-button', attr: { 'aria-label': t(H + 'tooltipCustomizeCommand') } })
    setIcon(add, 'lucide-plus-circle')
    add.addEventListener('click', () => this.startRecording(c, chips, add))
  }

  /** True while "Press hotkey..." is shown (Escape cancels the recording instead of closing settings). */
  get isCapturingKeys(): boolean {
    return !!this.recording || this.filterRecording
  }
  private filterRecording = false

  private startRecording(c: any, chips: HTMLElement, add: HTMLElement): void {
    this.stopRecording()
    add.hide()
    const live = chips.createSpan({ cls: 'setting-hotkey mod-active', text: t(H + 'labelWaitingForHotkeyPress') })
    const onKey = (e: KeyboardEvent): void => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return this.renderList()
      const mods = Keymap.decompileModifiers(Keymap.getModifiers(e))
      const key = getEventVKey(e)
      const isF = /^F([1-9]|1\d|2[0-4])$/.test(key)
      if (!mods.length && !isF) return
      if (mods.length === 1 && mods[0] === 'Shift' && key.length === 1) return
      const hk = { modifiers: mods, key } as Hotkey
      const cur = this.hm.getHotkeys(c.id) ?? this.hm.getDefaultHotkeys(c.id) ?? []
      if (!cur.some((h: Hotkey) => same(h, hk))) this.hm.setHotkeys(c.id, [...cur, hk])
      void this.hm.save()
      this.renderList()
    }
    window.addEventListener('keydown', onKey, true)
    this.recording = { id: c.id, stop: () => (window.removeEventListener('keydown', onKey, true), live.detach(), add.show()) }
  }

  private stopRecording(): void {
    this.recording?.stop()
    this.recording = null
  }
}
