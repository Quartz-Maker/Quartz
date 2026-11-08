/* eslint-disable @typescript-eslint/no-explicit-any */
// Note composer core plugin: merge-file / split-file / extract-heading.
// Choosing a file appends the moved text (Shift+Enter prepends); Mod+Enter creates a new note from the typed name.
import type { CorePluginDef } from '../app/InternalPlugins'
import { Modal, SuggestModal, prepareFuzzySearch, sortSearchResults, Notice } from '../ui'
import { t } from '../settings/i18n'
import { expandTemplate } from './templates'

type Choice = { file: any } | { create: string }

class FilePickerModal extends SuggestModal<Choice> {
  constructor(app: any, private exclude: any, private onPick: (c: Choice, mode: 'append' | 'prepend') => void, instr: string[]) {
    super(app)
    this.setPlaceholder(t('plugins.noteComposer.promptSelectFileToMerge'))
    const k = (c: string, p: string): { command: string; purpose: string } => ({ command: c, purpose: p })
    this.setInstructions([
      k('↑↓', t('plugins.noteComposer.instructionNavigate')),
      k('↵', t('plugins.noteComposer.' + instr[0])),
      k('ctrl ↵', t('plugins.noteComposer.instructionCreateNew')),
      k('shift ↵', t('plugins.noteComposer.' + instr[1])),
      k('esc', t('plugins.noteComposer.instructionDismiss'))
    ])
    this.emptyStateText = t('plugins.noteComposer.labelNoFiles')
    this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
      const q = this.inputEl.value.trim()
      if (!q) return false
      this.close()
      this.onPick({ create: q }, 'append')
      e.preventDefault()
      return false
    })
    this.scope.register(['Shift'], 'Enter', (e: KeyboardEvent) => {
      const ch: any = (this as any).chooser
      const sel = ch?.values?.[ch.selectedItem]
      if (!sel) return false
      this.close()
      this.onPick(sel.item ?? sel, 'prepend')
      e.preventDefault()
      return false
    })
  }
  getSuggestions(q: string): Choice[] {
    const files = this.app.vault.getMarkdownFiles().filter((f: any) => f !== this.exclude)
    const s = prepareFuzzySearch(q)
    const out: any[] = []
    for (const f of files) {
      if (!q) out.push({ item: { file: f }, match: { score: 0, matches: [] } })
      else {
        const m = s(f.path.replace(/\.md$/, ''))
        if (m) out.push({ item: { file: f }, match: m })
      }
    }
    sortSearchResults(out)
    const res: Choice[] = out.map(r => r.item)
    if (q.trim() && !res.length) res.push({ create: q.trim() })
    return res
  }
  renderSuggestion(c: Choice, el: HTMLElement): void {
    el.addClass('mod-complex')
    const content = el.createDiv('suggestion-content')
    const aux = el.createDiv('suggestion-aux')
    if ('file' in c) content.createDiv('suggestion-title').setText(c.file.path.replace(/\.md$/, ''))
    else {
      content.createDiv('suggestion-title').setText(c.create)
      aux.createSpan('suggestion-flair').setText('Enter to create')
    }
    if ('file' in c) aux.createSpan('suggestion-flair')
  }
  onChooseSuggestion(c: Choice): void {
    this.onPick(c, 'append')
  }
}

export const noteComposerPlugin: CorePluginDef = {
  id: 'note-composer',
  name: t('plugins.noteComposer.name'),
  description: t('plugins.noteComposer.desc'),
  defaultOn: true,
  onEnable(app, p) {
    const o = () => p.instance.options as { replacementText?: string; template?: string; askBeforeMerging?: boolean }
    const pre = p.instance.name + ': '

    async function applyTemplate(content: string, from: any, newTitle: string): Promise<string | null> {
      const tpl = (o().template ?? '').trim()
      if (!tpl) return content
      const tp = /\.\w+$/.test(tpl) ? tpl : tpl + '.md'
      const tf = app.vault.getAbstractFileByPath(tp)
      if (!tf) {
        new Notice(t('plugins.noteComposer.msgFailToFetchTemplate', { template: tpl }))
        return null
      }
      const raw: string = await app.vault.read(tf)
      const hasContent = /{{content}}/i.test(raw)
      const out = expandTemplate(raw, { fromTitle: from.basename, newTitle }).replace(/{{content}}/gi, () => content)
      return hasContent ? out : out + '\n\n' + content
    }

    const join = (cur: string, add: string, mode: 'append' | 'prepend'): string =>
      !cur ? add : mode === 'prepend' ? add.replace(/\s+$/, '') + '\n\n' + cur.replace(/^\s+/, '') : cur.replace(/\s+$/, '') + '\n\n' + add

    async function moveText(text: string, from: any, c: Choice, mode: 'append' | 'prepend'): Promise<string | null> {
      let dest: any
      if ('create' in c) {
        const body = await applyTemplate(text, from, c.create)
        if (body === null) return null
        const parent = app.fileManager.getNewFileParent(from.path, c.create)
        dest = await app.fileManager.createNewMarkdownFile(parent, c.create, body)
      } else {
        dest = c.file
        const add = (await applyTemplate(text, from, dest.basename)) ?? text
        await app.vault.modify(dest, join(await app.vault.read(dest), add, mode))
      }
      const rt = o().replacementText ?? 'link'
      if (rt === 'none') return ''
      const link: string = app.fileManager.generateMarkdownLink(dest, from.path)
      return rt === 'embed' ? '!' + link.replace(/^!/, '') : link
    }

    function extract(editor: any, view: any, from: number, to: number, trim: boolean): void {
      let text: string = editor.getValue().slice(from, to)
      if (trim) text = text.replace(/\s+$/, '')
      const endAt = trim ? from + text.length : to
      new FilePickerModal(
        app,
        null,
        async (c, mode) => {
          const rep = await moveText(text, view.file, c, mode)
          if (rep === null) return
          editor.replaceRange(rep, editor.offsetToPos(from), editor.offsetToPos(endAt))
        },
        ['instructionAppend', 'instructionPrepend']
      ).open()
    }

    async function doMerge(f: any, c: Choice, mode: 'append' | 'prepend'): Promise<void> {
      const text: string = await app.vault.read(f)
      let dest: any
      if ('create' in c) {
        const parent = app.fileManager.getNewFileParent(f.path, c.create)
        dest = await app.fileManager.createNewMarkdownFile(parent, c.create, '')
      } else dest = c.file
      const body = (await applyTemplate(text, f, dest.basename)) ?? text
      await app.vault.modify(dest, join(await app.vault.read(dest), body, mode))
      await app.fileManager.trashFile(f)
      await app.workspace.getLeaf(false).openFile(dest, { active: true })
    }
    function mergeInto(f: any, c: Choice, mode: 'append' | 'prepend'): void {
      if (o().askBeforeMerging === false) return void doMerge(f, c, mode)
      const m = new Modal(app)
      m.titleEl.setText(t('plugins.noteComposer.labelMergeFile'))
      m.contentEl.createEl('p', {
        text: t('plugins.noteComposer.labelConfirmFileMerge', { file: f.basename, destination: 'file' in c ? c.file.basename : c.create })
      })
      const bc = m.modalEl.createDiv('modal-button-container')
      const label = bc.createEl('label', { cls: 'mod-checkbox' })
      const cb = label.createEl('input', { type: 'checkbox', attr: { tabindex: '-1' } })
      label.appendText("Don't ask again")
      bc.createEl('button', { cls: 'mod-destructive mod-cta', text: t('plugins.noteComposer.buttonMerge') }).addEventListener('click', () => {
        if (cb.checked) {
          o().askBeforeMerging = false
          void p.saveData(p.instance.options)
        }
        m.close()
        void doMerge(f, c, mode)
      })
      bc.createEl('button', { cls: 'mod-cancel', text: t('dialogue.buttonCancel') }).addEventListener('click', () => m.close())
      m.open()
    }

    // Registered after loading its options (async), i.e. after Bookmarks' handler: the
    // "Merge entire file with..." item therefore follows "Bookmark..." in file menus.
    app.workspace.onLayoutReady(() => p.registerEvent(
      app.workspace.on('file-menu', (menu: any, file: any, source: string) => {
        if (source === 'link-context-menu' || !file || file.extension !== 'md') return
        menu.addItem((i: any) =>
          i
            .setSection('action')
            .setTitle(t('plugins.noteComposer.actionMergeFile'))
            .setIcon('lucide-git-merge')
            .onClick(() => new FilePickerModal(app, file, (c, mode) => mergeInto(file, c, mode), ['instructionMerge', 'instructionMergeAtTop']).open())
        )
      })
    ))
    p.registerGlobalCommand({
      id: 'note-composer:merge-file',
      name: pre + t('plugins.noteComposer.commandMergeFile'),
      icon: 'lucide-git-merge',
      checkCallback: (checking: boolean) => {
        const f = app.workspace.getActiveFile()
        if (!f || f.extension !== 'md') return false
        if (!checking) new FilePickerModal(app, f, (c, mode) => mergeInto(f, c, mode), ['instructionMerge', 'instructionMergeAtTop']).open()
        return true
      }
    })
    p.registerGlobalCommand({
      id: 'note-composer:split-file',
      name: pre + t('plugins.noteComposer.commandSplitFile'),
      icon: 'lucide-scissors',
      editorCheckCallback: (checking: boolean, editor: any, view: any) => {
        if (!view?.file || !editor.somethingSelected()) return false
        if (!checking) {
          const a = editor.posToOffset(editor.getCursor('from'))
          const b = editor.posToOffset(editor.getCursor('to'))
          extract(editor, view, a, b, false)
        }
        return true
      }
    })
    p.registerGlobalCommand({
      id: 'note-composer:extract-heading',
      name: pre + t('plugins.noteComposer.commandExtractHeading'),
      icon: 'lucide-scissors',
      editorCheckCallback: (checking: boolean, editor: any, view: any) => {
        if (!view?.file) return false
        const hs: any[] = app.metadataCache.getFileCache(view.file)?.headings ?? []
        const line = editor.getCursor().line
        const i = hs.findIndex(h => h.position.start.line === line)
        if (i < 0) return false
        if (!checking) {
          const h = hs[i]
          const next = hs.slice(i + 1).find(x => x.level <= h.level)
          extract(editor, view, h.position.start.offset, next ? next.position.start.offset : editor.getValue().length, true)
        }
        return true
      }
    })
  }
}
