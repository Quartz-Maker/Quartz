// The markdown editor's extension sets:
//
//   base     quartzBaseExtensions()                         (static)
//   local    markdown language, list-indent plugin, Enter / Shift-Enter / Tab list keymap, clipboard
//   dynamic  one Compartment rebuilt from config + mode: tab size, indent unit, RTL, spellcheck,
//            Live Preview (only when not in Source mode), auto-pair, line numbers, smart list
//            renumbering, indent guides, folding, frontmatter shortcut, properties (LP only)
//
// Switching Source <-> Live Preview is `reconfigureEditor(view, compartment, config, mode)` — the same
// EditorState (undo history, folds, selection) is kept (a compartment swap).
import { Compartment, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { indentUnit, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { quartzBaseExtensions, markdownLanguage, wrapSelectionInput } from './baseExtensions'
import { livePreview, livePreviewHost } from './livepreview'
import type { LivePreviewHost } from './livepreview'
import { livePreviewProperties, dashFrontmatterInput } from './livepreview/properties'
import { foldingExtensions } from './folding'
import { indentGuides } from './indentGuides'
import { renumberLists } from './renumber'
import { listIndentPlugin } from './listIndent'
import { isSpecialLine } from './markdownFormatting'
import { Editor } from './Editor'
import { clipboardExtensions } from './clipboard'
import { vimExtension } from './vimMode'
import type { ClipboardOptions } from './clipboard'

/** The `app.json` editor keys the dynamic compartment depends on. */
export interface EditorConfig {
  useTab: boolean
  tabSize: number
  rightToLeft: boolean
  spellcheck: boolean
  autoPairBrackets: boolean
  autoPairMarkdown: boolean
  smartIndentList: boolean
  showLineNumber: boolean
  showIndentGuide: boolean
  foldHeading: boolean
  foldIndent: boolean
  propertiesInDocument: 'visible' | 'hidden' | 'source'
  autoConvertHtml: boolean
  vimMode: boolean
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  useTab: true, tabSize: 4, rightToLeft: false, spellcheck: true, autoPairBrackets: true, autoPairMarkdown: true,
  smartIndentList: true, showLineNumber: false, showIndentGuide: true, foldHeading: true, foldIndent: true,
  propertiesInDocument: 'visible', autoConvertHtml: true, vimMode: false
}

/** Keys whose change requires `reconfigureEditor` (the onConfigChanged list). */
export const DYNAMIC_CONFIG_KEYS: (keyof EditorConfig)[] = ['useTab', 'tabSize', 'rightToLeft', 'spellcheck', 'autoPairBrackets', 'autoPairMarkdown',
  'smartIndentList', 'vimMode', 'showLineNumber', 'showIndentGuide', 'foldHeading', 'foldIndent', 'propertiesInDocument']

/** `editorLivePreviewField`: true while the editor is in Live Preview. */
export const setLivePreviewField = StateEffect.define<boolean>()
export const editorLivePreviewField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) { for (const e of tr.effects) if (e.is(setLivePreviewField)) v = e.value; return v }
})

export type EditorMode = 'source' | 'live'

export interface EditorHostOptions {
  host: LivePreviewHost
  /** `markdown:add-metadata-property`. */
  addProperty?: () => void
  /** Clipboard hooks (attachments, link drops). */
  clipboard?: Omit<ClipboardOptions, 'config'>
  /** The `Editor` for keymaps (created lazily from the view when omitted). */
  editor?: (view: EditorView) => Editor
  /** Plugin-registered editor extensions (`app.workspace.editorExtensions`). */
  pluginExtensions?: () => Extension[]
}

const editors = new WeakMap<EditorView, Editor>()
export function editorFor(view: EditorView): Editor {
  let e = editors.get(view)
  if (!e) editors.set(view, (e = new Editor(view)))
  return e
}

/** Per-view extensions built once (local extensions). */
export function localExtensions(opts: EditorHostOptions, getConfig: () => EditorConfig): Extension[] {
  const ed = (v: EditorView) => (opts.editor ? opts.editor(v) : editorFor(v))
  return [
    markdownLanguage,
    livePreviewHost.of(opts.host),
    listIndentPlugin,
    keymap.of([
      {
        key: 'Enter',
        run: view => {
          if (!getConfig().smartIndentList) return false
          const state = view.state
          const line = state.doc.lineAt(state.selection.main.from)
          if (isSpecialLine(syntaxTree(state), line)) ed(view).newlineAndIndentOnly()
          else ed(view).newlineAndIndentContinueMarkdownList()
          return true
        },
        shift: view => { if (!getConfig().smartIndentList) return false; ed(view).newlineAndIndentOnly(); return true },
        preventDefault: true
      },
      { key: 'Tab', run: view => { ed(view).indentList(); return true }, shift: view => { ed(view).unindentList(); return true } }
    ]),
    clipboardExtensions({ ...(opts.clipboard || {}), config: getConfig })
  ]
}

const lpCache = new WeakMap<object, Extension>()

/** The dynamic compartment content for `config` + `mode`. */
export function dynamicExtensions(config: EditorConfig, mode: EditorMode, opts: EditorHostOptions): Extension[] {
  const out: Extension[] = []
  if (config.vimMode) out.push(vimExtension())
  out.push(EditorState.tabSize.of(config.tabSize))
  out.push(indentUnit.of(config.useTab ? '\t' : '    '))
  if (config.rightToLeft) out.push(EditorView.theme({ '&': { direction: 'rtl' } }))
  out.push(EditorView.contentAttributes.of({ spellcheck: String(config.spellcheck), autocorrect: 'on', autocapitalize: 'on', contenteditable: 'true' }))
  const live = mode === 'live'
  if (live) {
    let lp = lpCache.get(opts)
    if (!lp) lpCache.set(opts, (lp = livePreview()))
    out.push(lp)
  }
  if (config.autoPairBrackets || config.autoPairMarkdown) {
    const brackets: string[] = []
    if (config.autoPairBrackets) brackets.push('(', '[', '{', "'", '"')
    if (config.autoPairMarkdown) brackets.push('*', '_', '`', '```')
    out.push(closeBrackets(), keymap.of(closeBracketsKeymap), EditorState.languageData.of(() => [{ closeBrackets: { brackets } }]), wrapSelectionInput)
  }
  if (opts.pluginExtensions) out.push(...opts.pluginExtensions())
  // MarkdownView additions
  if (config.showLineNumber) out.push(lineNumbers())
  if (config.smartIndentList) out.push(renumberLists())
  if (config.showIndentGuide) out.push(indentGuides)
  out.push(...foldingExtensions(config))
  if (config.autoPairBrackets || config.autoPairMarkdown) out.push(dashFrontmatterInput)
  if (live) out.push(livePreviewProperties({ mode: () => config.propertiesInDocument, addProperty: opts.addProperty }))
  return out
}

export interface MarkdownEditorSetup {
  compartment: Compartment
  extensions: Extension[]
}

/** Everything needed to create the EditorState of a markdown editor. */
export function markdownEditorSetup(config: EditorConfig, mode: EditorMode, opts: EditorHostOptions, getConfig: () => EditorConfig = () => config): MarkdownEditorSetup {
  const compartment = new Compartment()
  return {
    compartment,
    // Order: local, dynamic compartment, then the shared base list (so e.g. the list
    // keymap and closeBrackets' Backspace win over the default keymap)
    extensions: [
      localExtensions(opts, getConfig),
      compartment.of(dynamicExtensions(config, mode, opts)),
      editorLivePreviewField.init(() => mode === 'live'),
      quartzBaseExtensions()
    ]
  }
}

/**
 * Shell slot API (`MarkdownView.setLivePreviewExtensions`): the dynamic compartment content for Live
 * Preview and for Source mode. Put the result in a Compartment and swap between the two with
 * `compartment.reconfigure(...)` (plus `setLivePreviewField.of(isLive)`); base + local extensions come
 * from `quartzBaseExtensions()` / `localExtensions()` (or simply use `markdownEditorSetup`).
 */
export function livePreviewExtensions(opts: EditorHostOptions, config: EditorConfig = DEFAULT_EDITOR_CONFIG): Extension[] {
  return dynamicExtensions(config, 'live', opts)
}
export function sourceModeExtensions(opts: EditorHostOptions, config: EditorConfig = DEFAULT_EDITOR_CONFIG): Extension[] {
  return dynamicExtensions(config, 'source', opts)
}
export { quartzBaseExtensions }

/** Swap mode / config in place (no remount; undo history and folds survive). */
export function reconfigureEditor(view: EditorView, compartment: Compartment, config: EditorConfig, mode: EditorMode, opts: EditorHostOptions) {
  view.dispatch({ effects: [compartment.reconfigure(dynamicExtensions(config, mode, opts)), setLivePreviewField.of(mode === 'live')] })
}

