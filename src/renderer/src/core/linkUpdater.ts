// Rename/move with link updating, via app.fileManager.renameFile:
// references are snapshotted by *resolution*, the item is renamed, and only links whose
// resolution changed are rewritten (alias/format preserved; honours alwaysUpdateLinks).
import { getApp } from '@/engine/App'
import { toVaultPath } from '@/stores/metadata'

/** Rename `oldPath` → `newPath` (absolute paths) and update links. Returns false if not handled. */
export async function renameWithLinkUpdate(oldPath: string, newPath: string): Promise<boolean> {
  const app = getApp()
  if (!app) return false
  const file = app.vault.getAbstractFileByPath(toVaultPath(oldPath, app))
  if (!file) return false
  await app.fileManager.renameFile(file, toVaultPath(newPath, app))
  return true
}

/**
 * @deprecated The rename must go through `renameWithLinkUpdate` so links can be
 * snapshotted before the move; kept for callers that already renamed via IPC (no-op).
 */
export async function updateLinksOnRename(_oldPath: string, _newPath: string): Promise<void> {}
