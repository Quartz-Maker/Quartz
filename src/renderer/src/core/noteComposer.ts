import { trashPath } from '@/core/trash'
import { activeEditorView } from './editorRef'
import { useWorkspaceStore } from '@/stores/workspace'
import { useVaultStore } from '@/stores/vault'

/**
 * Extract the current editor selection into a new note.
 * Replaces selection with a wikilink to the new note.
 */
export async function extractSelectionToNote(): Promise<void> {
  const view = activeEditorView
  if (!view) return

  const { from, to } = view.state.selection.main
  if (from === to) return // No selection

  const selectedText = view.state.doc.sliceString(from, to)
  const vaultPath = (window as any).__quartzVaultPath
  if (!vaultPath) return

  // Generate file name from first line of selection
  const firstLine = selectedText.split('\n')[0].replace(/^#+\s*/, '').trim()
  const fileName = (firstLine || 'Extracted Note').replace(/[\\/:*?"<>|]/g, '').substring(0, 60)
  
  // Find unique file name
  let filePath = `${vaultPath}/${fileName}.md`
  let counter = 1
  while (await window.quartzAPI.vault.stat(filePath)) {
    filePath = `${vaultPath}/${fileName} ${counter}.md`
    counter++
  }

  // Create new file with selection content
  const success = await window.quartzAPI.vault.createFile(filePath, selectedText)
  if (!success) return

  // Replace selection with wikilink
  const finalName = filePath.split('/').pop()!.replace(/\.md$/, '')
  view.dispatch({
    changes: { from, to, insert: `[[${finalName}]]` }
  })

  // Refresh file explorer
  const vaultStore = useVaultStore.getState()
  vaultStore.loadFiles(vaultPath).then(f => vaultStore.setFiles(f))
}

/**
 * Merge the current note with another note.
 * Appends the other note's content to the current note and deletes the other.
 */
export async function mergeNoteInto(sourceFilePath: string): Promise<void> {
  const { tabs, activeTabId } = useWorkspaceStore.getState()
  const activeTab = tabs.find(t => t.id === activeTabId)
  if (!activeTab) return

  const sourceContent = await window.quartzAPI.vault.readFile(sourceFilePath)
  if (sourceContent === null) return

  const view = activeEditorView
  if (!view) return

  // Append source content at the end
  const doc = view.state.doc
  const endPos = doc.length
  view.dispatch({
    changes: { from: endPos, to: endPos, insert: '\n\n' + sourceContent }
  })

  // Delete source file
  await trashPath(sourceFilePath)

  // Refresh file explorer
  const vaultPath = (window as any).__quartzVaultPath
  if (vaultPath) {
    const vaultStore = useVaultStore.getState()
    vaultStore.loadFiles(vaultPath).then(f => vaultStore.setFiles(f))
  }
}
