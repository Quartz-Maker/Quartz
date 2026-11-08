/* eslint-disable @typescript-eslint/no-explicit-any */
// Plugin-API `App` skeleton: vault + metadataCache + fileManager. Workspace, views,
// plugins etc. are attached by their own areas later (`app.workspace = …`).
import { Vault } from './vault/Vault'
import type { TFile } from './vault/TAbstractFile'
import { Notice } from './ui/Notice'
import { FileSystemAdapter } from './vault/FileSystemAdapter'
import { DEFAULT_CONFIG_DIR } from './vault/config'
import { MetadataCache, type MetadataCacheOptions } from './metadata/MetadataCache'
import { FileManager } from './FileManager'
import { MetadataTypeManager } from './metadata/MetadataTypeManager'
import { getStoredSpellcheckLanguages, storeSpellcheckLanguages } from './settings/spellcheck'

export interface AppOptions extends MetadataCacheOptions {
  configDir?: string
  /** Temp vault: absolute folder that holds the config dir instead of `<vault>/<configDir>`. */
  configPath?: string
}

/** Stable per-vault id (16 hex chars), derived from the vault path. */
export function vaultIdForPath(p: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16)
}

export class App {
  appId: string
  vault: Vault
  metadataCache: MetadataCache
  fileManager: FileManager
  metadataTypeManager: MetadataTypeManager
  [key: string]: any

  constructor(adapter: FileSystemAdapter, appId: string, options: AppOptions = {}) {
    this.appId = appId
    this.vault = new Vault(adapter)
    const override = typeof localStorage !== 'undefined' ? safeGet(appId + '-config') : null
    this.vault.setConfigDir(options.configDir ?? override ?? this.vault.configDir)
    this.metadataCache = new MetadataCache(this.vault, { appId, ...options })
    this.fileManager = new FileManager(this)
    this.metadataTypeManager = new MetadataTypeManager(this)
  }

  /** `quartz://open?vault=&file=` for a file (markdown extension dropped). */
  getObsidianUrl(file: { path: string; extension?: string }): string {
    const path = file.extension === 'md' ? file.path.replace(/\.md$/, '') : file.path
    return 'quartz://open?vault=' + encodeURIComponent(this.vault.getName()) + '&file=' + encodeURIComponent(path)
  }
  copyObsidianUrl(file: { path: string; extension?: string }): void {
    void navigator.clipboard.writeText(this.getObsidianUrl(file))
    new Notice('URL copied to your clipboard')
  }
  /** Save pasted/dropped binary data per `attachmentFolderPath` (app.saveAttachment). */
  async saveAttachment(name: string, ext: string, data: ArrayBuffer): Promise<TFile> {
    const active = this.workspace?.getActiveFile?.() ?? null
    const path = await this.vault.getAvailablePathForAttachments(name, ext, active)
    return this.vault.createBinary(path, data)
  }

  getSpellcheckLanguages(): string[] | null {
    return getStoredSpellcheckLanguages()
  }
  setSpellcheckLanguages(langs: string[] | null): void {
    storeSpellcheckLanguages(langs)
  }

  /** Boot order for the data layer: config → listing → cache. */
  async initialize(): Promise<void> {
    await this.vault.setupConfig()
    this.metadataCache.preload()
    await this.vault.load()
    await this.metadataCache.initialize()
    await this.metadataTypeManager.load()
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Create the App for a vault folder (absolute path). */
export function createApp(basePath: string, options: AppOptions = {}): App {
  const redirect = options.configPath ? { dir: options.configDir ?? DEFAULT_CONFIG_DIR, target: options.configPath } : null
  return new App(new FileSystemAdapter(basePath, resourcePrefix(), redirect), vaultIdForPath(basePath), options)
}

/** `app://<host>/` resource prefix served by the main process (`file-url` IPC). */
function resourcePrefix(): string | undefined {
  try {
    return (window as any).require('electron').ipcRenderer.sendSync('file-url') || undefined
  } catch {
    return undefined
  }
}

/** Install `app` as the global `window.app` (what plugins and DevTools expect). */
export function setGlobalApp(app: App | null): void {
  if (typeof window === 'undefined') return
  if (app) (window as any).app = app
  else delete (window as any).app
}

let current: App | null = null
export function getApp(): App | null {
  return current
}
export function setCurrentApp(app: App | null): void {
  current = app
  setGlobalApp(app)
}
