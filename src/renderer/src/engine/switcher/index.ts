/* eslint-disable @typescript-eslint/no-explicit-any */
// Quick switcher (core plugin `switcher`) and command palette (`command-palette`) as engine/ui
// SuggestModals with the standard prompt DOM (`.prompt > .prompt-input-container +
// .prompt-results > .suggestion-item.mod-complex > .suggestion-content + .suggestion-aux`).
import { SuggestModal } from '../ui/suggest'
import { prepareFuzzySearch, fuzzySearchPath, prepareQuery, fuzzySearch, sortSearchResults, renderResults, type SearchResult, type SearchMatches } from '../search/fuzzy'
import { Keymap } from '../keymap/Keymap'
import { Platform } from '../keymap/Platform'
import { printHotkey } from '../keymap'
import { setIcon } from '../ui/icons'
import type { Command } from '../commands/Commands'

// ---------------------------------------------------------------------------- quick switcher

type Row =
  | { type: 'file'; file: any; match: SearchResult | null }
  | { type: 'alias'; alias: string; file: any; match: SearchResult }
  | { type: 'unresolved'; linktext: string; match: SearchResult }

const ATTACHMENT_EXT = /^(png|jpe?g|gif|bmp|svg|webp|avif|mp3|wav|m4a|3gp|flac|ogg|oga|opus|mp4|webm|ogv|mov|mkv|pdf)$/i
const displayPath = (f: any): string => (f.extension === 'md' ? f.path.slice(0, -3) : f.path)

function completePath(text: string, matches: SearchMatches | undefined | null): string {
  if (matches && matches.length > 0) {
    const end = matches[matches.length - 1][1]
    const i = text.indexOf('/', end)
    if (i !== -1) return text.slice(0, i + 1)
  }
  return text
}

let switcherOpen: QuickSwitcherModal | null = null

export class QuickSwitcherModal extends SuggestModal<Row> {
  app: any
  /** Live options of the `switcher` core plugin instance (settings tab edits them in place). */
  get options(): { showExistingOnly: boolean; showAttachments: boolean; showAllFileTypes: boolean } {
    return this.app.internalPlugins?.getPluginById?.('switcher')?.instance?.options ?? { showExistingOnly: false, showAttachments: true, showAllFileTypes: false }
  }

  constructor(app: any) {
    super(app)
    this.app = app
    this.limit = 20
    this.emptyStateText = 'No recent files found. Type to search...'
    this.setPlaceholder('Find or create a note...')
    const mod = Platform.isMacOS ? '⌘' : 'ctrl'
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: `${mod} ↵`, purpose: 'to open in new tab' },
      { command: Platform.isMacOS ? '⌘ ⌥ ↵' : 'ctrl alt ↵', purpose: 'to open to the right' },
      { command: 'shift ↵', purpose: 'to create' },
      { command: 'esc', purpose: 'to dismiss' }
    ])
    const create = (evt: KeyboardEvent) => {
      if (evt.isComposing) return
      this.close()
      void this.createFromInput(evt)
      return false
    }
    this.scope.register(['Shift'], 'Enter', create)
    this.scope.register(['Mod', 'Shift'], 'Enter', create)
    this.scope.register(['Mod'], 'Enter', (evt: KeyboardEvent) => (this.selectActiveSuggestion(evt), false))
    this.scope.register(['Mod', 'Alt'], 'Enter', (evt: KeyboardEvent) => (this.selectActiveSuggestion(evt), false))
    this.scope.register([], 'Tab', (evt: KeyboardEvent) => {
      if (evt.isComposing) return
      const s = this.chooser.getSelectedValue()
      if (s) {
        const text = s.type === 'unresolved' ? s.linktext : displayPath(s.file)
        let next = completePath(text, s.match?.matches)
        if (next === this.inputEl.value) next += '/'
        this.inputEl.value = next
        this.updateSuggestions()
      }
      return false
    })
    // Enter with no selectable row (only the "Enter to create" placeholder) creates the note.
    const useSelected = this.chooser.useSelectedItem.bind(this.chooser)
    this.chooser.useSelectedItem = (evt: any) => {
      if (!this.chooser.getSelectedValue() && this.inputEl.value.trim()) {
        this.close()
        void this.createFromInput(evt)
        return true
      }
      return useSelected(evt)
    }
  }

  private shown(f: any): boolean {
    if (f.extension === 'md' || f.extension === 'canvas' || f.extension === 'base') return true
    if (this.options.showAllFileTypes) return true
    return this.options.showAttachments && ATTACHMENT_EXT.test(f.extension)
  }

  getSuggestions(raw: string): Row[] {
    const query = raw.trim()
    const vault = this.app.vault
    if (!query) {
      const out: Row[] = []
      for (const p of this.app.workspace.getLastOpenFiles().slice(0, 10)) {
        const f = vault.getFileByPath(p)
        if (f && this.shown(f)) out.push({ type: 'file', file: f, match: null })
      }
      return out
    }
    const search = prepareFuzzySearch(query)
    const rows: Row[] = []
    const mc = this.app.metadataCache
    for (const f of vault.getFiles()) {
      if (!this.shown(f)) continue
      const match = fuzzySearchPath(search, displayPath(f))
      if (match) {
        if (mc.isUserIgnored?.(f.path)) match.score -= 10
        rows.push({ type: 'file', file: f, match })
      }
      const fm = f.extension === 'md' ? mc.getFileCache(f)?.frontmatter : null
      const aliases = fm ? (fm.aliases) : undefined
      const list = Array.isArray(aliases) ? aliases : typeof aliases === 'string' ? aliases.split(',').map((s: string) => s.trim()) : []
      for (const a of list) {
        if (typeof a !== 'string' || !a) continue
        const m = search(a)
        if (m) rows.push({ type: 'alias', alias: a, file: f, match: m })
      }
    }
    if (!this.options.showExistingOnly) {
      const seen = new Set<string>()
      const unresolved = mc.unresolvedLinks || {}
      for (const src in unresolved)
        for (const link in unresolved[src]) {
          if (seen.has(link)) continue
          seen.add(link)
          const m = search(link)
          if (m) rows.push({ type: 'unresolved', linktext: link, match: m })
        }
    }
    sortSearchResults(rows as { match: SearchResult }[])
    return rows.slice(0, 20)
  }

  onNoSuggestion(): void {
    const q = this.inputEl.value.trim()
    if (!q) return super.onNoSuggestion()
    this.chooser.setSuggestions(null)
    const el = this.resultContainerEl.createDiv('suggestion-item mod-complex is-selected')
    el.createDiv('suggestion-content').createDiv({ cls: 'suggestion-title', text: q })
    el.createDiv('suggestion-aux').createSpan({ cls: 'suggestion-action', text: 'Enter to create' })
    el.addEventListener('click', evt => {
      this.close()
      void this.createFromInput(evt)
    })
  }

  renderSuggestion(row: Row, el: HTMLElement): void {
    el.addClass('mod-complex')
    const content = el.createDiv('suggestion-content')
    const title = content.createDiv('suggestion-title')
    const aux = el.createDiv('suggestion-aux')
    if (row.type === 'file') {
      renderResults(title, displayPath(row.file), row.match)
      aux.createSpan('suggestion-flair')
    } else if (row.type === 'alias') {
      renderResults(title, row.alias, row.match)
      content.createDiv({ cls: 'suggestion-note', text: displayPath(row.file) })
      const fl = aux.createSpan({ cls: 'suggestion-flair', attr: { 'aria-label': 'Alias' } })
      setIcon(fl, 'lucide-forward')
    } else {
      renderResults(title, row.linktext, row.match)
      const fl = aux.createSpan({ cls: 'suggestion-flair', attr: { 'aria-label': 'Not created yet, select to create' } })
      setIcon(fl, 'lucide-file-plus')
    }
  }

  onChooseSuggestion(row: Row, evt: MouseEvent | KeyboardEvent): void {
    const ws = this.app.workspace
    const mode = Keymap.isModEvent(evt)
    if (row.type === 'unresolved') void ws.openLinkText(row.linktext, ws.getActiveFile()?.path ?? '', mode)
    else void ws.getLeaf(mode).openFile(row.file, { active: true })
  }

  async createFromInput(evt: MouseEvent | KeyboardEvent): Promise<void> {
    const text = this.inputEl.value.trim()
    if (!text) return
    const ws = this.app.workspace
    await ws.openLinkText(text, ws.getActiveFile()?.path ?? '', Keymap.isModEvent(evt))
  }

  onOpen(): void {
    switcherOpen = this
    super.onOpen()
  }
  onClose(): void {
    if (switcherOpen === this) switcherOpen = null
  }
}

export function openQuickSwitcher(app: any): void {
  if (switcherOpen) return
  new QuickSwitcherModal(app).open()
}

// ---------------------------------------------------------------------------- command palette

interface Item {
  item: Command
  match: SearchResult
}
const collator = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true }).compare
function sortByOrder(list: Command[], order: string[]): void {
  const pos = new Map(order.map((id, i) => [id, i]))
  list.sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
}

let paletteOpen: CommandPaletteModal | null = null

export class CommandPaletteModal extends SuggestModal<Item> {
  app: any
  items: Command[] | null = null
  /** Pinned command ids: live `command-palette` core-plugin option (edited by its settings tab). */
  get pinned(): string[] {
    const v = this.app.internalPlugins?.getPluginById?.('command-palette')?.instance?.options?.pinned
    return Array.isArray(v) ? v : []
  }

  constructor(app: any) {
    super(app)
    this.app = app
    this.limit = 100
    this.emptyStateText = 'No commands found.'
    this.setPlaceholder('Select a command...')
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to use' },
      { command: 'esc', purpose: 'to dismiss' }
    ])
    this.scope.register(null as any, 'Tab', () => false)
  }

  private loadRecent(): string[] {
    const v = this.app.loadLocalStorage?.('recent-commands')
    return Array.isArray(v) ? v : []
  }

  private getCommands(): Command[] {
    if (this.items) return this.items
    let rest: Command[] = this.app.commands.listCommands()
    let head: Command[] = []
    if (this.pinned.length) {
      const set = new Set(this.pinned)
      head = rest.filter(c => set.has(c.id))
      rest = rest.filter(c => !set.has(c.id))
      sortByOrder(head, this.pinned)
    }
    rest.sort((a, b) => collator(a.name, b.name))
    sortByOrder(rest, this.loadRecent())
    return (this.items = head.concat(rest))
  }

  getSuggestions(query: string): Item[] {
    const q = prepareQuery(query.trim())
    const out: Item[] = []
    for (const item of this.getCommands()) {
      const match = fuzzySearch(q, item.name)
      if (match) out.push({ item, match })
    }
    for (const r of out) if (r.match.score > 0) r.match.score += r.item.name.length / 1e4
    sortSearchResults(out)
    return out
  }

  renderSuggestion({ item, match }: Item, el: HTMLElement): void {
    el.addClass('mod-complex')
    const title = el.createDiv('suggestion-content').createDiv('suggestion-title')
    const name = item.name
    const sep = name.indexOf(': ')
    if (sep !== -1) {
      renderResults(title.createSpan('suggestion-prefix'), name.slice(0, sep), match)
      renderResults(title.createSpan(), name.slice(sep + 2), match, -(sep + 2))
    } else renderResults(title.createSpan(), name, match)
    const aux = el.createDiv('suggestion-aux')
    const hm = this.app.hotkeyManager
    const keys = hm.getHotkeys(item.id) || hm.getDefaultHotkeys(item.id) || []
    for (const k of keys) aux.createEl('kbd', { cls: 'suggestion-hotkey', text: printHotkey(k) })
    if (this.pinned.includes(item.id)) setIcon(aux.createSpan('suggestion-flair'), 'lucide-pin')
  }

  onChooseSuggestion({ item }: Item, evt: MouseEvent | KeyboardEvent): void {
    this.app.commands.executeCommand(item, evt)
    const recent = this.loadRecent().filter(id => id !== item.id)
    recent.unshift(item.id)
    if (recent.length > 100) recent.length = 100
    this.app.saveLocalStorage?.('recent-commands', recent)
  }

  onOpen(): void {
    paletteOpen = this
    super.onOpen()
  }
  onClose(): void {
    if (paletteOpen === this) paletteOpen = null
  }
}

export function openCommandPalette(app: any): void {
  if (paletteOpen) return
  new CommandPaletteModal(app).open()
}
