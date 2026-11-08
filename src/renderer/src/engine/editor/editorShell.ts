// The editor DOM shell:
//
//   div.markdown-source-view.cm-s-obsidian.mod-cm6[.is-live-preview][.is-readable-line-width]…
//     div.cm-editor
//       div.cm-scroller
//         div.cm-sizer
//           [div.inline-title] [div.metadata-container]
//           div.cm-contentContainer
//             [div.cm-gutters] div.cm-content
//           [div.embedded-backlinks]
//
// CM6 creates `.cm-content` (and gutters) directly in `.cm-scroller`; they are re-parented into
// `.cm-sizer > .cm-contentContainer` after the view is created.
import type { EditorView } from '@codemirror/view'

export interface SourceViewShellState {
  livePreview?: boolean
  readableLineWidth?: boolean
  folding?: boolean
  showProperties?: boolean
  rtl?: boolean
}

export interface SourceViewShell {
  containerEl: HTMLDivElement
  sizerEl: HTMLDivElement
  contentContainerEl: HTMLDivElement
}

/** Create the `.markdown-source-view` wrapper the CodeMirror view should be mounted into. */
export function createSourceViewContainer(parent: HTMLElement): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'markdown-source-view cm-s-obsidian mod-cm6'
  parent.appendChild(el)
  return el
}

/** Re-parent `.cm-content` (and gutters) into `.cm-scroller > .cm-sizer > .cm-contentContainer`. */
export function installSourceViewShell(view: EditorView, containerEl: HTMLDivElement): SourceViewShell {
  const doc = view.dom.ownerDocument
  const sizerEl = doc.createElement('div')
  sizerEl.className = 'cm-sizer'
  const contentContainerEl = doc.createElement('div')
  contentContainerEl.className = 'cm-contentContainer'
  view.scrollDOM.insertBefore(sizerEl, view.contentDOM)
  sizerEl.appendChild(contentContainerEl)
  contentContainerEl.appendChild(view.contentDOM)
  // Gutters (line numbers, ...) live next to the content inside `.cm-contentContainer`. Stock
  // @codemirror/view inserts them with `scrollDOM.insertBefore(gutters, contentDOM)` (and re-inserts them with
  // `insertBefore(gutters, gutters.nextSibling)`), which throws once the content has moved, silently disabling the
  // gutter plugin; route those calls into the content container instead.
  const scrollDOM = view.scrollDOM
  const insertBefore = scrollDOM.insertBefore
  scrollDOM.insertBefore = function <T extends Node>(this: HTMLElement, node: T, ref: Node | null): T {
    if (node instanceof HTMLElement && node.classList.contains('cm-gutters')) {
      return contentContainerEl.insertBefore(node, node.classList.contains('cm-gutters-after') ? null : view.contentDOM)
    }
    return insertBefore.call(this, node, ref && ref.parentNode !== this ? sizerEl : ref) as T
  }
  // Scroll-past-end: pad the content by half of the scroller's height (e.g. 722px scroller ->
  // padding-bottom 361px), so the last line can be scrolled to the middle.
  const win = doc.defaultView
  if (win && typeof win.ResizeObserver === 'function') {
    const sync = () => { view.contentDOM.style.paddingBottom = Math.round(view.scrollDOM.clientHeight / 2) + 'px' }
    new win.ResizeObserver(sync).observe(view.scrollDOM)
    sync()
  }
  return { containerEl, sizerEl, contentContainerEl }
}

/** Toggle the container state classes derived from settings / mode. */
export function setSourceViewState(containerEl: HTMLElement, s: SourceViewShellState) {
  containerEl.classList.toggle('is-live-preview', !!s.livePreview)
  containerEl.classList.toggle('is-readable-line-width', !!s.readableLineWidth)
  containerEl.classList.toggle('is-folding', !!s.folding)
  containerEl.classList.toggle('show-properties', !!s.showProperties)
  const rtl = !!s.rtl || containerEl.ownerDocument.body.classList.contains('mod-rtl')
  containerEl.classList.toggle('is-rtl', rtl)
  if (rtl) containerEl.setAttribute('dir', 'rtl')
  else containerEl.removeAttribute('dir')
}
