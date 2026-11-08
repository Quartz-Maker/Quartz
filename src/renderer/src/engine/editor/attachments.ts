/* eslint-disable @typescript-eslint/no-explicit-any */
// Paste / drop of files and in-app drags into the editor (ClipboardManager):
//  * pasted/dropped images & files are saved through `app.saveAttachment` (attachmentFolderPath
//    incl. `./`), "Pasted image YYYYMMDDHHmmss.png" naming, and embedded with `![[...]]`;
//  * files that already live in the vault are linked, not copied;
//  * Ctrl (Alt on macOS) + drop links files (vault files by link, outside files as file:// links);
//  * dragging a file / files / link / heading / bookmarks from the explorer, search, backlinks
//    or bookmarks inserts links (`generateMarkdownLink`, `!` for embeddable types).
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { fs, electron } from '../node'
import { moment } from '../ui/moment'
import { Platform } from '../keymap/Platform'
import { TFile } from '../vault/TAbstractFile'
import { parseLinktext, encodeLinkDestination, stripHeadingForLink } from '../metadata/linktext'
import type { Draggable } from '../app/DragManager'

const IMAGE_EXTS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
const EMBEDDABLE = [...IMAGE_EXTS, 'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus', 'mp4', 'webm', 'ogv', 'mov', 'mkv', 'pdf', 'base', 'canvas']
export const isEmbeddable = (ext: string): boolean => EMBEDDABLE.includes(ext)

const baseName = (p: string): string => p.slice(p.replace(/\\/g, '/').lastIndexOf('/') + 1)
const extOf = (n: string): string => {
  const i = n.lastIndexOf('.')
  return i === -1 || i === n.length - 1 || i === 0 ? '' : n.slice(i + 1).toLowerCase()
}
const stemOf = (n: string): string => {
  const i = n.lastIndexOf('.')
  return i === -1 || i === n.length - 1 || i === 0 ? n : n.slice(0, i)
}

export interface DroppedFile {
  name: string
  filepath?: string
  extension: string
  data: Promise<ArrayBuffer> | ArrayBuffer | null
  isDirectory?: boolean
}

function readLocal(path: string): Promise<ArrayBuffer> | null {
  try {
    const f = fs()
    if (!f.existsSync(path)) return null
    return f.promises.readFile(path).then(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
  } catch {
    return null
  }
}
function isDir(path: string): boolean {
  try {
    return fs().statSync(path).isDirectory()
  } catch {
    return false
  }
}
function filePathOf(file: File): string {
  try {
    const wu = (electron() as any).webUtils
    if (wu?.getPathForFile) return wu.getPathForFile(file) || ''
  } catch {
    /* not electron */
  }
  return (file as any).path || ''
}

/** Files carried by a DataTransfer. `readData` also loads each file's bytes. */
export function getDataTransferFiles(dt: DataTransfer, source: 'clipboard' | 'drop', readData: boolean): DroppedFile[] {
  const out: DroppedFile[] = []
  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== 'file') continue
    const f = item.getAsFile()
    if (!f) continue
    const path = filePathOf(f)
    let ext = extOf(f.name)
    let name = stemOf(f.name)
    if (!path) {
      if (f.type === 'image/png') {
        ext = 'png'
        name = 'Pasted image'
      } else if (f.type === 'image/jpeg') {
        ext = 'jpg'
        name = 'Pasted image'
      }
    }
    if (path && isDir(path)) out.push({ name, filepath: path, extension: '', data: null, isDirectory: true })
    else out.push({ name, filepath: path, extension: ext, data: readData ? (path ? readLocal(path) : f.arrayBuffer()) : null })
  }
  if (source === 'clipboard' && out.length === 0 && !dt.getData('text/plain')) {
    try {
      const clip = (electron() as any).clipboard
      const img = clip?.readImage?.()
      if (img && !img.isEmpty()) {
        const png: Uint8Array = img.toPNG()
        out.push({ name: 'Pasted image', extension: 'png', data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer })
      }
    } catch {
      /* no clipboard access */
    }
  }
  return out
}

/** Link text lines for an in-app draggable. */
export function draggableToLinks(app: any, d: Draggable, sourcePath: string, embed: boolean): string[] {
  const link = (file: TFile, subpath?: string, alias?: string): string => {
    const l = app.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias)
    return embed && isEmbeddable(file.extension) ? '!' + l : l
  }
  switch (d.type) {
    case 'file':
      return [link(d.file)]
    case 'files':
      return (d.files as any[]).filter(f => f instanceof TFile).map(f => link(f))
    case 'link':
      return d.file ? [link(d.file, parseLinktext(d.linktext).subpath)] : [d.linktext]
    case 'heading':
      return [link(d.file, '#' + stripHeadingForLink(d.heading.heading))]
    case 'bookmarks': {
      const out: string[] = []
      for (const it of d.items as any[]) {
        const b = it.item
        if (b.type !== 'file') continue
        const f = app.vault.getAbstractFileByPath(b.path)
        if (f instanceof TFile) out.push(link(f, b.subpath, b.title))
      }
      return out
    }
  }
  return []
}

export interface AttachmentHost {
  app: any
  getPath(): string
  editor: any
}

export class AttachmentManager {
  constructor(private host: () => AttachmentHost | null) {}

  /** Paste: files on the clipboard (or an image from the OS clipboard) become attachments. */
  handlePasteFiles(dt: DataTransfer): boolean {
    const files = getDataTransferFiles(dt, 'clipboard', true)
    if (files.length === 0) return false
    void this.insertFiles(files)
    return true
  }

  async insertFiles(files: DroppedFile[]): Promise<void> {
    const h = this.host()
    if (!h) return
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const more = i < files.length - 1
      const inVault = f.filepath ? h.app.vault.resolveFilePath(f.filepath) : null
      if (inVault) {
        this.insertAttachmentEmbed(inVault, more)
        continue
      }
      const data = await f.data
      if (data) await this.saveAttachment(f.name, f.extension, data, more)
    }
  }

  async saveAttachment(name: string, ext: string, data: ArrayBuffer, more = false): Promise<void> {
    const h = this.host()
    if (!h) return
    if (name === 'Pasted image') name += ' ' + moment().format('YYYYMMDDHHmmss')
    const file = await h.app.saveAttachment(name, ext, data)
    if (file) this.insertAttachmentEmbed(file, more)
  }

  /** `data:` images pasted inside HTML (> 1000 chars) are saved as "Pasted image" attachments. */
  async saveDataUrl(url: string): Promise<void> {
    const m = url.match(/^data:([\w/\-.]+);base64,(.*)/)
    if (!m) return
    const png = m[1] === 'image/png'
    if (!png && m[1] !== 'image/jpeg') return
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    await this.saveAttachment('Pasted image', png ? 'png' : 'jpg', bytes.buffer, true)
  }

  insertAttachmentEmbed(file: TFile, more: boolean): void {
    const h = this.host()
    if (!h) return
    let text = '!' + h.app.fileManager.generateMarkdownLink(file, h.getPath())
    if (more) text += '\n\n'
    h.editor.replaceSelection(text)
  }

  handleDragOver(e: DragEvent): void {
    const h = this.host()
    const dm = h?.app.dragManager
    const d: Draggable | null = dm?.draggable ?? null
    const link = (action: string): void => {
      setEffect(e, 'link')
      dm.setAction(action)
    }
    if (d) {
      if (Platform.isMacOS ? e.shiftKey : e.altKey) return
      if (d.type === 'file' || d.type === 'link' || d.type === 'heading') link('Insert link here')
      else if (d.type === 'files') link('Insert links here')
      else if (d.type === 'bookmarks' && (d.items as any[]).some(i => i.item.type === 'file')) link('Insert link here')
    } else if (e.ctrlKey) setEffect(e, 'link')
    else setEffect(e, 'copy')
  }

  /** Returns true when the drop was handled (default prevented). */
  handleDrop(e: DragEvent, view: EditorView, convert: (dt: DataTransfer) => string | null): boolean {
    const h = this.host()
    if (!h) return false
    const app = h.app
    let text: string | null = null
    const d: Draggable | null = app.dragManager?.draggable ?? null
    if (d) text = draggableToLinks(app, d, h.getPath(), true).join('\n')
    else {
      if (e.defaultPrevented) return true
      app.workspace.trigger('editor-drop', e, h.editor, this.host())
      if (e.defaultPrevented) return true
      if (!e.shiftKey && e.dataTransfer) text = convert(e.dataTransfer)
      if (!text) text = this.handleDropIntoEditor(e)
    }
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos != null) view.dispatch({ selection: EditorSelection.single(pos) })
    if (typeof text !== 'string') return false
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
    e.preventDefault()
    return true
  }

  private handleDropIntoEditor(e: DragEvent): string | null {
    const h = this.host()!
    const dt = e.dataTransfer
    if (!dt) return null
    if (Platform.isMacOS ? e.altKey : e.ctrlKey) {
      const lines: string[] = []
      for (const f of getDataTransferFiles(dt, 'drop', false)) {
        if (!f.filepath) continue
        const inVault = h.app.vault.resolveFilePath(f.filepath)
        if (inVault) {
          const l = h.app.fileManager.generateMarkdownLink(inVault, h.getPath())
          lines.push(isEmbeddable(inVault.extension) ? '!' + l : l)
        } else {
          const name = baseName(f.filepath)
          const ext = extOf(name)
          const title = ext === 'md' ? stemOf(name) : name
          let url = encodeLinkDestination(f.filepath)
          url = url.startsWith('/') ? 'file://' + url : 'file:///' + url
          const l = `[${title}](${url})`
          lines.push(IMAGE_EXTS.includes(ext) ? '!' + l : l)
        }
      }
      return lines.length === 0 ? null : lines.join('\n')
    }
    const files = getDataTransferFiles(dt, 'drop', true)
    if (files.length > 0) e.preventDefault()
    void this.insertFiles(files)
    return null
  }
}

const ALLOWED: Record<string, string[]> = {
  none: [],
  copy: ['copy'],
  copyLink: ['copy', 'link'],
  copyMove: ['copy', 'move'],
  link: ['link'],
  linkMove: ['link', 'move'],
  move: ['move'],
  all: ['copy', 'link', 'move'],
  uninitialized: ['copy', 'link', 'move']
}
function setEffect(e: DragEvent, effect: 'copy' | 'link' | 'move' | 'none'): void {
  const dt = e.dataTransfer
  if (!dt) return
  if (effect === 'none' || (ALLOWED[dt.effectAllowed] || []).includes(effect)) dt.dropEffect = effect
}
