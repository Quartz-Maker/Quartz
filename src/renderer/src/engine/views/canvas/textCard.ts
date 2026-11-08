/* eslint-disable @typescript-eslint/no-explicit-any */
// Editable markdown content of text cards and markdown file cards (editable markdown embed):
//   div.canvas-node-content.markdown-embed[.is-loaded]
//     div.markdown-embed-content.node-insert-event        reading renderer (preview mode)
//       div.markdown-preview-view.markdown-rendered.node-insert-event.show-indentation-guide.allow-fold-headings.allow-fold-lists[.show-properties]
//     div.markdown-embed-content.node-insert-event        editor (shown while editing; display:none otherwise)
//     [div.markdown-embed-link]                           file cards only (hidden by CSS in canvas)
// Text cards save into the node's `text`; file cards read/write the note. The editor is the shared
// CM6 setup (hypermd tokenizer + Live Preview).
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Component } from '../../core/Component'
import { setIcon } from '../../ui/icons'
import { MarkdownRenderer } from '../../markdown/MarkdownRenderer'
import { markdownEditorSetup, editorFor, DEFAULT_EDITOR_CONFIG, type EditorConfig } from '../../editor/editorExtensions'
import { createSourceViewContainer, installSourceViewShell } from '../../editor/editorShell'
import { resolveSubpath } from '../../markdown/embeds'
import type { Point } from './geometry'

class CardPreview extends MarkdownRenderer {
  constructor(public owner: CanvasTextChild, containerEl: HTMLElement) {
    super(owner.app, containerEl)
    this.renderer.previewEl.addClass('node-insert-event')
    this.updateClasses()
  }
  get file(): any {
    return this.owner.file
  }
  updateClasses(): void {
    const cfg = (k: string, d: any) => {
      const v = this.owner.app?.vault?.getConfig?.(k)
      return v === undefined || v === null ? d : v
    }
    const el = this.renderer.previewEl
    el.toggleClass('show-indentation-guide', !!cfg('showIndentGuide', true))
    el.toggleClass('allow-fold-headings', !!cfg('foldHeading', true))
    el.toggleClass('allow-fold-lists', !!cfg('foldIndent', true))
    el.toggleClass('rtl', !!cfg('rightToLeft', false))
  }
  edit(text: string): void {
    this.renderer.set(text)
    this.owner.save(text, true)
  }
}

/** The node API the child needs (text and file cards). */
interface HostNode {
  app: any
  id: string
  canvas: any
  contentEl: HTMLElement
  text?: string
  setIsEditing(v: boolean): void
}

export class CanvasTextChild extends Component {
  app: any
  node: HostNode
  /** Markdown file shown by a file card (null for text cards). */
  noteFile: any
  containerEl: HTMLElement
  previewEl: HTMLElement
  editorEl: HTMLElement
  previewMode: CardPreview
  editMode: { cm: EditorView } | null = null
  text = ''
  scope: any = null
  editable = true
  inlineTitleEl: HTMLElement | null = null
  private settingText = false
  private saveTimer = 0
  private offModify: (() => void) | null = null

  /** `#Heading` / `#^block` of a narrowed file card. */
  subpath = ''

  constructor(node: HostNode, noteFile: any = null, subpath = '') {
    super()
    this.node = node
    this.app = node.app
    this.noteFile = noteFile
    this.subpath = subpath
    this.containerEl = node.contentEl
    this.containerEl.addClass('markdown-embed')
    this.previewEl = this.containerEl.createDiv('markdown-embed-content node-insert-event')
    this.editorEl = this.containerEl.createDiv('markdown-embed-content node-insert-event')
    this.editorEl.style.display = 'none'
    this.previewMode = new CardPreview(this, this.previewEl)
    if (noteFile) {
      this.containerEl.addClass('is-loaded')
      const r = this.previewMode.renderer
      r.previewEl.addClass('show-properties')
      if (!subpath) {
        r.addHeader()
        this.inlineTitleEl = createDiv({ cls: 'inline-title', text: noteFile.basename, attr: { contenteditable: 'true', spellcheck: 'true', autocapitalize: 'on', tabindex: '-1', enterkeyhint: 'done' } })
        r.header!.el.appendChild(this.inlineTitleEl)
      }
      this.containerEl.createDiv('markdown-embed-link', l => {
        setIcon(l, 'lucide-maximize-2')
        l.setAttr('aria-label', 'Open link')
        l.addEventListener('click', e => {
          if (e.button !== 0 && e.button !== 1) return
          e.preventDefault()
          this.node.canvas.openLinkText(noteFile.path, '', e.ctrlKey || e.metaKey)
        })
      })
    }
  }

  get linktext(): string {
    return this.noteFile ? this.noteFile.path : (this.node.canvas.view.file?.path ?? '') + '#^' + this.node.id
  }
  get editor(): any {
    return this.editMode ? editorFor(this.editMode.cm) : null
  }
  /** Source path for links: the note for file cards, the canvas for text cards. */
  get file(): any {
    return this.noteFile ?? this.node.canvas.view.file
  }

  onload(): void {
    this.addChild(this.previewMode)
    const f = this.noteFile
    if (f) {
      const vault = this.app.vault
      const ref = vault.on?.('modify', (m: any) => {
        if (m !== f || this.editMode) return
        void vault.cachedRead(f).then((t: string) => this.set(this.section(t)))
      })
      this.offModify = () => vault.offref?.(ref)
    }
  }
  onunload(): void {
    this.flushSave()
    this.offModify?.()
    this.destroyEditor()
    this.applyScope(null)
  }

  /** File cards: load the note text. */
  async loadFile(): Promise<void> {
    if (!this.noteFile) return
    this.set(this.section(await this.app.vault.cachedRead(this.noteFile)))
  }

  /** The part of the note shown by the card (whole note without subpath). */
  private section(full: string): string {
    if (!this.subpath) return full
    const r = resolveSubpath(full, this.subpath)
    return r ? full.substring(r.start, r.end) : ''
  }
  /** Write the edited section back into the note. */
  private async writeBack(text: string): Promise<void> {
    const vault = this.app.vault
    const f = this.noteFile
    if (!this.subpath) return vault.modify(f, text)
    await vault.process(f, (full: string) => {
      const r = resolveSubpath(full, this.subpath)
      return r ? full.substring(0, r.start) + text + full.substring(r.end) : full
    })
  }

  getMode(): 'preview' | 'source' {
    return this.editMode ? 'source' : 'preview'
  }

  set(text: string): void {
    this.text = text
    this.previewMode.renderer.set(text)
    const cm = this.editMode?.cm
    if (cm && cm.state.doc.toString() !== text) {
      this.settingText = true
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text } })
      this.settingText = false
    }
  }

  /**
   * Editor edits are kept in `text` and committed after 2 s of inactivity (or when the editor closes);
   * `final` commits now: text cards update the node and save the canvas, file cards write the note.
   */
  save(text: string, final = false): void {
    this.text = text
    if (!final) {
      clearTimeout(this.saveTimer)
      this.saveTimer = window.setTimeout(() => this.flushSave(), 2000)
      return
    }
    clearTimeout(this.saveTimer)
    this.saveTimer = 0
    if (this.noteFile) {
      void this.writeBack(text)
      return
    }
    const node = this.node
    if (node.text !== text) {
      node.text = text
      node.canvas.requestSave()
    }
  }
  private flushSave(): void {
    if (!this.saveTimer) return
    this.save(this.text, true)
  }

  applyScope(scope: any): void {
    if (scope === this.scope) return
    const km = this.app?.keymap
    if (this.scope) km?.popScope?.(this.scope)
    if (scope) km?.pushScope?.(scope)
    this.scope = scope
  }

  private editorConfig(): EditorConfig {
    const c: any = { ...DEFAULT_EDITOR_CONFIG }
    const vault = this.app?.vault
    for (const k of Object.keys(c)) {
      const v = vault?.getConfig?.(k)
      if (v !== undefined && v !== null) c[k] = v
    }
    c.showLineNumber = false
    return c
  }

  /** Switch to the editor; `at` (client coords) places the cursor where the user clicked. */
  showEditor(at?: Point): void {
    if (!this.editMode) {
      const app = this.app
      const setup = markdownEditorSetup(this.editorConfig(), 'live', {
        host: {
          app,
          getPath: () => this.file?.path ?? '',
          isUnresolved: (linkpath: string, source: string) => (app?.metadataCache ? app.metadataCache.isUnresolved(linkpath, source) : false),
          openLinkText: (linktext: string, source: string, newLeaf: boolean | string) => this.node.canvas.openLinkText(linktext, source, newLeaf),
          openExternal: (url: string) => window.open(url, '_blank'),
          openTag: (tag: string) => app?.internalPlugins?.getEnabledPluginById?.('global-search')?.openGlobalSearch?.('tag:' + tag)
        },
        editor: (v: EditorView) => editorFor(v),
        pluginExtensions: () => (app?.workspace?.editorExtensions || []).slice()
      })
      const state = EditorState.create({
        doc: this.text,
        extensions: [
          setup.extensions,
          EditorView.updateListener.of(u => {
            if (u.docChanged && !this.settingText) this.save(u.state.doc.toString())
          })
        ]
      })
      const shell = createSourceViewContainer(this.editorEl)
      shell.addClass('is-live-preview')
      const cm = new EditorView({ state, parent: shell })
      installSourceViewShell(cm, shell)
      this.editMode = { cm }
    }
    this.previewEl.style.display = 'none'
    this.editorEl.style.display = ''
    const cm = this.editMode.cm
    let pos: number | null = null
    if (at) {
      try {
        pos = cm.posAtCoords(at)
      } catch {
        pos = null
      }
    }
    cm.dispatch({ selection: { anchor: pos ?? cm.state.doc.length } })
    cm.focus()
    const ws = this.app?.workspace
    if (ws) ws.activeEditor = this
  }

  destroyEditor(): void {
    if (!this.editMode) return
    this.editMode.cm.destroy()
    this.editMode = null
    this.editorEl.empty()
  }

  /** Back to reading mode (re-renders the latest text). */
  showPreview(force = false): void {
    if (!this.editMode && !force) return
    const text = this.editMode ? this.editMode.cm.state.doc.toString() : this.text
    this.destroyEditor()
    this.editorEl.style.display = 'none'
    this.previewEl.style.display = ''
    this.text = text
    this.previewMode.renderer.set(text)
    this.flushSave()
  }
}
