/* eslint-disable @typescript-eslint/no-explicit-any */
// `fileManager.promptForFileRename(file)` (reference): confirmation modal `.mod-file-rename` with an auto-growing
// one-line textarea, Save / Cancel; Enter submits, invalid names show an inline error.
import { ConfirmationModal } from './Modal'
import { Notice } from './Notice'
import { t } from '../settings/i18n'

const INVALID = /[\\/:]/

export class RenameFileModal extends ConfirmationModal {
  inputEl: HTMLTextAreaElement
  constructor(app: any, private file: any) {
    super(app)
    this.modalEl.addClass('mod-file-rename')
    const input = (this.inputEl = createEl('textarea', { cls: 'rename-textarea' }))
    input.rows = 1
    input.value = file.basename
    const grow = (): void => {
      input.style.height = 'auto'
      input.style.height = input.scrollHeight + 'px'
    }
    requestAnimationFrame(grow)
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        void this.submit(input.value.trim())
      }
    })
    input.addEventListener('input', () => {
      input.rows = 1
      grow()
      input.toggleClass('mod-error', INVALID.test(input.value))
    })
    this.contentEl.appendChild(input)
    this.addButton(b => b.setCta().setButtonText(t('dialogue.buttonSave')).onClick(() => void this.submit(input.value.trim())))
    this.addCancelButton()
  }

  onOpen(): void {
    super.onOpen?.()
    this.setTitle(t(this.file.extension === 'md' ? 'dialogue.labelRenameFile' : 'dialogue.labelRenameFileGeneric'))
    this.inputEl.select()
    this.inputEl.focus()
  }

  async submit(name: string): Promise<void> {
    if (!name || INVALID.test(name)) {
      new Notice('File name cannot contain any of the following characters: * " \\ / < > : | ?')
      return
    }
    this.close()
    const parent = this.file.parent && this.file.parent.path !== '/' ? this.file.parent.path + '/' : ''
    const newPath = `${parent}${name}${this.file.extension ? '.' + this.file.extension : ''}`
    if (newPath === this.file.path) return
    try {
      await (this.app as any).fileManager.renameFile(this.file, newPath)
      new Notice(t('dialogue.msgRenameSuccess'))
    } catch (e: any) {
      new Notice(e?.message || e?.code || String(e))
    }
  }
}
