/* eslint-disable @typescript-eslint/no-explicit-any */
// Small core plugins: zk-prefixer, random-note, word-count, editor-status, slash-command, and the
// app-level open-with-default-app commands.
import type { CorePluginDef } from '../app/InternalPlugins'
import { Menu, Notice, moment, setIcon, setTooltip, prepareFuzzySearch } from '../ui'
import { Keymap } from '../keymap/Keymap'
import { t } from '../settings/i18n'
import { MarkdownView } from '../views/markdown/MarkdownView'
import { EditorSuggest } from '../plugins/extras'
import { electron } from '../node'
import { expandTemplate } from './templates'

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`

export const zkPrefixerPlugin: CorePluginDef = {
  id: 'zk-prefixer',
  name: t('plugins.uniqueNoteCreator.name'),
  description: t('plugins.uniqueNoteCreator.desc'),
  defaultOn: false,
  onEnable(app, p) {
    const o = () => p.instance.options as { format?: string; folder?: string; template?: string }
    async function create(): Promise<any | null> {
      const folder = (o().folder ?? '').trim().replace(/^\/+|\/+$/g, '')
      const parent = folder ? app.vault.getAbstractFileByPath(folder) : app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '')
      if (!parent?.children) {
        new Notice(t('plugins.uniqueNoteCreator.msgFolderNotFound', { folderOption: folder }))
        return null
      }
      const base = moment().format(o().format || 'YYYYMMDDHHmm')
      const prefix = parent.path === '/' || parent.isRoot?.() ? '' : parent.path + '/'
      let content = ''
      const tpl = (o().template ?? '').trim()
      if (tpl) {
        const tf = app.vault.getAbstractFileByPath(/\.\w+$/.test(tpl) ? tpl : tpl + '.md')
        if (tf) {
          const to = app.internalPlugins.getEnabledPluginById('templates')?.options ?? {}
          content = expandTemplate(await app.vault.read(tf), { title: base }, to.dateFormat, to.timeFormat)
        }
      }
      const path = app.vault.getAvailablePath(prefix + base, 'md')
      return app.vault.create(path, content)
    }

    // quartz://unique?content=…&clipboard&append|prepend&silent&paneType=… ("unique" URI action)
    const uriAction = async (e: any): Promise<void> => {
      const file = await create()
      if (!file) return
      let content = e.content
      if (e.clipboard) content = await navigator.clipboard.readText()
      if (content) await app.fileManager.insertIntoFile(file, content, 'append')
      if (!e.silent) {
        const pt = e.paneType
        await app.workspace.getLeaf(pt === 'tab' || pt === 'window' || pt === 'split' ? pt : pt === 'true').openFile(file, { active: true, state: { mode: 'source' } })
      }
      app.workspace.protocolHandler.handleXCallback(e, file)
    }
    app.workspace.protocolHandler?.register('unique', uriAction)
    p.register(() => app.workspace.protocolHandler?.unregister('unique', uriAction))
    const pre = p.instance.name + ': '
    p.addRibbonIcon('box-glyph', t('plugins.uniqueNoteCreator.actionCreateNote'), evt => {
      void create().then(f => f && app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(f, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } }))
    })
    p.registerGlobalCommand({
      id: 'zk-prefixer',
      name: pre + t('plugins.uniqueNoteCreator.actionCreateNote'),
      icon: 'box-glyph',
      callback: () => void create().then(f => f && app.workspace.getLeaf(false).openFile(f, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } }))
    })
    p.registerGlobalCommand({
      id: 'insert-unique-link',
      name: pre + t('plugins.uniqueNoteCreator.actionAddLink'),
      icon: 'lucide-link',
      editorCallback: async (ed: any, view: any) => {
        const f = await create()
        if (f) ed.replaceSelection(app.fileManager.generateMarkdownLink(f, view?.file?.path ?? ''))
      }
    })
  }
}

export const randomNotePlugin: CorePluginDef = {
  id: 'random-note',
  name: t('plugins.randomNote.name'),
  description: t('plugins.randomNote.desc'),
  defaultOn: false,
  onEnable(app, p) {
    const open = (newLeaf: any): void => {
      const md = app.vault.getMarkdownFiles()
      if (md.length) void app.workspace.getLeaf(newLeaf).openFile(md[Math.floor(Math.random() * md.length)], { active: true })
    }
    p.addRibbonIcon('dice', t('plugins.randomNote.actionOpen'), evt => open(Keymap.isModEvent(evt)))
    p.registerGlobalCommand({ id: 'random-note', name: t('plugins.randomNote.actionOpen'), icon: 'dice-glyph', callback: () => open(false) })
  }
}

function countText(text: string): { words: number; chars: number } {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '')
  const cjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g
  const nCjk = (body.match(cjk) || []).length
  const words = (body.replace(cjk, ' ').match(/[0-9]+(?:[.,][0-9]+)*|[\p{L}\p{M}'’-]+/gu) || []).length + nCjk
  return { words, chars: body.length }
}

export const wordCountPlugin: CorePluginDef = {
  id: 'word-count',
  name: t('plugins.wordCount.name'),
  description: t('plugins.wordCount.desc'),
  defaultOn: true,
  onEnable(app, p) {
    const el = p.addStatusBarItem()
    const words = el.createSpan('status-bar-item-segment')
    const chars = el.createSpan('status-bar-item-segment')
    let timer: any = null
    const update = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const v = app.workspace.getActiveViewOfType(MarkdownView)
        if (!v) return el.hide()
        const sel = v.getMode() === 'source' ? v.editor.getSelection() : ''
        const c = countText(sel || v.getViewData())
        words.setText(plural(c.words, 'word', 'words'))
        chars.setText(plural(c.chars, 'character', 'characters'))
        el.show()
      }, 200)
    }
    for (const ev of ['active-leaf-change', 'editor-change', 'editor-selection-change', 'file-open']) p.registerEvent(app.workspace.on(ev, update))
    update()
  }
}

export const editorStatusPlugin: CorePluginDef = {
  id: 'editor-status',
  name: t('plugins.editorStatus.name'),
  description: t('plugins.editorStatus.desc'),
  defaultOn: true,
  hiddenFromList: true,
  onEnable(app, p) {
    const el = p.addStatusBarItem()
    el.addClass('mod-clickable')
    const iconEl = el.createSpan('status-bar-item-icon')
    const read = t('plugins.editorStatus.read')
    const src = t('plugins.editorStatus.editSource')
    const lp = t('plugins.editorStatus.editLivePreview')
    const update = (): void => {
      const v = app.workspace.getActiveViewOfType(MarkdownView)
      if (!v) return el.hide()
      el.show()
      const mode = v.getMode() === 'preview' ? ['lucide-book-open', read] : v.sourceMode ? ['lucide-code-2', src] : ['lucide-edit-3', lp]
      iconEl.empty()
      setIcon(iconEl, mode[0])
      setTooltip(el, mode[1], { placement: 'top' })
      el.setAttribute('aria-label', mode[1])
    }
    el.addEventListener('click', evt => {
      const v = app.workspace.getActiveViewOfType(MarkdownView)
      if (!v) return
      const m = new Menu()
      const set = (mode: string, source: boolean): void => void v.leaf.setViewState({ type: 'markdown', state: { ...v.getState(), mode, source } } as any)
      m.addItem(i => i.setTitle(read).setIcon('lucide-book-open').setChecked(v.getMode() === 'preview').onClick(() => set('preview', v.sourceMode)))
      // Order: Reading, Source mode, Live Preview.
      m.addItem(i => i.setTitle(src).setIcon('lucide-code-2').setChecked(v.getMode() === 'source' && v.sourceMode).onClick(() => set('source', true)))
      m.addItem(i => i.setTitle(lp).setIcon('lucide-edit-3').setChecked(v.getMode() === 'source' && !v.sourceMode).onClick(() => set('source', false)))
      m.showAtMouseEvent(evt)
    })
    for (const ev of ['active-leaf-change', 'layout-change', 'quartz:mode-change']) p.registerEvent(app.workspace.on(ev, update))
    update()
  }
}

class SlashSuggest extends EditorSuggest<any> {
  constructor(app: any) {
    super(app)
  }
  onTrigger(cursor: any, editor: any): any {
    const line: string = editor.getLine(cursor.line).slice(0, cursor.ch)
    const m = /(?:^|\s)\/([^\s/]*)$/.exec(line)
    if (!m) return null
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] }
  }
  getSuggestions(ctx: any): any[] {
    const cmds: any[] = Object.values(this.app.commands.commands).filter((c: any) => c.editorCallback || c.editorCheckCallback)
    const q = ctx.query
    const search = prepareFuzzySearch(q)
    return cmds
      .map(c => ({ c, m: q ? search(c.name) : { score: 0 } }))
      .filter(x => x.m)
      .sort((a, b) => (b.m as any).score - (a.m as any).score)
      .map(x => x.c)
      .slice(0, 50)
  }
  renderSuggestion(c: any, el: HTMLElement): void {
    el.addClass('mod-complex')
    el.createDiv('suggestion-content').createDiv('suggestion-title').setText(c.name)
  }
  selectSuggestion(c: any): void {
    const ctx: any = (this as any).context
    if (!ctx) return
    ctx.editor.replaceRange('', ctx.start, ctx.end)
    this.close()
    this.app.commands.executeCommandById(c.id)
  }
}

export const slashCommandPlugin: CorePluginDef = {
  id: 'slash-command',
  name: t('plugins.slashCommand.name'),
  description: t('plugins.slashCommand.desc'),
  defaultOn: false,
  onEnable(app, p) {
    const s = new SlashSuggest(app)
    app.workspace.editorSuggest.addSuggest(s)
    p.register(() => app.workspace.editorSuggest.removeSuggest(s))
  }
}

/** `open-with-default-app:open|show` (global commands, desktop). */
export function registerOpenWithDefaultApp(app: any): void {
  const act = (fn: (abs: string) => void) => (checking: boolean): boolean => {
    const f = app.workspace.getActiveFile()
    if (!f) return false
    if (!checking) fn(app.vault.adapter.getFullPath(f.path))
    return true
  }
  const e = (): any => electron()
  app.commands.addCommand({ id: 'open-with-default-app:open', name: 'Open in default app', icon: 'lucide-arrow-up-right', checkCallback: act(p => void e().shell.openPath(p)) })
  app.commands.addCommand({ id: 'open-with-default-app:show', name: 'Show in system explorer', icon: 'lucide-files', checkCallback: act(p => e().shell.showItemInFolder(p)) })
}
