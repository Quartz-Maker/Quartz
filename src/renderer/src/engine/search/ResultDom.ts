// The search result list DOM shared by the search view and embedded ```query``` blocks:
//   .search-result-container > .search-results-children > .tree-item.search-result
//     > .tree-item-self.search-result-file-title.is-clickable (collapse icon, inner, flair)
//     > .search-result-file-matches > .search-result-file-match.tappable (snippet / property row)
// Highlights are `span.search-result-file-matched-text`. Match rows render lazily (when the
// file item first becomes visible), as a virtualised list.
import type { CachedMetadata, TFile } from 'obsidian'
import { setIcon, setTooltip } from '../workspace/dom'
import { Keymap } from '../keymap/Keymap'
import { Menu } from '../workspace/Menu'
import { countMatches, PropertyMatch, Range, SearchResult } from './query'
import { getSortComparator } from './sort'
import {
  extraContextRange, groupPropertyMatches, lineContext, nextContextPos, prevContextPos, renderHighlighted,
  renderPropertyRow, resultFlair, resultTitle
} from './snippets'

const MORE_CONTEXT = 'Show more context'

export interface ResultDomApp {
  metadataCache: { getFileCache(file: TFile): CachedMetadata | null }
  workspace?: any
  fileManager?: any
  dragManager?: any
}

function getLeafAndOpen(app: ResultDomApp, evt: MouseEvent | KeyboardEvent, file: TFile, eState: any): void {
  const ws = app.workspace
  if (!ws || typeof ws.getLeaf !== 'function') return
  const leaf = ws.getLeaf(Keymap.isModEvent(evt as any))
  leaf?.openFile?.(file, { eState })
}

function isPrimaryClick(e: Event): boolean {
  return !(e instanceof MouseEvent && e.button !== 0 && e.button !== 1)
}

/** One snippet row (content match). */
export class SearchResultMatchItem {
  el: HTMLElement
  showMoreBeforeEl: HTMLElement
  showMoreAfterEl: HTMLElement
  onMatchRender: ((match: Range, el: HTMLElement) => void) | null = null
  constructor(
    public parent: SearchResultFileItem,
    public content: string,
    public cache: CachedMetadata,
    public start: number,
    public end: number,
    public matches: Range[],
    public mutateEState?: (eState: any) => void
  ) {
    const el = (this.el = createDiv('search-result-file-match tappable'))
    this.showMoreBeforeEl = el.createDiv('search-result-hover-button mod-top', (b) => {
      setIcon(b, 'lucide-chevron-up')
      setTooltip(b, MORE_CONTEXT, { placement: 'top' })
      b.addEventListener('click', (e) => {
        e.preventDefault()
        this.showMoreBefore()
      })
    })
    this.showMoreAfterEl = el.createDiv('search-result-hover-button mod-bottom', (b) => {
      setIcon(b, 'lucide-chevron-down')
      setTooltip(b, MORE_CONTEXT, { placement: 'bottom' })
      b.addEventListener('click', (e) => {
        e.preventDefault()
        this.showMoreAfter()
      })
    })
    this.showMoreBeforeEl.hide()
    this.showMoreAfterEl.hide()
    el.addEventListener('click', (e) => this.onResultClick(e))
    el.addEventListener('auxclick', (e) => this.onResultClick(e))
    el.addEventListener('mouseover', (e) => this.onFocusEnter(e))
    el.addEventListener('mouseout', (e) => this.onFocusExit(e))
    el.addEventListener('contextmenu', (e) => parent.onResultContextMenu(e))
  }
  onResultClick(e: MouseEvent | KeyboardEvent): void {
    if (!isPrimaryClick(e) || e.defaultPrevented) return
    e.preventDefault()
    const eState: any = { match: { content: this.content, matches: this.matches } }
    this.mutateEState?.(eState)
    getLeafAndOpen(this.parent.app, e, this.parent.file, eState)
  }
  onFocusExit(e?: MouseEvent): void {
    if (e && e.relatedTarget instanceof Node && this.el.contains(e.relatedTarget)) return
    if (this.el.classList.contains('has-focus')) return
    this.showMoreBeforeEl.hide()
    this.showMoreAfterEl.hide()
  }
  onFocusEnter(e?: MouseEvent): void {
    if (e) {
      if (e.relatedTarget instanceof Node && this.el.contains(e.relatedTarget)) return
      this.parent.onResultMouseover(e, this.el, this.matches)
    }
    this.toggleShowMoreContextButtons()
  }
  toggleShowMoreContextButtons(): void {
    this.showMoreBeforeEl.toggle(this.start > 0)
    this.showMoreAfterEl.toggle(this.end < this.content.length)
  }
  showMoreBefore(): void {
    let p = this.start
    while (p > 0) {
      p--
      const q = prevContextPos(this.content, this.cache, p)
      if (q < p) {
        p = q
        break
      }
    }
    this.start = p
    this.render()
    this.onFocusEnter()
  }
  showMoreAfter(): void {
    let p = this.end
    const n = this.content.length
    while (p < n) {
      p++
      const q = nextContextPos(this.content, this.cache, p)
      if (q > p) {
        p = q
        break
      }
    }
    this.end = p
    this.render()
    this.onFocusEnter()
  }
  render(before = false, after = false): void {
    const el = this.el
    el.empty()
    if (before) el.appendText('...')
    renderHighlighted(el, this.content, this.start, this.end, this.matches)
    el.appendChild(this.showMoreBeforeEl)
    el.appendChild(this.showMoreAfterEl)
    if (after) el.appendText('...')
    if (this.onMatchRender) this.onMatchRender(this.matches[0], el)
  }
}

/** One `key: value` property row. */
export class SearchResultPropertyItem {
  el: HTMLElement
  onMatchRender: ((match: any, el: HTMLElement) => void) | null = null
  constructor(public parent: SearchResultFileItem, public cache: CachedMetadata, public matches: PropertyMatch[]) {
    const el = (this.el = createDiv('search-result-file-match tappable'))
    el.addEventListener('click', (e) => this.onResultClick(e))
    el.addEventListener('auxclick', (e) => this.onResultClick(e))
    el.addEventListener('contextmenu', (e) => parent.onResultContextMenu(e))
  }
  onResultClick(e: MouseEvent | KeyboardEvent): void {
    if (!isPrimaryClick(e) || e.defaultPrevented) return
    e.preventDefault()
    getLeafAndOpen(this.parent.app, e, this.parent.file, { propertyMatches: this.matches })
  }
  render(): void {
    this.el.empty()
    renderPropertyRow(this.el, this.matches, this.cache.frontmatter)
  }
}

export type MatchItem = SearchResultMatchItem | SearchResultPropertyItem

/** One file in the result list. */
export class SearchResultFileItem {
  onMatchRender: ((match: any, el: HTMLElement) => void) | null = null
  collapsible = true
  collapsed = false
  extraContext = true
  showTitle = true
  separateMatches = false
  rendered = false
  children: MatchItem[] = []
  el: HTMLElement
  containerEl: HTMLElement
  selfEl!: HTMLElement
  collapseEl!: HTMLElement
  childrenEl: HTMLElement

  constructor(
    public app: ResultDomApp,
    public parentDom: SearchResultDom,
    public file: TFile,
    public result: SearchResult,
    public content: string,
    showTitle = true
  ) {
    this.showTitle = showTitle
    const el = (this.el = this.containerEl = createDiv('tree-item search-result'))
    if (showTitle) {
      const self = (this.selfEl = el.createDiv('tree-item-self search-result-file-title is-clickable'))
      const collapse = (this.collapseEl = self.createDiv('tree-item-icon collapse-icon'))
      setIcon(collapse, 'right-triangle')
      collapse.style.visibility = 'hidden'
      self.setAttribute('draggable', 'true')
      self.addEventListener('click', (e) => this.onResultClick(e))
      self.addEventListener('auxclick', (e) => this.onResultClick(e))
      self.addEventListener('mouseover', (e) => this.onResultMouseover(e, self))
      self.addEventListener('contextmenu', (e) => this.onResultContextMenu(e))
      collapse.addEventListener('click', (e) => this.onCollapseClick(e))
      const inner = self.createDiv('tree-item-inner')
      const t = resultTitle(file, result)
      if (t.ranges) renderHighlighted(inner, t.text, 0, t.text.length, t.ranges)
      else inner.setText(t.text)
      const flair = resultFlair(result)
      if (flair > 0) self.createDiv('tree-item-flair-outer').createSpan('tree-item-flair').setText(String(flair))
      const dm = app.dragManager
      if (dm && typeof dm.handleDrag === 'function') dm.handleDrag(self, (e: DragEvent) => dm.dragFile(e, this.file))
    }
    this.childrenEl = el.createDiv('search-result-file-matches')
  }

  onRender(): void {
    if (this.rendered) return
    this.rendered = true
    this.renderContentMatches()
  }

  private addChild(c: MatchItem): void {
    this.children.push(c)
    this.childrenEl.appendChild(c.el)
  }

  renderContentMatches(): void {
    const { app, file, result, content, collapsible, extraContext, separateMatches } = this
    this.children = []
    this.childrenEl.empty()
    if (this.showTitle) this.collapseEl.style.visibility = 'hidden'
    let any = false
    const addMatches = (ranges: Range[], text: string, cache: CachedMetadata, mutate?: (eState: any) => void): void => {
      ranges.sort((a, b) => a[0] - b[0])
      any = true
      let i = 0
      const take = (start: number, end: number, before?: boolean, after?: boolean): void => {
        let j = i + 1
        if (!separateMatches) {
          while (j < ranges.length) {
            const r = ranges[j]
            if (r[0] >= end) break
            if (r[1] > end) {
              end = r[1]
              j++
              break
            }
            j++
          }
        }
        const item = new SearchResultMatchItem(this, text, cache, start, end, ranges.slice(i, j), mutate)
        item.onMatchRender = this.onMatchRender
        item.render(before, after)
        this.addChild(item)
        i = j
      }
      if (extraContext) {
        while (i < ranges.length) {
          const [s, e] = extraContextRange(text, ranges[i], cache)
          take(s, e)
        }
      } else {
        while (i < ranges.length) {
          const [s, e, b, a] = lineContext(text, ranges[i])
          take(s, e, b, a)
        }
      }
    }
    if (file.extension === 'canvas' && content) {
      try {
        const nodes = JSON.parse(content).nodes.filter((n: any) => n.type === 'text').sort((a: any, b: any) => a.y - b.y || a.x - b.x)
        const caches = (this.parentDom.getCanvasCaches?.(file, content) ?? {}) as Record<string, CachedMetadata>
        for (const n of nodes) {
          const key = `canvas-${n.id}` as const
          if (!Object.prototype.hasOwnProperty.call(result, key)) continue
          const rs = result[key]
          if (rs && rs.length > 0) addMatches(rs, n.text, caches[n.id] || ({} as CachedMetadata), (es) => (es.match.nodeId = n.id))
        }
      } catch {
        /* ignore malformed canvas */
      }
    } else {
      const cache = (app.metadataCache.getFileCache(file) || {}) as CachedMetadata
      if (result.properties && result.properties.length > 0) {
        any = true
        for (const g of groupPropertyMatches(result.properties)) {
          const item = new SearchResultPropertyItem(this, cache, g)
          item.onMatchRender = this.onMatchRender
          item.render()
          this.addChild(item)
        }
      }
      if (result.content && result.content.length > 0) addMatches(result.content, content, cache)
    }
    if (this.showTitle && collapsible && any) this.collapseEl.style.visibility = ''
  }

  onCollapseClick(e: MouseEvent): void {
    e.preventDefault()
    if (Keymap.isModifier(e, 'Mod')) this.parentDom.setCollapseAll(!this.collapsed)
    else this.setCollapse(!this.collapsed, true)
  }

  onResultClick(e: MouseEvent | KeyboardEvent): void {
    if (!isPrimaryClick(e) || e.defaultPrevented) return
    e.preventDefault()
    getLeafAndOpen(this.app, e, this.file, {
      match: { content: this.content, matches: this.result.content || [] },
      propertyMatches: this.result.properties
    })
  }

  onResultMouseover(e: MouseEvent, targetEl: HTMLElement, matches?: Range[]): void {
    if (e.defaultPrevented) return
    if (e.relatedTarget instanceof Node && targetEl.contains(e.relatedTarget)) return
    e.preventDefault()
    let state: any = null
    if (matches && matches.length > 0) state = { scroll: lineOf(this.content, matches[0][0]) }
    this.app.workspace?.trigger?.('hover-link', { event: e, source: 'search', hoverParent: this.parentDom, targetEl, linktext: this.file.path, state })
  }

  onResultContextMenu(e: MouseEvent): void {
    const ws = this.app.workspace
    if (!ws || typeof ws.handleLinkContextMenu !== 'function') return
    const menu = new Menu().addSections(['title', 'open', 'action-primary', 'action', 'info', 'view', 'system', '', 'danger'])
    if (ws.handleLinkContextMenu(menu, this.file.path, '')) {
      e.preventDefault()
      if (this.selfEl && this.selfEl.contains(e.target as Node)) {
        menu.addItem((item: any) =>
          item.setSection('danger').setTitle('Delete file').setIcon('lucide-trash-2').setWarning(true)
            .onClick(() => this.app.fileManager?.promptForDeletion?.(this.file))
        )
      }
      menu.setParentElement(this.containerEl).showAtMouseEvent(e)
    }
  }

  setCollapse(collapsed: boolean, _animate: boolean): void {
    if (this.collapsed === collapsed) return
    this.collapsed = collapsed
    this.containerEl.toggleClass('is-collapsed', collapsed)
    this.childrenEl.toggle(!collapsed)
  }

  setCollapsible(c: boolean): void {
    if (this.collapsible === c) return
    this.collapsible = c
    this.collapseEl.style.visibility = c ? '' : 'hidden'
  }

  setExtraContext(v: boolean): void {
    if (this.extraContext === v) return
    this.extraContext = v
    if (this.rendered) this.renderContentMatches()
  }

  matchCount(): number {
    return countMatches(this.result)
  }
}

function lineOf(text: string, offset: number): number {
  let n = 0
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

type Focusable = SearchResultFileItem | MatchItem

/** The result list container (`.search-result-container`). */
export class SearchResultDom {
  children: SearchResultFileItem[] = []
  resultDomLookup = new Map<TFile, SearchResultFileItem>()
  focusedItem: Focusable | null = null
  emptyStateEl: HTMLElement
  childrenEl: HTMLElement
  working = false
  sortOrder = 'alphabetical'
  collapseAll = false
  extraContext = false
  /** Canvas node caches for snippet context (wired by the owner). */
  getCanvasCaches?: (file: TFile, content: string) => Record<string, CachedMetadata> | null
  private changeTimer: ReturnType<typeof setTimeout> | null = null
  private observer: IntersectionObserver | null = null

  constructor(public app: ResultDomApp, public el: HTMLElement, emptyStateText: string) {
    this.emptyStateEl = createDiv({ cls: 'search-empty-state', text: emptyStateText })
    this.childrenEl = el.createDiv('search-results-children')
    const IO = (globalThis as any).IntersectionObserver as typeof IntersectionObserver | undefined
    if (IO) {
      this.observer = new IO((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue
          const item = this.children.find((c) => c.el === en.target)
          if (item) {
            item.onRender()
            this.observer!.unobserve(en.target)
          }
        }
      }, { root: null, rootMargin: '800px' })
    }
  }

  /** Debounced (0 ms) re-sort + empty state. */
  changed(): void {
    if (this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      this.onChange()
    }, 0)
  }

  startLoader(): void {
    this.working = true
    this.el.addClass('is-loading')
    this.onChange()
  }
  stopLoader(): void {
    this.working = false
    this.el.removeClass('is-loading')
    this.onChange()
  }

  onChange(): void {
    const cmp = getSortComparator(this.sortOrder)
    this.children.sort((a, b) => cmp(a.file, b.file))
    const el = this.childrenEl
    let ref: ChildNode | null = el.firstChild
    for (const c of this.children) {
      if (c.el !== ref) el.insertBefore(c.el, ref)
      else ref = ref.nextSibling
    }
    if (this.children.length > 0 || this.working) this.emptyStateEl.detach()
    else this.el.appendChild(this.emptyStateEl)
  }

  emptyResults(): void {
    for (const c of this.children) this.observer?.unobserve(c.el)
    this.children = []
    this.childrenEl.empty()
    this.resultDomLookup.clear()
    this.changed()
  }

  getResult(file: TFile): SearchResultFileItem | undefined {
    return this.resultDomLookup.get(file)
  }

  removeResult(file: TFile): SearchResultFileItem | undefined {
    const item = this.resultDomLookup.get(file)
    if (item) {
      this.children.remove(item)
      item.el.detach()
      this.observer?.unobserve(item.el)
      this.resultDomLookup.delete(file)
      this.changed()
      const f = this.focusedItem
      if (f && (f === item || (f as MatchItem).parent === item)) this.setFocusedItem(null)
    }
    return item
  }

  addResult(file: TFile, result: SearchResult, content: string, showTitle = true): SearchResultFileItem | undefined {
    if (!file) return
    const prev = this.removeResult(file)
    const item = new SearchResultFileItem(this.app, this, file, result, content, showTitle)
    item.setCollapse(prev ? prev.collapsed : this.collapseAll, false)
    item.extraContext = this.extraContext
    this.children.push(item)
    this.childrenEl.appendChild(item.el)
    this.resultDomLookup.set(file, item)
    if (this.observer) this.observer.observe(item.el)
    else item.onRender()
    this.changed()
    return item
  }

  /** Render every pending item now (copy/export/tests). */
  renderAll(): void {
    for (const c of this.children) c.onRender()
  }

  setCollapseAll(v: boolean): void {
    this.collapseAll = v
    for (const c of this.children) c.setCollapse(v, false)
  }

  setExtraContext(v: boolean): void {
    this.extraContext = v
    for (const c of this.children) c.setExtraContext(v)
  }

  onResize(): void {}

  getFiles(): TFile[] {
    return this.children.map((c) => c.file)
  }

  getMatchCount(): number {
    let n = 0
    for (const c of this.children) n += countMatches(c.result)
    return n
  }

  /** Keyboard focus walks visible file titles and match rows in order. */
  private focusables(): Focusable[] {
    const out: Focusable[] = []
    for (const c of this.children) {
      out.push(c)
      if (!c.collapsed) {
        c.onRender()
        out.push(...c.children)
      }
    }
    return out
  }

  setFocusedItem(item: Focusable | null): void {
    const prev = this.focusedItem
    if (prev) {
      prev.el.removeClass('has-focus')
      if (prev instanceof SearchResultMatchItem) prev.onFocusExit()
    }
    this.focusedItem = item
    if (item) {
      item.el.addClass('has-focus')
      item.el.scrollIntoView?.({ block: 'nearest' })
      if (item instanceof SearchResultMatchItem) item.onFocusEnter()
    }
  }

  changeFocusedItem(dir: 'forwards' | 'backwards'): void {
    const list = this.focusables()
    if (list.length === 0) return
    if (this.focusedItem === null) {
      this.setFocusedItem(dir === 'forwards' ? list[0] : list[list.length - 1])
      return
    }
    const i = list.indexOf(this.focusedItem)
    const next = dir === 'forwards' ? list[i + 1] : list[i - 1]
    if (next) this.setFocusedItem(next)
  }
}
