// ViewRegistry — `app.viewRegistry` (registerView / registerExtensions / getTypeByExtension …).
// Events: view-registered, view-unregistered, extensions-updated.
import { Events } from '../core/Events'
import type { View } from './View'
import type { WorkspaceLeaf } from '../workspace/WorkspaceLeaf'

export type ViewCreator = (leaf: WorkspaceLeaf) => View

export class ViewRegistry extends Events {
  viewByType: Record<string, ViewCreator> = {}
  typeByExtension: Record<string, string> = {}

  registerView(type: string, creator: ViewCreator): void {
    if (Object.prototype.hasOwnProperty.call(this.viewByType, type)) throw new Error(`Attempting to register an existing view type "${type}"`)
    this.viewByType[type] = creator
    this.trigger('view-registered', type)
  }

  unregisterView(type: string): void {
    if (Object.prototype.hasOwnProperty.call(this.viewByType, type)) {
      delete this.viewByType[type]
      this.trigger('view-unregistered', type)
    }
  }

  registerExtensions(extensions: string[], type: string): void {
    for (const ext of extensions) {
      if (Object.prototype.hasOwnProperty.call(this.typeByExtension, ext)) throw new Error(`Attempting to register an existing file extension "${ext}"`)
    }
    for (const ext of extensions) this.typeByExtension[ext] = type
    this.trigger('extensions-updated')
  }

  unregisterExtensions(extensions: string[]): void {
    for (const ext of extensions) delete this.typeByExtension[ext]
    this.trigger('extensions-updated')
  }

  registerViewWithExtensions(extensions: string[], type: string, creator: ViewCreator): void {
    this.registerView(type, creator)
    this.registerExtensions(extensions, type)
  }

  getViewCreatorByType(type: string): ViewCreator | undefined {
    return this.viewByType[type]
  }

  getTypeByExtension(ext: string): string | undefined {
    return this.typeByExtension[ext]
  }

  isExtensionRegistered(ext: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.typeByExtension, ext)
  }
}

/**
 * Built-in extension → view-type map (canvas/bases come from core plugins).
 * The views themselves belong to other areas; call this once their creators exist.
 */
export const BUILTIN_VIEW_EXTENSIONS: Record<string, string[]> = {
  markdown: ['md'],
  image: ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'],
  audio: ['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'mkv'],
  pdf: ['pdf'],
  canvas: ['canvas'],
  bases: ['base']
}
