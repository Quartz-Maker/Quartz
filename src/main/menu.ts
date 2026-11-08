// Native application menu.
// The renderer sends extra top-level menus via `set-menu` ({template}); items may carry an
// `appCommand` (a command id run with `app.commands.executeCommandById` in that window) and
// `before: [id]` to position merged submenu items.
import { app, BrowserWindow, Menu, dialog, clipboard, type MenuItemConstructorOptions } from 'electron'

export interface MenuHooks {
  isMac: boolean
  isWin: boolean
  version: string
  openStarter: () => void
  openHelp: () => void
  focusedVaultWindow: () => BrowserWindow | null
}

const only = <T>(cond: boolean, f: () => T[]): T[] => (cond ? f() : [])

/** Plain mouse click (or accelerator without modifiers). */
function isPlainTrigger(e: { triggeredByAccelerator?: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return !e.triggeredByAccelerator || (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)
}

type Item = MenuItemConstructorOptions & { appCommand?: string; before?: string[]; submenu?: Item[] }

/** Merge items with the same id/label; submenu children honour `before`. */
export function mergeMenus(items: Item[]): Item[] {
  const out: Item[] = []
  for (const it of items) {
    const existing = out.find(o => (o.id && o.id === it.id) || o.label === it.label)
    if (existing && Array.isArray(existing.submenu) && Array.isArray(it.submenu)) {
      for (const child of it.submenu) {
        const idx = child.before ? existing.submenu.findIndex(k => k.id === child.before![0]) : -1
        if (child.before && idx !== -1) existing.submenu.splice(idx, 0, child)
        else existing.submenu.push(child)
      }
    } else if (!existing) out.push(it)
  }
  return out
}

export function buildAppMenu(template: Item[], isDefault: boolean, hooks: MenuHooks): Menu {
  const { isMac, isWin } = hooks
  const t = template.slice()
  const tail: Item[] = []
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i].label === '&Window' || t[i].label === '&Help') {
      tail.push(t[i])
      t.splice(i, 1)
    }
  }
  const wireAppCommands = (items: Item[]): void => {
    for (const o of items) {
      if (o.appCommand) {
        const cmd = o.appCommand
        o.id = cmd
        o.click = (_item, win, ev) => {
          let w = win instanceof BrowserWindow ? win : null
          if (!w) {
            w = hooks.focusedVaultWindow()
            if (w && w.isMinimized()) w.restore()
            else return
          }
          if (w && isPlainTrigger(ev)) {
            w.webContents.executeJavaScript(`app.commands.executeCommandById(${JSON.stringify(cmd)})`).catch(() => {})
          }
        }
        delete o.appCommand
      }
      if (Array.isArray(o.submenu)) wireAppCommands(o.submenu as Item[])
    }
  }
  const zoomBy = (win: unknown, delta: number | null): void => {
    if (win && win instanceof BrowserWindow) {
      const w = win as BrowserWindow & { setFrameZoomLevel?: (z: number) => void }
      const z = delta === null ? 0 : w.webContents.zoomLevel + delta
      if (w.setFrameZoomLevel) w.setFrameZoomLevel(z)
      else w.webContents.setZoomLevel(z)
    }
  }
  const items = mergeMenus([
    ...only<Item>(isMac, () => [
      {
        label: 'Quartz',
        submenu: [
          {
            label: 'About Quartz',
            async click(_i, win) {
              const detail = `Version ${hooks.version} (Installer ${app.getVersion()})`
              const opts = { message: 'Quartz', detail, type: 'info' as const, buttons: ['OK', 'Copy'], defaultId: 0, cancelId: 0 }
              const r = win instanceof BrowserWindow ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
              if (r.response === 1) clipboard.writeText(`About Quartz\n${detail}`)
            }
          },
          { type: 'separator' },
          { id: 'preferences-section', visible: false, label: '' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { label: 'Hide Quartz', click: () => app.hide(), accelerator: 'Cmd+H' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { label: 'Quit Quartz', click: () => app.quit(), accelerator: 'Cmd+Q' }
        ]
      }
    ]),
    {
      label: '&File',
      submenu: [
        { id: 'open-section', type: 'separator' },
        { id: 'open-vault', click: () => hooks.openStarter(), label: 'Open Vault...' },
        ...only<Item>(isMac || isWin, () => [{ role: 'recentDocuments', submenu: [{ label: 'Clear Recent', role: 'clearRecentDocuments' }] }]),
        { type: 'separator' },
        ...only<Item>(isDefault, () => [{ id: 'close-window', role: 'close' }]),
        ...only<Item>(!isMac, () => [{ type: 'separator' }, { id: 'quit', role: 'quit' }])
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { type: 'separator', id: 'undo-section' },
        { role: 'undo' },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click(_i, win, ev) {
            if (!(win instanceof BrowserWindow)) return
            if (isPlainTrigger(ev)) {
              const mod = isMac ? 'metaKey' : 'ctrlKey'
              win.webContents
                .executeJavaScript(
                  `activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 90, which: 90, code: 'KeyZ', key: 'z', ${mod}: true, shiftKey: true, bubbles: true, cancelable: true}));`
                )
                .catch(() => {})
            } else win.webContents.redo()
          }
        },
        { type: 'separator', id: 'copy-section' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle', accelerator: isMac ? 'Cmd+Shift+V' : 'Shift+CommandOrControl+V' },
        {
          label: 'Paste and Match Style',
          accelerator: isMac ? 'Cmd+Option+Shift+V' : 'Shift+CommandOrControl+Alt+V',
          click: (_i, win) => {
            if (win instanceof BrowserWindow) win.webContents.pasteAndMatchStyle()
          },
          visible: false
        },
        { role: 'delete' },
        { role: 'selectAll' },
        ...only<Item>(isMac, () => [
          { type: 'separator', id: 'speech-section' },
          {
            label: 'Substitutions',
            submenu: [{ role: 'showSubstitutions' }, { type: 'separator' }, { role: 'toggleSmartQuotes' }, { role: 'toggleSmartDashes' }, { role: 'toggleTextReplacement' }]
          },
          { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }
        ])
      ]
    },
    ...t,
    {
      label: '&View',
      submenu: [
        { id: 'actual-size', label: 'Actual Size', accelerator: 'CommandOrControl+0', click: (_i, w) => zoomBy(w, null) },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: (_i, w) => zoomBy(w, 0.5) },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: (_i, w) => zoomBy(w, -0.5) },
        { id: 'developer-section', type: 'separator' },
        { role: 'forceReload', accelerator: '' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: (_i, w) => {
            if (w instanceof BrowserWindow) w.webContents.toggleDevTools()
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Window',
      role: 'window',
      submenu: [
        { role: 'minimize', accelerator: isMac ? 'CommandOrControl+M' : '' },
        ...only<Item>(isMac, () => [{ role: 'zoom' }]),
        { type: 'separator' },
        { type: 'separator', id: 'tab-management' },
        {
          id: 'window-always-on-top',
          checked: false,
          enabled: false,
          type: 'checkbox',
          label: 'Always on Top',
          click: (_i, w) => {
            if (w instanceof BrowserWindow) w.setAlwaysOnTop(!w.isAlwaysOnTop())
          }
        },
        { role: 'front' }
      ]
    },
    {
      label: '&Help',
      role: 'help',
      submenu: [
        { label: 'Open Help', click: () => hooks.openHelp() },
        { type: 'separator', id: 'help-links' },
        // TODO(quartz): link Homepage/Community/Help Center here.
        { type: 'separator' }
      ]
    },
    ...tail
  ])
  wireAppCommands(items)
  return Menu.buildFromTemplate(items)
}

/** Set properties on a menu item by id. */
export function updateMenuItem(menu: Menu, id: string, state: Record<string, unknown>): void {
  const item = menu.getMenuItemById(id) as unknown as Record<string, unknown> | null
  if (item) for (const k in state) item[k] = state[k]
}

