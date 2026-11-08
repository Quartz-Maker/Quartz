import { createStore as create } from 'zustand/vanilla'

export interface GraphSettings {
  // Filters
  search: string
  showTags: boolean
  showAttachments: boolean
  showOrphans: boolean
  showExistingOnly: boolean

  // Display
  showArrow: boolean
  textFadeMultiplier: number
  nodeSizeMultiplier: number
  lineSizeMultiplier: number

  // Forces
  centerStrength: number
  repelStrength: number
  linkStrength: number
  linkDistance: number

  // Color groups
  colorGroups: Array<{ query: string; color: string }>
}

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: '',
  showTags: false,
  showAttachments: false,
  showOrphans: true,
  showExistingOnly: false,
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1.0,
  lineSizeMultiplier: 1.0,
  centerStrength: 0.5,
  repelStrength: 10.0,
  linkStrength: 1.0,
  linkDistance: 100,
  colorGroups: []
}

interface GraphSettingsState {
  graphSettings: GraphSettings
  setGraphSettings: (partial: Partial<GraphSettings>) => void
  loadGraphSettings: (vaultPath: string) => Promise<void>
  saveGraphSettings: (vaultPath: string) => Promise<void>
}

export const useGraphSettingsStore = create<GraphSettingsState>((set, get) => ({
  graphSettings: { ...DEFAULT_GRAPH_SETTINGS },

  setGraphSettings: (partial) => {
    set(state => ({
      graphSettings: { ...state.graphSettings, ...partial }
    }))
    const vaultPath = (window as any).__quartzVaultPath
    if (vaultPath) get().saveGraphSettings(vaultPath)
  },

  loadGraphSettings: async (vaultPath: string) => {
    const path = `${vaultPath}/.quartz/graph.json`
    const content = await window.quartzAPI.vault.readFile(path)
    if (content) {
      try {
        const loaded = JSON.parse(content)
        set({ graphSettings: { ...DEFAULT_GRAPH_SETTINGS, ...loaded } })
      } catch { /* use defaults */ }
    }
  },

  saveGraphSettings: async (vaultPath: string) => {
    const dir = `${vaultPath}/.quartz`
    await window.quartzAPI.vault.createDir(dir)
    await window.quartzAPI.vault.writeFile(`${dir}/graph.json`, JSON.stringify(get().graphSettings, null, 2))
  }
}))
