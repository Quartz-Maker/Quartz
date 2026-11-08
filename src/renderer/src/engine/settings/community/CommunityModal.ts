/* eslint-disable @typescript-eslint/no-explicit-any */
// Base of the Community plugins / Community themes browsers (a popout modal).
//
// DOM: `.modal.mod-community-modal.mod-sidebar-layout > .modal-content > .modal-sidebar
//   (> .community-modal-controls (> .community-modal-search (search + sort button), "Show installed only"
//   toggle, custom controls, .community-modal-search-summary) + .community-modal-search-results-wrapper
//   (> .community-modal-empty-state, .community-modal-search-results-status, .community-modal-search-results
//   > .community-item*)) + .community-modal-details` (attached while an item is selected: back titlebar +
//   the item's page). Opens in a 1100x800 popout window when `settingsPopoutWindow` is on.
import { Modal, Menu, Setting, SearchComponent, ButtonComponent, ToggleComponent, setIcon, setTooltip } from '../../ui'
import { Platform } from '../../keymap/Platform'
import { openPopupWindow } from '../../workspace/popout'
import { naturalCompare } from '../../theme/styleOrder'
import { debounce } from '../../vault/debounce'
import { markdownToHtml } from '../../markdown/pipeline'
import { sanitizeHTMLToDom } from '../../markdown/sanitize'
import { t } from '../i18n'
import { rawUrl, repoUrl } from './registry'

export type SortOrder = 'download' | 'update' | 'release' | 'alphabetical'

const SORT_LABELS: Record<SortOrder, string> = {
  download: 'setting.thirdPartyPlugin.labelByPopularity',
  release: 'setting.thirdPartyPlugin.labelByReleased',
  alphabetical: 'setting.thirdPartyPlugin.labelAlphabetical',
  update: 'setting.thirdPartyPlugin.labelByUpdated'
}

export interface CommunityItem {
  name: string
  author?: string
  downloads: number
  updated: number
  el: HTMLElement
  init: boolean
  matches: [number, number][] | null
  score: number
  [k: string]: any
}

/** Adds `is-loading` to `el` while `fn` runs. */
export async function withLoading<T>(el: HTMLElement, fn: () => Promise<T>): Promise<T> {
  el.addClass('is-loading')
  try {
    return await fn()
  } finally {
    el.removeClass('is-loading')
  }
}

/** Adds `mod-loading` to a button while `fn` runs. */
export async function withButtonLoading<T>(el: HTMLElement, fn: () => Promise<T>): Promise<T> {
  el.addClass('mod-loading')
  try {
    return await fn()
  } finally {
    el.removeClass('mod-loading')
  }
}

/** `{{count}} plugins` with the count in locale format ("9,598"). */
export function countNoun(key: string, count: number): string {
  return t(key, { count }).replace(String(count), count.toLocaleString())
}

/** Renders a repo README into `el` and rewrites its relative links / embeds / images to GitHub. */
export function renderReadme(el: HTMLElement, markdown: string, repo: string): void {
  el.appendChild(sanitizeHTMLToDom(markdownToHtml(markdown)))
  el.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null
    if (e.button !== 0 || !a || !el.contains(a)) return
    const href = a.getAttribute('href') || ''
    if (!href.startsWith('#')) return
    const id = href.substring(1).toLowerCase()
    for (const h of Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      const heading = h.getAttribute('data-heading')
      if (heading && heading.toLowerCase().replace(/[ -⁯⸀-⹿\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/g, '').replace(/ /g, '-') === id) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' })
        e.preventDefault()
        return
      }
    }
  })
  for (const a of Array.from(el.querySelectorAll('a.internal-link'))) a.setAttribute('href', repoUrl(repo) + '/blob/HEAD/' + a.getAttribute('href'))
  for (const embed of Array.from(el.querySelectorAll('.internal-embed'))) {
    const src = embed.getAttribute('src')
    if (!src) continue
    const url = rawUrl(repo, src)
    const ext = (src.split('/').pop() || '').split('.').pop()?.toLowerCase() || ''
    if (['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext)) embed.createEl('video', { attr: { controls: '', preload: 'metadata', src: url + '#t=0.001' } })
    else {
      const img = embed.createEl('img', { attr: { alt: embed.getAttribute('alt') || null } })
      const w = embed.getAttribute('width')
      const h = embed.getAttribute('height')
      if (w) img.setAttribute('width', w)
      if (h) img.setAttribute('height', h)
      img.src = url
    }
  }
  for (const m of Array.from(el.querySelectorAll('img, video')) as HTMLImageElement[]) {
    const src = m.getAttribute('src')
    if (!src) continue
    if (!src.includes(':')) {
      m.src = rawUrl(repo, src)
      continue
    }
    const gh = src.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)$/)
    if (gh) m.src = rawUrl(gh[1] + '/' + gh[2], gh[4], gh[3])
  }
}

/** A modal that lives in its own popout window when `shouldUsePopout()`. */
export class PopoutModal extends Modal {
  popout: { win: any; cleanup: () => void } | null = null
  popoutStorageKey: string | null = null
  windowTitle = ''
  private quitRef: any = null
  private unloadHandler: (() => void) | null = null

  constructor(app: any) {
    super(app)
    this.scope.register(['Mod'], 'W', () => {
      this.close()
      return false
    })
  }
  getPopoutOptions(): { width?: number; height?: number; minWidth?: number; minHeight?: number; x?: number; y?: number } {
    return {}
  }
  shouldUsePopout(): boolean {
    return true
  }
  isInPopoutWindow(): boolean {
    return this.popout !== null
  }
  getPopoutWindow(): any {
    const w = this.popout?.win
    return !w || w.closed ? null : w
  }
  getRootEl(): HTMLElement {
    return this.popout ? this.modalEl : this.containerEl
  }
  open(): void {
    const p = this.popout
    if (p) {
      if (!p.win.closed) {
        const ew = p.win.electronWindow
        if (ew) {
          if (ew.isMinimized()) ew.restore()
          ew.focus()
        }
        return
      }
      p.cleanup()
      this.popout = null
    }
    if (!this.modalEl.parentElement) this.containerEl.append(this.modalEl)
    if (Platform.canPopoutWindow && this.shouldUsePopout()) {
      const o = this.getPopoutOptions()
      if (this.popoutStorageKey) {
        const saved = this.app.loadLocalStorage?.(this.popoutStorageKey)
        if (saved) Object.assign(o, { width: saved.width, height: saved.height, x: saved.x, y: saved.y })
      }
      this.popout = openPopupWindow({
        title: this.app.getAppTitle ? this.app.getAppTitle(this.windowTitle) : this.windowTitle,
        width: o.width,
        height: o.height,
        minWidth: o.minWidth,
        minHeight: o.minHeight,
        x: o.x,
        y: o.y,
        onClose: () => this.close()
      })
      if (this.popout) {
        const w = this.popout.win
        w.document.body.addClass('is-popout-modal')
        ;(window as any).activeWindow = w
        ;(window as any).activeDocument = w.document
        this.quitRef = this.app.workspace?.on?.('quit', () => this.close())
        this.unloadHandler = () => this.popout?.cleanup()
        window.addEventListener('beforeunload', this.unloadHandler)
      }
    }
    // a previous popout open moved modalEl into the popout document
    if (!this.popout && this.modalEl.parentElement !== this.containerEl) this.containerEl.append(this.modalEl)
    super.open()
  }
  close(): void {
    const p = this.popout
    if (p) {
      const w = p.win
      if (this.popoutStorageKey && !w.closed) this.app.saveLocalStorage?.(this.popoutStorageKey, { x: w.screenX, y: w.screenY, width: w.outerWidth, height: w.outerHeight })
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
    super.close()
    this.popout = null
  }
}

/** Deferred card rendering: runs queued renderers in batches while the list is scrolled near its end. */
class RenderQueue {
  private q: (() => void)[] = []
  private scheduled = false
  constructor(private nearEnd: () => boolean) {}
  add(fn: () => void): void {
    this.q.push(fn)
    this.pump()
  }
  clear(): void {
    this.q.length = 0
  }
  pump(): void {
    if (this.scheduled || !this.q.length) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      const start = performance.now()
      let n = 0
      while (this.q.length && this.nearEnd() && n < 10 && performance.now() - start < 100) {
        this.q.shift()!()
        n++
      }
      if (this.q.length && this.nearEnd()) this.pump()
    }, 0)
  }
}

export abstract class CommunityModal<I extends CommunityItem> extends PopoutModal {
  sortOrder: SortOrder = 'download'
  sortOrderOptions: SortOrder[] = []
  items: Record<string, I> = {}
  itemsVisible: I[] = []
  selectedItemId: string | null = null
  sidebarEl: HTMLElement
  detailsEl: HTMLElement
  search!: SearchComponent
  installedOnlyToggleSetting!: Setting
  installedOnlyToggle!: ToggleComponent
  searchSummaryEl!: HTMLElement
  emptyStateEl: HTMLElement
  listStatusEl: HTMLElement
  listEl: HTMLElement
  renderQueue: RenderQueue
  backButtonEl: HTMLElement | null = null
  onChangeCallback: (() => any) | null = null

  constructor(app: any) {
    super(app)
    this.dimBackground = false
    this.returnToGridView = this.returnToGridView.bind(this)
    this.modalEl.addClass('mod-community-modal', 'mod-sidebar-layout')
    this.scope.register(['Mod'], 'F', () => {
      const input = this.search.inputEl
      input.focus()
      input.select()
      return false
    })
    const sidebar = (this.sidebarEl = this.contentEl.createDiv('modal-sidebar'))
    this.detailsEl = createDiv('community-modal-details')
    sidebar.createDiv('community-modal-controls', controls => {
      const searchEl = controls.createDiv('community-modal-search')
      this.search = new SearchComponent(searchEl)
      this.search.setClass('mod-raised')
      const input = this.search.inputEl
      if (!input.hasAttribute('spellcheck')) input.setAttribute('spellcheck', 'false')
      this.search.onChange(debounce(() => this.update(), 300, false))
      input.addEventListener('keydown', e => {
        if (e.isComposing || e.defaultPrevented) return
        if (e.key === 'ArrowDown' && input.selectionStart === input.value.length) {
          e.preventDefault()
          this.focusItemAt(0)
        }
      })
      new ButtonComponent(searchEl)
        .setClass('clickable-icon')
        .setIcon('lucide-sort-asc')
        .setTooltip(t('plugins.fileExplorer.actionChangeSort'))
        .onClick(e => this.showSortMenu(e))
      this.installedOnlyToggleSetting = new Setting(controls).setName(t('setting.thirdPartyPlugin.showInstalledOnly')).addToggle(tg => {
        this.installedOnlyToggle = tg.setValue(false).onChange(() => this.update())
      })
      this.addCustomControls(controls)
      this.searchSummaryEl = controls.createDiv('community-modal-search-summary u-muted')
    })
    const wrapper = sidebar.createDiv('community-modal-search-results-wrapper')
    this.emptyStateEl = wrapper.createDiv('community-modal-empty-state')
    this.listStatusEl = wrapper.createDiv('community-modal-search-results-status')
    this.listEl = wrapper.createDiv('community-modal-search-results')
    this.listEl.addEventListener('keydown', e => {
      if (e.isComposing || e.defaultPrevented) return
      const target = e.target as HTMLElement
      if (!target.hasClass('community-item')) return
      const i = this.itemsVisible.findIndex(x => x.el === target)
      if (i === -1) return
      const cols = this.getGridColumns()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.focusItemAt(Math.min(i + cols, this.itemsVisible.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (i - cols < 0) this.search.inputEl.focus()
        else this.focusItemAt(i - cols)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (i + 1 < this.itemsVisible.length) this.focusItemAt(i + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (i - 1 >= 0) this.focusItemAt(i - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        target.click()
      }
    })
    this.renderQueue = new RenderQueue(() => wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - wrapper.clientHeight / 2)
    wrapper.addEventListener('scroll', () => this.renderQueue.pump(), { passive: true })
  }

  abstract loadItems(): Promise<Record<string, I>>
  abstract updateItems(): I[]
  abstract showItem(item: I): Promise<void>
  addCustomControls(_el: HTMLElement): void {}

  shouldUsePopout(): boolean {
    return !!this.app.vault.getConfig('settingsPopoutWindow')
  }
  getPopoutOptions(): any {
    return { width: 1100, height: 800, minWidth: 400, minHeight: 400 }
  }

  focusItemAt(i: number): void {
    const el = this.itemsVisible[i]?.el
    if (el) el.focus({ preventScroll: false })
  }

  async onOpen(): Promise<void> {
    this.listEl.hide()
    this.emptyStateEl.show()
    try {
      this.items = await withLoading(this.emptyStateEl, () => this.loadItems())
      this.listEl.show()
      this.emptyStateEl.hide()
      this.emptyStateEl.empty()
      this.update()
      if (this.selectedItemId) void this.selectItem(this.selectedItemId)
    } catch (e: any) {
      this.listEl.hide()
      const buttons = createDiv('button-container')
      const retry = buttons.createEl('button', { cls: 'mod-cta', text: t('dialogue.buttonRetry') })
      retry.addEventListener('click', () => void withButtonLoading(retry, () => this.onOpen()))
      this.emptyStateEl.setChildrenInPlace([createDiv({ text: e?.message ?? String(e) }), buttons])
      this.emptyStateEl.show()
    }
  }

  onClose(): void {
    this.onCloseCallback?.()
  }

  onHistoryBack(): void {
    if (this.selectedItemId) {
      const item = this.items[this.selectedItemId]
      this.returnToGridView()
      if (item) {
        const i = this.itemsVisible.indexOf(item)
        if (i >= 0) return this.focusItemAt(i)
      }
      if (Platform.hasPhysicalKeyboard) this.search.inputEl.focus()
    } else if (!this.isInPopoutWindow()) this.close()
  }

  onEscapeKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    if (this.selectedItemId) {
      e.preventDefault()
      this.onHistoryBack()
    } else super.onEscapeKey(e)
  }

  update(): void {
    const items = (this.itemsVisible = this.updateItems())
    if (items.length === 0) this.listEl.setChildrenInPlace([createDiv({ cls: 'community-item', text: t('setting.thirdPartyPlugin.labelNoResultsFound') })])
    else this.listEl.setChildrenInPlace(items.map(i => i.el))
  }

  returnToGridView(): void {
    void this.selectItem(null)
  }

  async selectItem(id: string | null): Promise<void> {
    const details = this.detailsEl
    if (details.hasClass('is-loading')) return
    const items = this.items
    const prev = this.selectedItemId
    if (prev && Object.hasOwn(items, prev)) items[prev].el.removeClass('is-selected')
    details.empty()
    this.backButtonEl?.detach()
    this.backButtonEl = null
    this.selectedItemId = id
    if (id !== null && Object.keys(items).length === 0) return
    if (id === null || !Object.hasOwn(items, id)) {
      this.selectedItemId = ''
      details.detach()
      return
    }
    if (!details.parentElement) this.contentEl.append(details)
    const item = items[id]
    item.el.addClass('is-selected')
    this.focusItemAt(this.itemsVisible.indexOf(item))
    await withLoading(details, async () => {
      details.createDiv('setting-page-titlebar', bar => {
        bar.createDiv('clickable-icon setting-page-back-button', b => {
          setTooltip(b, t('interface.startScreen.buttonBack'))
          setIcon(b, 'lucide-chevron-left')
          b.addEventListener('click', this.returnToGridView)
        })
      })
      await this.showItem(item)
    })
  }

  showSortMenu(e: MouseEvent): void {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    if (target.hasClass('has-active-menu')) return
    const menu = new Menu()
    const current = this.sortOrder
    for (const order of this.sortOrderOptions)
      menu.addItem(i =>
        i
          .setTitle(t(SORT_LABELS[order]))
          .setChecked(order === current)
          .onClick(() => {
            this.sortOrder = order
            this.update()
          })
      )
    menu.setParentElement(target).showAtMouseEvent(e)
  }

  sortItems(list: I[]): void {
    const order = this.sortOrder
    if (order === 'release') {
      list.reverse()
      return
    }
    const cmp =
      order === 'update'
        ? (a: I, b: I) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
        : order === 'alphabetical'
          ? (a: I, b: I) => naturalCompare(a.name, b.name)
          : (a: I, b: I) => b.downloads - a.downloads
    list.sort(cmp)
  }

  scrollIntoView(id: string): void {
    const item = this.items[id]
    if (item && !Platform.isPhone) item.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  openSettings(): void {
    if (!this.isInPopoutWindow()) this.close()
    this.app.setting.open()
  }

  getGridColumns(): number {
    const v = this.itemsVisible
    if (v.length <= 1) return 1
    const top = v[0].el.offsetTop
    for (let i = 1; i < v.length; i++) if (v[i].el.offsetTop !== top) return i
    return v.length
  }

  setAutoOpen(id: string): this {
    this.selectedItemId = id
    return this
  }

  setChangeCallback(cb: () => any): this {
    this.onChangeCallback = cb
    return this
  }

  /** Card renderer: the first 20 render immediately, the rest as the list is scrolled (hidden until then). */
  protected queueRender(list: I[], render: (item: I) => void): void {
    this.renderQueue.clear()
    let n = 0
    for (const item of list) {
      item.el.hide()
      const fn = (): void => {
        render(item)
        item.el.show()
      }
      if (n < 20) fn()
      else this.renderQueue.add(fn)
      n++
    }
  }
}
