// WorkspaceRibbon — `.workspace-ribbon.side-dock-ribbon.mod-primary|mod-secondary`.
// Items persist as `"left-ribbon": {"hiddenItems": {id: hidden}}`; key order = display order.
import { setIcon, setTooltip, TOOLTIP_DELAY } from './dom'
import { Menu } from './Menu'
import { t } from './strings'
import { logicalSide, type Side } from './WorkspaceSplit'
import type { Workspace } from './Workspace'

export interface RibbonItem {
  id: string
  icon: string
  title: string
  callback?: (evt: MouseEvent) => any
  hidden: boolean
  buttonEl?: HTMLElement
}

export class WorkspaceRibbon {
  items: RibbonItem[] = []
  workspace: Workspace
  containerEl: HTMLElement
  ribbonItemsEl: HTMLElement | null = null
  ribbonSettingEl: HTMLElement | null = null
  side: Side

  constructor(workspace: Workspace, side: Side) {
    this.workspace = workspace
    this.side = side
    const el = (this.containerEl = createDiv('workspace-ribbon side-dock-ribbon'))
    const ls = logicalSide(side)
    el.addClass(`mod-${ls}`)
    if (ls === 'primary') {
      this.ribbonItemsEl = el.createDiv('side-dock-actions')
      this.ribbonSettingEl = el.createDiv('side-dock-settings')
    }
    el.addEventListener('contextmenu', this.onContextMenu.bind(this))
  }

  load(data: { hiddenItems?: Record<string, boolean> }): void {
    if (data && Object.prototype.hasOwnProperty.call(data, 'hiddenItems')) {
      const hidden = data.hiddenItems || {}
      for (const item of this.items) item.hidden = hidden[item.id] ?? false
      const order = Object.keys(hidden)
      // Remember entries whose plugin has not registered its
      // button yet, so plugins loading after the layout keep their place/flag and the file
      // round-trips losslessly.
      for (const id of order) {
        if (!this.items.some(i => i.id === id)) this.items.push({ id, icon: '', title: '', hidden: !!hidden[id] })
      }
      this.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    }
    this.onChange(false)
  }

  serialize(): { hiddenItems: Record<string, boolean> } {
    const hiddenItems: Record<string, boolean> = {}
    for (const item of this.items) hiddenItems[item.id] = item.hidden
    return { hiddenItems }
  }

  /** Backs `Plugin.addRibbonIcon`; `id` is `"<pluginId>:<title>"`. */
  addRibbonItemButton(id: string, icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const btn = this.makeRibbonItemButton(icon, title, callback)
    let item = this.items.find(i => i.id === id)
    if (item) {
      item.title = title
      item.icon = icon
      item.callback = callback
    } else {
      item = { id, icon, title, callback, hidden: false }
      this.items.push(item)
    }
    item.buttonEl = btn
    this.onChange(false)
    return btn
  }

  removeRibbonAction(id: string): void {
    const item = this.items.find(i => i.id === id)
    if (item) {
      delete item.buttonEl
      delete item.callback
    }
  }

  makeRibbonItemButton(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const el = createDiv('clickable-icon side-dock-ribbon-action')
    el.addEventListener('click', evt => callback(evt))
    setTooltip(el, title, { delay: TOOLTIP_DELAY, placement: 'right' })
    setIcon(el, icon)
    return el
  }

  setCollapsedState(collapsed: boolean): void {
    this.containerEl.toggleClass('is-collapsed', collapsed)
  }

  hide(): void {
    this.containerEl.addClass('is-hidden')
  }

  show(): void {
    this.containerEl.removeClass('is-hidden')
  }

  onChange(save: boolean): void {
    const buttons: HTMLElement[] = []
    for (const item of this.items) {
      const b = item.buttonEl
      if (b) {
        b.toggle(!item.hidden)
        buttons.push(b)
      }
    }
    this.ribbonItemsEl?.setChildrenInPlace(buttons)
    if (save) this.workspace.requestSaveLayout()
  }

  onContextMenu(evt: MouseEvent): void {
    if (evt.target !== this.containerEl) return
    const menu = new Menu()
    for (const item of this.items) {
      if (!item.buttonEl) continue
      menu.addItem(mi =>
        mi
          .setSection('order')
          .setTitle(item.title)
          .setIcon(item.icon)
          .setChecked(!item.hidden)
          .onClick(() => {
            item.hidden = !item.hidden
            this.onChange(true)
          })
      )
    }
    menu.addItem(mi =>
      mi
        .setSection('ribbon')
        .setTitle(t.optionHideRibbon)
        .setIcon('lucide-panel-left-close')
        .onClick(() => this.workspace.app.vault.setConfig?.('showRibbon', false))
    )
    menu.showAtMouseEvent(evt)
  }
}
