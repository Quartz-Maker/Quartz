/* eslint-disable @typescript-eslint/no-explicit-any */
// Image / audio / video / PDF file views (types "image", "audio", "video", "pdf").
//   image: .view-content > .image-container > img
//   audio: .view-content > .audio-container > audio[controls]
//   video: .view-content > .video-container > video[controls]
//   pdf:   .view-content > .pdf-container > iframe  (Chromium's viewer)
import { EditableFileView } from '../../view/FileView'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'

abstract class MediaView extends EditableFileView {
  abstract containerClass: string
  abstract createMedia(parent: HTMLElement, src: string): void
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }
  async onLoadFile(file: any): Promise<void> {
    await super.onLoadFile(file)
    this.contentEl.empty()
    const box = this.contentEl.createDiv(this.containerClass)
    this.createMedia(box, (this.app.vault as any).getResourcePath(file))
  }
  async onUnloadFile(file: any): Promise<void> {
    this.contentEl.empty()
    await super.onUnloadFile(file)
  }
}

export class ImageView extends MediaView {
  icon = 'lucide-image'
  containerClass = 'image-container'
  getViewType(): string {
    return 'image'
  }
  createMedia(parent: HTMLElement, src: string): void {
    parent.createEl('img', { attr: { src } })
  }
}

export class AudioView extends MediaView {
  icon = 'lucide-file-audio'
  containerClass = 'audio-container'
  getViewType(): string {
    return 'audio'
  }
  createMedia(parent: HTMLElement, src: string): void {
    parent.createEl('audio', { attr: { src, controls: '' } })
  }
}

export class VideoView extends MediaView {
  icon = 'lucide-file-video'
  containerClass = 'video-container'
  getViewType(): string {
    return 'video'
  }
  createMedia(parent: HTMLElement, src: string): void {
    parent.createEl('video', { attr: { src, controls: '' } })
  }
}

export class PdfView extends MediaView {
  icon = 'lucide-file-text'
  containerClass = 'pdf-container'
  getViewType(): string {
    return 'pdf'
  }
  createMedia(parent: HTMLElement, src: string): void {
    const f = parent.createEl('iframe', { attr: { src } })
    f.style.width = '100%'
    f.style.height = '100%'
    f.style.border = '0'
  }
}

export function registerMediaViews(app: any): void {
  const reg = app.viewRegistry
  reg.registerViewWithExtensions(['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'], 'image', (l: any) => new ImageView(l))
  reg.registerViewWithExtensions(['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus'], 'audio', (l: any) => new AudioView(l))
  reg.registerViewWithExtensions(['mp4', 'webm', 'ogv', 'mov', 'mkv'], 'video', (l: any) => new VideoView(l))
  reg.registerViewWithExtensions(['pdf'], 'pdf', (l: any) => new PdfView(l))
}
