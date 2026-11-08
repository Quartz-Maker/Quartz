/* eslint-disable @typescript-eslint/no-explicit-any */
// "Spellcheck dictionary" (Settings > Editor > Spellcheck ⚙): the words added to the spellchecker's custom
// dictionary, each with a remove button (Electron session dictionary).
import { Modal } from './Modal'
import { setIcon } from './icons'
import { setTooltip } from './tooltip'
import { nodeRequire } from '../node'

export class SpellcheckDictionaryModal extends Modal {
  constructor(app: any) {
    super(app)
    this.titleEl.setText('Spellcheck dictionary')
  }
  onOpen(): void {
    void this.rerender()
  }
  onClose(): void {
    this.contentEl.empty()
  }
  private async rerender(): Promise<void> {
    const el = this.contentEl
    el.empty()
    let session: any = null
    try {
      session = nodeRequire<any>('@electron/remote').getCurrentWebContents().session
    } catch {
      /* no session */
    }
    const words: string[] = session ? await session.listWordsInSpellCheckerDictionary() : []
    words.sort((a, b) => a.localeCompare(b))
    const list = el.createDiv('spellchecker-dictionary-container')
    for (const w of words) {
      const item = list.createDiv('spellchecker-dictionary-item')
      const rm = item.createDiv('spellchecker-dictionary-remove-button')
      setIcon(rm, 'lucide-x')
      setTooltip(rm, 'Remove from dictionary')
      rm.addEventListener('click', () => {
        session.removeWordFromSpellCheckerDictionary(w)
        void this.rerender()
      })
      item.createDiv({ cls: 'spellchecker-dictionary-word', text: w })
    }
    if (words.length === 0) el.createEl('p', { text: 'The spellcheck dictionary is empty.' })
  }
}
