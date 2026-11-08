/* eslint-disable @typescript-eslint/no-explicit-any */
// The 30 core plugins (registration order, ids, names, descriptions, defaultOn). Each registers its views / commands / ribbon icons / status bar
// items through its InternalPlugin wrapper, so disabling removes them again.
// Views marked "bridge" host a legacy React panel inside the leaf DOM (transitional).
import type { CorePluginDef, InternalPlugin } from '@/engine/app/InternalPlugins'
import { DEFAULT_HOTKEYS } from '@/engine/commands'
import { Keymap } from '@/engine/keymap/Keymap'
import { Notice } from '@/engine/ui/Notice'
import { Menu } from '@/engine/ui/Menu'
import { setIcon, setTooltip } from '@/engine/ui'
import { registerSearchView, openGlobalSearch, VIEW_TYPE_SEARCH } from '@/engine/search/SearchView'
import { getGraphPlugin, graphCommands } from '@/engine/views/graph/plugin'
import { VIEW_TYPE_GRAPH, VIEW_TYPE_LOCAL_GRAPH } from '@/engine/views/graph/GraphView'
import { AllPropertiesView, VIEW_TYPE_ALL_PROPERTIES } from '@/engine/views/properties/AllPropertiesView'
import { MarkdownView } from '@/engine/views/markdown/MarkdownView'
import { pagePreviewPlugin } from '@/engine/app/pagePreview'
import { canvasCorePlugin } from '@/engine/views/canvas/plugin'
import { basesCorePlugin } from '@/engine/views/bases/plugin'
import { openQuickSwitcher, openCommandPalette } from '@/engine/switcher'
import { FileExplorerView, VIEW_TYPE_FILE_EXPLORER } from '@/engine/views/file-explorer/FileExplorerView'
import { BacklinkView, VIEW_TYPE_BACKLINK } from '@/engine/views/backlink/BacklinkView'
import { OutgoingLinkView, VIEW_TYPE_OUTGOING_LINK } from '@/engine/views/backlink/OutgoingLinkView'
import { TagView, VIEW_TYPE_TAG } from '@/engine/views/tag/TagView'
import { OutlineView, VIEW_TYPE_OUTLINE } from '@/engine/views/outline/OutlineView'
import { BookmarksPlugin } from '@/engine/views/bookmarks/BookmarksPlugin'
import { FilePropertiesView, VIEW_TYPE_FILE_PROPERTIES } from '@/engine/views/properties/FilePropertiesView'
import { dailyNotesPlugin } from '@/engine/corePlugins/dailyNotes'
import { templatesPlugin } from '@/engine/corePlugins/templates'
import { slidesPlugin, audioRecorderPlugin } from '@/engine/corePlugins/slides'
import { workspacesPlugin } from '@/engine/corePlugins/workspaces'
import { fileRecoveryPlugin } from '@/engine/corePlugins/fileRecovery'
import { webviewerPlugin } from '@/engine/corePlugins/webviewer'
import { noteComposerPlugin } from '@/engine/corePlugins/composer'
import { zkPrefixerPlugin, randomNotePlugin, wordCountPlugin, editorStatusPlugin, slashCommandPlugin, registerOpenWithDefaultApp } from '@/engine/corePlugins/small'

const hk = (id: string) => (DEFAULT_HOTKEYS[id] ? { hotkeys: DEFAULT_HOTKEYS[id] } : {})
const sideLeaf = (type: string, side: 'left' | 'right') => (app: any) => void app.workspace.ensureSideLeaf(type, side, { reveal: false })
/** `initLeaf` pattern: create the side leaf on layout-ready and when the user enables the plugin. */
function withSideLeaf(def: CorePluginDef, type: string, side: 'left' | 'right'): CorePluginDef {
  const enable = def.onEnable
  return {
    ...def,
    async onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on('layout-ready', () => sideLeaf(type, side)(app)))
      await enable?.(app, plugin)
    },
    onUserEnable(app) {
      sideLeaf(type, side)(app)
    }
  }
}
const absPath = (app: any, rel: string) => app.vault.adapter.getFullPath(rel)
const activeFile = (app: any) => app.workspace.getActiveFile()

async function newNote(app: any, evt?: any): Promise<void> {
  const src = activeFile(app)?.path ?? ''
  const parent = app.fileManager.getNewFileParent(src)
  const f = await app.fileManager.createNewMarkdownFile(parent)
  await app.workspace.getLeaf(Keymap.isModEvent(evt ?? app.lastEvent)).openFile(f, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } })
}

function wordCount(text: string): { words: number; chars: number } {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '')
  const cjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g
  const nCjk = (body.match(cjk) || []).length
  const words = (body.replace(cjk, ' ').match(/[0-9]+(?:[.,][0-9]+)*|[\p{L}\p{M}'’-]+/gu) || []).length + nCjk
  return { words, chars: body.length }
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** App of the enabled file-explorer plugin (for its plugin-level `revealInFolder`). */
let explorerApp: any = null

export const CORE_PLUGINS: CorePluginDef[] = [
  withSideLeaf(
    {
      id: 'file-explorer',
      name: 'Files',
      description: 'Browse the files and folders in your vault.',
      defaultOn: true,
      /** Plugin-level reveal (reference): ensure an explorer leaf, reveal + focus it, then reveal the file. */
      async revealInFolder(file: any) {
        const app = explorerApp
        if (!app) return
        let leaf = app.workspace.getLeavesOfType(VIEW_TYPE_FILE_EXPLORER)[0]
        if (!leaf) {
          leaf = app.workspace.getLeftLeaf(false)
          await leaf.setViewState({ type: VIEW_TYPE_FILE_EXPLORER })
        }
        await app.workspace.revealLeaf(leaf)
        app.workspace.setActiveLeaf(leaf, { focus: true })
        leaf.view?.revealInFolder?.(file)
      },
      onEnable(app, p) {
        explorerApp = app
        p.registerViewType(VIEW_TYPE_FILE_EXPLORER, leaf => new FileExplorerView(leaf))
        p.registerGlobalCommand({ id: 'file-explorer:new-file', name: 'Create new note', icon: 'lucide-file-plus', ...hk('file-explorer:new-file'), callback: () => void newNote(app) })
        p.registerGlobalCommand({ id: 'file-explorer:new-file-in-new-pane', name: 'Create note to the right', icon: 'lucide-file-plus', ...hk('file-explorer:new-file-in-new-pane'), callback: () => void newNote(app, { ctrlKey: true, metaKey: true, altKey: true }) })
        p.registerGlobalCommand({ id: 'file-explorer:open', name: 'Files: Show file explorer', icon: 'lucide-folder-closed', callback: () => void app.workspace.ensureSideLeaf('file-explorer', 'left', { active: true, reveal: true }) })
        p.registerGlobalCommand({
          id: 'file-explorer:reveal-active-file',
          name: 'Files: Reveal current file in navigation',
          icon: 'lucide-folder-open',
          checkCallback: c => {
            if (!activeFile(app)) return false
            if (!c)
              void app.workspace.ensureSideLeaf('file-explorer', 'left', { active: true, reveal: true }).then((l: any) => l.view?.revealInFolder?.(activeFile(app)))
            return true
          }
        })
      }
    },
    'file-explorer',
    'left'
  ),
  withSideLeaf(
    {
      id: 'global-search',
      name: 'Search',
      description: 'Search for a keyword in all the notes.',
      defaultOn: true,
      onEnable(app, p) {
        registerSearchView(app)
        p.views.push(VIEW_TYPE_SEARCH)
        p.registerEvent(
          app.workspace.on('file-menu', (menu: any, file: any, source: string) => {
            if (source !== 'file-explorer-context-menu' || !file || !Array.isArray(file.children) || file.isRoot?.()) return
            menu.addItem((i: any) =>
              i
                .setSection('action')
                .setTitle('Search in folder')
                .setIcon('lucide-folder-search')
                .onClick(() => openGlobalSearch(app, 'path:"' + file.path + '/" '))
            )
          })
        )
        p.registerGlobalCommand({
          id: 'global-search:open',
          name: 'Search: Search in all files',
          icon: 'lucide-search',
          ...hk('global-search:open'),
          callback: () => {
            const sel = app.workspace.activeEditor?.editor?.getSelection?.() ?? ''
            openGlobalSearch(app, sel && !sel.includes('\n') ? sel : (app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH)[0]?.getViewState()?.state?.query ?? ''))
          }
        })
      },
      openGlobalSearch(this: any, query: string) {
        openGlobalSearch(this.app ?? (window as any).app, query)
      }
    },
    VIEW_TYPE_SEARCH,
    'left'
  ),
  {
    id: 'switcher',
    name: 'Quick switcher',
    description: 'Jump to other files with your keyboard.',
    defaultOn: true,
    onEnable(app, p) {
      p.addRibbonIcon('lucide-file-search', 'Open quick switcher', () => openQuickSwitcher(app))
      p.registerGlobalCommand({ id: 'switcher:open', name: 'Quick switcher: Open quick switcher', icon: 'lucide-navigation', ...hk('switcher:open'), callback: () => openQuickSwitcher(app) })
    }
  },
  {
    id: 'graph',
    name: 'Graph view',
    description: 'Visualize the relationships between your notes.',
    defaultOn: true,
    async onEnable(app, p) {
      const plugin = await getGraphPlugin(app)
      plugin.registerViews()
      p.views.push(VIEW_TYPE_GRAPH, VIEW_TYPE_LOCAL_GRAPH)
      p.addRibbonIcon('lucide-git-fork', 'Open graph view', evt => plugin.openGraphView(evt))
      for (const c of graphCommands(() => app, () => plugin)) p.registerGlobalCommand(c)
    }
  },
  withSideLeaf(
    {
      id: 'backlink',
      name: 'Backlinks',
      description: 'Show links from other files to the current file. Backlinks can be shown in a separate view or at the bottom of the note.',
      defaultOn: true,
      onEnable(app, p) {
        p.registerViewType(VIEW_TYPE_BACKLINK, leaf => new BacklinkView(leaf))
        app.workspace.backlinkInDocument = (p.instance as any)?.options?.backlinkInDocument
        p.registerGlobalCommand({
          id: 'backlink:toggle-backlinks-in-document',
          name: 'Backlinks: Toggle backlinks in document',
          icon: 'lucide-link',
          checkCallback: (checking: boolean) => {
            const v: any = app.workspace.getActiveViewOfType?.(MarkdownView) ?? null
            if (!v || !v.canToggleBacklinks?.()) return false
            if (!checking) void v.toggleBacklinks()
            return true
          }
        })
        const el = p.addStatusBarItem()
        el.addClass('mod-clickable')
        el.addEventListener('click', () => void app.workspace.ensureSideLeaf('backlink', 'right', { active: true, reveal: true }))
        const update = () => {
          const f = activeFile(app)
          if (!f || f.extension !== 'md') return el.hide()
          let n = 0
          const res = app.metadataCache.resolvedLinks || {}
          // Reference counts link occurrences from other notes (self-links excluded), not linking notes.
          for (const src in res) if (src !== f.path && res[src][f.path]) n += res[src][f.path]
          el.setText(plural(n, 'backlink', 'backlinks'))
          el.show()
        }
        p.registerEvent(app.workspace.on('file-open', update))
        p.registerEvent(app.metadataCache.on('resolved', update))
        update()
        p.registerGlobalCommand({ id: 'backlink:open', name: 'Backlinks: Show backlinks', icon: 'links-coming-in', callback: () => void app.workspace.ensureSideLeaf('backlink', 'right', { active: true, reveal: true }) })
      }
    },
    'backlink',
    'right'
  ),
  canvasCorePlugin,
  withSideLeaf(
    {
      id: 'outgoing-link',
      name: 'Outgoing links',
      description: 'Show outgoing links and detect unlinked mentions of other notes in the current note.',
      defaultOn: true,
      onEnable(app, p) {
        p.registerViewType(VIEW_TYPE_OUTGOING_LINK, leaf => new OutgoingLinkView(leaf))
        p.registerGlobalCommand({ id: 'outgoing-links:open', name: 'Outgoing links: Show outgoing links', icon: 'links-going-out', callback: () => void app.workspace.ensureSideLeaf('outgoing-link', 'right', { active: true, reveal: true }) })
      }
    },
    'outgoing-link',
    'right'
  ),
  withSideLeaf(
    {
      id: 'tag-pane',
      name: 'Tags view',
      description: 'Show a list of all tags and their number of occurrences.',
      defaultOn: true,
      onEnable(app, p) {
        p.registerViewType(VIEW_TYPE_TAG, leaf => new TagView(leaf))
        p.registerGlobalCommand({ id: 'tag-pane:open', name: 'Tags view: Show tags', icon: 'lucide-tags', callback: () => void app.workspace.ensureSideLeaf('tag', 'right', { active: true, reveal: true }) })
      }
    },
    'tag',
    'right'
  ),
  { id: 'footnotes', name: 'Footnotes view', description: 'Show a list of footnotes from the current note.', defaultOn: false },
  withSideLeaf(
    {
      id: 'properties',
      name: 'Properties view',
      description: 'Show the metadata for your files in the sidebar.',
      defaultOn: true,
      onEnable(app, p) {
        p.registerViewType(VIEW_TYPE_ALL_PROPERTIES, leaf => new AllPropertiesView(leaf))
        p.registerViewType(VIEW_TYPE_FILE_PROPERTIES, leaf => new FilePropertiesView(leaf))
        const el = p.addStatusBarItem()
        el.addClass('mod-clickable')
        el.addEventListener('click', () => void app.workspace.ensureSideLeaf('file-properties', 'right', { active: true, reveal: true }))
        const update = () => {
          const f = activeFile(app)
          const fm = f ? app.metadataCache.getFileCache(f)?.frontmatter : null
          const n = fm ? Object.keys(fm).length : 0
          if (!n) return el.hide()
          el.setText(plural(n, 'property', 'properties'))
          el.show()
        }
        p.registerEvent(app.workspace.on('file-open', update))
        p.registerEvent(app.metadataCache.on('changed', update))
        update()
        p.registerGlobalCommand({ id: 'properties:open', name: 'Properties view: Show all properties', icon: 'lucide-archive', callback: () => void app.workspace.ensureSideLeaf(VIEW_TYPE_ALL_PROPERTIES, 'right', { active: true, reveal: true }) })
        p.registerGlobalCommand({ id: 'properties:open-local', name: 'Properties view: Show file properties', icon: 'lucide-info', callback: () => void app.workspace.ensureSideLeaf('file-properties', 'right', { active: true, reveal: true }) })
      }
    },
    VIEW_TYPE_ALL_PROPERTIES,
    'right'
  ),
  pagePreviewPlugin,
  dailyNotesPlugin,
  templatesPlugin,
  noteComposerPlugin,
  {
    id: 'command-palette',
    name: 'Command palette',
    description: 'Use Cmd/Ctrl+P and begin typing to invoke a command.',
    defaultOn: true,
    onEnable(app, p) {
      p.addRibbonIcon('lucide-terminal', 'Open command palette', () => openCommandPalette(app))
      p.registerGlobalCommand({ id: 'command-palette:open', name: 'Command palette: Open command palette', icon: 'lucide-terminal-square', showOnMobileToolbar: true, ...hk('command-palette:open'), callback: () => openCommandPalette(app) })
    }
  },
  slashCommandPlugin,
  editorStatusPlugin,
  new BookmarksPlugin(),
  zkPrefixerPlugin,
  randomNotePlugin,
  withSideLeaf(
    {
      id: 'outline',
      name: 'Outline',
      description: 'Show the table of contents for the current note.',
      defaultOn: true,
      onEnable(app, p) {
        p.registerViewType(VIEW_TYPE_OUTLINE, leaf => new OutlineView(leaf))
        p.registerGlobalCommand({ id: 'outline:open', name: 'Outline: Show outline', icon: 'lucide-list', callback: () => void app.workspace.ensureSideLeaf('outline', 'right', { active: true, reveal: true }) })
      }
    },
    'outline',
    'right'
  ),
  wordCountPlugin,
  slidesPlugin,
  audioRecorderPlugin,
  workspacesPlugin,
  fileRecoveryPlugin,
  // Kept for core-plugins.json format compatibility only: no UI, commands or services (hidden from the Core plugins tab).
  { id: 'publish', name: 'Publish', description: '', defaultOn: false, hiddenFromList: true },
  { id: 'sync', name: 'Sync', description: '', defaultOn: true, hiddenFromList: true },
  basesCorePlugin,
  webviewerPlugin,
]

export function registerCorePlugins(app: any): void {
  registerOpenWithDefaultApp(app)
  for (const def of CORE_PLUGINS) app.internalPlugins.loadPlugin(def)
}

export type { InternalPlugin }
