// `app.hotkeyManager` — default + custom hotkeys, persisted as `<configDir>/hotkeys.json` in
// this schema: `{ "<command-id>": [{ "modifiers": ["Mod"], "key": "B" }] }`.
// A custom entry replaces the command's defaults entirely; `[]` means "explicitly unbound".
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Keymap, Scope, KeymapContext } from '../keymap/Keymap'
import { codeToKey, printHotkey, Hotkey } from '../keymap/keys'
import type { Command } from './Commands'

export interface HotkeyConfigStore {
  read(): Promise<unknown>
  write(data: unknown): Promise<void>
}

export interface HotkeyManagerHost {
  scope: Scope
  commands: { findCommand(id: string): Command | undefined; executeCommand(cmd: Command, evt?: any): boolean }
}

interface BakedHotkey { modifiers: string; key: string }

export class HotkeyManager {
  defaultKeys: Record<string, Hotkey[]> = {}
  /** @internal */ baked = false
  /** @internal */ bakedHotkeys: BakedHotkey[] = []
  /** @internal */ bakedIds: string[] = []
  app: HotkeyManagerHost
  /** @internal Where hotkeys.json lives; set by the host when a vault opens. */
  configStore: HotkeyConfigStore | null = null
  private custom: Record<string, Hotkey[]> = {}
  private listeners = new Set<() => void>()
  private reloadTimer: ReturnType<typeof setTimeout> | null = null

  constructor(app: HotkeyManagerHost) {
    this.app = app
    app.scope.register(null, null, this.onTrigger.bind(this))
  }

  /** A shallow copy of the user's custom hotkeys. */
  get customKeys(): Record<string, Hotkey[]> {
    return Object.assign({}, this.custom)
  }

  async save(): Promise<void> {
    if (this.configStore) await this.configStore.write(this.custom)
  }

  async load(): Promise<void> {
    if (!this.configStore) return
    const data = await this.configStore.read()
    if (data && typeof data === 'object') {
      this.custom = (data as Record<string, Hotkey[]>) || {}
      this.baked = false
      this.notify()
    }
  }

  /** Re-read hotkeys.json after an external change (debounced, 50 ms). */
  onConfigFileChange(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => { this.reloadTimer = null; void this.load() }, 50)
  }

  getDefaultHotkeys(id: string): Hotkey[] | undefined {
    return this.defaultKeys[id]
  }

  addDefaultHotkeys(id: string, hotkeys: Hotkey[]): void {
    this.defaultKeys[id] = hotkeys
    this.baked = false
    this.notify()
  }

  removeDefaultHotkeys(id: string): void {
    delete this.defaultKeys[id]
    this.baked = false
    this.notify()
  }

  getHotkeys(id: string): Hotkey[] | undefined {
    return this.custom[id]
  }

  setHotkeys(id: string, hotkeys: Hotkey[]): void {
    this.custom[id] = hotkeys
    this.baked = false
    this.notify()
  }

  removeHotkeys(id: string): void {
    delete this.custom[id]
    this.baked = false
    this.notify()
  }

  /** First effective hotkey of a command as display text, or ''. */
  printHotkeyForCommand(id: string): string {
    const keys = this.getHotkeys(id) || this.getDefaultHotkeys(id)
    return keys && keys.length > 0 ? printHotkey(keys[0]) : ''
  }

  /** Quartz helper: the bindings in effect for a command (custom replaces defaults). */
  getEffectiveHotkeys(id: string): Hotkey[] {
    return Object.prototype.hasOwnProperty.call(this.custom, id) ? this.custom[id] || [] : this.defaultKeys[id] || []
  }

  /** @internal Forget all custom keys (vault switch). */
  removeAllCustom(): void {
    this.custom = {}
    this.baked = false
    this.notify()
  }

  /** Quartz helper: subscribe to any hotkey change (returns unsubscribe). */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try { cb() } catch (e) { console.error(e) }
    }
  }

  /** @internal Flatten custom keys (first) then defaults of non-customised commands. */
  bake(): void {
    if (this.baked) return
    this.baked = true
    const hotkeys: BakedHotkey[] = []
    const ids: string[] = []
    const add = (id: string, list: Hotkey[]) => {
      for (const hk of list) {
        hotkeys.push({ modifiers: Keymap.compileModifiers(hk.modifiers), key: hk.code ? codeToKey(hk.code) : hk.key })
        ids.push(id)
      }
    }
    for (const id in this.custom) if (Object.prototype.hasOwnProperty.call(this.custom, id)) add(id, this.custom[id])
    for (const id in this.defaultKeys) {
      if (Object.prototype.hasOwnProperty.call(this.defaultKeys, id) && !Object.prototype.hasOwnProperty.call(this.custom, id)) add(id, this.defaultKeys[id])
    }
    this.bakedHotkeys = hotkeys
    this.bakedIds = ids
  }

  /** @internal Catch-all handler on the app scope. */
  onTrigger(evt: KeyboardEvent, ctx: KeymapContext): false | void {
    this.bake()
    const { bakedHotkeys, bakedIds } = this
    for (let i = 0; i < bakedHotkeys.length; i++) {
      if (!Keymap.isMatch(bakedHotkeys[i], ctx)) continue
      const cmd = this.app.commands.findCommand(bakedIds[i])
      if (!cmd || (evt.repeat && !cmd.repeatable)) continue
      if (this.app.commands.executeCommand(cmd)) return false
    }
  }
}
