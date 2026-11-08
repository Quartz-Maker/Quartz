/* eslint-disable @typescript-eslint/no-explicit-any */
// Wires the reading renderer (engine/markdown host) to the real App: vault-relative paths,
// link resolution through app.metadataCache, link opening through app.workspace.
import { setMarkdownHost, notifyPostProcessorChange } from '@/engine/markdown'
import { openGlobalSearch } from '@/engine/search/SearchView'
import { electron } from '@/engine/node'

export function installAppReadingHost(app: any): void {
  setMarkdownHost({
    resolveLink: (linkpath, sourcePath) => {
      if (linkpath === '') return sourcePath || null
      return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null
    },
    getResourcePath: p => (/^(https?:|data:|app:|blob:)/i.test(p) ? p : app.vault.adapter.getResourcePath(p)),
    readFile: async p => {
      const f = app.vault.getFileByPath(p)
      if (!f) return ''
      try {
        return await app.vault.cachedRead(f)
      } catch {
        return ''
      }
    },
    openLinkText: (linktext, sourcePath, newLeaf) => void app.workspace.openLinkText(linktext, sourcePath, newLeaf),
    openExternal: href => {
      try {
        void (electron() as any).shell.openExternal(href)
      } catch {
        window.open(href, '_blank')
      }
    },
    onTagClick: tag => openGlobalSearch(app, `tag:${tag}`),
    onHoverLink: info => app.workspace.trigger('hover-link', { event: info.event, source: 'preview', hoverParent: null, targetEl: info.targetEl, linktext: info.linktext, sourcePath: info.sourcePath }),
    loadLocalStorage: key => app.loadLocalStorage(key),
    saveLocalStorage: (key, value) => app.saveLocalStorage(key, value),
    getConfig: key => app.vault.getConfig(key),
    onPostProcessorChange: () => app.workspace.trigger('post-processor-change')
  })
  // Re-render reading views on the workspace event (also fired by plugins and settings).
  app.workspace.on('post-processor-change', notifyPostProcessorChange)
}
