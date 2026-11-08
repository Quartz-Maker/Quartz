// Small Live Preview widgets and the shared decorations.
//
// Hidden formatting is a plain `Decoration.replace({})`, which CM6 renders as an empty
// `<span contenteditable="false">` flanked by `img.cm-widgetBuffer`s.
// Three distinct replace instances exist because cursor snapping treats them differently:
//   HIDE      snap a caret inside the range to its start,
//   HIDE_END  snap to its end,
//   HIDE_LINE (header marks) snap to the start only for multi-line selections.
import { Decoration, WidgetType } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import { setIcon, setTooltip } from '../../workspace/dom'

export const HIDE = Decoration.replace({})
export const HIDE_LINE = Decoration.replace({})
export const HIDE_END = Decoration.replace({})

/** Rendered link text. */
export const underlineMark = Decoration.mark({ class: 'cm-underline', attributes: { tabIndex: '-1', draggable: 'true' } })
/** First-level quote marker. */
export const transparentMark = Decoration.mark({ class: 'cm-transparent' })
/** Unresolved internal link text. */
export const unresolvedMark = Decoration.mark({ class: 'is-unresolved' })
export const listBulletMark = Decoration.mark({ class: 'list-bullet' })
export const listNumberMark = Decoration.mark({ class: 'list-number' })

function span(cls: string, text?: string): HTMLSpanElement {
  const el = document.createElement('span')
  if (cls) el.className = cls
  if (text != null) el.textContent = text
  return el
}

/** Deeper quote levels: the `>` is replaced by a border span. */
class BlockquoteBorderWidget extends WidgetType {
  toDOM() { return span('cm-blockquote-border cm-transparent', '>') }
}
export const blockquoteBorder = Decoration.replace({ widget: new BlockquoteBorderWidget() })

/** `---` rendered as a block `div.hr.cm-line > br + hr`; clicking selects the source line. */
export class HrWidget extends WidgetType {
  eq() { return true }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'hr cm-line'
    el.appendChild(document.createElement('br'))
    el.addEventListener('click', () => {
      const line = view.state.doc.lineAt(view.posAtDOM(el))
      view.dispatch({ selection: { head: line.from, anchor: line.to } })
    })
    el.appendChild(document.createElement('hr'))
    return el
  }
  get estimatedHeight() { return 20 }
}
export const hrWidget = new HrWidget()

/** Task checkbox: `label.task-list-label > input.task-list-item-checkbox[data-task]`. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly content: string) { super() }
  eq(other: CheckboxWidget) { return other.content === this.content }
  updateDOM(dom: HTMLElement) {
    if (dom instanceof HTMLLabelElement && dom.firstChild instanceof HTMLInputElement) {
      const input = dom.firstChild
      input.setAttribute('data-task', this.content)
      input.checked = this.content !== ' '
      return true
    }
    return false
  }
  toDOM(view: EditorView) {
    const label = document.createElement('label')
    label.className = 'task-list-label'
    const input = document.createElement('input')
    input.className = 'task-list-item-checkbox'
    input.type = 'checkbox'
    label.appendChild(input)
    input.setAttribute('data-task', this.content)
    input.checked = this.content !== ' '
    label.addEventListener('mousedown', e => e.preventDefault())
    input.addEventListener('input', () => toggleTaskAt(view, view.posAtDOM(input)))
    return label
  }
}

/** Flip the `[.]` of the task on the line containing `pos` between ' ' and 'x' (caret untouched). */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos)
  const idx = line.text.search(/\[.]/)
  if (idx < 0) return false
  const ch = line.text.charAt(idx + 1)
  const at = line.from + idx + 1
  try { navigator.vibrate?.(100) } catch { /* not supported */ }
  view.dispatch({ changes: [{ from: at, to: at + 1, insert: ch === ' ' ? 'x' : ' ' }] })
  return true
}

/** Highlight colours: the emoji after `==` selects the colour. */
export const HIGHLIGHT_COLOR_EMOJI: Record<string, string> = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣' }
export const HIGHLIGHT_EMOJI_COLOR: Record<string, string> = {
  '🔴': 'red', '🟥': 'red', '🟠': 'orange', '🟧': 'orange', '🟡': 'yellow', '🟨': 'yellow',
  '🟢': 'green', '🟩': 'green', '🔵': 'blue', '🟦': 'blue', '🟣': 'purple', '🟪': 'purple'
}

/** Colour of the emoji at code-unit offset `at` of `text` ({color:'',length:0} when none). */
export function highlightColorAt(text: string, at = 0): { color: string; length: number } {
  const cp = text.codePointAt(at)
  const ch = cp === undefined ? '' : String.fromCodePoint(cp)
  const color = HIGHLIGHT_EMOJI_COLOR[ch] ?? ''
  return { color, length: color ? ch.length : 0 }
}

/** Colour swatch replacing the emoji while the highlight is revealed. */
export class HighlightColorWidget extends WidgetType {
  constructor(readonly color: string) { super() }
  eq(other: HighlightColorWidget) { return other.color === this.color }
  ignoreEvent() { return false }
  toDOM(view: EditorView) {
    const el = span('cm-highlight-color-widget')
    el.setAttribute('data-highlight', this.color)
    const img = document.createElement('img')
    img.className = 'highlight-swatch'
    img.setAttribute('src', 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>')
    img.setAttribute('draggable', 'false')
    img.setAttribute('data-highlight', this.color)
    el.appendChild(img)
    el.appendChild(document.createTextNode('​'))
    const noMods = (e: MouseEvent) => !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    el.addEventListener('mousedown', e => { if (noMods(e)) e.preventDefault() })
    el.addEventListener('click', e => {
      if (!noMods(e) || !view.state.selection.main.empty) return
      const pos = view.posAtDOM(el)
      highlightColorMenu?.(e, this.color, color => setHighlightColor(view, pos, color))
    })
    return el
  }
}

/** Menu hook for the swatch (the Menu implementation lives in the workspace layer). */
export let highlightColorMenu: ((ev: MouseEvent, current: string, choose: (color: string | null) => void) => void) | null = null
export function setHighlightColorMenu(fn: typeof highlightColorMenu) { highlightColorMenu = fn }

/** Replace the colour emoji of the highlight whose emoji starts at `pos`. */
export function setHighlightColor(view: EditorView, pos: number, color: string | null) {
  const doc = view.state.doc.sliceString(pos, Math.min(view.state.doc.length, pos + 2))
  const cur = highlightColorAt(doc, 0)
  view.dispatch({ changes: { from: pos, to: pos + cur.length, insert: color ? HIGHLIGHT_COLOR_EMOJI[color] : '' }, userEvent: 'input.type' })
}

/** Trailing `span.… external-link` after an external markdown link (the ↗ icon is CSS). */
export class ExternalLinkWidget extends WidgetType {
  constructor(readonly cls: string) { super() }
  eq(other: ExternalLinkWidget) { return other.cls === this.cls }
  toDOM() { return span(this.cls) }
  ignoreEvent() { return false }
}

/** `span.code-block-flair` at the end of the opening fence: language name or copy icon. */
export class CodeFlairWidget extends WidgetType {
  constructor(readonly lang: string, readonly code: string) { super() }
  eq(other: CodeFlairWidget) { return other.lang === this.lang && other.code === this.code }
  toDOM() {
    const el = span('code-block-flair', this.lang)
    if (!this.lang) setIcon(el, 'lucide-copy')
    setTooltip(el, 'Copy')
    el.addEventListener('click', async () => {
      let code = this.code
      if (code.endsWith('\n')) code = code.substr(0, code.length - 1)
      await navigator.clipboard.writeText(code)
      notice?.('Copied to your clipboard')
    })
    return el
  }
}

/** Notice hook (`new Notice(text)`), wired by the shell. */
export let notice: ((text: string) => void) | null = null
export function setNoticeHandler(fn: typeof notice) { notice = fn }
