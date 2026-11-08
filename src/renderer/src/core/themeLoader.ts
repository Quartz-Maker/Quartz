/**
 * Theme loader — scans <configDir>/themes/ for community CSS themes (layout:
 * themes/<Name>/manifest.json + theme.css, accepted only when manifest.name === folder name;
 * legacy single-file themes/<Name>.css). The active theme's CSS goes into the persistent
 * theme <style> (see engine/theme/styleOrder: app < plugins < theme < snippets).
 */
import { setThemeCss } from '@/engine/theme/styleOrder'
import { getApp } from '@/engine/App'

const configDir = (): string => getApp()?.vault?.configDir ?? '.quartz'

export interface ThemeManifest {
  name: string
  version: string
  author?: string
}

export interface DiscoveredTheme {
  id: string  // folder name
  manifest: ThemeManifest
  legacy?: boolean
}

export async function discoverThemes(vaultPath: string): Promise<DiscoveredTheme[]> {
  const themesDir = `${vaultPath}/${configDir()}/themes`
  const themes: DiscoveredTheme[] = []

  try {
    const entries = await window.quartzAPI.vault.readDir(themesDir)
    for (const entry of entries) {
      if (!entry.isDirectory) {
        if (entry.name.endsWith('.css')) {
          const name = entry.name.slice(0, -4)
          themes.push({ id: name, manifest: { name: `${name} (Legacy)`, version: '' }, legacy: true })
        }
        continue
      }
      const manifestPath = `${entry.path}/manifest.json`
      const content = await window.quartzAPI.vault.readFile(manifestPath)
      if (content) {
        try {
          const manifest = JSON.parse(content) as ThemeManifest
          if (manifest.name && manifest.name === entry.name) {
            themes.push({ id: entry.name, manifest })
          }
        } catch { /* skip invalid */ }
      }
    }
  } catch { /* themes dir doesn't exist yet */ }

  return themes
}

export async function loadThemeCSS(vaultPath: string, themeId: string): Promise<string | null> {
  const dir = `${vaultPath}/${configDir()}/themes`
  const css = await window.quartzAPI.vault.readFile(`${dir}/${themeId}/theme.css`).catch(() => null)
  if (css !== null && css !== undefined) return css
  return await window.quartzAPI.vault.readFile(`${dir}/${themeId}.css`).catch(() => null)
}

export function applyThemeCSS(css: string | null): void {
  if (setThemeCss(css ?? '')) {
    try { (getApp() as any)?.workspace?.trigger?.('css-change') } catch { /* no workspace */ }
  }
}

export async function activateTheme(vaultPath: string, themeId: string): Promise<void> {
  if (!themeId) {
    applyThemeCSS(null)
    return
  }
  const css = await loadThemeCSS(vaultPath, themeId)
  applyThemeCSS(css)
}
