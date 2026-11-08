/* eslint-disable @typescript-eslint/no-explicit-any */
// "outline" view (outline core plugin), DOM:
//   .workspace-leaf-content[data-type=outline] > .nav-header + .view-header + .view-content
//   .view-content > div(tree root) [+ .pane-empty "No headings found."]
//   heading: .tree-item > .tree-item-self.is-clickable[draggable=true][.mod-collapsible][.is-active]
//              > [.tree-item-icon.collapse-icon] + .tree-item-inner(text)  + .tree-item-children
// Headings come from app.metadataCache (getFileCache(file).headings) of the active markdown file;
// nesting pops the stack while `last.level >= level`. Leaf state {file?, followCursor, showSearch, searchQuery}.
import { ItemView } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { renderMatches } from '../../search/fuzzy'
import { SearchQuery } from '../../search/query'
import { parseMarkdown } from '../../metadata/parser/quartzParser'
import { nodeText } from '../../metadata/parser/computeMetadata'
import { TreeNode, renderLevel, walk, createNavHeader, navButton, setNavButton, type NavHeader } from './tree'

export const VIEW_TYPE_OUTLINE = 'outline'

export const OUTLINE_STRINGS = {
  title: 'Outline',
  tabTitle: (name: string) => `Outline of ${name}`,
  noHeadings: 'No headings found.',
  showSearch: 'Show search filter',
  followCursor: 'Auto-scroll to current section',
  collapseAll: 'Collapse all',
  expandAll: 'Expand all'
}

interface Heading {
  heading: string
  level: number
  position: { start: { line: number; col?: number; offset?: number } }
}

/** Display text of a heading: its inline markdown rendered to plain text. */
function headingDisplay(h: Heading): string {
  let t = ''
  try {
    t = nodeText(parseMarkdown(h.heading) as any)
  } catch {
    t = ''
  }
  return t || h.heading
}

class HeadingNode extends TreeNode {
  heading: Heading
  headingText: string
  constructor(h: Heading) {
    super()
    this.heading = h
    this.selfEl.setAttribute('draggable', 'true')
    this.headingText = headingDisplay(h)
    this.innerEl.setText(this.headingText)
  }
  /** Ancestor headings joined (`#A#B`), what the search filter is matched against. */
  get path(): string {
    let out = ''
    for (let n: any = this; n; n = n.parent) out = '#' + n.heading.heading + out
    return out
  }
}

export class OutlineView extends ItemView {
  icon = 'lucide-list'
  file: any = null
  followCursor = false
  isShowingSearch = false
  searchQuery = ''
  isAllCollapsed = false
  nav: NavHeader
  treeEl: HTMLElement
  emptyEl: HTMLElement
  searchButtonEl: HTMLElement
  followCursorButtonEl: HTMLElement
  collapseOrExpandAllEl: HTMLElement
  nodes: HeadingNode[] = []
  /** Reused item DOM across updates (kept and diffed, so item state survives edits). */
  private cachedNodes: HeadingNode[] = []
  private cachedFile: any = null
  private query: SearchQuery | null = null
  private prevQuery = ''
  activeNode: HeadingNode | null = null
  private timer: any = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.nav = createNavHeader(this.containerEl)
    this.searchButtonEl = navButton(this.nav.buttonsEl, 'lucide-search', OUTLINE_STRINGS.showSearch, () => this.setShowSearch(!this.isShowingSearch, true))
    this.followCursorButtonEl = navButton(this.nav.buttonsEl, 'lucide-gallery-vertical', OUTLINE_STRINGS.followCursor, () => this.setFollowCursor(!this.followCursor, true))
    this.collapseOrExpandAllEl = navButton(this.nav.buttonsEl, 'lucide-chevrons-down-up', OUTLINE_STRINGS.collapseAll, () => this.handleCollapseAll())
    this.nav.inputEl.addEventListener('input', () => {
      this.searchQuery = this.nav.inputEl.value
      this.render()
      this.app.workspace.requestSaveLayout()
    })
    this.treeEl = this.contentEl.createDiv()
    this.treeEl.setAttribute('style', 'min-height: 0px;')
    this.emptyEl = createDiv({ cls: 'pane-empty', text: OUTLINE_STRINGS.noHeadings })
    this.contentEl.style.position = 'relative'
    this.contentEl.addClass('node-insert-event')
  }

  getViewType(): string {
    return VIEW_TYPE_OUTLINE
  }

  getDisplayText(): string {
    return OUTLINE_STRINGS.title
  }

  canAcceptExtension(ext: string): boolean {
    return ext === 'md'
  }

  getState(): Record<string, unknown> {
    const s: Record<string, unknown> = {}
    if (this.file) s.file = this.file.path
    s.followCursor = this.followCursor
    s.showSearch = this.isShowingSearch
    s.searchQuery = this.searchQuery
    return s
  }

  async setState(state: any, result: any): Promise<void> {
    if (state) {
      if (typeof state.file === 'string') {
        const f = (this.app.vault as any).getAbstractFileByPath(state.file)
        if (f && f.extension) this.file = f
      }
      if (typeof state.followCursor === 'boolean') this.setFollowCursor(state.followCursor, false)
      if (typeof state.searchQuery === 'string') this.nav.inputEl.value = this.searchQuery = state.searchQuery
      if (typeof state.showSearch === 'boolean') this.setShowSearch(state.showSearch, false)
    }
    this.update()
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const ws: any = this.app.workspace
    const mc: any = (this.app as any).metadataCache
    const follow = () => this.syncToActive()
    this.registerEvent(ws.on('active-leaf-change', follow))
    this.registerEvent(ws.on('file-open', follow))
    if (mc) this.registerEvent(mc.on('changed', (f: any) => f === this.file && this.requestUpdate()))
    // Reference: the heading at the cursor (editor) or at the scroll position (reading view) is always highlighted;
    // follow-cursor only adds scrolling it into view.
    this.registerEvent(ws.on('editor-selection-change', (_e: any, v: any) => v === this.getOwner() && this.highlightActive()))
    let scrollTimer = 0
    this.registerEvent(ws.on('markdown-scroll', (v: any) => {
      clearTimeout(scrollTimer)
      scrollTimer = window.setTimeout(() => v?.getMode?.() === 'preview' && v === this.getOwner() && this.highlightActive(), 20)
    }))
    this.registerEvent((this.app.vault as any).on('rename', (f: any) => f === this.file && this.requestUpdate()))
    this.syncToActive()
  }

  onunload(): void {
    clearTimeout(this.timer)
    super.onunload()
  }

  /** The markdown view whose headings are listed (linked group member, else the most recent one). */
  getOwner(): any {
    const ws: any = this.app.workspace
    if (this.leaf.group) {
      for (const l of ws.getGroupLeaves(this.leaf.group)) if (l !== this.leaf && l.view?.getViewType?.() === 'markdown') return l.view
    }
    const active = ws.activeLeaf?.view
    if (active?.getViewType?.() === 'markdown') return active
    let best: any = null
    ws.iterateRootLeaves((l: any) => {
      if (l.view?.getViewType?.() === 'markdown' && l.isVisible?.() && (!best || best.activeTime < l.activeTime)) best = l
    })
    return best?.view ?? null
  }

  private syncToActive(): void {
    const ws: any = this.app.workspace
    const active = ws.activeLeaf
    if (active === this.leaf) return
    if (this.leaf.group && active?.group !== this.leaf.group) return
    const v = active?.view
    let file: any = this.file
    if (v?.getViewType?.() === 'markdown') file = v.file
    else if (v?.navigation) file = v.file && v.file.extension === 'md' ? v.file : null
    if (file !== this.file) {
      this.file = file
      this.app.workspace.requestSaveLayout()
    }
    this.update()
  }

  requestUpdate(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.update(), 50)
  }

  getHeadings(): Heading[] {
    const f = this.file
    if (!f || f.extension !== 'md') return []
    const cache = (this.app as any).metadataCache?.getFileCache(f)
    return cache?.headings && cache.headings.length ? cache.headings : []
  }

  update(): void {
    if (this.file !== this.cachedFile) {
      this.activeNode = null
      this.cachedNodes = []
      this.cachedFile = this.file
    }
    const heads = this.getHeadings()
    this.nodes = []
    if (heads.length > 0) {
      this.emptyEl.detach()
      // Reconcile the cached items with the new headings (same level+text keeps the item).
      const cache = this.cachedNodes
      for (let o = 0; o < heads.length; o++) {
        const h = heads[o]
        let at = -1
        for (let l = o; l < cache.length; l++) {
          if (cache[l].heading.level === h.level && cache[l].heading.heading === h.heading) {
            at = l
            break
          }
        }
        if (at !== -1) {
          if (o !== at) [cache[o], cache[at]] = [cache[at], cache[o]]
        } else {
          const n = new HeadingNode(h)
          n.onToggle = () => this.updateCollapseButton()
          n.selfEl.addEventListener('click', evt => this.onItemClick(n, evt))
          cache.splice(o, 0, n)
        }
        const n = cache[o]
        n.heading = h
        n.children = []
        n.parent = null
      }
      cache.length = heads.length
      const stack: HeadingNode[] = []
      for (const n of cache) {
        let last = stack[stack.length - 1]
        while (last && last.heading.level >= n.heading.level) {
          stack.pop()
          last = stack[stack.length - 1]
        }
        stack.push(n)
        if (last) {
          last.addChild(n)
          last.setCollapsible(true)
        } else this.nodes.push(n)
      }
      if (this.isAllCollapsed) walk(this.nodes, n => n.setCollapsed(true))
    } else this.contentEl.appendChild(this.emptyEl)
    this.render()
    this.highlightActive()
  }

  /** Items kept by the search filter: matching paths and their ancestors (null = no filter). */
  private matchSet(): Set<TreeNode> | null {
    const q = this.query
    if (!q) return null
    const keep = new Set<TreeNode>()
    walk(this.nodes, n => {
      if (q.matchContent((n as HeadingNode).path)) for (let p: TreeNode | null = n; p; p = p.parent) keep.add(p)
    })
    return keep
  }

  render(): void {
    const q = this.searchQuery.trim()
    if (!this.query || this.query.query !== q) {
      try {
        this.query = q ? new SearchQuery({} as any, q, false) : null
      } catch {
        this.query = null
      }
    }
    const keep = this.matchSet()
    renderLevel(this.treeEl, this.nodes, 0, undefined, keep ? n => !keep.has(n) : undefined)
    this.renderSearchMatches()
    if (this.nodes.length > 0) this.treeEl.setAttribute('style', '')
    else this.treeEl.setAttribute('style', 'min-height: 0px;')
  }

  private renderSearchMatches(): void {
    const q = this.query
    const changed = (q ? q.query : '') !== this.prevQuery
    this.prevQuery = q ? q.query : ''
    walk(this.nodes, n => {
      const hn = n as HeadingNode
      const m = q ? q.matchContent(hn.heading.heading) : null
      const has = hn.innerEl.hasClass('is-match')
      if (changed || has !== !!m) {
        if (m) {
          hn.innerEl.empty()
          hn.innerEl.addClass('is-match')
          renderMatches(hn.innerEl, hn.headingText, (m.content as any) ?? null)
        } else {
          hn.innerEl.removeClass('is-match')
          hn.innerEl.setText(hn.headingText)
        }
      }
    })
  }

  /** Heading at (or above) the owner's cursor line / reading scroll line. */
  findActiveHeading(owner: any): HeadingNode | null {
    if (!owner || owner.file !== this.file) return null
    let line = 0
    try {
      if (owner.getMode?.() === 'preview') line = Math.floor(owner.previewMode?.getScroll?.() ?? 0)
      else line = owner.editor?.getCursor('head')?.line ?? 0
    } catch {
      line = 0
    }
    // Reference: reading view uses the last heading whose end line is at/above the scroll line; the editor uses the
    // section containing the cursor. Nothing is highlighted above the first heading.
    const preview = owner.getMode?.() === 'preview'
    let best: HeadingNode | null = null
    walk(this.nodes, n => {
      const hn = n as HeadingNode
      const pos: any = hn.heading.position
      const at = preview ? (pos.end?.line ?? pos.start.line) : pos.start.line
      if (at <= line && (!best || best.heading.position.start.line <= hn.heading.position.start.line)) best = hn
    })
    return best
  }

  setHighlightedItem(n: HeadingNode | null): void {
    if (this.activeNode) this.activeNode.selfEl.removeClass('is-active')
    this.activeNode = n
    if (n) {
      n.selfEl.addClass('is-active')
      if (this.followCursor) n.selfEl.scrollIntoView?.({ block: 'nearest' })
    }
  }

  highlightActive(): void {
    this.setHighlightedItem(this.findActiveHeading(this.getOwner()))
  }

  onItemClick(n: HeadingNode, evt: MouseEvent): void {
    const owner = this.getOwner()
    const line = n.heading.position.start.line
    if (owner && owner.file === this.file) {
      owner.leaf.setEphemeralState({ line, focus: true })
      this.app.workspace.setActiveLeaf(owner.leaf, { focus: true })
    } else if (this.file) {
      void this.app.workspace.getLeaf(false).openFile(this.file, { active: true, eState: { line } })
    }
    this.setHighlightedItem(n)
    evt.preventDefault()
  }

  setFollowCursor(on: boolean, save: boolean): void {
    this.followCursor = on
    this.followCursorButtonEl.toggleClass('is-active', on)
    if (on) this.highlightActive()
    if (save) this.app.workspace.requestSaveLayout()
  }

  setShowSearch(on: boolean, save: boolean): void {
    this.isShowingSearch = on
    this.searchButtonEl.toggleClass('is-active', on)
    this.nav.searchEl.style.display = on ? '' : 'none'
    if (on && save) this.nav.inputEl.focus()
    if (!on && this.searchQuery) {
      this.searchQuery = this.nav.inputEl.value = ''
      this.render()
    }
    if (save) this.app.workspace.requestSaveLayout()
  }

  handleCollapseAll(): void {
    const collapse = !this.isAllCollapsed
    walk(this.nodes, n => n.setCollapsed(collapse))
    this.setIsAllCollapsed(collapse)
  }

  setIsAllCollapsed(on: boolean): void {
    this.isAllCollapsed = on
    if (on) setNavButton(this.collapseOrExpandAllEl, 'lucide-chevrons-up-down', OUTLINE_STRINGS.expandAll)
    else setNavButton(this.collapseOrExpandAllEl, 'lucide-chevrons-down-up', OUTLINE_STRINGS.collapseAll)
  }

  private updateCollapseButton(): void {
    let any = false
    let all = true
    walk(this.nodes, n => {
      if (!n.collapsible) return
      any = true
      if (!n.collapsed) all = false
    })
    this.setIsAllCollapsed(any && all)
  }
}
