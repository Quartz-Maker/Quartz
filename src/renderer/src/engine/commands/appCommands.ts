/* eslint-disable @typescript-eslint/no-explicit-any */
// Remaining command ids: workspace:export-pdf, editor:download-attachments, workspace:show-trash,
// app:toggle-ribbon / toggle-default-new-pane-mode / show-debug-info / open-sandbox-vault / open-file,
// theme:switch, and the mobile-only editor commands (registered, but dropped on desktop).
import type { Command } from './Commands'
import { getApp } from '../App'
import { electron } from '../node'
import { ConfirmationModal, FuzzySuggestModal, Notice, Platform } from '../ui'
import { MarkdownView } from '../views/markdown/MarkdownView'
import { canExportPdf } from '../pdf/exportPdf'
import { downloadAttachmentsForNote } from './downloadAttachments'
import { MISC, PDF } from '../pdf/strings'
import { FrontmatterMigrationModal } from '../app/frontmatterMigration'

const app = (): any => getApp()
const activeEditor = (): any => app()?.workspace?.activeEditor ?? null

class ThemeSwitcher extends FuzzySuggestModal<{ name: string; display: string }> {
  initialTheme: string
  private timer = 0
  constructor(a: any) {
    super(a)
    this.initialTheme = a.customCss?.theme ?? ''
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to use' },
      { command: 'esc', purpose: 'to dismiss' }
    ])
  }
  getItems(): { name: string; display: string }[] {
    const css = this.app.customCss
    const items = [{ name: '', display: 'Default' }]
    for (const n of Object.keys(css.themes ?? {})) items.push({ name: n, display: n })
    for (const n of css.oldThemes ?? []) if (!css.themes?.hasOwnProperty(n)) items.push({ name: n, display: n + ' (Legacy)' })
    return items
  }
  renderSuggestion(m: any, el: HTMLElement): void {
    super.renderSuggestion(m, el)
    if (m.item.name === this.initialTheme) el.createSpan({ cls: 'flair mod-pop', text: 'Active' })
  }
  getItemText(i: { display: string }): string {
    return i.display
  }
  onChooseItem(i: { name: string }): void {
    window.clearTimeout(this.timer)
    this.app.customCss.setTheme(i.name)
  }
  onSelectedChange(v: { name: string }, evt: any): void {
    if (evt && evt instanceof KeyboardEvent) {
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.isOpen && this.app.customCss.setTheme(v.name), 100)
    }
  }
  onEscapeKey(e: KeyboardEvent): void {
    super.onEscapeKey(e)
    window.clearTimeout(this.timer)
    this.app.customCss.setTheme(this.initialTheme)
  }
}

/** The "Show debug info" modal body (system/vault/theme/plugin summary). */
export function buildDebugInfo(a: any): string {
  const css = a.customCss ?? { themes: {}, snippets: [], enabledSnippets: new Set(), theme: '' }
  const theme = a.vault.getConfig('theme')
  let s = 'SYSTEM INFO:\n'
  s += `\tOperating system: ${navigator.platform} ${(navigator as any).userAgentData?.platform ?? ''}\n`
  s += `\tElectron version: ${(globalThis as any).process?.versions?.electron ?? ''}\n`
  s += `\tLive preview: ${a.vault.getConfig('livePreview') ? 'on' : 'off'}\n`
  s += `\tBase theme: ${theme === 'system' ? 'adapt to system' : theme === 'obsidian' ? 'dark' : 'light'}\n`
  const ct = css.theme || 'none'
  s += `\tCommunity theme: ${ct}${css.themes?.[ct]?.version ? ' ' + css.themes[ct].version : ''}\n`
  const snippets = (css.snippets ?? []).filter((x: string) => css.enabledSnippets?.has(x)).length
  s += `\tSnippets enabled: ${snippets}\n`
  const enabled = a.plugins?.isEnabled?.()
  s += `\tRestricted mode: ${enabled ? 'off' : 'on'}\n`
  if (enabled) {
    const man = Object.keys(a.plugins.manifests ?? {})
    const loaded = a.plugins.plugins ?? {}
    s += `\tPlugins installed: ${man.length}\n\tPlugins enabled: ${Object.keys(loaded).length}\n`
    let n = 1
    for (const id of Object.keys(loaded)) s += `\t\t${n++}: ${loaded[id].manifest.name} v${loaded[id].manifest.version}\n`
  }
  return s
}

class DebugInfoModal extends ConfirmationModal {
  constructor(a: any) {
    super(a)
    this.modalEl.addClass('mod-lg')
    this.titleEl.setText('Debug info')
    const ta = this.contentEl.createEl('textarea', { cls: 'debug-textarea' })
    ta.spellcheck = false
    ta.readOnly = true
    ta.value = buildDebugInfo(a)
    this.addButton(b => b.setSecondary().setButtonText('Copy to clipboard').onClick(() => {
      void navigator.clipboard.writeText(ta.value)
      new Notice('Debug info copied to your clipboard')
      return true
    }))
    if (Platform.isDesktopApp) this.addButton(b => b.setButtonText('Sandbox vault').onClick(() => (electron() as any).ipcRenderer.sendSync('sandbox')))
    this.addCancelButton('Done')
  }
}

export function getAppCommands(): Command[] {
  const cmds: Command[] = []
  const add = (c: Command): void => void cmds.push(c)

  add({
    id: 'editor:download-attachments',
    name: MISC.downloadAttachments,
    checkCallback: (checking: boolean) => {
      const f = app().workspace.getActiveFile()
      if (f && f.extension === 'md') {
        if (!checking) void downloadAttachmentsForNote(app(), f)
        return true
      }
    }
  } as Command)
  if (canExportPdf())
    add({
      id: 'workspace:export-pdf',
      name: PDF.command,
      checkCallback: (checking: boolean) => {
        const v = app().workspace.getActiveViewOfType(MarkdownView)
        if (v) {
          if (!checking) v.printToPdf()
          return true
        }
      }
    } as Command)
  add({ id: 'theme:switch', name: MISC.changeTheme, callback: () => new ThemeSwitcher(app()).open() })
  add({
    id: 'app:toggle-ribbon',
    name: MISC.toggleRibbon,
    checkCallback: (checking: boolean) => {
      if (Platform.isDesktop && (window as any).activeWindow === window) {
        if (!checking) app().vault.setConfig('showRibbon', !app().vault.getConfig('showRibbon'))
        return true
      }
      return false
    }
  })
  add({
    id: 'app:toggle-default-new-pane-mode',
    name: MISC.toggleDefaultMode,
    callback: () => {
      const v = app().vault
      const mode = v.getConfig('defaultViewMode')
      if (mode === 'source') {
        v.setConfig('defaultViewMode', 'preview')
        new Notice(MISC.switchedToRead)
      } else if (mode === 'preview') {
        v.setConfig('defaultViewMode', 'source')
        new Notice(MISC.switchedToEdit)
      }
    }
  })
  add({ id: 'app:migrate-frontmatter', name: 'Format converter: Frontmatter migration', icon: 'lucide-binary', callback: () => new FrontmatterMigrationModal(app()).open() })
  add({ id: 'app:show-debug-info', name: MISC.showDebugInfo, callback: () => new DebugInfoModal(app()).open() })
  if (Platform.isDesktopApp) {
    add({ id: 'app:open-sandbox-vault', name: MISC.openSandbox, callback: () => (electron() as any).ipcRenderer.sendSync('sandbox') })
    add({
      id: 'app:open-file',
      name: MISC.openFile,
      callback: () => ((window as any).activeWindow.electron ?? electron()).ipcRenderer.send('open-file', Object.keys(app().viewRegistry.typeByExtension))
    })
    add({
      id: 'workspace:show-trash',
      name: MISC.showTrash,
      checkCallback: (checking: boolean) => {
        if (app().vault.getConfig('trashOption') === 'local') {
          if (!checking) app().showInFolder?.('.trash')
          return true
        }
      }
    } as Command)
  }

  // Mobile-only: registered but dropped on desktop (`mobileOnly`), so the desktop list omits them.
  const ed = (id: string, name: string, icon: string, run: (e: any) => any, extra: Partial<Command> = {}): void =>
    add({ id, name, icon, mobileOnly: true, editorCallback: run, ...extra } as Command)
  ed('editor:undo', MISC.undo, 'lucide-undo-2', e => e.undo())
  ed('editor:redo', MISC.redo, 'lucide-redo-2', e => e.redo())
  ed('editor:move-caret-up', MISC.caretUp, 'lucide-chevron-up', e => e.exec('goUp'))
  ed('editor:move-caret-down', MISC.caretDown, 'lucide-chevron-down', e => e.exec('goDown'))
  ed('editor:move-caret-left', MISC.caretLeft, 'lucide-chevron-left', e => e.exec('goLeft'))
  ed('editor:move-caret-right', MISC.caretRight, 'lucide-chevron-right', e => e.exec('goRight'))
  ed('editor:go-start', MISC.firstLine, 'lucide-chevrons-up', e => e.exec('goStart'))
  ed('editor:go-end', MISC.lastLine, 'lucide-chevrons-down', e => e.exec('goEnd'))
  ed('editor:toggle-keyboard', 'Toggle keyboard', 'keyboard-toggle', e => (e.hasFocus() ? e.blur() : e.focus()))
  ed('editor:configure-toolbar', 'Configure mobile toolbar', 'lucide-wrench', () => {
    const s = app().setting
    s.open()
    s.openPagePath?.('interface', ['mobile-toolbar'])
  })
  ed('editor:cut', MISC.cut, 'lucide-scissors', async e => {
    await navigator.clipboard.writeText(e.getSelection())
    e.replaceSelection('')
  })
  ed('editor:copy', MISC.copy, 'lucide-copy', e => navigator.clipboard.writeText(e.getSelection()))
  ed('editor:paste', MISC.paste, 'lucide-clipboard-type', async e => e.replaceSelection(await navigator.clipboard.readText()))
  void activeEditor
  return cmds
}
