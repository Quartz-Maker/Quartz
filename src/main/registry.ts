// Global vault registry + per-vault window-state files.
//
// The registry is `userData/quartz.json`, written compactly. Per-vault window state lives in `userData/<vaultId>.json`.
//
//   quartz.json  = { vaults: { <16 hex>: { path, ts, open? } }, frame?, language?,
//                    openSchemes?, updateDisabled?, disableGpu?, icon?, insider?, cli?, ... }
//   <id>.json    = { x, y, width, height, isMaximized, devTools, zoom }
import { existsSync, readFileSync, writeFileSync, unlinkSync, accessSync, constants } from 'fs'
import { join, resolve, basename, sep as pathSep } from 'path'
import { randomHex } from './util'

export const REGISTRY_NAME = 'quartz'
/** Legacy Quartz registry (same shape, base-36 ids). Migrated once on first run. */
export const LEGACY_REGISTRY_FILE = 'vaults.json'

export interface VaultEntry {
  path: string
  ts: number
  open?: boolean
}

export interface RegistryConfig {
  vaults: Record<string, VaultEntry>
  frame?: string
  language?: string
  openSchemes?: Record<string, boolean>
  updateDisabled?: boolean
  disableGpu?: boolean
  icon?: string
  insider?: boolean
  cli?: boolean
  [key: string]: unknown
}

export interface WindowState {
  x?: number
  y?: number
  width?: number
  height?: number
  isMaximized?: boolean
  devTools?: boolean
  zoom?: number
}

export const jsonPath = (userData: string, name: string): string => join(userData, name + '.json')

/** Parse `<name>.json`, `{}` on any error. */
export function readJson<T = any>(userData: string, name: string): T {
  try {
    return (JSON.parse(readFileSync(jsonPath(userData, name), 'utf8')) || {}) as T
  } catch (e) {
    return {} as T
  }
}

/** Write `<name>.json` as compact JSON, errors ignored. */
export function writeJson(userData: string, name: string, obj: unknown): void {
  try {
    writeFileSync(jsonPath(userData, name), JSON.stringify(obj))
  } catch (e) {
    console.log('Ignored:', String(e))
  }
}

/** Delete `<name>.json`. */
export function removeJson(userData: string, name: string): void {
  try {
    unlinkSync(jsonPath(userData, name))
  } catch {
    /* ignored */
  }
}

export const isVaultId = (id: string): boolean => /^[0-9a-f]{16}$/.test(id)

/**
 * Convert the legacy Quartz `vaults.json` into the current registry shape: entries keep
 * path/ts/open but non-16-hex ids are replaced by fresh 16-hex ids.
 */
export function migrateLegacyRegistry(legacy: unknown, genId: () => string = () => randomHex(16)): RegistryConfig {
  const out: RegistryConfig = { vaults: {} }
  const vaults = legacy && typeof legacy === 'object' ? (legacy as any).vaults : null
  if (!vaults || typeof vaults !== 'object') return out
  for (const oldId of Object.keys(vaults)) {
    const e = vaults[oldId]
    if (!e || typeof e.path !== 'string' || !e.path) continue
    if (Object.values(out.vaults).some(v => v.path === e.path)) continue
    let id = isVaultId(oldId) && !out.vaults[oldId] ? oldId : genId()
    while (out.vaults[id]) id = genId()
    const entry: VaultEntry = { path: e.path, ts: typeof e.ts === 'number' ? e.ts : Date.now() }
    if (e.open) entry.open = true
    out.vaults[id] = entry
  }
  return out
}

export interface LoadResult {
  config: RegistryConfig
  migrated: boolean
  pruned: string[]
}

/**
 * Startup load: read `quartz.json` (migrating `vaults.json` when
 * the new file is absent), resolve every vault path, and drop entries whose folder no
 * longer exists together with their `<id>.json` window-state file.
 */
export function loadRegistry(userData: string, exists: (p: string) => boolean = existsSync): LoadResult {
  let migrated = false
  let config: RegistryConfig
  if (!exists(jsonPath(userData, REGISTRY_NAME)) && exists(join(userData, LEGACY_REGISTRY_FILE))) {
    let legacy: unknown = null
    try {
      legacy = JSON.parse(readFileSync(join(userData, LEGACY_REGISTRY_FILE), 'utf8'))
    } catch {
      /* corrupt legacy file → empty registry */
    }
    config = migrateLegacyRegistry(legacy)
    migrated = true
  } else {
    config = readJson<RegistryConfig>(userData, REGISTRY_NAME)
  }
  if (!config || typeof config !== 'object') config = { vaults: {} }
  const vaults: Record<string, VaultEntry> =
    config.vaults && typeof config.vaults === 'object' ? config.vaults : {}
  const pruned: string[] = []
  for (const id of Object.keys(vaults)) {
    const v = vaults[id]
    if (v && typeof v.path === 'string' && v.path) v.path = resolve(v.path)
    if (!v || !v.path || !exists(v.path)) {
      delete vaults[id]
      removeJson(userData, id)
      pruned.push(id)
    }
  }
  config.vaults = vaults
  if (migrated) writeJson(userData, REGISTRY_NAME, config)
  return { config, migrated, pruned }
}

/** Is `p` the vault root or inside it. */
export function vaultContains(vaultPath: string, p: string, sep: string = pathSep): boolean {
  return p === vaultPath || p.startsWith(vaultPath + sep)
}

/** First vault containing `p` (resolved). */
export function vaultIdForPath(vaults: Record<string, VaultEntry>, p: string, sep: string = pathSep): string | null {
  const r = resolve(p)
  for (const id in vaults) if (vaultContains(vaults[id].path, r, sep)) return id
  return null
}

/** Longest-prefix vault containing `p` (used by `quartz:///abs` URIs and open-file). */
export function deepestVaultForPath(
  vaults: Record<string, VaultEntry>,
  p: string,
  sep: string = pathSep
): { id: string; root: string } | null {
  let best = ''
  let bestId: string | null = null
  for (const id in vaults) {
    const root = vaults[id].path
    if (vaultContains(root, p, sep) && best.length < root.length) {
      best = root
      bestId = id
    }
  }
  return bestId ? { id: bestId, root: best } : null
}

/** Vault by id or case-insensitive folder name. */
export function vaultIdByNameOrId(vaults: Record<string, VaultEntry>, s: string): string | null {
  for (const id in vaults) {
    if (id === s || basename(vaults[id].path).toUpperCase() === s.toUpperCase()) return id
  }
  return null
}

/** Read+write access test. */
export function canReadWrite(p: string): boolean {
  try {
    accessSync(p, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Registry half of `vault-open`. Returns the vault id to open (existing entry gets `ts`
 * bumped; unknown path gets a fresh 16-hex id) or an error string.
 */
export function registerVaultPath(
  vaults: Record<string, VaultEntry>,
  p: unknown,
  opts: { exists?: (p: string) => boolean; access?: (p: string) => boolean; now?: () => number; genId?: () => string } = {}
): { id: string } | { error: string } {
  const exists = opts.exists ?? existsSync
  const access = opts.access ?? canReadWrite
  const now = opts.now ?? Date.now
  const genId = opts.genId ?? (() => randomHex(16))
  if (!p || typeof p !== 'string') return { error: 'folder not found' }
  const path = resolve(p)
  if (!exists(path)) return { error: 'folder not found' }
  if (!access(path)) return { error: 'no permission to access folder' }
  for (const id in vaults) {
    if (vaults[id].path === path) {
      vaults[id].ts = now()
      return { id }
    }
  }
  const id = genId()
  vaults[id] = { path, ts: now() }
  return { id }
}
