/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.setting` — the settings window.
// A Modal (`.modal.mod-settings.mod-sidebar-layout`): left `.vertical-tab-header` (search box +
// three nav groups: Options / Core plugins / Community plugins), right `.vertical-tab-content-container`
// holding the active tab's `containerEl` or the top page of `pageStack`.
// NOTE: rendered as a modal in the main window, even when `settingsPopoutWindow` is set (popout windows
// are not available yet).
import { Modal, SearchComponent, setIcon, prepareSimpleSearch, renderResults } from '../ui'
import type { SearchResult } from '../search/fuzzy'
import { displayTab, type SettingPage, type SettingTab } from '../plugins/settingTab'
import { t } from './i18n'
import { openPopupWindow } from '../workspace/popout'
import { Platform } from '../keymap/Platform'

interface Entry {
  tab: SettingTab
  def: any
  /** pages the entry is nested in (outermost first) */
  path: any[]
  name: string
  texts: string[]
}

export class SettingsManager extends Modal {
  settingTabs: SettingTab[] = []
  pluginTabs: SettingTab[] = []
  activeTab: SettingTab | null = null
  pageStack: { page: SettingPage }[] = []
  lastTabId: string | null = null
  isSearchActive = false
  searchIndex: Entry[] | null = null
  searchNavItems: HTMLElement[] = []
  tabNavItems: Record<string, HTMLElement> = {}
  titleTextEl: HTMLElement
  backButtonEl: HTMLElement
  searchComponent: SearchComponent
  searchResultsEl: HTMLElement
  tabHeadersEl: HTMLElement
  tabGroupContainerEl: HTMLElement
  tabContentContainer: HTMLElement
  tabContainer: HTMLElement
  corePluginTabHeaderGroup: HTMLElement
  corePluginTabContainer: HTMLElement
  communityPluginTabHeaderGroup: HTMLElement
  communityPluginTabContainer: HTMLElement
  /** Ids of core-plugin tabs (shown in the "Core plugins" nav group). */
  private coreTabs = new WeakSet<SettingTab>()

  constructor(app: any) {
    super(app)
    this.modalEl.addClass('mod-settings', 'mod-sidebar-layout')
    this.contentEl.addClass('vertical-tabs-container')
    this.titleTextEl = createDiv()
    this.backButtonEl = this.titleEl.createDiv('clickable-icon modal-setting-back-button mod-raised')
    setIcon(this.backButtonEl, 'lucide-arrow-left')
    this.backButtonEl.hide()
    this.backButtonEl.addEventListener('click', () => this.closePage())
    this.titleEl.appendChild(this.titleTextEl)

    this.tabHeadersEl = this.contentEl.createDiv({ cls: 'vertical-tab-header', attr: { tabIndex: -1 } })
    const sc = this.tabHeadersEl.createDiv('setting-search-container')
    this.searchComponent = new SearchComponent(sc)
    this.searchComponent.setClass('mod-raised')
    this.searchComponent.setPlaceholder(t('setting.searchSettings'))
    this.searchComponent.inputEl.spellcheck = false
    this.searchComponent.onChange(() => this.onSearchChanged())
    this.searchResultsEl = this.tabHeadersEl.createDiv('setting-search-results')
    this.searchResultsEl.hide()
    this.tabGroupContainerEl = this.tabHeadersEl.createDiv('vertical-tab-header-group-container')
    const mk = (title: string, section: string): [HTMLElement, HTMLElement] => {
      const g = this.tabGroupContainerEl.createDiv('vertical-tab-header-group')
      g.createDiv({ cls: 'vertical-tab-header-group-title', text: title })
      return [g, g.createDiv({ cls: 'vertical-tab-header-group-items', attr: { 'data-section': section } })]
    }
    const [, opts] = mk(t('setting.options'), 'options')
    this.tabContainer = opts
    ;[this.corePluginTabHeaderGroup, this.corePluginTabContainer] = mk(t('setting.builtinPlugins'), 'core-plugins')
    ;[this.communityPluginTabHeaderGroup, this.communityPluginTabContainer] = mk(t('setting.thirdPartyPlugin.name'), 'community-plugins')
    this.tabContentContainer = this.contentEl.createDiv({ cls: 'vertical-tab-content-container', attr: { tabIndex: -1 } })
    this.scope.register(['Mod'], 'f', () => (this.searchComponent.inputEl.focus(), false))
  }

  /** popout window options (see open()). */
  getPopoutOptions(): { width: number; height: number; minWidth: number; minHeight: number } {
    return { width: 900, height: 700, minWidth: 600, minHeight: 400 }
  }

  // --- tabs -----------------------------------------------------------------------------------

  /** Built-in tabs (Quartz-internal). */
  addBuiltinTab(tab: SettingTab): void {
    this.settingTabs.push(tab)
    this.rebuildTabNavItems()
  }

  addSettingTab(tab: SettingTab): void {
    if (this.pluginTabs.includes(tab)) return
    tab.update?.()
    this.pluginTabs.push(tab)
    this.searchIndex = null
    this.updatePluginSection()
    this.trigger?.('tabs-changed')
  }

  /** Core plugin option tab (registered by InternalPlugin when enabled). */
  addCorePluginTab(tab: SettingTab): void {
    this.coreTabs.add(tab)
    this.addSettingTab(tab)
  }

  removeSettingTab(tab: SettingTab): void {
    const i = this.pluginTabs.indexOf(tab)
    if (i === -1) return
    if (this.activeTab === tab) {
      this.clearPageStack()
      tab.hide()
      this.activeTab = null
      this.tabContentContainer.empty()
      if (this.isOpen) this.openTab(this.settingTabs[0])
    }
    this.pluginTabs.splice(i, 1)
    this.searchIndex = null
    this.updatePluginSection()
    this.trigger?.('tabs-changed')
  }

  getTabs(): SettingTab[] {
    return this.pluginTabs
  }

  isPluginSettingTab(tab: SettingTab): boolean {
    return this.pluginTabs.includes(tab)
  }

  findTabById(id: string | null): SettingTab | null {
    if (!id) return null
    return this.settingTabs.find(t => t.id === id) ?? this.pluginTabs.find(t => t.id === id) ?? null
  }

  private navItem(tab: SettingTab): HTMLElement {
    const el = createDiv({ cls: 'vertical-tab-nav-item tappable', attr: { tabIndex: -1, 'data-setting-id': tab.id } })
    const icon = el.createDiv('vertical-tab-nav-item-icon')
    if (tab.icon) setIcon(icon, tab.icon)
    el.createDiv({ cls: 'vertical-tab-nav-item-title', text: tab.name })
    setIcon(el.createDiv('vertical-tab-nav-item-chevron'), 'lucide-chevron-right')
    el.addEventListener('click', () => this.openTab(tab))
    if (tab === this.activeTab) el.addClass('is-active')
    this.tabNavItems[tab.id] = el
    return el
  }

  rebuildTabNavItems(): void {
    this.tabNavItems = {}
    this.tabContainer.empty()
    for (const tab of this.settingTabs) this.tabContainer.appendChild(this.navItem(tab))
    this.updatePluginSection()
  }

  updatePluginSection(): void {
    const byName = (a: SettingTab, b: SettingTab): number => a.name.localeCompare(b.name)
    const fill = (container: HTMLElement, group: HTMLElement, tabs: SettingTab[]): void => {
      container.empty()
      for (const tab of tabs.sort(byName)) container.appendChild(this.navItem(tab))
      group.toggle(tabs.length > 0)
    }
    fill(this.corePluginTabContainer, this.corePluginTabHeaderGroup, this.pluginTabs.filter(t => this.coreTabs.has(t) && !(t as any).hidden))
    fill(this.communityPluginTabContainer, this.communityPluginTabHeaderGroup, this.pluginTabs.filter(t => !this.coreTabs.has(t)))
  }

  openTab(tab: SettingTab, keepSearch = false): void {
    this.closeActiveTab()
    if (!keepSearch) this.clearSearch()
    this.activeTab = tab
    this.lastTabId = tab.id
    for (const [id, el] of Object.entries(this.tabNavItems)) el.toggleClass('is-active', id === tab.id)
    this.tabContentContainer.empty()
    try {
      displayTab(tab)
    } catch (e) {
      console.error(e)
    }
    this.tabContentContainer.appendChild(tab.containerEl)
    this.updatePageTitle()
    this.tabContentContainer.scrollTop = 0
  }

  closeActiveTab(): void {
    this.clearPageStack()
    const tab = this.activeTab
    if (tab) {
      try {
        tab.hide()
      } catch (e) {
        console.error(e)
      }
    }
    this.activeTab = null
    this.tabContentContainer.empty()
  }

  openTabById(id: string): SettingTab | null {
    const tab = this.findTabById(id)
    if (tab) this.openTab(tab)
    return tab
  }

  // --- pages ----------------------------------------------------------------------------------

  openPage(page: SettingPage): void {
    const cur = this.getCurrentPageEl()
    page.settingManager = this
    this.pageStack.push({ page })
    cur?.detach()
    this.tabContentContainer.empty()
    page.display()
    this.tabContentContainer.appendChild(page.rootEl)
    this.updatePageTitle()
  }

  closePage(): void {
    const top = this.pageStack.pop()
    if (!top) return
    try {
      top.page.hide()
    } catch (e) {
      console.error(e)
    }
    this.tabContentContainer.empty()
    const prev = this.pageStack[this.pageStack.length - 1]
    if (prev) {
      prev.page.display()
      this.tabContentContainer.appendChild(prev.page.rootEl)
    } else if (this.activeTab) {
      displayTab(this.activeTab)
      this.tabContentContainer.appendChild(this.activeTab.containerEl)
    }
    this.updatePageTitle()
  }

  clearPageStack(): void {
    while (this.pageStack.length) {
      const p = this.pageStack.pop()!
      try {
        p.page.hide()
      } catch (e) {
        console.error(e)
      }
    }
    this.updatePageTitle()
  }

  getCurrentPageEl(): HTMLElement | undefined {
    const top = this.pageStack[this.pageStack.length - 1]
    return top ? top.page.rootEl : this.activeTab?.containerEl
  }

  /** Re-renders the current page/tab in place (after a visibility-affecting change). */
  refreshCurrentPage(): void {
    const top = this.pageStack[this.pageStack.length - 1]
    if (top) {
      top.page.hide()
      top.page.display()
    } else if (this.activeTab) displayTab(this.activeTab)
  }

  updatePageTitle(): void {
    const top = this.pageStack[this.pageStack.length - 1]
    this.titleTextEl.setText(top ? top.page.title : this.activeTab?.name ?? '')
    this.backButtonEl.toggle(this.pageStack.length > 0)
  }
  updateModalTitle(): void {
    this.updatePageTitle()
  }

  // --- lifecycle ------------------------------------------------------------------------------

  onOpen(): void {
    this.openTabById(this.lastTabId ?? '') ?? this.openTab(this.settingTabs[0])
    if (this.searchComponent.getValue()) this.searchComponent.setValue('')
    this.searchComponent.inputEl.focus()
  }

  /** Popout host (900x700) when `settingsPopoutWindow` is on: the modal element lives in a child window. */
  popout: { win: any; cleanup: () => void } | null = null
  private quitRef: any = null
  private unloadHandler: (() => void) | null = null
  popoutStorageKey = 'settings-window'
  windowTitle = 'Settings'

  shouldUsePopout(): boolean {
    return !!this.app.vault?.getConfig?.('settingsPopoutWindow')
  }

  getRootEl(): HTMLElement {
    return this.popout ? this.modalEl : this.containerEl
  }

  open(): void {
    if (this.popout && !this.popout.win.closed) {
      const ew = this.popout.win.electronWindow
      if (ew) {
        if (ew.isMinimized()) ew.restore()
        ew.focus()
      }
      return
    }
    if (this.popout) this.releasePopout()
    if (Platform.canPopoutWindow && this.shouldUsePopout()) {
      const saved = this.app.loadLocalStorage?.(this.popoutStorageKey) || {}
      this.popout = openPopupWindow({
        title: this.app.getAppTitle ? this.app.getAppTitle(this.windowTitle) : this.windowTitle || document.title,
        width: saved.width ?? 900,
        height: saved.height ?? 700,
        minWidth: 600,
        minHeight: 400,
        x: saved.x,
        y: saved.y,
        onClose: () => this.close()
      })
      if (this.popout) {
        const w = this.popout.win
        w.document.body.addClass('is-popout-modal')
        ;(window as any).activeWindow = w
        ;(window as any).activeDocument = w.document
        if (!this.modalEl.parentElement) this.containerEl.append(this.modalEl)
        this.quitRef = this.app.workspace?.on?.('quit', () => this.close())
        this.unloadHandler = () => this.popout?.cleanup()
        window.addEventListener('beforeunload', this.unloadHandler)
      }
    }
    // A popout open moves modalEl into the popout document; an in-window open must take it back, or the modal
    // shows as an empty dimmed container after the popout setting is switched off.
    if (!this.popout && this.modalEl.parentElement !== this.containerEl) this.containerEl.append(this.modalEl)
    super.open()
  }

  private releasePopout(): void {
    const p = this.popout
    if (p) {
      const w = p.win
      if (!w.closed) this.app.saveLocalStorage?.(this.popoutStorageKey, { x: w.screenX, y: w.screenY, width: w.outerWidth, height: w.outerHeight })
      p.cleanup()
    }
    if (this.quitRef) {
      this.app.workspace.offref(this.quitRef)
      this.quitRef = null
    }
    if (this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler)
      this.unloadHandler = null
    }
  }

  close(): void {
    this.app.vault?.requestSaveConfig?.()
    this.releasePopout()
    super.close()
    this.popout = null
  }

  onClose(): void {
    this.clearSearch()
    this.closeActiveTab()
  }

  onEscapeKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    // a tab capturing a key press (Hotkeys: "Press hotkey...") consumes Escape itself
    if ((this.activeTab as any)?.isCapturingKeys) return
    if (this.isSearchActive) {
      e.preventDefault()
      this.searchComponent.setValue('')
      this.onSearchChanged()
      return
    }
    if (this.pageStack.length) {
      e.preventDefault()
      this.closePage()
      return
    }
    super.onEscapeKey(e)
  }

  // --- legacy plugin-facing helpers (Quartz) --------------------------------------------------

  /** `app.setting.open()` then show `tab`. */
  openTabAndShow(tab: SettingTab): void {
    this.open()
    this.openTab(tab)
  }

  // --- search ---------------------------------------------------------------------------------

  private buildIndex(): Entry[] {
    const out: Entry[] = []
    const ev = (v: any): any => (typeof v === 'function' ? v() : v)
    const walk = (tab: SettingTab, defs: any[], path: any[]): void => {
      for (const def of defs || []) {
        if (def.visible !== undefined && !ev(def.visible)) continue
        const items = typeof def.items === 'function' ? def.items() : def.items
        if (def.type === 'group' || def.type === 'list') walk(tab, items || [], path)
        else if (def.type === 'page') {
          out.push({ tab, def, path, name: def.name, texts: [def.name, typeof def.desc === 'string' ? def.desc : ''] })
          if (items) walk(tab, items, [...path, def])
        } else if (def.searchable !== false && def.name) {
          out.push({ tab, def, path, name: def.name, texts: [def.name, typeof def.desc === 'string' ? def.desc : '', ...(def.aliases || [])] })
        }
      }
    }
    for (const tab of [...this.settingTabs, ...this.pluginTabs]) {
      let defs: any[] = []
      try {
        defs = tab.getSettingDefinitions?.() || []
      } catch {
        defs = []
      }
      walk(tab, defs, [])
    }
    return out
  }

  clearSearch(): void {
    this.isSearchActive = false
    this.searchResultsEl.hide()
    this.searchResultsEl.empty()
    this.tabGroupContainerEl.show()
    if (this.searchComponent.getValue()) this.searchComponent.inputEl.value = ''
  }

  refreshSearch(): void {
    this.onSearchChanged()
  }

  onSearchChanged(): void {
    const q = this.searchComponent.getValue().trim()
    if (!q) {
      this.isSearchActive = false
      this.searchResultsEl.hide()
      this.searchResultsEl.empty()
      this.tabGroupContainerEl.show()
      return
    }
    this.isSearchActive = true
    if (!this.searchIndex) this.searchIndex = this.buildIndex()
    const search = prepareSimpleSearch(q)
    const hits: { e: Entry; score: number; res: SearchResult; texts: number }[] = []
    for (const e of this.searchIndex) {
      let best: SearchResult | null = null
      let which = 0
      e.texts.forEach((txt, i) => {
        if (!txt) return
        const r0 = search(txt)
        // name matches outrank description / alias matches
        const r = r0 && i > 0 ? { ...r0, score: r0.score - 1000 } : r0
        if (r && (!best || r.score > best.score)) {
          best = r
          which = i
        }
      })
      if (best) hits.push({ e, score: (best as SearchResult).score, res: which === 0 ? (best as SearchResult) : (search(e.name) ?? { score: (best as SearchResult).score, matches: [] }), texts: which })
    }
    // tabs whose own name matches
    const tabHits: { tab: SettingTab; res: SearchResult }[] = []
    for (const tab of [...this.settingTabs, ...this.pluginTabs]) {
      const r = search(tab.name)
      if (r) tabHits.push({ tab, res: r })
    }
    const sorted = hits.slice()
    sorted.sort((a, b) => b.score - a.score)
    this.searchResultsEl.empty()
    const groups: { key: string; tab: SettingTab; page: Entry | null; items: typeof hits }[] = []
    const find = (key: string): (typeof groups)[number] | undefined => groups.find(g => g.key === key)
    for (const h of sorted) {
      if (h.e.def.type === 'page') {
        groups.push({ key: 'page:' + groups.length, tab: h.e.tab, page: h.e, items: [] })
        continue
      }
      const key = h.e.tab.id + '/' + h.e.path.map((p: any) => p.name).join('/')
      let g = find(key)
      if (!g) groups.push((g = { key, tab: h.e.tab, page: null, items: [] }))
      g.items.push(h)
    }
    for (const th of tabHits) {
      if (!groups.some(g => g.tab === th.tab && !g.page)) groups.push({ key: 'tab:' + th.tab.id, tab: th.tab, page: null, items: [] })
    }
    this.searchNavItems = []
    if (!groups.length) {
      this.searchResultsEl.createDiv({ cls: 'setting-search-no-results', text: t('setting.noSearchResults') })
    }
    for (const g of groups) {
      const grp = this.searchResultsEl.createDiv('setting-search-result-group')
      const head = grp.createDiv('vertical-tab-nav-item setting-search-result-tab tappable')
      setIcon(head.createDiv('vertical-tab-nav-item-icon'), g.tab.icon || '')
      const text = head.createDiv('setting-search-result-tab-text')
      const label = text.createDiv('setting-search-result-tab-label')
      if (g.page) {
        renderResults(label, g.page.name, search(g.page.name))
        text.createDiv({ cls: 'setting-search-result-tab-sublabel', text: g.tab.name })
        head.addEventListener('click', () => this.navigateToSearchResult(g.tab, g.page!.path, g.page!.def))
      } else {
        const tr = tabHits.find(x => x.tab === g.tab)
        if (tr) renderResults(label, g.tab.name, tr.res)
        else label.setText(g.tab.name)
        head.addEventListener('click', () => this.navigateToSearchResult(g.tab, g.items[0]?.e.path ?? [], null))
      }
      setIcon(head.createDiv('vertical-tab-nav-item-chevron'), 'lucide-chevron-right')
      this.searchNavItems.push(head)
      if (g.items.length) {
        const items = grp.createDiv('setting-search-result-group-items')
        for (const h of g.items) {
          const row = items.createDiv('vertical-tab-nav-item setting-search-result-item tappable')
          const title = row.createDiv('vertical-tab-nav-item-title')
          renderResults(title, h.e.name, h.texts === 0 ? h.res : search(h.e.name))
          setIcon(row.createDiv('vertical-tab-nav-item-chevron'), 'lucide-chevron-right')
          row.addEventListener('click', () => this.navigateToSearchResult(h.e.tab, h.e.path, h.e.def))
          this.searchNavItems.push(row)
        }
      }
    }
    this.tabGroupContainerEl.hide()
    this.searchResultsEl.show()
  }

  navigateToSearchResult(tab: SettingTab, path: any[], def: any | null): void {
    this.openTab(tab, true)
    if (def && def.type === 'page') {
      // open nested pages down to (and including) the matched page
      const chain = [...path, def]
      this.openPagePath(tab, chain)
      return
    }
    if (path.length) this.openPagePath(tab, path)
    if (def) this.scrollToDefinition(tab, def)
  }

  /** The rendered row of a definition (indexes are rebuilt from fresh definitions, so match by name). */
  private rowFor(tab: SettingTab, def: any): HTMLElement | undefined {
    const map: Map<any, HTMLElement> = (tab as any).defEls
    if (map.has(def)) return map.get(def)
    for (const [d, el] of map) if (d.name === def.name && d.type === def.type) return el
    return undefined
  }

  openPagePath(tab: SettingTab, chain: any[]): void {
    for (const p of chain) this.rowFor(tab, p)?.click()
  }

  scrollToDefinition(tab: SettingTab, def: any): void {
    const el = this.rowFor(tab, def)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus({ focusVisible: true, preventScroll: true } as FocusOptions)
    el.addClass('is-flashing')
    el.win.setTimeout(() => el.removeClass('is-flashing'), 750)
  }

  // --- Events (Modal has none) ----------------------------------------------------------------
  private listeners = new Map<string, Set<(...a: any[]) => any>>()
  on(name: string, cb: (...a: any[]) => any): { e: any; name: string; fn: any } {
    let s = this.listeners.get(name)
    if (!s) this.listeners.set(name, (s = new Set()))
    s.add(cb)
    const ref: any = { e: { offref: (r: any) => this.listeners.get(r.name)?.delete(r.fn) }, name, fn: cb }
    return ref
  }
  off(name: string, cb: (...a: any[]) => any): void {
    this.listeners.get(name)?.delete(cb)
  }
  offref(ref: any): void {
    this.listeners.get(ref.name)?.delete(ref.fn)
  }
  trigger(name: string, ...args: any[]): void {
    for (const cb of [...(this.listeners.get(name) ?? [])]) {
      try {
        cb(...args)
      } catch (e) {
        console.error(e)
      }
    }
  }
}
