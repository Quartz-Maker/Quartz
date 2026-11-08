/* eslint-disable @typescript-eslint/no-explicit-any */
// Value rendering helpers shared by all Bases views.
import { setIcon } from '../../ui/icons'
import type { RenderContext } from './values'

export function createRenderContext(app: any, sourcePath: string): RenderContext {
  return {
    app,
    renderFileLink(target: any, display: any, el: HTMLElement) {
      const isFile = target && typeof target === 'object'
      const linktext: string = isFile ? target.path : target
      const text = display ? String(display) : isFile ? (target.extension === 'md' ? target.basename : target.name) : linktext.replace(/^.*\//, '').replace(/\.md$/, '')
      const a = el.createSpan({ cls: 'internal-link', text })
      a.setAttr('data-href', linktext)
      a.setAttr('draggable', 'true')
      a.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        void app.workspace.openLinkText(linktext, sourcePath, e.ctrlKey || e.metaKey)
      })
      a.addEventListener('mouseover', e => app.workspace.trigger('hover-link', { event: e, source: 'bases', hoverParent: el, targetEl: a, linktext, sourcePath }))
      el.addClass('markdown-rendered')
    },
    renderExternalLink(url: string, display: any, el: HTMLElement) {
      const a = el.createEl('a', { cls: 'external-link', text: display ? String(display) : url, attr: { href: url, target: '_blank', rel: 'noopener' } })
      el.addClass('markdown-rendered')
      return a
    },
    renderTag(tag: string, el: HTMLElement) {
      const a = el.createEl('a', { cls: 'tag', text: tag, attr: { href: tag } })
      a.addEventListener('click', e => {
        e.preventDefault()
        app.internalPlugins?.getEnabledPluginById?.('global-search')?.openGlobalSearch?.('tag:' + tag)
      })
      el.addClass('markdown-rendered')
    },
    renderIcon(name: string, el: HTMLElement) {
      setIcon(el, name)
    }
  } as RenderContext
}

/** `div.text-icon-button.tappable` used by the toolbar and kanban footers. */
export function textIconButton(parent: HTMLElement, opts: { icon?: string; label?: string; auxIcon?: string; cls?: string }): HTMLElement {
  const b = parent.createDiv({ cls: 'text-icon-button tappable' + (opts.cls ? ' ' + opts.cls : ''), attr: { tabindex: '0', role: 'button' } })
  if (opts.icon) setIcon(b.createSpan({ cls: 'text-button-icon' }), opts.icon)
  if (opts.label !== undefined) b.createSpan({ cls: 'text-button-label', text: opts.label })
  if (opts.auxIcon) setIcon(b.createSpan({ cls: 'text-button-icon mod-aux' }), opts.auxIcon)
  b.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      b.click()
    }
  })
  return b
}
