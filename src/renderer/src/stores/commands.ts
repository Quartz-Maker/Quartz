import { createStore as create } from 'zustand/vanilla'
import { commands, hotkeyManager } from '@/engine/commands'
import type { Command } from '@/engine/commands'
import type { Hotkey, Modifier } from '@/engine/keymap'

export type { Command }

/** Legacy registration shape (plugins/api.ts); converted to an app command. */
export interface LegacyCommand {
  id: string
  name: string
  shortcut?: string
  execute: () => void
}

interface CommandsState {
  paletteOpen: boolean
  quickSwitcherOpen: boolean
  /** Bumped whenever the registry or hotkeys change (for React re-rendering). */
  version: number
  registerCommand: (cmd: LegacyCommand) => void
  openPalette: () => void
  closePalette: () => void
  openQuickSwitcher: () => void
  closeQuickSwitcher: () => void
  /** Runs `app.commands.executeCommandById(id)`. */
  executeCommand: (id: string) => boolean
}

/** "Ctrl+Shift+P" → Hotkey (Ctrl → Mod). */
function parseLegacyShortcut(shortcut: string): Hotkey {
  const parts = shortcut.split('+')
  const key = parts.pop() || ''
  const modifiers = parts.map(p => (p === 'Ctrl' || p === 'Cmd' ? 'Mod' : p)) as Modifier[]
  return { modifiers, key: key.length === 1 ? key.toUpperCase() : key }
}

export const useCommandsStore = create<CommandsState>((set) => ({
  paletteOpen: false,
  quickSwitcherOpen: false,
  version: 0,

  registerCommand: (cmd) => {
    commands.addCommand({
      id: cmd.id,
      name: cmd.name,
      callback: cmd.execute,
      ...(cmd.shortcut ? { hotkeys: [parseLegacyShortcut(cmd.shortcut)] } : {})
    })
  },

  openPalette: () => set({ paletteOpen: true, quickSwitcherOpen: false }),
  closePalette: () => set({ paletteOpen: false }),
  openQuickSwitcher: () => set({ quickSwitcherOpen: true, paletteOpen: false }),
  closeQuickSwitcher: () => set({ quickSwitcherOpen: false }),

  executeCommand: (id) => commands.executeCommandById(id)
}))

const bump = () => useCommandsStore.setState(s => ({ version: s.version + 1 }))
commands.on('changed', bump)
hotkeyManager.subscribe(bump)

/** Re-render when commands or hotkeys change. */
export function useCommandsVersion(): number {
  return useCommandsStore.getState().version
}
