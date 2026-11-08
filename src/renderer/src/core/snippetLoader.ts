/**
 * Snippet loader — scans <configDir>/snippets/ for user CSS files (names starting with "."
 * excluded, natural sort). Enabled snippets get one <style> each, after the theme style.
 */
import { setSnippetStyle, setSnippetStyles, naturalCompare } from '@/engine/theme/styleOrder'
import { getApp } from '@/engine/App'

const configDir = (): string => getApp()?.vault?.configDir ?? '.quartz'

export async function discoverSnippets(vaultPath: string): Promise<string[]> {
  const snippetsDir = `${vaultPath}/${configDir()}/snippets`
  const snippets: string[] = []

  try {
    const entries = await window.quartzAPI.vault.readDir(snippetsDir)
    for (const entry of entries) {
      if (!entry.isDirectory && entry.name.endsWith('.css') && !entry.name.startsWith('.')) {
        snippets.push(entry.name.replace(/\.css$/, ''))
      }
    }
  } catch { /* snippets dir doesn't exist yet */ }

  return snippets.sort(naturalCompare)
}

export async function loadSnippetCSS(vaultPath: string, snippetName: string): Promise<string | null> {
  const path = `${vaultPath}/${configDir()}/snippets/${snippetName}.css`
  return await window.quartzAPI.vault.readFile(path)
}

export function applySnippet(snippetName: string, css: string): void {
  setSnippetStyle(snippetName, css)
}

export function removeSnippet(snippetName: string): void {
  setSnippetStyle(snippetName, null)
}

export function removeAllSnippets(): void {
  setSnippetStyles(new Map())
}

export async function applyEnabledSnippets(vaultPath: string, enabledSnippets: string[]): Promise<void> {
  const m = new Map<string, string>()
  for (const name of enabledSnippets) {
    const css = await loadSnippetCSS(vaultPath, name).catch(() => null)
    if (css) m.set(name, css)
  }
  setSnippetStyles(m)
}
