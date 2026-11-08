import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { readdir, readFile, writeFile, mkdir, stat, rename, unlink, rm } from 'fs/promises'
import { join, relative, basename, dirname, extname, sep } from 'path'
import { existsSync, watch, FSWatcher } from 'fs'
import { getRegistry, vaultPathOfSender, openVaultPath } from './core'
import { redirectTempConfigPath } from './tempVaults'

// One watcher per renderer (each vault window watches its own vault).
interface WatchState { watcher: FSWatcher; pending: Map<string, ReturnType<typeof setTimeout>> }
const watchers = new Map<number, WatchState>()

function stopVaultWatcher(id?: number): void {
  const ids = id === undefined ? [...watchers.keys()] : [id]
  for (const k of ids) {
    const w = watchers.get(k)
    if (!w) continue
    w.watcher.close()
    for (const timer of w.pending.values()) clearTimeout(timer)
    watchers.delete(k)
  }
}

export function setupIPC(): void {
  // Vault operations
  ipcMain.handle('vault:open', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const options = {
        properties: ['openDirectory'] as Array<'openDirectory'>,
        title: 'Open Vault Folder'
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (err) {
      console.error('vault:open error:', err)
      return null
    }
  })

  ipcMain.handle('vault:readDir', async (_event, dirPath: string) => {
    try {
      // Paths are reported as asked; a temp vault's `.quartz/…` is read from its real config dir.
      const entries = await readdir(redirectTempConfigPath(dirPath), { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: join(dirPath, entry.name)
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle('vault:readFile', async (_event, filePath: string) => {
    filePath = redirectTempConfigPath(filePath)
    try {
      return await readFile(filePath, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('vault:writeFile', async (_event, filePath: string, content: string) => {
    filePath = redirectTempConfigPath(filePath)
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
      await writeFile(filePath, content, 'utf-8')
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:createFile', async (_event, filePath: string, content: string = '') => {
    filePath = redirectTempConfigPath(filePath)
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
      await writeFile(filePath, content, 'utf-8')
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:createDir', async (_event, dirPath: string) => {
    dirPath = redirectTempConfigPath(dirPath)
    try {
      await mkdir(dirPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:deleteFile', async (_event, filePath: string) => {
    filePath = redirectTempConfigPath(filePath)
    try {
      await unlink(filePath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:deleteDir', async (_event, dirPath: string) => {
    dirPath = redirectTempConfigPath(dirPath)
    try {
      await rm(dirPath, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:renameFile', async (_event, oldPath: string, newPath: string) => {
    oldPath = redirectTempConfigPath(oldPath)
    newPath = redirectTempConfigPath(newPath)
    try {
      await rename(oldPath, newPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:stat', async (_event, filePath: string) => {
    filePath = redirectTempConfigPath(filePath)
    try {
      const s = await stat(filePath)
      return {
        size: s.size,
        mtime: s.mtime.toISOString(),
        ctime: s.ctime.toISOString(),
        isDirectory: s.isDirectory()
      }
    } catch {
      return null
    }
  })

  // Shell operations
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:openPath', async (_event, path: string) => {
    await shell.openPath(path)
  })

  ipcMain.handle('vault:moveToTrash', async (_event, filePath: string) => {
    filePath = redirectTempConfigPath(filePath)
    try {
      await shell.trashItem(filePath)
      return true
    } catch {
      return false
    }
  })

  // `trashOption` semantics: "system" → OS trash, falling back to the
  // vault's .trash folder if that fails; "local" → flat <vault>/.trash with
  // "name 2.ext" collision naming; "none" → permanent delete.
  ipcMain.handle('vault:trash', async (_event, filePath: string, vaultRoot: string, option: string) => {
    try {
      if (option === 'none') {
        await rm(filePath, { recursive: true, force: true })
        return true
      }
      if (option !== 'local') {
        try {
          await shell.trashItem(filePath)
          return true
        } catch {
          // fall through to local trash
        }
      }
      const trashDir = join(vaultRoot, '.trash')
      await mkdir(trashDir, { recursive: true })
      const ext = extname(filePath)
      const base = basename(filePath, ext)
      let target = join(trashDir, base + ext)
      for (let n = 2; existsSync(target); n++) target = join(trashDir, `${base} ${n}${ext}`)
      await rename(filePath, target)
      return true
    } catch {
      return false
    }
  })

  // Legacy registry channels → the main-process registry (quartz.json).
  // Writes from the renderer are no longer accepted; use vault-open/vault-remove/vault-move.
  ipcMain.handle('vaults:getRegistry', async () => ({ vaults: getRegistry().vaults }))

  ipcMain.handle('vaults:saveRegistry', async () => false)

  ipcMain.handle('window:getInitialVault', (event) => vaultPathOfSender(event.sender))
  ipcMain.handle('app:getOpenFilePath', () => null)
  ipcMain.handle('window:openVault', (_event, vaultPath: string) => openVaultPath(vaultPath))

  ipcMain.handle('vaults:createFolder', async (_event, folderPath: string) => {
    try {
      await mkdir(folderPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  // Vault file watcher (real-time change detection)
  ipcMain.handle('vault:watchStart', async (event, vaultPath: string) => {
    const sender = event.sender
    const sid = sender.id
    stopVaultWatcher(sid)
    if (!vaultPath || !existsSync(vaultPath)) return false
    try {
      const pendingChanges = new Map<string, ReturnType<typeof setTimeout>>()
      const vaultWatcher = watch(vaultPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        const rel = filename.toString()
        // Ignore dotfiles and .quartz config dir
        const parts = rel.split(sep)
        if (parts.some(p => p.startsWith('.'))) return

        const fullPath = join(vaultPath, rel)
        // Debounce per path (100ms)
        const existing = pendingChanges.get(fullPath)
        if (existing) clearTimeout(existing)
        pendingChanges.set(fullPath, setTimeout(() => {
          pendingChanges.delete(fullPath)
          const exists = existsSync(fullPath)
          let type: 'create' | 'modify' | 'delete'
          if (!exists) {
            type = 'delete'
          } else if (eventType === 'rename') {
            type = 'create'
          } else {
            type = 'modify'
          }
          if (!sender.isDestroyed()) sender.send('vault:change', { type, path: fullPath })
        }, 100))
      })
      watchers.set(sid, { watcher: vaultWatcher, pending: pendingChanges })
      sender.once('destroyed', () => stopVaultWatcher(sid))
      return true
    } catch (err) {
      console.error('vault:watchStart error:', err)
      return false
    }
  })

  ipcMain.handle('vault:watchStop', async (event) => {
    stopVaultWatcher(event.sender.id)
    return true
  })

  app.on('before-quit', () => stopVaultWatcher())
}
