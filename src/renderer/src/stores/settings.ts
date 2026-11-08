import { createStore as create } from 'zustand/vanilla'
import { getApp } from '@/engine/App'
import { CONFIG_DEFAULTS } from '@/engine/vault/config'

export type EditorMode = 'source' | 'preview' | 'reading'

export interface AppSettings {
  // Editor
  /** Current view mode (per session; derived from defaultViewMode + livePreview at load). */
  editorMode: EditorMode
  tabSize: number
  useTab: boolean
  showLineNumber: boolean
  spellcheck: boolean
  spellcheckDictionary: string[]
  autoPairMarkdown: boolean
  autoPairBrackets: boolean
  readableLineLength: boolean
  livePreview: boolean
  defaultViewMode: 'source' | 'preview'
  strictLineBreaks: boolean
  foldHeading: boolean
  foldIndent: boolean
  showFrontmatter: boolean
  showInlineTitle: boolean
  propertiesInDocument: 'visible' | 'hidden' | 'source'
  vimMode: boolean
  smartIndentList: boolean
  showIndentGuide: boolean
  rightToLeft: boolean
  autoConvertHtml: boolean

  // Files and links
  promptDelete: boolean
  trashOption: 'system' | 'local' | 'none'
  alwaysUpdateLinks: boolean
  newFileLocation: 'root' | 'current' | 'folder'
  newFileFolderPath: string
  attachmentFolderPath: string
  userIgnoreFilters: string[]
  newLinkFormat: 'shortest' | 'relative' | 'absolute'
  useMarkdownLinks: boolean
  showUnsupportedFiles: boolean
  deleteUnlinkedAttachments: 'ask' | 'always' | 'never'
}

// Keep backwards-compat alias
export type Settings = AppSettings

/** Keys stored in `<configDir>/app.json` with their names and defaults. */
const VAULT_KEYS = [
  'tabSize', 'useTab', 'showLineNumber', 'spellcheck', 'autoPairMarkdown', 'autoPairBrackets', 'readableLineLength',
  'livePreview', 'defaultViewMode', 'strictLineBreaks', 'foldHeading', 'foldIndent', 'showInlineTitle',
  'propertiesInDocument', 'vimMode', 'smartIndentList', 'showIndentGuide', 'rightToLeft', 'autoConvertHtml',
  'promptDelete', 'trashOption', 'alwaysUpdateLinks', 'newFileLocation', 'newFileFolderPath', 'attachmentFolderPath',
  'userIgnoreFilters', 'newLinkFormat', 'useMarkdownLinks', 'showUnsupportedFiles', 'deleteUnlinkedAttachments'
] as const
/** Quartz-only preferences (not in app.json): kept per device in localStorage. */
const LOCAL_KEYS = ['showFrontmatter', 'spellcheckDictionary'] as const
const LOCAL_DEFAULTS = { showFrontmatter: true, spellcheckDictionary: [] as string[] }

function defaultSettings(): AppSettings {
  const d: any = {}
  for (const k of VAULT_KEYS) d[k] = structuredClone(CONFIG_DEFAULTS[k])
  if (d.userIgnoreFilters === null) d.userIgnoreFilters = []
  return { ...d, ...LOCAL_DEFAULTS, editorMode: modeFrom(d) } as AppSettings
}
function modeFrom(s: { defaultViewMode: string; livePreview: boolean }): EditorMode {
  return s.defaultViewMode === 'preview' ? 'reading' : s.livePreview ? 'preview' : 'source'
}
function readLocal(): Partial<AppSettings> {
  const out: any = {}
  for (const k of LOCAL_KEYS) {
    try {
      const v = localStorage.getItem('quartz-setting:' + k)
      if (v !== null) out[k] = JSON.parse(v)
    } catch {
      /* ignore */
    }
  }
  return out
}
/** Current settings from the vault config (sparse app.json over defaults). */
function readFromVault(): Partial<AppSettings> {
  const app = getApp()
  if (!app) return {}
  const out: any = {}
  for (const k of VAULT_KEYS) out[k] = app.vault.getConfig(k)
  if (out.userIgnoreFilters === null) out.userIgnoreFilters = []
  return out
}

interface SettingsState {
  settings: AppSettings
  setSettings: (partial: Partial<AppSettings>) => void
  toggleEditorMode: () => void
  toggleReadingView: () => void
  toggleReadableLineLength: () => void
  loadSettings: (vaultPath: string) => Promise<void>
  saveSettings: (vaultPath: string) => Promise<void>
}

let lastEditingMode: EditorMode = 'preview'
let configRef: { e: { offref(r: unknown): void } } | null = null

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),

  /** Update settings; app.json keys go to the vault config (debounced, sparse save). */
  setSettings: partial => {
    set(state => ({ settings: { ...state.settings, ...partial } }))
    const app = getApp()
    for (const [k, v] of Object.entries(partial)) {
      if ((VAULT_KEYS as readonly string[]).includes(k)) app?.vault.setConfig(k, structuredClone(v))
      else if ((LOCAL_KEYS as readonly string[]).includes(k)) {
        try {
          localStorage.setItem('quartz-setting:' + k, JSON.stringify(v))
        } catch {
          /* ignore */
        }
      }
    }
  },

  toggleEditorMode: () => {
    const current = get().settings.editorMode
    const next: EditorMode = current === 'source' ? 'preview' : 'source'
    set(state => ({ settings: { ...state.settings, editorMode: next } }))
  },

  // Reading view <-> the last editing mode (Source or Live Preview)
  toggleReadingView: () => {
    const current = get().settings.editorMode
    if (current === 'reading') {
      set(state => ({ settings: { ...state.settings, editorMode: lastEditingMode } }))
    } else {
      lastEditingMode = current
      set(state => ({ settings: { ...state.settings, editorMode: 'reading' } }))
    }
  },

  toggleReadableLineLength: () => {
    get().setSettings({ readableLineLength: !get().settings.readableLineLength })
  },


  /** Load from the App's vault config (call after the App's config is set up). */
  loadSettings: async (_vaultPath: string) => {
    const app = getApp()
    if (app) await app.vault.configReady
    const merged = { ...defaultSettings(), ...readLocal(), ...readFromVault() } as AppSettings
    merged.editorMode = modeFrom(merged)
    set({ settings: merged })
    // live reload when app.json is edited externally or by other code
    if (configRef) configRef.e.offref(configRef)
    configRef = null
    if (app) {
      configRef = app.vault.on('config-changed', (key: string) => {
        if (!(VAULT_KEYS as readonly string[]).includes(key)) return
        let v = app.vault.getConfig(key)
        if (key === 'userIgnoreFilters' && v === null) v = []
        set(state => ({ settings: { ...state.settings, [key]: v } }))
      }) as any
    }
  },

  /** Flush pending config writes (the vault saves sparse app.json itself). */
  saveSettings: async (_vaultPath: string) => {
    const app = getApp()
    if (app) await app.vault.requestSaveConfig.run()
  }
}))
