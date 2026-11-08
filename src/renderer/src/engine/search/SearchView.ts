// The global search view (view type `search`, left sidebar) — DOM:
//   .workspace-leaf-content[data-type=search]
//     > .search-row > .search-input-container.global-search-input-container
//                       (input[type=search], .search-input-clear-button, .input-right-decorator match-case)
//                   + .clickable-icon (search settings toggle)
//     > .search-info-container (explain / parse errors)
//     > .search-params (Collapse results / Show more context / Explain search terms toggles)
//     > .search-results-info > .search-results-result-count (span + more-options) + select.dropdown (sort)
//     > .search-result-container.mod-global-search
// State (workspace.json): { query, matchingCase, explainSearch, collapseAll, extraContext, sortOrder }.
import type { TFile } from 'obsidian'
import { View, ViewStateResult } from '../view/View'
import type { WorkspaceLeaf } from '../workspace/WorkspaceLeaf'
import { setIcon, setTooltip } from '../workspace/dom'
import { Menu } from '../workspace/Menu'
import { Scope } from '../keymap/Keymap'
import { SearchQuery } from './query'
import { renderSearchError, renderSearchInfo, resultCountText } from './explain'
export { resultCountText }
import { appSearchEnvironment, runSearch, SearchAppLike, SearchQueue } from './runner'
import { SearchResultDom, SearchResultFileItem, SearchResultMatchItem } from './ResultDom'
import { isSortOrder, SORT_ORDER_GROUPS, SORT_ORDER_LABELS } from './sort'
import { CopySearchResultsModal } from './CopySearchResultsModal'
import { createSearchInput, createToggleSetting, SearchInput, ToggleSetting } from './widgets'

export const VIEW_TYPE_SEARCH = 'search'

export const SEARCH_STRINGS = {
  name: 'Search',
  promptStartSearch: 'Search...',
  labelMatchCase: 'Match case',
  tooltipClearSearch: 'Clear search',
  labelToggleSearchSettings: 'Search settings',
  labelCollapseResults: 'Collapse results',
  labelMoreContext: 'Show more context',
  labelExplainSearchTerm: 'Explain search terms',
  labelCopySearchResults: 'Copy search results',
  labelNoMatches: 'No matches found.'
}


function debounce0(fn: () => void): () => void {
  let t: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      t = null
      fn()
    }, 0)
  }
}

export class SearchView extends View {
  icon = 'lucide-search'
  navigation = false
  declare app: any
  searchContainerEl: HTMLElement | null = null
  searchInfoEl!: HTMLElement
  infoEl!: HTMLElement
  resultCountEl!: HTMLElement
  matchingCase = false
  explainSearch = false
  showParams = false
  searchQuery: SearchQuery | null = null
  dom: SearchResultDom
  matchingCaseButtonEl!: HTMLElement
  searchComponent!: SearchInput
  filterSectionToggleEl!: HTMLElement
  collapseResultsToggle!: ToggleSetting
  extraContextToggle!: ToggleSetting
  explainSearchToggle!: ToggleSetting
  searchParamsContainerEl!: HTMLElement
  sortOrderDropdown!: HTMLSelectElement
  queue: SearchQueue
  private saveSearchTimer: ReturnType<typeof setTimeout> | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const containerEl = this.containerEl
    const resultsEl = createDiv('search-result-container mod-global-search')
    const app = this.app as SearchAppLike
    this.dom = new SearchResultDom(app as any, resultsEl, SEARCH_STRINGS.labelNoMatches)
    const env = appSearchEnvironment(app)
    this.dom.getCanvasCaches = env.getCanvasCaches!
    const startSoon = debounce0(() => this.startSearch())
    const row = containerEl.createDiv('search-row')
    this.searchComponent = createSearchInput(row, {
      placeholder: SEARCH_STRINGS.promptStartSearch,
      cls: 'global-search-input-container',
      clearTooltip: SEARCH_STRINGS.tooltipClearSearch,
      onChange: (v) => {
        this.dom.setFocusedItem(null)
        this.stopSearch()
        if (v) startSoon()
        else {
          this.startSearch()
          this.infoEl.hide()
        }
      }
    })
    this.matchingCaseButtonEl = this.searchComponent.addRightDecorator((el) => {
      setTooltip(el, SEARCH_STRINGS.labelMatchCase)
      setIcon(el, 'uppercase-lowercase-a')
      el.addClass('clickable-icon')
      el.addEventListener('click', () => this.setMatchingCase(!this.matchingCase))
    })
    this.searchComponent.inputEl.addEventListener('keypress', (e) => {
      if (!e.isComposing && e.key === 'Enter') this.startSearch()
    })
    this.searchInfoEl = containerEl.createDiv({ cls: 'search-info-container' })
    this.searchInfoEl.hide()
    this.filterSectionToggleEl = row.createDiv('clickable-icon', (el) => {
      setTooltip(el, SEARCH_STRINGS.labelToggleSearchSettings)
      setIcon(el, 'lucide-sliders-horizontal')
      el.addEventListener('click', () => this.toggleFilterSection())
    })
    this.searchParamsContainerEl = containerEl.createDiv('search-params', (el) => {
      this.collapseResultsToggle = createToggleSetting(el, SEARCH_STRINGS.labelCollapseResults, (v) => this.setCollapseAll(v))
      this.extraContextToggle = createToggleSetting(el, SEARCH_STRINGS.labelMoreContext, (v) => this.setExtraContext(v))
      this.explainSearchToggle = createToggleSetting(el, SEARCH_STRINGS.labelExplainSearchTerm, (v) => this.setExplainSearch(v))
    })
    this.searchParamsContainerEl.hide()
    this.infoEl = containerEl.createDiv('search-results-info', (el) => {
      el.createDiv('clickable-icon search-results-result-count', (c) => {
        this.resultCountEl = c.createSpan()
        c.createDiv('more-options-icon', (m) => setIcon(m, 'lucide-more-horizontal'))
        c.addEventListener('click', (evt) => {
          if (c.classList.contains('has-active-menu')) return
          const menu = new Menu().addSections(['action']).addItem((item) =>
            item.setSection('action').setIcon('lucide-copy').setTitle(SEARCH_STRINGS.labelCopySearchResults).onClick((e: any) => this.onCopyResultsClick(e))
          )
          this.app.workspace?.trigger?.('search:results-menu', menu, this)
          menu.setParentElement(c).showAtMouseEvent(evt)
        })
      })
      const sel = (this.sortOrderDropdown = el.createEl('select', 'dropdown'))
      for (const group of SORT_ORDER_GROUPS) for (const o of group) sel.createEl('option', { value: o, text: SORT_ORDER_LABELS[o] })
      sel.value = 'alphabetical'
      sel.addEventListener('change', () => {
        this.setSortOrder(sel.value)
        this.app.workspace?.requestSaveLayout?.()
      })
    })
    this.infoEl.hide()
    containerEl.appendChild(resultsEl)
    const scope = (this.scope = new Scope(this.app.scope))
    scope.register([], 'Enter', (e) => this.onKeyEnterInFocus(e))
    scope.register(['Mod'], 'Enter', (e) => this.onKeyEnterInFocus(e))
    scope.register([], 'ArrowDown', (e) => this.onKeyArrowDownInFocus(e))
    scope.register([], 'ArrowUp', (e) => this.onKeyArrowUpInFocus(e))
    scope.register([], 'ArrowLeft', (e) => this.onKeyArrowLeftInFocus(e))
    scope.register([], 'ArrowRight', (e) => this.onKeyArrowRightInFocus(e))
    scope.register(['Shift'], 'ArrowUp', () => this.onKeyShowMoreBefore())
    scope.register(['Shift'], 'ArrowDown', () => this.onKeyShowMoreAfter())
    this.queue = new SearchQueue(app, this.dom)
    this.addChild(this.queue)
  }

  protected async onOpen(): Promise<void> {
    const tab = (this.leaf as any).tabHeaderEl as HTMLElement | undefined
    if (tab) this.registerDomEvent(tab, 'click', () => this.onTabHeaderClick())
  }

  toggleFilterSection(): void {
    this.showParams = !this.showParams
    this.filterSectionToggleEl.toggleClass('is-active', this.showParams)
    this.searchParamsContainerEl.toggle(this.showParams)
  }

  private requestSaveSearch(): void {
    if (this.saveSearchTimer) clearTimeout(this.saveSearchTimer)
    this.saveSearchTimer = setTimeout(() => {
      this.saveSearchTimer = null
      this.saveSearch()
    }, 5000)
  }

  /** Remember the query in `<appId>-recent-searches` (MRU, max 20). */
  saveSearch(): void {
    const q = this.searchComponent.getValue()
    if (!q) return
    let list = loadLocal(this.app, 'recent-searches')
    if (!Array.isArray(list)) list = []
    list = list.filter((x: string) => x !== q)
    list.unshift(q)
    if (list.length > 20) list = list.slice(0, 20)
    saveLocal(this.app, 'recent-searches', list)
  }

  getDisplayText(): string {
    return SEARCH_STRINGS.name
  }
  getViewType(): string {
    return VIEW_TYPE_SEARCH
  }

  getState(): Record<string, unknown> {
    const s = super.getState()
    s.query = this.getQuery()
    s.matchingCase = this.matchingCase
    s.explainSearch = this.explainSearch
    s.collapseAll = this.dom.collapseAll
    s.extraContext = this.dom.extraContext
    s.sortOrder = this.dom.sortOrder
    return s
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    await super.setState(state, result)
    if (!state) return
    const { query, matchingCase, explainSearch, collapseAll, extraContext, sortOrder } = state
    if (typeof query === 'string' || query === null) this.setQuery(query)
    if (typeof matchingCase === 'boolean') this.setMatchingCase(matchingCase)
    if (typeof explainSearch === 'boolean') this.explainSearchToggle.setValue(explainSearch)
    if (typeof collapseAll === 'boolean') this.collapseResultsToggle.setValue(collapseAll)
    if (typeof extraContext === 'boolean') this.extraContextToggle.setValue(extraContext)
    if (isSortOrder(sortOrder)) {
      this.sortOrderDropdown.value = sortOrder
      this.setSortOrder(sortOrder)
    }
  }

  setEphemeralState(state: any): void {
    super.setEphemeralState(state)
    if (state && state.focus) {
      const input = this.searchComponent.inputEl
      input.setSelectionRange(0, input.value.length)
      input.focus({ preventScroll: true })
    }
  }

  setMatchingCase(v: boolean): void {
    if (v === this.matchingCase) return
    this.matchingCase = v
    this.matchingCaseButtonEl.toggleClass('is-active', v)
    this.app.workspace?.requestSaveLayout?.()
    if (this.searchComponent.getValue() !== '') this.startSearch()
  }
  setExplainSearch(v: boolean): void {
    if (v === this.explainSearch) return
    this.explainSearch = v
    this.searchInfoEl.toggle(v)
    this.app.workspace?.requestSaveLayout?.()
  }
  setCollapseAll(v: boolean): void {
    if (v === this.dom.collapseAll) return
    this.dom.setCollapseAll(v)
    this.app.workspace?.requestSaveLayout?.()
  }
  setExtraContext(v: boolean): void {
    if (v === this.dom.extraContext) return
    this.dom.setExtraContext(v)
    this.app.workspace?.requestSaveLayout?.()
  }

  onCopyResultsClick(e?: Event): void {
    e?.preventDefault?.()
    new CopySearchResultsModal(this.app, this.dom).open()
  }

  onKeyEnterInFocus(e: KeyboardEvent): void {
    const f = this.dom.focusedItem
    if (f && (f instanceof SearchResultMatchItem || f instanceof SearchResultFileItem)) f.onResultClick(e)
  }
  onKeyArrowUpInFocus(e: KeyboardEvent): void {
    e.preventDefault()
    this.dom.changeFocusedItem('backwards')
  }
  onKeyArrowDownInFocus(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    e.preventDefault()
    this.dom.changeFocusedItem('forwards')
  }
  onKeyArrowLeftInFocus(e: KeyboardEvent): void {
    if (document.activeElement === this.searchComponent.inputEl) return
    e.preventDefault()
    const f = this.dom.focusedItem
    if (f instanceof SearchResultFileItem) f.setCollapse(true, true)
    else if (f && (f as any).parent instanceof SearchResultFileItem) {
      const p = (f as any).parent as SearchResultFileItem
      p.setCollapse(true, true)
      this.dom.setFocusedItem(p)
    } else if (!f) this.dom.setCollapseAll(true)
  }
  onKeyArrowRightInFocus(e: KeyboardEvent): void {
    if (document.activeElement === this.searchComponent.inputEl) return
    e.preventDefault()
    const f = this.dom.focusedItem
    if (!f) this.dom.setCollapseAll(false)
    else if (f instanceof SearchResultFileItem) f.setCollapse(false, true)
  }
  onKeyShowMoreBefore(): void {
    const f = this.dom.focusedItem
    if (f instanceof SearchResultMatchItem) f.showMoreBefore()
  }
  onKeyShowMoreAfter(): void {
    const f = this.dom.focusedItem
    if (f instanceof SearchResultMatchItem) f.showMoreAfter()
  }

  setSortOrder(order: string): void {
    this.dom.sortOrder = order
    this.dom.changed()
  }

  onResize(): void {
    this.dom.onResize()
  }

  startSearch(): void {
    this.stopSearch()
    const { dom, searchInfoEl } = this
    const app = this.app as SearchAppLike
    dom.emptyResults()
    dom.setFocusedItem(null)
    try {
      const q = this.searchComponent.getValue()
      const sq = new SearchQuery(appSearchEnvironment(app), q, this.matchingCase)
      if (!sq.matcher) return
      this.searchQuery = sq
      renderSearchInfo(sq.matcher, searchInfoEl)
      const updateCount = (): void => {
        this.resultCountEl.setText(resultCountText(dom.getMatchCount()))
      }
      const queue = this.queue.start({ onStop: updateCount })
      this.infoEl.show()
      void runSearch(
        app,
        sq.requiredInputs,
        queue,
        (file: TFile, content: string) => {
          const r = sq.match(file, content)
          if (r) dom.addResult(file, r, content)
          else dom.removeResult(file)
        },
        updateCount
      )
    } catch (e: any) {
      renderSearchError(e?.message ?? String(e), searchInfoEl)
      console.log(e)
    }
    this.app.workspace?.requestSaveLayout?.()
    this.requestSaveSearch()
  }

  stopSearch(): void {
    this.queue.stop()
    this.searchInfoEl.empty()
  }

  setQuery(q: string | null): void {
    if (typeof q === 'string') this.searchComponent.setValue(q)
    this.startSearch()
  }

  getQuery(): string {
    return this.searchComponent.getValue()
  }

  onTabHeaderClick(): void {
    const input = this.searchComponent.inputEl
    input.focus()
    input.select()
  }

  async onClose(): Promise<void> {
    if (this.saveSearchTimer) {
      clearTimeout(this.saveSearchTimer)
      this.saveSearch()
    }
  }
}

function loadLocal(app: any, key: string): any {
  if (typeof app.loadLocalStorage === 'function') return app.loadLocalStorage(key)
  try {
    const v = localStorage.getItem(`${app.appId}-${key}`)
    return v === null ? null : JSON.parse(v)
  } catch {
    return null
  }
}
function saveLocal(app: any, key: string, value: unknown): void {
  if (typeof app.saveLocalStorage === 'function') return app.saveLocalStorage(key, value)
  try {
    localStorage.setItem(`${app.appId}-${key}`, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

/** Register the `search` view type (left sidebar). */
export function registerSearchView(app: any): void {
  const reg = app.viewRegistry
  if (reg && !reg.getViewCreatorByType?.(VIEW_TYPE_SEARCH)) reg.registerView(VIEW_TYPE_SEARCH, (leaf: WorkspaceLeaf) => new SearchView(leaf))
}

/** `global-search` plugin `openGlobalSearch`: reveal (or create) the left search leaf with `query`. */
export function openGlobalSearch(app: any, query: string, active = true): void {
  void app.workspace.ensureSideLeaf(VIEW_TYPE_SEARCH, 'left', { active, reveal: true, state: { query } })
}

/** `global-search` plugin `getGlobalSearchQuery`. */
export function getGlobalSearchQuery(app: any): string {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH)
  if (leaves.length === 0) return ''
  const s = leaves[0].getViewState()
  return typeof s?.state?.query === 'string' ? s.state.query : ''
}
