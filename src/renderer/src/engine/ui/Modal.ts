// `Modal`, `ConfirmationModal`, `ConfirmationButton` (plugin API, obsidian.d.ts).
//
// DOM: `body > div.modal-container[.mod-dim] > .modal-bg + .modal > .modal-header-button.mod-raised
// .clickable-icon (x) + .modal-header > .modal-title + .modal-content`.
// open(): remembers focus/selection (shouldRestoreSelection), blurs, pushes `scope` (Esc closes),
// appends to the active window's body, calls onOpen(), sets the background opacity (0.85 when
// dimmed), closes menus and tooltips and focuses the first focusable element of the modal.
// close(): pops the scope, detaches, calls onClose() then the close callback, restores focus and
// selection. Clicking the background closes (macOS: only if the pointer moved < 5px since mousedown).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Scope, Keymap } from '../keymap/Keymap'
import { Platform } from '../keymap/Platform'
import { setIcon } from './icons'
import { hideTooltip } from './tooltip'
import { closeAllMenus } from './Menu'
import { clearFocusAndSelection, focusFirst, isAttachedTo, stopAnimation } from './dom'
import { ButtonComponent } from './setting'

interface SavedSelection {
  win: Window
  range: Range | null
  focusEl: Element | null
  focusVisible: boolean
}

function saveSelection(win: Window): SavedSelection | null {
  const sel = win.getSelection()
  if (!sel) return null
  let active: Element | null = win.document.activeElement
  if (active === win.document.body) active = null
  if (active?.tagName === 'IFRAME') {
    const doc = (active as HTMLIFrameElement).contentDocument
    if (doc) active = doc.activeElement
  }
  let range: Range | null = null
  if (active && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0)
    const c = r.commonAncestorContainer
    if (active === c || active.contains(c)) range = r
  }
  let focusVisible = false
  try {
    focusVisible = !!active?.matches(':focus-visible')
  } catch {
    focusVisible = false
  }
  return { win, range, focusEl: active, focusVisible }
}

function restoreSelection(s: SavedSelection | null): void {
  if (!s || (!s.focusEl && !s.range)) return
  const { win, focusEl, range, focusVisible } = s
  win.focus()
  const isEditor = !!focusEl && focusEl instanceof (win as any).HTMLElement && focusEl.classList.contains('cm-content')
  if (range && !isEditor && isAttachedTo(win, range.startContainer) && isAttachedTo(win, range.endContainer)) {
    const sel = win.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  if (focusEl && (focusEl instanceof (win as any).HTMLElement || focusEl instanceof (win as any).SVGElement) && isAttachedTo(win, focusEl)) {
    ;(focusEl as HTMLElement).focus({ preventScroll: true, focusVisible } as any)
  }
}

export interface AppWithKeymap {
  keymap: { pushScope(scope: Scope): void; popScope(scope: Scope): void; updateModifiers?(evt: any): void }
  [k: string]: any
}

export class Modal {
  app: AppWithKeymap
  scope: Scope
  containerEl: HTMLElement
  bgEl: HTMLElement
  modalEl: HTMLElement
  headerEl: HTMLElement
  titleEl: HTMLElement
  contentEl: HTMLElement
  shouldRestoreSelection = true
  /** @internal */ selection: SavedSelection | null = null
  /** @internal */ win: Window | null = null
  /** @internal */ shouldAnimateOpen = true
  /** @internal */ isOpen = false
  /** @internal */ hasInitialInputFocus = true
  /** @internal */ dimBackground = true
  /** @internal */ bgOpacity = '0.85'
  /** @internal */ onCloseCallback: (() => any) | null = null

  constructor(app: AppWithKeymap) {
    this.app = app
    this.scope = new Scope()
    this.scope.register([], 'Escape', this.onEscapeKey.bind(this))
    this.onWindowClose = this.onWindowClose.bind(this)
    this.containerEl = createDiv('modal-container')
    const bg = (this.bgEl = this.containerEl.createDiv('modal-bg'))
    this.modalEl = this.containerEl.createDiv('modal')
    const closeBtn = this.modalEl.createDiv('modal-header-button mod-raised clickable-icon')
    setIcon(closeBtn, 'x')
    this.headerEl = this.modalEl.createDiv('modal-header')
    this.titleEl = this.headerEl.createDiv('modal-title')
    this.contentEl = this.modalEl.createDiv('modal-content')
    this.scope.setTabFocusContainerEl(this.containerEl)
    closeBtn.addEventListener('click', this.close.bind(this))
    if (Platform.isDesktopApp && Platform.isMacOS) {
      let sx = 0
      let sy = 0
      bg.addEventListener('click', e => {
        if (Math.hypot(e.screenX - sx, e.screenY - sy) < 5) this.close()
      })
      bg.addEventListener('mousedown', e => {
        sx = e.screenX
        sy = e.screenY
      })
    } else bg.addEventListener('click', this.onClickOutside.bind(this))
  }

  /** @internal */
  getRootEl(): HTMLElement {
    return this.containerEl
  }

  /** @internal */
  canAnimate(): boolean {
    return Platform.isPhone
  }

  get doc(): Document {
    return this.getRootEl().ownerDocument
  }

  open(): void {
    if (this.isOpen) return
    this.isOpen = true
    const win = (this.win = ((window as any).activeWindow as Window) || window)
    this.selection = this.shouldRestoreSelection ? saveSelection(win) : null
    clearFocusAndSelection(win)
    this.app.keymap.pushScope(this.scope)
    win.document.body.appendChild(this.getRootEl())
    stopAnimation(this.modalEl)
    this.onOpen()
    this.containerEl.toggleClass('mod-dim', this.dimBackground)
    this.bgEl.style.opacity = this.dimBackground ? this.bgOpacity : '0'
    closeAllMenus()
    hideTooltip()
    if (Platform.hasPhysicalKeyboard && this.hasInitialInputFocus) focusFirst(this.modalEl, { preventScroll: true })
    if (win !== window) win.addEventListener('pagehide', this.onWindowClose)
  }

  /** @internal HistoryHandler */
  onHistoryBack(): void {
    this.close()
  }

  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    const win = this.win
    this.app.keymap.popScope(this.scope)
    this.win = null
    closeAllMenus()
    hideTooltip()
    const root = this.getRootEl()
    if (!this.isOpen) {
      root.detach()
      this.onClose()
      this.onCloseCallback?.call(this)
    }
    if (this.shouldRestoreSelection) restoreSelection(this.selection)
    if (win && win !== window) win.removeEventListener('pagehide', this.onWindowClose)
  }

  onOpen(): Promise<void> | void {}

  onClose(): void {}

  /** @internal */
  onWindowClose(): void {
    this.close()
  }

  /** @internal */
  onClickOutside(e: MouseEvent): void {
    if (!e.defaultPrevented && this.canDismiss()) this.close()
  }

  /** @internal */
  canDismiss(): boolean {
    return true
  }

  /** @internal */
  onEscapeKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    e.preventDefault()
    this.close()
  }

  setTitle(title: string): this {
    this.titleEl.setText(title)
    return this
  }

  setContent(content: string | DocumentFragment): this {
    if (typeof content === 'string') this.contentEl.setText(content)
    else this.contentEl.appendChild(content)
    return this
  }

  /** @internal */
  setBackgroundOpacity(opacity: string): this {
    this.bgOpacity = opacity
    return this
  }

  setCloseCallback(callback: () => any): this {
    this.onCloseCallback = callback
    return this
  }

  /** @internal */
  setDimBackground(dim: boolean): this {
    this.dimBackground = dim
    return this
  }
}

/** A button of a ConfirmationModal: closes the modal after its click handler unless it returns true. */
export class ConfirmationButton extends ButtonComponent {
  /** @internal */ isInitialFocus = false
  /** @internal */ handleClose: () => void

  constructor(containerEl: HTMLElement, handleClose: () => void) {
    super(containerEl)
    this.handleClose = handleClose
    super.onClick(() => this.handleClose())
  }

  /** @internal */
  static create(containerEl: HTMLElement, handleClose: () => void): ConfirmationButton {
    return new ConfirmationButton(containerEl, handleClose)
  }

  onClick(callback: (evt: MouseEvent) => unknown | Promise<unknown>): this {
    return super.onClick(async e => {
      if (!(await callback(e))) this.handleClose()
    })
  }

  setInitialFocus(): this {
    this.isInitialFocus = true
    return this
  }

  setSecondary(): this {
    this.buttonEl.addClass('mod-secondary')
    return this
  }

  setCancel(): this {
    this.buttonEl.addClass('mod-cancel')
    return this
  }

  /** @internal */
  setForm(form: { id: string }): this {
    this.buttonEl.type = 'submit'
    this.buttonEl.setAttribute('form', form.id)
    this.onClick(() => true)
    return this
  }
}

export class ConfirmationModal extends Modal {
  buttonContainerEl: HTMLElement
  /** @internal */ buttons: ConfirmationButton[] = []

  constructor(app: AppWithKeymap) {
    super(app)
    this.containerEl.addClass('mod-confirmation')
    this.buttonContainerEl = this.modalEl.createDiv('modal-button-container')
  }

  addClass(cls: string): this {
    this.modalEl.addClass(cls)
    return this
  }

  addCheckbox(label: string, cb: (value: boolean) => any | Promise<any>): this {
    this.buttonContainerEl.createEl('label', { cls: 'mod-checkbox' }, el => {
      const input = el.createEl('input', { attr: { tabindex: -1 }, type: 'checkbox' })
      input.addEventListener('change', () => cb(input.checked))
      el.appendText(label)
    })
    return this
  }

  addButton(cb: (btn: ConfirmationButton) => any): this {
    const b = ConfirmationButton.create(this.buttonContainerEl, () => this.close())
    this.buttons.push(b)
    cb(b)
    return this
  }

  addCancelButton(text?: string): this {
    return this.addButton(b => b.setButtonText(text ?? 'Cancel').setCancel())
  }

  open(): void {
    let initial: ConfirmationButton | undefined
    for (const b of this.buttons) if (b.isInitialFocus) initial = b
    if (initial !== undefined) this.hasInitialInputFocus = false
    super.open()
    if (initial !== undefined && Platform.hasPhysicalKeyboard) initial.buttonEl.focus({ preventScroll: true })
  }

  onClose(): void {
    hideTooltip()
  }
}

/** The app keymap for code that has no `app` (falls back to the global keymap). */
export function defaultKeymapApp(): AppWithKeymap {
  return { keymap: Keymap.init() }
}
