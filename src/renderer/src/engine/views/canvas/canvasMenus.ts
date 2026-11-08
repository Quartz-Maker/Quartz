/* eslint-disable @typescript-eslint/no-explicit-any */
// Canvas context/quick-settings/creation menu helpers.
// Bodies of Canvas methods (called with the canvas as `this`); the thin methods stay on the class.
import { Menu } from '../../ui/Menu'
import { setIcon } from '../../ui/icons'
import { Notice } from '../../ui/Notice'
import { Platform } from '../../keymap/Platform'
import { bboxToRect, expandBBox, unionBBox, type Point } from './geometry'
import { FileNode } from './CanvasNode'
import { CanvasFileSuggestModal, CanvasMediaSuggestModal, CanvasUrlModal } from './modals'
import { S } from './strings'
import type { Canvas } from './Canvas'
import { webContents } from './canvasSupport'

export function onDoubleClick(this: Canvas, e: MouseEvent): void {
  if (e.defaultPrevented || e.target !== this.wrapperEl || this.isDragging || this.readonly) return
  this.createTextNode({ pos: this.posFromEvt(e), position: 'center' })
}

export function showQuickSettingsMenu(this: Canvas, menu: Menu): void {
  const plugin = this.view.plugin
  const o = plugin.options
  menu
    .addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.optionSnapToGrid)
        .setIcon('lucide-grid')
        .setChecked(!!o.snapToGrid)
        .onClick(() => {
          o.snapToGrid = !o.snapToGrid
          plugin.saveOptions()
        })
    )
    .addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.optionSnapToObjects)
        .setIcon('snap-to-object')
        .setChecked(!!o.snapToObjects)
        .onClick(() => {
          o.snapToObjects = !o.snapToObjects
          plugin.saveOptions()
        })
    )
    .addItem(i =>
      i
        .setSection('canvas')
        .setTitle(S.labelReadonly)
        .setIcon('lucide-lock')
        .setChecked(this.readonly)
        .onClick(() => {
          this.setReadonly(!this.readonly)
          this.view.saveLocalData()
        })
    )
}

export function showCreationMenu(this: Canvas, menu: Menu, pos: Point, size?: { width: number; height: number }): void {
  menu
    .addItem(i =>
      i
        .setTitle(S.actionAddCard)
        .setSection('create')
        .setIcon('lucide-sticky-note')
        .onClick(() => this.createTextNode({ pos, size }))
    )
    .addItem(i =>
      i
        .setTitle(S.actionAddNote)
        .setSection('create')
        .setIcon('lucide-file-text')
        .onClick(() =>
          new CanvasFileSuggestModal(this, f => this.createFileNode({ pos, size, file: f }))
            .showAttachments(false)
            .open()
        )
    )
    .addItem(i =>
      i
        .setTitle(S.actionAddMedia)
        .setSection('create')
        .setIcon('lucide-file-image')
        .onClick(() => new CanvasMediaSuggestModal(this, f => this.createFileNode({ pos, size, file: f })).open())
    )
    .addItem(i =>
      i
        .setTitle(S.actionAddWebsite)
        .setSection('create')
        .setIcon('lucide-external-link')
        .onClick(() => new CanvasUrlModal(this.app, '', url => this.createLinkNode({ pos, size, url })).open())
    )
    .addItem(i =>
      i
        .setTitle(S.actionCreateGroup)
        .setSection('create')
        .setIcon('create-group')
        .onClick(() => this.createGroupNode({ pos, size }))
    )
}

export function onSelectionContextMenu(this: Canvas, e: MouseEvent): void {
  if (e.defaultPrevented) return
  const menu = Menu.forEvent(e)
  menu.addSections(['title', 'open', 'selection', 'clipboard', 'action', 'view', 'info', '', 'danger'])
  if (!this.readonly)
    menu.addItem(i =>
      i
        .setTitle(S.delete)
        .setSection('danger')
        .setIcon('lucide-trash-2')
        .onClick(() => this.deleteSelection())
    )
  menu.addItem(i =>
    i
      .setTitle(S.actionZoomToSelection)
      .setSection('selection')
      .setIcon('zoom-to-selection')
      .onClick(() => this.zoomToSelection())
  )
  if (!this.readonly)
    menu.addItem(i =>
      i
        .setTitle(S.actionCreateGroup)
        .setSection('selection')
        .setIcon('create-group')
        .onClick(() => {
          const r = bboxToRect(expandBBox(unionBBox(Array.from(this.selection.values()).map(x => x.getBBox())), 20))
          this.createGroupNode({ pos: r, size: r })
        })
    )
  if (!this.readonly && Platform.isDesktopApp)
    menu
      .addItem(i =>
        i
          .setTitle(S.cut)
          .setIcon('lucide-scissors')
          .setSection('clipboard')
          .onClick(() => webContents()?.cut())
      )
      .addItem(i =>
        i
          .setTitle(S.copy)
          .setIcon('lucide-copy')
          .setSection('clipboard')
          .onClick(() => webContents()?.copy())
      )
      .addItem(i =>
        i
          .setTitle(S.paste)
          .setIcon('lucide-clipboard-check')
          .setSection('clipboard')
          .onClick(() => webContents()?.paste())
      )
  this.app.workspace?.trigger?.('canvas:selection-menu', menu, this)
  const files = (Array.from(this.selection).filter(i => i instanceof FileNode) as FileNode[]).map(n => n.file)
  if (files.length > 1) this.app.workspace?.trigger?.('files-menu', menu, files, 'canvas:selection-menu', null)
}

/** Export (desktop): the whole canvas or the viewport as PNG. */
export async function generateHDImage(this: Canvas): Promise<void> {
  if (this.nodes.size === 0) {
    new Notice(S.msgExportFailedEmptyCanvas)
    return
  }
  const { exportCanvasImage } = await import('./exportImage')
  await exportCanvasImage(this)
}
