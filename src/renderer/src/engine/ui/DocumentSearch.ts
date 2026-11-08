/* eslint-disable @typescript-eslint/no-explicit-any */
// In-document find (and replace) bar shared by the editor and reading view (reference: `.document-search-container`
// as the first child of the source view / reading view). Case-insensitive plain-text search.
//   .document-search-container[.mod-replace-mode]
//     .document-search > .search-input-container.document-search-input > input + .document-search-count
//                      + .document-search-buttons (Previous, Next[, Find all]) + .document-search-close-button
//     .document-replace > input.document-replace-input + .document-replace-buttons (Replace, Replace all)
import { setIcon } from './icons'
import { setTooltip } from './tooltip'
import { Scope, Keymap } from '../keymap/Keymap'

export interface SearchBackend {
  /** Recompute matches for `query`; returns the match count and the index to show as current (or -1). */
  find(query: string): { count: number; current: number }
  /** Show match `index` as the current one (highlight + scroll). */
  setCurrent(index: number): void
  clear(): void
  /** Editor only. */
  findAll?(): void
  replace?(index: number, text: string): void
  replaceAll?(text: string): void
  focusBack(): void
}

export class DocumentSearch {
  containerEl: HTMLElement
  searchInputEl: HTMLInputElement
  replaceInputEl: HTMLInputElement
  private countEl: HTMLElement
  private inputWrapEl: HTMLElement
  private count = 0
  private current = -1
  /** Pushed while the bar is open (parent: the app scope), so its keys win over app hotkeys such as
   *  Alt+Enter "Follow link under cursor". */
  private scope: Scope
  private keymap: { pushScope(s: Scope): void; popScope(s: Scope): void }

  constructor(parentEl: HTMLElement, private backend: SearchBackend, private onClose: () => void) {
    const c = (this.containerEl = createDiv('document-search-container'))
    parentEl.prepend(c)
    const row = c.createDiv('document-search')
    this.inputWrapEl = row.createDiv('search-input-container document-search-input')
    this.searchInputEl = this.inputWrapEl.createEl('input', { attr: { type: 'text', placeholder: 'Find...' } })
    this.countEl = this.inputWrapEl.createDiv({ cls: 'document-search-count', text: '0 / 0' })
    this.countEl.style.display = 'none'
    const buttons = row.createDiv('document-search-buttons')
    this.button(buttons, 'lucide-arrow-up', 'Previous\nShift + F3', () => this.step(-1))
    this.button(buttons, 'lucide-arrow-down', 'Next\nF3', () => this.step(1))
    if (backend.findAll) this.button(buttons, 'lucide-text-select', 'Find all\nAlt + Enter', () => this.findAll())
    const close = (backend.findAll ? row : buttons).createDiv('clickable-icon document-search-close-button')
    setIcon(close, 'lucide-x')
    setTooltip(close, 'Exit search', { placement: 'top' })
    close.addEventListener('click', () => this.close())

    const rep = c.createDiv('document-replace')
    this.replaceInputEl = rep.createEl('input', { cls: 'document-replace-input', attr: { type: 'text', placeholder: 'Replace...' } })
    const rb = rep.createDiv('document-replace-buttons')
    this.button(rb, 'lucide-replace', 'Replace\nEnter', () => this.replaceCurrent())
    this.button(rb, 'lucide-replace-all', 'Replace all\nCtrl + Alt + Enter', () => this.replaceAll())

    this.searchInputEl.addEventListener('input', () => this.update())

    const app = (window as any).app
    this.keymap = app?.keymap ?? Keymap.init()
    const sc = (this.scope = new Scope(app?.scope))
    const inSearch = (): boolean => this.searchInputEl.isActiveElement()
    const inReplace = (): boolean => this.replaceInputEl.isActiveElement()
    const inInput = (): boolean => inSearch() || inReplace()
    sc.register([], 'F3', () => (this.step(1), false))
    sc.register(['Mod'], 'G', () => (this.step(1), false))
    sc.register(['Shift'], 'F3', () => (this.step(-1), false))
    sc.register(['Mod', 'Shift'], 'G', () => (this.step(-1), false))
    sc.register([], 'Enter', (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (inReplace()) return this.replaceCurrent(), false
      if (inSearch()) return this.step(1), false
    })
    sc.register(['Shift'], 'Enter', () => {
      if (inSearch()) return this.step(-1), false
    })
    sc.register([], 'Escape', () => (this.close(), false))
    const nextInput = (): false | void => {
      if (!this.containerEl.hasClass('mod-replace-mode')) return
      if (inSearch()) return this.replaceInputEl.focus(), false
      if (inReplace()) return this.searchInputEl.focus(), false
    }
    sc.register([], 'Tab', nextInput)
    sc.register(['Shift'], 'Tab', nextInput)
    sc.register(['Alt'], 'Enter', () => {
      if (inInput()) return this.findAll(), false
    })
    sc.register(['Mod', 'Alt'], 'Enter', () => {
      if (this.containerEl.hasClass('mod-replace-mode') && inReplace()) return this.replaceAll(), false
    })
    this.keymap.pushScope(sc)
  }

  private button(parent: HTMLElement, icon: string, label: string, cb: () => void): void {
    const b = parent.createEl('button', { cls: 'clickable-icon document-search-button' })
    setIcon(b, icon)
    setTooltip(b, label, { placement: 'top' })
    b.addEventListener('click', cb)
  }

  show(replace: boolean): void {
    this.containerEl.toggleClass('mod-replace-mode', replace && !!this.backend.replace)
    const sel = window.getSelection()?.toString()
    if (sel && !sel.includes('\n')) this.searchInputEl.value = sel
    this.searchInputEl.focus()
    this.searchInputEl.select()
    this.update()
  }

  private update(): void {
    const q = this.searchInputEl.value
    const { count, current } = q ? this.backend.find(q) : (this.backend.clear(), { count: 0, current: -1 })
    this.count = count
    this.current = current
    this.inputWrapEl.toggleClass('mod-no-match', !!q && count === 0)
    this.renderCount()
    if (current >= 0) this.backend.setCurrent(current)
  }

  private renderCount(): void {
    this.countEl.style.display = this.searchInputEl.value ? '' : 'none'
    this.countEl.setText(`${this.count ? this.current + 1 : 0} / ${this.count}`)
  }

  step(dir: 1 | -1): void {
    if (!this.count) return
    this.current = (this.current + dir + this.count) % this.count
    this.backend.setCurrent(this.current)
    this.renderCount()
  }

  private findAll(): void {
    if (!this.count || !this.backend.findAll) return
    this.backend.findAll()
    this.close()
  }

  private replaceCurrent(): void {
    if (!this.count || !this.backend.replace) return
    this.backend.replace(this.current, this.replaceInputEl.value)
    const keep = this.current
    this.update()
    if (this.count) {
      this.current = Math.min(keep, this.count - 1)
      this.backend.setCurrent(this.current)
      this.renderCount()
    }
  }

  private replaceAll(): void {
    if (!this.count || !this.backend.replaceAll) return
    this.backend.replaceAll(this.replaceInputEl.value)
    this.update()
  }

  /** Remove the bar without moving focus (the view is going away). */
  destroy(): void {
    this.keymap.popScope(this.scope)
    this.backend.clear()
    this.containerEl.detach()
  }

  close(): void {
    this.keymap.popScope(this.scope)
    this.backend.clear()
    this.containerEl.detach()
    this.onClose()
    this.backend.focusBack()
  }
}

/** Case-insensitive occurrences of `query` in `text`. */
export function findAllPlain(text: string, query: string): number[] {
  const out: number[] = []
  if (!query) return out
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + Math.max(1, q.length))) out.push(i)
  return out
}
