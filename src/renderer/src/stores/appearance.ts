import { createStore as create } from 'zustand/vanilla'
import { activateTheme } from '@/core/themeLoader'
import { applyEnabledSnippets } from '@/core/snippetLoader'
import { getApp } from '@/engine/App'
import { installAppearance, applyThemeClass, setAccentColor, applyFontFamilies, applyFontSize, resolveDark } from '@/engine/theme/appearance'

function systemTheme(): ThemeMode {
  return resolveDark('system') ? 'dark' : 'light'
}

export type ThemeMode = 'dark' | 'light'

export interface AppearanceSettings {
  theme: ThemeMode
  accentColor: string
  baseFontSize: number
  interfaceFontSize: number
  textFontFamily: string
  monoFontFamily: string
  cssTheme: string
  translucency: boolean
  enabledCssSnippets: string[]
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'dark',
  accentColor: '', // '' = the theme's default accent
  baseFontSize: 16,
  interfaceFontSize: 14,
  textFontFamily: '',
  monoFontFamily: '',
  cssTheme: '',
  translucency: false,
  enabledCssSnippets: []
}

interface AppearanceState {
  appearance: AppearanceSettings
  setAppearance: (partial: Partial<AppearanceSettings>) => void
  toggleTheme: () => void
  loadAppearance: (vaultPath: string) => Promise<void>
  saveAppearance: (vaultPath: string) => Promise<void>
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: { ...DEFAULT_APPEARANCE },

  setAppearance: (partial) => {
    set(state => {
      const updated = { ...state.appearance, ...partial }
      applyAppearance(updated)
      return { appearance: updated }
    })
    // Auto-save
    const vaultPath = (window as any).__quartzVaultPath
    if (vaultPath) get().saveAppearance(vaultPath)
  },

  toggleTheme: () => {
    // theme:toggle-light-dark — in "system" mode only the body classes flip (not persisted)
    const app = getApp()
    const current = get().appearance.theme
    const next: ThemeMode = current === 'dark' ? 'light' : 'dark'
    if (app && (app.vault.getConfig('theme') ?? 'system') === 'system') {
      applyThemeClass(next === 'dark')
      set(state => ({ appearance: { ...state.appearance, theme: next } }))
      return
    }
    get().setAppearance({ theme: next })
  },

  loadAppearance: async (vaultPath: string) => {
    // Stored in <configDir>/appearance.json through the vault config, with the
    // key names/values (theme "obsidian"/"moonstone"/"system", monospaceFontFamily).
    const app = getApp()
    if (app) await app.vault.configReady
    const merged: AppearanceSettings = { ...DEFAULT_APPEARANCE }
    if (app) {
      const v = app.vault
      const theme = v.getConfig('theme')
      merged.theme = theme === 'moonstone' ? 'light' : theme === 'obsidian' ? 'dark' : systemTheme()
      merged.accentColor = v.getConfig('accentColor') || DEFAULT_APPEARANCE.accentColor
      merged.cssTheme = v.getConfig('cssTheme')
      merged.translucency = v.getConfig('translucency')
      merged.textFontFamily = v.getConfig('textFontFamily')
      merged.monoFontFamily = v.getConfig('monospaceFontFamily')
      merged.enabledCssSnippets = v.getConfig('enabledCssSnippets')
      const size = v.getConfig('baseFontSize')
      if (typeof size === 'number') merged.baseFontSize = size
    }
    try {
      const ui = localStorage.getItem('quartz-setting:interfaceFontSize')
      if (ui) merged.interfaceFontSize = JSON.parse(ui)
    } catch { /* ignore */ }
    set({ appearance: merged })
    if (app && !(app as any).__appearanceInstalled) {
      ;(app as any).__appearanceInstalled = true
      installAppearance(app)
      merged.baseFontSize = (app as any).getBaseFontSize()
    }
    applyAppearance(merged)
    if (merged.cssTheme) activateTheme(vaultPath, merged.cssTheme)
    if (merged.enabledCssSnippets.length > 0) applyEnabledSnippets(vaultPath, merged.enabledCssSnippets)
  },

  saveAppearance: async (_vaultPath: string) => {
    const app = getApp()
    const a = get().appearance
    try {
      localStorage.setItem('quartz-setting:interfaceFontSize', JSON.stringify(a.interfaceFontSize))
    } catch { /* ignore */ }
    if (!app) return
    const v = app.vault
    const put = (k: string, value: unknown): void => {
      if (JSON.stringify(v.getConfig(k)) !== JSON.stringify(value)) v.setConfig(k, value)
    }
    const themeNow = v.getConfig('theme')
    if (!(themeNow === 'system' && systemTheme() === a.theme)) put('theme', a.theme === 'light' ? 'moonstone' : 'obsidian')
    put('accentColor', a.accentColor || '')
    put('cssTheme', a.cssTheme)
    put('translucency', a.translucency)
    put('textFontFamily', a.textFontFamily)
    put('monospaceFontFamily', a.monoFontFamily)
    put('enabledCssSnippets', a.enabledCssSnippets)
    if (a.baseFontSize !== (v.getConfig('baseFontSize') ?? DEFAULT_APPEARANCE.baseFontSize)) v.setConfig('baseFontSize', a.baseFontSize)
    try { localStorage.setItem(`${(app as any).appId}-base-font-size`, JSON.stringify(a.baseFontSize)) } catch { /* ignore */ }
  }
}))

function applyAppearance(a: AppearanceSettings): void {
  // Mechanisms: body theme class, --accent-h/s/l, --font-*-override, --font-text-size.
  applyThemeClass(a.theme !== 'light')
  setAccentColor(a.accentColor)
  applyFontFamilies({ text: a.textFontFamily, monospace: a.monoFontFamily, interface: getApp()?.vault.getConfig('interfaceFontFamily') })
  applyFontSize(a.baseFontSize)
  // legacy React UI only (not a theme-contract variable)
  document.documentElement.style.setProperty('--interface-font-size', `${a.interfaceFontSize}px`)
}
