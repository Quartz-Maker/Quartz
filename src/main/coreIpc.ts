// Quartz main process — IPC channels, partition pruning, host approval (split out of core.ts).
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  session,
  net,
  type IpcMainEvent
} from 'electron'
import {
  existsSync,
  promises as fsp,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync
} from 'fs'
import { join, resolve } from 'path'
import { removeJson } from './registry'
import { buildAppMenu, updateMenuItem } from './menu'
import { S } from './strings'
import { isMac, type QWindow, POLICY, BROWSER_SESSION_PERMISSIONS, opts, userData, documentsDir, desktopDir, C, R, Y, isQuitting, defaultMenu, RESOURCE_PREFIX, approvedHosts, pendingHostApprovals, browserSessions, saveConfig, setContextMenuClaimedBy, setIsQuitting, tempConfigDirs } from './coreState'
import { menuHooks, vaultIdOfWindow, openPathNative, openUrl, menuFor, refreshAppMenu, openVaultWindow, openStarter } from './coreWindows'
import { sendAction, openFileInVault, openVaultPath } from './coreVaultOpen'

/** Remove orphaned `Partitions/vault-<id>` session folders. */
export async function pruneOrphanPartitions(): Promise<void> {
  const dir = join(userData, 'Partitions')
  try {
    for (const name of await fsp.readdir(dir)) {
      const id = name.replace(/^vault-/, '')
      if (!R[id]) await removePartition(id)
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('ERROR: ' + e)
  }
}
export function removePartition(id: string): Promise<void> {
  console.log('Removing partition for vault ' + id)
  return fsp.rm(join(userData, 'Partitions', `vault-${id}`), { recursive: true, force: true })
}

export function approveNetworkHost(host: string): Promise<boolean> {
  if (approvedHosts.has(host)) return Promise.resolve(true)
  let p = pendingHostApprovals.get(host)
  if (p) return p
  p = (async () => {
    try {
      const r = await dialog.showMessageBox({
        title: S.networkDriveTitle,
        message: S.networkDriveMessage,
        detail: S.networkDriveHost(host),
        type: 'warning',
        buttons: [S.buttonAllow, S.buttonCancel],
        defaultId: 1,
        cancelId: 1
      })
      if (r.response === 0) {
        approvedHosts.add(host)
        return true
      }
      return false
    } finally {
      pendingHostApprovals.delete(host)
    }
  })()
  pendingHostApprovals.set(host, p)
  return p
}

// ─── IPC (`ipcMain.on` + `returnValue` = sendSync) ───────
export function sync(channel: string, fn: (e: IpcMainEvent, ...args: any[]) => unknown): void {
  ipcMain.on(channel, (e, ...args) => {
    try {
      e.returnValue = fn(e, ...args)
    } catch (err) {
      console.error(`[ipc ${channel}]`, err)
      e.returnValue = null
    }
  })
}

export const defaultVaultPath = (): string => join(documentsDir, 'Quartz Vault')
export const sandboxVaultPath = (): string => join(userData, 'Quartz Sandbox')

export function registerIpc(): void {
  sync('is-quitting', () => isQuitting)
  sync('is-closing', e => {
    const w = BrowserWindow.fromWebContents(e.sender) as QWindow | null
    return isQuitting || !!(w && w.closing)
  })
  sync('desktop-dir', () => desktopDir)
  sync('documents-dir', () => documentsDir)
  sync('resources', () => opts.appRoot)
  sync('version', () => opts.version)
  sync('policy', () => POLICY)
  sync('set-language', (_e, lang) => {
    if (lang) C.language = lang
    else delete C.language
    saveConfig()
    return null
  })
  sync('file-url', () => RESOURCE_PREFIX)
  sync('relaunch', () => {
    console.log('Relaunching!')
    setIsQuitting(true)
    app.relaunch()
    app.quit()
    return ''
  })
  // Updates: Quartz has no auto-updater; the channels keep their expected shapes.
  sync('update', () => '')
  sync('latest-public-version', () => '')
  sync('check-update', () => false)
  sync('disable-update', (_e, v) => {
    if (v === true) C.updateDisabled = true
    else if (v === false) delete C.updateDisabled
    if (v === true || v === false) saveConfig()
    return C.updateDisabled
  })
  sync('insider-build', (_e, v) => {
    if (v === true && POLICY.insider && !C.insider) {
      C.insider = true
      saveConfig()
    } else if (v === false && C.insider) {
      delete C.insider
      saveConfig()
    }
    return !!C.insider
  })
  sync('copy-asar', () => false)
  sync('disable-gpu', (_e, v) => {
    if (v === true) C.disableGpu = true
    else if (v === false) delete C.disableGpu
    if (v === true || v === false) saveConfig()
    return C.disableGpu
  })
  sync('cli', (_e, v) => {
    if (v === true && !C.cli) {
      C.cli = true
      saveConfig()
    } else if (v === false && C.cli) {
      delete C.cli
      saveConfig()
    }
    return !!C.cli
  })
  sync('frame', (_e, v) => {
    if (typeof v === 'string') {
      C.frame = v
      if (!v) delete C.frame
      saveConfig()
    }
    return C.frame
  })
  // Web-viewer ad blocking is not implemented; lists/frequency are persisted only.
  sync('adblock-lists', (_e, v) => {
    if (Array.isArray(v)) {
      C.adblock = v
      saveConfig()
    }
    return C.adblock || ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt']
  })
  sync('adblock-frequency', (_e, v) => {
    if (typeof v === 'number') {
      C.adblockFrequency = v
      saveConfig()
    }
    return C.adblockFrequency || 4
  })
  // `print-to-pdf` (async): options are passed straight to webContents.printToPDF plus
  // {filepath, open}; when done the sender gets a `print-to-pdf` message.
  ipcMain.on('print-to-pdf', async (e, options: Electron.PrintToPDFOptions & { filepath: string; open?: boolean }) => {
    console.log('Saving PDF...')
    const wc = e.sender
    try {
      const { filepath } = options
      const data = await wc.printToPDF(options)
      await fsp.writeFile(filepath, data)
      if (options.open) openPathNative(filepath)
    } catch (err) {
      console.error(err)
    } finally {
      console.log('Done.')
      if (!wc.isDestroyed()) wc.send('print-to-pdf', {})
    }
  })
  sync('vault', e => {
    const id = vaultIdOfWindow(BrowserWindow.fromWebContents(e.sender))
    if (!id) return {}
    const configPath = tempConfigDirs.get(id)
    return configPath ? { id, path: resolve(R[id].path), configPath } : { id, path: resolve(R[id].path) }
  })
  sync('vault-list', () => {
    if (tempConfigDirs.size === 0) return R
    const out = { ...R }
    for (const id of tempConfigDirs.keys()) delete out[id]
    return out
  })
  sync('vault-remove', (_e, p) => {
    if (p && typeof p === 'string') {
      for (const id in R) {
        if (R[id].path === p) {
          if (Y[id]) return false
          delete R[id]
          saveConfig()
          removeJson(userData, id)
          removePartition(id)
          return true
        }
      }
    }
    return false
  })
  sync('vault-move', (_e, from, to) => {
    if (from && typeof from === 'string') {
      for (const id in R) {
        if (R[id].path === from) {
          if (Y[id]) return 'EVAULTOPEN'
          try {
            renameSync(from, to)
          } catch (err) {
            return String(err)
          }
          R[id].path = to
          saveConfig()
          return ''
        }
      }
    }
    return false
  })
  sync('vault-open', (_e, p, create) => {
    if (create) {
      if (existsSync(p)) return 'Vault already exists'
      try {
        mkdirSync(p, { recursive: true })
      } catch (err) {
        return String(err)
      }
    }
    return openVaultPath(p)
  })
  sync('vault-message', (_e, p, msg) => {
    p = resolve(p)
    for (const id in R) {
      if (R[id].path === p) {
        sendAction(id, msg)
        break
      }
    }
    return ''
  })
  sync('starter', () => {
    openStarter()
    return null
  })
  sync('help', () => {
    // TODO(quartz): open a 600×680 help window (bundled help vault). Quartz has no
    // bundled help yet, so this opens the starter instead.
    openStarter()
    return null
  })
  sync('sandbox', () => {
    openSandbox()
    return null
  })
  ipcMain.on('context-menu', e => {
    setContextMenuClaimedBy(e.sender.id)
  })
  // `request-url` (async): renderer's requestUrl() backend; replies on the given channel.
  ipcMain.on('request-url', (e, replyChannel: string, req: { url: string; method?: string; contentType?: string; body?: string | ArrayBuffer; headers?: Record<string, string> }) => {
    try {
      const { url, method, contentType, body, headers } = req
      const r = net.request({ url, method, redirect: 'follow' })
      if (contentType) r.setHeader('Content-Type', contentType)
      if (headers) {
        for (const k in headers) {
          try {
            r.setHeader(k, headers[k])
          } catch (err) {
            console.error(err)
          }
        }
      }
      r.on('login', (_a, cb) => cb())
      r.on('error', err => e.reply(replyChannel, { error: err }))
      r.on('response', res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
          e.reply(replyChannel, { status: res.statusCode, headers: res.headers, body: ab })
        })
      })
      if (typeof body === 'string') r.write(body)
      else if (body instanceof ArrayBuffer) r.write(Buffer.from(new Uint8Array(body)))
      r.end()
    } catch (err) {
      e.reply(replyChannel, { error: err })
    }
  })
  ipcMain.on('open-url', (e, url) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && typeof url === 'string') openUrl(w, url)
  })
  ipcMain.on('open-file', async (e, extensions: string[]) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    const id = vaultIdOfWindow(w)
    if (!id || !w || !Array.isArray(extensions)) return
    const r = await dialog.showOpenDialog(w, {
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: S.supportedFiles, extensions }]
    })
    const p = r.filePaths[0]
    if (!r.canceled && p) openFileInVault(id, resolve(p))
  })
  // `trash` is called with sendSync but resolves asynchronously (returnValue set later).
  ipcMain.on('trash', async (e, p: string) => {
    try {
      await shell.trashItem(p)
      e.returnValue = true
    } catch (err) {
      console.log(err)
      e.returnValue = false
    }
  })
  sync('get-documents-path', () => documentsDir)
  sync('get-sandbox-vault-path', () => sandboxVaultPath())
  sync('get-default-vault-path', () => defaultVaultPath())
  ipcMain.on('set-menu', (e, arg: { template: any[] }) => {
    const w = BrowserWindow.fromWebContents(e.sender) as QWindow | null
    if (!w) return
    const m = buildAppMenu(arg?.template ?? [], false, menuHooks)
    w.appMenu = m
    if (isMac) refreshAppMenu()
    else w.setMenu(m)
  })
  ipcMain.on('update-menu-items', (e, items: { itemId: string; eState: Record<string, unknown> }[], refresh?: boolean) => {
    const m = menuFor(BrowserWindow.fromWebContents(e.sender))
    if (m === defaultMenu) return
    for (const { itemId, eState } of items) updateMenuItem(m, itemId, eState)
    if (refresh) refreshAppMenu(true)
  })
  ipcMain.on('render-menu', e => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w) menuFor(w).popup({ window: w })
  })
  sync('set-icon', (_e, name: string | null, data: Uint8Array | null) => {
    if (C.icon) rmSync(join(userData, C.icon), { force: true })
    if (name && data) writeFileSync(join(userData, name), data)
    else name = null
    if ((C.icon || '') !== (name || '')) {
      if (name) C.icon = name
      else delete C.icon
      saveConfig()
    }
    return null
  })
  sync('get-icon', () => C.icon)
  ipcMain.on('create-browser-session', (_e, partition: string, adblock?: boolean) => {
    let s = browserSessions[partition]
    if (!s) {
      s = { session: session.fromPartition(partition), adblock: !!adblock }
      browserSessions[partition] = s
      const ses = s.session
      ses.setUserAgent(
        ses
          .getUserAgent()
          .split(' ')
          .filter(t => !/^(quartz|electron)/i.test(t))
          .join(' ')
      )
      // TODO(quartz): adblock list matching (e.g. EasyList); requests are never cancelled.
      ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'http://*/*'] }, (d, cb) => {
        const h = d.requestHeaders
        for (const k in h) if (k.toLowerCase() === 'user-agent' && d.url.startsWith('https://accounts.google.com/')) h[k] = 'Chrome'
        cb({ requestHeaders: h })
      })
      ses.setPermissionCheckHandler((_wc, perm) => BROWSER_SESSION_PERMISSIONS.includes(perm))
      ses.setPermissionRequestHandler((_wc, perm, cb) => cb(BROWSER_SESSION_PERMISSIONS.includes(perm)))
      ses.setDevicePermissionHandler(() => false)
    }
    if (adblock === true || adblock === false) s.adblock = adblock
  })
  ipcMain.handle('register-cli', async () => ({ success: false, message: 'The Quartz command line interface is not available yet.' }))
}

/** (Re)create the sandbox vault from the bundled sandbox folder. Quartz ships none. */
export function openSandbox(): void {
  const target = sandboxVaultPath()
  for (const id in Y) {
    if (R[id]?.path === target) {
      R[id].ts = Date.now()
      openVaultWindow(id)
      return
    }
  }
  const src = join(opts.appRoot, 'sandbox')
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  const copy = (from: string, to: string): void => {
    mkdirSync(to, { recursive: true })
    if (!existsSync(from)) return
    for (const name of readdirSync(from)) {
      const s = join(from, name)
      const st = statSync(s)
      if (st.isFile()) writeFileSync(join(to, name), readFileSync(s))
      else if (st.isDirectory()) copy(s, join(to, name))
    }
  }
  copy(src, target)
  openVaultPath(target)
}
