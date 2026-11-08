/* eslint-disable @typescript-eslint/no-explicit-any */
// "file-properties" view (properties core plugin): the metadata editor for the active note.
//   .workspace-leaf-content[data-type=file-properties] > .view-header + .view-content
//   .view-content > .metadata-container + .pane-empty ("No properties found.")
// Leaf state {file}. Follows the active Markdown view; edits are written with vault.process.
import { ItemView } from '../../view/View'
import type { WorkspaceLeaf } from '../../workspace/WorkspaceLeaf'
import { MetadataEditor, replaceFrontmatter } from './MetadataEditor'
import { getFrontMatterInfo } from '../../metadata/linkUpdate'
import { parse as parseYaml } from 'yaml'

export const VIEW_TYPE_FILE_PROPERTIES = 'file-properties'

export function parseFrontmatterObject(text: string): Record<string, any> | null | undefined {
  const info = getFrontMatterInfo(text)
  if (!info.exists) return undefined
  try {
    const fm = parseYaml(info.frontmatter) ?? {}
    if (typeof fm !== 'object' || Array.isArray(fm)) return null
    return fm
  } catch {
    return null
  }
}

export class FilePropertiesView extends ItemView {
  icon = 'lucide-info'
  file: any = null
  metadataEditor: MetadataEditor
  emptyEl: HTMLElement
  private raw: string | null | undefined = undefined

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.metadataEditor = new MetadataEditor(this.app, {
      getFile: () => this.file,
      saveFrontmatter: fm => this.saveFrontmatter(fm),
      focusAfterMetadata: () => {
        const v: any = this.app.workspace.getActiveFileView?.()
        v?.editor?.focus?.()
      },
      focusBeforeMetadata: () => {},
      getHoverSource: () => 'properties'
    })
    this.addChild(this.metadataEditor)
    this.contentEl.appendChild(this.metadataEditor.containerEl)
    this.emptyEl = this.contentEl.createDiv({ cls: 'pane-empty', text: 'No properties found.' })
    this.emptyEl.hide()
  }

  getViewType(): string {
    return VIEW_TYPE_FILE_PROPERTIES
  }
  getDisplayText(): string {
    return 'File properties'
  }

  getState(): Record<string, unknown> {
    const s = super.getState()
    if (this.file) s.file = this.file.path
    return s
  }
  async setState(state: any, result: any): Promise<void> {
    if (typeof state?.file === 'string') {
      const f = (this.app.vault as any).getFileByPath(state.file)
      if (f) await this.setFile(f)
    }
    await super.setState(state, result)
  }

  onload(): void {
    super.onload()
    const ws: any = this.app.workspace
    const follow = () => {
      const v: any = ws.getActiveFileView?.() ?? ws.getActiveViewOfType?.('markdown')
      const f = v?.file
      if (f && f.extension === 'md' && f !== this.file && v.leaf !== this.leaf) void this.setFile(f)
    }
    this.registerEvent(ws.on('active-leaf-change', follow))
    this.registerEvent(ws.on('file-open', follow))
    this.registerEvent(ws.on('quick-preview', (f: any, text: string) => f === this.file && this.update(text)))
    this.registerEvent(this.app.vault.on('modify', async (f: any) => f === this.file && this.update(await (this.app.vault as any).cachedRead(f))))
    this.registerEvent(this.app.vault.on('delete', (f: any) => f === this.file && void this.setFile(null)))
    this.registerEvent(this.app.vault.on('rename', () => this.leaf.updateHeader?.()))
    this.update('')
    follow()
  }

  async setFile(file: any): Promise<void> {
    this.file = file
    this.raw = undefined
    this.metadataEditor.clear()
    this.update(file ? await (this.app.vault as any).cachedRead(file) : '')
    this.leaf.updateHeader?.()
    this.app.workspace.requestSaveLayout?.()
  }

  private update(text: string): void {
    if (!this.file) {
      this.metadataEditor.synchronize({})
      this.metadataEditor.containerEl.hide()
      this.emptyEl.show()
      return
    }
    const info = getFrontMatterInfo(text)
    const raw = info.exists ? info.frontmatter : null
    if (raw !== this.raw) {
      this.raw = raw
      const fm = parseFrontmatterObject(text)
      this.metadataEditor.synchronize(fm === undefined ? {} : fm)
    }
    // Reference updateEmptyState: the empty message is only for unsupported/no files; a note without properties
    // shows the editor with its "Add property" button (invalid frontmatter uses the editor's own error box).
    const supported = this.file.extension === 'md'
    this.metadataEditor.containerEl.toggle(supported)
    this.emptyEl.toggle(!supported)
  }

  saveFrontmatter(fm: Record<string, any>): void {
    const f = this.file
    if (!f || f.extension !== 'md') return
    void (this.app.vault as any).process(f, (t: string) => replaceFrontmatter(t, fm))
  }
}
