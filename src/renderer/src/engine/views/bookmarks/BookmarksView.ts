/* eslint-disable @typescript-eslint/no-explicit-any */
// `bookmarks` view: tree of bookmark items (groups collapsible, inline rename, drag reorder, context menu).
//   .view-content > div > .tree-item[data-path] > .tree-item-self.bookmark.is-clickable[draggable]
//     > .tree-item-icon + .tree-item-inner > span.tree-item-inner-text ; groups add .mod-collapsible + .tree-item-children
import { ItemView } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { setIcon } from '../../workspace/dom'
import { Menu } from '../../ui/Menu'
import { createNavHeader, navButton } from '../properties/AllPropertiesView'
import { PARENT, groupItem, type BookmarkItem, type BookmarksPlugin } from './BookmarksPlugin'
import { EditBookmarkModal } from './modals'

export const VIEW_TYPE_BOOKMARKS = 'bookmarks'
const ICONS: Record<string, string> = { file: 'lucide-file', folder: 'lucide-folder', search: 'lucide-search', url: 'lucide-globe-2', graph: 'lucide-git-fork', group: 'right-triangle' }
const STYLE = 'margin-inline-start: 0px !important; padding-inline-start: 24px !important;'
let dragging: BookmarkItem | null = null

export class BookmarksView extends ItemView {
  icon = 'lucide-bookmark'
  showSearch = false
  searchQuery = ''
  listEl: HTMLElement
  emptyEl: HTMLElement | null = null
  nav: ReturnType<typeof createNavHeader>
  private collapsed = new Set<BookmarkItem>()
  private renaming: BookmarkItem | null = null
  private plugin: BookmarksPlugin

  constructor(leaf: WorkspaceLeaf, plugin: BookmarksPlugin) {
    super(leaf)
    this.plugin = plugin
    this.nav = createNavHeader(this.containerEl)
    navButton(this.nav.buttonsEl, 'lucide-bookmark-plus', 'Bookmark the active tab...', () => {
      const l = this.app.workspace.getMostRecentLeaf()
      const cur = l && plugin.findBookmarkByView(l.view)
      const it = cur ?? (l && plugin.itemForLeaf(l))
      if (it) new EditBookmarkModal(this.app, plugin, it, !!cur).open()
    })
    navButton(this.nav.buttonsEl, 'lucide-folder-plus', 'New group', () => {
      const g = groupItem()
      plugin.addItem(g, null)
      this.render()
      this.startRename(g)
    })
    navButton(this.nav.buttonsEl, 'lucide-chevrons-down-up', 'Collapse all', () => {
      const groups: BookmarkItem[] = plugin.getBookmarks().filter(i => i.type === 'group')
      const all = groups.every(g => this.collapsed.has(g))
      this.collapsed = new Set(all ? [] : groups)
      this.render()
    })
    navButton(this.nav.buttonsEl, 'lucide-search', 'Show search filter', () => {
      this.showSearch = !this.showSearch
      this.nav.searchEl.toggle(this.showSearch)
      if (this.showSearch) this.nav.inputEl.focus()
      this.app.workspace.requestSaveLayout()
    })
    this.nav.inputEl.addEventListener('input', () => {
      this.searchQuery = this.nav.inputEl.value
      this.render()
      this.app.workspace.requestSaveLayout()
    })
    this.contentEl.addClass('node-insert-event')
    this.contentEl.style.position = 'relative'
    this.listEl = this.contentEl.createDiv()
    this.contentEl.addEventListener('dragover', e => dragging && (e.preventDefault(), this.dropOnRoot(e)))
    this.contentEl.addEventListener('drop', e => {
      if (!dragging || e.defaultPrevented) return
      e.preventDefault()
      plugin.moveItem(dragging, null, plugin.items.length)
      dragging = null
    })
  }

  getViewType(): string {
    return VIEW_TYPE_BOOKMARKS
  }
  getDisplayText(): string {
    return 'Bookmarks'
  }
  getState(): Record<string, unknown> {
    return { showSearch: this.showSearch, searchQuery: this.searchQuery }
  }
  async setState(state: any, result: any): Promise<void> {
    if (typeof state?.showSearch === 'boolean') this.showSearch = state.showSearch
    if (typeof state?.searchQuery === 'string') this.searchQuery = this.nav.inputEl.value = state.searchQuery
    this.nav.searchEl.toggle(this.showSearch)
    this.render()
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const ws: any = this.app.workspace
    const p = this.plugin
    p.on('changed', () => this.render())
    this.register(() => p.off('changed', () => {}))
    this.registerEvent(ws.on('file-open', () => this.render()))
    this.render()
  }

  private dropOnRoot(_e: DragEvent): void {}

  render(): void {
    const p = this.plugin
    const el = this.listEl
    el.empty()
    this.emptyEl?.detach()
    if (p.items.length) el.createDiv({ attr: { style: 'width: 1px; height: 0.1px; margin-bottom: 0px;' } })
    const active = this.app.workspace.getActiveFile?.()?.path
    const q = this.searchQuery.toLowerCase()
    const matches = (it: BookmarkItem): boolean => {
      if (!q) return true
      if ((p.getItemTitle(it) ?? '').toLowerCase().includes(q)) return true
      return it.type === 'group' && (it.items ?? []).some(matches)
    }
    const draw = (items: BookmarkItem[], parentEl: HTMLElement, prefix = '') => {
      for (const it of items) {
        if (!matches(it)) continue
        const title = p.getItemTitle(it) ?? ''
        const isGroup = it.type === 'group'
        const folded = isGroup && this.collapsed.has(it) && !q
        const row = parentEl.createDiv({ cls: 'tree-item', attr: { 'data-path': prefix + title } })
        if (folded) row.addClass('is-collapsed')
        const self = row.createDiv({ cls: 'bookmark is-clickable tree-item-self', attr: { draggable: 'true', style: STYLE } })
        if (isGroup) self.addClass('mod-collapsible')
        if (it.type === 'file' && !it.subpath && it.path === active) self.addClass('is-active')
        if (folded) self.addClass('is-collapsed')
        const icon = self.createDiv('tree-item-icon')
        if (isGroup) icon.addClass('collapse-icon')
        if (isGroup && folded) icon.addClass('is-collapsed')
        setIcon(icon, it.type === 'file' && it.subpath ? (it.subpath.startsWith('#^') ? 'lucide-toy-brick' : 'lucide-heading') : ICONS[it.type] ?? 'lucide-bookmark')
        const text = self.createEl('div', { cls: 'tree-item-inner' }).createSpan({ cls: 'tree-item-inner-text', text: title })
        if (this.renaming === it) this.makeEditable(text, it, self)
        self.addEventListener('click', e => {
          if (this.renaming) return
          if (isGroup) {
            if (this.collapsed.has(it)) this.collapsed.delete(it)
            else this.collapsed.add(it)
            this.render()
          } else p.openBookmark(it, e)
        })
        self.addEventListener('auxclick', e => e.button === 1 && !isGroup && (e.preventDefault(), p.openBookmark(it, true)))
        self.addEventListener('contextmenu', e => (e.preventDefault(), this.showMenu(e, it)))
        this.attachDrag(self, it)
        if (isGroup) {
          const kids = row.createDiv({ cls: 'tree-item-children', attr: { style: 'min-height: 0px;' } })
          if (folded) kids.hide()
          if ((it.items ?? []).length) kids.createDiv({ attr: { style: 'width: 1px; height: 0.1px; margin-bottom: 0px;' } })
          draw(it.items ?? [], kids, prefix + title + '/')
        }
      }
    }
    draw(p.items, el)
    if (!p.items.length) {
      this.emptyEl = this.contentEl.createDiv({ cls: 'bookmarks-pane-empty pane-empty', text: 'No bookmarks found' })
    }
  }

  private attachDrag(self: HTMLElement, it: BookmarkItem): void {
    const p = this.plugin
    self.addEventListener('dragstart', e => {
      dragging = it
      e.dataTransfer?.setData('text/plain', it.path ?? it.title ?? '')
      const dm = (this.app as any).dragManager
      if (dm && it.type === 'file') dm.onDragStart(e, { source: 'bookmarks', type: 'bookmarks', icon: 'lucide-bookmark', title: it.title || it.path, items: [{ item: it }] })
      self.addClass('is-being-dragged')
    })
    self.addEventListener('dragend', () => {
      dragging = null
      self.removeClass('is-being-dragged')
      this.listEl.querySelectorAll('.is-drop-before,.is-drop-after,.is-drop-into').forEach(x => x.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into'))
    })
    const zone = (e: DragEvent): 'before' | 'after' | 'into' => {
      const r = self.getBoundingClientRect()
      const y = (e.clientY - r.top) / r.height
      if (it.type === 'group' && y > 0.25 && y < 0.75) return 'into'
      return y < 0.5 ? 'before' : 'after'
    }
    self.addEventListener('dragover', e => {
      if (!dragging || dragging === it) return
      e.preventDefault()
      const z = zone(e)
      self.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into')
      self.classList.add('is-drop-' + z)
    })
    self.addEventListener('dragleave', () => self.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into'))
    self.addEventListener('drop', e => {
      const d = dragging
      if (!d || d === it) return
      e.preventDefault()
      e.stopPropagation()
      dragging = null
      // Never drop a group into itself.
      for (let a: any = it; a; a = a[PARENT]) if (a === d) return
      const z = zone(e)
      if (z === 'into') return p.moveItem(d, it, it.items!.length)
      const parent: BookmarkItem | null = (it as any)[PARENT] ?? null
      const list = parent ? parent.items! : p.items
      p.moveItem(d, parent, list.indexOf(it) + (z === 'after' ? 1 : 0))
    })
  }

  private makeEditable(text: HTMLElement, it: BookmarkItem, self: HTMLElement): void {
    self.addClass('is-being-renamed', 'has-focus')
    text.contentEditable = 'true'
    let done = false
    const finish = (commit: boolean) => {
      if (done) return
      done = true
      this.renaming = null
      const v = (text.textContent ?? '').trim()
      if (commit) {
        if (v) it.title = v
        else if (it.type !== 'group') delete it.title
        this.plugin.editItem(it)
      } else this.render()
    }
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter') (e.preventDefault(), finish(true))
      else if (e.key === 'Escape') (e.preventDefault(), finish(false))
    })
    text.addEventListener('blur', () => finish(true))
    setTimeout(() => {
      text.focus()
      const r = document.createRange()
      r.selectNodeContents(text)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    })
  }

  startRename(it: BookmarkItem): void {
    this.renaming = it
    this.render()
  }

  private showMenu(e: MouseEvent, it: BookmarkItem): void {
    const p = this.plugin
    const m = new Menu()
    m.addSections(['open', 'action', 'view', 'info', '', 'danger'])
    const targets = () => (it.type === 'group' ? (it.items ?? []).filter(i => i.type !== 'group') : [it])
    if (it.type !== 'search' || true) {
      m.addItem(i => i.setSection('open').setTitle('Open in new tab').setIcon('lucide-file-plus').onClick(() => p.openBookmarks(targets(), true)))
      m.addItem(i => i.setSection('open').setTitle('Open to the right').setIcon('lucide-separator-vertical').onClick(() => targets().forEach(t => p.openBookmark(t, 'split' as any))))
      m.addItem(i => i.setSection('open').setTitle('Open in new window').setIcon('lucide-picture-in-picture-2').onClick(() => targets().forEach(t => p.openBookmark(t, 'window' as any))))
    }
    m.addItem(i => i.setSection('action').setTitle('Rename').setIcon('lucide-pencil').onClick(() => this.startRename(it)))
    if (it.type === 'group') {
      m.addItem(i =>
        i
          .setSection('action')
          .setTitle('Bookmark the active tab...')
          .setIcon('lucide-bookmark-plus')
          .onClick(() => {
            const l = this.app.workspace.getMostRecentLeaf()
            const n = l && p.itemForLeaf(l)
            if (n) p.addItem(n, it)
          })
      )
      m.addItem(i =>
        i
          .setSection('action')
          .setTitle('New group')
          .setIcon('lucide-folder-plus')
          .onClick(() => {
            const g = groupItem()
            p.addItem(g, it)
            this.startRename(g)
          })
      )
    } else m.addItem(i => i.setSection('action').setTitle('Edit...').setIcon('lucide-wrench').onClick(() => new EditBookmarkModal(this.app, p, it, true).open()))
    if (it.type === 'file') m.addItem(i => i.setSection('view').setTitle('Reveal file in navigation').setIcon('lucide-folder-open').onClick(() => void this.app.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true, active: true }).then((l: any) => l?.view?.revealInFolder?.(this.app.vault.getAbstractFileByPath(it.path!)))))
    m.addItem(i => i.setSection('danger').setTitle('Remove').setIcon('lucide-trash-2').setWarning(true).onClick(() => p.removeItem(it)))
    m.showAtMouseEvent(e)
  }
}
