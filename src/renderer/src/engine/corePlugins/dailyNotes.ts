/* eslint-disable @typescript-eslint/no-explicit-any */
// Daily notes core plugin: options {format,folder,template}; open/create today's note;
// goto-prev/next among existing daily notes (strict moment parse of folder-relative basenames).
import type { CorePluginDef } from '../app/InternalPlugins'
import { Notice, moment } from '../ui'
import { t } from '../settings/i18n'
import { Keymap } from '../keymap/Keymap'
import { expandTemplate } from './templates'

export const DEFAULT_DAILY_FORMAT = 'YYYY-MM-DD'

export const dailyNotesPlugin: CorePluginDef = {
  id: 'daily-notes',
  name: t('plugins.dailyNotes.name'),
  description: t('plugins.dailyNotes.desc'),
  defaultOn: true,
  onEnable(app, p) {
    const o = () => p.instance.options as { format?: string; folder?: string; template?: string }
    const fmt = (): string => (o().format || DEFAULT_DAILY_FORMAT).trim() || DEFAULT_DAILY_FORMAT
    const folderPath = (): string => (o().folder ?? '').trim().replace(/^\/+|\/+$/g, '')

    const findByPath = (path: string): any => {
      const f = app.vault.getAbstractFileByPathInsensitive?.(path) ?? app.vault.getAbstractFileByPath(path)
      return f && !f.children ? f : null
    }

    async function getOrCreate(date: any): Promise<any | null> {
      const name = date.format(fmt()).trim()
      const folder = folderPath()
      let parent: any
      if (folder) {
        parent = app.vault.getAbstractFileByPath(folder)
        if (!parent || !parent.children) {
          new Notice(t('plugins.dailyNotes.msgFailFolder', { folderOption: o().folder ?? "" }))
          return null
        }
      } else parent = app.fileManager.getNewFileParent('')
      const prefix = parent.isRoot?.() || parent.path === '/' ? '' : parent.path + '/'
      const path = `${prefix}${name}.md`
      const existing = findByPath(path)
      if (existing) return existing
      let content = ''
      const tpl = (o().template ?? '').trim()
      if (tpl) {
        const tp = /\.\w+$/.test(tpl) ? tpl : tpl + '.md'
        const tf = app.metadataCache.getFirstLinkpathDest(tp, '') ?? app.vault.getAbstractFileByPath(tp)
        if (!tf) {
          new Notice(t('plugins.dailyNotes.msgFailTemplateFile', { template: tpl }))
          return null
        }
        const to = app.internalPlugins.getEnabledPluginById('templates')?.options ?? {}
        content = expandTemplate(await app.vault.read(tf), { title: name }, to.dateFormat, to.timeFormat)
      }
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (dir) await app.fileManager.getOrCreateFolder(dir)
      return app.vault.create(path, content)
    }

    async function open(newLeaf: any): Promise<void> {
      const f = await getOrCreate(moment())
      if (!f) return
      await app.workspace.getLeaf(newLeaf).openFile(f, { active: true, state: { mode: 'source' } })
    }
    p.instance.openDailyNote = open
    p.instance.getDailyNote = getOrCreate

    /** All existing daily notes as [moment, file], sorted ascending. */
    const dailyNotes = (): Array<[any, any]> => {
      const root = folderPath()
      const base = root ? app.vault.getAbstractFileByPath(root) : app.vault.getRoot()
      const out: Array<[any, any]> = []
      if (!base?.children) return out
      const strip = base.isRoot?.() ? 0 : base.path.length + 1
      const walk = (d: any): void => {
        for (const c of d.children) {
          if (c.children) walk(c)
          else if (c.extension === 'md') {
            const rel = c.path.slice(strip).replace(/\.md$/, '')
            const m = moment(rel, fmt(), true)
            if (m.isValid()) out.push([m, c])
          }
        }
      }
      walk(base)
      return out.sort((a, b) => a[0].valueOf() - b[0].valueOf())
    }
    const current = (file: any): any => {
      const f = file ?? null
      if (!f) return null
      return dailyNotes().find(([, d]) => d === f)?.[0] ?? null
    }
    const goto = (dir: 1 | -1) => (checking: boolean): boolean => {
      const file = app.workspace.getActiveFile()
      const cur = current(file)
      if (!cur) return false
      if (checking) return true
      const all = dailyNotes()
      const target = dir < 0 ? [...all].reverse().find(([m]) => m.valueOf() < cur.valueOf()) : all.find(([m]) => m.valueOf() > cur.valueOf())
      if (!target) new Notice(t(dir < 0 ? 'plugins.dailyNotes.msgNoPrevious' : 'plugins.dailyNotes.msgNoNext'))
      else void app.workspace.getLeaf(false).openFile(target[1], { active: true })
      return true
    }

    p.addRibbonIcon('lucide-calendar', t('plugins.dailyNotes.actionOpen'), evt => void open(Keymap.isModEvent(evt)))
    const pre = p.instance.name + ': '
    p.registerGlobalCommand({ id: 'daily-notes', name: pre + t('plugins.dailyNotes.actionOpen'), icon: 'lucide-calendar-days', callback: () => void open(false) })
    p.registerGlobalCommand({ id: 'daily-notes:goto-prev', name: pre + t('plugins.dailyNotes.actionOpenPrevious'), icon: 'lucide-calendar-minus', checkCallback: goto(-1) })
    p.registerGlobalCommand({ id: 'daily-notes:goto-next', name: pre + t('plugins.dailyNotes.actionOpenNext'), icon: 'lucide-calendar-plus', checkCallback: goto(1) })


    // quartz://daily?content=…&clipboard&append|prepend&silent&paneType=… ("daily" URI action)
    const uriAction = async (e: any): Promise<void> => {
      const file = await getOrCreate(moment())
      if (!file) return
      let content = e.content
      if (e.clipboard) content = await navigator.clipboard.readText()
      if (content) await app.fileManager.insertIntoFile(file, content, e.prepend ? 'prepend' : 'append')
      if (!e.silent) {
        const pt = e.paneType
        await app.workspace.getLeaf(pt === 'tab' || pt === 'window' || pt === 'split' ? pt : pt === 'true').openFile(file, { active: true, state: { mode: 'source' } })
      }
      app.workspace.protocolHandler.handleXCallback(e, file)
    }
    app.workspace.protocolHandler?.register('daily', uriAction)
    p.register(() => app.workspace.protocolHandler?.unregister('daily', uriAction))

    // Legacy `autorun` → app.json openBehavior:"daily"
    if ((p.instance.options as any).autorun) {
      app.vault.setConfig?.('openBehavior', 'daily')
      delete (p.instance.options as any).autorun
      void p.saveData(p.instance.options)
    }
    if (app.vault.getConfig?.('openBehavior') === 'daily')
      app.workspace.onLayoutReady(() => {
        if (!app.workspace.getActiveFile?.() || true) void open(false)
      })
  }
}
