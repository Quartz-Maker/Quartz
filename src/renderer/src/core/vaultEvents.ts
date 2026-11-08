import { useMetadataStore, updateContentCache } from '@/stores/metadata'
import { useVaultStore } from '@/stores/vault'
import { useSearchStore } from '@/stores/search'
import { getApp } from '@/engine/App'

export type VaultChangeType = 'create' | 'modify' | 'delete'
export interface VaultChange {
  type: VaultChangeType
  path: string
}

type Listener = (change: VaultChange) => void

const listeners = new Set<Listener>()

export function onVaultChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(change: VaultChange): void {
  for (const cb of listeners) cb(change)
}

let unsubscribe: (() => void) | null = null
let searchReindexTimer: ReturnType<typeof setTimeout> | null = null

export function stopVaultWatcher(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  window.quartzAPI.vault.watchStop()
}

export async function initVaultWatcher(vaultPath: string): Promise<void> {
  stopVaultWatcher()
  await window.quartzAPI.vault.watchStart(vaultPath)

  unsubscribe = window.quartzAPI.vault.onChange(async (change) => {
    const { type, path } = change as VaultChange

    // With the data core running, app.metadataCache indexes changes itself.
    if (path.endsWith('.md') && !getApp()) {
      if (type === 'delete') {
        useMetadataStore.getState().removeFile(path)
      } else {
        const content = await window.quartzAPI.vault.readFile(path)
        if (content !== null) {
          useMetadataStore.getState().indexFile(path, content)
          updateContentCache(path, content)
        }
      }
    }

    // Refresh file explorer on create/delete (structure change)
    if (type === 'create' || type === 'delete') {
      const vaultStore = useVaultStore.getState()
      const files = await vaultStore.loadFiles(vaultPath)
      vaultStore.setFiles(files)
    }

    // Debounced search re-index
    if (searchReindexTimer) clearTimeout(searchReindexTimer)
    searchReindexTimer = setTimeout(() => {
      useSearchStore.getState().indexVault(vaultPath)
    }, 500)

    emit(change as VaultChange)
  })
}
