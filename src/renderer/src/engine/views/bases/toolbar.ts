/* eslint-disable @typescript-eslint/no-explicit-any */
// The Bases toolbar: views / results / sort / group / filter / properties / search / new item.
// Each popover is a page stack (see popover.ts / pages.ts / filterEditor.ts).
import { Component } from '../../core/Component'
import { SearchComponent } from '../../ui/setting'
import { setIcon } from '../../ui/icons'
import { type ViewConfig } from './BaseConfig'
import { FilterMenu } from './filterEditor'
import { GroupPage, PropertiesPage, PropertyEditPage, ResultsPage, SortPage, ViewConfigPage, ViewsPage, type ResultsHost } from './pages'
import { L, TextButton, ToolbarItem } from './popover'
import type { QueryController } from './QueryController'
import type { BasesQueryResult } from './query'
import { bt } from './strings'

export { INVALID_VIEW_NAME } from './pages'

const results = (n: number): string => `${n} ${n === 1 ? 'result' : 'results'}`

export class Toolbar {
  el: HTMLElement
  views: ToolbarItem
  results: ToolbarItem
  sort: ToolbarItem
  group: ToolbarItem
  filter: FilterMenu
  properties: ToolbarItem
  searchButton: TextButton
  searchRowEl: HTMLElement
  newItem: TextButton
  private searchComp: SearchComponent
  private searchOpen = false
  private viewsPage: ViewsPage | null = null
  private groupPage: GroupPage | null = null
  private sortPage: SortPage | null = null
  private resultHost: ResultsHost & { shown: number }
  private sortFlair: HTMLElement
  private lastCfg: ViewConfig | null = null

  constructor(private c: QueryController) {
    const app = c.app
    this.el = c.viewHeaderEl.createDiv('bases-toolbar')
    // views
    const views = (this.views = new ToolbarItem(app, this.el, L('labelViews'), 'lucide-table'))
    views.addClass('bases-toolbar-views-menu')
    views.menu.setRootPage(
      () =>
        (this.viewsPage = new ViewsPage(views.menu, c)
          .onSelect(v => {
            void c.selectView(v.name)
            views.menu.close()
          })
          .onNext(v => views.menu.show(new ViewConfigPage(views.menu, c, v, false))))
    )
    views.button.buttonEl.addEventListener('contextmenu', e => {
      e.preventDefault()
      const cfg = c.getViewConfig()
      if (cfg) {
        views.setOpen(true)
        views.menu.show(new ViewConfigPage(views.menu, c, cfg, false))
      }
    })
    setIcon(views.button.buttonEl.createSpan({ cls: 'text-button-icon mod-aux' }), 'lucide-chevrons-up-down')
    // results
    const resultsItem = (this.results = new ToolbarItem(app, this.el, L('labelResults'), 'lucide-text-align-start'))
    resultsItem.addClass('bases-toolbar-results-menu')
    resultsItem.containerEl.addClass('bases-toolbar-result-count')
    this.resultHost = {
      shown: 0,
      resultCount: 0,
      viewConfig: null,
      copyToClipboard: () => c.copyToClipboard(),
      exportCsv: () => void c.exportCsv()
    }
    resultsItem.menu.setRootPage(() => new ResultsPage(resultsItem.menu, this.resultHost))
    // sort
    const sort = (this.sort = new ToolbarItem(app, this.el, L('labelSort'), 'lucide-arrow-up-down'))
    sort.addClass('bases-toolbar-sort-menu')
    sort.menu.setRootPage(() => (this.sortPage = new SortPage(sort.menu, c)))
    this.sortFlair = sort.button.buttonEl.createSpan({ cls: 'flair toolbar-badge' })
    this.sortFlair.hide()
    // group
    const group = (this.group = new ToolbarItem(app, this.el, L('labelGroup'), 'lucide-stretch-horizontal'))
    group.addClass('bases-toolbar-group-menu')
    group.menu.setRootPage(() => (this.groupPage = new GroupPage(group.menu, c)))
    // filter
    this.filter = new FilterMenu(c, this.el)
    // properties
    const props = (this.properties = new ToolbarItem(app, this.el, L('labelProperties'), 'lucide-list'))
    props.addClass('bases-toolbar-properties-menu')
    props.menu.setRootPage(() => new PropertiesPage(props.menu, c))
    // search
    this.searchRowEl = c.containerEl.createDiv('bases-search-row')
    this.searchRowEl.hide()
    const searchItem = this.el.createDiv('bases-toolbar-item bases-toolbar-search')
    this.searchButton = new TextButton(searchItem).setIcon('lucide-search').setText(L('labelSearch')).onClick(() => this.toggleSearch())
    this.searchComp = new SearchComponent(this.searchRowEl).setClass('document-search-input').setPlaceholder(bt('editor.search.placeholderFind'))
    this.searchComp.onChange(v => {
      this.searchCountEl.toggle(!!v)
      c.updateSearchQuery(v)
    })
    this.searchCountEl = this.searchComp.containerEl.createDiv('document-search-count')
    this.searchCountEl.hide()
    this.searchComp.inputEl.addEventListener('keydown', e => e.key === 'Escape' && this.closeSearch())
    // new item
    const newWrap = this.el.createDiv('bases-toolbar-item bases-toolbar-new-item-menu')
    this.newItem = new TextButton(newWrap).setIcon('lucide-plus').setText(L('labelNewItem')).onClick(() => void c.createFileForView())
  }
  private searchCountEl!: HTMLElement

  private toggleSearch(): void {
    if (this.searchOpen) this.closeSearch()
    else this.openSearch()
  }
  openSearch(): void {
    this.searchComp.inputEl.value = this.c.getSearchQuery() ?? ''
    if (!this.searchOpen) {
      this.searchOpen = true
      this.searchButton.buttonEl.addClass('is-active')
      this.searchRowEl.show()
    }
    this.searchComp.inputEl.focus({ preventScroll: true })
    this.searchComp.inputEl.select()
  }
  closeSearch(): void {
    if (!this.searchOpen) return
    this.searchOpen = false
    this.searchButton.buttonEl.removeClass('is-active')
    this.searchRowEl.hide()
    this.c.updateSearchQuery(null)
  }
  updateSearchCount(n: number): void {
    this.searchCountEl.setText(L('labelSearchResults', { count: n }))
  }

  /** Open the "Add view" form (bases:add-view). */
  promptAddView(): void {
    this.views.setOpen(true)
    this.views.menu.backToRoot()
    this.viewsPage?.addView()
  }

  /** Open the Properties popover on a property's edit page (used by the table header menu). */
  openPropertyEdit(id: string): void {
    this.properties.setOpen(true)
    this.properties.menu.show(new PropertyEditPage(this.properties.menu, this.c, id, false))
  }

  update(result: BasesQueryResult, cfg: ViewConfig, total?: number): void {
    this.lastCfg = cfg
    this.setView(cfg)
    const count = total ?? result.data.length
    const limit = cfg.getLimit()
    const shown = limit > 0 && count > limit ? limit : count
    this.resultHost.viewConfig = cfg
    this.resultHost.resultCount = count
    this.resultHost.shown = shown
    this.results.button.setText(results(shown))
    this.results.button.buttonEl.toggleClass('is-active', shown < count)
    const sorts = cfg.getSort().length
    this.sortFlair.setText(String(sorts))
    this.sortFlair.toggle(sorts > 0)
    this.sort.button.buttonEl.toggleClass('is-active', sorts > 0)
    if (this.sortPage?.isShown) this.sortPage.display()
    this.group.button.buttonEl.toggleClass('is-active', !!cfg.groupBy)
    if (this.groupPage?.isShown) this.groupPage.refresh()
    this.filter.updateQuery(this.c.query, cfg)
    this.properties.button.buttonEl.toggleClass('mod-error', Object.values(this.c.query.formulas ?? {}).some(f => f.isInvalid))
    this.updateSearchCount(this.c.getSearchCount())
  }
  setView(cfg: ViewConfig | null, missing = false): void {
    if (!cfg) return
    this.views.button.setText(cfg.name)
    this.views.button.setIcon(missing ? 'lucide-file-question' : this.c.plugin.getRegistration(cfg.type)?.icon || 'lucide-file-question')
  }
  updateViewsLabel(): void {
    if (this.lastCfg) this.setView(this.lastCfg)
  }
  setEnabled(on: boolean): void {
    this.filter.setEnabled(on)
    this.properties.setEnabled(on)
    this.group.setEnabled(on)
  }
}

void Component
