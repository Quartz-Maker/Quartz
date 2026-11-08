import { ipcRenderer } from 'electron'
import { createRequire } from 'module'

// Plugins rely on `require('electron').remote`. Provide it
// from @electron/remote (main calls remote.enable() for every app window).
try {
  const req = createRequire(import.meta.url)
  const el = req('electron')
  if (el && !('remote' in el)) {
    let cached: unknown
    Object.defineProperty(el, 'remote', {
      configurable: true,
      enumerable: false,
      get: () => (cached ??= req('@electron/remote'))
    })
  }
} catch (e) {
  console.warn('[quartz] electron.remote unavailable', e)
}

// contextIsolation is off, so the preload shares the page's
// window; legacy quartzAPI stays available while the app migrates to direct Node access.
;(window as any).quartzAPI = {
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  },
  vault: {
    open: () => ipcRenderer.invoke('vault:open'),
    readDir: (path: string) => ipcRenderer.invoke('vault:readDir', path),
    readFile: (path: string) => ipcRenderer.invoke('vault:readFile', path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('vault:writeFile', path, content),
    createFile: (path: string, content: string) => ipcRenderer.invoke('vault:createFile', path, content),
    createDir: (path: string) => ipcRenderer.invoke('vault:createDir', path),
    deleteFile: (path: string) => ipcRenderer.invoke('vault:deleteFile', path),
    deleteDir: (path: string) => ipcRenderer.invoke('vault:deleteDir', path),
    renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('vault:renameFile', oldPath, newPath),
    stat: (path: string) => ipcRenderer.invoke('vault:stat', path),
    moveToTrash: (path: string) => ipcRenderer.invoke('vault:moveToTrash', path),
    trash: (path: string, vaultRoot: string, option: string) => ipcRenderer.invoke('vault:trash', path, vaultRoot, option),
    watchStart: (path: string) => ipcRenderer.invoke('vault:watchStart', path),
    watchStop: () => ipcRenderer.invoke('vault:watchStop'),
    onChange: (callback: (change: { type: string; path: string }) => void) => {
      const listener = (_e: unknown, change: { type: string; path: string }) => callback(change)
      ipcRenderer.on('vault:change', listener)
      return () => ipcRenderer.removeListener('vault:change', listener)
    },
  },
  vaults: {
    getRegistry: () => ipcRenderer.invoke('vaults:getRegistry'),
    saveRegistry: (data: string) => ipcRenderer.invoke('vaults:saveRegistry', data),
    createFolder: (path: string) => ipcRenderer.invoke('vaults:createFolder', path),
  },
  app: {
    getOpenFilePath: () => ipcRenderer.invoke('app:getOpenFilePath'),
  },
  window: {
    getInitialVault: () => ipcRenderer.invoke('window:getInitialVault'),
    openVault: (path: string) => ipcRenderer.invoke('window:openVault', path),
  }
}
