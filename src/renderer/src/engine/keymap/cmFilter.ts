// Drop CodeMirror key bindings that collide with the app's default hotkeys (Mod-i, Mod-d,
// Mod-Enter, Mod-/, Mod-f, Mod-g, Alt-Enter, …): those keys belong to commands
// (dispatched by the capture-phase keymap), never to CodeMirror's own defaults.
import { Keymap } from './Keymap'
import { Platform } from './Platform'
import { DEFAULT_HOTKEYS } from '../commands/defaultHotkeys'

interface CmBinding { key?: string; mac?: string; win?: string; linux?: string }

const CM_MOD: Record<string, string> = { mod: 'Mod', ctrl: 'Ctrl', c: 'Ctrl', control: 'Ctrl', alt: 'Alt', a: 'Alt', shift: 'Shift', s: 'Shift', meta: 'Meta', cmd: 'Meta', m: 'Meta' }

function normaliseCm(spec: string): string | null {
  const parts = spec.split(/-(?!$)/)
  const key = parts.pop()
  if (!key) return null
  const mods: string[] = []
  for (const p of parts) {
    const m = CM_MOD[p.toLowerCase()]
    if (!m) return null
    mods.push(m)
  }
  return Keymap.compileModifiers(mods) + '|' + (key === 'Space' ? ' ' : key).toLowerCase()
}

let appKeys: Set<string> | null = null
function getAppKeys(): Set<string> {
  if (!appKeys) {
    appKeys = new Set()
    for (const list of Object.values(DEFAULT_HOTKEYS)) {
      for (const hk of list) appKeys.add(Keymap.compileModifiers(hk.modifiers) + '|' + hk.key.toLowerCase())
    }
  }
  return appKeys
}

export function withoutAppHotkeys<T extends CmBinding>(bindings: readonly T[]): T[] {
  const taken = getAppKeys()
  const platformKey = (b: CmBinding) => (Platform.isMacOS ? b.mac : Platform.isWin ? b.win : b.linux) ?? b.key
  return bindings.filter(b => {
    const spec = platformKey(b)
    if (!spec) return true
    const n = normaliseCm(spec)
    return !(n && taken.has(n))
  })
}
