/* eslint-disable @typescript-eslint/no-explicit-any */
// Cards, list and kanban views.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { BasesView } from './api'
import { bt } from './strings'
import { renderValue } from './cells'
import { groupKeyToFrontmatter } from './newItem'
import { textIconButton } from './render'
import { splitPropertyId } from './BaseConfig'
import { NullValue, NULL, ListValue, type Value } from './values'
import type { QueryController } from './QueryController'
import type { BasesEntry } from './context'
import type { BasesEntryGroup } from './query'

const L = (k: string, v?: Record<string, string | number>): string => bt('plugins.bases.' + k, v)

/** Hidden element used to measure a heading / card; kept in the DOM for themes. */
function probe(parent: HTMLElement, cls: string): HTMLElement {
  const el = parent.createDiv({ cls, text: 'Fj', attr: { 'aria-hidden': 'true' } })
  el.style.visibility = 'hidden'
  el.style.position = 'absolute'
  return el
}

/** Fold state of a group (`QueryController.getGroupFolds`, keyed by the group key's string form). */
export function isGroupCollapsed(ctrl: QueryController, g: BasesEntryGroup): boolean {
  return !!ctrl.getGroupFolds()[String(g.key ?? '')]
}

/**
 * Group heading shared by table/cards/list (`createGroupHeadingEl` markup):
 * `.bases-group-heading.mod-collapsible > .bases-group-property + .bases-group-value + .collapse-indicator.collapse-icon`.
 * No heading for the implicit single group (no key). Clicking toggles the fold and calls `onToggle`.
 */
export function createGroupHeadingEl(ctrl: QueryController, g: BasesEntryGroup, onToggle: () => void): HTMLElement | null {
  if (!g.key) return null
  const cfg = ctrl.getViewConfig()
  const groupBy = cfg?.groupBy
  const h = createDiv('bases-group-heading mod-collapsible')
  h.addEventListener('click', (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    e.preventDefault()
    const f = ctrl.getGroupFolds()
    const k = String(g.key ?? '')
    if (f[k]) delete f[k]
    else f[k] = true
    icon.toggleClass('is-collapsed', isGroupCollapsed(ctrl, g))
    onToggle()
  })
  if (groupBy) h.createDiv({ cls: 'bases-group-property', text: cfg!.getDisplayName(groupBy.property) })
  const v = h.createDiv('bases-group-value')
  const key = g.key ?? NULL
  if (key instanceof NullValue) v.setText(L('labelGroupKeyNone'))
  else key.renderTo(v, ctrl.renderCtx)
  const icon = h.createDiv('collapse-indicator collapse-icon')
  setIcon(icon, 'lucide-chevron-right')
  icon.toggleClass('is-collapsed', isGroupCollapsed(ctrl, g))
  return h
}

/** Plain heading (kanban column header). */
function groupHeading(ctrl: QueryController, parent: HTMLElement, g: BasesEntryGroup, cls = 'bases-group-heading'): HTMLElement {
  const h = parent.createDiv(cls)
  const key = g.key ?? NULL
  const v = h.createDiv('bases-group-value')
  if (key instanceof NullValue) v.setText(L('labelGroupKeyNone'))
  else key.renderTo(v, ctrl.renderCtx)
  return h
}

function imageFor(ctrl: QueryController, e: BasesEntry, prop: string | null): string | null {
  if (!prop) return null
  const v = e.getValue(prop) as Value | null
  if (!v || v instanceof NullValue) return null
  const first = v instanceof ListValue ? v.get(0) : v
  const s = first.toString()
  const link = /^!?\[\[(.+?)(\|.*)?\]\]$/.exec(s)
  const path = link ? link[1] : s
  if (/^(https?|file|data|app):/i.test(path)) return path
  const f = ctrl.app.metadataCache.getFirstLinkpathDest(path, e.file.path)
  return f ? ctrl.app.vault.getResourcePath(f) : null
}

function openOnClick(ctrl: QueryController, el: HTMLElement, e: BasesEntry): void {
  el.addEventListener('click', ev => {
    if ((ev.target as HTMLElement).closest('a,input,.clickable-icon')) return
    void ctrl.app.workspace.getLeaf(ev.ctrlKey || ev.metaKey).openFile(e.file)
  })
  el.addEventListener('contextmenu', ev => {
    ev.preventDefault()
    const m = new Menu()
    ctrl.app.workspace.trigger('file-menu', m, e.file, 'bases-view')
    m.showAtMouseEvent(ev)
  })
  el.addEventListener('mouseover', ev => ctrl.app.workspace.trigger('hover-link', { event: ev, source: 'bases', hoverParent: el, targetEl: el, linktext: e.file.path, sourcePath: ctrl.sourcePath() }))
}

/** Dropping a card on a column sets the grouped property to that column's value (clears it for the empty column);
 *  for a folder grouping the note is moved into the folder. Only markdown notes can be moved. */
async function moveCardToColumn(c: QueryController, groupProp: string, file: any, key: any): Promise<void> {
  const { name, type } = splitPropertyId(groupProp)
  if (type === 'file' && name === 'folder') {
    const dest = c.app.vault.getFolderByPath?.(String(key)) ?? c.app.vault.getAbstractFileByPath(String(key))
    if (dest && 'children' in dest && file.parent !== dest) await c.app.fileManager.renameFile(file, (dest.path === '/' ? '' : dest.path + '/') + file.name)
    return
  }
  if (type !== 'note' || file.extension !== 'md') return
  const value = !key || key instanceof NullValue ? null : groupKeyToFrontmatter(c.app, key, name, file)
  await c.app.fileManager.processFrontMatter(file, (fm: any) => {
    const k = Object.keys(fm).find(x => x.toLowerCase() === name.toLowerCase()) ?? name
    if (value === null) delete fm[k]
    else fm[k] = value
  })
}

export class CardsView extends BasesView {
  type = 'cards'
  constructor(controller: QueryController, public rootEl: HTMLElement) {
    super(controller)
  }
  onunload(): void {
    this.rootEl.empty()
  }
  onDataUpdated(): void {
    const c = this.controller
    const cfg = this.config
    const root = this.rootEl
    root.empty()
    const box = root.createDiv({ cls: 'bases-cards-container node-insert-event', attr: { tabindex: '0' } })
    const size = Number(cfg.get('cardSize') ?? 200)
    box.style.setProperty('--bases-cards-column-width', size + 'px')
    const fit = cfg.get('imageFit') ?? 'cover'
    const ratio = Number(cfg.get('imageAspectRatio') ?? 1)
    box.style.setProperty('--bases-cards-image-fit', fit)
    box.style.setProperty('--bases-cards-aspect-ratio', String(ratio))
    const imageProp = cfg.getAsPropertyId('image')
    const order = cfg.getOrder()
    probe(box, 'bases-group-heading')
    const probeGroup = box.createDiv('bases-cards-group')
    const pi = probeGroup.createDiv('bases-cards-item')
    pi.style.visibility = 'hidden'
    pi.style.position = 'absolute'
    pi.createDiv('bases-cards-cover')
    const pp = pi.createDiv('bases-cards-property mod-title')
    pp.createDiv({ cls: 'bases-cards-label', text: 'Fj' })
    pp.createDiv({ cls: 'bases-cards-line', text: 'Fj' })
    const pp2 = pi.createDiv('bases-cards-property')
    pp2.createDiv({ cls: 'bases-cards-label', text: 'Fj' })
    pp2.createDiv({ cls: 'bases-cards-line', text: 'Fj' })
    for (const g of this.data.groupedData) {
      const heading = cfg.groupBy ? createGroupHeadingEl(c, g, () => this.onDataUpdated()) : null
      if (heading) box.appendChild(heading)
      const grp = box.createDiv('bases-cards-group')
      const collapsed = isGroupCollapsed(c, g)
      grp.toggleClass('is-collapsed', collapsed)
      for (const e of collapsed ? [] : g.entries) {
        const card = grp.createDiv({ cls: 'bases-cards-item', attr: { 'data-path': e.file.path, draggable: 'true' } })
        const img = imageFor(c, e, imageProp)
        if (imageProp) {
          const cover = card.createDiv('bases-cards-cover')
          if (img) cover.createEl('img', { attr: { src: img } })
          else cover.addClass('bases-cards-cover-empty')
        }
        order.forEach((prop, i) => {
          const p = card.createDiv({ cls: 'bases-cards-property' + (i === 0 ? ' mod-title' : ''), attr: { 'data-property': prop } })
          p.createDiv({ cls: 'bases-cards-label', text: cfg.getDisplayName(prop) })
          const line = p.createDiv('bases-cards-line bases-rendered-value')
          renderValue(c, e, prop, line)
        })
        openOnClick(c, card, e)
      }
    }
  }
}

export class ListView extends BasesView {
  type = 'list'
  constructor(controller: QueryController, public rootEl: HTMLElement) {
    super(controller)
  }
  onunload(): void {
    this.rootEl.empty()
  }
  onDataUpdated(): void {
    const c = this.controller
    const cfg = this.config
    const root = this.rootEl
    root.empty()
    const markers = cfg.get('markers') ?? 'bullet'
    const indent = !!cfg.get('indentProperties')
    const sep = cfg.get('separator') ?? ', '
    const box = root.createDiv({ cls: 'bases-list-container node-insert-event show-indentation-guide', attr: { tabindex: '0' } })
    const order = cfg.getOrder()
    for (const g of this.data.groupedData) {
      const grp = box.createDiv('bases-list-group')
      const heading = cfg.groupBy ? createGroupHeadingEl(c, g, () => this.onDataUpdated()) : null
      if (heading) grp.appendChild(heading)
      const collapsed = isGroupCollapsed(c, g)
      grp.toggleClass('is-collapsed', collapsed)
      const list = grp.createDiv('bases-list-group-list')
      ;(collapsed ? [] : g.entries).forEach((e, idx) => {
        const item = list.createDiv({ cls: 'bases-list-item', attr: { 'data-path': e.file.path } })
        const props = item.createDiv('bases-list-item-properties')
        order.forEach((prop, i) => {
          if (i > 0 && !indent) props.createSpan({ cls: 'bases-list-separator', text: sep })
          const holder = indent && i > 0 ? item.createDiv('bases-list-item-properties mod-indented') : props
          const span = holder.createSpan('bases-list-property')
          if (i === 0 && markers !== 'none') span.createSpan({ cls: 'list-bullet', text: markers === 'number' ? `${idx + 1}.` : '-' })
          const val = span.createSpan('bases-rendered-value')
          renderValue(c, e, prop, val, true)
        })
        openOnClick(c, item, e)
      })
    }
  }
}

export class KanbanView extends BasesView {
  type = 'kanban'
  constructor(controller: QueryController, public rootEl: HTMLElement) {
    super(controller)
  }
  get isGroupedByFolder(): boolean {
    return this.config.groupBy?.property === 'file.folder'
  }
  canMoveCard(file: any): boolean {
    return !!this.config.groupBy && (this.isGroupedByFolder || file.extension === 'md')
  }
  /** Drop of a card on the column whose group value is `key`. */
  async moveCardToColumn(file: any, key: any): Promise<void> {
    if (this.canMoveCard(file)) await moveCardToColumn(this.controller, this.config.groupBy!.property, file, key)
  }
  onunload(): void {
    this.rootEl.empty()
  }
  onDataUpdated(): void {
    const c = this.controller
    const cfg = this.config
    const root = this.rootEl
    root.empty()
    if (!cfg.groupBy) {
      const empty = root.createDiv('bases-kanban-empty')
      empty.createDiv({ cls: 'bases-empty-title', text: bt('plugins.bases.kanban.titleNoGroupBy') })
      empty.createDiv({ cls: 'bases-empty-text', text: bt('plugins.bases.kanban.textNoGroupBy') })
      const btn = textIconButton(empty, { label: bt('plugins.bases.kanban.actionChooseProperty') })
      btn.addEventListener('click', e => {
        const m = new Menu()
        for (const p of c.getAllProperties()) m.addItem(i => i.setTitle(c.query.getPropertyConfig(p).getDisplayName()).onClick(() => cfg.setGroupBy({ property: p, direction: 'ASC' })))
        m.showAtMouseEvent(e)
      })
      return
    }
    const box = root.createDiv({ cls: 'bases-kanban-container node-insert-event', attr: { tabindex: '0' } })
    box.style.setProperty('--bases-kanban-column-width', Number(cfg.get('columnWidth') ?? 280) + 'px')
    const imageProp = cfg.getAsPropertyId('image')
    const order = cfg.getOrder()
    const gp = cfg.groupBy.property
    const hidden = cfg.groupOrder
    // measurement probe column
    const pc = box.createDiv('bases-kanban-column')
    pc.style.visibility = 'hidden'
    pc.style.position = 'absolute'
    const ph = pc.createDiv('bases-kanban-column-header')
    ph.createDiv('bases-group-heading').createDiv({ cls: 'bases-group-value', text: 'Fj' })
    ph.createSpan({ cls: 'bases-kanban-column-count', text: '0' })
    const pcc = pc.createDiv('bases-kanban-column-content').createDiv('bases-kanban-column-inner')
    const pcard = pcc.createDiv('bases-kanban-card')
    pcard.createDiv('bases-kanban-card-cover')
    for (let i = 0; i < 2; i++) {
      const p = pcard.createDiv('bases-kanban-card-property' + (i === 0 ? ' mod-title' : ''))
      p.createDiv({ cls: 'bases-kanban-card-label', text: 'Fj' })
      p.createDiv({ cls: 'bases-kanban-card-line', text: 'Fj' })
    }
    textIconButton(pc.createDiv('bases-kanban-column-footer'), { icon: 'lucide-plus', label: L('labelNewItem') })

    const groups = this.data.groupedData.slice()
    if (!hidden || !hidden.length) groups.sort((a, b) => Number(!(a.key instanceof NullValue)) - Number(!(b.key instanceof NullValue)))
    for (const g of groups) {
      const keyStr = g.key instanceof NullValue || !g.key ? null : g.key.toString()
      if (hidden && hidden.length && !hidden.some(h => (h === null ? keyStr === null : String(h) === keyStr))) continue
      const col = box.createDiv('bases-kanban-column')
      const head = col.createDiv({ cls: 'bases-kanban-column-header', attr: { draggable: 'true' } })
      groupHeading(c, head, g)
      head.createSpan({ cls: 'bases-kanban-column-count', text: String(g.entries.length) })
      const create = head.createDiv({ cls: 'bases-kanban-column-create clickable-icon', attr: { 'aria-label': 'Create new note' } })
      setIcon(create, 'lucide-plus')
      const addToColumn = (): void =>
        void c.createFileForView('', (fm, file) => {
          const { name, type } = splitPropertyId(gp)
          if (type === 'note' && g.key && !(g.key instanceof NullValue)) fm[name] = groupKeyToFrontmatter(c.app, g.key, name, file)
        })
      create.addEventListener('click', addToColumn)
      const inner = col.createDiv('bases-kanban-column-content').createDiv('bases-kanban-column-inner')
      for (const e of g.entries) {
        const card = inner.createDiv({ cls: 'bases-kanban-card', attr: { tabindex: '0', 'data-path': e.file.path, draggable: String(this.canMoveCard(e.file)) } })
        const img = imageFor(c, e, imageProp)
        if (imageProp) {
          const cover = card.createDiv('bases-kanban-card-cover')
          if (img) cover.createEl('img', { attr: { src: img } })
        }
        order.forEach((prop, i) => {
          const p = card.createDiv({ cls: 'bases-kanban-card-property' + (i === 0 ? ' mod-title' : ''), attr: { 'data-property': prop } })
          p.createDiv({ cls: 'bases-kanban-card-label', text: cfg.getDisplayName(prop) })
          renderValue(c, e, prop, p.createDiv('bases-kanban-card-line bases-rendered-value'))
        })
        openOnClick(c, card, e)
        card.addEventListener('dragstart', ev => ev.dataTransfer?.setData('text/bases-path', e.file.path))
      }
      col.addEventListener('dragover', ev => ev.preventDefault())
      col.addEventListener('drop', ev => {
        ev.preventDefault()
        const path = ev.dataTransfer?.getData('text/bases-path')
        const file = path && c.app.vault.getAbstractFileByPath(path)
        if (file) void this.moveCardToColumn(file, g.key)
      })
      textIconButton(col.createDiv('bases-kanban-column-footer'), { icon: 'lucide-plus', label: L('labelNewItem') }).addEventListener('click', addToColumn)
    }
  }
}
