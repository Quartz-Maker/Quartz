// Quartz main process — shared window/registry state and constants (split out of core.ts).
// Reassigned state is exposed through setX() helpers so importers see live bindings.
import {
  app,
  BrowserWindow,
  session,
  Menu,
  type WebContents
} from 'electron'
import { REGISTRY_NAME, writeJson, type RegistryConfig, type VaultEntry } from './registry'
import { randomHex } from './util'
import { APP_SCHEME, APP_ORIGIN } from './resource'

export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'

export type QWindow = BrowserWindow & {
  focusTime?: number
  closing?: boolean
  loaded?: boolean
  appMenu?: Menu
  setFrameZoomLevel?: (z: number) => void
}
export type QWebContents = WebContents & { isSecured?: boolean; noContextMenu?: boolean }

/** Default `policy`: everything allowed. */
export const POLICY = Object.freeze({ plugins: true, themes: true, snippets: true, sync: true, publish: true, webViewer: true, devTools: true, insider: true })
/** Permissions granted to web-viewer sessions. */
export const BROWSER_SESSION_PERMISSIONS = ['clipboard-read', 'clipboard-sanitized-write']

export interface CoreOptions {
  /** Directory holding the built renderer (index.html). */
  appRoot: string
  /** Dev-server URL (electron-vite) — page is loaded from there instead of app://. */
  devServerUrl?: string
  preloadPath: string
  iconPath: string
  /** App version reported by the `version` IPC (package.json). */
  version: string
}

// ─── state ────────────────────────────────────────────────────────────────────
export let opts: CoreOptions
export let userData = ''
export let documentsDir = ''
export let desktopDir = ''
export let C: RegistryConfig = { vaults: {} }
export let customIconPath: string | undefined
export let R: Record<string, VaultEntry> = {}
/** Vault windows by vault id. */
export const Y: Record<string, QWindow> = {}
/** Popout → owning window. */
export const parentOf = new WeakMap<BrowserWindow, BrowserWindow>()
export let isQuitting = false
export let starterWin: QWindow | null = null
export let contextMenuClaimedBy: number | null = null
export let frameNative = false
export let titleBarStyle: 'default' | 'hidden' = 'hidden'
export let defaultMenu: Menu
export let lastAppMenu: Menu | null = null
/** Per-run random resource host. */
export const RESOURCE_PREFIX = `${APP_SCHEME}://${randomHex(36)}/`
export let pageUrl = APP_ORIGIN + 'index.html'
export const approvedHosts = new Set<string>()
export const pendingHostApprovals = new Map<string, Promise<boolean>>()
export const browserSessions: Record<string, { session: Electron.Session; adblock: boolean }> = {}
export let pendingOpenUrl: string | null = null
export let pendingOpenFile: string | null = null

/** Temp vault id → its config dir outside the vault (tempVaults.ts). Never saved to quartz.json. */
export const tempConfigDirs = new Map<string, string>()

export const saveConfig = (): void => {
  if (tempConfigDirs.size === 0) return writeJson(userData, REGISTRY_NAME, C)
  const vaults = { ...C.vaults }
  for (const id of tempConfigDirs.keys()) delete vaults[id]
  writeJson(userData, REGISTRY_NAME, { ...C, vaults })
}
export const getRegistry = (): RegistryConfig => C

export let remoteMain: { enable: (wc: WebContents) => void; initialize: () => void } | null = null
export function setC(v: RegistryConfig): void {
  C = v
}
export function setR(v: Record<string, VaultEntry>): void {
  R = v
}
export function setContextMenuClaimedBy(v: number | null): void {
  contextMenuClaimedBy = v
}
export function setCustomIconPath(v: string | undefined): void {
  customIconPath = v
}
export function setDefaultMenu(v: Menu): void {
  defaultMenu = v
}
export function setDesktopDir(v: string): void {
  desktopDir = v
}
export function setDocumentsDir(v: string): void {
  documentsDir = v
}
export function setFrameNative(v: boolean): void {
  frameNative = v
}
export function setIsQuitting(v: boolean): void {
  isQuitting = v
}
export function setLastAppMenu(v: Menu | null): void {
  lastAppMenu = v
}
export function setOpts(v: CoreOptions): void {
  opts = v
}
export function setPageUrl(v: string): void {
  pageUrl = v
}
export function setPendingOpenFile(v: string | null): void {
  pendingOpenFile = v
}
export function setPendingOpenUrl(v: string | null): void {
  pendingOpenUrl = v
}
export function setStarterWin(v: QWindow | null): void {
  starterWin = v
}
export function setTitleBarStyle(v: 'default' | 'hidden'): void {
  titleBarStyle = v
}
export function setUserData(v: string): void {
  userData = v
}
export function setRemoteMain(v: { enable: (wc: WebContents) => void; initialize: () => void } | null): void {
  remoteMain = v
}
