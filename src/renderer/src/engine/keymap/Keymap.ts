// Plugin API `Scope` + `Keymap`.
//
// A single *capture-phase* `keydown` listener per window resolves the window's current scope
// (a stack: modals push scopes on top) and walks it, then its parent chain. A handler returning
// `false` makes the keymap call preventDefault() + stopPropagation(), so neither the focused
// element nor CodeMirror ever sees a key that was consumed by a scope / hotkey.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform } from './Platform'
import { getEventKey, getEventVKey, Modifier } from './keys'

export type PaneType = 'tab' | 'split' | 'window'
export type UserEvent = MouseEvent | KeyboardEvent | TouchEvent | PointerEvent

export interface KeymapInfo {
  modifiers: string | null
  key: string | null
}

export interface KeymapContext extends KeymapInfo {
  vkey: string
}

export type KeymapEventListener = (evt: KeyboardEvent, ctx: KeymapContext) => false | any

export interface KeymapEventHandler extends KeymapInfo {
  scope: Scope
  func: KeymapEventListener
}

export class Scope {
  /** @internal */ keys: KeymapEventHandler[] = []
  /** @internal */ parent: Scope | undefined
  /** @internal */ win: Window | null = null
  /** @internal */ tabFocusContainerEl: HTMLElement | null = null

  constructor(parent?: Scope) {
    this.parent = parent
  }

  register(modifiers: Modifier[] | null, key: string | null, func: KeymapEventListener): KeymapEventHandler {
    const handler: KeymapEventHandler = {
      scope: this,
      modifiers: modifiers ? Keymap.compileModifiers(modifiers) : null,
      key,
      func
    }
    this.keys.push(handler)
    return handler
  }

  unregister(handler: KeymapEventHandler): void {
    const i = this.keys.indexOf(handler)
    if (i !== -1) this.keys.splice(i, 1)
  }

  /** @internal Keep keyboard focus inside `el` while this scope is active. */
  setTabFocusContainerEl(el: HTMLElement | null): void {
    this.tabFocusContainerEl = el
  }

  /**
   * @internal Run matching handlers in registration order. A handler's non-undefined return
   * value ends the walk; so does an `undefined` return from a handler bound to a specific key
   * or modifier set. Only catch-all handlers (`null`, `null`) fall through, then the parent.
   */
  handleKey(evt: KeyboardEvent, ctx: KeymapContext): false | any {
    for (const handler of this.keys.slice()) {
      if (!Keymap.isMatch(handler, ctx)) continue
      const res = handler.func(evt, ctx)
      if (res !== undefined) return res
      if (handler.key !== null || handler.modifiers !== null) return res
    }
    if (this.parent) return this.parent.handleKey(evt, ctx)
    return undefined
  }
}

interface WindowStack {
  scope: Scope
  prevScopes: Scope[]
}

const currentWindow = (): Window => ((globalThis as any).activeWindow as Window) || window

function focusFirstFocusable(container: HTMLElement): boolean {
  const el = container.querySelector<HTMLElement>(
    'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
  )
  if (!el) return false
  el.focus({ preventScroll: true })
  return true
}

export class Keymap {
  static global: Keymap | null = null

  /** @internal */ modifiers = ''
  /** @internal */ rootScope: Scope
  private windowScopes = new WeakMap<Window, WindowStack>()

  /** @param win window to attach to (`null`: attach later with registerWindow, used by tests). */
  constructor(win: Window | null = window) {
    this.rootScope = new Scope()
    if (win) {
      win.addEventListener('keydown', this.onKeyEvent.bind(this), true)
      win.addEventListener('focusin', this.onFocusIn.bind(this))
    }
  }

  /** The app-wide keymap (created on first use). */
  static init(): Keymap {
    if (!Keymap.global) Keymap.global = new Keymap()
    return Keymap.global
  }

  getRootScope(): Scope {
    return this.rootScope
  }

  /** @internal */
  getWindowStack(win: Window): WindowStack {
    let stack = this.windowScopes.get(win)
    if (!stack) {
      stack = { scope: this.rootScope, prevScopes: [] }
      this.windowScopes.set(win, stack)
    }
    return stack
  }

  /** @internal Attach the keymap to a popout window; returns a detach function. */
  registerWindow(win: Window): () => void {
    const onKey = this.onKeyEvent.bind(this)
    const onFocus = this.onFocusIn.bind(this)
    win.addEventListener('keydown', onKey, true)
    win.addEventListener('focusin', onFocus)
    return () => {
      win.removeEventListener('keydown', onKey, true)
      win.removeEventListener('focusin', onFocus)
    }
  }

  /** @internal */
  setWindowBaseScope(win: Window, scope: Scope): void {
    this.getWindowStack(win).scope = scope
  }

  pushScope(scope: Scope): void {
    const win = currentWindow()
    const stack = this.getWindowStack(win)
    if (stack.scope === scope) return
    stack.prevScopes.push(stack.scope)
    stack.scope = scope
    scope.win = win
  }

  popScope(scope: Scope): void {
    if (scope === this.rootScope) return
    const win = scope.win
    if (!win) return
    const stack = this.getWindowStack(win)
    if (stack.scope === scope) stack.scope = stack.prevScopes.pop() || this.rootScope
    else {
      const i = stack.prevScopes.indexOf(scope)
      if (i !== -1) stack.prevScopes.splice(i, 1)
    }
    scope.win = null
  }

  /** @internal Capture-phase keydown handler. */
  onKeyEvent(evt: KeyboardEvent): false | void {
    this.updateModifiers(evt)
    const scope = this.getWindowStack(currentWindow()).scope
    if (!scope) return
    const key = getEventKey(evt as any)
    if (Keymap.isModifierKey(key)) return
    let vkey = getEventVKey(evt as any)
    // AZERTY: the "^" dead key on the I position reports keyCode 54.
    if ((evt.which || evt.keyCode) === 54 && evt.key === '^' && evt.code === 'KeyI') vkey = 'KeyI'
    const ctx: KeymapContext = { modifiers: this.modifiers, key, vkey }
    if (scope.handleKey(evt, ctx) === false) {
      evt.preventDefault()
      evt.stopPropagation()
      return false
    }
  }

  /** @internal */
  onFocusIn(evt: FocusEvent): void {
    const stack = this.getWindowStack(currentWindow())
    const scope = stack.scope
    if (!scope || !scope.tabFocusContainerEl) return
    const container = scope.tabFocusContainerEl
    const target = evt.target as Node | null
    const doc = container.ownerDocument
    if (!target || target === doc.body || !(target instanceof Element) || container.contains(target)) return
    setTimeout(() => {
      if (stack.scope !== scope) return
      if (!focusFirstFocusable(container)) {
        const active = doc.activeElement
        if (active instanceof HTMLElement) active.blur()
      }
    }, 0)
  }

  /** @internal */
  updateModifiers(evt: KeyboardEvent | MouseEvent): void {
    this.modifiers = Keymap.getModifiers(evt)
  }

  /** @internal Compiled modifier string of an event, e.g. `Alt,Ctrl,Shift`. */
  static getModifiers(evt: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
    const mods: Modifier[] = []
    if (evt.ctrlKey) mods.push('Ctrl')
    if (evt.metaKey) mods.push('Meta')
    if (evt.altKey) mods.push('Alt')
    if (evt.shiftKey) mods.push('Shift')
    return Keymap.compileModifiers(mods)
  }

  /** @internal `Mod` → `Meta` (macOS) / `Ctrl`; sorted, comma-joined. */
  static compileModifiers(mods: string[]): string {
    return mods.map(m => (m === 'Mod' ? (Platform.isMacOS ? 'Meta' : 'Ctrl') : m)).sort().join(',')
  }

  /** @internal Inverse of compileModifiers (platform primary modifier becomes `Mod`). */
  static decompileModifiers(compiled: string): Modifier[] {
    return compiled
      .split(',')
      .map(m => (Platform.isMacOS && m === 'Meta' ? 'Mod' : !Platform.isMacOS && m === 'Ctrl' ? 'Mod' : m))
      .filter(m => m) as Modifier[]
  }

  /** @internal */
  static isModifierKey(key: string): boolean {
    return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'OS' || key === 'Meta'
  }

  /** @internal Do the modifiers of the last key event equal `compiled`? */
  matchModifiers(compiled: string): boolean {
    return this.modifiers === compiled
  }

  /** @internal */
  hasModifier(mod: Modifier): boolean {
    return Keymap.decompileModifiers(this.modifiers).indexOf(mod) !== -1
  }

  static isModifier(evt: MouseEvent | TouchEvent | KeyboardEvent, modifier: Modifier): boolean {
    const e = evt as KeyboardEvent
    if (modifier === 'Ctrl') return e.ctrlKey
    if (modifier === 'Meta') return e.metaKey
    if (modifier === 'Alt') return e.altKey
    if (modifier === 'Shift') return e.shiftKey
    return modifier === 'Mod' && (Platform.isMacOS ? e.metaKey : e.ctrlKey)
  }

  /** @internal */
  static isMatch(handler: KeymapInfo, ctx: KeymapContext): boolean {
    const { modifiers, key } = handler
    if (modifiers !== null && modifiers !== ctx.modifiers) return false
    if (!key) return true
    if (key === ctx.vkey) return true
    return !!ctx.key && key.toLowerCase() === ctx.key.toLowerCase()
  }

  /**
   * Pane type requested by a user event: middle click → 'tab'; Mod → 'tab', Mod+Alt → 'split',
   * Mod+Alt+Shift → 'window'; otherwise false.
   */
  static isModEvent(evt?: UserEvent | null): PaneType | boolean {
    if (!evt) return false
    if (isMouseLike(evt) && (evt as MouseEvent).button === 1) return 'tab'
    if (!Keymap.isModifier(evt, 'Mod')) return false
    if (!Keymap.isModifier(evt, 'Alt')) return 'tab'
    return Keymap.isModifier(evt, 'Shift') ? 'window' : 'split'
  }
}

function isMouseLike(evt: any): boolean {
  if (typeof evt.instanceOf === 'function') return evt.instanceOf(MouseEvent) || (typeof PointerEvent !== 'undefined' && evt.instanceOf(PointerEvent))
  return evt instanceof MouseEvent || (typeof PointerEvent !== 'undefined' && evt instanceof PointerEvent)
}
