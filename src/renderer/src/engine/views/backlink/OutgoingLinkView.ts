/* eslint-disable @typescript-eslint/no-explicit-any */
// "outgoing-link" view (outgoing-link core plugin), DOM:
//   .view-content > .outgoing-link-pane[style=position:relative]
//     > section "Links" (.tree-item-self + .search-result-container > .outgoing-link-item.tree-item-self…)
//     > section "Unlinked mentions" (.search-result-container > .search-results-children > .search-result.tree-item
//                                    > .search-result-file-matches > .search-result-file-match (+ destination chip "Link this file"))
// Leaf state {file, linksCollapsed, unlinkedCollapsed}. Section chrome is shared with the backlinks view.
import { ItemView } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'
import { Keymap } from '../../keymap/Keymap'
import { Menu } from '../../ui/Menu'
import { CollapsibleSection, STRINGS, aliasesOf, debounceFn, excludedRanges, findMentions } from './common'

export const VIEW_TYPE_OUTGOING_LINK = 'outgoing-link'
const SIZER = 'width: 1px; height: 0.1px; margin-bottom: 0px;'

interface OutLink {
  linktext: string
  path: string
  subpath: string
  file: any
}

export class OutgoingLinkView extends ItemView {
  icon = 'links-going-out'
  allowNoFile = true
  file: any = null
  linksCollapsed = false
  unlinkedCollapsed = true
  paneEl: HTMLElement
  links: CollapsibleSection
  unlinked: CollapsibleSection
  requestUpdate: (() => void) & { cancel(): void }
  private gen = 0

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const pane = (this.paneEl = this.contentEl.createDiv('outgoing-link-pane node-insert-event'))
    pane.style.position = 'relative'
    this.links = new CollapsibleSection(pane, STRINGS.links, c => {
      this.linksCollapsed = c
      this.app.workspace.requestSaveLayout()
    })
    this.unlinked = new CollapsibleSection(pane, STRINGS.unlinkedMentions, c => {
      this.unlinkedCollapsed = c
      if (!c) void this.update()
      this.app.workspace.requestSaveLayout()
    })
    this.unlinked.containerEl.createDiv('search-results-children').style.minHeight = '0px'
    this.unlinked.setCollapsed(true)
    this.unlinked.setCount(null)
    this.requestUpdate = debounceFn(() => void this.update(), 100)
  }

  getViewType(): string {
    return VIEW_TYPE_OUTGOING_LINK
  }
  getDisplayText(): string {
    return this.leaf?.group && this.file ? STRINGS.outgoingFrom(this.file.basename) : STRINGS.outgoingTitle
  }
  getState(): Record<string, unknown> {
    const s: Record<string, unknown> = {}
    if (this.file) s.file = this.file.path
    s.linksCollapsed = this.linksCollapsed
    s.unlinkedCollapsed = this.unlinkedCollapsed
    return s
  }
  async setState(state: any, result: any): Promise<void> {
    state = state || {}
    if (typeof state.file === 'string') {
      const f = (this.app.vault as any).getAbstractFileByPath(state.file)
      if (f && typeof f.extension === 'string') this.setFile(f)
    }
    if (typeof state.linksCollapsed === 'boolean') {
      this.linksCollapsed = state.linksCollapsed
      this.links.setCollapsed(state.linksCollapsed)
    }
    if (typeof state.unlinkedCollapsed === 'boolean') {
      const was = this.unlinkedCollapsed
      this.unlinkedCollapsed = state.unlinkedCollapsed
      this.unlinked.setCollapsed(state.unlinkedCollapsed)
      if (was && !state.unlinkedCollapsed) void this.update()
    }
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const ws: any = this.app.workspace
    const mc: any = (this.app as any).metadataCache
    this.registerEvent(ws.on('file-open', () => this.onFileOpen()))
    this.registerEvent(mc.on('resolved', () => this.requestUpdate()))
    this.registerEvent(mc.on('changed', (f: any) => f === this.file && this.requestUpdate()))
    this.registerEvent(this.app.vault.on('rename', () => this.requestUpdate()))
    this.registerEvent(this.app.vault.on('delete', (f: any) => (f === this.file ? this.setFile(null) : this.requestUpdate())))
    this.register(() => this.requestUpdate.cancel())
    this.onFileOpen()
  }

  onFileOpen(): void {
    if (this.leaf.group) {
      for (const l of this.app.workspace.getGroupLeaves(this.leaf.group)) {
        const v: any = l.view
        if (l !== this.leaf && v?.file) return this.setFile(v.file)
      }
      return
    }
    const f = this.app.workspace.getActiveFile?.() ?? null
    if (f) this.setFile(f)
  }

  setFile(file: any): void {
    if (file === this.file) return
    this.file = file
    this.titleEl.setText(this.getDisplayText())
    this.leaf.updateHeader?.()
    void this.update()
  }

  /** Distinct links of the note (links + embeds + frontmatter links) in document order. */
  private collectLinks(): OutLink[] {
    const app: any = this.app
    const cache = app.metadataCache.getFileCache(this.file)
    if (!cache) return []
    const refs: any[] = [...(cache.links ?? []), ...(cache.embeds ?? []), ...(cache.frontmatterLinks ?? [])]
    refs.sort((a, b) => (a.position?.start.offset ?? 0) - (b.position?.start.offset ?? 0))
    const seen = new Set<string>()
    const out: OutLink[] = []
    for (const r of refs) {
      const link: string = r.link
      if (!link || seen.has(link)) continue
      seen.add(link)
      const hash = link.indexOf('#')
      const path = hash >= 0 ? link.slice(0, hash) : link
      const subpath = hash >= 0 ? link.slice(hash) : ''
      const file = path ? app.metadataCache.getFirstLinkpathDest(path, this.file.path) : this.file
      out.push({ linktext: link, path, subpath, file })
    }
    return out
  }

  async update(): Promise<void> {
    const gen = ++this.gen
    const app: any = this.app
    const box = this.links.containerEl
    box.empty()
    if (!this.file) {
      this.links.setCount(0)
      this.unlinked.setCount(this.unlinkedCollapsed ? null : 0)
      this.unlinked.containerEl.empty()
      return
    }
    const links = this.collectLinks()
    this.links.setCount(links.length)
    if (links.length === 0) box.createDiv({ cls: 'search-empty-state', text: STRINGS.noLinks })
    else {
      box.createDiv({ attr: { style: SIZER } })
      for (const l of links) this.renderLink(box, l)
    }
    if (this.unlinkedCollapsed) {
      this.unlinked.setCount(null)
      return
    }
    const content: string = await app.vault.cachedRead(this.file)
    if (gen !== this.gen) return
    this.renderUnlinked(content)
  }

  private renderLink(box: HTMLElement, l: OutLink): void {
    const app: any = this.app
    const resolved = !!l.file
    const self = box.createDiv({ cls: 'outgoing-link-item tree-item-self is-clickable' })
    const icon = self.createSpan('tree-item-icon')
    const inner = self.createDiv('tree-item-inner')
    let headingMissing = false
    if (resolved && l.subpath && l.file.extension === 'md') {
      const hs: any[] = app.metadataCache.getFileCache(l.file)?.headings ?? []
      const want = l.subpath.slice(1).toLowerCase().replace(/[\s]+/g, ' ')
      headingMissing = !l.subpath.startsWith('#^') && !hs.some(h => h.heading.toLowerCase().replace(/[\s]+/g, ' ') === want)
    }
    setIcon(icon, !resolved ? 'lucide-file-plus' : headingMissing ? 'lucide-file-question' : 'lucide-link')
    if (!resolved) {
      setTooltip(self, STRINGS.notCreated)
      self.setAttribute('aria-label', STRINGS.notCreated)
      inner.createDiv({ cls: 'tree-item-inner-text', text: l.path })
    } else {
      self.setAttribute('draggable', 'true')
      if (l.subpath) {
        inner.createDiv({ cls: 'tree-item-inner-text', text: l.subpath })
        inner.createDiv({ cls: 'tree-item-inner-subtext', text: l.file === this.file ? '' : l.file.basename })
      } else inner.createDiv({ cls: 'tree-item-inner-text', text: l.file.basename })
      self.addEventListener('dragstart', e => {
        e.dataTransfer?.setData('text/plain', `[[${l.linktext}]]`)
        const dm = (this.app as any).dragManager
        if (dm) dm.onDragStart(e, dm.dragLink(e, l.linktext, this.file?.path ?? '', undefined, 'outgoing-link'))
      })
      self.addEventListener('mouseover', e => app.workspace.trigger('hover-link', { event: e, source: VIEW_TYPE_OUTGOING_LINK, hoverParent: this, targetEl: self, linktext: l.linktext, sourcePath: this.file.path }))
    }
    self.addEventListener('click', e => void app.workspace.openLinkText(l.linktext, this.file.path, Keymap.isModEvent(e)))
    self.addEventListener('auxclick', e => e.button === 1 && (e.preventDefault(), void app.workspace.openLinkText(l.linktext, this.file.path, true)))
    self.addEventListener('contextmenu', e => {
      e.preventDefault()
      const m = new Menu()
      if (resolved) app.workspace.trigger('file-menu', m, l.file, 'link-context-menu', this.leaf)
      m.showAtMouseEvent(e)
    })
  }

  /** Mentions, in this note, of other notes' names that are not links yet. */
  private renderUnlinked(content: string): void {
    const app: any = this.app
    const mc = app.metadataCache
    const box = this.unlinked.containerEl
    box.empty()
    const ex = excludedRanges(mc.getFileCache(this.file))
    type M = { range: [number, number]; target: any; text: string }
    const all: M[] = []
    for (const f of app.vault.getMarkdownFiles()) {
      if (f === this.file || mc.isUserIgnored?.(f.path)) continue
      for (const m of findMentions(content, [f.basename, ...aliasesOf(mc.getFileCache(f))], ex)) all.push({ range: m.range, target: f, text: content.slice(m.range[0], m.range[1]) })
    }
    all.sort((a, b) => a.range[0] - b.range[0])
    this.unlinked.setCount(all.length)
    const children = box.createDiv('search-results-children')
    children.style.minHeight = '0px'
    if (!all.length) return void box.createDiv({ cls: 'search-empty-state', text: STRINGS.noUnlinked })
    const res = children.createDiv('search-result tree-item')
    const matches = res.createDiv('search-result-file-matches')
    matches.createDiv({ attr: { style: SIZER } })
    for (const m of all) {
      const line = content.lastIndexOf('\n', m.range[0] - 1) + 1
      let end = content.indexOf('\n', m.range[1])
      if (end < 0) end = content.length
      const el = matches.createDiv('search-result-file-match tappable')
      el.createSpan({ text: content.slice(line, m.range[0]) })
      el.createSpan({ cls: 'search-result-file-matched-text', text: m.text })
      el.createSpan({ text: content.slice(m.range[1], end) })
      for (const [cls, label] of [['mod-top', STRINGS.moreContext], ['mod-bottom', STRINGS.moreContext]]) {
        const b = el.createDiv({ cls: cls + ' search-result-hover-button', attr: { 'aria-label': label } })
        b.hide()
      }
      const chip = el.createDiv('search-result-file-match-destination-file-container').createDiv({ cls: 'search-result-file-match-destination-file', attr: { 'aria-label': STRINGS.linkThisFile } })
      setIcon(chip.createSpan('search-result-file-match-destination-file-icon'), 'lucide-link')
      chip.createSpan({ cls: 'search-result-file-match-destination-file-name', text: m.target.basename })
      chip.addEventListener('click', e => {
        e.stopPropagation()
        void this.linkMention(m.range, m.text, m.target)
      })
    }
  }

  async linkMention(range: [number, number], text: string, target: any): Promise<void> {
    const app: any = this.app
    const link = text === target.basename ? app.fileManager.generateMarkdownLink(target, this.file.path) : app.fileManager.generateMarkdownLink(target, this.file.path, undefined, text)
    await app.vault.process(this.file, (d: string) => (d.slice(range[0], range[1]) === text ? d.slice(0, range[0]) + link + d.slice(range[1]) : d))
  }
}
