// Live Preview block widgets render through the reading renderer
// (callouts, table cells, embeds and code-block processors all use MarkdownRenderer).
import { Component } from '../core/Component'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MarkdownPreviewRenderer } from '../markdown/MarkdownPreviewRenderer'
import { loadEmbed } from '../markdown/embeds'
import { getMarkdownHost } from '../markdown/host'
import { setMarkdownRenderer, setCodeBlockProcessorSource, setEmbedLoader } from './livepreview/render'

export function wireReadingRendererIntoLivePreview(): void {
  setMarkdownRenderer((el, markdown, sourcePath, component) => {
    const owner = component instanceof Component ? component : new Component()
    if (!(component instanceof Component)) owner.load()
    return MarkdownRenderer.render((window as any).app, markdown, el, sourcePath, owner)
  })
  setCodeBlockProcessorSource(() => MarkdownPreviewRenderer.codeBlockPostProcessors)
  setEmbedLoader(function load(el, linktext, sourcePath) {
    const app = (window as any).app
    const baseClass = el.className
    // Before the metadata cache has indexed the vault every link looks unresolved, so
    // such embeds are re-rendered once the cache reports 'resolved'.
    if (app && !app.metadataCache.initialized && !getMarkdownHost().resolveLink(linktext.split('#')[0], sourcePath)) {
      const ref = app.metadataCache.on('resolved', () => {
        app.metadataCache.offref(ref)
        if (!el.isConnected) return
        el.className = baseClass
        load(el, linktext, sourcePath)
      })
    }
    const embed = loadEmbed({ app, linktext, sourcePath, containerEl: el, depth: 0 })
    embed.load()
    void embed.loadFile()
  })
}
