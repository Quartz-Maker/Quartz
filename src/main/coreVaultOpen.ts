// Quartz main process — opening vaults from quartz:// URIs and file paths (split out of core.ts).
import { app, dialog } from 'electron'
import { statSync } from 'fs'
import { resolve, dirname } from 'path'
import { registerVaultPath, vaultContains, deepestVaultForPath } from './registry'
import { parseUri, resolveUriTarget } from './uri'
import { S } from './strings'
import { isWin, type QWindow, R, Y, saveConfig } from './coreState'
import { focusedVaultId, openVaultWindow, openStarter } from './coreWindows'
import { openTempVault } from './tempVaults'

/** Reopen every vault flagged `open`; starter when none. */
export function reopenVaults(): void {
  for (const id in R) if (R[id].open) openVaultWindow(id)
  if (Object.keys(Y).length === 0) openStarter()
}

/** Call (or queue) `window[name](data)` in the page. */
export function callPage(name: 'OBS_ACT' | 'OBS_OPEN_FILE', w: QWindow, data: unknown): void {
  const js = `(function(){var w=window,o=${JSON.stringify(data)};if(typeof w.${name} === "function"){w.${name}(o)}else{w.${name}=o}})()`
  const wc = w.webContents
  if (w.loaded) wc.executeJavaScript(js).catch(() => {})
  else wc.once('did-finish-load', () => wc.executeJavaScript(js).catch(() => {}))
}

/** Send `params` as an OBS_ACT action to the vault's window. */
export function sendAction(id: string, params: unknown): void {
  callPage('OBS_ACT', openVaultWindow(id, false), params)
}

/** Open a file in a vault window (vault file → OBS_ACT open, else external). */
export function openFileInVault(id: string, p: string): void {
  const w = openVaultWindow(id)
  if (vaultContains(R[id].path, p)) callPage('OBS_ACT', w, { action: 'open', file: p.substring(R[id].path.length) })
  else callPage('OBS_OPEN_FILE', w, p)
}

/** Handle a `quartz://` URL. */
export function handleUri(url: string): void {
  const parsed = parseUri(url, isWin)
  if (!parsed) return
  console.log('Received callback URL', url)
  if (parsed.kind === 'starter') {
    openStarter()
    return
  }
  const target = resolveUriTarget(parsed.params, R)
  let id: string | null = null
  if (target.kind === 'vault') id = target.vaultId
  else if (target.kind === 'focused') {
    id = focusedVaultId()
    if (!id) reopenVaults()
    id = focusedVaultId()
  }
  if (id) sendAction(id, target.params)
  else dialog.showErrorBox(S.vaultNotFoundTitle, S.vaultNotFoundMessage(url))
}

/** Handle an OS open-file / argv path. */
export function handleOpenPath(p: string): void {
  console.log('Received file path', p)
  p = resolve(p)
  let isFile = false
  try {
    isFile = statSync(p).isFile()
  } catch {
    /* missing */
  }
  const hit = deepestVaultForPath(R, p)
  if (!isFile) {
    // A folder outside every vault opens as a temp vault.
    openVaultWindow(hit ? hit.id : openTempVault(p))
    return
  }
  if (hit) {
    openFileInVault(hit.id, p)
    return
  }
  // A file outside every vault opens in a temp vault rooted at its folder, so links and embeds next to it resolve and no vault gets an unrelated file.
  openFileInVault(openTempVault(dirname(p)), p)
}

/** Registry + window half of `vault-open`. */
export function openVaultPath(p: unknown): true | string {
  const r = registerVaultPath(R, p)
  if ('error' in r) return r.error
  saveConfig()
  openVaultWindow(r.id)
  try {
    app.addRecentDocument(R[r.id].path)
  } catch {
    /* unsupported platform */
  }
  return true
}
