/* eslint-disable @typescript-eslint/no-explicit-any */
// "tag" view (tag-pane core plugin) — a plain View (no view
// header / view content):
//   .workspace-leaf-content[data-type=tag] > .nav-header + .tag-container > div(tree root) [| .pane-empty.tag-pane-empty]
//   tag: .tree-item > .tree-item-self.tag-pane-tag[.mod-collapsible].is-clickable
//          > [.tree-item-icon.collapse-icon] + .tree-item-inner > .tree-item-inner-text
//              > span.tag-pane-tag-parent("a/") + span.tree-item-inner-text("b")
//          + .tree-item-flair-outer > span.tag-pane-tag-count.tree-item-flair
//        + .tree-item-children
// Counts: app.metadataCache.getTags(). Nested parents are nodes keyed by lower-cased tag. Sort
// comparator: frequency (desc/asc, ties by name) or name. Collapsed node ids persist in
// localStorage `<appId>-tag-pane-fold` (lower-cased, with '#'). Leaf state {sortOrder, useHierarchy, showSearch, searchQuery}.
import { View } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { Menu } from '../../ui/Menu'
import { prepareSimpleSearch } from '../../search/fuzzy'
import { openGlobalSearch } from '../../search/SearchView'
import { TreeNode, renderLevel, walk, createNavHeader, navButton, setNavButton, type NavHeader } from '../outline/tree'

export const VIEW_TYPE_TAG = 'tag'
export type TagSortOrder = 'alphabetical' | 'alphabeticalReverse' | 'frequency' | 'frequencyReverse'

export const TAG_STRINGS = {
  title: 'Tags',
  noTags: 'No tags found.',
  changeSort: 'Change sort order',
  nested: 'Show nested tags',
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  showSearch: 'Show search filter',
  sorts: [
    ['alphabetical', 'Tag name (A to Z)'],
    ['alphabeticalReverse', 'Tag name (Z to A)'],
    ['frequency', 'Frequency (high to low)'],
    ['frequencyReverse', 'Frequency (low to high)']
  ] as [TagSortOrder, string][]
}

const FOLD_KEY = 'tag-pane-fold'
const collator = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true })

export class TagNode extends TreeNode {
  tag = ''
  count = 0
  parentEl: HTMLElement
  textEl: HTMLElement
  countEl: HTMLElement
  view: TagView

  constructor(view: TagView) {
    super('tag-pane-tag')
    this.collapsibleBeforeClickable = true
    this.view = view
    const text = this.innerEl.createDiv('tree-item-inner-text')
    this.parentEl = text.createSpan('tag-pane-tag-parent')
    this.textEl = text.createSpan('tree-item-inner-text')
    this.countEl = this.selfEl.createDiv('tree-item-flair-outer').createSpan('tag-pane-tag-count tree-item-flair')
    this.selfEl.addEventListener('click', evt => view.onTagClick(this, evt))
    this.onToggle = () => view.saveFolds()
  }

  setTag(tag: string): void {
    this.tag = tag
    const name = tag.startsWith('#') ? tag.slice(1) : tag
    const i = name.lastIndexOf('/')
    if (this.view.useHierarchy && i !== -1) {
      this.parentEl.setText(name.slice(0, i + 1))
      this.textEl.setText(name.slice(i + 1))
    } else {
      this.parentEl.setText('')
      this.textEl.setText(name)
    }
  }

  setCount(n: number): void {
    this.count = n
    this.countEl.setText(String(n))
  }
}

export class TagView extends View {
  icon = 'lucide-tags'
  sortOrder: TagSortOrder = 'frequency'
  useHierarchy = true
  isShowingSearch = false
  searchQuery = ''
  isAllCollapsed = true
  tagDoms: Record<string, TagNode> = {}
  roots: TagNode[] = []
  nav: NavHeader
  tagPaneEl: HTMLElement
  treeEl: HTMLElement
  emptyEl: HTMLElement
  useHierarchyEl: HTMLElement
  collapseOrExpandAllEl: HTMLElement
  showSearchButtonEl: HTMLElement
  private timer: any = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.nav = createNavHeader(this.containerEl)
    navButton(this.nav.buttonsEl, 'lucide-sort-asc', TAG_STRINGS.changeSort, evt => this.showSortMenu(evt))
    this.useHierarchyEl = navButton(this.nav.buttonsEl, 'lucide-folder-tree', TAG_STRINGS.nested, () => this.setUseHierarchy(!this.useHierarchy, true))
    this.useHierarchyEl.addClass('is-active')
    this.collapseOrExpandAllEl = navButton(this.nav.buttonsEl, 'lucide-chevrons-up-down', TAG_STRINGS.expandAll, () => this.handleCollapseAll())
    this.collapseOrExpandAllEl.setAttribute('aria-disabled', 'false')
    this.showSearchButtonEl = navButton(this.nav.buttonsEl, 'lucide-search', TAG_STRINGS.showSearch, () => this.setShowSearch(!this.isShowingSearch, true))
    this.nav.inputEl.addEventListener('input', () => {
      this.searchQuery = this.nav.inputEl.value
      this.render()
      this.app.workspace.requestSaveLayout()
    })
    this.tagPaneEl = this.containerEl.createDiv('tag-container node-insert-event')
    this.tagPaneEl.style.position = 'relative'
    this.treeEl = this.tagPaneEl.createDiv()
    this.emptyEl = createDiv({ cls: 'pane-empty tag-pane-empty', text: TAG_STRINGS.noTags })
  }

  getViewType(): string {
    return VIEW_TYPE_TAG
  }

  getDisplayText(): string {
    return TAG_STRINGS.title
  }

  getState(): Record<string, unknown> {
    return { sortOrder: this.sortOrder, useHierarchy: this.useHierarchy, showSearch: this.isShowingSearch, searchQuery: this.searchQuery }
  }

  async setState(state: any, result: any): Promise<void> {
    if (state) {
      if (TAG_STRINGS.sorts.some(([id]) => id === state.sortOrder)) this.sortOrder = state.sortOrder
      if (typeof state.useHierarchy === 'boolean') this.setUseHierarchy(state.useHierarchy, false)
      if (typeof state.searchQuery === 'string') this.nav.inputEl.value = this.searchQuery = state.searchQuery
      if (typeof state.showSearch === 'boolean') this.setShowSearch(state.showSearch, false)
    }
    this.updateTags()
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const mc: any = (this.app as any).metadataCache
    if (mc) {
      this.registerEvent(mc.on('changed', () => this.requestUpdateTags()))
      this.registerEvent(mc.on('deleted', () => this.requestUpdateTags()))
      this.registerEvent(mc.on('resolved', () => this.requestUpdateTags()))
    }
    this.updateTags()
  }

  onunload(): void {
    clearTimeout(this.timer)
    super.onunload()
  }

  requestUpdateTags(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.updateTags(), 500)
  }

  private loadFolds(): Set<string> {
    const v = (this.app as any).loadLocalStorage?.(FOLD_KEY)
    return new Set(Array.isArray(v) ? v : [])
  }

  saveFolds(): void {
    const out: string[] = []
    walk(this.roots, n => {
      if (n.collapsed) out.push((n as TagNode).tag.toLowerCase())
    })
    ;(this.app as any).saveLocalStorage?.(FOLD_KEY, out)
  }

  comparator(counts: Record<string, number>): (a: TagNode, b: TagNode) => number {
    const s = this.sortOrder
    if (s === 'alphabetical') return (a, b) => collator.compare(a.tag, b.tag)
    if (s === 'alphabeticalReverse') return (a, b) => -collator.compare(a.tag, b.tag)
    const dir = s === 'frequencyReverse' ? -1 : 1
    return (a, b) => {
      const ca = counts[a.tag] ?? a.count
      const cb = counts[b.tag] ?? b.count
      return ca === cb ? collator.compare(a.tag, b.tag) : dir * (cb - ca)
    }
  }

  updateTags(): void {
    const counts: Record<string, number> = (this.app as any).metadataCache?.getTags?.() ?? {}
    const tags = Object.keys(counts)
    const folds = this.loadFolds()
    const old = this.tagDoms
    const doms: Record<string, TagNode> = (this.tagDoms = {})
    this.roots = []
    for (const k in old) old[k].children = []
    if (tags.length === 0) {
      this.treeEl.empty()
      this.tagPaneEl.appendChild(this.emptyEl)
      return
    }
    this.emptyEl.detach()
    const node = (tag: string): TagNode => {
      const k = tag.toLowerCase()
      let n = doms[k]
      if (!n) {
        n = old[k] || new TagNode(this)
        n.children = []
        n.parent = null
        doms[k] = n
      }
      return n
    }
    for (const t of tags) node(t).setTag(t)
    const place = (tag: string, n: TagNode): void => {
      const last = tag.split('/').pop()!
      if (this.useHierarchy && last !== tag) {
        const parentTag = tag.slice(0, tag.length - last.length - 1)
        const k = parentTag.toLowerCase()
        let p = doms[k]
        if (!p) {
          p = node(parentTag)
          p.setTag(parentTag)
        }
        if (!p.children.includes(n)) p.addChild(n)
        place(parentTag, p)
      } else if (!this.roots.includes(n)) {
        n.parent = null
        this.roots.push(n)
      }
    }
    for (const t of tags) place(t, doms[t.toLowerCase()])
    for (const k in doms) {
      const n = doms[k]
      const has = n.children.length > 0
      n.setCollapsible(has)
      n.setCount(counts[n.tag] || 0)
      if (has) n.setCollapsed(folds.has(k))
    }
    const cmp = this.comparator(counts)
    this.roots.sort(cmp)
    walk(this.roots, n => n.children.sort(cmp as any))
    this.render()
  }

  render(): void {
    const q = this.searchQuery.trim()
    let visible: ((n: TreeNode) => boolean) | undefined
    if (q) {
      const search = prepareSimpleSearch(q)
      const keep = new Set<TreeNode>()
      walk(this.roots, n => {
        if (search((n as TagNode).tag.replace(/^#/, ''))) {
          for (let p: TreeNode | null = n; p; p = p.parent) keep.add(p)
          walk(n.children, c => keep.add(c))
        }
      })
      visible = n => keep.has(n)
    }
    renderLevel(this.treeEl, this.roots, 0, visible)
    this.treeEl.setAttribute('style', '')
  }

  onTagClick(n: TagNode, evt: MouseEvent): void {
    if ((evt.target as HTMLElement).closest('.collapse-icon')) return
    const query = `tag:${n.tag}`
    const gs: any = (this.app as any).internalPlugins?.getEnabledPluginById?.('global-search')
    if (gs?.openGlobalSearch) gs.openGlobalSearch(query)
    else openGlobalSearch(this.app, query)
  }

  showSortMenu(evt: MouseEvent): void {
    const m = new Menu()
    for (const [id, label] of TAG_STRINGS.sorts)
      m.addItem(i =>
        i
          .setTitle(label)
          .setChecked(this.sortOrder === id)
          .onClick(() => {
            this.sortOrder = id
            this.updateTags()
            this.app.workspace.requestSaveLayout()
          })
      )
    m.showAtMouseEvent(evt)
  }

  setUseHierarchy(on: boolean, save: boolean): void {
    this.useHierarchy = on
    this.useHierarchyEl.toggleClass('is-active', on)
    if (save) {
      this.updateTags()
      this.app.workspace.requestSaveLayout()
    }
  }

  setShowSearch(on: boolean, save: boolean): void {
    this.isShowingSearch = on
    this.showSearchButtonEl.toggleClass('is-active', on)
    this.nav.searchEl.style.display = on ? '' : 'none'
    if (on && save) this.nav.inputEl.focus()
    if (!on && this.searchQuery) {
      this.searchQuery = this.nav.inputEl.value = ''
      this.render()
    }
    if (save) this.app.workspace.requestSaveLayout()
  }

  /** Toggles all folds. The button keeps its initial "Expand all" label/icon. */
  handleCollapseAll(): void {
    const collapse = !this.isAllCollapsed
    walk(this.roots, n => n.setCollapsed(collapse))
    this.isAllCollapsed = collapse
    this.saveFolds()
  }

  setIsAllCollapsed(on: boolean): void {
    this.isAllCollapsed = on
    if (on) setNavButton(this.collapseOrExpandAllEl, 'lucide-chevrons-up-down', TAG_STRINGS.expandAll)
    else setNavButton(this.collapseOrExpandAllEl, 'lucide-chevrons-down-up', TAG_STRINGS.collapseAll)
  }
}
