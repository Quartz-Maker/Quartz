/* eslint-disable @typescript-eslint/no-explicit-any */
// `page-preview` core plugin: on the workspace `hover-link` event, show a HoverPopover with the
// linked note rendered (`.popover.hover-popover > .markdown-embed > .markdown-embed-content >
// .markdown-preview-view.markdown-rendered`). Editor sources require Mod held by
// default (`page-preview.json` per-source settings are honoured when present).
import { HoverPopover, PopoverState } from '../ui/HoverPopover'
import { Keymap } from '../keymap/Keymap'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import type { CorePluginDef } from './InternalPlugins'
import { t } from '../settings/i18n'
import { setIcon } from '../ui'

const globalParent: { hoverPopover: HoverPopover | null } = { hoverPopover: null }

export const pagePreviewPlugin: CorePluginDef = {
  id: 'page-preview',
  name: 'Page preview',
  description: 'Hover an internal link to preview its content. In editor mode, press Ctrl/Cmd while hovering.',
  defaultOn: true,
  async onEnable(app, p) {
    // live: `p.instance.options` (page-preview.json) is edited by the settings tab
    const opts = (): Record<string, boolean> => (p.instance as any).options || {}
    p.registerEvent(
      app.workspace.on('hover-link', (info: any) => {
        const { event, source, targetEl, linktext, sourcePath } = info || {}
        // targetEl may be null (graph nodes are canvas sprites): the popover then sits at the mouse.
        if (!linktext) return
        const src = app.workspace.hoverLinkSources?.[source]
        const needMod = source in opts() ? !!opts()[source] : src ? !!src.defaultMod : source === 'editor'
        if (needMod && event && !Keymap.isModifier(event, 'Mod')) return
        const parent = info.hoverParent || globalParent
        if (targetEl && parent.hoverPopover && parent.hoverPopover.targetEl === targetEl && parent.hoverPopover.state !== PopoverState.Hidden) return
        const [path, sub] = String(linktext).split('#')
        const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath || '')
        const pop = new HoverPopover(parent, targetEl)
        if (!file) {
          pop.hoverEl.createDiv({ cls: 'mod-empty', text: t('plugins.pagePreview.labelEmptyNote', { linktext: path }) })
          return
        }
        if (file.extension !== 'md') {
          if (/^(png|jpe?g|gif|bmp|svg|webp|avif)$/i.test(file.extension))
            pop.hoverEl.createDiv('image-embed').createEl('img', { attr: { src: app.vault.getResourcePath(file) } })
          else pop.hoverEl.createDiv({ cls: 'mod-empty', text: file.path })
          return
        }
        // Preview embed DOM: reading view (sizer section) plus the "Open link" button.
        const embed = pop.hoverEl.createDiv('markdown-embed is-loaded')
        const view = embed.createDiv('markdown-embed-content').createDiv('markdown-preview-view markdown-rendered')
        view.toggleClass('show-indentation-guide', app.vault.getConfig?.('showIndentGuide') !== false)
        view.toggleClass('rtl', !!app.vault.getConfig?.('rightToLeft'))
        const sizer = view.createDiv('markdown-preview-sizer markdown-preview-section')
        const link = embed.createDiv({ cls: 'markdown-embed-link', attr: { 'aria-label': 'Open link' } })
        setIcon(link, 'lucide-maximize-2')
        link.addEventListener('click', (e: MouseEvent) => {
          if (e.button !== 0 && e.button !== 1) return
          e.preventDefault()
          void app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(file, { eState: { subpath: sub ? '#' + sub : undefined } })
        })
        void app.vault.cachedRead(file).then((text: string) => {
          let md = text
          if (sub) {
            const h = app.metadataCache.getFileCache(file)?.headings?.find((x: any) => x.heading === sub)
            if (h) md = text.slice(h.position.start.offset)
          }
          return MarkdownRenderer.render(app, md, sizer, file.path, pop)
        })
      })
    )
    // Register these sources (display names + whether Mod must be held by default).
    const ws = app.workspace
    const graph = ws.hoverLinkSources?.graph
    if (graph) ws.unregisterHoverLinkSource?.('graph')
    const P = 'plugins.pagePreview.'
    for (const [id, display, defaultMod] of [
      ['search', t(P + 'labelSourceSearch'), true],
      ['preview', t(P + 'labelSourcePreview'), false],
      ['editor', t(P + 'labelSourceEditor'), true],
      ['tab-header', t(P + 'labelSourceTabHeader'), true],
      ['file-explorer', 'Files', true],
      ['properties', 'Properties view', true],
      ['bookmarks', 'Bookmarks', true],
      ['outline', 'Outline', true],
      ['bases', 'Bases', true]
    ] as [string, string, boolean][])
      ws.registerHoverLinkSource?.(id, { display, defaultMod })
    if (graph) ws.registerHoverLinkSource?.('graph', graph)
  },
  onDisable(app) {
    for (const id of ['search', 'preview', 'editor', 'tab-header', 'file-explorer', 'properties', 'bookmarks', 'outline', 'bases']) app.workspace.unregisterHoverLinkSource?.(id)
  }
}
