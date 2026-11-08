// Reading-view renderer public types: post-processor, owner and link-handler contracts (split from MarkdownPreviewRenderer.ts).
import type { MarkdownSection } from './previewSection'
/* eslint-disable @typescript-eslint/no-explicit-any */

export type MarkdownPostProcessor = ((el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void) & {
  sortOrder?: number
}
export type MarkdownRecycler = (el: HTMLElement, recycled: MarkdownSection[]) => void
export interface MarkdownSectionInformation {
  text: string
  lineStart: number
  lineEnd: number
}
export interface MarkdownPostProcessorContext {
  docId: string
  sourcePath: string
  frontmatter: any
  promises: Promise<any>[]
  addChild(child: any): void
  getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null
  replace(text: string, rerender?: boolean): void
  containerEl: HTMLElement
  el: HTMLElement
  displayMode?: boolean
  replaceCode?: (code: string) => void
}

/** What the renderer needs from its owner (MarkdownPreviewView / embed). */
export interface PreviewOwner {
  postProcess(section: MarkdownSection, promises: Promise<any>[], frontmatter: any): void
  onRenderComplete(): void
  onScroll(): void
  onFoldChange(): void
  onCheckboxClick(evt: MouseEvent, el: HTMLInputElement, line: number): void
  _children?: any[]
  removeChild?(c: any): void
}

/** Link interaction handlers. */
export interface LinkHandlers {
  onInternalLinkClick(evt: MouseEvent, el: HTMLElement, href: string, text?: string): void
  onInternalLinkDrag(evt: DragEvent, el: HTMLElement, href: string, text?: string): void
  onInternalLinkRightClick(evt: MouseEvent, el: HTMLElement, href: string, text?: string): void
  onInternalLinkMouseover(evt: MouseEvent, el: HTMLElement, href: string, text?: string): void
  onExternalLinkClick(evt: MouseEvent, el: HTMLElement, href: string): void
  onExternalLinkRightClick(evt: MouseEvent, el: HTMLElement, href: string): void
  onTagClick(evt: MouseEvent, el: HTMLElement, tag: string): void
}
