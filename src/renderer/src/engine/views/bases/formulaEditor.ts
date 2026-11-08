/* eslint-disable @typescript-eslint/no-explicit-any */
// Formula text editor used by the property edit page / view options: a one-pane CodeMirror 6 editor
// with an inline validity status line.
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { debounce } from '../../vault/debounce'
import { setIcon } from '../../ui/icons'
import { Formula } from './expr/Formula'

export interface FormulaEditorOptions {
  placeholder?: string
  updateFormula: (f: Formula) => void
  extensions?: any[]
}

export class FormulaEditor {
  containerEl: HTMLElement
  editor: EditorView
  constructor(parent: HTMLElement, initial: Formula | null, o: FormulaEditorOptions) {
    const box = (this.containerEl = parent.createDiv('formula-editor-container'))
    const host = box.createDiv('formula-editor')
    const status = box.createDiv('formula-editor-status')
    const iconEl = status.createDiv('status-icon')
    const label = status.createSpan()
    const show = (f: Formula | null): void => {
      const bad = !!f && f.isInvalid
      status.toggleClass('mod-error', bad)
      status.toggleClass('mod-empty', !!f && f.toString() === '')
      iconEl.empty()
      setIcon(iconEl, bad ? 'lucide-x-circle' : 'lucide-circle-check')
      label.setText(bad ? 'Invalid formula' : 'Valid formula')
      status.setAttribute('aria-label', bad ? f!.parseError ?? '' : '')
    }
    ;(host as any).onNodeInserted(() => {})
    show(initial)
    const commit = (): void => {
      const f = new Formula(this.editor.state.doc.toString())
      o.updateFormula(f)
      show(f)
    }
    const deb = debounce(commit, 250, true)
    this.editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial?.toString() ?? '',
        extensions: [
          EditorView.lineWrapping,
          cmPlaceholder(o.placeholder ?? 'x + y'),
          EditorView.domEventHandlers({
            blur: () => {
              deb.cancel()
              commit()
            }
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged) deb()
          }),
          ...(o.extensions ?? [])
        ]
      })
    })
  }
  destroy(): void {
    this.editor.destroy()
  }
}

export function appendHelpIcon(label: HTMLElement): void {
  const el = label.createDiv('clickable-icon help-icon')
  setIcon(el, 'lucide-help-circle')
}
