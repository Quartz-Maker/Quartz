// Quartz main process — link opening, window setup/security, vault/starter window creation (split out of core.ts).
import {
  app,
  BrowserWindow,
  shell,
  dialog,
  screen,
  session,
  Menu,
  type WebContents,
  type BrowserWindowConstructorOptions
} from 'electron'
import { promises as fsp } from 'fs'
import { extname } from 'path'
import { pathToFileURL } from 'url'
import { readJson, writeJson, vaultIdForPath, type WindowState } from './registry'
import { isNetworkPath, truncate, fileUrlToPath, WIN_EXECUTABLE_EXTS, UNIX_EXECUTABLE_EXTS } from './util'
import { APP_SCHEME, APP_ORIGIN } from './resource'
import { computeWindowBounds, parsePopupFeatures } from './bounds'
import { URI_SCHEME } from './uri'
import { updateMenuItem } from './menu'
import { S } from './strings'
import { isMac, isWin, type QWindow, type QWebContents, POLICY, opts, userData, C, customIconPath, R, Y, parentOf, isQuitting, starterWin, contextMenuClaimedBy, frameNative, titleBarStyle, defaultMenu, lastAppMenu, pageUrl, saveConfig, remoteMain, setContextMenuClaimedBy, setLastAppMenu, setStarterWin } from './coreState'
import { isTempVault, closeTempVault } from './tempVaults'

export function setVaultOpen(id: string, open: boolean): void {
  const v = R[id]
  if (!v) return
  if (open) v.open = true
  else delete v.open
  saveConfig()
}

export function rootWindow(w: BrowserWindow | null | undefined): BrowserWindow | null {
  if (!w) return null
  while (parentOf.has(w)) w = parentOf.get(w)!
  return w
}

/** Vault id owning a (possibly popout) window. */
export function vaultIdOfWindow(w: BrowserWindow | null | undefined): string | null {
  const r = rootWindow(w)
  for (const id in Y) if (Y[id] === r) return id
  return null
}

/** Most recently focused vault window's id. */
export function focusedVaultId(): string | null {
  let best: QWindow | null = null
  let bestId: string | null = null
  for (const id in Y) {
    const w = Y[id]
    if (w.isDestroyed()) continue
    if (!best || (w.focusTime ?? 0) > (best.focusTime ?? 0)) {
      best = w
      bestId = id
    }
  }
  return bestId
}

// ─── link opening ─────────────────────────────────────────────────────────────
export async function isExecutable(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p)
    if (st.isDirectory()) return false
    const ext = extname(p).toLowerCase()
    if (isWin) return WIN_EXECUTABLE_EXTS.includes(ext)
    if (UNIX_EXECUTABLE_EXTS.includes(ext)) return true
    if (!ext && (st.mode & 0o111) !== 0) {
      const fh = await fsp.open(p, 'r')
      const buf = Buffer.alloc(4)
      await fh.read(buf, 0, 4, 0)
      await fh.close()
      const hex = buf.toString('hex', 0, 4)
      if (buf.toString('ascii', 0, 2) === '#!' || hex === '7f454c46' || hex === 'cffaedfe' || hex === 'feedface') return true
    }
    return false
  } catch {
    return false
  }
}

export function openPathNative(p: string): void {
  if (!isWin && !isMac) shell.openExternal(pathToFileURL(p).href)
  else shell.openPath(p)
}

export async function openUrl(win: BrowserWindow | null, url: string, disposition?: string, frameName?: string): Promise<void> {
  const m = url.match(/^([a-z][a-z0-9+\-.]*):/i)
  const scheme = m ? m[1].toLowerCase() : ''
  if (!scheme || scheme === APP_SCHEME || scheme === 'about') return
  const filePath = scheme === 'file' ? fileUrlToPath(url) : ''
  if (!(filePath && vaultIdForPath(R, filePath)) && scheme !== 'http' && scheme !== 'https' && scheme !== URI_SCHEME && !(C.openSchemes && C.openSchemes[scheme])) {
    const box = {
      message: S.externalLinkMessage + '\n\nLink: ' + truncate(url, 200),
      type: 'warning' as const,
      buttons: [S.buttonOpenLink, S.buttonCancel],
      defaultId: 1,
      cancelId: 1,
      title: S.externalLinkTitle,
      checkboxLabel: S.externalLinkAlwaysOpen(scheme)
    }
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response !== 0) return
    if (scheme && r.checkboxChecked) {
      C.openSchemes = C.openSchemes || {}
      C.openSchemes[scheme] = true
      saveConfig()
    }
  }
  if (frameName !== '_external' && (scheme === 'http' || scheme === 'https') && win) {
    let leaf = 'tab'
    let active = false
    if (disposition === 'new-window') {
      leaf = 'window'
      active = true
    } else if (frameName === 'split') {
      leaf = 'split'
      active = true
    } else if (disposition === 'background-tab') {
      leaf = 'tab'
      active = false
    } else if (disposition === 'foreground-tab') {
      leaf = 'tab'
      active = true
    }
    const js = `(() => {let e = new CustomEvent('open-url', ${JSON.stringify({ cancelable: true, detail: { url, leaf, active } })}); window.dispatchEvent(e); return e.defaultPrevented;})()`
    try {
      if (await win.webContents.executeJavaScript(js)) return
    } catch {
      /* page gone */
    }
  }
  if (scheme !== 'file') {
    console.log('Opening URL: ' + url)
    shell.openExternal(url)
    return
  }
  if (isNetworkPath(filePath) || (isWin && !/^[a-z]:/i.test(filePath))) {
    const box = {
      message: S.remoteFileMessage + '\n\n' + S.remoteFileLocation(truncate(filePath, 200)),
      type: 'warning' as const,
      buttons: [S.buttonOpenFile, S.buttonCancel],
      defaultId: 1,
      cancelId: 1,
      title: S.remoteFileTitle
    }
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response !== 0) return
  }
  if (await isExecutable(filePath)) {
    const box = {
      message: S.executableFileMessage + '\n\n' + S.executableFileLocation(truncate(filePath, 200)),
      type: 'warning' as const,
      buttons: [S.buttonRunFile, S.buttonCancel],
      defaultId: 1,
      cancelId: 1,
      title: S.executableFileTitle
    }
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response !== 0) return
  }
  console.log('Opening file: ' + filePath)
  openPathNative(filePath)
}

// ─── window plumbing ──────────────────────────────────────────────────────────
export function enableRemote(wc: WebContents): void {
  if (!remoteMain) return
  try {
    remoteMain.enable(wc)
  } catch (e) {
    console.error(e)
  }
}

/** Zoom is applied through the page's webFrame and re-applied after reloads. */
export function installZoom(w: QWindow): void {
  const wc = w.webContents
  let level = wc.zoomLevel
  w.setFrameZoomLevel = (z: number) => {
    z = Math.max(-2.5, Math.min(3, z))
    level = z
    wc.executeJavaScript(`require('electron').webFrame.setZoomLevel(${z})`).catch(() => wc.setZoomLevel(z))
  }
  wc.on('did-finish-load', () => w.setFrameZoomLevel!(level))
}

export function menuFor(w: BrowserWindow | null): Menu {
  return (rootWindow(w) as QWindow | null)?.appMenu || defaultMenu
}

/** On macOS the application menu follows the focused window. */
export function refreshAppMenu(force = false): void {
  const w = BrowserWindow.getFocusedWindow()
  if (!w || !isMac) return
  const m = menuFor(w)
  if (!force && m === lastAppMenu) return
  setLastAppMenu(m)
  Menu.setApplicationMenu(m)
}

/** Per-window behaviour shared by vault windows and popouts. */
export function setupWindow(w: QWindow, isVaultWindow: boolean): void {
  const wc = w.webContents
  installZoom(w)
  secureWebContents(wc)
  enableRemote(wc)
  w.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') wc.executeJavaScript('history.back()').catch(() => {})
    else if (cmd === 'browser-forward') wc.executeJavaScript('history.forward()').catch(() => {})
  })
  w.on('swipe', (_e, dir) => {
    if (dir === 'left') wc.executeJavaScript('history.back()').catch(() => {})
    else if (dir === 'right') wc.executeJavaScript('history.forward()').catch(() => {})
  })
  w.on('focus', () => {
    w.focusTime = Date.now()
    refreshAppMenu()
    updateMenuItem(menuFor(w), 'window-always-on-top', { checked: w.isAlwaysOnTop(), enabled: !isVaultWindow })
  })
  w.on('always-on-top-changed', () => {
    if (w === BrowserWindow.getFocusedWindow()) updateMenuItem(menuFor(w), 'window-always-on-top', { checked: w.isAlwaysOnTop() })
  })
  w.on('maximize', () => {
    if (w.isAlwaysOnTop()) w.setAlwaysOnTop(false)
  })
  w.on('enter-full-screen', () => {
    if (w.isAlwaysOnTop()) w.setAlwaysOnTop(false)
  })
  w.on('leave-full-screen', () => {
    for (const child of w.getChildWindows()) {
      child.setParentWindow(null)
      child.setFullScreenable(true)
    }
  })
  const focusChange = (): void => {
    if (!wc.isDestroyed()) wc.executeJavaScript("window.dispatchEvent(new Event('focuschange'));").catch(() => {})
  }
  w.on('focus', focusChange)
  w.on('blur', focusChange)
  const fsChange = (): void => {
    if (!wc.isDestroyed()) wc.executeJavaScript("window.dispatchEvent(new Event('fullscreenchange'));").catch(() => {})
  }
  w.on('enter-full-screen', fsChange)
  w.on('leave-full-screen', fsChange)
}

export function popoutOptions(features: string, opener: WebContents): BrowserWindowConstructorOptions {
  const { rect, background, parented } = parsePopupFeatures(features)
  const parent = parented ? BrowserWindow.fromWebContents(opener) : null
  return {
    ...(parent ? { parent, fullscreen: false } : null),
    trafficLightPosition: { x: 19, y: 12 },
    autoHideMenuBar: true,
    frame: frameNative,
    titleBarStyle,
    ...windowBounds(rect),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      spellcheck: true,
      webviewTag: true,
      sandbox: false,
      devTools: POLICY.devTools
    },
    show: false,
    backgroundColor: background
  }
}

export function windowBounds(saved: { x?: number; y?: number; width?: number; height?: number }): ReturnType<typeof computeWindowBounds> {
  let primary: Electron.Rectangle | null = null
  let areas: Electron.Rectangle[] = []
  try {
    primary = screen.getPrimaryDisplay().workArea
  } catch {
    /* no screen */
  }
  try {
    areas = screen.getAllDisplays().map(d => d.workArea)
  } catch (e) {
    console.error(e)
  }
  return computeWindowBounds(saved, primary, areas)
}

export const isPageUrl = (u: string): boolean => u.indexOf(pageUrl) === 0 || (!!opts.devServerUrl && u.indexOf(opts.devServerUrl) === 0)
export const isAppUrl = (u: string): boolean => u.indexOf(APP_ORIGIN) === 0 || (!!opts.devServerUrl && u.indexOf(opts.devServerUrl) === 0)

/** Navigation lock, popouts, external links, webview hardening. */
export function secureWebContents(wc: QWebContents): void {
  if (wc.isSecured) return
  wc.isSecured = true
  if (!wc.hostWebContents) {
    wc.on('will-navigate', (e, url) => {
      if (!isPageUrl(url) && url !== 'about:blank') {
        e.preventDefault()
        if (!isAppUrl(url)) openUrl(BrowserWindow.fromWebContents(wc) || BrowserWindow.getFocusedWindow(), url)
      }
    })
  }
  wc.setWindowOpenHandler(details => {
    if (details.url === 'about:blank' && details.features && details.features.startsWith('popup')) {
      return { action: 'allow', overrideBrowserWindowOptions: popoutOptions(details.features, wc) }
    }
    try {
      openUrl(BrowserWindow.fromWebContents(wc), details.url, details.disposition, details.frameName)
    } catch (e) {
      console.error(e)
    }
    return { action: 'deny' }
  })
  wc.on('will-attach-webview', (_e, prefs) => {
    const p = prefs as Record<string, unknown>
    delete p.preload
    delete p.preloadURL
    p.sandbox = true
    p.nodeIntegration = false
    p.nodeIntegrationInWorker = false
    p.nodeIntegrationInSubFrames = false
    p.webSecurity = true
    p.plugins = false
    p.experimentalFeatures = false
    p.webviewTag = false
  })
  // One user-initiated foreground tab per navigation (blocks popup spam from web pages).
  let allowForeground = true
  wc.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url, disposition, frameName }) => {
      if (disposition === 'foreground-tab') {
        if (!allowForeground) return { action: 'deny' }
        allowForeground = false
      }
      if (/^https?:\/\//.test(url)) {
        try {
          openUrl(BrowserWindow.fromWebContents(guest), url, disposition, frameName)
        } catch (err) {
          console.error(err)
        }
      }
      return { action: 'deny' }
    })
    guest.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//.test(url)) e.preventDefault()
    })
    guest.on('will-frame-navigate', e => {
      if (!/^https?:\/\//.test(e.url)) e.preventDefault()
    })
    guest.on('will-attach-webview', e => e.preventDefault())
    guest.on('did-navigate', () => {
      allowForeground = true
    })
  })
}

/** Native context menu for editable fields / selections. */
export function showNativeContextMenu(win: BrowserWindow | null, wc: WebContents, params: Electron.ContextMenuParams): void {
  const { editFlags, misspelledWord, dictionarySuggestions } = params
  const sel = params.selectionText.trim()
  const hasSel = sel.length > 0
  const hasLink = !!params.linkURL
  const can = (k: 'Cut' | 'Copy'): boolean => !!(editFlags as unknown as Record<string, boolean>)[`can${k}`] && hasSel
  let show = params.isEditable || hasSel
  let items: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: `Look up “${sel.length <= 40 ? sel : sel.slice(0, 39).trim() + '…'}”`,
            visible: hasSel && !hasLink,
            click: () => wc.showDefinitionForSelection()
          },
          { type: 'separator' as const }
        ]
      : []),
    { accelerator: 'CmdOrCtrl+X', label: 'Cut', role: can('Cut') ? 'cut' : undefined, enabled: can('Cut'), visible: params.isEditable },
    { accelerator: 'CmdOrCtrl+C', label: 'Copy', role: can('Copy') ? 'copy' : undefined, enabled: can('Copy'), visible: params.isEditable || hasSel },
    { accelerator: 'CmdOrCtrl+V', label: 'Paste', role: editFlags.canPaste ? 'paste' : undefined, enabled: editFlags.canPaste, visible: params.isEditable },
    {
      accelerator: 'CmdOrCtrl+Shift+V',
      label: 'Paste as text',
      role: editFlags.canPaste ? 'pasteAndMatchStyle' : undefined,
      enabled: editFlags.canPaste,
      visible: params.isEditable
    }
  ]
  if (misspelledWord && misspelledWord.length >= 1) {
    const spell: Electron.MenuItemConstructorOptions[] = []
    if (dictionarySuggestions && dictionarySuggestions.length > 0) {
      for (const s of dictionarySuggestions.slice(0, 5)) spell.push({ label: s, click: () => wc.replaceMisspelling(s) })
    } else spell.push({ label: 'No suggestion', enabled: false })
    spell.push({
      label: 'Add to Dictionary',
      click: () => {
        wc.session.addWordToSpellCheckerDictionary(misspelledWord)
        wc.replaceMisspelling(misspelledWord)
      }
    })
    spell.push({ type: 'separator' })
    items = spell.concat(items)
    show = true
  }
  if (show) Menu.buildFromTemplate(items).popup(win ? { window: win } : {})
}

export function attachContextMenu(win: BrowserWindow, wc: WebContents): void {
  wc.on('context-menu', (_e, params) => {
    // The renderer claimed this context menu (sent `context-menu` just before): hand it
    // the spelling info so it can render its own menu.
    if (contextMenuClaimedBy !== null && contextMenuClaimedBy === wc.id) {
      setContextMenuClaimedBy(null)
      try {
        const { editFlags, misspelledWord, dictionarySuggestions } = params
        wc.send('context-menu', { editFlags, misspelledWord, dictionarySuggestions, webContentsId: wc.id })
        return
      } catch (err) {
        console.error(err)
      }
    }
    showNativeContextMenu(win, wc, params)
  })
}

export function loadPage(w: BrowserWindow): Promise<void> {
  return opts.devServerUrl ? w.loadURL(opts.devServerUrl) : w.loadURL(pageUrl)
}

/** Open (or focus) the window for a vault. */
export function openVaultWindow(id: string, focus = true): QWindow {
  if (Y[id]) {
    const existing = Y[id]
    if (focus) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
    return existing
  }
  const state = readJson<WindowState>(userData, id)
  const win: QWindow = new BrowserWindow({
    // width/height (default 800×600) come from windowBounds() below.
    minWidth: 200,
    minHeight: 150,
    backgroundColor: '#00000000',
    trafficLightPosition: { x: 19, y: 12 },
    show: false,
    frame: frameNative,
    titleBarStyle,
    icon: customIconPath ?? opts.iconPath,
    webPreferences: {
      // The preload exists for the legacy window.quartzAPI.
      preload: opts.preloadPath,
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      spellcheck: true,
      webviewTag: true,
      sandbox: false,
      devTools: POLICY.devTools
    },
    ...windowBounds(state)
  })
  Y[id] = win
  const wc = win.webContents
  let shown = false
  const onReady = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    if (state.isMaximized) win.maximize()
    if (state.devTools && POLICY.devTools) wc.openDevTools()
    win.show()
    const z = state.zoom
    if (z && typeof z === 'number') win.setFrameZoomLevel!(z)
  }
  win.menuBarVisible = false
  const isNormal = (): boolean => !win.isMaximized() && !win.isMinimized() && !win.isFullScreen()
  const capture = (): void => {
    try {
      const b = win.getBounds()
      if (isNormal()) {
        state.x = b.x
        state.y = b.y
        state.width = b.width
        state.height = b.height
      }
      state.isMaximized = win.isMaximized()
      state.devTools = wc.isDevToolsOpened()
      state.zoom = wc.zoomLevel
    } catch {
      /* destroyed */
    }
  }
  wc.on('did-finish-load', () => {
    win.loaded = true
  })
  setupWindow(win, true)
  attachContextMenu(win, wc)
  win.on('close', e => {
    win.closing = true
    capture()
    if (!isTempVault(id)) writeJson(userData, id, state)
    setTimeout(() => {
      if (!e.defaultPrevented && !win.isDestroyed()) win.destroy()
    }, 3000)
  })
  win.on('closed', () => {
    delete Y[id]
    // The last vault window closed without a starter keeps its `open` flag, so it is
    // reopened on next launch.
    if (isTempVault(id)) closeTempVault(id)
    else if (!isQuitting && (starterWin || Object.keys(Y).length > 0)) setVaultOpen(id, false)
  })
  let debounce: ReturnType<typeof setTimeout> | undefined
  const scheduleCapture = (): void => {
    clearTimeout(debounce)
    debounce = setTimeout(capture, 100)
  }
  win.on('resize', scheduleCapture)
  win.on('move', scheduleCapture)
  win.on('ready-to-show', onReady)
  wc.on('did-create-window', child => {
    parentOf.set(child, win)
    setupWindow(child as QWindow, false)
    attachContextMenu(child, child.webContents)
  })
  loadPage(win).then(onReady, onReady)
  setVaultOpen(id, true)
  return win
}

/** Fixed-size utility window (starter/help). */
export function createUtilityWindow(extra: BrowserWindowConstructorOptions): QWindow {
  const w: QWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: frameNative,
    titleBarStyle,
    backgroundColor: '#1e1e1e',
    icon: customIconPath ?? opts.iconPath,
    webPreferences: { preload: opts.preloadPath, contextIsolation: false, nodeIntegration: true, sandbox: false, devTools: POLICY.devTools },
    ...extra
  })
  installZoom(w)
  enableRemote(w.webContents)
  secureWebContents(w.webContents)
  attachContextMenu(w, w.webContents)
  w.menuBarVisible = false
  w.on('focus', () => refreshAppMenu())
  return w
}

/** The starter (vault picker) window, 800×650, single instance. */
export function openStarter(): void {
  if (starterWin) {
    if (starterWin.isMinimized()) starterWin.restore()
    starterWin.focus()
    return
  }
  const w = createUtilityWindow({ width: 800, height: 650 })
  setStarterWin(w)
  w.on('closed', () => {
    setStarterWin(null)
  })
  const show = (): void => {
    if (!w.isDestroyed()) w.show()
  }
  // Quartz renders its React VaultPicker from the
  // same page when the window has no vault (`vault` IPC returns {}).
  loadPage(w).then(show, show)
}

export const menuHooks = {
  isMac,
  isWin,
  get version(): string {
    return opts.version
  },
  openStarter: () => openStarter(),
  openHelp: () => openStarter(),
  focusedVaultWindow: (): BrowserWindow | null => {
    const id = focusedVaultId()
    return id ? Y[id] : null
  }
}
