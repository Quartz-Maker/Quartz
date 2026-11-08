/* eslint-disable @typescript-eslint/no-explicit-any */
// Group card (`GroupNode`): label, background image, `imageSize` helper and `sameBBox`.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { isLightColor, isPresetColor, parseColor } from './color'
import { bboxEquals, type BBox } from './geometry'
import { omit, randomId, type CanvasNodeData } from './json'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { CanvasNode, nodeClasses } from './CanvasNodeBase'

/** Group: label above the box, optional background image (cover / ratio / repeat). */
export class GroupNode extends CanvasNode {
  label = ''
  bgPath = ''
  bgStyle = ''
  bgFile: any = null
  contentEl!: HTMLElement
  labelEl!: HTMLElement

  constructor(canvas: Canvas, id: string = randomId(16)) {
    super(canvas, id)
    this.nodeEl.addClass('canvas-node-group')
  }
  getData(): CanvasNodeData {
    const d: any = { ...super.getData(), type: 'group' }
    if (this.label) d.label = this.label
    if (this.bgPath) {
      d.background = this.bgFile ? this.bgFile.path : this.bgPath
      if (this.bgStyle && this.bgStyle !== 'cover') d.backgroundStyle = this.bgStyle
    }
    return d
  }
  setData(data: any): void {
    const rest = omit(data, ['label', 'background'])
    super.setData(rest)
    const { label, background } = data
    const style = data.backgroundStyle || ''
    if (label && typeof label === 'string') this.setLabel(label)
    if (background && typeof background === 'string') {
      if (this.bgPath !== background || (this.bgFile && this.bgFile.path !== background)) {
        this.bgPath = background
        const f = this.app.vault.getAbstractFileByPath(background)
        this.bgFile = f && 'extension' in f ? f : null
        this.canvas.markDirty(this)
      }
      if (this.bgStyle !== style) {
        this.bgStyle = style
        this.canvas.markDirty(this)
      }
    } else if (this.bgPath) {
      this.bgPath = ''
      this.bgFile = null
      this.bgStyle = ''
      this.canvas.markDirty(this)
    }
    void this.updateAspectRatio()
  }
  setLabel(label: string): void {
    if (this.label === label) return
    this.label = label
    this.canvas.markDirty(this)
  }
  setBackgroundFile(file: any): void {
    const p = file ? file.path : ''
    if (this.bgPath === p && this.bgFile === file) return
    this.bgPath = p
    this.bgFile = file
    if (!file) this.bgStyle = ''
    void this.updateAspectRatio()
    this.canvas.markDirty(this)
  }
  setBackgroundStyle(style: string): void {
    if (!this.bgPath) style = ''
    if (this.bgStyle === style) return
    this.bgStyle = style
    void this.updateAspectRatio()
    this.canvas.markDirty(this)
  }
  initialize(): void {
    super.initialize()
    this.contentEl = this.containerEl.createDiv('canvas-node-content')
    const el = (this.labelEl = this.nodeEl.createDiv('canvas-group-label'))
    el.setAttribute('spellcheck', 'false')
    el.addEventListener('pointerdown', this.onPointerdown.bind(this))
    el.addEventListener('dblclick', () => this.focusLabel())
    el.addEventListener('keypress', e => {
      if (!e.isComposing && e.key === 'Enter') {
        e.preventDefault()
        this.blurLabel()
      }
    })
    el.addEventListener('blur', () => this.blurLabel())
  }
  focusLabel(): void {
    const el = this.labelEl
    if (!el) return
    el.show()
    el.setAttr('contenteditable', true)
    el.focus()
    const sel = el.ownerDocument.getSelection()
    if (sel) {
      const range = el.ownerDocument.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  blur(): void {
    super.blur()
    this.blurLabel()
  }
  blurLabel(): void {
    const el = this.labelEl
    if (!el) return
    el.setAttr('contenteditable', false)
    el.blur()
    const text = el.getText()
    if (this.label !== text) {
      this.setLabel(text)
      this.canvas.requestSave()
    } else {
      el.toggle(!!text)
      el.setText(text)
    }
  }
  render(): void {
    super.render()
    const { labelEl, label, color } = this
    if (!labelEl.isActiveElement()) {
      labelEl.toggle(!!label)
      labelEl.setText(label)
    }
    let light = false
    let dark = false
    if (color) {
      const c = isPresetColor(color) ? parseColor(labelEl.getCssPropertyValue('--canvas-color-' + color)) : parseColor(color)
      if (c) {
        if (isLightColor(c)) dark = true
        else light = true
      }
    }
    labelEl.toggleClass('mod-foreground-light', light)
    labelEl.toggleClass('mod-foreground-dark', dark)
    const { bgFile, bgStyle, contentEl } = this
    if (bgFile) {
      const s: Record<string, string> = {
        backgroundImage: `url("${CSS.escape(this.app.vault.getResourcePath(bgFile))}")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center center',
        backgroundSize: 'cover'
      }
      if (bgStyle === 'repeat') {
        s.backgroundRepeat = 'repeat'
        s.backgroundPosition = 'top left'
        s.backgroundSize = 'auto'
      }
      contentEl.setCssStyles(s as any)
    } else contentEl.setCssStyles({ backgroundImage: '', backgroundRepeat: '', backgroundPosition: '', backgroundSize: '' } as any)
  }
  async updateAspectRatio(): Promise<void> {
    const file = this.bgFile
    if (this.bgStyle !== 'ratio' || !file) {
      this.aspectRatio = 0
      return
    }
    const { width: w, height: h } = this
    const size = await imageSize(this.app.vault.getResourcePath(file))
    if (size && size.height !== 0) {
      const ratio = (this.aspectRatio = size.width / size.height)
      if (w / h !== ratio) {
        this.resize({ width: Math.min(w, h * ratio), height: Math.min(h, w / ratio) })
        this.canvas.overrideHistory()
      }
    }
  }
  updateZIndex(): void {
    this.renderZIndex()
  }
  renderZIndex(): void {
    const z = (this.zIndex = Math.round(-this.width * this.height))
    this.nodeEl.style.zIndex = String(z)
  }
  isEditable(): boolean {
    return true
  }
  startEditing(): void {
    super.startEditing()
    if (!this.canvas.readonly) this.focusLabel()
  }
  showMenu(menu: Menu): void {
    super.showMenu(menu)
    if (!this.canvas.readonly) menu.addItem(i => i.setSection('canvas').setTitle(S.actionEditLabel).setIcon('lucide-edit').onClick(() => this.startEditing()))
  }
}

function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export function sameBBox(a: BBox, b: BBox): boolean {
  return bboxEquals(a, b)
}

nodeClasses.GroupNode = GroupNode
