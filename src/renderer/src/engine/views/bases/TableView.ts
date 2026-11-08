/* eslint-disable @typescript-eslint/no-explicit-any */
// Table view: header (sort / resize / menu), virtualized rows with editable cells, grouping, summaries.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { BasesView } from './api'
import { bt } from './strings'
import { renderCell, propertyIcon } from './cells'
import { splitPropertyId } from './BaseConfig'
import { standardSummaries, valueClassOf } from './query'
import { NullValue, type Value } from './values'
import { createGroupHeadingEl, isGroupCollapsed } from './CardViews'
import type { QueryController } from './QueryController'
import type { BasesEntry } from './context'
import type { BasesEntryGroup } from './query'

const L = (k: string, v?: Record<string, string | number>): string => bt('plugins.bases.' + k, v)
const T = (k: string): string => bt('plugins.bases.table.' + k)
export const TABLE_VIEW_TYPE = 'table'
const ROW_HEIGHTS: Record<string, number> = { '': 30, short: 30, medium: 48, tall: 72, extra: 96 }
const OVERSCAN = 10

export class TableView extends BasesView {
  type = TABLE_VIEW_TYPE
  private headEl!: HTMLElement
  private containerEl2!: HTMLElement
  private footEl!: HTMLElement
  /** One block per group (reference `_7`): `.bases-table` > [heading] > `.bases-tbody`. */
  private groups: { group: BasesEntryGroup; tableEl: HTMLElement; tbodyEl: HTMLElement; selfHeight: number; childStart: number; painted: string }[] = []
  private cols: string[] = []
  private widths: number[] = []
  private rowH = 30
  private scrollHandler = (): void => this.paintWindow()

  constructor(controller: QueryController, public rootEl: HTMLElement) {
    super(controller)
  }

  onunload(): void {
    this.rootEl.empty()
  }

  private live: { prop: string; w: number } | null = null
  private width(prop: string): number | null {
    if (this.live && this.live.prop === prop) return this.live.w
    const sizes = this.config.get('columnSize')
    return sizes && typeof sizes[prop] === 'number' ? sizes[prop] : null
  }

  onDataUpdated(): void {
    const cfg = this.config
    const c = this.controller
    this.cols = cfg.getOrder()
    this.rowH = ROW_HEIGHTS[cfg.get('rowHeight') ?? ''] ?? 30
    const root = this.rootEl
    const prevScroll = this.rootEl.scrollTop
    root.empty()
    if (cfg.get('rowHeight')) root.setAttr('data-row-height', cfg.get('rowHeight'))
    root.setAttr('data-view-type', 'table')
    root.setAttr('data-view-name', (cfg as any).name ?? '')
    this.buildHeader(root)
    this.containerEl2 = root.createDiv({ cls: 'bases-table-container node-insert-event', attr: { tabindex: '0' } })
    this.containerEl2.toggleClass('mod-multiline', this.rowH > 30)
    this.buildGroups()
    root.removeEventListener('scroll', this.scrollHandler)
    this.measureColumns()
    this.paintWindow()
    root.scrollTop = prevScroll
    root.addEventListener('scroll', this.scrollHandler, { passive: true })
    this.buildFooter(root)
    void c
  }

  private buildHeader(root: HTMLElement): void {
    const cfg = this.config
    const c = this.controller
    this.headEl = root.createDiv('bases-thead')
    const tr = this.headEl.createDiv({ cls: 'bases-tr', attr: { 'data-ignore-swipe': 'true' } })
    this.cols.forEach(prop => {
      const { type } = splitPropertyId(prop)
      const td = tr.createDiv({ cls: 'bases-td' + (prop === 'file.name' ? ' mod-implicit' : '') + (type === 'formula' ? ' mod-formula' : '') })
      td.setAttr('draggable', 'true')
      const hd = td.createDiv('bases-table-header')
      const label = hd.createDiv('bases-table-header-label')
      setIcon(label.createDiv('bases-table-header-icon'), propertyIcon(c, prop))
      label.createDiv({ cls: 'bases-table-header-name', text: cfg.getDisplayName(prop) })
      const sortEl = td.createDiv('bases-table-header-sort')
      const s = cfg.getSort().find(x => x.property === prop)
      if (s) setIcon(sortEl, s.direction === 'ASC' ? 'lucide-chevron-up' : 'lucide-chevron-down')
      const rz = td.createDiv('bases-table-header-resizer')
      rz.setAttr('draggable', 'true')
      this.attachResize(rz, td, prop)
      hd.addEventListener('click', () => cfg.setSortProperty(prop, 'TOGGLE'))
      td.addEventListener('contextmenu', e => {
        e.preventDefault()
        this.headerMenu(e, prop)
      })
    })
  }
  private attachResize(handle: HTMLElement, td: HTMLElement, prop: string): void {
    handle.addEventListener('click', e => e.stopPropagation())
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = td.getBoundingClientRect().width
      let w = startW
      const move = (m: MouseEvent): void => {
        w = Math.max(40, Math.round(startW + m.clientX - startX))
        this.live = { prop, w }
        this.layout()
      }
      const up = (): void => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        this.live = null
        this.setColumnSize(prop, w)
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  }
  private setColumnSize(prop: string, w: number | null): void {
    const cfg = this.config
    const sizes = { ...(cfg.get('columnSize') || {}) }
    if (w === null) delete sizes[prop]
    else sizes[prop] = w
    cfg.set('columnSize', Object.keys(sizes).length ? sizes : null)
  }

  private headerMenu(e: MouseEvent, prop: string): void {
    const cfg = this.config
    const q = this.controller.query
    const m = new Menu()
    const { type, name } = splitPropertyId(prop)
    m.addItem(i => i.setTitle(T('actionSortAZ')).setIcon('lucide-arrow-up').onClick(() => cfg.setSortProperty(prop, 'ASC')))
    m.addItem(i => i.setTitle(T('actionSortZA')).setIcon('lucide-arrow-down').onClick(() => cfg.setSortProperty(prop, 'DESC')))
    m.addItem(i => i.setTitle(T('actionSortDefault')).setIcon('lucide-x').setDisabled(!cfg.getSort().some(s => s.property === prop)).onClick(() => cfg.setSortProperty(prop, 'NONE')))
    m.addSeparator()
    m.addItem(i => i.setTitle(T('actionHideColumn')).setIcon('lucide-eye-off').onClick(() => cfg.setOrder(cfg.getOrder().filter(p => p !== prop))))
    m.addItem(i => i.setTitle(type === 'formula' ? T('actionEditFormula') : T('actionEditProperty')).setIcon('lucide-pencil').onClick(() => {
      if (type === 'formula') this.controller.toolbar.openPropertyEdit(prop)
      else {
        const v = window.prompt(L('labelDisplayName'), q.getPropertyConfig(prop).displayName ?? cfg.getDisplayName(prop))
        if (v !== null) q.getPropertyConfig(prop).setDisplayName(v)
      }
    }))
    m.addItem(i => i.setTitle(T('actionGroupBy')).setIcon('lucide-stretch-horizontal').onClick(() => cfg.setGroupBy({ property: prop, direction: 'ASC' })))
    m.addSeparator()
    m.addItem(i => i.setTitle(T('actionResizeColumn')).setIcon('lucide-move-horizontal').onClick(() => {
      const v = window.prompt(T('actionResizeColumn'), String(this.width(prop) ?? 200))
      if (v !== null && Number(v) > 0) this.setColumnSize(prop, Math.round(Number(v)))
    }))
    m.addItem(i => i.setTitle(T('actionResetColumnSize')).setDisabled(this.width(prop) === null).onClick(() => this.setColumnSize(prop, null)))
    m.showAtMouseEvent(e)
  }

  // ------------------------------------------------------------------ rows
  private buildGroups(): void {
    this.groups = []
    for (const group of this.data.groupedData) {
      const tableEl = this.containerEl2.createDiv('bases-table')
      const heading = createGroupHeadingEl(this.controller, group, () => this.paintWindow(true))
      if (heading) tableEl.appendChild(heading)
      const tbodyEl = tableEl.createDiv('bases-tbody')
      this.groups.push({ group, tableEl, tbodyEl, selfHeight: 0, childStart: 0, painted: '' })
    }
    for (const g of this.groups) {
      const t = g.tableEl.getBoundingClientRect()
      const b = g.tbodyEl.getBoundingClientRect()
      g.selfHeight = t.height - b.height
      g.childStart = b.top - t.top
    }
  }

  /**
   * Column widths (reference `W7.getWidth`): a user width wins (at least the minimum); otherwise the wider of the
   * header label and the cell holding the longest value, +1, clamped to [min, max]. The last column fills the view.
   */
  private measureColumns(): void {
    const css = (name: string, d: number): number => parseFloat(getComputedStyle(this.containerEl2).getPropertyValue(name)) || d
    const min = css('--bases-table-column-min-width', 40)
    const max = css('--bases-table-column-max-width', 300)
    const headCells = Array.from(this.headEl.querySelectorAll(':scope > .bases-tr > .bases-td')) as HTMLElement[]
    const probeRow = this.groups[0]?.tbodyEl.createDiv('bases-tr')
    this.widths = this.cols.map((prop, i) => {
      const custom = this.width(prop)
      if (custom) return Math.max(min, custom)
      const header = (headCells[i]?.querySelector('.bases-table-header-label') as HTMLElement | null)?.scrollWidth ?? 0
      let longest: BasesEntry | null = null
      let text = ''
      for (const grp of this.data.groupedData) for (const e of grp.entries) {
        try {
          const v = String((e.getValue(prop) as any)?.toString?.() ?? '')
          if (v.length > text.length) { text = v; longest = e }
        } catch { /* formula errors do not size columns */ }
      }
      let content = 0
      if (longest && probeRow) {
        const td = probeRow.createDiv({ cls: 'bases-td is-measuring', attr: { 'data-property': prop } })
        td.style.contain = 'strict'
        renderCell(this.controller, longest, prop, td, true)
        content = (td.firstElementChild as HTMLElement | null)?.scrollWidth ?? 0
      }
      return Math.min(max, Math.max(min, Math.max(content, header) + 1))
    })
    probeRow?.remove()
    const lastCustom = this.cols.length ? this.width(this.cols[this.cols.length - 1]) : null
    const avail = (this.containerEl2.parentElement?.clientWidth ?? 0) - 1
    const total = this.widths.reduce((a, b) => a + b, 0)
    if (!lastCustom && this.cols.length && total < avail) this.widths[this.widths.length - 1] += avail - total
  }

  /** Lays out the group blocks and paints the visible rows of each (reference `updateVirtualDisplay`). */
  private paintWindow(force = false): void {
    if (!this.containerEl2) return
    const H = this.rowH
    const gap = parseFloat(getComputedStyle(this.containerEl2).getPropertyValue('--bases-table-group-gap')) || 10
    const total = this.widths.reduce((a, b) => a + b, 0)
    const scroll = this.rootEl
    const viewTop = scroll.scrollTop - this.containerEl2.offsetTop - OVERSCAN * H
    const viewBottom = scroll.scrollTop + (scroll.clientHeight || 600) - this.containerEl2.offsetTop + OVERSCAN * H
    let y = 0
    this.groups.forEach((g, j) => {
      const collapsed = isGroupCollapsed(this.controller, g.group)
      g.tableEl.toggleClass('is-collapsed', collapsed)
      const entries = g.group.entries
      const start = y + g.childStart
      const height = collapsed ? 0 : entries.length * H
      g.tableEl.style.top = y + 'px'
      g.tableEl.style.width = total + 'px'
      g.tbodyEl.style.height = height + 'px'
      g.tbodyEl.style.setProperty('--bases-table-row-height', H + 'px')
      const first = collapsed ? 0 : Math.max(0, Math.floor(Math.max(viewTop - start, 0) / H))
      const last = collapsed ? 0 : entries.length - Math.max(0, Math.floor(Math.max(start + height - viewBottom, 0) / H))
      const key = `${first}:${last}:${total}`
      if (force || g.painted !== key) {
        g.painted = key
        g.tbodyEl.empty()
        for (let i = first; i < last; i++) this.paintRow(g.tbodyEl, entries[i], i, total)
      }
      y += g.selfHeight + height
      if (j < this.groups.length - 1) y += gap
    })
    this.headEl.style.width = total + 'px'
    this.containerEl2.style.width = total + 'px'
    this.containerEl2.style.height = y + 'px'
    const head = Array.from(this.headEl.querySelectorAll(':scope > .bases-tr > .bases-td')) as HTMLElement[]
    this.place(head)
  }

  private place(tds: HTMLElement[]): void {
    let x = 0
    tds.forEach((td, i) => {
      const w = this.widths[i] ?? 0
      td.style.insetInlineStart = x + 'px'
      td.style.width = w + 'px'
      x += w
    })
  }

  /** Live column resize: recompute widths and repaint every visible row. */
  private layout(): void {
    this.measureColumns()
    this.paintWindow(true)
  }

  private paintRow(body: HTMLElement, entry: BasesEntry, index: number, total: number): void {
    const tr = body.createDiv({ cls: 'bases-tr', attr: { 'data-path': entry.file.path } })
    tr.style.top = index * this.rowH + 'px'
    tr.style.width = total + 'px'
    const tds: HTMLElement[] = []
    for (const prop of this.cols) {
      const td = tr.createDiv({ cls: 'bases-td', attr: { 'data-property': prop } })
      renderCell(this.controller, entry, prop, td, true)
      tds.push(td)
    }
    this.place(tds)
    tr.addEventListener('contextmenu', e => {
      if ((e.target as HTMLElement).closest('input, [contenteditable]')) return
      e.preventDefault()
      const m = new Menu()
      this.controller.app.workspace.trigger('file-menu', m, entry.file, 'bases-view')
      m.showAtMouseEvent(e)
    })
  }

  // ------------------------------------------------------------------ summaries
  private buildFooter(root: HTMLElement): void {
    const cfg = this.config
    const q = this.controller.query
    if (!this.cols.some(p => cfg.getSummaryKey(p))) return
    this.footEl = root.createDiv('bases-table-footer bases-tr')
    for (const prop of this.cols) {
      const td = this.footEl.createDiv('bases-td')
      const cell = td.createDiv('bases-table-summary-cell')
      setIcon(cell.createDiv('summary-expand-button'), 'lucide-chevrons-up-down')
      const content = cell.createDiv('summary-content')
      const key = cfg.getSummaryKey(prop)
      if (key) {
        const val = this.data.getSummaryValue(this.controller, this.data.data, prop, key)
        content.createDiv({ cls: 'summary-function-name', text: key })
        const vEl = content.createDiv('summary-function-value')
        if (!(val instanceof NullValue)) val.renderTo(vEl, this.controller.renderCtx)
      } else content.createSpan({ cls: 'placeholder', text: T('labelSummary') })
      cell.addEventListener('click', e => {
        const m = new Menu()
        const type = valueClassOf(this.data.data.map(en => en.getValue(prop) as Value))
        for (const k of Object.keys(standardSummaries(type))) m.addItem(i => i.setTitle(k).setChecked(key === k).onClick(() => cfg.setSummaryKey(prop, k)))
        for (const k of Object.keys(q.summaryFormulas || {})) m.addItem(i => i.setTitle(k).setChecked(key === k).onClick(() => cfg.setSummaryKey(prop, k)))
        m.addSeparator()
        m.addItem(i => i.setTitle(bt('plugins.bases.buttonHideSummary')).setDisabled(!key).onClick(() => cfg.setSummaryKey(prop, null)))
        m.showAtMouseEvent(e)
      })
    }
  }

  /** `bases:copy-table`. */
  copyTable(): string {
    const cfg = this.config
    const props = cfg.getOrder()
    const lines = [props.map(p => cfg.getDisplayName(p)).join('\t')]
    for (const e of this.data.data) lines.push(props.map(p => String((e.getValue(p) as any)?.toString?.() ?? '')).join('\t'))
    return lines.join('\n')
  }
}
