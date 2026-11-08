/* eslint-disable @typescript-eslint/no-explicit-any */
// MarkdownView (type "markdown", plugin API `MarkdownView extends TextFileView`).
// One long-lived CM6 EditorView per leaf (source / Live Preview, switched through a Compartment)
// plus a MarkdownPreviewView (reading) in the same `.view-content`:
//
//   .workspace-leaf-content[data-type=markdown] > .view-header + .view-content
//     .view-content > .markdown-source-view.cm-s-obsidian.mod-cm6[.is-live-preview]… > .cm-editor > .cm-scroller > .cm-sizer
//                       > .inline-title + .metadata-container + .cm-contentContainer + .embedded-backlinks
//                   + .markdown-reading-view (hidden unless mode = preview)
//
// Leaf state `{file, mode: "source"|"preview", source: boolean}` as stored in workspace.json.
import { EditorState, Facet, type Compartment, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { foldEffect, unfoldEffect } from '@codemirror/language'
import { DocumentSearch } from '../../ui/DocumentSearch'
import { Backlinks } from '../backlink/BacklinkView'
import { editorSearchBackend } from '../../editor/documentSearch'
import { previewSearchBackend } from '../../markdown/documentSearch'
import { TextFileView, renameFromTitle } from '../../view/FileView'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { setIcon, setTooltip } from '../../workspace/dom'
import type { Menu } from '../../workspace/Menu'
import type { Editor } from '../../editor/Editor'
import { markdownEditorSetup, reconfigureEditor, editorFor, DEFAULT_EDITOR_CONFIG, DYNAMIC_CONFIG_KEYS, type EditorConfig, type EditorHostOptions } from '../../editor/editorExtensions'
import { getFoldInfo, applyFoldInfo, foldStorage } from '../../editor/folding'
import { linkAt, setMathEngineLoader } from '../../editor/livepreview'
import { createMathJaxEngine } from '../../editor/livepreview/mathjaxEngine'
import { installSourceViewShell, setSourceViewState } from '../../editor/editorShell'
import { MarkdownPreviewView } from '../../markdown/MarkdownPreviewView'
import { Notice } from '../../ui/Notice'
import { Keymap } from '../../keymap/Keymap'
import { AttachmentManager } from '../../editor/attachments'
import { installEditorMenu } from '../../editor/editorMenu'
import { editorSuggestExtension } from '../../editor/suggest/editorSuggestExtension'
import '../../markdown/reading.css'
import { MetadataEditor, replaceFrontmatter } from '../properties/MetadataEditor'
import { getFrontMatterInfo } from '../../metadata/linkUpdate'
import { parse as parseYaml } from 'yaml'
import { canExportPdf, openPdfExport } from '../../pdf/exportPdf'
import { PDF } from '../../pdf/strings'

setMathEngineLoader(async () => createMathJaxEngine('lib/mathjax/woff2'))

export const VIEW_TYPE_MARKDOWN = 'markdown'

// ---------------------------------------------------------------------------- extension slots

/** Extra extensions for every markdown editor (Quartz additions such as link completion). */
let extraFactory: (view: MarkdownView) => Extension = view => [editorSuggestExtension(() => view)]
export function setCommonEditorExtensions(fn: (view: MarkdownView) => Extension): void {
  extraFactory = fn
}

/** Facet carrying the owning MarkdownView (`editorInfoField`). */
export const editorInfoField = Facet.define<MarkdownView | null, MarkdownView | null>({ combine: v => v[0] ?? null })
/** Plugins expect these state fields; we expose the owning view through the facet. */
export const editorViewField = editorInfoField

const SHELL_KEYS = ['readableLineLength', 'foldHeading', 'foldIndent', 'rightToLeft', 'propertiesInDocument', 'showInlineTitle', 'showIndentGuide', 'strictLineBreaks']

export const S = {
  editing: 'Current view: editing\nClick to read\nCtrl+Click to open to the right',
  reading: 'Current view: reading\nClick to edit\nCtrl+Click to open to the right',
  readingView: 'Reading view',
  sourceMode: 'Source mode',
  livePreview: 'Live Preview',
  find: 'Find...',
  replace: 'Replace...',
  rename: 'Rename...',
  copyPath: 'Copy path',
  deleteFile: 'Delete file',
  openDefault: 'Open in default app',
  showInExplorer: 'Show in system explorer',
  revealInNav: 'Reveal file in navigation'
}

export class MarkdownView extends TextFileView {
  editor: Editor
  cm: EditorView
  sourceContainerEl: HTMLElement
  previewMode: MarkdownPreviewView
  currentMode: { type: 'source' | 'preview' }
  inlineTitleEl: HTMLElement
  metadataContainerEl: HTMLElement
  metadataEditor: MetadataEditor
  private rawFrontmatter: string | null = null
  backlinksEl: HTMLElement
  /** Backlinks in document (per view; initial value from the backlink plugin option, may be undefined). */
  showBacklinks: boolean | undefined = undefined
  backlinks: Backlinks | null = null
  modeButtonEl: HTMLElement
  icon = 'lucide-file'
  /** `source: true` = Source mode, false = Live Preview (only meaningful when mode = "source"). */
  sourceMode: boolean
  /** HoverParent (page preview popovers opened from this view). */
  hoverPopover: any = null
  private compartment!: Compartment
  private hostOpts!: EditorHostOptions
  attachments = new AttachmentManager(() => ({ app: this.app, getPath: () => this.file?.path ?? '', editor: this.editor }))
  private foldTimer: any = 0
  private settingData = false
  private shell: ReturnType<typeof installSourceViewShell>

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const cfg = (k: string) => (this.app.vault as any).getConfig(k)
    this.sourceMode = cfg('livePreview') === false
    this.currentMode = { type: cfg('defaultViewMode') === 'preview' ? 'preview' : 'source' }

    // Inline title / properties / embedded backlinks, shared by both modes.
    this.inlineTitleEl = createDiv({ cls: 'inline-title', attr: { contenteditable: 'true', spellcheck: 'true', autocapitalize: 'on', tabindex: '-1', enterkeyhint: 'done' } })
    this.metadataEditor = new MetadataEditor(this.app, {
      getFile: () => this.file,
      saveFrontmatter: fm => this.saveFrontmatter(fm),
      focusAfterMetadata: () => this.setEphemeralState({ focus: true, cursor: { from: { line: 0, ch: 0 } } }),
      focusBeforeMetadata: () => {
        if (this.inlineTitleEl.isShown()) this.inlineTitleEl.focus()
      },
      getHoverSource: () => 'preview',
      onMarkdownFold: () => (this.app.workspace as any).requestSaveLayout?.(),
      undo: () => (this.editor as any).undo?.(),
      redo: () => (this.editor as any).redo?.()
    })
    this.addChild(this.metadataEditor)
    this.metadataContainerEl = this.metadataEditor.containerEl
    this.metadataContainerEl.style.display = 'none'
    this.backlinksEl = createDiv('embedded-backlinks')
    this.backlinksEl.style.display = 'none'
    this.setupInlineTitle()

    // Source / Live Preview editor.
    this.sourceContainerEl = this.contentEl.createDiv('markdown-source-view cm-s-obsidian mod-cm6')
    this.cm = new EditorView({ state: this.createState(''), parent: this.sourceContainerEl })
    this.shell = installSourceViewShell(this.cm, this.sourceContainerEl as HTMLDivElement)
    this.editor = editorFor(this.cm)
    installEditorMenu({ app: this.app, editor: this.editor as any, view: this })

    // Reading view.
    const self = this
    this.previewMode = new MarkdownPreviewView(this.app, this.contentEl, {
      get file() {
        return self.file as any
      },
      inlineTitleEl: this.inlineTitleEl,
      metadataContainerEl: this.metadataContainerEl,
      backlinksEl: this.backlinksEl,
      onEdit: (text: string) => {
        this.setViewData(text, false)
        this.requestSave()
      },
      notice: (msg: string) => new Notice(msg),
      onScroll: () => this.syncScroll()
    })
    this.cm.scrollDOM.addEventListener('scroll', () => this.syncScroll(), { passive: true })
    this.showBacklinks = (this.app.workspace as any).backlinkInDocument
    this.updateShowBacklinks()
    this.addChild(this.previewMode as any)

    this.modeButtonEl = this.addAction('lucide-book-open', S.editing, evt => {
      if (evt.ctrlKey || evt.metaKey) {
        void this.app.workspace.duplicateLeaf(this.leaf, 'vertical').then((l: any) => l.view?.setMode?.(this.getMode() === 'preview' ? 'source' : 'preview'))
        return
      }
      void this.setMode(this.getMode() === 'preview' ? 'source' : 'preview')
    })
    this.applyMode()
  }

  getViewType(): string {
    return VIEW_TYPE_MARKDOWN
  }

  canAcceptExtension(extension: string): boolean {
    return extension === 'md'
  }

  onload(): void {
    super.onload()
    const vault: any = this.app.vault
    this.registerEvent(vault.on('config-changed', (k: string) => this.onConfigChanged(k)))
    const ws: any = this.app.workspace
    this.registerEvent(ws.on('editor-extensions-change', () => this.reconfigurePlugins()))
    this.register(() => {
      this.editSearch?.destroy()
      this.previewSearch?.destroy()
    })
  }

  protected async onClose(): Promise<void> {
    await super.onClose()
    this.cm.destroy()
  }

  // ------------------------------------------------------------------------ CodeMirror

  private createState(doc: string): EditorState {
    return EditorState.create({ doc, extensions: this.buildExtensions() })
  }

  private editorConfig(): EditorConfig {
    const c: any = { ...DEFAULT_EDITOR_CONFIG }
    for (const k of Object.keys(c)) {
      const v = this.cfg(k)
      if (v !== undefined && v !== null) c[k] = v
    }
    return c
  }

  private buildExtensions(): Extension[] {
    const app: any = this.app
    if (!this.hostOpts) {
      this.hostOpts = {
        host: {
          app,
          getPath: () => this.file?.path ?? '',
          isUnresolved: (linkpath, source) => (app.metadataCache ? app.metadataCache.isUnresolved(linkpath, source) : false),
          openLinkText: (linktext, source, newLeaf) => void app.workspace.openLinkText(linktext, source, newLeaf),
          openExternal: url => window.open(url, '_blank'),
          openTag: tag => app.internalPlugins?.getEnabledPluginById('global-search')?.openGlobalSearch?.('tag:' + tag)
        },
        editor: v => editorFor(v),
        clipboard: { attachments: this.attachments, saveDataImage: url => void this.attachments.saveDataUrl(url) },
        pluginExtensions: () => (app.workspace?.editorExtensions || []).slice()
      }
    }
    const setup = markdownEditorSetup(this.editorConfig(), this.sourceMode ? 'source' : 'live', this.hostOpts, () => this.editorConfig())
    this.compartment = setup.compartment
    return [
      editorInfoField.of(this),
      setup.extensions,
      extraFactory(this),
      EditorView.updateListener.of(u => {
        if (u.docChanged && !this.settingData) {
          this.requestSave()
          const ws: any = this.app.workspace
          ws.trigger('editor-change', this.editor, this)
          if (this.file) ws.onQuickPreview?.(this.file, this.cm.state.doc.toString())
          this.updateFrontmatterPlaceholder(this.cm.state.doc.toString())
        }
        if (u.selectionSet || u.focusChanged) (this.app.workspace as any).trigger('editor-selection-change', this.editor, this)
        if (u.transactions.some(tr => tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)))) {
          clearTimeout(this.foldTimer)
          this.foldTimer = setTimeout(() => this.saveFolds(), 500)
        }
      }),
      EditorView.domEventHandlers({
        // Mod+click / middle click follows the link under the pointer in both modes.
        mousedown: (e, view) => {
          if (!(e.button === 1 || (e.button === 0 && Keymap.isModifier(e, 'Mod')))) return false
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos == null) return false
          const link = linkAt(view, pos)
          if (!link) return false
          e.preventDefault()
          if (link.external) window.open(link.target, '_blank')
          else void app.workspace.openLinkText(link.target, this.file?.path ?? '', Keymap.isModEvent(e) || 'tab')
          return true
        },
        mouseover: evt => {
          const t = (evt.target as HTMLElement | null)?.closest?.('.cm-hmd-internal-link') as HTMLElement | null
          if (!t) return false
          const linktext = (t.textContent || '').split('|')[0].trim()
          if (linktext)
            (this.app.workspace as any).trigger('hover-link', { event: evt, source: 'editor', hoverParent: this, targetEl: t, linktext, sourcePath: this.file?.path ?? '' })
          return false
        },
        focus: () => {
          const ws: any = this.app.workspace
          if (ws.activeLeaf !== this.leaf) ws.setActiveLeaf(this.leaf)
          return false
        }
      })
    ]
  }

  private cfg(k: string): any {
    return (this.app.vault as any).getConfig(k)
  }

  private saveFolds(): void {
    if (this.file && this.currentMode.type === 'source') foldStorage.save((this.app as any).appId ?? 'quartz', this.file.path, getFoldInfo(this.cm.state))
  }

  private restoreFolds(): void {
    if (this.file) applyFoldInfo(this.cm, foldStorage.load((this.app as any).appId ?? 'quartz', this.file.path))
  }

  /** Source ↔ Live Preview and dynamic config: compartment reconfigure (no remount). */
  reconfigureMode(): void {
    reconfigureEditor(this.cm, this.compartment, this.editorConfig(), this.sourceMode ? 'source' : 'live', this.hostOpts)
  }
  reconfigurePlugins(): void {
    this.reconfigureMode()
  }
  /** `workspace.updateOptions()`: re-read the editor options and plugin editor extensions. */
  updateOptions(): void {
    this.reconfigurePlugins()
  }

  onConfigChanged(key: string): void {
    if ((DYNAMIC_CONFIG_KEYS as string[]).includes(key)) this.reconfigureMode()
    if (SHELL_KEYS.includes(key)) {
      this.previewMode.onConfigChanged(key)
      if (key === 'propertiesInDocument') this.updateMetadataVisibility()
      this.updateShellClasses()
    }
  }

  private updateShellClasses(): void {
    setSourceViewState(this.sourceContainerEl, {
      livePreview: !this.sourceMode,
      readableLineWidth: this.cfg('readableLineLength') !== false,
      folding: this.cfg('foldHeading') !== false || this.cfg('foldIndent') !== false,
      showProperties: this.cfg('propertiesInDocument') !== 'hidden',
      rtl: !!this.cfg('rightToLeft')
    })
    this.inlineTitleEl.toggle(this.cfg('showInlineTitle') !== false)
  }

  // ------------------------------------------------------------------------ modes

  getMode(): 'source' | 'preview' {
    return this.currentMode.type
  }

  async setMode(mode: 'source' | 'preview' | 'live'): Promise<void> {
    const st = this.getState() as any
    if (mode === 'live') {
      st.mode = 'source'
      st.source = false
    } else st.mode = mode
    await this.leaf.setViewState({ type: VIEW_TYPE_MARKDOWN, state: st, popstate: true } as any, { focus: true })
  }

  private applyMode(): void {
    const preview = this.currentMode.type === 'preview'
    requestAnimationFrame(() => this.onResize())
    this.updateShellClasses()
    if (preview) {
      this.sourceContainerEl.style.display = 'none'
      this.previewMode.set(this.data, false)
      this.previewMode.show()
    } else {
      this.previewMode.hide()
      this.sourceContainerEl.style.display = ''
      // Header elements live in the editor's sizer while editing.
      const sizer = this.shell.sizerEl
      sizer.insertBefore(this.inlineTitleEl, this.shell.contentContainerEl)
      sizer.insertBefore(this.metadataContainerEl, this.shell.contentContainerEl)
      sizer.appendChild(this.backlinksEl)
    }
    this.updateMetadataVisibility()
    setIcon(this.modeButtonEl, preview ? 'lucide-edit-3' : 'lucide-book-open')
    setTooltip(this.modeButtonEl, preview ? S.reading : S.editing)
    this.modeButtonEl.setAttribute('aria-label', preview ? S.reading : S.editing)
    ;(this.app.workspace as any).trigger('quartz:mode-change', this)
  }

  getState(): Record<string, unknown> {
    const s = super.getState()
    s.mode = this.currentMode.type
    s.source = this.sourceMode
    if (this.showBacklinks !== undefined) s.backlinks = this.showBacklinks
    if (this.backlinks) s.backlinkOpts = this.backlinks.getState()
    return s
  }

  onResize(): void {
    if (this.currentMode.type === 'source') this.updateBottomPadding(this.sourceContainerEl.clientHeight)
  }

  /** Scroll past end: half the editor height; with backlinks in document, 100px + a min-height on the backlinks. */
  updateBottomPadding(h: number): void {
    if (!h) return
    let pad = Math.round(h / 2) + 'px'
    if (this.backlinksEl.style.display !== 'none') {
      pad = '100px'
      this.backlinksEl.style.minHeight = Math.max(0, h / 2 - 100) + 'px'
    }
    this.cm.contentDOM.style.paddingBottom = pad
  }

  /** `markdown-scroll` workspace event (reference `syncScroll`), from both modes. */
  syncScroll(): void {
    ;(this.app.workspace as any).trigger('markdown-scroll', this)
  }

  canToggleBacklinks(): boolean {
    return true
  }

  /** `backlink:toggle-backlinks-in-document`: flips the view state's `backlinks`. */
  async toggleBacklinks(): Promise<void> {
    const state: any = this.getState()
    state.backlinks = !state.backlinks
    await this.leaf.setViewState({ type: VIEW_TYPE_MARKDOWN, state } as any)
    this.app.workspace.requestSaveLayout()
  }

  updateShowBacklinks(): void {
    if (this.showBacklinks && !this.backlinks) {
      this.backlinksEl.style.display = ''
      this.backlinks = this.addChild(new Backlinks(this.app, this.backlinksEl))
      this.updateBacklinks()
    } else if (!this.showBacklinks && this.backlinks) {
      this.removeChild(this.backlinks)
      this.backlinksEl.empty()
      this.backlinksEl.style.display = 'none'
      this.backlinks = null
    }
    this.onResize()
  }

  updateBacklinks(): void {
    if (this.backlinks) this.backlinks.setFile(this.file)
  }

  async setState(state: any, result: any): Promise<void> {
    if (typeof state?.backlinks === 'boolean') {
      this.showBacklinks = state.backlinks
      this.updateShowBacklinks()
      if (state.backlinks && this.backlinks && state.backlinkOpts && typeof state.backlinkOpts === 'object') this.backlinks.setState(state.backlinkOpts)
    }
    let modeChanged = false
    if (state && (state.mode === 'source' || state.mode === 'preview') && state.mode !== this.currentMode.type) {
      // Sync editor ↔ reading text before switching.
      if (this.currentMode.type === 'source') this.data = this.cm.state.doc.toString()
      this.currentMode = { type: state.mode }
      modeChanged = true
    }
    if (state && typeof state.source === 'boolean' && state.source !== this.sourceMode) {
      this.sourceMode = state.source
      this.reconfigureMode()
      modeChanged = true
    }
    await super.setState(state, result)
    if (modeChanged) {
      this.applyMode()
      result.layout = true
    }
  }

  getEphemeralState(): Record<string, unknown> {
    const s: any = super.getEphemeralState()
    if (this.currentMode.type === 'source') {
      s.cursor = { from: this.editor.getCursor('from'), to: this.editor.getCursor('to') }
    } else s.scroll = this.previewMode.getScroll()
    return s
  }

  setEphemeralState(state: any): void {
    if (!state) return
    if (typeof state.subpath === 'string' && state.subpath && this.file && state.line === undefined) {
      // `#Heading` / `#^block` → line (resolved through the metadata cache).
      const cache = (this.app as any).metadataCache?.getFileCache(this.file)
      const sub = state.subpath.replace(/^#/, '')
      let line: number | undefined
      if (sub.startsWith('^')) line = cache?.blocks?.[sub.slice(1).toLowerCase()]?.position.start.line
      else {
        const parts = sub.split('#').filter(Boolean)
        const want = parts[parts.length - 1]?.trim().toLowerCase()
        line = cache?.headings?.find((h: any) => h.heading.trim().toLowerCase() === want)?.position.start.line
      }
      if (line !== undefined) state = { ...state, line }
    }
    if (this.currentMode.type === 'preview') {
      this.previewMode.setEphemeralState(state)
    } else {
      if (state.cursor) this.editor.setSelection(state.cursor.from, state.cursor.to)
      if (typeof state.line === 'number') {
        const line = Math.max(0, Math.min(this.editor.lastLine(), state.line))
        this.editor.setCursor({ line, ch: 0 })
        this.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true)
      }
      if (state.focus) this.editor.focus()
    }
    if (state.rename === 'all' || state.rename === 'end') {
      const el = this.inlineTitleEl
      el.focus()
      const sel = el.ownerDocument.getSelection()
      if (sel) {
        const r = el.ownerDocument.createRange()
        r.selectNodeContents(el)
        if (state.rename === 'end') r.collapse(false)
        sel.removeAllRanges()
        sel.addRange(r)
      }
    }
  }

  // ------------------------------------------------------------------------ data

  getViewData(): string {
    return this.currentMode.type === 'source' ? this.cm.state.doc.toString() : this.data
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data
    this.settingData = true
    try {
      if (clear) {
        this.cm.setState(this.createState(data))
        this.restoreFolds()
      }
      else if (this.cm.state.doc.toString() !== data) {
        // Keep the selection where possible (external modification).
        const sel = this.cm.state.selection.main
        this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: data }, selection: { anchor: Math.min(sel.anchor, data.length) } })
      }
    } finally {
      this.settingData = false
    }
    if (this.currentMode.type === 'preview') this.previewMode.set(data, clear)
    this.updateFrontmatterPlaceholder()
  }

  clear(): void {
    this.settingData = true
    try {
      this.cm.setState(this.createState(''))
    } finally {
      this.settingData = false
    }
    this.previewMode.clear()
  }

  async onUnloadFile(file: any): Promise<void> {
    // undefined = unknown: the next file always synchronizes the properties editor (a note without frontmatter
    // also has raw === null, which left the previous note's property count on the container).
    this.rawFrontmatter = undefined as any
    this.metadataEditor.clear()
    this.saveFolds()
    await super.onUnloadFile(file)
  }

  async onLoadFile(file: any): Promise<void> {
    this.inlineTitleEl.setText(file.basename)
    await super.onLoadFile(file)
    this.updateBacklinks()
    requestAnimationFrame(() => this.onResize())
  }

  async onRename(file: any): Promise<void> {
    await super.onRename(file)
    if (file === this.file) this.inlineTitleEl.setText(file.basename)
  }

  /** Parse the note's frontmatter and push it into the properties editor (only when it changed). */
  private updateFrontmatterPlaceholder(text: string = this.data): void {
    const info = getFrontMatterInfo(text)
    const raw = info.exists ? info.frontmatter : null
    if (raw !== this.rawFrontmatter) {
      this.rawFrontmatter = raw
      if (raw === null) this.metadataEditor.synchronize({})
      else {
        let fm: any = null
        try {
          fm = parseYaml(raw) ?? {}
          if (typeof fm !== 'object' || Array.isArray(fm)) throw new Error('Frontmatter must be a valid object!')
        } catch {
          fm = null
        }
        this.metadataEditor.synchronize(fm)
      }
    }
    this.updateMetadataVisibility()
  }
  private updateMetadataVisibility(): void {
    const show = (this.rawFrontmatter !== null || this.metadataEditor.properties.length > 0) && this.cfg('propertiesInDocument') === 'visible' && !(this.currentMode.type === 'source' && this.sourceMode)
    this.metadataContainerEl.style.display = show ? '' : 'none'
  }
  /** Properties editor -> document (MarkdownView.saveFrontmatter). */
  saveFrontmatter(fm: Record<string, any>): void {
    const text = replaceFrontmatter(this.getViewData(), fm)
    this.rawFrontmatter = getFrontMatterInfo(text).exists ? getFrontMatterInfo(text).frontmatter : null
    this.setViewData(text, false)
    this.requestSave()
    if (this.file) (this.app.workspace as any).onQuickPreview?.(this.file, text)
  }

  private editSearch: DocumentSearch | null = null
  private previewSearch: DocumentSearch | null = null

  /** Find (and replace, editor only) bar: first child of the source view or of the reading view. */
  showSearch(replace = false): void {
    if (this.currentMode.type === 'source') {
      if (!this.editSearch) this.editSearch = new DocumentSearch(this.sourceContainerEl, editorSearchBackend(this.cm), () => (this.editSearch = null))
      this.editSearch.show(replace)
    } else {
      const r = this.previewMode.renderer
      if (!this.previewSearch)
        this.previewSearch = new DocumentSearch(this.previewMode.containerEl, previewSearchBackend(r, () => r.previewEl.focus()), () => (this.previewSearch = null))
      this.previewSearch.show(false)
    }
  }

  private setupInlineTitle(): void {
    const el = this.inlineTitleEl
    const commit = async () => {
      const f: any = this.file
      if (!f) return
      const err = await renameFromTitle(this.app, f, (el.textContent || '').trim())
      if (err) new Notice(err)
      if (err || !(el.textContent || '').trim()) el.setText(f.basename)
    }
    el.addEventListener('keydown', evt => {
      if (evt.key === 'Enter') {
        evt.preventDefault()
        void commit().then(() => this.editor.focus())
      } else if (evt.key === 'Escape') {
        el.setText((this.file as any)?.basename ?? '')
        this.editor.focus()
      }
    })
    el.addEventListener('blur', () => void commit())
  }

  // ------------------------------------------------------------------------ menus

  printToPdf(): void {
    if (this.file) openPdfExport(this.app, this.file)
  }

  onPaneMenu(menu: Menu, source: string): void {
    const preview = this.currentMode.type === 'preview'
    menu.addItem(i =>
      i
        .setSection('pane')
        .setTitle(S.readingView)
        .setIcon('lucide-book-open')
        .setChecked(preview)
        .onClick(() => void this.setMode(preview ? 'source' : 'preview'))
    )
    if (!preview)
      menu.addItem(i =>
        i
          .setSection('pane')
          .setTitle(S.sourceMode)
          .setIcon('lucide-code-2')
          .setChecked(this.sourceMode)
          .onClick(() => void this.leaf.setViewState({ type: VIEW_TYPE_MARKDOWN, state: { ...this.getState(), source: !this.sourceMode } } as any))
      )
    super.onPaneMenu(menu, source)
    const f: any = this.file
    if (!f) return
    menu.addItem(i => i.setSection('action').setTitle(S.rename).setIcon('lucide-edit-3').onClick(() => this.setEphemeralState({ rename: 'all' })))
    menu.addItem(i =>
      i
        .setSection('find')
        .setTitle(S.find)
        .setIcon('lucide-file-search')
        .onClick(() => this.showSearch(false))
    )
    if (!preview)
      menu.addItem(i =>
        i
          .setSection('find')
          .setTitle(S.replace)
          .setIcon('lucide-file-search')
          .onClick(() => this.showSearch(true))
      )
    if (canExportPdf()) menu.addItem(i => i.setSection('action').setTitle(PDF.command).setIcon('lucide-file-down').onClick(() => this.printToPdf()))
    menu.addItem(i =>
      i
        .setSection('info')
        .setTitle(S.copyPath)
        .setIcon('lucide-clipboard')
        .onClick(() => void navigator.clipboard.writeText(f.path))
    )
    this.app.workspace.trigger('file-menu', menu, f, source === 'more-options' ? 'more-options' : 'tab-header', this.leaf)
    menu.addItem(i =>
      i
        .setSection('danger')
        .setTitle(S.deleteFile)
        .setIcon('lucide-trash-2')
        .setWarning(true)
        .onClick(() => {
          const fm: any = (this.app as any).fileManager
          void (fm.promptForDeletion ? fm.promptForDeletion(f) : fm.trashFile(f))
        })
    )
  }
}
