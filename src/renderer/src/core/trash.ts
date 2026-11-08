import { useSettingsStore } from '@/stores/settings'

// Delete a vault file/folder honoring the `trashOption` setting (system/local/none).
export async function trashPath(path: string): Promise<boolean> {
  const vaultRoot = (window as any).__quartzVaultPath as string | undefined
  const option = useSettingsStore.getState().settings.trashOption
  if (!vaultRoot) return window.quartzAPI.vault.moveToTrash(path)
  return window.quartzAPI.vault.trash(path, vaultRoot, option)
}
