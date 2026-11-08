// The slice of `App` the workspace/view layer depends on. The real App (data-core area) satisfies
// this structurally; tests and the opt-in mount pass a small stub. Keep it minimal.
import type { EventRef } from '../core/Events'
import type { Workspace } from './Workspace'
import type { ViewRegistry } from '../view/ViewRegistry'

export interface VaultLike {
  configDir: string
  getName(): string
  getAbstractFileByPath(path: string): any
  getFileByPath?(path: string): any
  getConfig(key: string): any
  setConfig?(key: string, value: any): void
  isEmpty?(): boolean
  on(name: string, cb: (...args: any[]) => any, ctx?: any): EventRef
  adapter: {
    read(path: string): Promise<string>
    write(path: string, data: string): Promise<void>
    getBasePath?(): string
  }
  getRoot?(): { getFileCount?(): number; getFolderCount?(): number }
}

export interface AppLike {
  vault: VaultLike
  workspace: Workspace
  viewRegistry: ViewRegistry
  commands?: { executeCommandById(id: string, evt?: Event): boolean }
  hotkeyManager?: { printHotkeyForCommand(id: string): string }
  internalPlugins?: { getEnabledPluginById(id: string): any }
  metadataCache?: { getFirstLinkpathDest(path: string, sourcePath: string): any }
  fileManager?: { getNewFileParent(sourcePath: string, newFilePath?: string): any; createNewFile(parent: any, name: string): Promise<any> }
  setting?: { open(): void; close?(): void; win?: Window }
  keymap?: { pushScope(scope: any): void }
  scope?: any
  openWithDefaultApp?(path: string): void
  openHelp?(): void
  openVaultChooser?(): void
  getAppTitle?(leafTitle: string): string
  /** Notice hook until the UI-kit Notice exists. */
  showNotice?(message: string): void
}

export function notice(app: AppLike, message: string): void {
  if (app.showNotice) app.showNotice(message)
  else console.warn('[notice]', message)
}
