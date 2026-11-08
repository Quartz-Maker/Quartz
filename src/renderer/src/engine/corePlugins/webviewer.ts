/* eslint-disable @typescript-eslint/no-explicit-any */
// Web viewer core plugin: view type `webviewer` hosting a `<webview>` with an address bar, history,
// reader mode (defuddle) and save-to-vault. Options default {openExternalURLs:true, enableAdblocking:true}.
import type { CorePluginDef } from '../app/InternalPlugins'
import { ItemView } from '../view/View'
import { Notice, setIcon, moment } from '../ui'
import { t } from '../settings/i18n'
import { htmlToMarkdown } from '../editor/clipboard'

export const VIEW_TYPE_WEBVIEWER = 'webviewer'
const ENGINES: Record<string, string> = {
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  ecosia: 'https://www.ecosia.org/search?q=%s',
  kagi: 'https://kagi.com/search?q=%s'
}

export class WebViewerView extends ItemView {
  url = ''
  title = ''
  webview!: any
  addressEl!: HTMLInputElement
  readerEl: HTMLElement | null = null
  zoom = 0
  navigation = true
  getViewType(): string {
    return VIEW_TYPE_WEBVIEWER
  }
  getIcon(): string {
    return 'lucide-globe'
  }
  getDisplayText(): string {
    return this.title || this.url || 'New tab'
  }
  getState(): any {
    return { url: this.url, title: this.title }
  }
  plugin(): any {
    return (this.app as any).internalPlugins.getEnabledPluginById('webviewer')
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass('webviewer-content')
    const bar = this.contentEl.createDiv('webviewer-bar')
    const btn = (icon: string, label: string, fn: () => void): HTMLElement => {
      const b = bar.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': label } })
      setIcon(b, icon)
      b.addEventListener('click', fn)
      return b
    }
    btn('lucide-arrow-left', 'Back', () => this.webview?.canGoBack?.() && this.webview.goBack())
    btn('lucide-arrow-right', 'Forward', () => this.webview?.canGoForward?.() && this.webview.goForward())
    btn('lucide-rotate-cw', 'Reload', () => this.webview?.reload?.())
    this.addressEl = bar.createEl('input', { cls: 'webviewer-address', type: 'text', placeholder: 'Search or enter address' })
    this.addressEl.addEventListener('keydown', e => e.key === 'Enter' && this.navigate(this.addressEl.value))
    btn('glasses', 'Reader mode', () => void this.toggleReader())
    this.webview = document.createElement('webview')
    this.webview.className = 'webviewer-frame'
    this.webview.setAttribute('allowpopups', '')
    this.webview.setAttribute('partition', 'persist:webviewer')
    this.webview.style.cssText = 'flex:1;width:100%;height:100%'
    this.contentEl.style.cssText = 'display:flex;flex-direction:column'
    this.contentEl.appendChild(this.webview)
    this.webview.addEventListener('did-navigate', (e: any) => this.onNav(e.url))
    this.webview.addEventListener('did-navigate-in-page', (e: any) => this.onNav(e.url))
    this.webview.addEventListener('page-title-updated', (e: any) => {
      this.title = e.title
      (this.leaf as any).updateHeader?.()
      (this.app as any).workspace.requestSaveLayout?.()
    })
    this.webview.addEventListener('dom-ready', () => this.webview.setZoomLevel?.(this.zoom))
    if (this.url) this.webview.setAttribute('src', this.url)
  }
  async setState(state: any, result: any): Promise<void> {
    if (state?.url && state.url !== this.url) this.navigate(state.url)
    if (state?.title) this.title = state.title
    await super.setState(state, result)
  }
  navigate(input: string): void {
    input = input.trim()
    if (!input) return
    let url = input
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(input)) url = 'https://' + input
      else url = (this.plugin()?.options?.searchEngine === 'custom' ? this.plugin().options.customSearchUrl : ENGINES[this.plugin()?.options?.searchEngine ?? 'duckduckgo'] ?? ENGINES.duckduckgo).replace('%s', encodeURIComponent(input))
    }
    this.onNav(url)
    this.webview?.loadURL?.(url).catch(() => undefined)
    if (this.webview && !this.webview.getURL?.()) this.webview.setAttribute('src', url)
  }
  onNav(url: string): void {
    this.url = url
    if (this.addressEl) this.addressEl.value = url
    ;(this.leaf as any).updateHeader?.()
    (this.app as any).workspace.requestSaveLayout?.()
    const hist: any[] = this.plugin()?.history ?? []
    hist.unshift({ url, ts: Date.now(), title: this.title })
    if (this.plugin()) this.plugin().history = hist.slice(0, 500)
  }
  private async page(): Promise<{ html: string; url: string }> {
    return { html: await this.webview.executeJavaScript('document.documentElement.outerHTML'), url: this.url }
  }
  async parseReader(): Promise<any> {
    const { default: Defuddle } = await import('defuddle')
    const { html, url } = await this.page()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return new (Defuddle as any)(doc, { url, markdown: false }).parse()
  }
  async toggleReader(): Promise<void> {
    if (this.readerEl) {
      this.readerEl.detach()
      this.readerEl = null
      this.webview.style.display = ''
      return
    }
    const r = await this.parseReader()
    this.readerEl = this.contentEl.createDiv('webviewer-reader markdown-reading-view')
    this.readerEl.style.cssText = 'flex:1;overflow:auto;padding:var(--file-margins)'
    this.readerEl.createEl('h1', { text: r.title })
    const body = this.readerEl.createDiv('markdown-rendered')
    body.innerHTML = r.content
    this.webview.style.display = 'none'
  }
  async saveToVault(): Promise<void> {
    const r = await this.parseReader()
    const folder: string = (this.plugin()?.options?.savedMarkdownPath ?? 'Clippings').replace(/^\/+|\/+$/g, '')
    const safe = (r.title || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Untitled'
    if (folder) await (this.app as any).fileManager.getOrCreateFolder(folder)
    const path = (this.app as any).vault.getAvailablePath((folder ? folder + '/' : '') + safe, 'md')
    const fm = `---\ntitle: "${(r.title || '').replace(/"/g, '\\"')}"\nsource: "${this.url}"\ncreated: ${moment().format('YYYY-MM-DD')}\n---\n`
    const f = await (this.app as any).vault.create(path, fm + htmlToMarkdown(r.content))
    new Notice(`Saved to ${f.path}`)
  }
  setZoom(z: number): void {
    this.zoom = z
    this.webview?.setZoomLevel?.(z)
  }
  async onClose(): Promise<void> {
    this.webview?.remove()
  }
}

export const webviewerPlugin: CorePluginDef = {
  id: 'webviewer',
  name: 'Web viewer',
  description: 'Open external links to web pages inside Quartz.',
  defaultOn: false,
  history: [] as any[],
  onEnable(app, p) {
    const o = p.instance.options as any
    if (o.openExternalURLs === undefined) o.openExternalURLs = true
    if (o.enableAdblocking === undefined) o.enableAdblocking = true
    p.registerView(VIEW_TYPE_WEBVIEWER, (leaf: any) => new WebViewerView(leaf))
    const active = (): WebViewerView | null => app.workspace.getActiveViewOfType(WebViewerView)
    const open = async (url = ''): Promise<void> => {
      const leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: VIEW_TYPE_WEBVIEWER, state: { url }, active: true })
    }
    p.instance.openUrl = open
    const pre = p.instance.name + ': '
    const act = (id: string, name: string, icon: string, fn: (v: WebViewerView) => void, needsView = true) =>
      p.registerGlobalCommand({
        id: 'webviewer:' + id,
        name: pre + name,
        icon,
        checkCallback: (c: boolean) => {
          const v = active()
          if (needsView && !v) return false
          if (!c) fn(v as WebViewerView)
          return true
        }
      })
    const plain = (id: string, name: string, icon: string | undefined, fn: () => void): void =>
      p.registerGlobalCommand({ id: 'webviewer:' + id, name: pre + name, ...(icon ? { icon } : {}), callback: fn })
    plain('open', 'Open web viewer', undefined, () => void open(o.homepage ?? ''))
    plain('open-history', 'Show history', 'lucide-clock', () => void open('quartz://history'))
    act('toggle-reader-mode', 'Toggle reader mode', 'glasses', v => void v.toggleReader())
    act('focus-address-bar', 'Focus address bar', 'text-cursor-input', v => v.addressEl.focus())
    act('zoom-in', 'Zoom in', 'zoom-in', v => v.setZoom(v.zoom + 0.5))
    act('zoom-reset', 'Reset zoom', 'rotate-cw', v => v.setZoom(0))
    act('zoom-out', 'Zoom out', 'zoom-in', v => v.setZoom(v.zoom - 0.5))
    plain('search', 'Search the web', 'search', () => void open(''))
    act('save-to-vault', 'Save to vault', 'lucide-file-down', v => void v.saveToVault())
    p.addRibbonIcon('lucide-globe', 'Open web viewer', () => void open(o.homepage ?? ''))
  }
}
