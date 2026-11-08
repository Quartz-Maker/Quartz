/* eslint-disable @typescript-eslint/no-explicit-any */
// The `bookmarks` core plugin: items model, `<configDir>/bookmarks.json` (`{items:[…]}`),
// commands, file/editor/tab menus, tab-header bookmark action and rename tracking.
//   {type:'file',ctime,path,subpath?,title?} {type:'folder',ctime,path} {type:'search',ctime,query}
//   {type:'url',ctime,url,title} {type:'graph',ctime,title,options} {type:'group',ctime,title,items}
import type { CorePluginDef, InternalPlugin } from '../../app/InternalPlugins'
import { Notice } from '../../ui/Notice'
import { Keymap } from '../../keymap/Keymap'
import { BookmarksView, VIEW_TYPE_BOOKMARKS } from './BookmarksView'
import { EditBookmarkModal, BookmarkTabsModal } from './modals'
import { getGlobalSearchQuery } from '../../search/SearchView'

export type BookmarkType = 'file' | 'folder' | 'search' | 'url' | 'graph' | 'group' | 'heading' | 'block'
export interface BookmarkItem {
  type: BookmarkType
  ctime: number
  path?: string
  subpath?: string
  title?: string
  query?: string
  url?: string
  options?: any
  items?: BookmarkItem[]
  [k: string]: any
}
/** Parent group of an item (a Symbol key: never serialised). */
export const PARENT = Symbol('bookmark-parent')

const iso = (v: any) => v
export function walkItems(items: BookmarkItem[], cb: (item: BookmarkItem) => void): void {
  for (const it of items) {
    cb(it)
    if (it.type === 'group' && Array.isArray(it.items)) walkItems(it.items, cb)
  }
}

// ---- item factories ---------------------------------------------------------------------------
export const fileItem = (file: { path: string }, subpath?: string): BookmarkItem => {
  const it: BookmarkItem = { type: 'file', ctime: Date.now(), path: file.path }
  if (subpath) it.subpath = subpath
  return it
}
export const folderItem = (folder: { path: string }): BookmarkItem => ({ type: 'folder', ctime: Date.now(), path: folder.path })
export const searchItem = (query: string): BookmarkItem => ({ type: 'search', ctime: Date.now(), query })
export const urlItem = (url: string, title?: string): BookmarkItem => ({ type: 'url', ctime: Date.now(), url, title: title ?? url })
export const groupItem = (title = 'Untitled group'): BookmarkItem => ({ type: 'group', ctime: Date.now(), items: [], title })
export const graphItem = (options: any): BookmarkItem => ({ type: 'graph', ctime: Date.now(), title: 'Untitled Graph', options })

const stripExt = (p: string) => p.replace(/\.md$/, '')
const basename = (p: string) => stripExt(p.split('/').pop() ?? p)
const headingLink = (h: string) => h.replace(/[:#|^\\%\[\]]/g, ' ').replace(/\s+/g, ' ').trim()

export class BookmarksPlugin implements CorePluginDef {
  id = 'bookmarks'
  name = 'Bookmarks'
  description = 'Save shortcuts to files, searches, headings, and graphs.'
  defaultOn = true
  app: any
  plugin!: InternalPlugin
  hasValidData = false
  items: BookmarkItem[] = []
  bookmarkLookup: Record<string, BookmarkItem> = {}
  urlBookmarkLookup: Record<string, BookmarkItem> = {}
  bookmarkedViews = new WeakMap<object, HTMLElement>()
  private saveTimer: any = 0
  private notifyTimer: any = 0
  private events: { on: (name: string, cb: (...a: any[]) => any) => any }
  private listeners: Record<string, Array<(...a: any[]) => any>> = {};
  [k: string]: any

  constructor() {
    this.events = { on: (n, cb) => ((this.listeners[n] ||= []).push(cb), cb) }
  }
  on(name: string, cb: (...a: any[]) => any): any {
    return this.events.on(name, cb)
  }
  off(name: string, cb: (...a: any[]) => any): void {
    this.listeners[name] = (this.listeners[name] || []).filter(x => x !== cb)
  }
  trigger(name: string, ...args: any[]): void {
    for (const cb of this.listeners[name] || []) cb(...args)
  }

  // ---- plugin lifecycle ---------------------------------------------------------------------
  init(app: any, plugin: InternalPlugin): void {
    this.app = app
    this.plugin = plugin
  }

  async onEnable(app: any, p: InternalPlugin): Promise<void> {
    this.app = app
    this.plugin = p
    p.registerViewType(VIEW_TYPE_BOOKMARKS, leaf => new BookmarksView(leaf, this))
    this.registerCommands(app, p)
    const ws = app.workspace
    p.registerEvent(ws.on('editor-menu', this.onEditorMenu, this))
    p.registerEvent(ws.on('layout-ready', this.initLeaf, this))
    p.registerEvent(ws.on('file-menu', this.onFileMenu, this))
    p.registerEvent(ws.on('files-menu', this.onFilesMenu, this))
    p.registerEvent(ws.on('leaf-menu', this.onLeafMenu, this))
    p.registerEvent(ws.on('search:results-menu', this.onSearchResultsMenu, this))
    p.registerEvent(ws.on('tab-group-menu', this.onTabGroupMenu, this))
    p.registerEvent(ws.on('layout-change', this.updateTabHeaders, this))
    p.registerEvent(app.vault.on('rename', (f: any, old: string) => this.onFileRename(f, old)))
    p.register(() => {
      for (const b of this.allActionEls()) b.detach()
      this.bookmarkedViews = new WeakMap()
    })
    ws.registerHoverLinkSource?.(VIEW_TYPE_BOOKMARKS, { display: this.name, defaultMod: true })
    p.register(() => ws.unregisterHoverLinkSource?.(VIEW_TYPE_BOOKMARKS))
    await this.loadData()
    if (!this.hasValidData) await this.migrate()
    this.updateTabHeaders()
  }

  onUserEnable(): void {
    this.initLeaf()
  }
  initLeaf(): void {
    void this.app.workspace.ensureSideLeaf(VIEW_TYPE_BOOKMARKS, 'left', { reveal: false })
  }

  // ---- persistence --------------------------------------------------------------------------
  async loadData(): Promise<boolean> {
    let data: any = null
    try {
      data = await this.app.vault.readConfigJson('bookmarks')
    } catch {
      data = null
    }
    this.hasValidData = data !== undefined && data !== null
    if (data && Array.isArray(data.items)) {
      const link = (items: BookmarkItem[], parent: BookmarkItem | null) => {
        for (const it of items) {
          ;(it as any)[PARENT] = parent
          if (it.type === 'group') {
            if (!Array.isArray(it.items)) it.items = []
            link(it.items, it)
          }
        }
      }
      link(data.items, null)
      this.items = data.items
    } else if (data && Array.isArray(data.bookmarks)) {
      // Quartz <= 0.x: {bookmarks:[{id,type,path(absolute),title}]}
      this.items = this.convertLegacy(data.bookmarks)
      this.hasValidData = true
      this.saveNow()
    }
    this.rebuildBookmarkCache()
    return this.hasValidData
  }

  private convertLegacy(list: any[]): BookmarkItem[] {
    const base: string = (this.app.vault.adapter.getBasePath?.() ?? '').replace(/\\/g, '/')
    const out: BookmarkItem[] = []
    const now = Date.now()
    for (const b of list) {
      let p: string = (b.path ?? '').replace(/\\/g, '/')
      if (base && p.startsWith(base + '/')) p = p.slice(base.length + 1)
      if (b.type === 'folder') out.push({ type: 'folder', ctime: now, path: p })
      else if (b.type === 'search') out.push({ type: 'search', ctime: now, query: b.query ?? b.title ?? p })
      else if (p) out.push({ type: 'file', ctime: now, path: p })
    }
    return out
  }

  /** First run without bookmarks.json: import the legacy `starred.json`. */
  private async migrate(): Promise<void> {
    const app = this.app
    const run = async () => {
      let data: any = null
      try {
        data = await app.vault.readConfigJson('starred')
      } catch {
        return
      }
      if (!data || !Array.isArray(data.items)) return
      const items: BookmarkItem[] = []
      const now = Date.now()
      for (const o of data.items) {
        if ((o.type === 'file' || o.type === 'folder') && !app.vault.getAbstractFileByPath(o.path)) continue
        if (o.type === 'file') delete o.title
        if (!o.ctime) o.ctime = now
        items.push(o)
      }
      this.items = items
      this.onItemsChangedNow()
    }
    app.workspace.onLayoutReady(() => void run())
  }

  saveNow(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      void this.app.vault.writeConfigJson('bookmarks', { items: this.items })
    }, 100)
  }

  rebuildBookmarkCache(): void {
    this.bookmarkLookup = {}
    this.urlBookmarkLookup = {}
    walkItems(this.items, it => {
      if (it.type === 'file' && it.path && !it.subpath && !this.bookmarkLookup[it.path]) this.bookmarkLookup[it.path] = it
      else if (it.type === 'folder' && it.path && !this.bookmarkLookup[it.path]) this.bookmarkLookup[it.path] = it
      else if (it.type === 'url' && it.url) this.urlBookmarkLookup[it.url] = it
    })
  }

  /** Debounced (20 ms): rebuild the lookups, refresh views, persist. */
  onItemsChanged(save: boolean): void {
    clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => this._onItemsChanged(save), 20)
  }
  private onItemsChangedNow(): void {
    this._onItemsChanged(true)
  }
  _onItemsChanged(save: boolean): void {
    this.rebuildBookmarkCache()
    this.trigger('changed')
    this.updateTabHeaders()
    if (save) this.saveNow()
  }

  // ---- model --------------------------------------------------------------------------------
  getBookmarks(): BookmarkItem[] {
    const out: BookmarkItem[] = []
    walkItems(this.items, it => out.push(it))
    return out
  }
  getItemTitle(item: BookmarkItem): string | undefined {
    if (!item.title) {
      if (item.type === 'file' && item.subpath) return basename(item.path!) + item.subpath
      if (item.type === 'file' || item.type === 'folder') {
        const f = this.app.vault.getAbstractFileByPath(item.path)
        if (f && f.extension !== undefined) return f.basename ?? basename(item.path!)
        if (f) return f.name
        return basename(item.path!)
      }
      if (item.type === 'search') return item.query
    }
    return item.title
  }
  addItem(item: BookmarkItem, parent?: BookmarkItem | null): void {
    const list = parent ? parent.items! : this.items
    ;(item as any)[PARENT] = parent ?? null
    list.push(item)
    this.onItemsChanged(true)
  }
  editItem(_item: BookmarkItem): void {
    this._onItemsChanged(true)
  }
  removeItem(item: BookmarkItem | null | undefined): void {
    if (!item) return
    const list = (item as any)[PARENT]?.items ?? this.items
    const i = list.indexOf(item)
    if (i >= 0) list.splice(i, 1)
    this.onItemsChanged(true)
  }
  moveItem(item: BookmarkItem, parent: BookmarkItem | null, index: number): void {
    const from = (item as any)[PARENT]
    const src = from ? from.items : this.items
    const old = src.indexOf(item)
    if (old >= 0) src.splice(old, 1)
    const dst = parent ? parent.items! : this.items
    if (old !== -1 && old < index && src === dst) index--
    dst.splice(index, 0, item)
    ;(item as any)[PARENT] = parent
    this._onItemsChanged(true)
  }
  /** Bookmark for a view: file views by path, url views by url. */
  findBookmarkByView(view: any): BookmarkItem | null {
    if (view?.file && typeof view.file.path === 'string') return this.bookmarkLookup[view.file.path] ?? null
    if (view?.url) return this.urlBookmarkLookup[view.url] ?? null
    return null
  }
  /** A new item for what a leaf shows (file, search, graph, url) or null. */
  itemForLeaf(leaf: any): BookmarkItem | null {
    const v = leaf?.view
    if (!v) return null
    if (v.file && typeof v.file.path === 'string' && v.file.extension !== undefined) return fileItem(v.file)
    const type = v.getViewType?.()
    if (type === 'search') return searchItem(v.getQuery?.() ?? v.getState?.().query ?? '')
    if (type === 'graph') return graphItem(v.dataEngine?.getOptions?.() ?? {})
    if (v.url) return urlItem(v.url, v.getDisplayText?.())
    return null
  }

  // ---- opening --------------------------------------------------------------------------------
  openBookmark(item: BookmarkItem, evt?: MouseEvent | KeyboardEvent | boolean | string): void {
    const ws = this.app.workspace
    const newLeaf = typeof evt === 'object' && evt ? Keymap.isModEvent(evt as any) : (evt as any)
    switch (item.type) {
      case 'file': {
        const f = this.app.vault.getAbstractFileByPath(item.path)
        if (!f) return void new Notice(`File "${item.path}" not found.`)
        void ws.openLinkText(item.path! + (item.subpath ?? ''), '', newLeaf)
        break
      }
      case 'folder': {
        const f = this.app.vault.getAbstractFileByPath(item.path)
        if (!f) return void new Notice(`Folder "${item.path}" not found.`)
        void ws.ensureSideLeaf('file-explorer', 'left', { reveal: true, active: true }).then((l: any) => l?.view?.revealInFolder?.(f))
        break
      }
      case 'search':
        this.app.internalPlugins.getEnabledPluginById('global-search')?.openGlobalSearch?.(item.query)
        break
      case 'graph':
        void ws.getLeaf(newLeaf).setViewState({ type: 'graph', active: true, state: { options: item.options } })
        break
      case 'url':
        if (item.url) window.open(item.url, '_blank')
        break
    }
  }
  openBookmarks(items: BookmarkItem[], newLeaf = true): void {
    items.forEach((it, i) => this.openBookmark(it, i === 0 ? newLeaf : true))
  }

  // ---- tab header action ------------------------------------------------------------------
  private allActionEls(): HTMLElement[] {
    const out: HTMLElement[] = []
    this.app.workspace.iterateAllLeaves((l: any) => {
      const b = this.bookmarkedViews.get(l.view)
      if (b) out.push(b)
    })
    return out
  }
  updateTabHeaders(): void {
    this.app.workspace.iterateAllLeaves((leaf: any) => {
      const v = leaf.view
      if (!v || typeof v.addAction !== 'function') return
      const item = this.findBookmarkByView(v)
      const label = item ? 'Bookmarked' : 'Bookmark'
      let b = this.bookmarkedViews.get(v)
      if (!b) {
        b = v.addAction('lucide-bookmark', label, () => {
          const cur = this.findBookmarkByView(v)
          const it = cur ?? this.itemForLeaf(leaf)
          if (it) new EditBookmarkModal(this.app, this, it, !!cur).open()
        }) as HTMLElement
        b.addClass('mod-bookmark')
        this.bookmarkedViews.set(v, b)
      }
      b.toggleClass('mod-bookmarked', !!item)
      b.toggleClass('mod-filled', !!item)
      b.setAttribute('aria-label', label)
    })
  }

  onFileRename(file: any, oldPath: string): void {
    let changed = false
    walkItems(this.items, it => {
      if ((it.type === 'file' || it.type === 'folder') && it.path === oldPath) {
        it.path = file.path
        changed = true
      } else if ((it.type === 'file' || it.type === 'folder') && it.path && it.path.startsWith(oldPath + '/')) {
        it.path = file.path + it.path.slice(oldPath.length)
        changed = true
      }
    })
    if (changed) this.onItemsChanged(true)
  }

  // ---- menus --------------------------------------------------------------------------------
  onEditorMenu(menu: any, editor: any, view: any): void {
    const file = view?.file
    if (!file) return
    const cur = editor.getCursor()
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(editor.getLine(cur.line))
    if (!m) return
    const subpath = '#' + headingLink(m[1])
    menu.addItem((i: any) =>
      i
        .setTitle('Bookmark this heading...')
        .setIcon('lucide-bookmark')
        .setSection('action')
        .onClick(() => new EditBookmarkModal(this.app, this, fileItem(file, subpath), false).open())
    )
  }
  onFilesMenu(menu: any, files: any[]): void {
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle('Bookmark...')
        .setIcon('lucide-bookmark')
        .onClick(() => {
          const items = files.map(f => (f.extension !== undefined ? fileItem(f) : folderItem(f)))
          new BookmarkTabsModal(this.app, this, items).open()
        })
    )
  }
  onFileMenu(menu: any, file: any): void {
    if (file.isRoot?.() || file.path === '/') return
    const cur = this.bookmarkLookup[file.path]
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle(cur ? 'Edit bookmark...' : 'Bookmark...')
        .setIcon('lucide-bookmark')
        .onClick(() => {
          const it = this.bookmarkLookup[file.path] ?? (file.extension !== undefined ? fileItem(file) : folderItem(file))
          new EditBookmarkModal(this.app, this, it, !!cur).open()
        })
    )
  }
  onTabGroupMenu(menu: any, group: any): void {
    const items = (group.children as any[]).map(l => this.itemForLeaf(l)).filter(Boolean) as BookmarkItem[]
    if (!items.length) return
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle(`Bookmark ${items.length} tab${items.length === 1 ? '' : 's'}...`)
        .setIcon('lucide-bookmark')
        .onClick(() => new BookmarkTabsModal(this.app, this, items).open())
    )
  }
  onSearchResultsMenu(menu: any, view: any): void {
    const q = view.getQuery?.() ?? ''
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle('Bookmark...')
        .setIcon('lucide-bookmark')
        .onClick(() => new EditBookmarkModal(this.app, this, searchItem(q), false).open())
    )
  }
  onLeafMenu(menu: any, leaf: any): void {
    const v = leaf.view
    if (v?.getViewType?.() !== 'graph') return
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle('Bookmark...')
        .setIcon('lucide-bookmark')
        .onClick(() => new EditBookmarkModal(this.app, this, graphItem(v.dataEngine?.getOptions?.() ?? {}), false).open())
    )
  }

  // ---- commands -----------------------------------------------------------------------------
  private registerCommands(app: any, p: InternalPlugin): void {
    const ws = app.workspace
    p.registerGlobalCommand({ id: 'bookmarks:open', name: 'Bookmarks: Show bookmarks', icon: 'lucide-bookmark', callback: () => void ws.ensureSideLeaf(VIEW_TYPE_BOOKMARKS, 'left', { active: true }) })
    p.registerGlobalCommand({
      id: 'bookmarks:bookmark-current-view',
      name: 'Bookmarks: Bookmark...',
      icon: 'lucide-bookmark-plus',
      checkCallback: (checking: boolean) => {
        const leaf = ws.getMostRecentLeaf()
        if (!leaf) return false
        let item = this.findBookmarkByView(leaf.view)
        const isEdit = !!item
        item ||= this.itemForLeaf(leaf)
        if (!item) return
        if (!checking) new EditBookmarkModal(app, this, item, isEdit).open()
        return true
      }
    })
    p.registerGlobalCommand({
      id: 'bookmarks:bookmark-current-search',
      name: 'Bookmarks: Bookmark current search...',
      icon: 'lucide-search',
      checkCallback: (checking: boolean) => {
        if (!app.internalPlugins.getEnabledPluginById('global-search')) return
        if (!checking) {
          const q = getGlobalSearchQuery(app)
          if (!q) new Notice('No search query to bookmark.')
          else new EditBookmarkModal(app, this, searchItem(q), false).open()
        }
        return true
      }
    })
    p.registerGlobalCommand({
      id: 'bookmarks:unbookmark-current-view',
      name: 'Bookmarks: Remove bookmark for the current file',
      icon: 'lucide-bookmark-plus',
      checkCallback: (checking: boolean) => {
        const leaf = ws.getMostRecentLeaf()
        if (!leaf) return false
        const item = this.findBookmarkByView(leaf.view)
        if (!item) return
        if (!checking) this.removeItem(item)
        return true
      }
    })
    p.registerGlobalCommand({
      id: 'bookmarks:bookmark-current-section',
      name: 'Bookmarks: Bookmark block under cursor...',
      icon: 'lucide-bookmark-plus',
      editorCallback: (editor: any, view: any) => void this.bookmarkBlock(editor, view)
    })
    p.registerGlobalCommand({
      id: 'bookmarks:bookmark-current-heading',
      name: 'Bookmarks: Bookmark heading under cursor...',
      icon: 'lucide-bookmark-plus',
      editorCallback: (editor: any, view: any) => {
        const file = view.file
        if (!file) return
        const cache = app.metadataCache.getFileCache(file)
        const line = editor.getCursor('to').line
        let h: any = null
        for (const x of cache?.headings ?? []) if (x.position.start.line <= line) h = x
        if (h) new EditBookmarkModal(app, this, fileItem(file, '#' + headingLink(h.heading)), false).open()
      }
    })
    p.registerGlobalCommand({
      id: 'bookmarks:bookmark-all-tabs',
      name: 'Bookmarks: Bookmark all tabs...',
      icon: 'lucide-bookmark-plus',
      callback: () => {
        const items: BookmarkItem[] = []
        ws.iterateLeaves([ws.rootSplit, ws.floatingSplit].filter(Boolean), (l: any) => {
          const it = this.itemForLeaf(l)
          if (it) items.push(it)
        })
        if (items.length) new BookmarkTabsModal(app, this, items).open()
      }
    })
  }

  /** Bookmark the block at the cursor, giving it a `^id` anchor when it has none. */
  private async bookmarkBlock(editor: any, view: any): Promise<void> {
    const file = view.file
    if (!file) return
    const cache = this.app.metadataCache.getFileCache(file)
    const line = editor.getCursor('to').line
    const inRange = (n: any) => (line < n.position.start.line ? -1 : line > n.position.end.line ? 1 : 0)
    const sec = (cache?.sections ?? []).find((s: any) => inRange(s) === 0)
    let target: any = sec
    if (sec?.type === 'list') target = (cache.listItems ?? []).find((s: any) => inRange(s) === 0) ?? sec
    else if (sec?.type === 'heading') target = (cache.headings ?? []).find((s: any) => inRange(s) === 0) ?? sec
    if (!target) return
    let item: BookmarkItem
    if (target.heading !== undefined) item = fileItem(file, '#' + headingLink(target.heading))
    else {
      let id: string = target.id
      if (!id) {
        id = Math.random().toString(36).slice(2, 8)
        const end = target.position.end
        const lineText = editor.getLine(end.line - 0)
        editor.replaceRange(' ^' + id, { line: end.line, ch: lineText.length })
      }
      item = fileItem(file, '#^' + id)
    }
    if (editor.somethingSelected()) item.title = editor.getSelection().trim()
    new EditBookmarkModal(this.app, this, item, false).open()
  }
}

export { iso as _iso }
