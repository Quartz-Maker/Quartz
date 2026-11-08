/* eslint-disable @typescript-eslint/no-explicit-any */
// "Format converter: Frontmatter migration" (`app:migrate-frontmatter`): converts the deprecated `alias`, `tag` and
// `cssclass` keys (and comma/space separated strings) of every note to `aliases` / `tags` / `cssclasses` lists.
import { Modal } from '../ui'

const S = {
  title: 'Frontmatter migration',
  desc: 'Migrate frontmatter tags, aliases, and cssclasses to the strict format Quartz requires',
  warn: 'Warning: the converter will convert all the files in your vault, not just the current file. Your files will be overwritten. Back up all your files before attempting conversion.',
  start: 'Start conversion',
  stop: 'Stop',
  back: 'Go back',
  done: 'Done',
  finished: 'Finished!',
  processing: 'Processing...',
  processed: 'Processed files',
  modified: 'Modified files',
  failed: 'Failed'
}

/** Rename a deprecated key (case-insensitive) to `target` and split string values; true when something changed. */
function migrateKey(fm: any, target: string, legacy: string, split: RegExp, trim: boolean): boolean {
  let changed = false
  let key = Object.keys(fm).find(k => k.toLowerCase() === target)
  if (!key) {
    const old = Object.keys(fm).find(k => k.toLowerCase() === legacy)
    if (old) {
      fm[target] = fm[old]
      delete fm[old]
      key = target
      changed = true
    }
  }
  if (key && typeof fm[key] === 'string') {
    fm[key] = (fm[key] as string).split(split).map(s => (trim ? s.trim() : s)).filter(s => !!s)
    changed = true
  }
  return changed
}

export function migrateFrontmatter(fm: any): boolean {
  let changed = migrateKey(fm, 'aliases', 'alias', /[,\n]/, true)
  changed = migrateKey(fm, 'tags', 'tag', /[ ,\n]/, false) || changed
  changed = migrateKey(fm, 'cssclasses', 'cssclass', /[ ,\n]/, false) || changed
  return changed
}

export class FrontmatterMigrationModal extends Modal {
  private conversionsEl: HTMLElement
  private resultEl: HTMLElement
  private statusEl: HTMLElement
  private processedEl: HTMLElement
  private modifiedEl: HTMLElement
  private failedEl: HTMLElement
  private cancelEl: HTMLElement
  private goBackEl: HTMLElement
  private doneEl: HTMLElement
  private cancelled = false
  private running = false

  constructor(app: any) {
    super(app)
    this.titleEl.setText(S.title)
    const c = (this.conversionsEl = this.contentEl.createDiv())
    c.createEl('p', { cls: 'setting-message', text: S.desc })
    c.createEl('p', { cls: 'setting-message mod-warning', text: S.warn })
    const b = c.createDiv('modal-button-container')
    b.createEl('button', { cls: 'mod-cancel', text: 'Cancel' }).addEventListener('click', () => this.close())
    b.createEl('button', { cls: 'mod-cta', text: S.start }).addEventListener('click', () => this.onProcess())
    const r = (this.resultEl = createDiv())
    this.statusEl = r.createEl('p', { cls: 'u-center-text' })
    this.processedEl = r.createDiv('changelog-item mod-success')
    this.modifiedEl = r.createDiv('changelog-item mod-highlighted')
    this.failedEl = r.createDiv('changelog-item mod-failed')
    this.renderStats({ processed: 0, modified: 0, failed: 0 })
    const rb = r.createDiv('modal-button-container')
    this.cancelEl = rb.createEl('button', { cls: 'mod-warning', text: S.stop })
    this.cancelEl.addEventListener('click', () => (this.cancelled = true))
    this.goBackEl = rb.createEl('button', { text: S.back })
    this.goBackEl.addEventListener('click', () => this.onGoBack())
    this.doneEl = rb.createEl('button', { cls: 'mod-cta', text: S.done })
    this.doneEl.addEventListener('click', () => this.close())
  }

  private renderStats(s: { processed: number; modified: number; failed: number }): void {
    this.processedEl.setText(S.processed)
    this.processedEl.setAttribute('data-label', String(s.processed))
    this.modifiedEl.setText(S.modified)
    this.modifiedEl.setAttribute('data-label', String(s.modified))
    this.failedEl.toggle(s.failed > 0)
    this.failedEl.setText(S.failed)
    this.failedEl.setAttribute('data-label', String(s.failed))
  }

  private onProcess(): void {
    if (this.running) return
    this.cancelled = false
    this.conversionsEl.detach()
    this.contentEl.append(this.resultEl)
    this.cancelEl.show()
    this.goBackEl.hide()
    this.doneEl.hide()
    this.statusEl.setText(S.processing)
    void this.process()
  }

  private onGoBack(): void {
    this.resultEl.detach()
    this.contentEl.append(this.conversionsEl)
  }

  private async process(): Promise<void> {
    this.running = true
    const app: any = this.app
    const stats = { processed: 0, modified: 0, failed: 0 }
    for (const file of app.vault.getMarkdownFiles()) {
      if (this.cancelled) break
      try {
        // Dry run on a copy first: files that need no change are not rewritten (like the reference).
        const fm = app.metadataCache.getFileCache(file)?.frontmatter
        if (fm && migrateFrontmatter(JSON.parse(JSON.stringify(fm)))) {
          await app.fileManager.processFrontMatter(file, (data: any) => migrateFrontmatter(data))
          stats.modified++
        }
      } catch (e) {
        stats.failed++
        console.error(e)
      }
      stats.processed++
      this.renderStats(stats)
      if (stats.processed % 10 === 0) await new Promise(r => setTimeout(r, 0))
    }
    this.running = false
    this.renderStats(stats)
    this.cancelEl.hide()
    this.goBackEl.show()
    this.statusEl.setText(S.finished)
    this.doneEl.show()
  }

  onClose(): void {
    this.cancelled = true
    this.onGoBack()
  }
}
