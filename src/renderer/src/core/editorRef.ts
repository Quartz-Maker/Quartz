import { EditorView } from '@codemirror/view'

export let activeEditorView: EditorView | null = null

export function setActiveEditorView(view: EditorView | null) {
  activeEditorView = view
}
