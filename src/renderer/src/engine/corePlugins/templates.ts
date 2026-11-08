/* eslint-disable @typescript-eslint/no-explicit-any */
// Templates core plugin: options {folder,dateFormat,timeFormat}, `{{title}}`/`{{date}}`/`{{time}}`
// expansion (case-insensitive, one moment() snapshot), insert at cursor, insert-current-date/time.
import type { CorePluginDef } from '../app/InternalPlugins'
import { FuzzySuggestModal, Notice, moment } from '../ui'
import { t } from '../settings/i18n'
import { normalizePath } from '../vault/path'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Template variable expansion. */
export function expandTemplate(text: string, vars: Record<string, string>, dateFmt = 'YYYY-MM-DD', timeFmt = 'HH:mm'): string {
  for (const k of Object.keys(vars)) text = text.replace(new RegExp(`{{${esc(k)}}}`, 'gi'), () => vars[k])
  const now = moment()
  return text.replace(/{{(date|time)(?::(.*?))?}}/gi, (_m, kind: string, fmt?: string) =>
    now.format(fmt || (kind.toLowerCase() === 'date' ? dateFmt : timeFmt))
  )
}

class TemplateSuggestModal extends FuzzySuggestModal<any> {
  constructor(app: any, private files: any[], private prefix: string, private pick: (f: any) => void) {
    super(app)
    this.setPlaceholder(t('plugins.templates.promptTypeTemplate'))
    this.setInstructions([
      { command: '↑↓', purpose: t('plugins.templates.instructionNavigate') },
      { command: '↵', purpose: t('plugins.templates.instructionInsert') },
      { command: 'esc', purpose: t('plugins.templates.instructionDismiss') }
    ])
    this.emptyStateText = t('plugins.templates.msgNoTemplatesFound')
  }
  getItems(): any[] {
    return this.files
  }
  getItemText(f: any): string {
    return f.path.slice(this.prefix.length).replace(/\.md$/, '')
  }
  onChooseItem(f: any): void {
    this.pick(f)
  }
}

export const templatesPlugin: CorePluginDef = {
  id: 'templates',
  name: t('plugins.templates.name'),
  description: t('plugins.templates.desc'),
  defaultOn: true,
  onEnable(app, p) {
    const o = () => p.instance.options as { folder?: string; dateFormat?: string; timeFormat?: string }
    const listTemplates = (): { files: any[]; prefix: string } | null => {
      const folder = (o().folder ?? '').trim()
      if (!folder) return void new Notice(t('plugins.templates.msgNoFolderSet')), null
      const norm = normalizePath(folder)
      if (norm === '/' ) return void new Notice(t('plugins.templates.msgFailInvalidFolder')), null
      const f = app.vault.getAbstractFileByPath(norm)
      if (!f || !f.children) return void new Notice(t('plugins.templates.msgFailFolderNotFound', { folderOption: folder })), null
      const files: any[] = []
      const walk = (d: any): void => {
        for (const c of d.children) c.children ? walk(c) : c.extension === 'md' && files.push(c)
      }
      walk(f)
      files.sort((a, b) => a.path.localeCompare(b.path))
      return { files, prefix: f.path + '/' }
    }
    const insert = async (tfile: any, editor: any, view: any): Promise<void> => {
      const raw = await app.vault.cachedRead(tfile)
      const title = view?.file?.basename ?? ''
      const text = expandTemplate(raw, { title }, o().dateFormat, o().timeFormat)
      const cur = editor.getCursor('from')
      if (cur.line === 0 && cur.ch === 0 && !editor.getSelection()) {
        editor.replaceSelection(text)
        return
      }
      const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
      if (!m || !view?.file) return editor.replaceSelection(text)
      let props: any
      try {
        props = (window as any).__quartz?.parseYaml?.(m[1]) ?? {}
      } catch {
        return void new Notice(t('plugins.templates.msgFailInvalidTemplateProperties'))
      }
      editor.replaceSelection(text.slice(m[0].length))
      if (props && typeof props === 'object')
        await app.fileManager.processFrontMatter(view.file, (fm: any) => {
          for (const k of Object.keys(props)) {
            const v = props[k]
            if (Array.isArray(v) && Array.isArray(fm[k])) fm[k] = Array.from(new Set([...fm[k], ...v]))
            else if (!(k in fm) || fm[k] == null || fm[k] === '') fm[k] = v
          }
        })
    }
    const openInsert = (): void => {
      const view = app.workspace.activeEditor ?? app.workspace.getActiveViewOfType((window as any).__quartz?.MarkdownView)
      const ed = view?.editor
      if (!ed) return
      const l = listTemplates()
      if (!l) return
      new TemplateSuggestModal(app, l.files, l.prefix, f => void insert(f, ed, view)).open()
    }
    p.addRibbonIcon('lucide-files', t('plugins.templates.actionInsert'), openInsert)
    p.registerGlobalCommand({ id: 'insert-template', name: `${p.instance.name}: ${t('plugins.templates.actionInsert')}`, icon: 'lucide-copy', callback: openInsert })
    const asGlobal = (id: string, name: string, icon: string, fmt: () => string): void =>
      p.registerGlobalCommand({
        id,
        name: `${p.instance.name}: ${name}`,
        icon,
        editorCallback: (ed: any) => ed.replaceSelection(moment().format(fmt()))
      })
    asGlobal('insert-current-date', t('plugins.templates.actionInsertCurrentDate'), 'lucide-calendar-days', () => o().dateFormat || 'YYYY-MM-DD')
    asGlobal('insert-current-time', t('plugins.templates.actionInsertCurrentTime'), 'lucide-clock', () => o().timeFormat || 'HH:mm')
  }
}
