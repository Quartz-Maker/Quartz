// EmptyView ("New tab"), UnknownView ("Plugin no longer active"), DeferredView (placeholder).
import { View, ItemView } from './View'
import { setIcon, setTooltip } from '../workspace/dom'
import { t } from '../workspace/strings'
import type { WorkspaceLeaf } from '../workspace/WorkspaceLeaf'

/** `.text-icon-button.tappable[tabindex=0][role=button] > span.text-button-icon + span.text-button-label` */
export class TextIconButton {
  buttonEl: HTMLElement
  iconEl: HTMLElement
  labelEl: HTMLElement
  disabled = false
  clickCallback: ((evt: MouseEvent | KeyboardEvent) => any) | null = null

  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createDiv({ cls: 'text-icon-button tappable', attr: { tabIndex: 0, role: 'button' } })
    this.iconEl = this.buttonEl.createSpan('text-button-icon')
    this.labelEl = this.buttonEl.createSpan('text-button-label')
    const fire = (e: MouseEvent | KeyboardEvent) => {
      if (!this.disabled) this.clickCallback?.(e)
    }
    this.buttonEl.addEventListener('click', fire)
    this.buttonEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fire(e)
      }
    })
  }
  setIcon(icon: string): this {
    setIcon(this.iconEl, icon)
    return this
  }
  setText(text: string): this {
    this.labelEl.setText(text)
    return this
  }
  addClass(...cls: string[]): this {
    this.buttonEl.addClass(...cls)
    return this
  }
  setDisabled(d: boolean): this {
    this.disabled = d
    this.buttonEl.toggleClass('is-disabled', d)
    return this
  }
  onClick(cb: (evt: MouseEvent | KeyboardEvent) => any): this {
    this.clickCallback = cb
    return this
  }
}

export class EmptyView extends ItemView {
  emptyStateEl: HTMLElement
  clickableAreaEl: HTMLElement
  emptyTitleEl: HTMLElement
  actionListEl: HTMLElement
  canDropAnywhere = true
  navigation = true

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const es = (this.emptyStateEl = this.contentEl.createDiv('empty-state'))
    const area = (this.clickableAreaEl = es.createDiv('empty-state-container'))
    this.emptyTitleEl = area.createDiv({ cls: 'empty-state-title' })
    this.actionListEl = area.createDiv('empty-state-action-list')
  }

  getDisplayText(): string {
    return t.labelNewTab
  }

  getViewType(): string {
    return 'empty'
  }

  protected async onOpen(): Promise<void> {
    const app = this.app
    const list = this.actionListEl
    list.empty()
    const add = (commandId: string, label: string, icon: string) => {
      const b = new TextIconButton(list)
        .setIcon(icon)
        .setText(label)
        .addClass('mod-pill', 'empty-state-action')
        .onClick(evt => app.commands?.executeCommandById(commandId, evt as Event))
      setTooltip(b.buttonEl, label)
      const hk = app.hotkeyManager?.printHotkeyForCommand(commandId)
      if (hk) b.buttonEl.createSpan({ cls: 'empty-state-hotkey', text: ' ' + hk })
    }
    add('file-explorer:new-file', t.newNote, 'lucide-square-pen')
    if (app.internalPlugins?.getEnabledPluginById('bases')) add('bases:new-file', t.newBase, 'lucide-layout-list')
    if (app.internalPlugins?.getEnabledPluginById('canvas')) add('canvas:new-file', t.newCanvas, 'lucide-layout-dashboard')
    if (!(app.vault.isEmpty?.() ?? true)) add('switcher:open', t.goToFile, 'lucide-search')
    if (app.internalPlugins?.getEnabledPluginById('webviewer')) add('webviewer:open', t.openWebViewer, 'globe-2')
  }
}

/** View for a type whose plugin is gone; keeps the state so it round-trips. */
export class UnknownView extends EmptyView {
  viewType: string
  state: Record<string, unknown> = {}
  closeAllButton: TextIconButton | null = null

  constructor(leaf: WorkspaceLeaf, viewType: string) {
    super(leaf)
    // NB: data-type was set from getViewType() during super() — before viewType is assigned —
    // so it reads "undefined".
    this.viewType = viewType
    this.emptyTitleEl.setText(t.unknownPaneTitle)
    const desc = createDiv({ text: t.unknownPaneDesc(viewType) })
    setTooltip(desc, "This pane doesn't look like anything to me.")
    this.clickableAreaEl.insertAfter(desc, this.emptyTitleEl)
  }

  getDisplayText(): string {
    return this.viewType
  }
  getViewType(): string {
    return this.viewType
  }
  getIcon(): string {
    return 'lucide-ghost'
  }
  getState(): Record<string, unknown> {
    return this.state
  }
  async setState(state: any): Promise<void> {
    this.state = state
  }
  onload(): void {
    super.onload()
    this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)))
  }
  protected async onOpen(): Promise<void> {
    const list = this.actionListEl
    list.addClass('mod-unknown')
    new TextIconButton(list)
      .setIcon('lucide-x')
      .setText(t.emptyClose)
      .addClass('mod-pill', 'empty-state-action', 'mod-close')
      .onClick(() => this.leaf.detach())
    const n = this.app.workspace.getLeavesOfType(this.viewType).length
    this.closeAllButton = new TextIconButton(list)
      .setIcon('lucide-x-square')
      .setText(t.emptyCloseAll(this.viewType, n))
      .addClass('mod-pill', 'empty-state-action', 'mod-close')
      .onClick(() => this.app.workspace.getLeavesOfType(this.viewType).forEach(l => l.detach()))
    this.closeAllButton.buttonEl.hide()
  }
  onLayoutChange(): void {
    const n = this.app.workspace.getLeavesOfType(this.viewType).length
    if (!this.closeAllButton) return
    this.closeAllButton.setText(t.emptyCloseAll(this.viewType, n))
    this.closeAllButton.buttonEl.toggle(n > 1)
  }
}

/**
 * Placeholder for a leaf whose view hasn't been shown yet (restored background tabs). Keeps
 * `{type, state, icon, title}` and builds the real view when inserted/clicked or via `loadIfDeferred`.
 */
export class DeferredView extends View {
  viewType: string
  title: string
  state: Record<string, unknown> = {}
  estate: unknown = undefined

  constructor(leaf: WorkspaceLeaf, viewType: string, icon: string, title?: string) {
    super(leaf)
    this.navigation = false
    this.viewType = viewType
    this.icon = icon
    this.title = title || ''
    // data-type stays "undefined" (set during super(), before viewType).
    this.containerEl.onNodeInserted(() => void this.rerender())
    this.containerEl.addEventListener('click', () => void this.rerender())
  }

  getDisplayText(): string {
    return this.title
  }
  getViewType(): string {
    return this.viewType
  }
  getState(): Record<string, unknown> {
    return this.state
  }
  async setState(state: any): Promise<void> {
    this.state = state
  }
  setEphemeralState(e: unknown): void {
    this.estate = e
  }
  async rerender(): Promise<void> {
    const leaf = this.leaf
    if (leaf.view !== this || leaf.working) return
    await leaf.setViewState({ type: this.viewType, state: this.state }, this.estate)
    if (leaf.view !== this) leaf.workspace.requestLayoutChangeEvents()
  }
}
