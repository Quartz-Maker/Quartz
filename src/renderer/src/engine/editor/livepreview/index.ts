// Live Preview extension bundle.
//
//   import { livePreview, livePreviewCompartment } from '@/engine/editor/livepreview'
//
// `livePreview()` returns the extensions that turn the HyperMD editor into Live Preview. Source mode
// is the same editor with these extensions reconfigured out of a Compartment (see extensions.ts).

import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { mousedownState, mouseupSelection, refreshLivePreview, livePreviewActive, searchMatchField, getHost } from './state'
import { inlineLivePreview, taskLineAttributes } from './inline'
import { blockLivePreviewField, imageAtomicRanges, blockStepKeymap } from './block'

export * from './state'
export * from './widgets'
export { inlineLivePreview, taskLineAttributes, buildInlineDecorations, LIST_RE, isLocalUrl, FORMAT_CLASSES, LINK_CLASSES } from './inline'
export { blockLivePreviewField, parseLinktext, getLinkpath, FENCE_RE } from './block'
export { setMarkdownRenderer, renderMarkdownInto, setCodeBlockProcessorSource, setEmbedLoader, canRenderLang } from './render'
export type { MarkdownRenderFn } from './render'
export { setMathEngine, setMathEngineLoader, loadMathJax, renderMath, finishRenderMath } from './math'
export { TableWidget, parseTable } from './table'

const refreshSoon = (view: EditorView) => view.dom.ownerDocument.defaultView!.setTimeout(() => view.dispatch({ effects: refreshLivePreview.of() }), 10)

/** Mouse-down tracking: no decoration rebuilds during a drag; rebuild after mouseup. */
const mouseTracker = ViewPlugin.define(view => {
  const opts = { capture: true }
  const onDown = (ev: MouseEvent) => {
    if (ev.button !== 0) return
    const sd = view.scrollDOM
    if (sd.scrollHeight > sd.clientHeight && ev.clientX > sd.getBoundingClientRect().x + sd.clientWidth) return
    const sel = view.state.selection, doc = view.state.doc, top = sd.scrollTop
    const st = view.plugin(mousedownState)
    if (!st) return
    st.mousedown = true
    const d = sd.ownerDocument
    const done = () => {
      d.removeEventListener('mouseup', onUp, opts)
      d.removeEventListener('drag', done, opts)
      st.mousedown = false
      if (!(view.state.selection.eq(sel) && view.state.doc.eq(doc) && sd.scrollTop === top)) {
        d.defaultView!.setTimeout(() => view.dispatch({ annotations: [mouseupSelection.of(true)], selection: view.state.selection }), 50)
      }
    }
    const onUp = (e: MouseEvent) => { if (e.button === 0) done() }
    d.addEventListener('mouseup', onUp, opts)
    d.addEventListener('drag', done, opts)
  }
  view.scrollDOM.addEventListener('mousedown', onDown, opts)
  return { destroy: () => view.scrollDOM.removeEventListener('mousedown', onDown, opts) }
})

const isMod = (e: MouseEvent) => (navigator.platform.startsWith('Mac') ? e.metaKey : e.ctrlKey)

const domEvents = EditorView.domEventHandlers({
  focus: (_e, view) => { refreshSoon(view) },
  blur: (_e, view) => { refreshSoon(view) },
  mousedown: (e, view) => {
    if (e.button === 0 && (isMod(e) || (!e.shiftKey && !e.altKey))) {
      const t = e.target
      if (t instanceof Element) {
        const drag = t.closest('[draggable="true"]')
        if (drag && view.contentDOM.contains(drag)) {
          drag.setAttribute('contenteditable', 'false')
          const orig = e.preventDefault
          e.preventDefault = function () { e.preventDefault = orig }
          return true
        }
      }
    }
    return false
  },
  click: (e, view) => {
    // LP: a plain left click on rendered link text / a tag follows it; Mod+click opens a new tab
    if (e.button !== 0 && e.button !== 1) return false
    const t = e.target
    if (!(t instanceof Element)) return false
    const host = getHost(view.state)
    if (!host) return false
    const pos = view.posAtDOM(t)
    const under = t.closest('.cm-underline')
    if (under) {
      const link = linkAt(view, pos)
      if (!link) return false
      e.preventDefault()
      if (link.external) host.openExternal?.(link.target)
      else host.openLinkText?.(link.target, host.getPath(), isMod(e) || e.button === 1, e)
      return true
    }
    const tag = t.closest('.cm-hashtag')
    if (tag && host.openTag) {
      const line = view.state.doc.lineAt(pos)
      const m = /#[^\s#]+/g
      let mm: RegExpExecArray | null
      while ((mm = m.exec(line.text))) if (line.from + mm.index <= pos && pos <= line.from + mm.index + mm[0].length) { host.openTag(mm[0]); return true }
    }
    return false
  }
})

/** Link target around `pos` (wikilink target or markdown link url). */
export function linkAt(view: EditorView, pos: number): { target: string; external: boolean } | null {
  const line = view.state.doc.lineAt(pos)
  const off = pos - line.from
  const wiki = /!?\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = wiki.exec(line.text))) {
    if (m.index <= off && off <= m.index + m[0].length) {
      const inner = m[1]
      const bar = inner.indexOf('|')
      return { target: (bar > 0 ? inner.slice(0, bar) : inner).trim(), external: false }
    }
  }
  const md = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  while ((m = md.exec(line.text))) {
    if (m.index <= off && off <= m.index + m[0].length) {
      let url = m[2]
      if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
      const external = /^[a-z][a-z0-9+.-]*:/i.test(url)
      return { target: external ? url : decodeURI(url), external }
    }
  }
  const bare = /https?:\/\/[^\s<>)]+/g
  while ((m = bare.exec(line.text))) if (m.index <= off && off <= m.index + m[0].length) return { target: m[0], external: true }
  return null
}

/** Live Preview extensions for one editor. */
export function livePreview(): Extension {
  let current: EditorView | null = null
  const field = blockLivePreviewField(() => current)
  const viewRef = ViewPlugin.define(view => {
    current = view
    view.dom.ownerDocument.defaultView!.setTimeout(() => { if (current === view) view.dispatch({ effects: refreshLivePreview.of() }) })
    return { destroy: () => { if (current === view) current = null } }
  })
  return [
    livePreviewActive.of(true),
    mousedownState,
    viewRef,
    inlineLivePreview,
    taskLineAttributes,
    field,
    imageAtomicRanges(field),
    blockStepKeymap(field),
    mouseTracker,
    domEvents
  ]
}

/** Search matches field (always installed; the search UI fills it via `setSearchMatches`). */
export const livePreviewSearchField = searchMatchField

