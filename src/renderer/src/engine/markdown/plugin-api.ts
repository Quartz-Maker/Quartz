// Plugin-facing registration (`Plugin.registerMarkdownPostProcessor` /
// `registerMarkdownCodeBlockProcessor`). The plugin area calls these with its own
// Component so registrations are removed on unload; every reading view re-renders
// on change (`post-processor-change`).
import type { Component } from '../core/Component'
import { MarkdownPreviewRenderer, type MarkdownPostProcessor, type MarkdownPostProcessorContext } from './MarkdownPreviewRenderer'
import { triggerPostProcessorChange } from './host'

export function registerMarkdownPostProcessor(owner: Component | null, pp: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor {
  MarkdownPreviewRenderer.registerPostProcessor(pp, sortOrder)
  triggerPostProcessorChange()
  owner?.register(() => {
    MarkdownPreviewRenderer.unregisterPostProcessor(pp)
    triggerPostProcessorChange()
  })
  return pp
}

export function registerMarkdownCodeBlockProcessor(
  owner: Component | null,
  language: string,
  handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void,
  sortOrder?: number
): MarkdownPostProcessor {
  const pp = MarkdownPreviewRenderer.createCodeBlockPostProcessor(language, handler)
  MarkdownPreviewRenderer.registerPostProcessor(pp, sortOrder)
  MarkdownPreviewRenderer.registerCodeBlockPostProcessor(language, handler)
  triggerPostProcessorChange()
  owner?.register(() => {
    MarkdownPreviewRenderer.unregisterPostProcessor(pp)
    MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor(language)
    triggerPostProcessorChange()
  })
  return pp
}
