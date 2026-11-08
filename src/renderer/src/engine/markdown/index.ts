// Markdown reading pipeline.
//   parse (legacy remark + syntax tokenizers) → mdast transformers → hast → HTML
//   → DOMPurify → sections → post-processors → embeds.
export * from './pipeline'
export * from './sanitize'
export { QuartzParser, parseLinktext, linkDisplayText, normalizeLinkPath, TAG_REGEX } from './parser'
export { parseSections, type ParsedSection, type ParsedSections } from './sections'
export {
  MarkdownPreviewRenderer,
  MarkdownSection,
  renderOptions,
  type MarkdownPostProcessor,
  type MarkdownPostProcessorContext,
  type MarkdownSectionInformation,
  type LinkHandlers,
  type PreviewOwner
} from './MarkdownPreviewRenderer'
export { MarkdownRenderChild } from './MarkdownRenderChild'
export { MarkdownRenderer, resolveLinks, createLinkHandlers } from './MarkdownRenderer'
export { MarkdownPreviewView, type PreviewHostView } from './MarkdownPreviewView'
export { installBuiltinPostProcessors, setMermaidTrusted, fixFileLinks, renderMermaidBlock } from './postprocessors'
export { embedRegistry, EmbedRegistry, loadEmbed, resolveSubpath, type EmbedCreator, type EmbedContext } from './embeds'
export { setMarkdownHost, getMarkdownHost, triggerPostProcessorChange, notifyPostProcessorChange, onPostProcessorChange, type MarkdownHost } from './host'
export { setMathJaxLoader } from './mathjax'
export { setIcon, getIcon } from './icons'
export { registerMarkdownPostProcessor, registerMarkdownCodeBlockProcessor } from './plugin-api'

import { markdownToHtml, type ParseOptions } from './pipeline'
import { sanitizeHTMLToDom } from './sanitize'

/** Core sanitised HTML (no post-processors). */
export function renderCoreFragment(markdown: string, options?: ParseOptions, doc: Document = document): DocumentFragment {
  return sanitizeHTMLToDom(markdownToHtml(markdown, options), doc)
}
export function renderCoreHtml(markdown: string, options?: ParseOptions): string {
  const div = document.createElement('div')
  div.appendChild(renderCoreFragment(markdown, options))
  return div.innerHTML
}
