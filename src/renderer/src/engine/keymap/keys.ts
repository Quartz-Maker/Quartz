// Key normalisation and hotkey printing.
// The keyCode → "vkey" table makes bindings layout-tolerant: a binding matches either the
// produced `event.key` (case-insensitive) or the vkey derived from the physical keyCode.
import { Platform } from './Platform'

export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt'

export interface Hotkey {
  modifiers: Modifier[]
  key: string
  /** Legacy field (still honoured): `KeyX` → `X`. */
  code?: string
}

/** keyCode → key name. */
export const KEYCODE_NAMES: Record<number, string> = {
  3: 'Cancel', 6: 'Help', 8: 'Backspace', 9: 'Tab', 12: 'Clear', 13: 'Enter', 16: 'Shift', 17: 'Control', 18: 'Alt',
  19: 'Pause', 20: 'CapsLock', 27: 'Escape', 28: 'Convert', 29: 'NonConvert', 30: 'Accept', 31: 'ModeChange', 32: ' ',
  33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
  41: 'Select', 42: 'Print', 43: 'Execute', 44: 'PrintScreen', 45: 'Insert', 46: 'Delete',
  48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
  91: 'OS', 93: 'ContextMenu', 95: 'Sleep', 106: '*', 107: '+', 109: '-', 110: '.', 111: '/', 144: 'NumLock',
  145: 'ScrollLock', 181: 'VolumeMute', 182: 'VolumeDown', 183: 'VolumeUp', 186: ';', 187: '=', 188: ',', 189: '-',
  190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: "'", 224: 'Meta', 225: 'AltGraph', 246: 'Attn',
  247: 'CrSel', 248: 'ExSel', 249: 'EraseEof', 250: 'Play', 251: 'ZoomOut'
}
for (let i = 1; i < 25; i++) KEYCODE_NAMES[111 + i] = 'F' + i
for (let i = 65; i < 91; i++) KEYCODE_NAMES[i] = String.fromCharCode(i).toUpperCase()
for (let i = 96; i < 106; i++) KEYCODE_NAMES[i] = 'Numpad' + String.fromCharCode(i - 48)

const KEY_LABELS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space' }

export const MODIFIER_LABELS: Record<Modifier, string> = Platform.isMacOS
  ? { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' }
  : { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' }

export const MODIFIER_ORDER: Modifier[] = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift']

interface KeyLike { key?: string; which?: number; keyCode?: number }

/** `event.key`, falling back to the keyCode table when the browser gives none. */
export function getEventKey(e: KeyLike): string {
  let key = e.key
  if (!key) key = KEYCODE_NAMES[e.which || e.keyCode || 0]
  return key
}

/** Layout-independent key name from the keyCode (unknown codes become `Key<n>`). */
export function getEventVKey(e: KeyLike): string {
  const code = e.which || e.keyCode || 0
  return KEYCODE_NAMES[code] || 'Key' + code
}

/** `KeyX` → `X`; anything else unchanged. */
export function codeToKey(code: string): string {
  return code.startsWith('Key') && code.length === 4 ? code.charAt(3) : code
}

function keyLabel(key: string): string {
  if (Object.prototype.hasOwnProperty.call(KEY_LABELS, key)) return KEY_LABELS[key]
  const spaced = key.replace(/([A-Z])/g, ' $1').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Human-readable hotkey: `Ctrl + Shift + P` (macOS: `⌘ ⇧ P`). */
export function printHotkey(hotkey: Hotkey): string {
  const parts: string[] = []
  for (const m of MODIFIER_ORDER) if (hotkey.modifiers.indexOf(m) !== -1) parts.push(MODIFIER_LABELS[m])
  const key = (hotkey.code ? codeToKey(hotkey.code) : hotkey.key) || ''
  parts.push(keyLabel(key))
  return parts.join(Platform.isMacOS ? ' ' : ' + ')
}
