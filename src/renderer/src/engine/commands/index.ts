// App-wide keymap, command registry and hotkey manager singletons (`app.keymap`,
// `app.scope`, `app.commands`, `app.hotkeyManager`). The future `App` object should expose these.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Keymap, Scope } from '../keymap/Keymap'
import { Commands, ActiveEditorInfo } from './Commands'
import { HotkeyManager } from './HotkeyManager'

export { Commands } from './Commands'
export type { Command, ActiveEditorInfo } from './Commands'
export { HotkeyManager } from './HotkeyManager'
export { DEFAULT_HOTKEYS, buildDefaultHotkeys } from './defaultHotkeys'

let activeEditorProvider: () => ActiveEditorInfo | null = () => null

export interface CommandApp {
  keymap: Keymap
  scope: Scope
  commands: Commands
  hotkeyManager: HotkeyManager
  workspace: { readonly activeEditor: ActiveEditorInfo | null }
  lastEvent: any
}

const keymap = Keymap.init()
export const commandApp = {
  keymap,
  scope: keymap.getRootScope(),
  lastEvent: null,
  workspace: { get activeEditor() { return activeEditorProvider() } }
} as unknown as CommandApp
commandApp.commands = new Commands(commandApp)
commandApp.hotkeyManager = new HotkeyManager(commandApp)

export const commands = commandApp.commands
export const hotkeyManager = commandApp.hotkeyManager
export { keymap }

/** Supply `app.workspace.activeEditor` (used by editorCallback / editorCheckCallback). */
export function setActiveEditorProvider(fn: () => ActiveEditorInfo | null): void {
  activeEditorProvider = fn
}

/** Point the hotkey manager at `<vault>/.quartz/hotkeys.json` and load it. */
export async function loadVaultHotkeys(vaultPath: string, configDir = '.quartz'): Promise<void> {
  const dir = `${vaultPath}/${configDir}`
  const file = `${dir}/hotkeys.json`
  hotkeyManager.removeAllCustom()
  hotkeyManager.configStore = {
    async read() {
      const text = await window.quartzAPI.vault.readFile(file)
      if (text == null) return null
      try {
        const data = JSON.parse(text)
        // Drop entries from Quartz's legacy schema ({ id: binding | null }).
        if (data && typeof data === 'object') for (const k of Object.keys(data)) if (!Array.isArray(data[k])) delete data[k]
        return data
      } catch (e) { console.error('failed to read JSON', file, e); return undefined }
    },
    async write(data) {
      await window.quartzAPI.vault.createDir(dir)
      await window.quartzAPI.vault.writeFile(file, JSON.stringify(data, undefined, 2))
    }
  }
  await hotkeyManager.load()
}
