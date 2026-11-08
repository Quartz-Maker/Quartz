// `Menu` / `MenuItem` / `MenuSeparator` (plugin API, obsidian.d.ts).
//
// DOM: `body > div.menu[.mod-no-icon] > .menu-grabber + .menu-scroll > (.menu-group >
// .menu-item.tappable[data-section] > .menu-item-icon + .menu-item-title [+ .menu-item-icon
// .mod-checked | .mod-submenu]) | .menu-separator` plus a `body > .suggestion-bg` (opacity 0.85).
// - Items are grouped by `section`: `addSections()` fixes an order (inserted before the "" section),
//   unknown sections are appended in first-use order, separators go between top-level sections,
//   `setSectionSubmenu(section)` folds `section` and `section.*` into one submenu item.
// - The menu loads on the next tick; while loaded it owns a keymap scope (↑/↓ skip disabled and
//   wrap, → opens a submenu and selects its first item, ← closes a submenu, Enter activates, Esc
//   hides) and closes on outside mousedown/click and on any other contextmenu.
// - Submenus open 250 ms after hovering their item (immediately on click / →).
// - `Menu.useNativeMenu` (app config `nativeMenus`; true by default on macOS) renders the menu
//   with Electron (`@electron/remote` Menu.buildFromTemplate().popup()) on desktop.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component } from '../core/Component'
import { Keymap, Scope } from '../keymap/Keymap'
import { Platform } from '../keymap/Platform'
import { debounce } from '../vault/debounce'
import { setIcon } from './icons'
import { hideTooltip } from './tooltip'
import { installPointerTracking, isTouchEvent, onElementGone, parseNumber } from './dom'
import { nodeRequire } from '../node'

export interface MenuPositionDef {
  x: number
  y: number
  width?: number
  overlap?: boolean
  left?: boolean
}

export class MenuSeparator {
  dom: HTMLElement
  constructor(public menu: Menu) {
    this.dom = createDiv('menu-separator')
  }
}

export class MenuItem {
  dom: HTMLElement
  iconEl: HTMLElement
  titleEl: HTMLElement
  checkIconEl: HTMLElement | null = null
  section = ''
  checked: boolean | null = null
  disabled = false
  submenu: Menu | null = null
  callback: ((evt: MouseEvent | KeyboardEvent) => any) | null = null

  /** @internal use Menu.addItem() */
  constructor(public menu: Menu) {
    const dom = (this.dom = createDiv('menu-item tappable'))
    this.iconEl = dom.createDiv('menu-item-icon')
    this.titleEl = dom.createDiv('menu-item-title')
    dom.addEventListener('click', this.handleEvent.bind(this))
  }

  /** @internal */
  static create(menu: Menu): MenuItem {
    return new MenuItem(menu)
  }

  setTitle(title: string | DocumentFragment): this {
    if (typeof title === 'string') this.titleEl.setText(title)
    else {
      this.titleEl.empty()
      this.titleEl.appendChild(title)
    }
    return this
  }

  setIcon(icon: string | null): this {
    if (icon) setIcon(this.iconEl, icon)
    else this.iconEl.empty()
    return this
  }

  /** @internal */
  removeIcon(): this {
    this.iconEl.detach()
    return this
  }

  /** @deprecated use setChecked */
  setActive(active: boolean): this {
    return this.setChecked(active)
  }

  setChecked(checked: boolean | null): this {
    if (checked) {
      if (!this.checkIconEl) setIcon((this.checkIconEl = this.dom.createDiv('menu-item-icon mod-checked')), 'lucide-check')
    } else if (this.checkIconEl) this.checkIconEl.detach()
    this.checked = checked
    this.dom.toggleClass('mod-checked', !!checked)
    return this
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled
    this.dom.toggleClass('is-disabled', disabled)
    return this
  }

  setWarning(isWarning: boolean): this {
    this.dom.toggleClass('is-warning', isWarning)
    return this
  }

  setIsLabel(isLabel: boolean): this {
    this.dom.toggleClass('tappable', !isLabel)
    this.dom.toggleClass('is-label', isLabel)
    return this
  }

  /** @internal (many plugins use it) */
  setSubmenu(): Menu {
    if (!this.submenu) {
      this.dom.addClass('has-submenu')
      this.submenu = new Menu()
      setIcon(this.dom.createDiv('menu-item-icon mod-submenu'), 'lucide-chevron-right')
    }
    return this.submenu
  }

  onClick(callback: (evt: MouseEvent | KeyboardEvent) => any): this {
    this.callback = callback
    return this
  }

  setSection(section: string): this {
    this.section = section
    this.dom.setAttr('data-section', section)
    return this
  }

  /** @internal */
  handleEvent(evt: MouseEvent | KeyboardEvent): void {
    if (this.disabled) {
      evt.preventDefault()
      return
    }
    if (this.submenu) {
      evt.preventDefault()
      this.menu.selectElement(this.dom, true)
      return
    }
    this.callback?.(evt)
    this.menu.hide()
  }
}

/** The innermost visible menu (for closeAllMenus). */
let currentMenu: Menu | null = null

/** Closes every open DOM menu (modals and popovers call this when they open). */
export function closeAllMenus(): void {
  while (currentMenu) {
    const parent: Menu | null = currentMenu.parentMenu
    currentMenu.close()
    currentMenu = parent
  }
}

const menuForEvent = new WeakMap<Event, Menu>()

export class Menu extends Component {
  /** Mirrors the `nativeMenus` app setting (see updateUseNativeMenu). */
  static useNativeMenu: boolean | null = false

  dom: HTMLElement
  scrollEl: HTMLElement
  bgEl: HTMLElement
  items: (MenuItem | MenuSeparator)[] = []
  sections: string[] = []
  /** Separators `sort()` inserted between sections; dropped on the next sort so they don't pile up. */
  private sectionSeparators = new WeakSet<MenuSeparator>()
  submenuConfigs: Record<string, { title: string; icon?: string; disabled?: boolean }> = {}
  scope: Scope
  selected: number | null = -1
  parentEl: HTMLElement | null = null
  parentMenu: Menu | null = null
  currentSubmenu: Menu | null = null
  useNativeMenu: boolean | null
  showMacWritingTools = false
  unloading = false
  hideCallback: (() => any) | null = null
  openSubmenuSoon: ((item: MenuItem) => any) & { cancel(): any }
  private stopWatchingParent: (() => void) | null = null

  constructor() {
    super()
    this.useNativeMenu = Menu.useNativeMenu
    this.openSubmenuSoon = debounce((item: MenuItem) => this.openSubmenu(item), 250, true) as any
    this.scope = new Scope(Keymap.init().getRootScope())
    const dom = (this.dom = createDiv('menu'))
    dom.createDiv('menu-grabber')
    const scrollEl = (this.scrollEl = dom.createDiv('menu-scroll'))
    scrollEl.addEventListener('scroll', () => scrollEl.toggleClass('is-scrolled', scrollEl.scrollTop > 0), { passive: true })
    const bg = (this.bgEl = createDiv('suggestion-bg'))
    bg.style.opacity = '0'
    bg.addEventListener('mousedown', e => e.preventDefault())
    dom.addEventListener('mousedown', e => {
      if (e.button === 0) e.preventDefault()
    })
    bg.onClickEvent(() => this.hide())
    this.scope.register([], 'ArrowUp', this.onArrowUp.bind(this))
    this.scope.register([], 'ArrowDown', this.onArrowDown.bind(this))
    this.scope.register([], 'ArrowLeft', this.onArrowLeft.bind(this))
    this.scope.register([], 'ArrowRight', this.onArrowRight.bind(this))
    this.scope.register([], 'Enter', this.onEnter.bind(this))
    this.scope.register([], 'Escape', this.hide.bind(this))
    dom.addEventListener('pointerover', this.onPointerOver.bind(this))
    installPointerTracking(document)
  }

  onload(): void {
    const win = (this.parentEl?.win ?? (window as any).activeWindow ?? window) as Window
    this.registerDomEvent(win, 'mousedown', (e: MouseEvent) => {
      if (!this.parentEl?.contains(e.target as Node)) this.handleClickOutside(e)
    })
    this.registerDomEvent(win, 'click', this.handleClickOutside.bind(this))
    if (Platform.isDesktop) this.registerDomEvent(win, 'contextmenu', this.hide.bind(this))
    Keymap.init().pushScope(this.scope)
  }

  onunload(): void {
    Keymap.init().popScope(this.scope)
  }

  /** @internal */
  handleClickOutside(e: Event): void {
    if (!this._loaded) return
    const t = e.target as Node | null
    if (t && !this.isInside(t)) this.hide()
  }

  /** @internal Inside this menu, a parent menu or an open submenu. */
  isInside(node: Node): boolean {
    if (this.dom.contains(node)) return true
    for (let m = this.parentMenu; m; m = m.parentMenu) if (m.dom.contains(node)) return true
    for (let m = this.currentSubmenu; m; m = m.currentSubmenu) if (m.dom.contains(node)) return true
    return false
  }

  /** @internal Orders items into sections and renders groups/separators. */
  sort(): void {
    const sections = this.sections
    const cfgs = this.submenuConfigs
    const groups: Record<string, (MenuItem | MenuSeparator)[]> = { '': [] }
    for (const it of this.items) {
      if (it instanceof MenuSeparator && this.sectionSeparators.has(it)) continue
      const s = it instanceof MenuItem ? it.section : ''
      if (s !== '' && !sections.includes(s)) sections.push(s)
      if (!Object.prototype.hasOwnProperty.call(groups, s)) groups[s] = []
      groups[s].push(it)
    }
    const out: (MenuItem | MenuSeparator)[] = []
    const sep = (): MenuSeparator => {
      const m = new MenuSeparator(this)
      this.sectionSeparators.add(m)
      return m
    }
    let lastSection: string | null = null
    let sub: Menu | null = null
    let subKey = ''
    for (const s of sections) {
      if (!Object.prototype.hasOwnProperty.call(groups, s)) continue
      let key = ''
      for (const k in cfgs) {
        if (Object.prototype.hasOwnProperty.call(cfgs, k) && (s === k || s.substring(0, k.length + 1) === k + '.')) {
          key = k
          break
        }
      }
      const parts = s.split('.')
      const top = parts[0]
      const rest = parts.length > 0 ? parts.slice(1).join('.') : s
      if (key) {
        if (sub && key === subKey) sub.items.push(new MenuSeparator(this))
        else {
          if (lastSection && lastSection.split('.')[0] !== top) {
            out.push(sep())
            lastSection = s
          }
          const cfg = cfgs[key]
          const holder = MenuItem.create(this)
          out.push(holder)
          holder.setTitle(cfg.title)
          if (cfg.icon) holder.setIcon(cfg.icon)
          if (cfg.disabled) holder.setDisabled(true)
          sub = holder.setSubmenu()
          subKey = key
        }
        for (const it of groups[s]) {
          if (it instanceof MenuItem) it.setSection(rest)
          sub!.items.push(it)
        }
      } else {
        if (lastSection !== top) {
          if (lastSection !== null) out.push(sep())
          lastSection = s
        }
        for (const it of groups[s]) out.push(it)
      }
    }
    if (!sections.includes('')) for (const it of groups['']) out.push(it)
    while (out.length && out[out.length - 1] instanceof MenuSeparator) out.pop()
    this.items = out
    this.scrollEl.empty()
    let group: HTMLElement | null = null
    for (const it of out) {
      if (it instanceof MenuItem) {
        if (!group) group = this.scrollEl.createDiv('menu-group')
        group.appendChild(it.dom)
      } else {
        group = null
        this.scrollEl.appendChild(it.dom)
      }
    }
  }

  addSections(sections: string[]): this {
    const cur = this.sections
    const add = sections.filter(s => !cur.includes(s))
    let at = cur.indexOf('')
    if (at === -1) at = cur.length
    cur.splice(at, 0, ...add)
    return this
  }

  setSectionSubmenu(section: string, cfg: { title: string; icon?: string; disabled?: boolean }): this {
    this.submenuConfigs[section] = cfg
    return this
  }

  setNoIcon(): this {
    this.dom.addClass('mod-no-icon')
    return this
  }

  setUseNativeMenu(useNativeMenu: boolean): this {
    this.useNativeMenu = useNativeMenu
    return this
  }

  /** @internal macOS writing tools in native menus */
  setShowMacWritingTools(v: boolean): this {
    this.showMacWritingTools = v
    return this
  }

  addItem(cb: (item: MenuItem) => any): this {
    if (this._loaded) return this
    const item = MenuItem.create(this)
    this.items.push(item)
    cb(item)
    return this
  }

  addSeparator(): this {
    if (this._loaded) return this
    this.items.push(new MenuSeparator(this))
    return this
  }

  setParentElement(el: HTMLElement): this {
    this.parentEl?.removeClass('has-active-menu')
    this.parentEl = el
    return this
  }

  showAtMouseEvent(evt: MouseEvent): this {
    return this.showAtPosition({ x: evt.clientX, y: evt.clientY }, ((evt.target as Node | null)?.ownerDocument ?? undefined) as Document | undefined)
  }

  showAtPosition(pos: MenuPositionDef, doc?: Document): this {
    this.unload()
    if (this.items.length === 0) return this
    const d = doc || ((window as any).activeDocument as Document) || document
    const body = d.body
    const x = pos.x
    let y = pos.y
    if (this.parentEl) {
      this.parentEl.addClass('has-active-menu')
      this.stopWatchingParent?.()
      this.stopWatchingParent = onElementGone(this.parentEl, 500, () => this.hide())
    }
    this.sort()
    hideTooltip()
    if (!Platform.isDesktop || !this.useNativeMenu) {
      setTimeout(this.load.bind(this), 0)
      const dom = this.dom
      const bg = this.bgEl
      body.appendChild(dom)
      body.appendChild(bg)
      const w = dom.offsetWidth
      const h = dom.offsetHeight
      const bw = body.clientWidth
      const bh = body.clientHeight
      const cs = getComputedStyle(body)
      const minTop = parseNumber(cs.paddingTop, 0) + parseNumber(cs.getPropertyValue('--safe-area-inset-top'), 0)
      let right = x
      let left = x
      if (pos.width) {
        if (pos.overlap) {
          right = x
          left = x + pos.width
        } else {
          right = x + pos.width
          left = x
        }
      } else {
        right = x + 2
        left = x - 2
      }
      const fitsLeft = left - w >= 0
      if (!(right + w <= bw) || (pos.left && fitsLeft)) dom.style.left = Math.max(0, left - w) + 'px'
      else dom.style.left = right + 'px'
      if (y + h > bh) y = Math.max(minTop, y - h)
      dom.style.top = y + 2 + 'px'
      autoScrollOnHover(this.scrollEl)
      bg.style.opacity = '0.85'
      currentMenu = this
      return this
    }
    this.showNative(d, x, y)
    return this
  }

  /** @internal Electron menu built from the items. */
  showNative(doc: Document, x: number, y: number): void {
    const build = (items: (MenuItem | MenuSeparator)[]): any[] =>
      items.map(it => {
        if (it instanceof MenuItem) {
          const t: any = {
            label: it.titleEl.getText().replace(/\B&\B/, '&&'),
            enabled: !it.disabled && !it.dom.hasClass('is-label'),
            checked: it.checked,
            type: typeof it.checked === 'boolean' ? 'checkbox' : undefined,
            click: (_mi: any, _w: any, e: any) => it.handleEvent(new MouseEvent('click', e))
          }
          if (it.submenu) {
            it.submenu.sort()
            t.submenu = build(it.submenu.items)
          }
          return t
        }
        return { type: 'separator' }
      })
    try {
      const remote = nodeRequire('@electron/remote')
      const menu = remote.Menu.buildFromTemplate(build(this.items))
      menu.on('menu-will-close', () => this.hide())
      const wc = remote.getCurrentWebContents()
      const zoom = Math.pow(1.2, wc.getZoomLevel())
      menu.popup({ x: Math.round(x * zoom), y: Math.round(y * zoom), window: remote.getCurrentWindow(), frame: this.showMacWritingTools ? wc.focusedFrame : undefined })
    } catch (e) {
      console.error(e)
      // No Electron (web): fall back to the DOM menu.
      this.useNativeMenu = false
      this.showAtPosition({ x, y }, doc)
    }
  }

  /** @internal HistoryHandler */
  onHistoryBack(): void {
    this.hide()
  }

  hide(): this {
    this.unload()
    if (this.unloading) return this
    this.unloading = true
    this.unselect()
    this.closeSubmenu()
    if (this.parentMenu && this.parentMenu.currentSubmenu === this) {
      if (currentMenu === this) currentMenu = this.parentMenu
      this.parentMenu.currentSubmenu = null
    } else currentMenu = null
    this.parentMenu = null
    this.stopWatchingParent?.()
    this.stopWatchingParent = null
    if (this.parentEl) {
      this.parentEl.removeClass('has-active-menu')
      this.parentEl = null
    }
    const cb = this.hideCallback
    this.hideCallback = null
    this.dom.detach()
    this.bgEl.detach()
    cb?.()
    this.unloading = false
    return this
  }

  close(): void {
    this.hide()
  }

  onHide(callback: () => any): void {
    this.hideCallback = callback
  }

  /** @internal */
  onArrowUp(e: KeyboardEvent): false {
    e.preventDefault()
    const items = this.items
    let i = (this.selected ?? -1) - 1
    for (let n = 0; n < items.length; n++) {
      const it = items[i]
      if (it && it instanceof MenuItem && !it.disabled) {
        this.select(i)
        return false
      }
      if (--i < 0) i = items.length - 1
    }
    return false
  }

  /** @internal */
  onArrowDown(e: KeyboardEvent): false {
    e.preventDefault()
    const items = this.items
    let i = (this.selected ?? -1) + 1
    for (let n = 0; n < items.length; n++) {
      const it = items[i]
      if (it && it instanceof MenuItem && !it.disabled) {
        this.select(i)
        return false
      }
      if (++i >= items.length) i = 0
    }
    return false
  }

  /** @internal */
  onArrowLeft(e: KeyboardEvent): false {
    e.preventDefault()
    if (this.parentMenu) this.hide()
    return false
  }

  /** @internal */
  onArrowRight(e: KeyboardEvent): false {
    e.preventDefault()
    const it = this.items[this.selected ?? -1]
    if (it instanceof MenuItem && it.submenu) {
      this.openSubmenu(it)
      this.currentSubmenu?.select(0)
    }
    return false
  }

  /** @internal */
  onEnter(e: KeyboardEvent): false {
    const it = this.items[this.selected ?? -1]
    if (it && it instanceof MenuItem) {
      it.handleEvent(e)
      this.hide()
    }
    return false
  }

  /** @internal Select the item containing `el` (hover); open its submenu now or after 250 ms. */
  selectElement(el: Node, immediate = false): void {
    const parent = this.parentMenu
    const items = this.items
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.dom.contains(el)) continue
      if (parent) {
        const pItems = parent.items
        for (let j = 0; j < pItems.length; j++) {
          const p = pItems[j]
          if (p instanceof MenuItem && p.submenu === this) {
            if (parent.selected !== j) {
              parent.openSubmenuSoon.cancel()
              parent.select(j)
            }
            break
          }
        }
      }
      if (it instanceof MenuItem) {
        this.select(i)
        if (immediate) this.openSubmenu(it)
        else this.openSubmenuSoon(it)
      }
      return
    }
  }

  /** @internal */
  onPointerOver(e: PointerEvent): void {
    if (!isTouchEvent(e)) this.selectElement(e.target as Node, false)
  }

  /** @internal */
  unselect(): void {
    const it = this.items[this.selected ?? -1]
    it?.dom.removeClass('selected')
    this.selected = null
    this.closeSubmenu()
  }

  /** @internal */
  select(index: number): void {
    const items = this.items
    if (items.length === 0) return
    if (index < 0) index = items.length - 1
    if (index >= items.length) index = 0
    items[this.selected ?? -1]?.dom.removeClass('selected')
    this.selected = index
    const it = items[index]
    it.dom.addClass('selected')
    it.dom.scrollIntoView?.({ block: 'nearest' })
  }

  /** @internal */
  openSubmenu(item: MenuItem): void {
    this.openSubmenuSoon.cancel()
    const sub = item.submenu
    const cur = this.currentSubmenu
    const parent = this.parentMenu
    if (item.disabled) return
    if (cur) {
      // (compares against the parent's index of *this* menu's item, i.e. -1.)
      if (cur === sub || (parent && parent.selected !== parent.items.indexOf(item))) return
      this.closeSubmenu()
    }
    if (!sub) return
    sub.parentMenu = this
    this.currentSubmenu = sub
    const cs = getComputedStyle(this.dom)
    const padTop = parseNumber(cs.paddingTop, 0) + parseNumber(cs.borderTopWidth, 0)
    const padLeft = parseNumber(cs.paddingLeft, 0) + parseNumber(cs.borderLeftWidth, 0) + 2
    const padRight = parseNumber(cs.paddingRight, 0) + parseNumber(cs.borderRightWidth, 0) + 2
    const r = item.dom.getBoundingClientRect()
    sub.showAtPosition({ x: r.x - padLeft, y: r.y - padTop, width: r.width + padLeft + padRight }, item.dom.ownerDocument)
  }

  /** @internal */
  closeSubmenu(): void {
    this.openSubmenuSoon.cancel()
    const sub = this.currentSubmenu
    if (sub) {
      sub.hide()
      sub.parentMenu = null
      this.currentSubmenu = null
    }
  }

  /** One menu per event, shown on the next tick (several handlers can contribute items). */
  static forEvent(evt: PointerEvent | MouseEvent): Menu {
    evt.preventDefault()
    let menu = menuForEvent.get(evt)
    if (!menu) {
      const m = (menu = new Menu())
      menuForEvent.set(evt, m)
      const win = ((evt as any).view as Window) || window
      win.setTimeout(() => m.showAtMouseEvent(evt))
    }
    return menu
  }

  /** @internal Flat item titles (separators as "---") — diagnostics/tests. */
  describe(): string[] {
    return this.items.map(i => (i instanceof MenuItem ? i.titleEl.textContent || '' : '---'))
  }
}

const autoScrollEls = new WeakSet<HTMLElement>()
/** Long menus scroll with the pointer position (30px dead zones at both ends). */
function autoScrollOnHover(el: HTMLElement): void {
  if (autoScrollEls.has(el)) return
  autoScrollEls.add(el)
  el.addEventListener('mousemove', e => {
    const h = el.clientHeight
    const sh = el.scrollHeight
    if (sh > h) {
      const ratio = (e.clientY - el.getBoundingClientRect().y - 30) / (h - 60)
      el.scrollTop = (sh - h) * Math.min(1, Math.max(0, ratio))
    }
  })
}

/** Applies the `nativeMenus` vault setting (null → true on macOS). */
export function updateUseNativeMenu(getConfig: (key: string) => any): void {
  let v = getConfig('nativeMenus')
  if (Platform.isMacOS && v === null) v = true
  Menu.useNativeMenu = v
}
