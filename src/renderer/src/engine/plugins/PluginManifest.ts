// Plugin API `PluginManifest` (no `main` field: main.js / styles.css by convention).
export interface PluginManifest {
  id: string
  name: string
  version: string
  minAppVersion: string
  description: string
  author: string
  authorUrl?: string
  fundingUrl?: string | Record<string, string>
  isDesktopOnly?: boolean
  /** Runtime: vault-relative folder of the plugin. */
  dir?: string
}

/** Normalises a parsed manifest (author "obsidian" is blanked). */
export function normalizeManifest(raw: any, dir: string): PluginManifest | null {
  if (!raw || typeof raw !== 'object' || !raw.id || typeof raw.id !== 'string') return null
  const m: PluginManifest = raw
  m.dir = dir
  if (typeof m.author === 'string' && m.author.toLowerCase() === 'obsidian') m.author = ''
  return m
}
