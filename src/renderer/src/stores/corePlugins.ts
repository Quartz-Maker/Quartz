import { createStore as create } from 'zustand/vanilla'

export interface CorePluginsMap {
  'file-explorer': boolean
  'global-search': boolean
  'switcher': boolean
  'graph': boolean
  'backlink': boolean
  'outgoing-link': boolean
  'canvas': boolean
  'page-preview': boolean
  'daily-notes': boolean
  'templates': boolean
  'command-palette': boolean
  'bookmarks': boolean
  'outline': boolean
  'word-count': boolean
  'properties': boolean
  'tag-pane': boolean
  'note-composer': boolean
  'file-recovery': boolean
  'slash-command': boolean
  'random-note': boolean
  'workspaces': boolean
  [key: string]: boolean
}

const DEFAULT_CORE_PLUGINS: CorePluginsMap = {
  'file-explorer': true,
  'global-search': true,
  'switcher': true,
  'graph': true,
  'backlink': true,
  'outgoing-link': true,
  'canvas': true,
  'page-preview': true,
  'daily-notes': true,
  'templates': true,
  'command-palette': true,
  'bookmarks': true,
  'outline': true,
  'word-count': true,
  'properties': true,
  'tag-pane': false,
  'note-composer': false,
  'file-recovery': true,
  'slash-command': false,
  'random-note': false,
  'workspaces': false
}

interface CorePluginsState {
  plugins: CorePluginsMap
  setPlugin: (id: string, enabled: boolean) => void
  isEnabled: (id: string) => boolean
  loadCorePlugins: (vaultPath: string) => Promise<void>
  saveCorePlugins: (vaultPath: string) => Promise<void>
}

export const useCorePluginsStore = create<CorePluginsState>((set, get) => ({
  plugins: { ...DEFAULT_CORE_PLUGINS },

  setPlugin: (id, enabled) => {
    set(state => ({
      plugins: { ...state.plugins, [id]: enabled }
    }))
    // The real registry (app.internalPlugins) owns enable/disable and core-plugins.json.
    const ip = (window as any).app?.internalPlugins
    if (ip) {
      void ip.setEnabled(id, enabled)
      return
    }
    const vaultPath = (window as any).__quartzVaultPath
    if (vaultPath) get().saveCorePlugins(vaultPath)
  },

  isEnabled: (id) => {
    return get().plugins[id] ?? true
  },

  loadCorePlugins: async (vaultPath: string) => {
    const ip = (window as any).app?.internalPlugins
    if (ip && Object.keys(ip.plugins).length) {
      const plugins: CorePluginsMap = { ...DEFAULT_CORE_PLUGINS }
      for (const id of Object.keys(ip.plugins)) plugins[id] = ip.plugins[id].enabled
      set({ plugins })
      return
    }
    const path = `${vaultPath}/.quartz/core-plugins.json`
    const content = await window.quartzAPI.vault.readFile(path)
    if (content) {
      try {
        const loaded = JSON.parse(content)
        set({ plugins: { ...DEFAULT_CORE_PLUGINS, ...loaded } })
      } catch { /* use defaults */ }
    }
  },

  saveCorePlugins: async (vaultPath: string) => {
    const dir = `${vaultPath}/.quartz`
    await window.quartzAPI.vault.createDir(dir)
    await window.quartzAPI.vault.writeFile(`${dir}/core-plugins.json`, JSON.stringify(get().plugins, null, 2))
  }
}))

/** Hook for components to check if a feature is enabled */
export function useFeatureEnabled(id: string): boolean {
  return useCorePluginsStore.getState().plugins[id] ?? true
}
