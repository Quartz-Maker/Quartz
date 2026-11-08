// Test harness: a minimal AppLike (stub vault/commands/hotkeys/internal plugins) + mounted workspace.
// Throwaway vault: empty vault named "vault", bases + canvas core plugins on.
import { widgets } from '../../views/properties/widgets'
import { Events } from '../../core/Events'
import { installEnhancements } from '../../core/enhance'
import { ViewRegistry } from '../../view/ViewRegistry'
import { mountWorkspace } from '../mountWorkspace'
import { executeWorkspaceCommand } from '../commands'
import type { AppLike } from '../AppLike'
import type { Workspace } from '../Workspace'

/** Ribbon items registered by the default core plugins, in registration order. */
export const CORE_RIBBON_ITEMS: [string, string, string][] = [
  ['switcher:Open quick switcher', 'lucide-file-search', 'Open quick switcher'],
  ['graph:Open graph view', 'lucide-git-fork', 'Open graph view'],
  ['canvas:Create new canvas', 'lucide-layout-dashboard', 'Create new canvas'],
  ["daily-notes:Open today's daily note", 'lucide-calendar', "Open today's daily note"],
  ['templates:Insert template', 'lucide-files', 'Insert template'],
  ['command-palette:Open command palette', 'lucide-terminal', 'Open command palette'],
  ['bases:Create new base', 'lucide-layout-list', 'Create new base']
]

export interface TestApp extends AppLike {
  files: Record<string, string>
  vaultEvents: Events
}

export function createTestApp(opts: { files?: Record<string, string>; config?: Record<string, any>; abstractFiles?: Record<string, any> } = {}): TestApp {
  installEnhancements(window as any)
  const files: Record<string, string> = { ...(opts.files || {}) }
  const config: Record<string, any> = { focusNewTab: true, showRibbon: true, ...(opts.config || {}) }
  const vaultEvents = new Events()
  const app: any = {
    files,
    vaultEvents,
    vault: {
      configDir: '.obsidian',
      getName: () => 'vault',
      getAbstractFileByPath: (p: string) => opts.abstractFiles?.[p] ?? null,
      getConfig: (k: string) => config[k],
      setConfig: (k: string, v: any) => (config[k] = v),
      isEmpty: () => true,
      on: (n: string, cb: any, ctx?: any) => vaultEvents.on(n, cb, ctx),
      adapter: {
        read: async (p: string) => {
          if (!(p in files)) throw new Error('ENOENT ' + p)
          return files[p]
        },
        write: async (p: string, d: string) => {
          files[p] = d
        },
        getBasePath: () => '/tmp/vault'
      }
    },
    viewRegistry: new ViewRegistry(),
    metadataTypeManager: { on: () => ({}), off: () => {}, getTypeInfo: () => ({ expected: widgets.text, inferred: widgets.text }), getAssignedWidget: () => null, getWidget: () => widgets.text, registeredTypeWidgets: widgets, getAllProperties: () => ({}) },
    hotkeyManager: { printHotkeyForCommand: (id: string) => ({ 'file-explorer:new-file': 'Ctrl + N', 'switcher:open': 'Ctrl + O' } as any)[id] || '' },
    internalPlugins: { getEnabledPluginById: (id: string) => (['bases', 'canvas'].includes(id) ? {} : null) },
    commands: { executeCommandById: (id: string) => executeWorkspaceCommand(app.workspace as Workspace, id) }
  }
  return app as TestApp
}

export async function mountTestWorkspace(app: TestApp, layout?: unknown, opts: { coreRibbon?: boolean } = {}) {
  document.body.empty()
  if (layout !== undefined) app.files['.obsidian/workspace.json'] = JSON.stringify(layout)
  const mounted = await mountWorkspace(document.body, app, { loadLayout: false })
  if (opts.coreRibbon !== false) for (const [id, icon, title] of CORE_RIBBON_ITEMS) mounted.workspace.leftRibbon.addRibbonItemButton(id, icon, title, () => {})
  await mounted.workspace.loadLayout()
  return mounted
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
