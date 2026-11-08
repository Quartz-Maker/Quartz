/* eslint-disable @typescript-eslint/no-explicit-any */
// "Delete file attachments?" — shown after deleting a note when "Delete attachments when deleting files" is "Ask"
// and the note was the only one linking some attachments (reference: the file-browser confirmation modal).
//   .modal.mod-scrollable-content.mod-file-browser
//     p.file-browser-description
//     .modal-view-options-toolbar > .clickable-icon.modal-view-option (File tree | Gallery)
//     .file-browser-views > .file-tree (tree-item rows with input.file-tree-item-checkbox) + .attachments-gallery
//   Cancel | Delete (destructive)
import { ConfirmationModal } from './Modal'
import { setIcon } from './icons'
import { setTooltip } from './tooltip'
import { t } from '../settings/i18n'
import type { TFile } from '../vault/TAbstractFile'

const IMAGE = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
const VIDEO = ['mp4', 'webm', 'ogv', 'mov', 'mkv']

interface Node {
  path: string
  name: string
  file?: TFile
  children: Node[]
  parent?: Node
  selfEl?: HTMLElement
  checkboxEl?: HTMLInputElement
}

export class OrphanAttachmentsModal extends ConfirmationModal {
  private files: TFile[]
  private checked = new Set<string>()
  private treeEl!: HTMLElement
  private galleryEl!: HTMLElement
  private treeButtonEl!: HTMLElement
  private galleryButtonEl!: HTMLElement
  private nodes = new Map<string, Node>()
  private galleryBoxes = new Map<string, { item: HTMLElement; box: HTMLInputElement }>()
  private galleryBuilt = false
  private resolve: ((ok: boolean) => void) | null = null
  private accepted = false

  constructor(app: any, files: TFile[]) {
    super(app)
    this.files = files
    for (const f of files) this.checked.add(f.path)
    this.modalEl.addClass('mod-scrollable-content', 'mod-file-browser')
    this.setTitle(t('dialogue.orphanAttachmentsTitle'))
    this.contentEl.createEl('p', { cls: 'file-browser-description', text: t('dialogue.orphanAttachmentsDesc', { count: files.length }) })
    const bar = this.contentEl.createDiv('modal-view-options-toolbar')
    this.treeButtonEl = bar.createDiv('clickable-icon modal-view-option')
    setIcon(this.treeButtonEl, 'lucide-list')
    setTooltip(this.treeButtonEl, t('dialogue.tooltipFileTree'))
    this.treeButtonEl.addEventListener('click', () => this.setViewMode('tree'))
    this.galleryButtonEl = bar.createDiv('clickable-icon modal-view-option')
    setIcon(this.galleryButtonEl, 'lucide-image')
    setTooltip(this.galleryButtonEl, t('dialogue.tooltipGallery'))
    this.galleryButtonEl.addEventListener('click', () => this.setViewMode('gallery'))
    const views = this.contentEl.createDiv('file-browser-views')
    this.treeEl = views.createDiv('file-tree')
    this.galleryEl = views.createDiv('attachments-gallery')
    this.renderTree()
    this.renderGallery()
    this.addCancelButton(t('dialogue.buttonCancel'))
    this.addButton(b =>
      b
        .setButtonText(t('dialogue.buttonDelete'))
        .setCta()
        .setDestructive()
        .onClick(() => {
          this.accepted = true
        })
    )
    this.setViewMode('tree')
  }

  /** Opens the modal; resolves true when the user pressed Delete. */
  prompt(): Promise<boolean> {
    return new Promise(resolve => {
      this.resolve = resolve
      this.open()
    })
  }

  onClose(): void {
    super.onClose()
    this.resolve?.(this.accepted)
    this.resolve = null
  }

  getCheckedFiles(): TFile[] {
    return this.files.filter(f => this.checked.has(f.path))
  }

  setViewMode(mode: 'tree' | 'gallery'): void {
    this.treeButtonEl.toggleClass('is-active', mode === 'tree')
    this.galleryButtonEl.toggleClass('is-active', mode === 'gallery')
    this.treeEl.toggle(mode === 'tree')
    this.galleryEl.toggle(mode === 'gallery')
    if (mode === 'gallery') this.renderGallery()
  }

  // ---- tree ----------------------------------------------------------------------------------------------------

  private renderTree(): void {
    const root: Node = { path: '', name: '', children: [] }
    const folderOf = (path: string): Node => {
      if (!path) return root
      let n = this.nodes.get(path + '/')
      if (!n) {
        const i = path.lastIndexOf('/')
        const parent = folderOf(i < 0 ? '' : path.slice(0, i))
        n = { path, name: path.slice(i + 1), children: [], parent }
        this.nodes.set(path + '/', n)
        parent.children.push(n)
      }
      return n
    }
    for (const f of this.files) {
      const parent = folderOf(f.parent && f.parent.path !== '/' ? f.parent.path : '')
      const n: Node = { path: f.path, name: f.name, file: f, children: [], parent }
      this.nodes.set(f.path, n)
      parent.children.push(n)
    }
    for (const n of root.children) this.renderNode(this.treeEl, n)
    this.syncTree()
  }

  private renderNode(parentEl: HTMLElement, n: Node): void {
    const item = parentEl.createDiv('tree-item')
    const self = (n.selfEl = item.createDiv('tree-item-self is-clickable ' + (n.file ? 'mod-file' : 'mod-collapsible mod-folder')))
    let childrenEl: HTMLElement | null = null
    if (!n.file) {
      const toggle = self.createDiv('tree-item-icon collapse-icon')
      setIcon(toggle, 'right-triangle')
      toggle.addEventListener('click', e => {
        e.stopPropagation()
        const collapsed = !item.hasClass('is-collapsed')
        item.toggleClass('is-collapsed', collapsed)
        toggle.toggleClass('is-collapsed', collapsed)
        childrenEl?.toggle(!collapsed)
      })
    }
    const inner = self.createDiv('tree-item-inner file-tree-item')
    const box = (n.checkboxEl = inner.createEl('input', { cls: 'file-tree-item-checkbox', type: 'checkbox' }))
    setIcon(inner.createDiv('file-tree-item-icon'), n.file ? 'lucide-file' : 'lucide-folder')
    inner.createDiv({ cls: 'file-tree-item-title', text: n.name })
    const flip = (): void => this.setChecked(n, !this.isChecked(n))
    box.addEventListener('click', e => {
      e.stopPropagation()
      e.preventDefault()
      flip()
    })
    self.addEventListener('click', flip)
    if (!n.file) {
      childrenEl = item.createDiv('tree-item-children')
      for (const c of n.children) this.renderNode(childrenEl, c)
    }
  }

  private leaves(n: Node): TFile[] {
    return n.file ? [n.file] : n.children.flatMap(c => this.leaves(c))
  }

  private isChecked(n: Node): boolean {
    return this.leaves(n).every(f => this.checked.has(f.path))
  }

  private setChecked(n: Node, on: boolean): void {
    for (const f of this.leaves(n)) {
      if (on) this.checked.add(f.path)
      else this.checked.delete(f.path)
    }
    this.syncTree()
    this.syncGallery()
  }

  private syncTree(): void {
    for (const n of this.nodes.values()) {
      const files = this.leaves(n)
      const on = files.filter(f => this.checked.has(f.path)).length
      const all = on === files.length
      if (n.checkboxEl) {
        n.checkboxEl.checked = all
        n.checkboxEl.indeterminate = on > 0 && !all
      }
      n.selfEl?.toggleClass('is-selected', all)
    }
  }

  // ---- gallery -------------------------------------------------------------------------------------------------

  private renderGallery(): void {
    if (this.galleryBuilt) return this.syncGallery()
    this.galleryBuilt = true
    const vault = (this.app as any).vault
    for (const f of this.files) {
      const item = this.galleryEl.createDiv({ cls: 'download-attachment-item', attr: { 'aria-label': f.name } })
      const box = item.createEl('input', { type: 'checkbox' })
      const ext = f.extension.toLowerCase()
      const kind = IMAGE.includes(ext) ? 'image-embed' : VIDEO.includes(ext) ? 'video-embed' : 'file-embed'
      const embed = item.createDiv('download-attachment-embed media-embed ' + kind + ' is-loaded')
      const src = vault.getResourcePath(f)
      if (kind === 'image-embed') embed.createEl('img', { attr: { src } })
      else if (kind === 'video-embed') embed.createEl('video', { attr: { src } })
      else embed.createDiv({ cls: 'file-embed-title', text: f.name })
      const flip = (): void => this.setChecked(this.nodes.get(f.path)!, !this.checked.has(f.path))
      box.addEventListener('click', e => {
        e.stopPropagation()
        e.preventDefault()
        flip()
      })
      item.addEventListener('click', flip)
      this.galleryBoxes.set(f.path, { item, box })
    }
    this.syncGallery()
  }

  private syncGallery(): void {
    for (const [path, { item, box }] of this.galleryBoxes) {
      const on = this.checked.has(path)
      box.checked = on
      item.toggleClass('is-selected', on)
    }
  }
}
