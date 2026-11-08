// "Copy search results" modal. Options persist to `<configDir>/global-search.json`
// ({ showFullPath, linkStyle: none|wikilink|markdown, listStyle: none|-|*|num }) exactly like
// the global-search core plugin's data file.
import type { TFile } from 'obsidian'
import { createDropdownSetting, createToggleSettingWithValue } from './widgets'

export interface CopySearchOptions {
  showFullPath?: boolean
  linkStyle?: 'none' | 'wikilink' | 'markdown'
  listStyle?: 'none' | '-' | '*' | 'num'
}

const optionsByApp = new WeakMap<object, CopySearchOptions>()

function dataPath(app: any): string {
  return (app.vault?.configDir ?? '.quartz') + '/global-search.json'
}

/** Load the persisted options (cached per app). */
export async function loadCopyOptions(app: any): Promise<CopySearchOptions> {
  const hit = optionsByApp.get(app)
  if (hit) return hit
  let o: CopySearchOptions = {}
  try {
    const raw = await app.vault.adapter.read(dataPath(app))
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') o = parsed
  } catch {
    /* no data yet */
  }
  optionsByApp.set(app, o)
  return o
}

function saveCopyOptions(app: any, o: CopySearchOptions): void {
  optionsByApp.set(app, o)
  try {
    void app.vault?.adapter?.write?.(dataPath(app), JSON.stringify(o, null, 2))
  } catch {
    /* ignore */
  }
}

function shortName(f: TFile): string {
  const anyF = f as any
  if (typeof anyF.getShortName === 'function') return anyF.getShortName()
  return f.extension === 'md' ? f.basename : f.name
}

/** Format the result file list the way the modal does. */
export function formatSearchResults(files: TFile[], o: CopySearchOptions): string {
  return files
    .map((f, i) => {
      let s = o.showFullPath ? f.path : shortName(f)
      if (o.linkStyle === 'wikilink') s = `[[${s}]]`
      else if (o.linkStyle === 'markdown') s = `[${f.basename}](${s})`
      if (o.listStyle === '-') s = `- ${s}`
      else if (o.listStyle === '*') s = `* ${s}`
      else if (o.listStyle === 'num') s = `${i + 1}. ${s}`
      return s
    })
    .join('\n')
}

export class CopySearchResultsModal {
  containerEl: HTMLElement
  modalEl: HTMLElement
  titleEl: HTMLElement
  contentEl: HTMLElement
  private keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
    }
  }

  constructor(public app: any, public dom: { getFiles(): TFile[] }) {
    this.containerEl = createDiv('modal-container mod-dim')
    this.containerEl.createDiv('modal-bg').addEventListener('click', () => this.close())
    this.modalEl = this.containerEl.createDiv('modal')
    this.modalEl.createDiv('modal-close-button').addEventListener('click', () => this.close())
    const header = this.modalEl.createDiv('modal-header')
    this.titleEl = header.createDiv({ cls: 'modal-title', text: 'Copy search results' })
    this.contentEl = this.modalEl.createDiv('modal-content')
  }

  async open(): Promise<void> {
    const o = { ...(await loadCopyOptions(this.app)) }
    const wrap = this.contentEl.createDiv('copy-search-result-container')
    const textarea = wrap.createEl('textarea', 'copy-search-result-textarea')
    const update = (): void => {
      o.showFullPath = showPath.getValue()
      o.linkStyle = linkStyle.getValue() as CopySearchOptions['linkStyle']
      o.listStyle = listStyle.getValue() as CopySearchOptions['listStyle']
      textarea.value = formatSearchResults(this.dom.getFiles(), o)
      saveCopyOptions(this.app, { ...o })
      textarea.select()
    }
    const showPath = createToggleSettingWithValue(wrap, 'Show path', 'Display full path of the file rather than just the file name.', !!o.showFullPath, () => update())
    const linkStyle = createDropdownSetting(wrap, 'Link style', 'Optionally turn each file result in to a link.',
      [['none', 'None'], ['wikilink', 'Wikilink'], ['markdown', 'Markdown link']], o.linkStyle || 'none', () => update())
    const listStyle = createDropdownSetting(wrap, 'List prefix', 'Optionally add a list item prefix to each file result.',
      [['none', 'None'], ['-', 'Dash (-)'], ['*', 'Asterisk (*)'], ['num', 'Numbered']], o.listStyle || 'none', () => update())
    this.contentEl.createDiv('modal-button-container', (bc) => {
      bc.createEl('button', { text: 'Copy results', cls: 'mod-cta' }).addEventListener('click', () => {
        void navigator.clipboard?.writeText(textarea.value)
        if (typeof this.app.showNotice === 'function') this.app.showNotice('Results copied to your clipboard.')
      })
      bc.createEl('button', { text: 'Done' }).addEventListener('click', () => this.close())
    })
    document.body.appendChild(this.containerEl)
    document.addEventListener('keydown', this.keyHandler, true)
    update()
  }

  close(): void {
    document.removeEventListener('keydown', this.keyHandler, true)
    this.containerEl.detach()
  }
}
