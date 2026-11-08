// Graph data engine + settings panel.
// Owns the controls (Filters / Groups / Display / Forces), compiles search queries, builds the data and
// pushes it into the renderer; persists options through host.onOptionsChange (graph.json or leaf state).
import { debounce } from '../../vault/debounce'
import { Keymap } from '../../keymap/Keymap'
import { setIcon, setTooltip } from '../../workspace/dom'
import { getAllTags } from '../../metadata/helpers'
import {
  computeGraph,
  makeGraphFilter,
  fileVerdict,
  type CompiledQuery,
  type GraphColor,
  type GraphSource
} from './data'
import {
  DEFAULT_DATA_OPTIONS,
  DEFAULT_DISPLAY_OPTIONS,
  DEFAULT_FORCE_OPTIONS,
  forceTransforms,
  newGroupColor,
  type GraphDataOptions,
  type GraphOptions,
  type ColorGroup
} from './options'
import { compileGraphQuery, type GraphSearchQuery } from './search'
import { S } from './strings'
import { CollapsibleSection, Setting, TextComponent, ColorComponent, type SearchComponent } from './ui'
import type { GraphRenderer } from './renderer'

/** What the engine needs from its view (ItemView in the workspace, or a lightweight host). */
export interface GraphViewHost {
  app: any
  leaf?: any
  containerEl: HTMLElement
  isLocal: boolean
  registerEvent(ref: any): void
  registerDomEvent(el: any, type: string, cb: (e: any) => any): void
  registerInterval(id: number): number
  onOptionsChange(): void
}

type Listeners = Record<string, (v?: any) => any>

/** Graph options section: collapsible tree item whose collapse state is the `collapse-<id>` option. */
class ControlSection extends CollapsibleSection {
  optionListeners: Listeners = {}
  constructor(
    public engine: GraphEngine,
    id: string,
    title: string
  ) {
    super()
    this.el.addClass('graph-control-section', 'mod-' + id)
    this.setCollapsible(true)
    void this.setCollapsed(true, false)
    this.innerEl.createEl('header', { cls: 'graph-control-section-header', text: title })
    this.optionListeners['collapse-' + id] = (v?: any) => {
      if (v !== undefined && isBoolean(v)) void this.setCollapsed(v, false)
      return this.collapsed
    }
  }
  async updateCollapsed(animate: boolean): Promise<void> {
    await super.updateCollapsed(animate)
    this.engine?.onOptionsChange()
  }
  setOptions(o: GraphOptions): void {
    for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k) && Object.prototype.hasOwnProperty.call(this.optionListeners, k)) this.optionListeners[k](o[k])
  }
  getOptions(o: GraphOptions): void {
    for (const k in this.optionListeners) {
      const v = this.optionListeners[k]()
      if (v !== undefined) o[k] = v
    }
  }
}

class FilterSection extends ControlSection {
  searchSetting: Setting
  search!: SearchComponent
  constructor(engine: GraphEngine, local: boolean) {
    super(engine, 'filter', S.labelFilters)
    engine.controlsEl.appendChild(this.el)
    const el = this.childrenEl
    this.searchSetting = new Setting(el).addSearch(s =>
      s
        .setPlaceholder(S.promptFilterNodes)
        .setValue('')
        .onChange(() => this.engine.requestUpdateSearch())
        .then(c => {
          this.search = c
          setTooltip(c.clearButtonEl, S.clearSearch)
          this.optionListeners.search = (v?: any) => {
            if (v !== undefined) {
              c.setValue(v)
              this.engine.requestUpdateSearch()
            }
            return c.getValue()
          }
          c.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!e.isComposing && e.key === 'Enter') this.engine.updateSearch()
          })
          engine.attachSearchSuggest?.(c.inputEl)
        })
    )
    this.searchSetting.settingEl.addClass('mod-search-setting')
    const o = engine.options
    const toggle = (name: string, tip: string, key: keyof GraphDataOptions) =>
      new Setting(el)
        .setName(name)
        .setTooltip(tip)
        .setClass('mod-toggle')
        .addToggle(t =>
          t
            .setValue(o[key] as boolean)
            .registerOptionListener(this.optionListeners, key)
            .onChange(v => {
              ;(engine.options as any)[key] = v
              engine.render()
              engine.onOptionsChange()
            })
        )
    if (local) {
      new Setting(el)
        .setName(S.optionDepth)
        .setTooltip(S.optionDepthDescription)
        .setClass('mod-local-jumps')
        .setClass('mod-slider')
        .addSlider(s =>
          s
            .setLimits(1, 5, 1)
            .setValue(o.localJumps)
            .setInstant(true)
            .registerOptionListener(this.optionListeners, 'localJumps')
            .onChange(v => {
              engine.options.localJumps = v
              engine.render()
              engine.onOptionsChange()
            })
        )
      toggle(S.optionBacklinks, S.optionBacklinksDescription, 'localBacklinks')
      toggle(S.optionForelinks, S.optionForelinksDescription, 'localForelinks')
      toggle(S.optionNeighborLinks, S.optionNeighborLinksDescription, 'localInterlinks')
    }
    toggle(S.optionShowTags, S.optionShowTagsDescription, 'showTags')
    toggle(S.optionShowAttachments, S.optionShowAttachmentsDescription, 'showAttachments')
    toggle(S.optionShowExistingFilesOnly, S.optionShowExistingFilesOnlyDescription, 'hideUnresolved')
    if (!local) toggle(S.optionShowOrphans, S.optionShowOrphansDescription, 'showOrphans')
  }
  startSearch(): void {
    this.searchSetting.settingEl.addClass('is-loading')
  }
  stopSearch(): void {
    this.searchSetting.settingEl.removeClass('is-loading')
  }
  setDefaultOptions(): void {
    this.setOptions(DEFAULT_DATA_OPTIONS as any)
  }
}

interface GroupRow {
  el: HTMLElement
  query: TextComponent
  color: ColorComponent
}

class ColorGroupSection extends ControlSection {
  groups: GroupRow[] = []
  constructor(engine: GraphEngine) {
    super(engine, 'color-groups', S.labelGroups)
    engine.controlsEl.appendChild(this.el)
    this.optionListeners.colorGroups = (v?: any) => {
      if (Array.isArray(v)) {
        this.setColorQueries(v)
        this.engine.requestUpdateSearch()
      }
      return this.getColoredQueries()
    }
    this.setColorQueries([])
  }
  getColoredQueries(): ColorGroup[] {
    return this.groups.map(g => ({ query: g.query.getValue(), color: { a: 1, rgb: g.color.getValueInt() } }))
  }
  setColorQueries(list: ColorGroup[]): void {
    const el = this.childrenEl
    el.empty()
    const rows: GroupRow[] = []
    const container = el.createDiv({ cls: 'graph-color-groups-container' })
    const add = (g: { query: string; color?: { rgb: number } | null }) => {
      const rowEl = container.createDiv('graph-color-group')
      const query = new TextComponent(rowEl)
        .setPlaceholder(S.placeholderEnterQuery)
        .setValue(g.query)
        .onChange(() => this.engine.requestUpdateSearch())
        .then(c => this.engine.attachSearchSuggest?.(c.inputEl))
      const color = new ColorComponent(rowEl).setValueInt(g.color ? g.color.rgb : 0).onChange(() => this.engine.updateSearch())
      const picker = color.colorPickerEl
      setTooltip(picker, S.tooltipClickToChangeDragToReorder)
      const row: GroupRow = { el: rowEl, query, color }
      picker.addEventListener('mousedown', e => this.onDragOption(e, row))
      rowEl.createDiv('clickable-icon', b => {
        setIcon(b, 'lucide-x')
        setTooltip(b, S.tooltipDeleteGraph)
        b.addEventListener('click', () => {
          rows.remove(row)
          rowEl.detach()
          this.engine.updateSearch()
        })
      })
      rows.push(row)
    }
    for (const g of list) add(g)
    this.groups = rows
    el.createDiv('graph-color-button-container', c => {
      c.createEl('button', { text: S.buttonNewGroup }, b => {
        b.addEventListener('click', () => {
          add({ query: '', color: newGroupColor(this.groups.length, this.engine.isDarkMode()) })
          this.engine.updateSearch()
        })
      })
    })
  }
  onDragOption(e: MouseEvent, row: GroupRow): void {
    if (e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    const el = row.el
    const rect = el.getBoundingClientRect()
    const ox = e.clientX - rect.x, oy = e.clientY - rect.y
    let ghost: HTMLElement | null = null
    const move = (ev: MouseEvent) => {
      ev.preventDefault()
      const x = ev.clientX, y = ev.clientY
      if (ghost === null) {
        const dx = x - sx, dy = y - sy
        if (dx * dx + dy * dy < 25) return
        const w = el.offsetWidth
        this.groups.remove(row)
        ghost = el.cloneNode(true) as HTMLElement
        ghost.addClass('drag-ghost')
        ghost.style.width = w + 'px'
        el.doc.body.appendChild(ghost)
        document.body.addClass('is-grabbing')
        this.childrenEl.addClass('is-grabbing')
      }
      const idx = this.getDropIndex(ev)
      el.detach()
      ghost.style.left = x - ox + 'px'
      ghost.style.top = y - oy + 'px'
      for (let i = 0; i < this.groups.length; i++) {
        const g = this.groups[i]
        g.el.style.top = i < idx ? '0' : `${g.el.offsetHeight}px`
      }
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (ghost) {
        ghost.detach()
        document.body.removeClass('is-grabbing')
        this.childrenEl.removeClass('is-grabbing')
        const idx = this.getDropIndex(ev)
        this.groups.splice(idx, 0, row)
        this.setColorQueries(this.getColoredQueries())
        this.engine.updateSearch()
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  getDropIndex(e: MouseEvent): number {
    let i: number
    for (i = 0; i < this.groups.length; i++) {
      const r = this.groups[i].el.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) return i
    }
    return i
  }
}

class DisplaySection extends ControlSection {
  constructor(engine: GraphEngine) {
    super(engine, 'display', S.labelDisplay)
    engine.controlsEl.appendChild(this.el)
    const el = this.childrenEl
    new Setting(el)
      .setName(S.optionShowArrows)
      .setTooltip(S.optionShowArrowsDescription)
      .setClass('mod-toggle')
      .addToggle(t =>
        t.registerOptionListener(this.optionListeners, 'showArrow').onChange(v => {
          engine.renderer.setRenderOptions({ showArrow: v })
          engine.onOptionsChange()
        })
      )
    const slider = (name: string, key: string, min: number, max: number, step: number | 'any') =>
      new Setting(el)
        .setName(name)
        .setClass('mod-slider')
        .addSlider(s =>
          s
            .setLimits(min, max, step)
            .setInstant(true)
            .registerOptionListener(this.optionListeners, key)
            .onChange(v => {
              engine.renderer.setRenderOptions({ [key]: v })
              engine.onOptionsChange()
            })
        )
    slider(S.optionTextFade, 'textFadeMultiplier', -3, 3, 0.1)
    slider(S.optionNodeSize, 'nodeSizeMultiplier', 0.1, 5, 'any')
    slider(S.optionLinkThickness, 'lineSizeMultiplier', 0.1, 5, 'any')
    if (!engine.host.isLocal) new Setting(el).addButton(b => b.setButtonText(S.buttonAnimateTimelapse).onClick(() => engine.renderProgression()))
  }
  setDefaultOptions(): void {
    this.setOptions(DEFAULT_DISPLAY_OPTIONS)
  }
}

class ForceSection extends ControlSection {
  constructor(engine: GraphEngine) {
    super(engine, 'forces', S.labelForces)
    engine.controlsEl.appendChild(this.el)
    const el = this.childrenEl
    const slider = (name: string, key: keyof typeof forceTransforms, min: number, max: number, step: number | 'any') =>
      new Setting(el)
        .setName(name)
        .setClass('mod-slider')
        .addSlider(s =>
          s
            .setLimits(min, max, step)
            .setInstant(true)
            .registerOptionListener(this.optionListeners, key)
            .onChange(v => {
              engine.renderer.setForces({ [key]: forceTransforms[key](v) })
              engine.onOptionsChange()
            })
        )
    slider(S.optionCenterForce, 'centerStrength', 0, 1, 'any')
    slider(S.optionRepelForce, 'repelStrength', 0, 20, 'any')
    slider(S.optionLinkForce, 'linkStrength', 0, 1, 'any')
    slider(S.optionLinkDistance, 'linkDistance', 30, 500, 1)
  }
  setDefaultOptions(): void {
    this.setOptions(DEFAULT_FORCE_OPTIONS)
  }
}

/** MetadataCache → GraphSource adapter. */
export function metadataGraphSource(app: any): GraphSource {
  const mc = app.metadataCache
  return {
    get resolvedLinks() {
      return mc.resolvedLinks
    },
    get unresolvedLinks() {
      return mc.unresolvedLinks
    },
    getTags: () => mc.getTags(),
    getCachedFiles: () => mc.getCachedFiles(),
    isUserIgnored: p => (mc.isUserIgnored ? mc.isUserIgnored(p) : false),
    getFileTags: p => {
      const c = mc.getCache(p)
      return c ? getAllTags(c) : null
    },
    getFileTimes: p => {
      const f = app.vault.getAbstractFileByPath(p)
      return f && f.stat ? [f.stat.ctime, f.stat.mtime] : null
    }
  }
}

export class GraphEngine {
  app: any
  host: GraphViewHost
  renderer: GraphRenderer
  options: GraphDataOptions = Object.assign({}, DEFAULT_DATA_OPTIONS)
  searchQueries: CompiledQuery[] | null = null
  fileFilter: Record<string, boolean | GraphColor> = {}
  hasFilter = false
  searching = false
  private searchToken = 0
  progression = 0
  progressionSpeed = 20
  currentFocusFile = ''
  lastHoverLink: string | null = null
  hoverPopover: any = null
  controlsEl: HTMLElement
  filterOptions: FilterSection
  colorGroupOptions: ColorGroupSection
  displayOptions: DisplaySection
  forceOptions: ForceSection
  source: GraphSource
  onOptionsChange = debounce(() => this.host.onOptionsChange(), 100, true)
  requestUpdateSearch = debounce(() => this.updateSearch(), 250, true)
  /** Search suggestions on the filter inputs; wired by the search area. */
  attachSearchSuggest: ((input: HTMLInputElement) => void) | null = null
  /** Fallback for tag clicks when the global-search plugin isn't available. */
  onOpenSearch: ((query: string) => void) | null = null
  /** Fallback for opening files when there is no workspace (React shell). */
  onOpenFile: ((path: string, newLeaf: boolean | string) => void) | null = null

  constructor(app: any, host: GraphViewHost, renderer: GraphRenderer) {
    this.app = app
    this.host = host
    this.renderer = renderer
    this.source = metadataGraphSource(app)
    renderer.onNodeClick = this.onNodeClick.bind(this)
    renderer.onNodeRightClick = this.onNodeRightClick.bind(this)
    renderer.onNodeHover = this.onNodeHover.bind(this)
    renderer.onNodeUnhover = this.onNodeUnhover.bind(this)
    const c = (this.controlsEl = renderer.containerEl.createDiv('graph-controls'))
    c.dataset.ignoreSwipe = 'true'
    c.createDiv('clickable-icon graph-controls-button mod-close', b => {
      setIcon(b, 'lucide-x')
      setTooltip(b, S.close)
      b.addEventListener('click', () => {
        c.addClass('is-close')
        this.onOptionsChange()
      })
    })
    c.createDiv('clickable-icon graph-controls-button mod-open', b => {
      setIcon(b, 'lucide-settings')
      setTooltip(b, S.tooltipOpenGraphSettings)
      b.addEventListener('click', () => {
        c.removeClass('is-close')
        this.onOptionsChange()
      })
    })
    if (!host.isLocal)
      c.createDiv('clickable-icon graph-controls-button mod-animate', b => {
        setIcon(b, 'lucide-wand-2')
        setTooltip(b, S.tooltipStartTimelapseAnimation)
        b.addEventListener('click', () => void this.renderProgression())
      })
    c.createDiv({ cls: 'clickable-icon graph-controls-button mod-reset' }, b => {
      setIcon(b, 'lucide-rotate-ccw')
      setTooltip(b, S.restoreDefaults)
      b.addEventListener('click', () => {
        this.filterOptions.setDefaultOptions()
        this.colorGroupOptions.setColorQueries([])
        this.displayOptions.setDefaultOptions()
        this.forceOptions.setDefaultOptions()
      })
    })
    this.filterOptions = new FilterSection(this, host.isLocal)
    this.colorGroupOptions = new ColorGroupSection(this)
    this.displayOptions = new DisplaySection(this)
    this.forceOptions = new ForceSection(this)
    this.filterOptions.setDefaultOptions()
    this.colorGroupOptions.setColorQueries([])
    this.displayOptions.setDefaultOptions()
    this.forceOptions.setDefaultOptions()
  }

  isDarkMode(): boolean {
    const css = this.app.customCss
    if (css && typeof css.isDarkMode === 'function') return css.isDarkMode()
    return document.body.hasClass('theme-dark') || !document.body.hasClass('theme-light')
  }

  load(): void {
    const { app, host } = this
    const ws = app.workspace
    host.registerEvent(app.vault.on('create', this.onFileChanged, this))
    host.registerEvent(app.vault.on('modify', this.onFileChanged, this))
    host.registerEvent(app.vault.on('rename', this.recomputeFile, this))
    host.registerEvent(app.metadataCache.on('resolve', this.recomputeFile, this))
    if (ws) {
      host.registerEvent(ws.on('css-change', this.onCssChange, this))
      host.registerEvent(ws.on('file-open', this.onFileOpen, this))
    }
    let lastScale = 0
    host.registerInterval(
      window.setInterval(() => {
        if (this.renderer.targetScale !== lastScale) {
          lastScale = this.renderer.targetScale
          this.onOptionsChange()
        }
      }, 2000)
    )
    const keys: Record<number, string> = { 38: 'up', 40: 'down', 37: 'left', 39: 'right', 187: 'zoomin', 189: 'zoomout' }
    const onKey = (e: KeyboardEvent) => {
      const r = this.renderer
      r.keyboardActions.shift = Keymap.isModifier(e, 'Shift')
      const down = e.type === 'keydown'
      if (down) {
        const doc = host.containerEl.doc || document
        if (e.repeat || e.defaultPrevented || (ws && host.leaf && ws.activeLeaf !== host.leaf) || doc.activeElement !== doc.body) return
      }
      const which = (e as any).which ?? e.keyCode
      if (Object.prototype.hasOwnProperty.call(keys, which)) {
        r.keyboardActions[keys[which]] = down
        r.changed()
      }
    }
    host.registerDomEvent(window, 'keydown', onKey)
    host.registerDomEvent(window, 'keyup', onKey)
  }

  onCssChange(): void {
    this.renderer.testCSS()
  }

  updateSearch(): void {
    let list: { query: string; color: GraphColor | null }[] = []
    const q = this.filterOptions.search.getValue()
    if (q) list.push({ query: q, color: null })
    list = list.concat(this.colorGroupOptions.getColoredQueries())
    this.setQuery(list)
    this.onOptionsChange()
  }

  setQuery(list: { query: string; color: GraphColor | null }[]): void {
    const token = ++this.searchToken
    if (this.searching) {
      this.searching = false
      this.filterOptions.stopSearch()
    }
    this.hasFilter = false
    const compiled: (CompiledQuery & { query: GraphSearchQuery })[] = []
    const required: Record<string, boolean> = {}
    for (const item of list) {
      const q = compileGraphQuery(this.app, item.query)
      if (!q.matcher) continue
      compiled.push({ query: q, color: item.color })
      if (q.requiredInputs) Object.assign(required, q.requiredInputs)
      if (!item.color) this.hasFilter = true
    }
    this.searchQueries = compiled.length ? compiled : null
    if (!this.searchQueries) {
      this.fileFilter = {}
      this.render()
      return
    }
    const filter: Record<string, boolean | GraphColor> = (this.fileFilter = {})
    const files: any[] = this.app.vault.getFiles()
    this.searching = true
    this.filterOptions.startSearch()
    let last = performance.now()
    let dirty = true
    const run = async () => {
      for (let i = 0; i < files.length; i++) {
        if (token !== this.searchToken) return
        const file = files[i]
        filter[file.path] = await this.matchFile(file, compiled, required)
        dirty = true
        const now = performance.now()
        if (now >= last + 333) {
          last = now
          if (dirty) this.render()
          dirty = false
        }
        if (i % 50 === 49) await new Promise(r => setTimeout(r, 0))
      }
      if (token !== this.searchToken) return
      this.searching = false
      this.render()
      this.filterOptions.stopSearch()
    }
    void run()
  }

  private async matchFile(file: any, compiled: CompiledQuery[], required: Record<string, boolean>): Promise<boolean | GraphColor> {
    const inputs: { content?: string; tags?: string[] } = {}
    if (required.content && file.extension === 'md') {
      try {
        inputs.content = await this.app.vault.cachedRead(file)
      } catch {
        inputs.content = ''
      }
    }
    if (required.tags) {
      const c = this.app.metadataCache.getFileCache?.(file)
      inputs.tags = (c && getAllTags(c)) || []
    }
    return fileVerdict(compiled, q => !!(q.query as GraphSearchQuery).match(file, inputs))
  }

  /** Builds the data and hands it to the renderer; returns the number of events (timelapse). */
  render(): number | undefined {
    const isLocal = this.host.isLocal
    const o = this.options
    if (isLocal && !o.localFile) {
      this.renderer.setData({ nodes: {} })
      return
    }
    if (isLocal) this.progression = 0
    const filter = makeGraphFilter(this.searchQueries, this.fileFilter, this.hasFilter, o.localFile)
    const { data, numLinks } = computeGraph(this.source, o, filter, this.progression, this.currentFocusFile)
    this.renderer.setData(data)
    return numLinks
  }

  async renderProgression(): Promise<void> {
    this.progression = 1
    const total = this.render() || 0
    this.progressionSpeed = Math.clamp(0.5 * Math.sqrt(total), 5, 100)
    const start = Date.now()
    while (this.progression > 0) {
      const cur = this.progression
      await new Promise(r => setTimeout(r, 0))
      if (cur !== this.progression) return
      const next = 1 + Math.floor((this.progressionSpeed * (Date.now() - start)) / 1000)
      if (next === this.progression) continue
      this.progression = next
      const n = this.render()
      if (n === undefined || next > n) {
        this.progression = 0
        this.render()
        return
      }
    }
  }

  onFileChanged(file: any): void {
    if (file.extension !== 'md') this.recomputeFile(file)
  }

  /** A file changed: re-evaluate it against the active queries (re-queues it). */
  recomputeFile(file: any): void {
    const qs = this.searchQueries
    if (!qs || !file || !file.path || file.extension === undefined) return
    const required: Record<string, boolean> = {}
    for (const q of qs) Object.assign(required, (q.query as GraphSearchQuery).requiredInputs || {})
    void this.matchFile(file, qs, required).then(v => {
      if (this.searchQueries !== qs) return
      this.fileFilter[file.path] = v
      this.render()
    })
  }

  onFileOpen(file: any): void {
    const p = file ? file.path : ''
    if (p !== this.currentFocusFile) {
      this.currentFocusFile = p
      this.render()
    }
  }

  openSearch(query: string): void {
    const gs = this.app.internalPlugins?.getEnabledPluginById?.('global-search')
    if (gs) gs.openGlobalSearch(query)
    else this.onOpenSearch?.(query)
  }

  onNodeClick(evt: any, id: string, type: string): void {
    if (type === 'tag') return this.openSearch('tag:' + id)
    const mod = Keymap.isModEvent(evt)
    if (this.app.workspace) void this.app.workspace.openLinkText(id, '', mod)
    else this.onOpenFile?.(id, mod)
  }

  onNodeRightClick(evt: any, id: string, type: string): void {
    if (type === 'tag') return this.openSearch('tag:' + id)
    const file = this.app.metadataCache.getFirstLinkpathDest(id, '')
    if (!file || !(evt instanceof MouseEvent) || !this.app.workspace) return
    const Menu = graphMenuFactory
    if (!Menu) return
    const menu = new Menu().addSections(['title', 'open', 'action', 'info', 'info.copy', 'view', 'view.linked', 'system', '', 'danger'])
    menu.setSectionSubmenu?.('view.linked', { title: S.openLinkedView, icon: 'lucide-link' })
    menu.addItem((i: any) => {
      i.setSection('title').setTitle(file.basename ?? file.name).setIsLabel?.(true)
      i.titleEl?.addClass('u-muted', 'u-small')
    })
    menu.addItem((i: any) =>
      i
        .setSection('open')
        .setTitle(S.openInNewTab)
        .setIcon('lucide-file-plus')
        .onClick((e: any) => this.app.workspace.getLeaf(Keymap.isModEvent(e) || true).openLinkText(id, ''))
    )
    this.app.workspace.trigger('file-menu', menu, file, 'graph-context-menu', this.host.leaf)
    menu.addItem((i: any) =>
      i
        .setSection('danger')
        .setTitle(S.deleteFile)
        .setIcon('lucide-trash-2')
        .setWarning?.(true)
        .onClick(() => this.app.fileManager?.promptForDeletion?.(file))
    )
    menu.showAtMouseEvent(evt)
  }

  onNodeHover(evt: any, id: string, type: string): void {
    this.onNodeUnhover()
    if (!(evt instanceof MouseEvent)) return
    if (type !== '' && type !== 'focused' && type !== 'attachment') return
    const pop = this.hoverPopover
    if (pop && pop.state !== 'hidden' && pop.state !== 0 && this.lastHoverLink === id) {
      pop.onTarget = true
      pop.transition?.()
      return
    }
    this.lastHoverLink = id
    this.app.workspace?.trigger('hover-link', { event: evt, source: 'graph', hoverParent: this, targetEl: null, linktext: id })
  }

  onNodeUnhover(): void {
    const pop = this.hoverPopover
    if (pop) {
      pop.onTarget = false
      pop.transition?.()
    }
  }

  getOptions(): GraphOptions {
    const o: GraphOptions = {}
    this.filterOptions.getOptions(o)
    this.colorGroupOptions.getOptions(o)
    this.displayOptions.getOptions(o)
    this.forceOptions.getOptions(o)
    o.scale = this.renderer.targetScale
    o.close = this.controlsEl.hasClass('is-close')
    return o
  }

  setOptions(o: GraphOptions | null | undefined): void {
    if (!o) return
    this.filterOptions.setOptions(o)
    this.colorGroupOptions.setOptions(o)
    this.displayOptions.setOptions(o)
    this.forceOptions.setOptions(o)
    if (o.scale) this.renderer.zoomTo(o.scale)
    if (o.close) this.controlsEl.toggleClass('is-close', o.close)
    this.render()
  }
}

/** Menu class used for the node context menu (plugin API `Menu`); set by the view layer. */
export let graphMenuFactory: any = null
export function setGraphMenuClass(M: any): void {
  graphMenuFactory = M
}
