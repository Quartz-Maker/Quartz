// Opt-in entry point: builds the app shell DOM
//   .app-container > .horizontal-main-container > .workspace
// inside `parent`, creates `app.workspace` (+ `app.viewRegistry` if missing) and loads the layout.
// Not wired into App.tsx yet — the shell switch-over happens after merging with the data core.
import { installEnhancements } from '../core/enhance'
import { Workspace, type WorkspaceOptions } from './Workspace'
import { ViewRegistry } from '../view/ViewRegistry'
import type { AppLike } from './AppLike'

export interface MountedWorkspace {
  appContainerEl: HTMLElement
  horizontalMainContainerEl: HTMLElement
  workspace: Workspace
  /** Tears the DOM down (does not save). */
  unmount(): void
}

export async function mountWorkspace(
  parent: HTMLElement,
  app: Omit<AppLike, 'workspace' | 'viewRegistry'> & Partial<Pick<AppLike, 'viewRegistry'>>,
  options: WorkspaceOptions & { loadLayout?: boolean } = {}
): Promise<MountedWorkspace> {
  installEnhancements(window as any)
  const a = app as AppLike
  if (!a.viewRegistry) a.viewRegistry = new ViewRegistry()
  const appContainerEl = parent.createDiv('app-container')
  const horizontalMainContainerEl = appContainerEl.createDiv('horizontal-main-container')
  const wsEl = horizontalMainContainerEl.createDiv('workspace')
  const workspace = new Workspace(a, wsEl, options)
  a.workspace = workspace
  if (options.loadLayout !== false) await workspace.loadLayout()
  return {
    appContainerEl,
    horizontalMainContainerEl,
    workspace,
    unmount() {
      workspace.requestSaveLayout.cancel()
      appContainerEl.detach()
    }
  }
}
