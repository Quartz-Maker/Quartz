/* eslint-disable @typescript-eslint/no-explicit-any */
// "Startup time" report (Settings > General > Notify if startup takes longer than expected > Check now):
// system info and how long each startup stage took, from `app.startupTimings` (recorded by shell/boot).
//   .modal.mod-lg.mod-scrollable-content.mod-plugin-debug
//     .startup-stat-list (Device, Operating system, app + installer version)
//     .startup-timing-list > .startup-stat.mod-heading (Total app startup)
//     .startup-timing-tree > .tree-item rows (Initialization, Vault, Workspace, Core plugins, Community plugins)
//   Copy to clipboard | Done
import { ConfirmationModal } from './Modal'
import { nodeRequire } from '../node'

export interface StartupTimings {
  start: number
  stages: Record<string, number>
  total: number
}

const STAGES: { key: string; label: string }[] = [
  { key: 'init', label: 'Initialization' },
  { key: 'vault', label: 'Vault' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'core', label: 'Core plugins' },
  { key: 'community', label: 'Community plugins' }
]

const ms = (v: number | undefined): string => `${Math.round(v ?? 0)}ms`

export class StartupTimeModal extends ConfirmationModal {
  constructor(app: any, version: string) {
    super(app)
    this.modalEl.addClass('mod-lg', 'mod-scrollable-content', 'mod-plugin-debug')
    this.setTitle('Startup time')
    const timings: StartupTimings | undefined = app.startupTimings
    const c = this.contentEl
    const stats = c.createDiv('startup-stat-list')
    const stat = (label: string, value?: string): HTMLElement => {
      const el = stats.createDiv('startup-stat')
      el.createDiv('startup-info').createSpan({ cls: 'startup-label', text: label })
      if (value !== undefined) el.createDiv({ cls: 'startup-value', text: value })
      return el
    }
    stat('Device').hide()
    let osText = ''
    try {
      const os = nodeRequire<any>('os')
      osText = `${os.version()} ${os.release()}`
    } catch {
      osText = navigator.userAgent
    }
    stat('Operating system', osText)
    const app0 = stats.createDiv('startup-stat').createDiv('startup-info')
    app0.createSpan({ cls: 'startup-label', text: 'Quartz' })
    app0.createSpan({ cls: 'startup-desc', text: version })
    app0.createSpan({ cls: 'startup-label', text: 'Installer' })
    app0.createSpan({ cls: 'startup-desc', text: version })

    const total = c.createDiv('startup-timing-list').createDiv('startup-stat mod-heading')
    total.createDiv('startup-info').createSpan({ cls: 'startup-label', text: 'Total app startup' })
    total.createDiv({ cls: 'startup-value', text: ms(timings?.total) })

    const tree = c.createDiv('startup-timing-tree')
    const files = app.vault?.getFiles?.().length ?? 0
    let tabs = 0
    let deferred = 0
    app.workspace?.iterateAllLeaves?.((l: any) => {
      tabs++
      if (l.isDeferred) deferred++
    })
    const active = app.plugins?.enabledPlugins?.size ?? 0
    const desc: Record<string, string> = {
      vault: `${files} files`,
      workspace: `${tabs} tabs, ${deferred} deferred`,
      community: `${active} active`
    }
    for (const s of STAGES) {
      const item = tree.createDiv('tree-item')
      const self = item.createDiv('tree-item-self')
      const inner = self.createDiv('tree-item-inner')
      inner.createSpan({ cls: 'startup-label', text: s.label })
      if (desc[s.key]) inner.createSpan({ cls: 'startup-desc', text: desc[s.key] })
      self.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: ms(timings?.stages[s.key]) })
      item.createDiv('tree-item-children')
    }

    this.addButton(b =>
      b.setButtonText('Copy to clipboard').onClick(() => {
        b.buttonEl.addClass('mod-secondary')
        const lines = [`Operating system: ${osText}`, `Quartz: ${version}`, `Total app startup: ${ms(timings?.total)}`]
        for (const s of STAGES) lines.push(`${s.label}: ${ms(timings?.stages[s.key])}${desc[s.key] ? ` (${desc[s.key]})` : ''}`)
        void navigator.clipboard.writeText(lines.join('\n'))
        return true // keep the modal open
      })
    )
    this.buttons[this.buttons.length - 1].buttonEl.addClass('mod-secondary')
    this.addCancelButton('Done')
  }
}
