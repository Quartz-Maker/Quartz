/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas dialogs: help, file/media/image pickers, URL prompt, file name prompt, narrow to heading/block,
// jump to group.
import { Modal } from '../../ui/Modal'
import { FuzzySuggestModal, SuggestModal, type FuzzyMatch } from '../../ui/suggest'
import { renderResults, prepareQuery, fuzzySearch, sortSearchResults } from '../../search/fuzzy'
import { Keymap } from '../../keymap/Keymap'
import { Platform } from '../../keymap/Platform'
import { S } from './strings'
import type { Canvas } from './Canvas'

/** Modals need `app.keymap`; fall back to the global keymap. */
export function withKeymap(app: any): any {
  if (app && app.keymap) return app
  const o = Object.create(app || {})
  o.keymap = Keymap.init()
  return o
}

const KEY_NAMES: Record<string, string> = Platform.isMacOS
  ? { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '^', Space: 'Space' }
  : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Ctrl: 'Ctrl', Space: 'Space' }
function keyCombo(keys: string[]): string {
  return keys.map(k => KEY_NAMES[k] ?? k).join(Platform.isMacOS ? ' ' : ' + ')
}

export class CanvasHelpModal extends Modal {
  constructor(canvas: Canvas) {
    super(withKeymap(canvas.app))
    this.modalEl.addClass('mod-canvas-help')
    this.setTitle(S.labelCanvasHelp)
    const box = this.contentEl.createDiv('canvas-help')
    const row = (label: string, combos: string[][]) =>
      box.createDiv({ cls: 'canvas-instruction' }, r => {
        r.createDiv({ cls: 'canvas-instruction-label', text: label })
        r.createDiv({ cls: 'canvas-instruction-desc' }, d => {
          for (const c of combos) d.createSpan({ cls: 'setting-hotkey', text: keyCombo(c) })
        })
      })
    let pan = [['Scroll']]
    let panH = [['Shift', 'Scroll']]
    let zoom = [
      ['Mod', 'Scroll'],
      ['Space', 'Scroll']
    ]
    if (canvas.options.defaultWheelBehavior === 'zoom') {
      ;[pan, zoom] = [zoom, pan]
      panH = [
        ['Mod', 'Shift', 'Scroll'],
        ['Shift', 'Space', 'Scroll']
      ]
    }
    row(S.labelPan, [['Space', 'Drag'], ...pan])
    row(S.labelPanHorizontal, panH)
    row(S.labelZoom, zoom)
    row(S.actionZoomToFit, [['Shift', '1']])
    row(S.actionZoomToSelection, [['Shift', '2']])
    row(S.labelSelectAll, [['Mod', 'A']])
    row(S.labelAddRemoveSelection, [
      ['Shift', 'Click'],
      ['Shift', 'Drag to select']
    ])
    row(S.actionCreateWithSize, [['Mod', 'Drag to select']])
    row(S.labelCloneCard, [[Platform.isMacOS ? 'Alt' : 'Ctrl', 'Drag']])
    row(S.labelConstrainMovementAxis, [['Shift', 'Drag']])
    row(S.labelDisableDragSnapping, [[Platform.isMacOS ? 'Ctrl' : 'Alt']])
    row(S.labelRemoveCard, [['Backspace'], ['Delete']])
    row(S.undo, [['Mod', 'Z']])
    row(S.redo, [
      ['Mod', 'Y'],
      ['Mod', 'Shift', 'Z']
    ])
  }
}

const IMAGE_EXT = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
const MEDIA_EXT = [...IMAGE_EXT, 'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus', 'mp4', 'webm', 'ogv', 'mov', 'mkv', 'pdf']

interface FileRow {
  type: 'file'
  file: any
  match: any
}

/** Vault file picker (embed-context file suggest). */
export class CanvasFileSuggestModal extends SuggestModal<FileRow | null> {
  shouldShowMarkdown = true
  shouldShowImages = true
  shouldShowNonImageAttachments = true
  allowCreateNewFile = true
  constructor(
    public canvas: Canvas,
    public handleChoose: (file: any) => void,
    public handleClose?: () => void,
    opts: { markdown?: boolean; attachments?: boolean; create?: boolean; empty?: string } = {}
  ) {
    super(withKeymap(canvas.app))
    this.emptyStateText = opts.empty ?? S.noNoteCreateNew
    if (opts.markdown === false) this.shouldShowMarkdown = false
    if (opts.attachments === false) this.shouldShowImages = this.shouldShowNonImageAttachments = false
    if (opts.create === false) this.allowCreateNewFile = false
    this.setPlaceholder(S.promptStartSearch)
    const ins = [
      { command: '↑↓', purpose: S.navigate },
      { command: '↵', purpose: S.open }
    ]
    if (this.allowCreateNewFile) ins.push({ command: 'shift ↵', purpose: S.create })
    ins.push({ command: 'esc', purpose: S.dismiss })
    this.setInstructions(ins)
    if (this.allowCreateNewFile)
      this.scope.register(['Shift'], 'Enter', e => {
        this.selectSuggestion(null, e)
        return false
      })
  }
  showMarkdownAndCanvas(v: boolean): this {
    this.shouldShowMarkdown = v
    return this
  }
  showAttachments(v: boolean): this {
    this.shouldShowNonImageAttachments = v
    this.shouldShowImages = v
    return this
  }
  private accepts(f: any): boolean {
    const ext = f.extension
    if (ext === 'md' || ext === 'canvas' || ext === 'base') return this.shouldShowMarkdown
    if (IMAGE_EXT.includes(ext)) return this.shouldShowImages
    return this.shouldShowNonImageAttachments
  }
  getSuggestions(query: string): FileRow[] {
    const files = (this.canvas.app.vault.getFiles?.() ?? []).filter((f: any) => this.accepts(f) && f.path !== this.canvas.view.file?.path)
    const q = prepareQuery(query.trim())
    const out: FuzzyMatch<any>[] = []
    for (const f of files) {
      const m = query.trim() ? fuzzySearch(q, f.path) : { score: 0, matches: [] }
      if (m) out.push({ item: f, match: m })
    }
    if (query.trim()) sortSearchResults(out)
    else out.sort((a, b) => (b.item.stat?.mtime ?? 0) - (a.item.stat?.mtime ?? 0))
    return out.map(r => ({ type: 'file', file: r.item, match: r.match }))
  }
  renderSuggestion(row: FileRow | null, el: HTMLElement): void {
    if (!row) return
    renderResults(el, row.file.path, row.match)
  }
  async onChooseSuggestion(row: FileRow | null): Promise<void> {
    if (!row) {
      if (!this.allowCreateNewFile) return
      const app = this.canvas.app
      const f = await app.fileManager.createNewMarkdownFileFromLinktext(this.inputEl.value, this.canvas.view.file?.path ?? '')
      this.handleChoose(f)
      return
    }
    this.handleChoose(row.file)
  }
  onClose(): void {
    super.onClose()
    this.handleClose?.()
  }
}

export class CanvasMediaSuggestModal extends CanvasFileSuggestModal {
  constructor(canvas: Canvas, choose: (file: any) => void, close?: () => void) {
    super(canvas, choose, close, { markdown: false, create: false, empty: S.labelNoMedia })
  }
}

/** Image picker for group backgrounds. */
export class CanvasImageSuggestModal extends FuzzySuggestModal<any> {
  constructor(public app2: any, public handleChoose: (file: any) => void, public handleClose?: () => void) {
    super(withKeymap(app2))
    this.emptyStateText = S.labelNoImages
    this.setPlaceholder(S.promptStartSearch)
    this.setInstructions([
      { command: '↑↓', purpose: S.navigate },
      { command: '↵', purpose: S.select },
      { command: 'esc', purpose: S.dismiss }
    ])
  }
  getItems(): any[] {
    return (this.app2.vault.getFiles?.() ?? []).filter((f: any) => IMAGE_EXT.includes(f.extension))
  }
  getItemText(f: any): string {
    return f.path
  }
  onChooseItem(f: any): void {
    this.handleChoose(f)
  }
  onClose(): void {
    super.onClose()
    this.handleClose?.()
  }
}

/** Single-line text prompt (URL / file name). */
class PromptModal extends Modal {
  inputEl: HTMLInputElement
  errorEl: HTMLElement
  constructor(app: any, title: string, value: string, public onSubmit: (v: string) => void) {
    super(withKeymap(app))
    this.setTitle(title)
    this.inputEl = this.contentEl.createEl('input', { type: 'text', cls: 'prompt-input-field' })
    this.inputEl.value = value
    this.inputEl.style.width = '100%'
    this.errorEl = this.contentEl.createDiv('setting-item-error')
    this.errorEl.hide()
    this.inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        this.submit(this.inputEl.value)
      }
    })
    this.contentEl.createDiv('modal-button-container', b => {
      b.createEl('button', { cls: 'mod-cta', text: S.save }).addEventListener('click', () => this.submit(this.inputEl.value))
    })
  }
  validate(_v: string): string | undefined {
    return undefined
  }
  submit(v: string): void {
    const err = this.validate(v)
    if (err) {
      this.errorEl.setText(err)
      this.errorEl.show()
      return
    }
    this.close()
    this.onSubmit(v)
  }
  onOpen(): void {
    super.onOpen()
    this.inputEl.focus()
    this.inputEl.select()
  }
}

export class CanvasUrlModal extends PromptModal {
  constructor(app: any, url: string, onSave: (url: string) => void) {
    super(app, S.labelEnterUrl, url, onSave)
  }
  validate(v: string): string | undefined {
    try {
      new URL(v)
    } catch {
      return S.invalidUrl
    }
    return undefined
  }
}

/** File name prompt (Convert to file...). */
export class FilenameModal extends PromptModal {
  constructor(app: any, name: string, onSave: (name: string) => void) {
    super(app, S.actionConvertToFile.replace(/\.\.\.$/, ''), name, onSave)
  }
  validate(v: string): string | undefined {
    return v.trim() ? (/[\\/:*?"<>|]/.test(v) ? 'File name cannot contain any of the following characters: * " \\ / < > : | ?' : undefined) : 'File name cannot be empty.'
  }
}

/** "Narrow to heading" / "Narrow to block": choose a subpath of `file`. */
export class CanvasNarrowModal extends SuggestModal<{ label: string; subpath: string }> {
  constructor(public app2: any, public file: any, public mode: 'heading' | 'block', public cb: (subpath: string) => void) {
    super(withKeymap(app2))
    this.emptyStateText = S.labelNoSectionFound
    this.setPlaceholder(S.promptToNarrow)
    this.setInstructions([
      { command: '↑↓', purpose: S.navigate },
      { command: '↵', purpose: mode === 'block' ? S.instructionNarrowBlock : S.instructionNarrowHeading },
      { command: 'esc', purpose: S.dismiss }
    ])
  }
  getSuggestions(query: string): { label: string; subpath: string }[] {
    const cache = this.app2.metadataCache.getFileCache(this.file)
    const q = query.trim().toLowerCase()
    let items: { label: string; subpath: string }[]
    if (this.mode === 'heading') items = (cache?.headings ?? []).map((h: any) => ({ label: h.heading, subpath: '#' + h.heading }))
    else items = Object.keys(cache?.blocks ?? {}).map(id => ({ label: '^' + id, subpath: '#^' + id }))
    items = items.filter(i => !q || i.label.toLowerCase().includes(q.replace(/^#/, '')))
    if (!q) items.unshift({ label: S.labelNoNarrow, subpath: '' })
    return items
  }
  renderSuggestion(v: { label: string }, el: HTMLElement): void {
    el.setText(v.label)
  }
  onChooseSuggestion(v: { subpath: string }): void {
    this.cb(v.subpath)
  }
}

export class JumpToGroupModal extends FuzzySuggestModal<any> {
  constructor(public canvas: Canvas, public cb: (group: any) => void) {
    super(withKeymap(canvas.app))
    this.emptyStateText = S.msgNoGroupsFound
    this.setInstructions([
      { command: '↑↓', purpose: S.navigate },
      { command: '↵', purpose: S.instructionJumpToGroup },
      { command: 'esc', purpose: S.dismiss }
    ])
    this.setPlaceholder(S.actionJumpToGroup)
    this.scope.register(null, 'Tab', () => false)
  }
  getItems(): any[] {
    return this.canvas.getData().nodes.filter((n: any) => n.type === 'group')
  }
  getItemText(n: any): string {
    return n.label || S.labelUntitledGroup
  }
  onChooseItem(n: any): void {
    this.cb(n)
  }
}
