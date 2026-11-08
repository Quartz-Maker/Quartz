// Receivers for main-process calls into the page:
//   window.OBS_ACT(params)       — `quartz://` actions, open-file of a vault file, vault-message
//   window.OBS_OPEN_FILE(path)   — a file outside the vault opened from the OS ("Open with")
// Main assigns the payload to the global if no function is installed yet, so on install we
// first drain any queued value.
//
// `quartz://` actions go through `app.workspace.protocolHandler` (workspace/ProtocolHandler.ts), installed as
// window.OBS_ACT by `installUriReceivers(app)`; this file keeps the "Open with" receiver.
import { useWorkspaceStore } from '@/stores/workspace'

function handleOpenFile(p: string): void {
  if (typeof p === 'string' && p) useWorkspaceStore.getState().openFile(p)
}

export function installUriReceivers(app: any): void {
  const w = window as any
  app.workspace.protocolHandler.init()
  const queuedFile = w.OBS_OPEN_FILE
  w.OBS_OPEN_FILE = handleOpenFile
  if (queuedFile && typeof queuedFile !== 'function') handleOpenFile(queuedFile)
}
