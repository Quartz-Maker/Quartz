/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared sidebar-tree DOM used by the outline and tag views:
//   root: div[style] > div(spacer: width 1px; height 0.1px; margin-bottom 0px) + .tree-item…
//   .tree-item > .tree-item-self.is-clickable[.mod-collapsible] (margin-inline-start: -17·d px,
//     padding-inline-start: 24+17·d px, both !important) > [.tree-item-icon.collapse-icon] + .tree-item-inner [+ .tree-item-flair-outer]
//              + .tree-item-children (spacer + children; "min-height: 0px" when empty)
// Also the `.nav-header` strip with `.nav-action-button`s and the hidden `.search-input-container`.
import { setIcon } from '../../ui/icons'
import { setTooltip } from '../../ui/tooltip'

export const INDENT = 17
export const BASE_PADDING = 24

export class TreeNode {
  el: HTMLElement
  selfEl: HTMLElement
  innerEl: HTMLElement
  childrenEl: HTMLElement
  collapseEl: HTMLElement | null = null
  children: TreeNode[] = []
  parent: TreeNode | null = null
  collapsible = false
  collapsed = false
  /** Called when the user toggles the collapse icon. */
  onToggle: ((node: TreeNode) => void) | null = null
  /** Class-order quirk (see setCollapsible). */
  collapsibleBeforeClickable = false

  constructor(cls = '') {
    this.el = createDiv('tree-item')
    this.selfEl = this.el.createDiv({ cls: ('tree-item-self ' + cls + ' is-clickable').replace(/\s+/g, ' ').trim() })
    this.innerEl = this.selfEl.createDiv('tree-item-inner')
    this.childrenEl = this.el.createDiv('tree-item-children')
  }

  setCollapsible(on: boolean): void {
    if (this.collapsible === on) return
    this.collapsible = on
    this.selfEl.toggleClass('mod-collapsible', on)
    // Tags view: class order is `tag-pane-tag mod-collapsible is-clickable`.
    if (on && this.collapsibleBeforeClickable) {
      this.selfEl.removeClass('is-clickable')
      this.selfEl.addClass('is-clickable')
    }
    if (on) {
      const c = (this.collapseEl = createDiv('tree-item-icon collapse-icon'))
      setIcon(c, 'right-triangle')
      this.selfEl.prepend(c)
      c.addEventListener('click', evt => {
        evt.stopPropagation()
        this.setCollapsed(!this.collapsed)
        this.onToggle?.(this)
      })
    } else {
      this.collapseEl?.detach()
      this.collapseEl = null
      this.setCollapsed(false)
    }
  }

  setCollapsed(on: boolean): void {
    this.collapsed = on && this.collapsible
    this.el.toggleClass('is-collapsed', this.collapsed)
    this.collapseEl?.toggleClass('is-collapsed', this.collapsed)
    // The virtual tree drops the children container of a collapsed item from the DOM.
    if (this.collapsed) this.childrenEl.detach()
    else if (!this.childrenEl.parentElement) this.el.appendChild(this.childrenEl)
  }

  addChild(n: TreeNode): void {
    n.parent = this
    this.children.push(n)
  }
}

/** Builds the DOM of `nodes` under `container` (a tree root div or a `.tree-item-children`). */
export function renderLevel(container: HTMLElement, nodes: TreeNode[], depth: number, visible?: (n: TreeNode) => boolean, filteredOut?: (n: TreeNode) => boolean): void {
  container.empty()
  const shown = visible ? nodes.filter(visible) : nodes
  if (shown.length === 0) {
    if (container.hasClass('tree-item-children')) container.setAttribute('style', 'min-height: 0px;')
    return
  }
  if (container.hasClass('tree-item-children')) {
    container.setAttribute('style', '')
  }
  container.createDiv().setAttribute('style', 'width: 1px; height: 0.1px; margin-bottom: 0px;')
  for (const n of shown) {
    n.selfEl.setAttribute('style', `margin-inline-start: ${-INDENT * depth}px !important; padding-inline-start: ${BASE_PADDING + INDENT * depth}px !important;`)
    container.appendChild(n.el)
    const out = !!filteredOut && filteredOut(n)
    n.el.toggleClass('is-filtered-out', out)
    renderLevel(n.childrenEl, n.children, depth + 1, visible, filteredOut)
    // filtered-out rows keep an (empty) spacer in their children container
    if (out && n.children.length === 0) n.childrenEl.empty(), n.childrenEl.createDiv(), n.childrenEl.removeAttribute('style')
    if (n.collapsed) n.childrenEl.detach()
    else if (!n.childrenEl.parentElement) n.el.appendChild(n.childrenEl)
  }
}

export function walk(nodes: TreeNode[], cb: (n: TreeNode) => void): void {
  for (const n of nodes) {
    cb(n)
    walk(n.children, cb)
  }
}

export interface NavHeader {
  navHeaderEl: HTMLElement
  buttonsEl: HTMLElement
  searchEl: HTMLElement
  inputEl: HTMLInputElement
}

/** `.nav-header > .nav-buttons-container + .search-input-container[display:none]` (prepended to `parent`). */
export function createNavHeader(parent: HTMLElement): NavHeader {
  const navHeaderEl = createDiv('nav-header')
  parent.prepend(navHeaderEl)
  const buttonsEl = navHeaderEl.createDiv('nav-buttons-container')
  const searchEl = navHeaderEl.createDiv('search-input-container')
  const inputEl = searchEl.createEl('input', { attr: { enterkeyhint: 'search', type: 'search', spellcheck: 'false', placeholder: 'Search...' } }) as HTMLInputElement
  const clear = searchEl.createDiv('search-input-clear-button')
  setTooltip(clear, 'Clear search')
  clear.addEventListener('click', () => {
    inputEl.value = ''
    inputEl.dispatchEvent(new Event('input'))
    inputEl.focus()
  })
  searchEl.style.display = 'none'
  return { navHeaderEl, buttonsEl, searchEl, inputEl }
}

export function navButton(parent: HTMLElement, icon: string, label: string, cb: (evt: MouseEvent) => any): HTMLElement {
  const b = parent.createDiv('clickable-icon nav-action-button')
  setIcon(b, icon)
  setTooltip(b, label)
  b.addEventListener('click', cb)
  return b
}

export function setNavButton(b: HTMLElement, icon: string, label: string): void {
  b.empty()
  setIcon(b, icon)
  setTooltip(b, label)
}
