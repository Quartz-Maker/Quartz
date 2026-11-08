/* eslint-disable @typescript-eslint/no-explicit-any */
// CM6 glue for `app.workspace.editorSuggest`: after every (debounced 50ms) update the editor
// asks the registered EditorSuggests whether one applies; typing marks the trigger "forced",
// which is what opens the popup. While a suggestion list is open the arrow/Enter/Tab keys are
// left to the suggest's Scope (we only stop the editor from handling them).
import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { installEditorSuggest } from '../../plugins/editorSuggest'

export function editorSuggestExtension(getOwner: () => any): Extension {
  let forced = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const showing = (): boolean => {
    const ws: any = getOwner().app.workspace
    return !!ws.editorSuggest?.isShowingSuggestion?.()
  }
  return [
    EditorView.updateListener.of(u => {
      if (u.docChanged && u.transactions.some(t => t.isUserEvent('input') || t.isUserEvent('delete'))) forced = true
      if (!(u.focusChanged || u.docChanged || u.selectionSet)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const owner = getOwner()
        if (!owner?.editor || !owner.file) return
        const mgr = installEditorSuggest(owner.app)
        const f = forced
        forced = false
        mgr.trigger(owner.editor, owner.file, f)
      }, 50)
    }),
    Prec.highest(keymap.of(['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].map(key => ({ key, run: showing, preventDefault: true })))),
    EditorView.domEventHandlers({
      blur: () => {
        if (timer) clearTimeout(timer)
        return false
      }
    })
  ]
}
