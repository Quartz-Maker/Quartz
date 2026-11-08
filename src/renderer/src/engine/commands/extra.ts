// More command ids, backed by
// features Quartz already has: links under the cursor, properties editor, window zoom/always-on-top,
// font size, view toggles, linked panes (backlinks/outgoing/outline), file copy/delete, date/time insert.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Command } from './Commands'
import { getApp } from '../App'
import { linkAt } from '../editor/livepreview'
import { electron } from '../node'
import { Notice } from '../ui/Notice'
import { MoveFileModal } from '../views/file-explorer/MoveFileModal'
import { moment } from '../ui/moment'
import { ItemView } from '../view/View'

const app = (): any => getApp()
const when = (cond: () => boolean, run: () => any) => (checking: boolean): boolean | void => {
  if (!cond()) return false
  if (!checking) run()
  return true
}
const mdView = (): any => {
  const v = app()?.workspace?.activeLeaf?.view
  return v && v.getViewType?.() === 'markdown' ? v : null
}
const editableView = (): any => {
  const v = app()?.workspace?.getActiveFileView?.()
  return v && v.file && typeof v.saveTitle === 'function' ? v : null
}
const fileView = (): any => {
  const v = app()?.workspace?.getActiveFileView?.()
  return v && v.file ? v : null
}
const win = (): any => {
  try {
    return (electron() as any).remote?.getCurrentWindow?.() ?? (window as any).require?.('@electron/remote')?.getCurrentWindow()
  } catch {
    return null
  }
}
const webFrame = (): any => {
  try {
    return (electron() as any).webFrame
  } catch {
    return null
  }
}
const toggleConfig = (key: string) => () => {
  const v = app().vault
  v.setConfig(key, !v.getConfig(key))
}

/** Open the link under the cursor in the given pane type. */
function followLink(pane: boolean | string): () => void {
  return () => {
    const v = mdView()
    if (!v || v.getMode() !== 'source') return
    const link = linkAt(v.cm, v.cm.state.selection.main.head)
    if (!link) return
    if (link.external) window.open(link.target, '_blank')
    else void app().workspace.openLinkText(link.target, v.file?.path ?? '', pane as any)
  }
}
const hasLink = (): boolean => {
  const v = mdView()
  return !!v && v.getMode() === 'source' && !!linkAt(v.cm, v.cm.state.selection.main.head)
}
/** A pane linked to the current file (backlinks / outgoing links / outline for this note). */
function openLinked(type: string): () => void {
  return () => {
    const ws = app().workspace
    const source = ws.activeLeaf
    const file = ws.getActiveFile()
    if (!file || !source) return
    void ws.splitActiveLeaf('vertical').setViewState({ type, active: true, group: source, state: { file: file.path } })
  }
}
const focusDir = (dir: 'top' | 'bottom' | 'left' | 'right') => (checking: boolean) => {
  const ws = app().workspace
  const l = ws.activeLeaf
  const fn = ws.getAdjacentLeafInDirection ?? ws.getLeafInDirection
  if (!l || typeof fn !== 'function') return false
  const target = fn.call(ws, l, dir)
  if (!target) return false
  if (!checking) ws.setActiveLeaf(target, { focus: true })
  return true
}
const setFontSize = (delta: number) => () => {
  const v = app().vault
  const cur = Number(v.getConfig('baseFontSize')) || 16
  v.setConfig('baseFontSize', Math.min(30, Math.max(10, cur + delta)))
}
const zoom = (fn: (f: any) => void) => () => {
  const f = webFrame()
  if (f) fn(f)
}

export function getExtraCommands(ui: { openVaultSwitcher(): void }): Command[] {
  const cmds: Command[] = []
  const add = (c: Command) => cmds.push(c)

  // ---- links under the cursor
  add({ id: 'editor:follow-link', name: 'Follow link under cursor', icon: 'lucide-link', hotkeys: [{ modifiers: ['Alt'], key: 'Enter' }], checkCallback: when(hasLink, followLink(false)) })
  add({ id: 'editor:open-link-in-new-leaf', name: 'Open link under cursor in new tab', icon: 'lucide-link', hotkeys: [{ modifiers: ['Mod'], key: 'Enter' }], checkCallback: when(hasLink, followLink('tab')) })
  add({ id: 'editor:open-link-in-new-split', name: 'Open link under cursor to the right', icon: 'lucide-link', hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'Enter' }], checkCallback: when(hasLink, followLink('split')) })
  add({ id: 'editor:open-link-in-new-window', name: 'Open link under cursor in new window', icon: 'lucide-link', hotkeys: [{ modifiers: ['Mod', 'Alt', 'Shift'], key: 'Enter' }], checkCallback: when(hasLink, followLink('window')) })

  // ---- focus neighbouring tab groups
  add({ id: 'editor:focus-top', name: 'Focus on tab group above', checkCallback: focusDir('top') })
  add({ id: 'editor:focus-bottom', name: 'Focus on tab group below', checkCallback: focusDir('bottom') })
  add({ id: 'editor:focus-left', name: 'Focus on tab group to the left', checkCallback: focusDir('left') })
  add({ id: 'editor:focus-right', name: 'Focus on tab group to the right', checkCallback: focusDir('right') })
  // Target: the active markdown view, else the most recently active markdown leaf; focuses its editor.
  const lastMarkdown = (): any => {
    const ws = app()?.workspace
    const active = ws?.activeLeaf?.view
    if (active?.getViewType?.() === 'markdown') return active
    let best: any = null
    ws?.iterateAllLeaves?.((l: any) => {
      if (l.view?.getViewType?.() === 'markdown' && (!best || (best.activeTime ?? 0) < (l.activeTime ?? 0))) best = l
    })
    return best?.view ?? null
  }
  add({ id: 'editor:focus', name: 'Focus on last note', checkCallback: when(() => !!lastMarkdown(), () => lastMarkdown().editor.focus()) })

  // ---- editor / view toggles
  add({ id: 'editor:toggle-readable-line-length', name: 'Toggle readable line length', icon: 'lucide-ruler', callback: toggleConfig('readableLineLength') })
  add({ id: 'editor:toggle-line-numbers', name: 'Toggle line numbers', icon: 'lucide-list-ordered', callback: toggleConfig('showLineNumber') })
  add({ id: 'editor:toggle-spellcheck', name: 'Toggle spellcheck', callback: toggleConfig('spellcheck') })
  add({ id: 'app:increase-font-size', name: 'Increase font size', callback: setFontSize(1) })
  add({ id: 'app:decrease-font-size', name: 'Decrease font size', callback: setFontSize(-1) })
  add({ id: 'app:open-help', name: 'Open help', icon: 'question-mark-glyph', hotkeys: [{ modifiers: [], key: 'F1' }], callback: () => window.open('https://github.com/Quartz-Maker/Quartz', '_blank') })
  add({ id: 'app:open-another-vault', name: 'Open vault...', icon: 'vault', callback: () => ui.openVaultSwitcher() })

  // ---- window
  add({ id: 'window:zoom-in', name: 'Zoom in', callback: zoom(f => f.setZoomLevel(f.getZoomLevel() + 0.5)) })
  add({ id: 'window:zoom-out', name: 'Zoom out', callback: zoom(f => f.setZoomLevel(f.getZoomLevel() - 0.5)) })
  add({ id: 'window:reset-zoom', name: 'Reset zoom', callback: zoom(f => f.setZoomLevel(0)) })
  // Available in popout windows only, and not while maximized.
  const popoutWin = (): any => {
    const aw: any = (window as any).activeWindow
    if (!aw || aw === window) return null
    const w = aw.electronWindow
    return w && !w.isMaximized() ? w : null
  }
  add({ id: 'window:toggle-always-on-top', name: 'Toggle window always on top', checkCallback: when(() => !!popoutWin(), () => popoutWin().setAlwaysOnTop(!popoutWin().isAlwaysOnTop())) })
  add({
    id: 'workspace:new-window',
    name: 'New window',
    callback: () => {
      const ws = app().workspace
      const leaf = ws.openPopoutLeaf()
      ws.setActiveLeaf(leaf, { focus: true })
    }
  })
  add({
    id: 'workspace:open-in-new-window',
    name: 'Open current tab in new window',
    icon: 'lucide-maximize',
    checkCallback: when(
      () => app().workspace.activeLeaf?.view instanceof ItemView,
      () => {
        const l = app().workspace.activeLeaf
        void app().workspace.openPopoutLeaf().setViewState(l.getViewState(), { focus: true })
      }
    )
  })
  add({
    id: 'workspace:move-to-new-window',
    name: 'Move current tab to new window',
    icon: 'lucide-maximize',
    checkCallback: when(
      () => app().workspace.activeLeaf?.view instanceof ItemView,
      () => app().workspace.moveLeafToPopout(app().workspace.activeLeaf)
    )
  })
  add({ id: 'workspace:close-window', name: 'Close window', icon: 'lucide-x', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'W' }], callback: () => (window as any).activeWindow.close() })

  // ---- current file
  add({
    id: 'workspace:edit-file-title',
    name: 'Rename file',
    icon: 'lucide-edit-3',
    hotkeys: [{ modifiers: [], key: 'F2' }],
    // Available in any editable file view (markdown, canvas, bases, media, …).
    checkCallback: when(() => !!editableView(), () => editableView().leaf.setEphemeralState({ rename: 'all' }))
  })
  add({
    id: 'workspace:copy-url',
    name: 'Copy Quartz URL for current file',
    icon: 'lucide-vault',
    checkCallback: when(() => !!fileView(), () => app().copyObsidianUrl(fileView().file))
  })
  add({
    id: 'file-explorer:move-file',
    name: 'Move current file to another folder',
    icon: 'lucide-folder-tree',
    checkCallback: when(() => {
      const f = app().workspace.getActiveFile?.()
      return !!f && !(f.parent === undefined && f.path === '/')
    }, () => new MoveFileModal(app(), [app().workspace.getActiveFile()]).open())
  })
  add({ id: 'app:delete-file', name: 'Delete current file', icon: 'lucide-trash-2', checkCallback: when(() => !!fileView(), () => void app().fileManager.trashFile(fileView().file)) })
  add({
    id: 'file-explorer:duplicate-file',
    name: 'Make a copy of the current file',
    icon: 'lucide-files',
    checkCallback: when(() => !!fileView(), async () => {
      const a = app()
      const f = fileView().file
      const base = (f.parent?.path && f.parent.path !== '/' ? f.parent.path + '/' : '') + f.basename
      const p = a.vault.getAvailablePath(base, f.extension)
      const copy = await a.vault.copy(f, p)
      void a.workspace.getLeaf(false).openFile(copy)
    })
  })
  add({ id: 'file-explorer:new-folder', name: 'Files: Create new folder', icon: 'lucide-folder-plus', callback: async () => {
    const a = app()
    const parent = a.fileManager.getNewFileParent(a.workspace.getActiveFile()?.path ?? '')
    const p = a.vault.getAvailablePath((parent.path === '/' ? '' : parent.path + '/') + 'Untitled', '').replace(/\.$/, '')
    await a.vault.createFolder(p)
    const l = await a.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true, active: true })
    l?.view?.revealInFolder?.(a.vault.getAbstractFileByPath(p))
  } })
  add({ id: 'file-explorer:new-file-in-current-tab', name: 'Create new note in current tab', icon: 'lucide-file-plus', callback: async () => {
    const a = app()
    const parent = a.fileManager.getNewFileParent(a.workspace.getActiveFile()?.path ?? '')
    const f = await a.fileManager.createNewMarkdownFile(parent)
    void a.workspace.getLeaf(false).openFile(f, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } })
  } })
  add({ id: 'open-with-default-app:open', name: 'Open in default app', icon: 'lucide-arrow-up-right', checkCallback: when(() => !!fileView(), () => void (electron() as any).shell.openPath(app().vault.adapter.getFullPath(fileView().file.path))) })
  add({ id: 'open-with-default-app:show', name: 'Show in system explorer', icon: 'lucide-files', checkCallback: when(() => !!fileView(), () => (electron() as any).shell.showItemInFolder(app().vault.adapter.getFullPath(fileView().file.path))) })

  // ---- properties
  const editorOf = () => mdView()?.metadataEditor
  const showProps = () => {
    const v = mdView()
    if (!v) return
    // The editor only exists in the DOM once the note has properties; make it visible.
    v.metadataContainerEl.style.display = ''
  }
  add({
    id: 'markdown:add-metadata-property',
    name: 'Add file property',
    icon: 'lucide-plus-circle',
    hotkeys: [{ modifiers: ['Mod'], key: ';' }],
    checkCallback: when(() => !!editorOf(), () => {
      showProps()
      editorOf().addProperty('')
    })
  })
  add({
    id: 'markdown:add-alias',
    name: 'Add alias',
    icon: 'lucide-forward',
    checkCallback: when(() => !!editorOf(), () => {
      const ed = editorOf()
      showProps()
      const has = ed.properties.some((p: any) => p.key.toLowerCase() === 'aliases')
      if (!has) ed.addProperty('aliases')
      ed.rendered.find((r: any) => r.entry.key.toLowerCase() === 'aliases')?.focusValue('both')
    })
  })
  add({
    id: 'markdown:clear-metadata-properties',
    name: 'Clear file properties',
    icon: 'lucide-package-x',
    checkCallback: when(() => !!editorOf() && editorOf().properties.length > 0, () => editorOf().removeProperties(editorOf().rendered, false))
  })

  // ---- linked panes
  add({ id: 'backlink:open-backlinks', name: 'Backlinks: Open backlinks for the current note', icon: 'lucide-link', checkCallback: when(() => !!app().workspace.getActiveFile() && !!app().internalPlugins.getEnabledPluginById('backlink'), openLinked('backlink')) })
  add({ id: 'outgoing-links:open-for-current', name: 'Outgoing links: Open outgoing links for the current file', icon: 'lucide-link', checkCallback: when(() => !!app().workspace.getActiveFile() && !!app().internalPlugins.getEnabledPluginById('outgoing-link'), openLinked('outgoing-link')) })
  add({ id: 'outline:open-for-current', name: 'Outline: Open outline of the current file', icon: 'lucide-list', checkCallback: when(() => !!app().workspace.getActiveFile() && !!app().internalPlugins.getEnabledPluginById('outline'), openLinked('outline')) })

  // ---- templates: date / time
  const insert = (fmtKey: string, dflt: string) => () => {
    const v = mdView()
    if (!v || v.getMode() !== 'source') return
    const opts = app().internalPlugins.getEnabledPluginById('templates')?.options ?? {}
    v.editor.replaceSelection((moment as any)().format(opts[fmtKey] || dflt))
  }
  add({ id: 'insert-current-date', name: 'Templates: Insert current date', icon: 'lucide-calendar-days', editorCheckCallback: (c: boolean) => when(() => !!mdView() && mdView().getMode() === 'source', insert('dateFormat', 'YYYY-MM-DD'))(c) })
  add({ id: 'insert-current-time', name: 'Templates: Insert current time', icon: 'lucide-clock', editorCheckCallback: (c: boolean) => when(() => !!mdView() && mdView().getMode() === 'source', insert('timeFormat', 'HH:mm'))(c) })

  // Keep the relative registration order for the commands that carry default hotkeys.
  const ORDER = ['editor:follow-link', 'editor:open-link-in-new-leaf', 'editor:open-link-in-new-window', 'editor:open-link-in-new-split', 'workspace:edit-file-title', 'workspace:close-window', 'markdown:add-metadata-property', 'app:open-help']
  const slots = cmds.map((c, i) => (ORDER.includes(c.id) ? i : -1)).filter(i => i >= 0)
  const ordered = ORDER.map(id => cmds.find(c => c.id === id)!)
  slots.forEach((slot, i) => (cmds[slot] = ordered[i]))
  return cmds
}
