// Hotkeys now live in the hotkey manager (`app.hotkeyManager`), persisted as
// `<vault>/.quartz/hotkeys.json`. This module keeps the old entry point.
import { hotkeyManager, loadVaultHotkeys } from '@/engine/commands'

export type { Hotkey as HotkeyBinding } from '@/engine/keymap'

export const useHotkeysStore = {
  getState: () => ({
    loadHotkeys: (vaultPath: string) => loadVaultHotkeys(vaultPath),
    saveHotkeys: () => hotkeyManager.save()
  })
}
