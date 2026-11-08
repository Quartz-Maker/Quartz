// Shared Live Preview state: refresh effects, the mouse-down tracker, the search-match field the
// reveal predicate consults, the LP host facet and the "is Live Preview on" field.
//
// Behaviour:
//   - an element is *revealed* when any selection range of the FOCUSED editor overlaps it
//     (boundaries inclusive: range.from <= to && range.to >= from), or a search-match highlight
//     decoration lies inside it;
//   - decorations are not rebuilt while composing (IME) or while the primary mouse button is down;
//     on mouseup a no-op selection dispatch forces the rebuild.
import { Annotation, Facet, StateEffect, StateField } from '@codemirror/state'
import type { EditorState, SelectionRange } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'

/** Force LP decorations to rebuild (dispatched on focus/blur and widget changes). */
export const refreshLivePreview = StateEffect.define<void>()
/** Force block widgets to be re-created (post-processor change). */
export const rerenderLivePreview = StateEffect.define<void>()
/** Image reveal state change (the image tooltip); selection updates carrying it are not snapped. */
export const imageRevealEffect = StateEffect.define<any>()
/** Annotation on the no-op selection dispatched after mouseup. */
export const mouseupSelection = Annotation.define<boolean>()

/** Tracks whether the primary mouse button is down over the editor. */
export const mousedownState = ViewPlugin.define(() => ({ mousedown: false }))

export function isMouseDown(view: EditorView): boolean {
  return !!view.plugin(mousedownState)?.mousedown
}

// ---- search matches ------------------------------------------------------------------------

/** Class of the decoration the editor search uses for its matches. */
export const SEARCH_MATCH_CLASS = 'obsidian-search-match-highlight'
export const searchMatchMark = Decoration.mark({ class: SEARCH_MATCH_CLASS })
/** Replace the search-match highlight set (ranges are [from, to]). */
export const setSearchMatches = StateEffect.define<{ from: number; to: number }[]>()

export const searchMatchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) if (e.is(setSearchMatches)) {
      value = Decoration.set(e.value.filter(r => r.to > r.from).map(r => searchMatchMark.range(r.from, r.to)), true)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f)
})

// ---- reveal predicate ----------------------------------------------------------------------

export function rangeTouches(r: { from: number; to: number }, from: number, to: number): boolean {
  return r.from <= to && r.to >= from
}

export function selectionTouches(ranges: readonly SelectionRange[], from: number, to: number): boolean {
  for (const r of ranges) if (rangeTouches(r, from, to)) return true
  return false
}

export function searchTouches(state: EditorState, from: number, to: number): boolean {
  const set = state.field(searchMatchField, false)
  if (!set) return false
  let found = false
  set.between(from, to, (_f, _t, v) => {
    if (v === searchMatchMark) { found = true; return false }
    return undefined
  })
  return found
}

/** The ranges that reveal syntax: the selection of a focused editor, else none. */
export function revealRanges(view: EditorView, state: EditorState = view.state): readonly SelectionRange[] {
  return hasFocus(view) ? state.selection.ranges : []
}

/** `view.hasFocus`, overridable per view (tests / table-cell editors). */
export function hasFocus(view: EditorView): boolean {
  const o = (view as any).__lpHasFocus
  return typeof o === 'boolean' ? o : view.hasFocus
}

export function makeRevealTest(view: EditorView, state: EditorState = view.state) {
  const ranges = revealRanges(view, state)
  return (from: number, to: number) => selectionTouches(ranges, from, to) || searchTouches(state, from, to)
}

// ---- host ------------------------------------------------------------------------------------

/** What Live Preview needs from the view hosting the editor (the MarkdownView). */
export interface LivePreviewHost {
  /** Vault path of the file being edited (source path for link resolution). */
  getPath(): string
  /** The App (for metadataCache / vault / workspace); optional in tests. */
  app?: any
  /** True when `linkpath` (no subpath) does not resolve from `sourcePath`. */
  isUnresolved?(linkpath: string, sourcePath: string): boolean
  /** Open a link (LP click on rendered link text). */
  openLinkText?(linktext: string, sourcePath: string, newLeaf: boolean | string, ev?: MouseEvent): void
  /** Open an external URL. */
  openExternal?(url: string): void
  /** Tag click (opens search `tag:#x`). */
  openTag?(tag: string): void
}

export const livePreviewHost = Facet.define<LivePreviewHost, LivePreviewHost | null>({
  combine: v => (v.length ? v[v.length - 1] : null)
})

export function getHost(state: EditorState): LivePreviewHost | null {
  return state.facet(livePreviewHost)
}

/** True while the editor is in Live Preview (toggled with the mode). */
export const livePreviewActive = Facet.define<boolean, boolean>({ combine: v => v.some(Boolean) })
