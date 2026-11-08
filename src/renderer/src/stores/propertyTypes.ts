import { createStore as create } from 'zustand/vanilla'

export type PropertyType = 'text' | 'multitext' | 'number' | 'checkbox' | 'date' | 'datetime' | 'aliases' | 'tags'

export interface PropertyTypeMap {
  [propertyName: string]: PropertyType
}

const DEFAULT_TYPES: PropertyTypeMap = {
  tags: 'tags',
  aliases: 'aliases'
}

interface PropertyTypesState {
  types: PropertyTypeMap
  setType: (name: string, type: PropertyType) => void
  removeType: (name: string) => void
  getType: (name: string, value?: any) => PropertyType
  loadTypes: (vaultPath: string) => Promise<void>
  saveTypes: (vaultPath: string) => Promise<void>
}

export const usePropertyTypesStore = create<PropertyTypesState>((set, get) => ({
  types: { ...DEFAULT_TYPES },

  setType: (name, type) => {
    set(state => ({ types: { ...state.types, [name]: type } }))
    const vaultPath = (window as any).__quartzVaultPath
    if (vaultPath) get().saveTypes(vaultPath)
  },

  removeType: (name) => {
    set(state => {
      const next = { ...state.types }
      delete next[name]
      return { types: next }
    })
    const vaultPath = (window as any).__quartzVaultPath
    if (vaultPath) get().saveTypes(vaultPath)
  },

  getType: (name, value) => {
    const explicit = get().types[name]
    if (explicit) return explicit
    // Auto-detect from value
    if (value === undefined || value === null) return 'text'
    if (typeof value === 'boolean') return 'checkbox'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'multitext'
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime'
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
    }
    return 'text'
  },

  loadTypes: async (vaultPath: string) => {
    const path = `${vaultPath}/.quartz/types.json`
    const content = await window.quartzAPI.vault.readFile(path)
    if (content) {
      try {
        set({ types: { ...DEFAULT_TYPES, ...JSON.parse(content) } })
      } catch { /* use defaults */ }
    }
  },

  saveTypes: async (vaultPath: string) => {
    const dir = `${vaultPath}/.quartz`
    await window.quartzAPI.vault.createDir(dir)
    await window.quartzAPI.vault.writeFile(`${dir}/types.json`, JSON.stringify(get().types, null, 2))
  }
}))
