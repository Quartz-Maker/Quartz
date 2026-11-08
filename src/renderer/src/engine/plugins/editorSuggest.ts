/* eslint-disable @typescript-eslint/no-explicit-any */
// `app.workspace.editorSuggest` (EditorSuggests): owns the registered EditorSuggest
// instances. The editor calls `trigger(editor, file, forced)` after (debounced) updates; the
// first suggest whose `onTrigger` matches wins and, when `forced` (typing), becomes current.
// The built-in `[[` link suggester is registered first.
import { LinkSuggest } from '../editor/suggest/linkSuggest'

export class EditorSuggestManager {
  suggests: any[] = []
  currentSuggest: any = null
  constructor(app?: any) {
    if (app) this.addSuggest(new LinkSuggest(app))
  }
  add(s: any): void {
    this.addSuggest(s)
  }
  remove(s: any): void {
    this.removeSuggest(s)
  }
  addSuggest(s: any): void {
    this.suggests.push(s)
  }
  removeSuggest(s: any): void {
    if (this.currentSuggest === s) this.close()
    const i = this.suggests.indexOf(s)
    if (i >= 0) this.suggests.splice(i, 1)
  }
  trigger(editor: any, file: any, forced: boolean): void {
    if (!editor.cm.hasFocus) return
    for (const s of this.suggests) {
      if (s.trigger(editor, file, forced)) {
        if (forced) this.setCurrentSuggest(s)
        return
      }
    }
    this.close()
  }
  setCurrentSuggest(s: any): void {
    const cur = this.currentSuggest
    if (cur === s) return
    if (cur) cur.close()
    this.currentSuggest = s
  }
  isShowingSuggestion(): boolean {
    const s = this.currentSuggest
    return !!(s && s.isOpen)
  }
  reposition(): void {
    const s = this.currentSuggest
    if (s && s.isOpen) s.updatePosition()
  }
  close(): void {
    this.setCurrentSuggest(null)
  }
}

export function installEditorSuggest(app: any): EditorSuggestManager {
  const ws = app.workspace
  if (ws.editorSuggest instanceof EditorSuggestManager) return ws.editorSuggest
  return (ws.editorSuggest = new EditorSuggestManager(app))
}
