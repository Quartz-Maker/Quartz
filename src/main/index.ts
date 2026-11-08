import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { setupIPC } from './ipc'
import { preReady, onReady } from './core'

// Disable sandbox on Linux if not properly configured
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

function getIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(process.cwd(), 'icon.png')
}

// The `version` IPC reports the app package version, not the Electron/installer one.
function getVersion(): string {
  for (const p of [join(app.getAppPath(), 'package.json'), join(__dirname, '../../package.json')]) {
    try {
      const v = JSON.parse(readFileSync(p, 'utf8'))
      if (v && v.name === 'quartz' && v.version) return v.version
    } catch {
      /* try next */
    }
  }
  return app.getVersion()
}

const ok = preReady({
  version: getVersion(),
  appRoot: join(__dirname, '../renderer'),
  devServerUrl: process.env.ELECTRON_RENDERER_URL || undefined,
  preloadPath: join(__dirname, '../preload/index.mjs'),
  iconPath: getIconPath()
})

if (ok) {
  app.whenReady().then(() => {
    setupIPC()
    onReady()
  })
}
