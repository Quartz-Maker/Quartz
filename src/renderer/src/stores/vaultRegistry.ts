import { createStore as create } from 'zustand/vanilla'
import { electron } from '@/engine/node'

// The vault registry is owned by the main process (`userData/quartz.json`). The renderer reads it with `vault-list` and changes it only via
// the IPC channels (`vault-open`, `vault-remove`, `vault-move`) — all sendSync.

export interface VaultEntry {
  path: string
  ts: number
  open?: boolean
}

export interface VaultRegistry {
  vaults: { [id: string]: VaultEntry }
}

interface VaultRegistryState {
  registry: VaultRegistry
  loading: boolean
  loadRegistry: () => Promise<void>
  /** `vault-open(path, false)`: register + open/focus its window. true or an error string. */
  openVault: (path: string) => true | string
  /** `vault-open(path, true)`: create the folder, register and open it. */
  createVault: (path: string) => true | string
  /** `vault-remove(path)`: false when the vault is open (or unknown). */
  removeVault: (id: string) => boolean
  /** `vault-move(from, to)`: "" on success, "EVAULTOPEN", an error string, or false. */
  moveVault: (id: string, to: string) => string | false
  getVaultList: () => Array<{ id: string; path: string; name: string; ts: number; open?: boolean }>
  /** The vault of this window (`vault` IPC); `{}` in the starter window. */
  currentVault: () => { id?: string; path?: string; configPath?: string }
}

const ipc = () => electron().ipcRenderer

export const useVaultRegistryStore = create<VaultRegistryState>((set, get) => ({
  registry: { vaults: {} },
  loading: true,

  loadRegistry: async () => {
    const vaults = ipc().sendSync('vault-list') || {}
    set({ registry: { vaults }, loading: false })
  },

  openVault: (path: string) => {
    const r = ipc().sendSync('vault-open', path, false)
    get().loadRegistry()
    return r
  },

  createVault: (path: string) => {
    const r = ipc().sendSync('vault-open', path, true)
    get().loadRegistry()
    return r
  },

  removeVault: (id: string) => {
    const entry = get().registry.vaults[id]
    if (!entry) return false
    const ok = ipc().sendSync('vault-remove', entry.path) === true
    get().loadRegistry()
    return ok
  },

  moveVault: (id: string, to: string) => {
    const entry = get().registry.vaults[id]
    if (!entry) return false
    const r = ipc().sendSync('vault-move', entry.path, to)
    get().loadRegistry()
    return r
  },

  getVaultList: () => {
    const { registry } = get()
    return Object.entries(registry.vaults)
      .map(([id, entry]) => ({
        id,
        path: entry.path,
        name: entry.path.split(/[\\/]/).pop() || entry.path,
        ts: entry.ts,
        open: entry.open
      }))
      .sort((a, b) => b.ts - a.ts)
  },

  currentVault: () => ipc().sendSync('vault') || {}
}))
