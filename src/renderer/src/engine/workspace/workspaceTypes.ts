// Workspace types and layout constants — split out of Workspace.ts (re-exported there).
import type { HistoryEntry } from './WorkspaceLeaf'

export type PaneType = 'tab' | 'split' | 'window'

export const WORKSPACE_FILE = 'workspace.json'
export const WORKSPACE_MOBILE_FILE = 'workspace-mobile.json'
/** Layout saves are debounced by 1 s. */
export const SAVE_LAYOUT_DELAY = 1000
export const UNDO_HISTORY_MAX = 10

export interface UndoEntry {
  leafId: string
  state: any
  eState: any
  parentId?: string
  rootId?: string
  leafHistory: { backHistory: HistoryEntry[]; forwardHistory: HistoryEntry[] }
}

export interface WorkspaceOptions {
  /** Window frame style ("hidden" | "custom" | "native"); affects the mod-top-*-space classes. */
  titlebarStyle?: 'hidden' | 'custom' | 'native'
  isMacOS?: boolean
  /** Popouts are not implemented yet (model only). */
  canPopoutWindow?: boolean
}
