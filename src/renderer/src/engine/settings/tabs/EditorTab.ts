/* eslint-disable @typescript-eslint/no-explicit-any */
// Editor tab (id `editor`). Every control reads/writes `app.vault` config
// (app.json); MarkdownViews react to `config-changed` (reconfigureEditor).
import { t } from '../i18n'
import { BuiltinTab, lsGet, lsSet } from '../util'
import { ConfirmationModal, Notice, setIcon } from '../../ui'
import { availableSpellcheckLanguages, isNativeSpellchecker, languageName, systemLocale } from '../spellcheck'

const toggle = (key: string, name: string, desc: string): any => ({ name: t(name), desc: t(desc), control: { type: 'toggle', key } })

export class EditorTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'editor', t('setting.editor.name'), 'pen-line')
  }

  getSettingDefinitions(): any[] {
    const app = this.app
    const E = 'setting.editor.'
    const defs: any[] = []
    defs.push({
      name: t(E + 'optionDefaultNewTabView'),
      desc: t(E + 'optionDefaultNewTabViewDescription'),
      control: { type: 'dropdown', key: 'defaultViewMode', options: { source: t(E + 'optionDefaultNewTabViewEditing'), preview: t(E + 'optionDefaultNewTabViewReading') } }
    })
    defs.push({
      name: t(E + 'optionDefaultEditingMode'),
      desc: t(E + 'optionDefaultEditingModeDescription'),
      aliases: ['live-preview', 'source'],
      render: (s: any) =>
        s.addDropdown((d: any) =>
          d
            .addOption('live-preview', t(E + 'optionDefaultEditingModeLivePreview'))
            .addOption('source', t(E + 'optionDefaultEditingModeSource'))
            .setValue(app.vault.getConfig('livePreview') ? 'live-preview' : 'source')
            .onChange((v: string) => {
              app.vault.setConfig('livePreview', v === 'live-preview')
              for (const leaf of app.workspace.getLeavesOfType('markdown')) {
                const st = leaf.getViewState()
                st.state.source = v !== 'live-preview'
                void leaf.setViewState(st)
              }
            })
        )
    })
    defs.push({
      name: t('plugins.editorStatus.name'),
      desc: t('plugins.editorStatus.desc'),
      render: (s: any) =>
        s.addToggle((tg: any) => {
          const p = app.internalPlugins.plugins['editor-status']
          tg.setValue(!!p?.enabled).onChange((v: boolean) => void app.internalPlugins.setEnabled('editor-status', v))
        })
    })
    defs.push({
      type: 'group',
      heading: t(E + 'sectionDisplay'),
      items: [
        toggle('showInlineTitle', E + 'optionShowInlineTitle', E + 'optionShowInlineTitleDescription'),
        toggle('readableLineLength', E + 'optionReadableLineLength', E + 'optionReadableLineDescription'),
        toggle('strictLineBreaks', E + 'optionStrictLineBreak', E + 'optionStrictLineBreakDescription'),
        {
          name: t(E + 'optionPropertiesInDocument'),
          desc: t(E + 'optionPropertiesInDocumentDescription'),
          control: { type: 'dropdown', key: 'propertiesInDocument', options: { visible: t(E + 'optionPropertiesVisible'), hidden: t(E + 'optionPropertiesHidden'), source: t(E + 'optionPropertiesSource') } }
        },
        toggle('foldHeading', E + 'optionFoldHeading', E + 'optionFoldHeadingDescription'),
        toggle('foldIndent', E + 'optionFoldIndent', E + 'optionFoldIndentDescription'),
        toggle('showLineNumber', E + 'optionShowLineNumber', E + 'optionShowLineNumberDescription'),
        toggle('showIndentGuide', E + 'optionIndentationGuide', E + 'optionIndentationGuideDescription'),
        toggle('rightToLeft', E + 'optionRtl', E + 'optionRtlDescription'),
        {
          name: t(E + 'optionMermaidAllow'),
          desc: t(E + 'optionMermaidAllowDescription'),
          render: (s: any) =>
            s.addToggle((tg: any) =>
              tg.setValue(lsGet(app, 'mermaid-vault-trust') === true).onChange((v: boolean) => {
                lsSet(app, 'mermaid-vault-trust', v || null) // the key the Mermaid "Allow" guard reads
                app.workspace.trigger('post-processor-change')
              })
            )
        }
      ]
    })
    defs.push({
      type: 'group',
      heading: t(E + 'sectionBehavior'),
      items: [
        {
          name: t(E + 'optionSpellcheck'),
          desc: t(E + 'optionSpellcheckDescription'),
          render: (s: any) => {
            s.addExtraButton((b: any) =>
              b.setIcon('lucide-settings').onClick(async () => {
                const { SpellcheckDictionaryModal } = await import('../../ui/SpellcheckDictionaryModal')
                new SpellcheckDictionaryModal(app).open()
              })
            )
            s.addToggle((tg: any) => tg.setValue(!!app.vault.getConfig('spellcheck')).onChange((v: boolean) => app.vault.setConfig('spellcheck', v)))
          }
        },
        {
          name: t(E + 'spellcheckLanguages'),
          desc: t(E + 'spellcheckLanguagesDescription'),
          render: (s: any) => {
            if (isNativeSpellchecker()) { s.setDesc(t(E + 'spellcheckLanguagesMacDescription')); return }
            // Default (nothing chosen): one chip with the system locale. Once languages are chosen: a removable
            // chip per language (sorted by name), plus a restore button back to the default.
            const draw = () => {
              s.clear()
              const available = availableSpellcheckLanguages()
              const langs: string[] | null = app.getSpellcheckLanguages()
              const chips = s.controlEl.createDiv('setting-command-hotkeys')
              if (langs) {
                const items = langs.map(lang => ({ lang, display: languageName(lang) + (available.includes(lang) ? '' : ' (Not available)') }))
                items.sort((a, b) => a.display.localeCompare(b.display))
                for (const { lang, display } of items) {
                  chips.createSpan({ cls: 'setting-hotkey', text: display }).createSpan('setting-hotkey-icon', (x: HTMLElement) => {
                    setIcon(x, 'lucide-x')
                    x.addEventListener('click', () => { app.setSpellcheckLanguages(langs.filter(l => l !== lang)); draw() })
                  })
                }
                const restore = s.controlEl.createSpan('clickable-icon setting-restore-hotkey-button')
                setIcon(restore, 'lucide-rotate-ccw')
                restore.addEventListener('click', () => { app.setSpellcheckLanguages(null); draw() })
              } else chips.createSpan({ cls: 'setting-hotkey', text: languageName(systemLocale()) })
              s.addDropdown((d: any) => {
                d.selectEl.style.width = '80px'
                d.addOption('', '+')
                const options = available.map(lang => ({ lang, display: languageName(lang) }))
                options.sort((a, b) => a.display.localeCompare(b.display))
                for (const o of options) d.addOption(o.lang, o.display)
                d.onChange((code: string) => {
                  if (!code) return
                  const cur = langs ? langs.slice() : [systemLocale()]
                  if (!cur.includes(code)) {
                    cur.push(code)
                    app.setSpellcheckLanguages(cur)
                  }
                  draw()
                })
              })
            }
            draw()
          }
        },
        toggle('autoPairBrackets', E + 'optionAutoPairBrackets', E + 'optionAutoPairBracketsDescription'),
        toggle('autoPairMarkdown', E + 'optionAutoPairMarkdown', E + 'optionAutoPairMarkdownDescription'),
        toggle('smartIndentList', E + 'optionSmartIndentLists', E + 'optionSmartIndentListsDescription'),
        toggle('useTab', E + 'optionUseTabs', E + 'optionUseTabsDescription'),
        {
          name: t(E + 'optionTabSize'),
          desc: t(E + 'optionTabSizeDescription'),
          control: { type: 'slider', key: 'tabSize', min: 2, max: 8, step: 1, defaultValue: 4 }
        }
      ]
    })
    defs.push({
      type: 'group',
      heading: t('setting.appearance.optionAdvanced'),
      items: [
        toggle('autoConvertHtml', E + 'optionAutoConvertHtml', E + 'optionAutoConvertHtmlDescription'),
        {
          name: t(E + 'optionVimKeyBindings'),
          desc: t(E + 'optionVimKeyBindingsDescription'),
          render: (s: any) =>
            s.addToggle((tg: any) => {
              tg.setValue(!!app.vault.getConfig('vimMode')).onChange((v: boolean) => {
                if (!v) return app.vault.setConfig('vimMode', false)
                tg.setValue(false)
                this.confirmVim(() => {
                  app.vault.setConfig('vimMode', true)
                  tg.setValue(true)
                })
              })
            })
        }
      ]
    })
    return defs
  }

  /** "Confirm entering Vim mode" dialog: the user must type the quit command. */
  private confirmVim(done: () => void): void {
    const E = 'setting.editor.'
    const m = new ConfirmationModal(this.app)
    m.setTitle(t(E + 'labelConfirmEnableVim'))
    m.contentEl.createEl('p', { text: t(E + 'labelVimWarning') })
    m.contentEl.createEl('p', { text: t(E + 'labelVimTest') })
    const input = m.contentEl.createEl('input', { type: 'text', attr: { placeholder: t(E + 'placeholderEnterCommand'), 'aria-label': t(E + 'labelVimYourAnswer') } })
    m.addButton((b: any) =>
      b.setCta().setButtonText(t(E + 'buttonConfirmEnableVim')).onClick(() => {
        if (/^\s*:q!?\s*$/.test(input.value)) {
          done()
          new Notice(t(E + 'msgVimModeEnabled'))
          return false
        }
        new Notice(t(E + 'msgVimModeNotEnabled'))
        return true
      })
    )
    m.addCancelButton()
    m.open()
  }
}
