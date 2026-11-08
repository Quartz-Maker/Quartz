/* eslint-disable @typescript-eslint/no-explicit-any */
// File card (`FileNode`) and its `EmptyEmbed` placeholder for missing files.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import type { CanvasNodeData } from './json'
import { isModEvent } from './dom'
import { S } from './strings'
import { CanvasTextChild } from './textCard'
import { CanvasFileSuggestModal, CanvasNarrowModal } from './modals'
import { loadEmbed, splitLinktext } from '../../markdown/embeds'
import { nodeClasses } from './CanvasNodeBase'
import { EmbedNode } from './CanvasContentNodes'

/** File card: an embedded note / image / media / pdf / canvas, optionally narrowed by `subpath`. */
export class FileNode extends EmbedNode {
  filePath = ''
  subpath = ''
  file: any = null

  initFile(): void {
    const { filePath, file, app } = this
    if (filePath && file?.path !== filePath) {
      this.file = null
      const f = app.vault.getAbstractFileByPath(filePath)
      if (f && 'extension' in f) this.file = f
    }
  }
  getData(): CanvasNodeData {
    return { ...super.getData(), type: 'file', file: this.file ? this.file.path : this.filePath, subpath: this.subpath || undefined } as CanvasNodeData
  }
  setData(data: any): void {
    super.setData(data)
    if (data.file) this.setFilePath(data.file, data.subpath || '')
  }
  setFilePath(path: string, subpath: string): void {
    if (this.filePath === path && this.subpath === subpath) return
    this.filePath = path
    if (!(this.file && this.file.path === path && this.subpath === subpath)) {
      this.subpath = subpath
      this.initFile()
      this.unloadChild()
    }
    this.canvas.markDirty(this)
  }
  setFile(file: any, subpath?: string, force?: boolean): void {
    subpath = subpath || ''
    const subChanged = this.subpath !== subpath
    if (!force && this.filePath === file.path && !subChanged) return
    this.subpath = subpath
    this.filePath = file.path
    if (this.file !== file || subChanged) {
      this.file = file
      this.unloadChild()
    }
    this.canvas.markDirty(this)
  }
  blur(): void {
    super.blur()
    this.canvas.requestUpdateFileOpen(null)
  }
  focus(): void {
    super.focus()
    if (this.child) this.onFileFocus()
  }
  onFileFocus(): void {
    const ws = this.app.workspace
    if (ws) ws.activeEditor = this.child instanceof CanvasTextChild ? this.child : null
    this.canvas.requestUpdateFileOpen(this.file)
  }
  updateBreakpoint(visible: boolean): void {
    if (visible) this.mountContent()
    else if (this.child && this.child.isMedia) this.mountContent()
    else this.unmountContent()
  }
  render(): void {
    super.render()
    const { file, filePath, subpath } = this
    const open = (e: MouseEvent) => {
      if (isModEvent(e)) this.canvas.openLinkText(this.filePath + this.subpath, '', true)
    }
    const openHere = () => this.canvas.openLinkText(this.filePath + this.subpath, '', false)
    if (file) {
      let name = shortName(file)
      if (subpath && file.extension === 'md') name += ' › ' + subpath.substring(1)
      this.updateNodeLabel(name, open, openHere)
      this.placeholderEl.setText(name)
    } else {
      const frag = createFragment(f => {
        setIcon(f.createSpan(), 'lucide-alert-triangle')
        f.createSpan({ text: filePath })
      })
      this.updateNodeLabel(frag, open, openHere)
      this.placeholderEl.setText(filePath)
    }
    if (this.child) return
    const ctx = { app: this.app, linktext: this.filePath + this.subpath, sourcePath: this.canvas.view.file?.path ?? '', containerEl: this.contentEl, depth: 0 }
    let child: any
    if (file && file.extension === 'md') {
      child = this.child = new CanvasTextChild(this, file, subpath)
    } else if (file) {
      child = this.child = loadEmbed(ctx as any)
      child.isMedia = /^(bmp|png|jpe?g|gif|svg|webp|avif|mp3|wav|m4a|3gp|flac|ogg|oga|opus|mp4|webm|ogv|mov|mkv|canvas)$/i.test(file.extension)
    } else child = this.child = new EmptyEmbed(this, ctx.linktext, ctx.sourcePath)
    if (this.isFocused) this.onFileFocus()
    child.load()
    void (async () => {
      await child.loadFile()
      if (this.child !== child) return
      const first = this.contentEl.firstChild as any
      if (!first) return
      let size: { width: number; height: number } | null = null
      if (first instanceof HTMLImageElement) {
        size = { width: first.naturalWidth, height: first.naturalHeight }
        first.draggable = false
      } else if (first instanceof HTMLVideoElement) size = { width: first.videoWidth, height: first.videoHeight }
      else if (first instanceof HTMLAudioElement) {
        const fit = () => this.resize({ width: this.width, height: first.clientHeight || 42 })
        fit()
      }
      if (size && size.height !== 0) {
        const ratio = (this.aspectRatio = size.width / size.height)
        const { width: w, height: h } = this
        if (w / h !== ratio) {
          this.resize({ width: Math.min(w, h * ratio), height: Math.min(h, w / ratio) })
          this.canvas.overrideHistory()
        }
      }
    })()
  }
  onPointerdown(e: PointerEvent): void {
    const t = e.target as HTMLElement | null
    if (t && t.parentElement?.hasClass('textLayer')) return
    super.onPointerdown(e)
  }
  showMenu(menu: Menu): void {
    super.showMenu(menu)
    const { file, canvas } = this
    if (!canvas.readonly)
      menu.addItem(i =>
        i
          .setSection('canvas')
          .setTitle(S.actionSwapFile)
          .setIcon(file ? 'lucide-arrow-left-right' : 'lucide-repeat')
          .onClick(() => {
            const notes = !file || file.extension === 'md' || file.extension === 'canvas'
            const media = !file || file.extension !== 'md'
            new CanvasFileSuggestModal(canvas, f => {
              this.setFile(f, '')
              canvas.requestSave()
            })
              .showMarkdownAndCanvas(notes)
              .showAttachments(media)
              .open()
          })
      )
    if (!file) return
    if (file.extension === 'md')
      menu.addItem(i =>
        i
          .setSection('open')
          .setTitle(S.openInNewTab)
          .setIcon('lucide-file-plus')
          .onClick(() => canvas.openFile(file, 'tab'))
      )
    if (!canvas.readonly && this.child instanceof CanvasTextChild)
      menu.addItem(i => i.setSection('canvas').setTitle(S.edit).setIcon('lucide-edit').onClick(() => this.startEditing()))
    if (!canvas.readonly && file.extension === 'md') {
      menu.addItem(i =>
        i
          .setSection('canvas')
          .setIcon('lucide-minimize-2')
          .setTitle(S.actionNarrowHeading)
          .onClick(() =>
            new CanvasNarrowModal(this.app, file, 'heading', (sub: string) => {
              this.setFilePath(file.path, sub)
              canvas.requestSave()
            }).open()
          )
      )
      menu.addItem(i =>
        i
          .setSection('canvas')
          .setIcon('lucide-minimize-2')
          .setTitle(S.actionNarrowBlock)
          .onClick(() =>
            new CanvasNarrowModal(this.app, file, 'block', (sub: string) => {
              this.setFilePath(file.path, sub)
              canvas.requestSave()
            }).open()
          )
      )
    }
    if (!this.subpath) {
      menu.addItem(i =>
        i
          .setSection('action')
          .setTitle(S.rename)
          .setIcon('lucide-edit-3')
          .onClick(() => this.app.fileManager.promptForFileRename?.(file))
      )
      this.app.workspace?.trigger?.('file-menu', menu, file, 'canvas-menu')
    }
  }
}

function shortName(file: any): string {
  return file.extension === 'md' ? file.basename : file.name
}

/** "“x” could not be found." with New note / Swap file / Remove actions. */
class EmptyEmbed {
  containerEl: HTMLElement
  private offs: (() => void)[] = []
  constructor(public node: FileNode, public linktext: string, public sourcePath: string) {
    this.containerEl = node.contentEl
  }
  load(): void {
    const vault = this.node.app.vault
    const retry = (f: any) => {
      const { path, subpath } = splitLinktext(this.linktext)
      if (f && 'extension' in f && f.path === path) this.node.setFile(f, subpath, true)
    }
    const r1 = vault.on('create', retry)
    const r2 = vault.on('rename', retry)
    this.offs.push(() => vault.offref(r1), () => vault.offref(r2))
  }
  unload(): void {
    for (const off of this.offs) off()
    this.offs = []
  }
  async loadFile(): Promise<void> {
    const { node, linktext, sourcePath } = this
    const canvas = node.canvas
    const app = node.app
    node.contentBlockerEl.detach()
    const path = splitLinktext(linktext).path
    this.containerEl.createDiv('canvas-empty-embed-container', box => {
      box.createDiv({ cls: 'canvas-empty-embed-label', text: S.labelEmptyEmbed(linktext) })
      box.createDiv('empty-state-action-list', list => {
        const ext = path.includes('.') ? path.substring(path.lastIndexOf('.') + 1).toLowerCase() : ''
        const pill = (icon: string, text: string, cls: string[], cb: () => void) => {
          const b = list.createEl('button', { cls: ['mod-pill', 'empty-state-action', ...cls] })
          setIcon(b.createSpan('button-icon'), icon)
          b.appendText(text)
          b.addEventListener('click', cb)
        }
        if (ext === 'md' || ext === '') pill('lucide-square-pen', S.newNote, [], () => void app.fileManager.createNewMarkdownFileFromLinktext(linktext, sourcePath))
        pill('lucide-repeat', S.actionSwapFile, [], () =>
          new CanvasFileSuggestModal(canvas, f => {
            node.setFile(f, '')
            canvas.requestSave()
          }).open()
        )
        pill('lucide-trash-2', S.actionRemove, ['mod-destructive', 'mod-warning'], () => {
          canvas.removeNode(node)
          canvas.requestSave()
        })
      })
    })
    this.containerEl.addClass('mod-canvas-empty')
  }
}

nodeClasses.FileNode = FileNode
