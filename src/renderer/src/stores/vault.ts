import { createStore as create } from 'zustand/vanilla'
import { getApp } from '@/engine/App'
import { TFolder } from '@/engine/vault/TAbstractFile'

/** Folder listing from the in-memory vault tree (null when no loaded App covers the path). */
function listFromVault(dirPath: string): FileEntry[] | null {
  const app = getApp()
  if (!app || !app.metadataCache.initialized) return null
  const base = app.vault.adapter.getBasePath().replace(/\/+$/, '')
  if (dirPath !== base && !dirPath.startsWith(base + '/')) return null
  const rel = dirPath === base ? '/' : dirPath.slice(base.length + 1).normalize('NFC')
  const folder = app.vault.getAbstractFileByPath(rel)
  if (!(folder instanceof TFolder)) return null
  return folder.children
    .map(c => ({ name: c.name, path: base + '/' + c.path, isDirectory: c instanceof TFolder, expanded: false, children: undefined }))
    .sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)))
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
  expanded?: boolean
}

interface VaultState {
  vaultPath: string | null
  files: FileEntry[]
  setVaultPath: (path: string) => void
  setFiles: (files: FileEntry[]) => void
  openVault: () => Promise<void>
  loadFiles: (dirPath: string) => Promise<FileEntry[]>
}

declare global {
  interface Window {
    quartzAPI: {
      vault: {
        open: () => Promise<string | null>
        readDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>
        readFile: (path: string) => Promise<string | null>
        writeFile: (path: string, content: string) => Promise<boolean>
        createFile: (path: string, content: string) => Promise<boolean>
        createDir: (path: string) => Promise<boolean>
        deleteFile: (path: string) => Promise<boolean>
        deleteDir: (path: string) => Promise<boolean>
        renameFile: (oldPath: string, newPath: string) => Promise<boolean>
        stat: (path: string) => Promise<{ size: number; mtime: string; ctime: string; isDirectory: boolean } | null>
        moveToTrash: (path: string) => Promise<boolean>
        trash: (path: string, vaultRoot: string, option: string) => Promise<boolean>
        watchStart: (path: string) => Promise<boolean>
        watchStop: () => Promise<boolean>
        onChange: (callback: (change: { type: string; path: string }) => void) => () => void
      }
      shell: {
        openExternal: (url: string) => Promise<void>
        openPath: (path: string) => Promise<void>
      }
      vaults: {
        getRegistry: () => Promise<{ vaults: Record<string, unknown> }>
        saveRegistry: (data: string) => Promise<boolean>
        createFolder: (path: string) => Promise<boolean>
      }
      app: {
        getOpenFilePath: () => Promise<string | null>
      }
      window: {
        getInitialVault: () => Promise<string | null>
        openVault: (path: string) => Promise<void>
      }
    }
  }
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  files: [],

  setVaultPath: (path) => set({ vaultPath: path }),
  setFiles: (files) => set({ files }),

  openVault: async () => {
    const path = await window.quartzAPI.vault.open()
    if (path) {
      set({ vaultPath: path })
      localStorage.setItem('quartz:lastVault', path)
      const files = await get().loadFiles(path)
      set({ files })
    }
  },

  loadFiles: async (dirPath: string): Promise<FileEntry[]> => {
    const fromVault = listFromVault(dirPath)
    if (fromVault) return fromVault
    const entries = await window.quartzAPI.vault.readDir(dirPath)
    const sorted = entries
      .filter(e => !e.name.startsWith('.'))  // Hide dotfiles
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

    return sorted.map(entry => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      expanded: false,
      children: entry.isDirectory ? undefined : undefined
    }))
  }
}))
