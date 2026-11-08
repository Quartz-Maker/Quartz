/* eslint-disable @typescript-eslint/no-explicit-any */
// Text card (`TextNode`): markdown text child, convert-to-file action.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { randomId, type CanvasNodeData } from './json'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { CanvasTextChild } from './textCard'
import { FilenameModal } from './modals'
import { EmbedNode } from './CanvasContentNodes'

export class TextNode extends EmbedNode {
  text = ''
  constructor(canvas: Canvas, id: string = randomId(16)) {
    super(canvas, id)
  }
  getData(): CanvasNodeData {
    return { ...super.getData(), type: 'text', text: this.text } as CanvasNodeData
  }
  setData(data: any): void {
    super.setData(data)
    if (typeof data.text === 'string') this.setText(data.text)
  }
  setText(text: string): void {
    if (this.text === text) return
    this.text = text
    if (this.child) this.child.set(text)
  }
  initialize(): void {
    super.initialize()
    setIcon(this.placeholderEl.createDiv('canvas-icon-placeholder'), 'lucide-align-left')
  }
  render(): void {
    super.render()
    if (!this.child) {
      this.child = new CanvasTextChild(this)
      this.child.set(this.text)
      this.child.load()
    }
  }
  showMenu(menu: Menu): void {
    super.showMenu(menu)
    if (this.canvas.readonly || !this.child) return
    menu.addItem(i => i.setSection('canvas').setTitle(S.edit).setIcon('lucide-edit').onClick(() => this.startEditing()))
    menu.addItem(i => i.setSection('canvas').setTitle(S.actionConvertToFile).setIcon('lucide-file-input').onClick(() => this.convertToFile()))
  }
  /** Replace the card by a new note with its text; connections are re-pointed. */
  convertToFile(): void {
    const canvas = this.canvas
    const text = this.text
    const sourcePath = canvas.view.file?.path ?? ''
    new FilenameModal(this.app, 'Untitled', async (name: string) => {
      const fm = this.app.fileManager
      const parent = fm.getNewFileParent(sourcePath, name)
      const file = await fm.createNewMarkdownFile(parent, name, text)
      const node = canvas.createFileNode({ pos: this, size: this, file, save: false, focus: false })
      for (const edge of canvas.getEdgesForNode(this)) {
        if (edge.from.node === this) edge.update({ ...edge.from, node }, edge.to)
        if (edge.to.node === this) edge.update(edge.from, { ...edge.to, node })
      }
      canvas.removeNode(this)
      canvas.selectOnly(node)
      canvas.requestSave()
    }).open()
  }
}
