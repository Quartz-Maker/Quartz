/* eslint-disable @typescript-eslint/no-explicit-any */
// Plugin-facing editor state fields (plugin API): `editorInfoField` / `editorViewField` give the
// owning MarkdownView, `editorEditorField` the EditorView, `editorLivePreviewField` re-exported,
// `livePreviewState` a ViewPlugin exposing `isLivePreview`. Quartz carries the MarkdownView in a
// Facet internally; these are real StateFields (so `state.field(...)` works) that mirror it and are
// installed into every editor via `workspace.editorExtensions` by `installEditorFields`.
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import { editorInfoField as editorInfoFacet } from '../views/markdown/MarkdownView'
import { editorLivePreviewField } from '../editor/editorExtensions'

export const editorInfoField = StateField.define<any>({
  create: state => state.facet(editorInfoFacet),
  update: v => v
})
export const editorViewField = editorInfoField

const setEditorView = StateEffect.define<EditorView>()
export const editorEditorField = StateField.define<EditorView | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setEditorView)) return e.value
    return v
  }
}) as unknown as StateField<EditorView>

export interface LivePreviewStateType {
  readonly isLivePreview: boolean
}
export const livePreviewState = ViewPlugin.fromClass(
  class implements LivePreviewStateType {
    constructor(public view: EditorView) {}
    get isLivePreview(): boolean {
      return !!this.view.state.field(editorLivePreviewField, false)
    }
  }
)

const editorViewSetter = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      queueMicrotask(() => {
        try {
          view.dispatch({ effects: setEditorView.of(view) })
        } catch {
          /* view destroyed */
        }
      })
    }
  }
)

export { editorLivePreviewField }

export const editorFieldsExtension: Extension = [editorInfoField, editorEditorField, editorViewSetter, livePreviewState]

export function installEditorFields(app: any): void {
  const ws = app.workspace
  if (ws.__quartzEditorFields) return
  ws.__quartzEditorFields = true
  ws.registerEditorExtension(editorFieldsExtension)
}
