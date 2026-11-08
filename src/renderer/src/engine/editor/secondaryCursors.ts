import { EditorSelection, type Extension } from '@codemirror/state'
import { layer, RectangleMarker, type ViewUpdate } from '@codemirror/view'

// The browser's caret and ::selection for the main range (themed through
// caret-color / --text-selection) and only draws the other ranges of a multi-selection:
// their cursors in `.cm-cursorLayer` and their selections in `.cm-selectionLayer`.
const changed = (u: ViewUpdate): boolean => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged

export function secondaryCursors(): Extension {
  return [
    layer({
      above: true,
      class: 'cm-cursorLayer',
      markers(view) {
        const { main, ranges } = view.state.selection
        const out: RectangleMarker[] = []
        for (const r of ranges) {
          if (r === main) continue
          const cursor = r.empty ? r : EditorSelection.cursor(r.head, r.head > r.anchor ? -1 : 1)
          for (const m of RectangleMarker.forRange(view, 'cm-cursor cm-cursor-secondary', cursor)) out.push(m)
        }
        return out
      },
      update: changed
    }),
    layer({
      above: false,
      class: 'cm-selectionLayer',
      markers(view) {
        const { main, ranges } = view.state.selection
        const out: RectangleMarker[] = []
        for (const r of ranges) if (r !== main && !r.empty) out.push(...RectangleMarker.forRange(view, 'cm-selectionBackground', r))
        return out
      },
      update: changed
    })
  ]
}
