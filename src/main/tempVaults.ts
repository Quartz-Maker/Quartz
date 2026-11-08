// Temporary vaults. A file or folder opened from the OS ("Open with",
// default .md app, argv) that is not inside a registered vault opens in a vault rooted at that folder (a file: its
// parent folder). Its config dir lives under `<userData>/temp-vaults/<id>/` instead of `<folder>/.quartz`, it is never
// written to quartz.json or listed in the starter, and both the entry and its config are removed when its window
// closes — nothing is created next to the user's files.
import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs'
import { join, resolve, sep } from 'path'
import { R, tempConfigDirs, userData } from './coreState'
import { randomHex } from './util'

/** Config dir name the renderer uses (Vault DEFAULT_CONFIG_DIR). */
export const TEMP_CONFIG_DIR = '.quartz'

const tempRoot = (): string => join(userData || app.getPath('userData'), 'temp-vaults')

export const isTempVault = (id: string): boolean => tempConfigDirs.has(id)

/** Vault id of a temp vault rooted at exactly `root`, or null. */
function tempVaultAt(root: string): string | null {
  for (const id of tempConfigDirs.keys()) if (R[id] && resolve(R[id].path) === root) return id
  return null
}

/** Create (or reuse) a temp vault rooted at `folder`; returns its id. */
export function openTempVault(folder: string): string {
  const root = resolve(folder)
  const existing = tempVaultAt(root)
  if (existing) return existing
  let id = randomHex(16)
  while (R[id]) id = randomHex(16)
  const dir = join(tempRoot(), id)
  mkdirSync(dir, { recursive: true })
  tempConfigDirs.set(id, dir)
  R[id] = { path: root, ts: Date.now() }
  return id
}

/** Drop a temp vault's registry entry and delete its config dir (window closed). */
export function closeTempVault(id: string): void {
  const dir = tempConfigDirs.get(id)
  if (!dir) return
  tempConfigDirs.delete(id)
  delete R[id]
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.error(e)
  }
}

/** Remove config dirs left behind by a crash (no temp vault survives a restart). */
export function purgeStaleTempVaults(): void {
  const root = tempRoot()
  if (!existsSync(root)) return
  for (const name of readdirSync(root)) {
    if ([...tempConfigDirs.values()].includes(join(root, name))) continue
    try {
      rmSync(join(root, name), { recursive: true, force: true })
    } catch {
      /* in use */
    }
  }
}

/** Absolute path → where it really lives: `<temp root>/.quartz/…` maps into the temp vault's config dir. */
export function redirectTempConfigPath(p: string): string {
  if (typeof p !== 'string' || tempConfigDirs.size === 0) return p
  const abs = resolve(p)
  for (const [id, dir] of tempConfigDirs) {
    if (!R[id]) continue
    const prefix = join(resolve(R[id].path), TEMP_CONFIG_DIR)
    if (abs === prefix) return dir
    if (abs.startsWith(prefix + sep)) return join(dir, abs.slice(prefix.length + 1))
  }
  return p
}
