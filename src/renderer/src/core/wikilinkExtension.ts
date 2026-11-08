import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { useMetadataStore } from '@/stores/metadata'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * CodeMirror extension that:
 * 1. Highlights [[wikilinks]] and [text](path) with accent color
 * 2. Marks unresolved links with a different style
 * 3. Handles click to navigate to linked note
 */

const resolvedLinkMark = Decoration.mark({ class: 'cm-wikilink cm-wikilink-resolved' })
const unresolvedLinkMark = Decoration.mark({ class: 'cm-wikilink cm-wikilink-unresolved' })

// Current file path of the active tab — used as the resolution context for links.
function currentFile(): string {
  const ws = useWorkspaceStore.getState()
  return ws.tabs.find(t => t.id === ws.activeTabId)?.filePath || ''
}

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const text = doc.toString()
  const metadata = useMetadataStore.getState()
  const from0 = currentFile()
  const ranges: { from: number; to: number; mark: Decoration }[] = []

  // Wikilinks
  const wikiRegex = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = wikiRegex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    const target = match[1].split('|')[0].split('#')[0].trim()
    const resolved = metadata.resolveLink(target, from0)
    ranges.push({ from, to, mark: resolved ? resolvedLinkMark : unresolvedLinkMark })
  }

  // Markdown links [text](path) — only internal ones
  const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  while ((match = mdRegex.exec(text)) !== null) {
    const href = match[2]
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) continue
    const from = match.index
    const to = from + match[0].length
    const target = decodeURIComponent(href).replace(/\.md$/, '').replace(/^\.\//, '')
    const resolved = metadata.resolveLink(target, from0)
    ranges.push({ from, to, mark: resolved ? resolvedLinkMark : unresolvedLinkMark })
  }

  // RangeSetBuilder requires sorted, non-overlapping ranges; the two passes above
  // are not globally ordered, so sort and drop any overlaps before building.
  ranges.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  let lastEnd = -1
  for (const r of ranges) {
    if (r.from < lastEnd) continue
    builder.add(r.from, r.to, r.mark)
    lastEnd = r.to
  }
  return builder.finish()
}

export const wikilinkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: v => v.decorations }
)

/**
 * Click handler for links.
 * Click on a link position → navigate (or Ctrl+Click for new tab)
 */
// In editor modes (Source/Live Preview), a plain click edits (places the cursor);
// navigation requires Ctrl/Cmd+click, which opens the link in a new tab.
export const wikilinkClickHandler = EditorView.domEventHandlers({
  click(event: MouseEvent, view: EditorView) {
    const isCtrl = event.ctrlKey || event.metaKey
    if (!isCtrl) return false // plain click edits

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false

    const doc = view.state.doc
    const text = doc.toString()

    // Check wikilinks [[target]]
    const wikiRegex = /\[\[([^\]]+)\]\]/g
    let match: RegExpExecArray | null
    while ((match = wikiRegex.exec(text)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        const inner = match[1]
        const target = inner.split('|')[0].split('#')[0].trim()
        navigateToLink(target, true)
        event.preventDefault()
        return true
      }
    }

    // Check markdown links [text](path)
    const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g
    while ((match = mdRegex.exec(text)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        const href = match[2]
        if (href.startsWith('http://') || href.startsWith('https://')) {
          window.quartzAPI.shell.openExternal(href)
        } else {
          const target = decodeURIComponent(href).replace(/\.md$/, '').replace(/^\.\//, '')
          navigateToLink(target, true)
        }
        event.preventDefault()
        return true
      }
    }

    return false
  }
})

export function navigateToLink(target: string, newTab: boolean = false): void {
  const metadata = useMetadataStore.getState()
  const resolved = metadata.resolveLink(target, currentFile())

  if (resolved) {
    if (newTab) {
      useWorkspaceStore.getState().openFileInNewTab(resolved)
    } else {
      useWorkspaceStore.getState().openFile(resolved)
    }
  } else {
    const vaultPath = (window as any).__quartzVaultPath
    if (vaultPath) {
      const newPath = `${vaultPath}/${target}.md`
      window.quartzAPI.vault.createFile(newPath, '').then(success => {
        if (success) {
          if (newTab) {
            useWorkspaceStore.getState().openFileInNewTab(newPath)
          } else {
            useWorkspaceStore.getState().openFile(newPath)
          }
          useMetadataStore.getState().indexFile(newPath, '')
        }
      })
    }
  }
}

/**
 * CSS styles for wikilink decorations
 */
export const wikilinkTheme = EditorView.baseTheme({
  '.cm-wikilink': {
    borderRadius: '2px',
    padding: '0 1px',
    cursor: 'pointer'
  },
  '.cm-wikilink-resolved': {
    color: 'var(--text-accent)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--text-accent)',
    textUnderlineOffset: '2px'
  },
  '.cm-wikilink-unresolved': {
    color: '#f38ba8',
    opacity: '0.8',
    textDecoration: 'underline',
    textDecorationStyle: 'dashed'
  }
})
