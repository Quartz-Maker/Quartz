/* eslint-disable @typescript-eslint/no-explicit-any */
// "backlink" view (backlink core plugin), DOM:
//   .workspace-leaf-content[data-type=backlink] > .view-header + .view-content
//   .view-content > .nav-header (Collapse results / Show more context / Change sort order /
//                   Show search filter + .search-input-container)
//                 + .backlink-pane[style=position:relative]
//                     > section "Linked mentions"   + .search-result-container (SearchResultDom)
//                     > section "Unlinked mentions" + .search-result-container (each match row
//                       gets button.search-result-file-match-replace-button "Link")
// Leaf state {file, collapseAll, extraContext, sortOrder, showSearch, searchQuery,
//             backlinkCollapsed, unlinkedCollapsed} (key order matters).
// Unlinked mentions are only computed while that section is expanded.
import { ItemView } from '../../view/View'
import { Component } from '../../core/Component'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { Menu } from '../../ui/Menu'
import { SearchResultDom } from '../../search/ResultDom'
import { SORT_ORDER_GROUPS, SORT_ORDER_LABELS, isSortOrder } from '../../search/sort'
import { createNavHeader, navButton } from '../properties/AllPropertiesView'
import { CollapsibleSection, STRINGS, aliasesOf, debounceFn, excludedRanges, findMentions } from './common'
import type { Range } from '../../search/query'

export const VIEW_TYPE_BACKLINK = 'backlink'

/** Navigation header shared by backlink-style panes: buttons + hidden search input. */
export function backlinkNavHeader(parent: HTMLElement) {
  const nav = createNavHeader(parent)
  const clear = nav.searchEl.querySelector('.search-input-clear-button')
  clear?.setAttribute('aria-label', STRINGS.clearSearch)
  return nav
}

/**
 * Backlinks UI: nav header + Linked / Unlinked mentions for `file`. Used by the backlink pane and by
 * markdown views (`.embedded-backlinks`, "backlinks in document").
 */
export class Backlinks extends Component {
  app: any
  file: any = null
  collapseAll = false
  extraContext = false
  sortOrder = 'alphabetical'
  showSearch = false
  searchQuery = ''
  backlinkCollapsed = false
  unlinkedCollapsed = true
  paneEl: HTMLElement
  nav: ReturnType<typeof createNavHeader>
  collapseAllButtonEl: HTMLElement
  extraContextButtonEl: HTMLElement
  showSearchButtonEl: HTMLElement
  linked: CollapsibleSection
  unlinked: CollapsibleSection
  backlinkDom: SearchResultDom
  unlinkedDom: SearchResultDom
  requestUpdate: (() => void) & { cancel(): void }
  private gen = 0

  constructor(app: any, public containerEl: HTMLElement, private onStateChange: () => void = () => app.workspace.requestSaveLayout()) {
    super()
    this.app = app
    this.nav = backlinkNavHeader(containerEl)
    const b = this.nav.buttonsEl
    this.collapseAllButtonEl = navButton(b, 'lucide-list', STRINGS.collapseResults, () => this.setCollapseAll(!this.collapseAll))
    this.extraContextButtonEl = navButton(b, 'lucide-move-vertical', STRINGS.moreContext, () => this.setExtraContext(!this.extraContext))
    navButton(b, 'lucide-sort-asc', STRINGS.changeSort, evt => this.showSortMenu(evt))
    this.showSearchButtonEl = navButton(b, 'lucide-search', STRINGS.showSearch, () => this.setShowSearch(!this.showSearch))
    this.nav.inputEl.addEventListener('input', () => {
      this.searchQuery = this.nav.inputEl.value
      this.applyFilter()
      this.onStateChange()
    })
    const pane = (this.paneEl = containerEl.createDiv('backlink-pane node-insert-event'))
    pane.style.position = 'relative'
    this.linked = new CollapsibleSection(pane, STRINGS.linkedMentions, c => {
      this.backlinkCollapsed = c
      this.onStateChange()
    })
    this.backlinkDom = new SearchResultDom(this.app as any, this.linked.containerEl, STRINGS.noBacklinks)
    this.unlinked = new CollapsibleSection(pane, STRINGS.unlinkedMentions, c => {
      this.unlinkedCollapsed = c
      if (!c) this.update()
      this.onStateChange()
    })
    this.unlinkedDom = new SearchResultDom(this.app as any, this.unlinked.containerEl, STRINGS.noUnlinked)
    this.unlinked.setCollapsed(true)
    this.unlinked.setCount(null)
    this.requestUpdate = debounceFn(() => this.update(), 100)
  }

  getState(): Record<string, unknown> {
    const s: Record<string, unknown> = {}
    Object.assign(s, {
      collapseAll: this.collapseAll,
      extraContext: this.extraContext,
      sortOrder: this.sortOrder,
      showSearch: this.showSearch,
      searchQuery: this.searchQuery,
      backlinkCollapsed: this.backlinkCollapsed,
      unlinkedCollapsed: this.unlinkedCollapsed
    })
    return s
  }

  setState(state: any): void {
    state = state || {}
    if (typeof state.file === 'string') {
      const f = (this.app.vault as any).getAbstractFileByPath(state.file)
      if (f && typeof f.extension === 'string') this.setFile(f)
    }
    if (typeof state.collapseAll === 'boolean') this.setCollapseAll(state.collapseAll, false)
    if (typeof state.extraContext === 'boolean') this.setExtraContext(state.extraContext, false)
    if (isSortOrder(state.sortOrder)) this.setSortOrder(state.sortOrder, false)
    if (typeof state.searchQuery === 'string') {
      this.searchQuery = state.searchQuery
      this.nav.inputEl.value = state.searchQuery
    }
    if (typeof state.showSearch === 'boolean') this.setShowSearch(state.showSearch, false)
    if (typeof state.backlinkCollapsed === 'boolean') {
      this.backlinkCollapsed = state.backlinkCollapsed
      this.linked.setCollapsed(state.backlinkCollapsed)
    }
    if (typeof state.unlinkedCollapsed === 'boolean') {
      const was = this.unlinkedCollapsed
      this.unlinkedCollapsed = state.unlinkedCollapsed
      this.unlinked.setCollapsed(state.unlinkedCollapsed)
      if (was && !state.unlinkedCollapsed) this.update()
    }
  }

  onload(): void {
    const mc: any = this.app.metadataCache
    const vault: any = this.app.vault
    if (mc) {
      this.registerEvent(mc.on('resolved', () => this.requestUpdate()))
      this.registerEvent(mc.on('changed', () => this.requestUpdate()))
    }
    this.registerEvent(vault.on('rename', () => this.requestUpdate()))
    this.registerEvent(vault.on('delete', (f: any) => {
      if (f === this.file) this.setFile(null)
      else this.requestUpdate()
    }))
    this.register(() => this.requestUpdate.cancel())
  }

  setFile(file: any): void {
    if (file === this.file) return
    this.file = file
    this.backlinkDom.emptyResults()
    this.unlinkedDom.emptyResults()
    this.update()
  }

  setCollapseAll(v: boolean, save = true): void {
    this.collapseAll = v
    this.collapseAllButtonEl.toggleClass('is-active', v)
    this.collapseAllButtonEl.setAttribute('aria-label', v ? STRINGS.expandResults : STRINGS.collapseResults)
    this.backlinkDom.setCollapseAll(v)
    this.unlinkedDom.setCollapseAll(v)
    if (save) this.onStateChange()
  }

  setExtraContext(v: boolean, save = true): void {
    this.extraContext = v
    this.extraContextButtonEl.toggleClass('is-active', v)
    this.extraContextButtonEl.setAttribute('aria-label', v ? STRINGS.lessContext : STRINGS.moreContext)
    this.backlinkDom.setExtraContext(v)
    this.unlinkedDom.setExtraContext(v)
    if (save) this.onStateChange()
  }

  setSortOrder(order: string, save = true): void {
    this.sortOrder = order
    this.backlinkDom.sortOrder = order
    this.unlinkedDom.sortOrder = order
    this.backlinkDom.changed()
    this.unlinkedDom.changed()
    if (save) this.onStateChange()
  }

  setShowSearch(v: boolean, save = true): void {
    this.showSearch = v
    this.showSearchButtonEl.toggleClass('is-active', v)
    this.nav.searchEl.toggle(v)
    if (v) this.nav.inputEl.focus()
    this.applyFilter()
    if (save) this.onStateChange()
  }

  showSortMenu(evt: MouseEvent): void {
    const m = new Menu()
    SORT_ORDER_GROUPS.forEach((group, i) => {
      if (i > 0) m.addSeparator()
      for (const id of group) m.addItem(it => it.setTitle(SORT_ORDER_LABELS[id]).setChecked(this.sortOrder === id).onClick(() => this.setSortOrder(id)))
    })
    m.showAtMouseEvent(evt)
  }

  /** Search filter: hide files whose path and matched text don't contain the query. */
  applyFilter(): void {
    const q = this.showSearch ? this.searchQuery.trim().toLowerCase() : ''
    for (const dom of [this.backlinkDom, this.unlinkedDom]) {
      for (const item of dom.children) {
        const hay = (item.file.path + '\n' + item.content).toLowerCase()
        item.el.toggle(!q || hay.includes(q))
      }
    }
  }

  async update(): Promise<void> {
    const gen = ++this.gen
    const file = this.file
    const app: any = this.app
    const mc = app.metadataCache
    if (!file || !mc) {
      this.backlinkDom.emptyResults()
      this.unlinkedDom.emptyResults()
      this.linked.setCount(0)
      this.unlinked.setCount(this.unlinkedCollapsed ? null : 0)
      return
    }
    // Linked mentions.
    const back = mc.getBacklinksForFile(file)
    const seen = new Set<string>()
    let total = 0
    for (const src of back.keys()) {
      const sf = app.vault.getAbstractFileByPath(src)
      if (!sf || typeof sf.extension !== 'string') continue
      const refs: any[] = back.get(src) || []
      const ranges: Range[] = refs.filter(r => r.position).map(r => [r.position.start.offset, r.position.end.offset])
      if (!ranges.length) continue
      let content = ''
      try {
        content = await app.vault.cachedRead(sf)
      } catch {
        continue
      }
      if (gen !== this.gen) return
      seen.add(src)
      total += ranges.length
      this.backlinkDom.addResult(sf, { content: ranges }, content)
    }
    for (const f of this.backlinkDom.getFiles()) if (!seen.has(f.path)) this.backlinkDom.removeResult(f)
    this.linked.setCount(total)
    // Unlinked mentions (lazy).
    if (this.unlinkedCollapsed) {
      this.unlinked.setCount(null)
    } else {
      const names = [file.basename, ...aliasesOf(mc.getFileCache(file))]
      const seenU = new Set<string>()
      let n = 0
      for (const sf of app.vault.getMarkdownFiles()) {
        if (sf === file || mc.isUserIgnored?.(sf.path)) continue
        let content = ''
        try {
          content = await app.vault.cachedRead(sf)
        } catch {
          continue
        }
        if (gen !== this.gen) return
        const found = findMentions(content, names, excludedRanges(mc.getFileCache(sf)))
        if (!found.length) continue
        seenU.add(sf.path)
        n += found.length
        const item = this.unlinkedDom.addResult(sf, { content: found.map(f => f.range) }, content)
        if (item) {
          item.onMatchRender = (match: Range, el: HTMLElement) => {
            const btn = el.createEl('button', { cls: 'search-result-file-match-replace-button', text: STRINGS.linkButton })
            btn.addEventListener('click', e => {
              e.preventDefault()
              e.stopPropagation()
              void this.linkMention(sf, match, content.slice(match[0], match[1]))
            })
          }
          if (item.rendered) item.renderContentMatches()
        }
      }
      for (const f of this.unlinkedDom.getFiles()) if (!seenU.has(f.path)) this.unlinkedDom.removeResult(f)
      this.unlinked.setCount(n)
    }
    this.applyFilter()
  }

  /** Replace an unlinked mention in `src` with a link to the current file. */
  async linkMention(src: any, range: Range, text: string): Promise<void> {
    const app: any = this.app
    const file = this.file
    if (!file) return
    const link = text === file.basename ? app.fileManager.generateMarkdownLink(file, src.path) : app.fileManager.generateMarkdownLink(file, src.path, undefined, text)
    await app.vault.process(src, (data: string) => (data.slice(range[0], range[1]) === text ? data.slice(0, range[0]) + link + data.slice(range[1]) : data))
  }
}

/** The backlink pane (view type "backlink"): follows the active file (or its linked leaf) and hosts `Backlinks`. */
export class BacklinkView extends ItemView {
  icon = 'links-coming-in'
  allowNoFile = true
  backlink: Backlinks

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.backlink = this.addChild(new Backlinks(this.app, this.contentEl))
  }

  get file(): any {
    return this.backlink.file
  }

  getViewType(): string {
    return VIEW_TYPE_BACKLINK
  }

  getDisplayText(): string {
    return this.leaf?.group && this.file ? STRINGS.backlinksFor(this.file.basename) : STRINGS.backlinksTitle
  }

  getState(): Record<string, unknown> {
    const s: Record<string, unknown> = {}
    if (this.file) s.file = this.file.path
    return Object.assign(s, this.backlink.getState())
  }

  async setState(state: any, result: any): Promise<void> {
    this.backlink.setState(state)
    this.updateTitle()
    await super.setState(state, result)
  }

  /** `editor:open-search` on the pane: show + focus the search filter. */
  showSearch(): void {
    this.backlink.setShowSearch(true)
    this.backlink.nav.inputEl.focus()
  }

  onload(): void {
    super.onload()
    this.registerEvent((this.app.workspace as any).on('file-open', () => this.onFileOpen()))
    this.onFileOpen()
  }

  private updateTitle(): void {
    this.titleEl.setText(this.getDisplayText())
    this.leaf.updateHeader?.()
  }

  /** Follow the active file unless this pane is linked to a specific leaf. */
  onFileOpen(): void {
    let f: any = null
    if (this.leaf.group) {
      for (const l of this.app.workspace.getGroupLeaves(this.leaf.group)) {
        const v: any = l.view
        if (l !== this.leaf && v?.file) {
          f = v.file
          break
        }
      }
      if (!f) return
    } else f = this.app.workspace.getActiveFile?.() ?? null
    if (f && f !== this.backlink.file) {
      this.backlink.setFile(f)
      this.updateTitle()
    }
  }
}
