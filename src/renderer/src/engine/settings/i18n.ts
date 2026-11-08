// Tiny i18next-style lookup over the generated English strings.
import { STRINGS } from './strings'

/** User-visible product name. UI text must say "Quartz". */
export const APP_NAME = 'Quartz'

/** Safety net only: strings.ts already says "Quartz". Protocol/module identifiers (obsidian://, require('obsidian')) never pass through here. */
export function brand(s: string): string {
  return s.replace(/\bObsidian\b/g, APP_NAME)
}

/** `t('key', {count: 2})`: `{{var}}` interpolation; `key_plural` is used when `count !== 1`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s: string | undefined
  if (vars && typeof vars.count === 'number' && vars.count !== 1) s = STRINGS[key + '_plural']
  s = s ?? STRINGS[key] ?? key
  if (vars) s = s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k]) : _m))
  return brand(s)
}
