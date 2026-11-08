/* eslint-disable @typescript-eslint/no-explicit-any */
// Appearance wiring with the theme API's App method names and semantics:
//   theme mode → body.theme-dark|theme-light (obsidian/moonstone/system; system follows the OS),
//   accent colour → body --accent-h/s/l (+ --text-on-accent for light accents),
//   font families → body --font-{interface,text,monospace,print}-override,
//   base font size → body --font-text-size + html font-size, platform/frame body classes.
// Installed onto the App instance by installAppearance(app) so plugins/themes calling
// app.changeTheme(), app.setAccentColor(), app.isDarkMode()… get the same behaviour.

type ConfigVault = { getConfig(k: string): any; setConfig(k: string, v: any): void; on?: (...a: any[]) => any }

const DEFAULT_FONT_SIZE = 16

/** Parse #rgb / #rrggbb / #rrggbbaa. */
export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  let m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex)
  if (!m) {
    const s = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex)
    if (!s) return null
    m = [hex, s[1] + s[1], s[2] + s[2], s[3] + s[3], undefined as any] as any
  }
  return { r: parseInt(m![1], 16), g: parseInt(m![2], 16), b: parseInt(m![3], 16), a: m![4] ? parseInt(m![4], 16) / 255 : 1 }
}

/** RGB → HSL with integer rounding (h degrees, s/l percent). */
export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v } }
  const hue = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return { r: Math.round(hue(p, q, h + 1 / 3) * 255), g: Math.round(hue(p, q, h) * 255), b: Math.round(hue(p, q, h - 1 / 3) * 255) }
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')
export const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }): string => '#' + hex2(r) + hex2(g) + hex2(b)

/** Perceived brightness ≥ 150 → light colour (text on it should be dark). */
export const isLightColor = ({ r, g, b }: { r: number; g: number; b: number }): boolean => (299 * r + 587 * g + 114 * b) / 1000 >= 150

/** Write (or clear) the accent colour on body (setAccentColor). */
export function setAccentColor(color: string, body: HTMLElement = document.body): void {
  const st = body.style
  const clear = (): void => { for (const p of ['--text-on-accent', '--accent-h', '--accent-s', '--accent-l']) st.removeProperty(p) }
  if (!color) return clear()
  const rgb = parseHex(color)
  if (!rgb) return clear()
  const { h, s, l } = rgbToHsl(rgb)
  st.setProperty('--accent-h', String(h))
  st.setProperty('--accent-s', `${s}%`)
  st.setProperty('--accent-l', `${l}%`)
  if (isLightColor(rgb)) st.setProperty('--text-on-accent', 'var(--text-on-accent-inverted)')
  else st.removeProperty('--text-on-accent')
}

/** The effective accent (config value, else the theme's computed --accent-*) as #rrggbb. */
export function getAccentColor(configured: string, body: HTMLElement = document.body): string {
  if (configured) return configured
  const cs = getComputedStyle(body)
  const num = (v: string): number => parseInt(v.trim().replace(/%$/, ''), 10)
  return rgbToHex(hslToRgb({ h: num(cs.getPropertyValue('--accent-h')), s: num(cs.getPropertyValue('--accent-s')), l: num(cs.getPropertyValue('--accent-l')) }))
}

/** "A, B C" → ['A', 'B C'] (quotes stripped). */
export const parseFontList = (s: string | null | undefined): string[] =>
  (s || '').replace(/["]/g, '').split(',').map(x => x.trim()).filter(Boolean)
/** ['A', 'B C'] → 'A, "B C"'. */
export const formatFontList = (l: string[]): string => l.map(x => (x.includes(' ') ? `"${x}"` : x)).join(', ')

export function applyFontFamilies(v: { interface?: string; text?: string; monospace?: string }, body: HTMLElement = document.body): void {
  const st = body.style
  const set = (prop: string, val: string): void => { if (val) st.setProperty(prop, val); else st.removeProperty(prop) }
  set('--font-interface-override', formatFontList(parseFontList(v.interface)))
  const text = formatFontList(parseFontList(v.text))
  set('--font-text-override', text)
  set('--font-print-override', text)
  set('--font-monospace-override', formatFontList(parseFontList(v.monospace)))
}

export function applyFontSize(n: number): void {
  const size = Math.min(30, Math.max(10, Number.isFinite(n) ? n : DEFAULT_FONT_SIZE))
  document.body.style.setProperty('--font-text-size', `${size}px`)
  document.documentElement.style.setProperty('font-size', `calc(${size}px * var(--preferred-text-scale, 1))`)
}

export type ThemeSetting = 'obsidian' | 'moonstone' | 'system' | string

function osPrefersDark(): boolean {
  try {
    if (process.platform === 'linux') {
      const el = (window as any).require?.('electron')
      const nt = el?.remote?.nativeTheme ?? (window as any).require?.('@electron/remote')?.nativeTheme
      if (nt && typeof nt.shouldUseDarkColors === 'boolean') return nt.shouldUseDarkColors
    }
  } catch { /* fall through */ }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

/** Resolve a theme setting to dark (true) / light (false). */
export const resolveDark = (setting: ThemeSetting): boolean =>
  setting === 'obsidian' ? true : setting === 'moonstone' ? false : osPrefersDark()

/** Toggle body.theme-dark/theme-light. Returns true if the classes changed. */
export function applyThemeClass(dark: boolean, body: HTMLElement = document.body): boolean {
  let changed = false
  if (body.classList.contains('theme-light') !== !dark) { body.classList.toggle('theme-light', !dark); changed = true }
  if (body.classList.contains('theme-dark') !== dark) { body.classList.toggle('theme-dark', dark); changed = true }
  return changed
}

/** Static body classes set at boot (platform, scrollbars, defaults). */
export function installBodyClasses(): void {
  const b = document.body
  const plat = typeof process !== 'undefined' ? process.platform : ''
  b.classList.add(plat === 'darwin' ? 'mod-macos' : plat === 'win32' ? 'mod-windows' : 'mod-linux')
  b.classList.add('obsidian-app')
  if (plat !== 'darwin') b.classList.add('styled-scrollbars')
  b.style.setProperty('--zoom-factor', '1')
  if (!b.style.getPropertyValue('--font-text-size')) b.style.setProperty('--font-text-size', `${DEFAULT_FONT_SIZE}px`)
  b.style.setProperty('--indent-size', '4')
  // initial theme before any vault config is read (defaults to "system")
  if (!b.classList.contains('theme-dark') && !b.classList.contains('theme-light')) applyThemeClass(resolveDark('system'))
}

const transitionTimer = { id: 0 as any }
function disableCssTransition(): void {
  const c = document.querySelector('.app-container') ?? document.body
  c.classList.add('no-transition')
  clearTimeout(transitionTimer.id)
  transitionTimer.id = setTimeout(() => c.classList.remove('no-transition'), 200)
}

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

/**
 * Attach the appearance API to an App (vault config backed) and apply the current
 * configuration. Safe to call once per App.
 */
export function installAppearance(app: any): void {
  const vault: ConfigVault = app.vault
  const trigger = (): void => { try { app.workspace?.trigger?.('css-change') } catch { /* no workspace yet */ } }
  const ls = (k: string): any => { try { const v = localStorage.getItem(`${app.appId}-${k}`); return v === null ? null : JSON.parse(v) } catch { return null } }
  const lsSet = (k: string, v: any): void => { try { localStorage.setItem(`${app.appId}-${k}`, JSON.stringify(v)) } catch { /* ignore */ } }

  app.isDarkMode = (): boolean => document.body.classList.contains('theme-dark')
  app.updateTheme = (): void => { if (applyThemeClass(resolveDark(vault.getConfig('theme')))) trigger() }
  app.changeTheme = (mode: ThemeSetting): void => {
    if (!mode) return
    disableCssTransition()
    vault.setConfig('theme', mode)
    app.updateTheme()
  }
  app.setAccentColor = (c: string): void => setAccentColor(c)
  app.updateAccentColor = (): void => setAccentColor(vault.getConfig('accentColor'))
  app.getAccentColor = (): string => getAccentColor(vault.getConfig('accentColor'))
  app.updateFontFamily = (): void => {
    applyFontFamilies({ interface: vault.getConfig('interfaceFontFamily'), text: vault.getConfig('textFontFamily'), monospace: vault.getConfig('monospaceFontFamily') })
    trigger()
  }
  app.getBaseFontSize = (): number => {
    let v = ls('base-font-size')
    if (v === null) { v = vault.getConfig('baseFontSize'); if (v !== undefined && v !== null) lsSet('base-font-size', v) }
    return Math.min(30, Math.max(10, v ?? DEFAULT_FONT_SIZE))
  }
  app.setBaseFontSize = (n: number): void => { lsSet('base-font-size', Math.min(30, Math.max(10, n))); app.updateFontSize() }
  app.updateFontSize = (): void => { applyFontSize(app.getBaseFontSize()); trigger() }
  app.updateInlineTitleDisplay = (): void => { document.body.classList.toggle('show-inline-title', vault.getConfig('showInlineTitle') !== false) }
  app.updateViewHeaderDisplay = (): void => { document.body.classList.toggle('show-view-header', vault.getConfig('showViewHeader') !== false) }
  app.updateRibbonDisplay = (): void => { document.body.classList.toggle('show-ribbon', vault.getConfig('showRibbon') !== false) }
  app.disableCssTransition = disableCssTransition
  app.enableCssTransition = (): void => (document.querySelector('.app-container') ?? document.body).classList.remove('no-transition')

  const applyTranslucency = (on: boolean): void => {
    const supported = process.platform === 'darwin' || process.platform === 'win32'
    document.body.classList.toggle('is-translucent', !!on && supported)
  }
  app.setTranslucency = (on: boolean): void => { vault.setConfig('translucency', on); applyTranslucency(on) }

  const applyAll = (): void => {
    app.updateTheme()
    app.updateAccentColor()
    app.updateFontFamily()
    app.updateFontSize()
    app.updateInlineTitleDisplay()
    app.updateViewHeaderDisplay()
    app.updateRibbonDisplay()
    applyTranslucency(vault.getConfig('translucency'))
  }
  applyAll()
  // follow the OS when the setting is "system"
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    if (mediaListener) mq.removeEventListener('change', mediaListener)
    mediaListener = () => { if (vault.getConfig('theme') === 'system' || !vault.getConfig('theme')) app.updateTheme() }
    mq.addEventListener('change', mediaListener)
    const el = (window as any).require?.('@electron/remote')
    el?.nativeTheme?.on?.('updated', mediaListener)
  } catch { /* not in a browser */ }
  // config changes made elsewhere (settings UI, sync) re-apply
  try {
    vault.on?.('config-changed', (key: string) => {
      if (key === 'theme') app.updateTheme()
      else if (key === 'accentColor') app.updateAccentColor()
      else if (/FontFamily$/.test(key)) app.updateFontFamily()
      else if (key === 'baseFontSize') app.updateFontSize()
      else if (key === 'translucency') applyTranslucency(vault.getConfig('translucency'))
      else if (key === 'showInlineTitle') app.updateInlineTitleDisplay()
      else if (key === 'showViewHeader') app.updateViewHeaderDisplay()
      else if (key === 'showRibbon') app.updateRibbonDisplay()
    })
  } catch { /* vault without events */ }
}
