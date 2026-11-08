// App-level commands (not owned by a core plugin or by the workspace model), targeting
// the real `window.app`: the active MarkdownView (`app.workspace.activeEditor`), vault config,
// settings. Workspace commands come from engine/workspace/commands.ts and plugin commands from
// the core plugins.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Command } from './Commands'
import { DEFAULT_HOTKEYS } from './defaultHotkeys'
import { useAppearanceStore } from '@/stores/appearance'
import { getApp } from '../App'
import { getEditorCommands } from '../editor/editorCommands'
import { getExtraCommands } from './extra'
import { getAppCommands } from './appCommands'

/** Shell UI actions (transitional React overlays). */
export interface BuiltinUiActions {
  openVaultSwitcher(): void
  openSettings?(): void
  openPluginManager(): void
  [k: string]: any
}

/** checkCallback helper: available when `cond()`; runs `run()` when not checking. */
const when = (cond: () => boolean, run: () => any) => (checking: boolean): boolean | void => {
  if (!cond()) return false
  if (!checking) run()
  return true
}

const app = (): any => getApp()
const markdownView = (): any => {
  const v = app()?.workspace?.activeLeaf?.view
  return v && v.getViewType?.() === 'markdown' ? v : null
}
const fileView = (): any => {
  const v = app()?.workspace?.getActiveFileView?.()
  return v && v.file ? v : null
}

export function getBuiltinCommands(ui: BuiltinUiActions): Command[] {
  const hk = (id: string) => (DEFAULT_HOTKEYS[id] ? { hotkeys: DEFAULT_HOTKEYS[id] } : {})
  const cmds: Command[] = []
  const add = (c: Command) => cmds.push({ ...hk(c.id), ...c })

  add({ id: 'editor:save-file', name: 'Save current file', checkCallback: when(() => !!fileView(), () => void fileView()?.save?.()) })
  add({ id: 'workspace:copy-path', name: 'Copy current file path from vault folder', icon: 'lucide-copy',
    checkCallback: when(() => !!fileView(), () => navigator.clipboard.writeText(fileView().file.path)) })
  add({ id: 'workspace:copy-full-path', name: 'Copy current file path from system root', icon: 'lucide-hard-drive',
    checkCallback: when(() => !!fileView(), () => navigator.clipboard.writeText(app().vault.adapter.getFullPath(fileView().file.path))) })
  add({ id: 'app:open-vault', name: 'Manage vaults', icon: 'vault', callback: () => ui.openVaultSwitcher() })
  add({ id: 'app:switch-vault', name: 'Change vault...', icon: 'vault', callback: () => ui.openVaultSwitcher() })
  add({ id: 'theme:toggle-light-dark', name: 'Toggle light/dark mode', callback: () => useAppearanceStore.getState().toggleTheme() })
  add({ id: 'app:open-settings', name: 'Open settings', icon: 'lucide-settings', callback: () => (ui.openSettings ? ui.openSettings() : app()?.setting?.open()) })
  add({ id: 'markdown:toggle-preview', name: 'Toggle reading view', icon: 'lucide-book-open',
    checkCallback: when(() => !!markdownView(), () => { const v = markdownView(); void v.setMode(v.getMode() === 'preview' ? 'source' : 'preview') }) })
  add({ id: 'app:reload', name: 'Reload app without saving', icon: 'lucide-rotate-ccw', callback: () => location.reload() })
  add({ id: 'editor:toggle-source', name: 'Toggle Live Preview/Source mode', icon: 'lucide-code-2',
    checkCallback: when(() => !!markdownView() && markdownView().getMode() === 'source', () => {
      const v = markdownView()
      void v.leaf.setViewState({ type: 'markdown', state: { ...v.getState(), source: !v.sourceMode } })
    }) })
  // Target: the active editor's or active view's own showSearch (markdown, bases, graph, pdf, ...).
  const searchable = (): any => {
    const a: any = app()
    const ed = a?.workspace?.activeEditor
    if (ed && typeof ed.showSearch === 'function') return ed
    const v = a?.workspace?.activeLeaf?.view
    return v && typeof v.showSearch === 'function' ? v : null
  }
  add({ id: 'editor:open-search', name: 'Search current file', icon: 'lucide-search',
    checkCallback: when(() => !!searchable(), () => searchable().showSearch(false)) })
  add({ id: 'editor:open-search-replace', name: 'Search & replace in current file', icon: 'lucide-search',
    checkCallback: when(() => !!markdownView() && markdownView().getMode() === 'source', () => markdownView().showSearch(true)) })
  // Editing commands (formatting, lists, folding, cursors) live with the editor.
  const folding = () => { const v: any = app()?.vault; return !!v && (v.getConfig('foldHeading') !== false || v.getConfig('foldIndent') !== false) }
  const viewOf = (e: any) => { const a = app()?.workspace?.activeEditor; return a && a.editor === e ? a : null }
  const attachFile = (e: any, capture: boolean) => {
    const view = viewOf(e)
    if (!view?.attachments) return
    const input = document.body.createEl('input', { type: 'file' })
    input.multiple = true
    input.style.cssText = 'position:fixed;opacity:0;z-index:-9999'
    if (capture) { input.setAttribute('capture', 'environment'); input.accept = 'image/*' }
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      void view.attachments.insertFiles(files.map(f => {
        const dot = f.name.lastIndexOf('.')
        return { name: dot > 0 ? f.name.slice(0, dot) : f.name, extension: dot > 0 ? f.name.slice(dot + 1).toLowerCase() : '', data: f.arrayBuffer() }
      }))
    })
    input.focus()
    input.click()
  }
  for (const c of getEditorCommands({ foldingEnabled: folding, activeEditor: () => app()?.workspace?.activeEditor ?? null, viewOf, attachFile })) add(c)
  // Quartz-only commands.
  return interleaveExtra(cmds, [...getExtraCommands(ui), ...getAppCommands()])
}

/** Insert the extra commands at their registration positions (hotkey order is observable): link/title/window
 * commands after `editor:save-file`, properties/help after `markdown:toggle-preview`, the rest last. */
function interleaveExtra(base: Command[], extra: Command[]): Command[] {
  const take = (ids: string[]) => ids.map(id => extra.find(c => c.id === id)!).filter(Boolean)
  const first = take(['editor:follow-link', 'editor:open-link-in-new-leaf', 'editor:open-link-in-new-window', 'editor:open-link-in-new-split', 'workspace:edit-file-title', 'workspace:close-window'])
  const second = take(['markdown:add-metadata-property', 'app:open-help'])
  const used = new Set([...first, ...second])
  const out: Command[] = []
  for (const c of base) {
    out.push(c)
    if (c.id === 'editor:save-file') out.push(...first)
    if (c.id === 'markdown:toggle-preview') out.push(...second)
  }
  return [...out, ...extra.filter(c => !used.has(c))]
}
