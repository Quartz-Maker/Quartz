// React-facing façade over `app.workspace` (the imperative workspace is the source of
// truth). Bridged React panels read `tabs` / `activeTabId` (absolute paths, legacy shape) and call
// openFile & co., which delegate to the leaf tree. The projection is refreshed on workspace events.
import { createStore as create } from 'zustand/vanilla'
import { getApp } from '@/engine/App'

export interface Tab {
  /** = leaf id */
  id: string
  /** Absolute path (legacy shape); '__graph__' for the graph view. */
  filePath: string
  fileName: string
  content: string
  isDirty: boolean
  isPinned: boolean
  history: string[]
  historyIndex: number
}

export type SplitDirection = 'none' | 'vertical' | 'horizontal'

interface WorkspaceState {
  tabs: Tab[]
  activeTabId: string | null
  closedTabs: Tab[]
  splitDirection: SplitDirection
  splitFilePath: string | null

  openFile: (filePath: string) => Promise<void>
  openFileInNewTab: (filePath: string) => Promise<void>
  openGraphTab: () => void
  closeTab: (tabId: string) => void
  restoreClosedTab: () => void
  setActiveTab: (tabId: string) => void
  updateContent: (tabId: string, content: string) => void
  saveTab: (tabId: string) => Promise<void>
  saveActiveTab: () => Promise<void>
  closeActiveTab: () => void
  createNewFile: (vaultPath: string) => Promise<void>
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  togglePinActiveTab: () => void
  splitRight: () => void
  splitDown: () => void
  closeSplit: () => void
  navigateBack: () => void
  navigateForward: () => void
  canNavigateBack: () => boolean
  canNavigateForward: () => boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const ws = (): any => (getApp() as any)?.workspace ?? null
const base = (): string => (getApp() as any)?.vault.adapter.getBasePath() ?? ''
const toRel = (p: string): string => {
  const b = base()
  return b && p.startsWith(b + '/') ? p.slice(b.length + 1) : p
}
const toAbs = (p: string): string => (base() ? base() + '/' + p : p)
const leafById = (id: string): any => ws()?.getLeafById(id) ?? null
const activeRootLeaf = (): any => {
  const w = ws()
  return w && w.rootSplit ? w.getMostRecentLeaf(w.rootSplit) : null
}

function fileFor(path: string): any {
  const app: any = getApp()
  if (!app) return null
  return app.vault.getFileByPath(toRel(path))
}

async function openIn(newLeaf: boolean | 'tab', filePath: string): Promise<void> {
  const w = ws()
  if (!w) return
  if (filePath === '__graph__') {
    await w.getLeaf(newLeaf).setViewState({ type: 'graph', active: true })
    return
  }
  const f = fileFor(filePath)
  if (!f) return
  await w.getLeaf(newLeaf).openFile(f, { active: true })
}

function project(): Pick<WorkspaceState, 'tabs' | 'activeTabId' | 'splitDirection'> {
  const w = ws()
  if (!w || !w.rootSplit) return { tabs: [], activeTabId: null, splitDirection: 'none' }
  const tabs: Tab[] = []
  w.iterateRootLeaves((leaf: any) => {
    const v = leaf.view
    const type = v?.getViewType?.()
    if (type === 'graph') {
      tabs.push({ id: leaf.id, filePath: '__graph__', fileName: 'Graph view', content: '', isDirty: false, isPinned: !!leaf.pinned, history: [], historyIndex: 0 })
      return
    }
    const f = v?.file
    if (!f) return
    const content = typeof v.getViewData === 'function' ? v.getViewData() : ''
    tabs.push({ id: leaf.id, filePath: toAbs(f.path), fileName: f.name, content, isDirty: !!v.dirty, isPinned: !!leaf.pinned, history: [], historyIndex: 0 })
  })
  const active = activeRootLeaf()
  const groups = w.rootSplit.children.length
  return { tabs, activeTabId: active ? active.id : null, splitDirection: groups > 1 ? 'vertical' : 'none' }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabs: [],
  splitDirection: 'none',
  splitFilePath: null,

  openFile: filePath => openIn(false, filePath),
  openFileInNewTab: filePath => openIn('tab', filePath),
  openGraphTab: () => void openIn(false, '__graph__'),
  closeTab: id => leafById(id)?.detach(),
  restoreClosedTab: () => ws()?.undoCloseLeaf(),
  setActiveTab: id => {
    const l = leafById(id)
    if (l) ws().setActiveLeaf(l, { focus: true })
  },
  updateContent: (id, content) => {
    const v = leafById(id)?.view
    if (v && typeof v.applyEdit === 'function') v.applyEdit(content)
    else if (v && typeof v.setViewData === 'function' && v.getViewData() !== content) {
      v.setViewData(content, false)
      v.requestSave?.()
    }
  },
  saveTab: async id => {
    await leafById(id)?.view?.save?.()
  },
  saveActiveTab: async () => {
    const id = get().activeTabId
    if (id) await get().saveTab(id)
  },
  closeActiveTab: () => activeRootLeaf()?.detach(),
  createNewFile: async () => {
    ;(getApp() as any)?.commands.executeCommandById('file-explorer:new-file')
  },
  pinTab: id => leafById(id)?.setPinned(true),
  unpinTab: id => leafById(id)?.setPinned(false),
  togglePinActiveTab: () => activeRootLeaf()?.togglePinned(),
  splitRight: () => {
    const l = activeRootLeaf()
    if (l) void ws().duplicateLeaf(l, 'vertical')
  },
  splitDown: () => {
    const l = activeRootLeaf()
    if (l) void ws().duplicateLeaf(l, 'horizontal')
  },
  closeSplit: () => {},
  navigateBack: () => void activeRootLeaf()?.history.back(),
  navigateForward: () => void activeRootLeaf()?.history.forward(),
  canNavigateBack: () => (activeRootLeaf()?.history.backHistory.length ?? 0) > 0,
  canNavigateForward: () => (activeRootLeaf()?.history.forwardHistory.length ?? 0) > 0
}))

let syncTimer: ReturnType<typeof setTimeout> | null = null
/** Re-project the leaf tree into the store (coalesced). */
export function syncWorkspaceStore(immediate = false): void {
  if (immediate) {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = null
    useWorkspaceStore.setState(project())
    return
  }
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    useWorkspaceStore.setState(project())
  }, 50)
}

/** Subscribe the façade to a workspace (called once at boot). */
export function bindWorkspaceStore(workspace: any): void {
  for (const ev of ['layout-change', 'active-leaf-change', 'file-open', 'editor-change', 'quartz:mode-change']) workspace.on(ev, () => syncWorkspaceStore())
  syncWorkspaceStore(true)
}
