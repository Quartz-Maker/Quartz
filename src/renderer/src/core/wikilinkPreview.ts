import { EditorView, hoverTooltip, Tooltip } from '@codemirror/view'
import { useMetadataStore, updateContentCache } from '@/stores/metadata'

/**
 * Shows a preview tooltip when hovering over [[wikilinks]]
 */
export const wikilinkHoverPreview = hoverTooltip(async (view, pos) => {
  const doc = view.state.doc
  const text = doc.toString()
  const regex = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length

    if (pos >= from && pos <= to) {
      const inner = match[1]
      const target = inner.split('|')[0].split('#')[0].trim()
      const metadata = useMetadataStore.getState()
      const resolved = metadata.resolveLink(target, '')

      if (!resolved) return null

      // Read the target file content for preview
      const content = await window.quartzAPI.vault.readFile(resolved)
      if (!content) return null

      const preview = content.substring(0, 300).trim()
      const fileName = resolved.split('/').pop() || resolved

      return {
        pos: from,
        end: to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'cm-hover-preview'
          dom.innerHTML = `
            <div class="cm-hover-preview-title">${escapeHtml(fileName)}</div>
            <div class="cm-hover-preview-content">${escapeHtml(preview)}${content.length > 300 ? '...' : ''}</div>
          `
          return { dom }
        }
      } as Tooltip
    }
  }

  return null
}, { hideOnChange: true, hoverTime: 400 })

export const hoverPreviewTheme = EditorView.baseTheme({
  '.cm-hover-preview': {
    padding: '12px',
    maxWidth: '400px',
    maxHeight: '200px',
    overflow: 'hidden',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    fontSize: '13px',
    lineHeight: '1.5'
  },
  '.cm-hover-preview-title': {
    fontWeight: '600',
    marginBottom: '6px',
    color: 'var(--text-accent)',
    fontSize: '14px'
  },
  '.cm-hover-preview-content': {
    color: 'var(--text-muted)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  '.cm-tooltip': {
    border: 'none !important',
    background: 'transparent !important'
  }
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
