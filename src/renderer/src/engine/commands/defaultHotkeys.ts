// The complete default hotkey table, in registration order — the order decides which command
// wins when two bindings match the same key event.
import type { Hotkey, Modifier } from '../keymap/keys'
import { Platform } from '../keymap/Platform'

const hk = (modifiers: Modifier[], key: string): Hotkey => ({ modifiers, key })

export function buildDefaultHotkeys(isMacOS: boolean): [string, Hotkey[]][] {
  const table: [string, Hotkey[]][] = [
    ['editor:save-file', [hk(['Mod'], 'S')]],
    ['editor:follow-link', [hk(['Alt'], 'Enter')]],
    ['editor:open-link-in-new-leaf', [hk(['Mod'], 'Enter')]],
    ['editor:open-link-in-new-window', [hk(['Mod', 'Alt', 'Shift'], 'Enter')]],
    ['editor:open-link-in-new-split', [hk(['Mod', 'Alt'], 'Enter')]],
    ['workspace:edit-file-title', [hk([], 'F2')]],
    ['workspace:undo-close-pane', [hk(['Mod', 'Shift'], 'T')]],
    ['workspace:next-tab', [hk(['Ctrl'], 'Tab'), isMacOS ? hk(['Meta', 'Shift'], ']') : hk(['Ctrl'], 'PageDown')]]
  ]
  for (let n = 1; n <= 8; n++) table.push([`workspace:goto-tab-${n}`, [hk(['Mod'], String(n))]])
  table.push(
    ['workspace:goto-last-tab', [hk(['Mod'], '9')]],
    ['workspace:previous-tab', [hk(['Ctrl', 'Shift'], 'Tab'), isMacOS ? hk(['Meta', 'Shift'], '[') : hk(['Ctrl'], 'PageUp')]],
    ['workspace:new-tab', [hk(['Mod'], 'T')]],
    ['workspace:close', [hk(['Mod'], 'W')]],
    ['workspace:close-window', [hk(['Mod', 'Shift'], 'W')]],
    ['app:go-back', [hk(['Mod', 'Alt'], 'ArrowLeft')]],
    ['app:go-forward', [hk(['Mod', 'Alt'], 'ArrowRight')]],
    ['app:open-settings', [hk(['Mod'], ',')]],
    ['markdown:toggle-preview', [hk(['Mod'], 'E')]],
    ['markdown:add-metadata-property', [hk(['Mod'], ';')]],
    ['app:open-help', [hk([], 'F1')]],
    ['file-explorer:new-file', [hk(['Mod'], 'N')]],
    ['file-explorer:new-file-in-new-pane', [hk(['Mod', 'Shift'], 'N')]],
    ['editor:open-search', [hk(['Mod'], 'F')]],
    ['editor:open-search-replace', [isMacOS ? hk(['Mod', 'Alt'], 'F') : hk(['Mod'], 'H')]],
    ['editor:insert-link', [hk(['Mod'], 'K')]],
    ['editor:toggle-bold', [hk(['Mod'], 'B')]],
    ['editor:toggle-italics', [hk(['Mod'], 'I')]],
    ['editor:toggle-comments', [hk(['Mod'], '/')]],
    ['editor:toggle-checklist-status', [hk(['Mod'], 'l')]],
    ['editor:delete-paragraph', [hk(['Mod'], 'D')]],
    ['global-search:open', [hk(['Mod', 'Shift'], 'F')]],
    ['switcher:open', [hk(['Mod'], 'O')]],
    ['graph:open', [hk(['Mod'], 'G')]],
    ['command-palette:open', [hk(['Mod'], 'P')]]
  )
  return table
}

/** Default hotkeys for the running platform, keyed by command id (insertion-ordered). */
export const DEFAULT_HOTKEYS: Record<string, Hotkey[]> = Object.fromEntries(buildDefaultHotkeys(Platform.isMacOS))
