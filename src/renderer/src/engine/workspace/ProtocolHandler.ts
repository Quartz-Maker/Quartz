/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.workspace.protocolHandler`: dispatches `quartz://<action>?…` URIs (main process → window.OBS_ACT) to the
// registered action handlers. Default actions: open, search, new, show-plugin,
// show-theme, hook-get-address, vault-setup; core plugins add daily/unique; community plugins add theirs through
// `Plugin.registerObsidianProtocolHandler`. x-callback-url (`x-success` / `x-error`) is honoured only when
// "Allow URI callbacks" (uriCallbacks) is on.
import { Notice } from '../ui/Notice'
import { parseLinktext } from '../metadata/linktext'
import { normalizePath, dirname, basename } from '../vault/path'
import { TFile, TFolder } from '../vault/TAbstractFile'

export type ProtocolParams = Record<string, string> & { action: string }
export type ProtocolHandlerFn = (params: ProtocolParams) => any

/** `paneType` URI param → `workspace.getLeaf` argument. */
function paneType(v: any): any {
  if (v === true || v === 'true') return true
  return v === 'tab' || v === 'window' || v === 'split' ? v : false
}

/** Append query params to a callback URL. */
export function addQuery(url: string, params: Record<string, string>): string {
  const q = Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&')
  if (!q) return url
  return url + (url.includes('?') ? '&' : '?') + q
}

export class ProtocolHandler {
  handlers = new Map<string, ProtocolHandlerFn>()

  constructor(
    public app: any,
    public workspace: any
  ) {
    app.saveLocalStorage?.('trusted-uri-actions', null)
  }

  register(action: string, handler: ProtocolHandlerFn): void {
    if (this.handlers.has(action)) throw new Error(`Action "${action}" is already registered as a handler.`)
    this.handlers.set(action, handler)
  }

  unregister(action: string, handler?: ProtocolHandlerFn): void {
    if (!handler || this.handlers.get(action) === handler) this.handlers.delete(action)
  }

  /** Install as `window.OBS_ACT` (draining a payload main queued before the page was ready). */
  init(): void {
    const w = window as any
    const queued = w.OBS_ACT
    w.OBS_ACT = this.dispatch.bind(this)
    if (queued && typeof queued !== 'function') this.dispatch(queued)
  }

  dispatch(params: ProtocolParams | null | undefined): void {
    if (!params || typeof params !== 'object') return
    console.log('Received URL action', params)
    ;(this.workspace.getFocusedContainer?.() as HTMLElement | undefined)?.focus?.()
    const action = params.action
    if (!action) return
    if (action === 'open' && Object.keys(params).length === 1) return
    const h = this.handlers.get(action)
    if (h) h(params)
    else new Notice(`Unrecognized URI action: ${action}`)
  }

  /** x-success callback for `file` (only with "Allow URI callbacks"); returns true when one was handled. */
  handleXCallback(params: ProtocolParams, file: TFile): boolean {
    if (!this.app.vault.getConfig('uriCallbacks')) return false
    if (!Object.hasOwn(params, 'x-success')) return false
    const q: Record<string, string> = { name: file.basename, url: this.app.getObsidianUrl(file) }
    const adapter = this.app.vault.adapter
    if (adapter?.getFullPath) q.file = adapter.getFullPath(file.path)
    try {
      const url = addQuery(params['x-success'], q)
      if (new URL(url).protocol.toLowerCase() === 'file:') return true
      window.open(url)
    } catch (e) {
      console.error(e)
    }
    return true
  }

  registerDefaultHandlers(): void {
    const app = this.app
    const ws = this.workspace
    this.register('open', p => {
      if (!p.file) return
      const { path, subpath } = parseLinktext(p.file)
      const file = app.metadataCache.getFirstLinkpathDest(normalizePath(path), '')
      if (file) {
        void ws.getLeaf(paneType(p.paneType)).openFile(file, { active: true, eState: subpath ? { subpath } : {} })
        new Notice(`Opened file “${file.path}”`)
      } else new Notice(`File “${p.file}” not found.`)
    })
    this.register('search', p => {
      app.internalPlugins?.getEnabledPluginById?.('global-search')?.openGlobalSearch?.(p.query)
    })
    this.register('new', async p => {
      const { vault, fileManager, metadataCache } = app
      const insert = p.append || p.prepend || p.overwrite
      let file: TFile | null = null
      if (p.file) {
        const target = p.file
        if (/\.\.[/\\]/.test(target)) return
        if (insert) {
          file = metadataCache.getFirstLinkpathDest(target, '')
          if (!file) {
            const f = vault.getAbstractFileByPathInsensitive(target)
            if (f instanceof TFile) file = f
          }
        }
        if (!file) {
          const dir = dirname(target)
          let parent: any = dir === '' || dir === '/' ? vault.getRoot() : vault.getAbstractFileByPathInsensitive(dir)
          if (!parent) {
            await vault.createFolder(dir)
            parent = vault.getAbstractFileByPathInsensitive(dir)
          }
          if (!(parent instanceof TFolder)) return
          try {
            file = await fileManager.createNewFile(parent, basename(target))
          } catch (e) {
            new Notice(String(e))
            return
          }
        }
      } else {
        const name = (p.name || '').replace(/[/\\]/, '')
        if (insert) file = metadataCache.getFirstLinkpathDest(name, '')
        if (!file) {
          const active = ws.getActiveFile()
          const parent = fileManager.getNewFileParent(active ? active.path : '', name)
          try {
            file = await fileManager.createNewFile(parent, name)
          } catch (e) {
            new Notice(String(e))
            return
          }
        }
      }
      if (!file) return
      let content: string | undefined = p.content
      if (p.clipboard) content = await navigator.clipboard.readText()
      if (content) {
        if (p.append || p.prepend) await fileManager.insertIntoFile(file, content, p.prepend ? 'prepend' : 'append')
        else await vault.modify(file, content)
      }
      if (!p.silent) await ws.getLeaf(paneType(p.paneType)).openFile(file, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } })
      this.handleXCallback(p, file)
    })
    this.register('show-plugin', p => {
      if (!app.plugins?.isEnabled?.()) {
        app.setting.open()
        app.setting.openTabById('community-plugins')
        return
      }
      if (p.id) void import('../settings/community/CommunityPluginsModal').then(m => new m.CommunityPluginsModal(app).setAutoOpen(p.id).setDimBackground(true).open())
    })
    this.register('show-theme', p => {
      if (p.name) void import('../settings/community/CommunityThemesModal').then(m => new m.CommunityThemesModal(app).setAutoOpen(p.name).setDimBackground(true).open())
    })
    this.register('vault-setup', () => {})
    this.register('hook-get-address', p => {
      if (!app.vault.getConfig('uriCallbacks')) return
      const file = ws.getActiveFile()
      if (file) {
        if (!this.handleXCallback(p, file)) void navigator.clipboard.writeText(`[${file.basename}](${app.getObsidianUrl(file)})`)
      } else if (Object.hasOwn(p, 'x-error'))
        window.open(addQuery(p['x-error'], { errorCode: 'NotFound', errorMessage: 'No file is open at the moment' }))
    })
  }
}
