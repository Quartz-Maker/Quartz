// Embedded ```query``` code blocks (reading view): `.internal-query` header is built by the
// markdown renderer, which calls `host.renderQuery(el, query, sourcePath)` with the
// `.search-result-container`. Newlines become spaces; the host note's own ```query``` blocks
// are blanked before matching so the query doesn't match itself. Results stay live.
import type { TFile } from 'obsidian'
import { Component } from '../core/Component'
import { defaultHost, getMarkdownHost } from '../markdown/host'
import { SearchQuery } from './query'
import { SearchResultDom } from './ResultDom'
import { appSearchEnvironment, runSearch, SearchAppLike, SearchQueue } from './runner'

export class QuerySearchBlock extends Component {
  dom: SearchResultDom
  queue: SearchQueue
  searchQuery: SearchQuery | null = null
  constructor(public app: SearchAppLike, public containerEl: HTMLElement, public query: string, public sourcePath: string) {
    super()
    this.dom = new SearchResultDom(app as any, containerEl, 'No matches found.')
    this.dom.getCanvasCaches = appSearchEnvironment(app).getCanvasCaches!
    this.queue = new SearchQueue(app, this.dom)
    this.addChild(this.queue)
  }
  onload(): void {
    const { app, dom, sourcePath } = this
    dom.emptyResults()
    try {
      const sq = new SearchQuery(appSearchEnvironment(app), this.query.replace(/\r?\n/g, ' '), false)
      if (!sq.matcher) return
      this.searchQuery = sq
      const q = this.queue.start()
      void runSearch(app, sq.requiredInputs, q, (file: TFile, content: string) => {
        if (!this.containerEl.isConnected && this.wasConnected) {
          this.unload()
          return
        }
        if (this.containerEl.isConnected) this.wasConnected = true
        if (file.path === sourcePath) content = blankQueryBlocks(content)
        const r = sq.match(file, content)
        if (r) dom.addResult(file, r, content)
        else dom.removeResult(file)
      })
    } catch (e) {
      console.log(e)
    }
  }
  private wasConnected = false
  onResize(): void {
    this.dom.onResize()
  }
}

/** Replace every ```query block's characters (except newlines) with spaces. */
export function blankQueryBlocks(text: string): string {
  return text.replace(/```query([\s\S]*?)(```|$)/g, (m) => m.replace(/./g, ' '))
}

/** Create + load the live result list for an embedded query. */
export function renderQueryBlock(app: SearchAppLike, el: HTMLElement, query: string, sourcePath: string): QuerySearchBlock {
  const block = new QuerySearchBlock(app, el, query, sourcePath)
  block.load()
  return block
}

/**
 * Install the reading renderer hook (`host.renderQuery`). `getApp` supplies the current app
 * (vault + metadataCache [+ workspace for result clicks]) or null when no vault is open.
 */
export function installQueryBlockRenderer(getApp: () => SearchAppLike | null): void {
  const renderQuery = (el: HTMLElement, query: string, sourcePath: string): void => {
    const app = getApp()
    if (app) renderQueryBlock(app, el, query, sourcePath)
  }
  ;(defaultHost as any).renderQuery = renderQuery
  ;(getMarkdownHost() as any).renderQuery = renderQuery
}
