/**
 * Workspace persistence — saves and restores the full workspace layout.
 * Stored in <vault>/.quartz/workspace.json
 */

export interface PersistedTab {
  filePath: string
  fileName: string
  isPinned: boolean
}

export interface PersistedWorkspace {
  main: {
    tabs: PersistedTab[]
    activeTabIndex: number
    splitDirection: string
    splitFilePath: string | null
  }
  left: {
    collapsed: boolean
    width: number
    currentTab: number
  }
  right: {
    collapsed: boolean
    width: number
    currentTab: number
  }
  lastOpenFiles: string[]
}

const DEFAULT_WORKSPACE: PersistedWorkspace = {
  main: {
    tabs: [],
    activeTabIndex: -1,
    splitDirection: 'none',
    splitFilePath: null
  },
  left: {
    collapsed: false,
    width: 260,
    currentTab: 0
  },
  right: {
    collapsed: false,
    width: 260,
    currentTab: 0
  },
  lastOpenFiles: []
}

export async function saveWorkspace(vaultPath: string, workspace: PersistedWorkspace): Promise<void> {
  const dir = `${vaultPath}/.quartz`
  const path = `${dir}/workspace.json`
  await window.quartzAPI.vault.createDir(dir)
  await window.quartzAPI.vault.writeFile(path, JSON.stringify(workspace, null, 2))
}

export async function loadWorkspace(vaultPath: string): Promise<PersistedWorkspace> {
  const path = `${vaultPath}/.quartz/workspace.json`
  const content = await window.quartzAPI.vault.readFile(path)
  if (!content) return { ...DEFAULT_WORKSPACE }
  try {
    const parsed = JSON.parse(content)
    return { ...DEFAULT_WORKSPACE, ...parsed }
  } catch {
    return { ...DEFAULT_WORKSPACE }
  }
}
