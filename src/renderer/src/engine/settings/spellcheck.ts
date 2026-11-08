// Spellcheck languages via the Electron session API (what Settings > Editor > "Spellcheck languages"
// drives): available dictionaries, the active ones, and changing them. macOS uses the native
// spellchecker (no list).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { nodeRequire } from '../node'
import { languageDisplayName } from './languageNames'

function session(): any {
  try {
    return nodeRequire<any>('@electron/remote').session?.defaultSession ?? null
  } catch {
    return null
  }
}

export const isNativeSpellchecker = () => /Mac/.test(navigator.platform)

/** Language codes Electron can spellcheck (e.g. `en-US`). */
export function availableSpellcheckLanguages(): string[] {
  try { return (session()?.availableSpellCheckerLanguages ?? []).slice() } catch { return [] }
}

/** The OS locale (`app.getLocale()`), used when no spellcheck languages were chosen. */
export function systemLocale(): string {
  try { return nodeRequire<any>('@electron/remote').app.getLocale() } catch { return navigator.language }
}

/** Apply the chosen languages (null/empty = the system locale) to the session, skipping unavailable ones. */
export function applySpellcheckLanguages(langs: string[] | null): void {
  if (isNativeSpellchecker()) return
  const s = session()
  if (!s) return
  const available: string[] = s.availableSpellCheckerLanguages ?? []
  const wanted = langs && langs.length ? langs : [systemLocale()]
  try { s.setSpellCheckerLanguages(wanted.filter(l => available.includes(l))) } catch { /* unsupported language */ }
}

const LS_KEY = 'spellcheck-languages'

/** `app.getSpellcheckLanguages()`: the user's chosen languages, or null when following the system locale. */
export function getStoredSpellcheckLanguages(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    return Array.isArray(v) ? v : null
  } catch { return null }
}

/** `app.setSpellcheckLanguages(langs)`: store (null/empty clears) and apply. */
export function storeSpellcheckLanguages(langs: string[] | null): void {
  try {
    if (langs && langs.length) localStorage.setItem(LS_KEY, JSON.stringify(langs))
    else localStorage.removeItem(LS_KEY)
  } catch { /* storage unavailable */ }
  applySpellcheckLanguages(langs)
}

/** Human readable name for a language code ("English (United States)"). */
export const languageName = languageDisplayName
