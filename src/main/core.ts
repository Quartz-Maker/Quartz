// Quartz main process — window model, vault registry, `app://` protocol, `quartz://` URIs,
// open-file and the IPC channels.
import {
  app,
  BrowserWindow,
  protocol,
  session,
  Menu,
  type WebContents
} from 'electron'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { loadRegistry, vaultIdByNameOrId } from './registry'
import { APP_SCHEME, APP_ORIGIN, createAppProtocolHandler, isAllowedAppRequest } from './resource'
import { URI_SCHEME, uriFromArgv, cleanArgv } from './uri'
import { buildAppMenu } from './menu'
import { isMac, isWin, type QWebContents, type CoreOptions, opts, userData, C, customIconPath, R, Y, starterWin, frameNative, defaultMenu, RESOURCE_PREFIX, pendingOpenUrl, pendingOpenFile, saveConfig, remoteMain, setRemoteMain, setC, setR, setCustomIconPath, setDefaultMenu, setDesktopDir, setDocumentsDir, setFrameNative, setIsQuitting, setOpts, setPageUrl, setPendingOpenFile, setPendingOpenUrl, setTitleBarStyle, setUserData } from './coreState'
import { menuHooks, vaultIdOfWindow, focusedVaultId, secureWebContents, showNativeContextMenu, openStarter } from './coreWindows'
import { reopenVaults, handleUri, handleOpenPath, openVaultPath } from './coreVaultOpen'
import { pruneOrphanPartitions, approveNetworkHost, registerIpc } from './coreIpc'
import { purgeStaleTempVaults } from './tempVaults'

/** Linux desktop entries pass `%U` arguments as `file://` URLs. */
const fromFileUrl = (a: string): string => {
  if (!a.startsWith('file://')) return a
  try {
    return fileURLToPath(a)
  } catch {
    return a
  }
}

// Re-exports: public API of the former single-file core.ts.
export { RESOURCE_PREFIX, getRegistry } from './coreState'
export type { CoreOptions } from './coreState'
export { openUrl, openVaultWindow, openStarter } from './coreWindows'
export { handleUri, handleOpenPath } from './coreVaultOpen'

// ─── boot ─────────────────────────────────────────────────────────────────────
/** Must run before `app.ready`. Returns false when another instance owns the lock. */
export function preReady(o: CoreOptions): boolean {
  setOpts(o)
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  try {
    setRemoteMain(createRequire(import.meta.url)('@electron/remote/main'))
    remoteMain!.initialize()
  } catch (e) {
    console.error('[@electron/remote] unavailable', e)
    setRemoteMain(null)
  }
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }
  ])
  setUserData(app.getPath('userData'))
  setDocumentsDir((() => {
    try {
      return app.getPath('documents')
    } catch {
      /* fallthrough */
    }
    try {
      const d = join(app.getPath('home'), 'Documents')
      if (existsSync(d)) return d
    } catch {
      /* fallthrough */
    }
    return userData
  })())
  setDesktopDir((() => {
    try {
      return app.getPath('desktop')
    } catch {
      /* fallthrough */
    }
    try {
      const d = join(app.getPath('home'), 'Desktop')
      if (existsSync(d)) return d
    } catch {
      /* fallthrough */
    }
    return userData
  })())
  const loaded = loadRegistry(userData)
  setC(loaded.config)
  setR(C.vaults)
  // custom app icon (Settings > Appearance > Custom app icon), applied to windows created from now on
  if (C.icon && existsSync(join(userData, C.icon))) setCustomIconPath(join(userData, C.icon))
  if (loaded.migrated) console.log('Migrated vaults.json → quartz.json')
  pruneOrphanPartitions()
  setFrameNative(C.frame === 'native')
  setTitleBarStyle(frameNative ? 'default' : 'hidden')
  if (C.disableGpu && !app.isReady()) {
    try {
      app.disableHardwareAcceleration()
      console.log('GPU Acceleration disabled.')
    } catch (e) {
      console.error(e)
    }
  }
  app.on('will-finish-launching', () => {
    app.once('open-url', (e, url) => {
      e.preventDefault()
      setPendingOpenUrl(url)
    })
    app.once('open-file', (e, p) => {
      e.preventDefault()
      setPendingOpenFile(p)
    })
  })
  app.on('second-instance', (_e, argv) => {
    const args = cleanArgv(argv, basename).map(fromFileUrl)
    console.log('Received command line', args)
    // Dispatch for non-TTY launches.
    if (args.length === 0) {
      openStarter()
      return
    }
    const last = args[args.length - 1]
    if (last.startsWith(URI_SCHEME + '://')) return handleUri(last)
    if (existsSync(last)) return handleOpenPath(last)
  })
  return true
}

export function onReady(): void {
  if (!opts.devServerUrl) setPageUrl(APP_ORIGIN + 'index.html')
  protocol.handle(APP_SCHEME, createAppProtocolHandler({ appRoot: opts.appRoot, resourcePrefix: RESOURCE_PREFIX, approveNetworkHost }))
  registerIpc()

  const devOrigins = opts.devServerUrl ? [new URL(opts.devServerUrl).origin] : []
  const wr = session.defaultSession.webRequest
  wr.onBeforeRequest({ urls: [APP_SCHEME + '://*/*'] }, (d, cb) => {
    const frame = d.frame
    let origin: string | undefined
    let isTop = false
    try {
      origin = frame ? frame.origin : undefined
      isTop = !!frame && frame === frame.top
    } catch {
      origin = undefined
    }
    cb({ cancel: !isAllowedAppRequest(origin, isTop, d.url, devOrigins) })
  })
  wr.onBeforeSendHeaders({ urls: ['https://*/*', 'http://*/*'] }, (d, cb) => {
    const h = d.requestHeaders
    if ((d.url.startsWith('https://www.youtube.com/embed/') || d.url.startsWith('https://www.youtube-nocookie.com/embed/')) && !h.Referer) h.Referer = 'md.quartz'
    cb({ requestHeaders: h })
  })
  // Let any site be embedded in an <iframe> (strip frame-blocking headers) and
  // keep third-party cookies of embedded frames working.
  wr.onHeadersReceived({ urls: ['https://*/*', 'http://*/*'] }, (d, cb) => {
    const headers = d.responseHeaders || {}
    let isSubFrame = d.resourceType === 'subFrame'
    try {
      if (!isSubFrame && d.webContents && d.frame) {
        const main = d.webContents.mainFrame
        const f = d.frame
        isSubFrame = main.framesInSubtree.filter(x => x !== main).some(x => x.routingId === f.routingId && x.processId === f.processId)
      }
    } catch {
      /* ignore */
    }
    for (const k in headers) {
      const lk = k.toLowerCase()
      if (lk === 'x-frame-options' || lk === 'cross-origin-opener-policy') delete headers[k]
      else if (lk === 'content-security-policy') headers[k] = headers[k].map(v => v.replace(/\s*frame-ancestors [^;]*(;|$)/g, ''))
      else if (lk === 'set-cookie' && isSubFrame) headers[k] = headers[k].map(v => (/Secure;/i.test(v) ? v.replace(/SameSite=Lax/i, 'SameSite=None') : v))
    }
    cb({ responseHeaders: headers })
  })
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const url = wc.getURL()
    let ok = url.startsWith(APP_ORIGIN) || devOrigins.some(o => url.startsWith(o + '/'))
    if (details.isMainFrame && details.requestingUrl === 'about:blank' && perm.startsWith('clipboard-')) ok = true
    if (perm === 'openExternal') ok = false
    else if (perm === 'fullscreen') ok = true
    if (!ok) console.log('Blocked permission request', url, perm, details)
    cb(ok)
  })

  setDefaultMenu(buildAppMenu([], true, menuHooks))
  Menu.setApplicationMenu(defaultMenu)
  if (isMac && app.dock) {
    try {
      app.dock.setIcon(customIconPath ?? opts.iconPath)
    } catch {
      /* ignore */
    }
  }
  app.setAboutPanelOptions({ applicationName: 'Quartz', applicationVersion: app.getVersion(), version: '' })

  app.on('web-contents-created', (_e, wc) => {
    secureWebContents(wc as QWebContents)
    ;(wc as QWebContents).noContextMenu = false
    if (wc.hostWebContents) {
      wc.on('context-menu', (_ev, params) => {
        if (!(wc as QWebContents).noContextMenu) showNativeContextMenu(BrowserWindow.fromWebContents(wc), wc, params)
      })
    }
  })
  app.on('open-file', (e, p) => {
    e.preventDefault()
    if (existsSync(p)) handleOpenPath(p)
  })
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
  app.on('before-quit', () => {
    setIsQuitting(true)
  })
  app.on('activate', () => {
    setIsQuitting(false)
    if (BrowserWindow.getAllWindows().length === 0) reopenVaults()
  })

  purgeStaleTempVaults()
  const argv = cleanArgv(process.argv, basename).map(fromFileUrl)
  const argUri = uriFromArgv(argv)
  if (argUri) setPendingOpenUrl(argUri)
  if (pendingOpenUrl) handleUri(pendingOpenUrl)
  else if (pendingOpenFile && existsSync(pendingOpenFile)) handleOpenPath(pendingOpenFile)
  else if (argv.length > 0 && argv.every(a => existsSync(a))) for (const a of argv) handleOpenPath(a)
  app.on('open-url', (e, url) => {
    e.preventDefault()
    handleUri(url)
  })
  if (!starterWin && Object.keys(Y).length === 0) reopenVaults()
  else {
    for (const id in R) if (!Y[id]) delete R[id].open
    saveConfig()
  }
  try {
    if (!app.isDefaultProtocolClient(URI_SCHEME)) app.setAsDefaultProtocolClient(URI_SCHEME)
  } catch (e) {
    console.error(e)
  }
}

// Exposed for the legacy quartzAPI handlers (ipc.ts).
export { vaultIdOfWindow, openVaultPath }
export const vaultPathOfSender = (wc: WebContents): string | null => {
  const id = vaultIdOfWindow(BrowserWindow.fromWebContents(wc))
  return id ? R[id].path : null
}
export { vaultIdByNameOrId }
