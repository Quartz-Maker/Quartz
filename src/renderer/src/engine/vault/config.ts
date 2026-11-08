// Vault config defaults and the keys stored in appearance.json instead of app.json.

/** Name of the config folder. Same file formats as a `.obsidian` folder, for vault compatibility. */
export const DEFAULT_CONFIG_DIR = '.quartz'

export const APPEARANCE_KEYS: readonly string[] = [
  'accentColor', 'theme', 'cssTheme', 'enabledCssSnippets', 'showViewHeader', 'showRibbon', 'nativeMenus',
  'translucency', 'textFontFamily', 'interfaceFontFamily', 'monospaceFontFamily', 'baseFontSize',
  'baseFontSizeAction', 'slidingSidebar', 'floatingNavigation', 'autoFullScreen'
]

export const CONFIG_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  alwaysUpdateLinks: false,
  spellcheck: true,
  readableLineLength: true,
  strictLineBreaks: false,
  propertiesInDocument: 'visible',
  showInlineTitle: true,
  showViewHeader: true,
  showRibbon: true,
  slidingSidebar: true,
  floatingNavigation: true,
  autoFullScreen: true,
  mobileQuickRibbonItem: '',
  useMarkdownLinks: false,
  showUnsupportedFiles: false,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  smartIndentList: true,
  foldHeading: true,
  foldIndent: true,
  showLineNumber: false,
  showIndentGuide: true,
  useTab: true,
  tabSize: 4,
  rightToLeft: false,
  autoConvertHtml: true,
  vimMode: false,
  livePreview: true,
  nativeMenus: null,
  attachmentFolderPath: '/',
  newFileLocation: 'root',
  newFileFolderPath: '/',
  newLinkFormat: 'shortest',
  userIgnoreFilters: null,
  focusNewTab: true,
  defaultViewMode: 'source',
  promptDelete: true,
  trashOption: 'system',
  deleteUnlinkedAttachments: 'ask',
  openBehavior: '',
  pdfExportSettings: { pageSize: 'Letter', landscape: false, margin: '0', downscalePercent: 100 },
  uriCallbacks: false,
  mobilePullAction: 'command-palette:open',
  mobileToolbarCommands: [
    'editor:undo', 'editor:redo', 'editor:insert-wikilink', 'editor:insert-embed', 'editor:insert-tag',
    'editor:attach-file', 'editor:set-heading', 'editor:toggle-bold', 'editor:toggle-italics',
    'editor:toggle-strikethrough', 'editor:toggle-highlight', 'editor:toggle-code', 'editor:toggle-blockquote',
    'editor:toggle-comment', 'editor:insert-link', 'editor:toggle-bullet-list', 'editor:toggle-numbered-list',
    'editor:toggle-checklist-status', 'editor:indent-list', 'editor:unindent-list', 'editor:configure-toolbar'
  ],
  settingsPopoutWindow: true,
  hotkeys: {},
  theme: 'system',
  accentColor: '',
  cssTheme: '',
  enabledCssSnippets: [],
  translucency: false,
  textFontFamily: '',
  interfaceFontFamily: '',
  monospaceFontFamily: '',
  baseFontSizeAction: false,
  types: {}
})

/** Accepted config-dir names: start with ".", not ".", no illegal chars. */
export function validateConfigDir(dir: string, illegal: RegExp): boolean {
  return dir !== '.' && dir.startsWith('.') && !illegal.test(dir)
}
