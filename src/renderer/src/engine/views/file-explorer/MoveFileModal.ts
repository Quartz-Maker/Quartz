/* eslint-disable @typescript-eslint/no-explicit-any */
// "Move file to..." (`file-explorer:move-file` and the explorer menu): a folder suggester modal.
// Enter moves into the highlighted folder, Shift+Enter creates the typed folder, Tab completes
// the highlighted folder path. Moves run through `fileManager.runAsyncLinkUpdate`, so links are
// updated exactly like an explorer rename (alwaysUpdateLinks / confirmation modal).
import { FuzzySuggestModal } from '../../ui/suggest'
import { TFile, TFolder, TAbstractFile } from '../../vault/TAbstractFile'

const S = {
  noFolders: 'No existing folders found.',
  type: 'Type a folder',
  navigate: 'to navigate',
  move: 'to move',
  create: 'to create',
  dismiss: 'to dismiss',
  enterToCreate: 'Enter to create'
}

const movable = (f: TAbstractFile): boolean => !(f instanceof TFolder && f.isRoot())
/** Can `f` be moved into folder `dest`? */
export function canMoveInto(f: TAbstractFile, dest: TFolder): boolean {
  return movable(f) && f !== dest && !(f instanceof TFolder && dest.path.startsWith(f.path + '/'))
}
/** Drop items nested inside another selected folder. */
function topLevel(items: TAbstractFile[]): TAbstractFile[] {
  return items.filter(r => !items.some(l => l !== r && l instanceof TFolder && r.path.startsWith(l.path)))
}
export function filesToMove(items: TAbstractFile[], dest: TFolder): TAbstractFile[] {
  return topLevel(items.filter(f => canMoveInto(f, dest)))
}

/** Move `items` into `dest`, de-duplicating names, as one link-updating operation. */
export async function moveFilesToFolder(app: any, items: TAbstractFile[], dest: TFolder): Promise<void> {
  await app.fileManager.runAsyncLinkUpdate(async () => {
    const vault = app.vault
    for (const f of items) {
      if (f.parent === dest) continue
      let name = f.name
      if (dest.path !== '/') name = dest.path + '/' + name
      if (f instanceof TFile) {
        const i = name.lastIndexOf('.')
        const base = i === -1 || i === name.length - 1 || i === 0 ? name : name.slice(0, i)
        name = vault.getAvailablePath(base, f.extension)
      } else name = vault.getAvailablePath(name, '')
      await vault.rename(f, name)
    }
  })
}

/** Path up to (and including) the next "/" after the last matched character. */
function completeSegment(path: string, matches: [number, number][] | null | undefined): string {
  if (matches && matches.length > 0) {
    const end = matches[matches.length - 1][1]
    const i = path.indexOf('/', end)
    if (i !== -1) return path.slice(0, i + 1)
  }
  return path
}

export class MoveFileModal extends FuzzySuggestModal<TFolder | null> {
  files: TAbstractFile[]
  emptyMatch: any = Object.freeze({ match: { score: 0, matches: [] }, item: null })
  constructor(app: any, files: TAbstractFile[]) {
    super(app)
    this.limit = 20
    this.emptyStateText = S.noFolders
    this.files = files
    this.setInstructions([
      { command: '↑↓', purpose: S.navigate },
      { command: '↵', purpose: S.move },
      { command: 'shift ↵', purpose: S.create },
      { command: 'esc', purpose: S.dismiss }
    ])
    this.inputEl.setAttribute('placeholder', S.type)
    this.scope.register(['Shift'], 'Enter', (e: KeyboardEvent) => {
      this.selectSuggestion(this.emptyMatch, e)
      return false
    })
    this.scope.register([], 'Tab', (e: KeyboardEvent) => {
      if (e.isComposing) return
      const { values, selectedItem } = this.chooser as any
      const cur = this.inputEl.value
      const s = values[selectedItem]
      if (s) {
        let l = completeSegment(s.item.path, s.match?.matches)
        if (l === '/') return
        if (l === cur) l += '/'
        this.inputEl.value = l
        this.inputEl.dispatchEvent(new Event('input'))
      }
      return false
    })
  }

  onNoSuggestion(): void {
    this.chooser.setSuggestions([this.emptyMatch])
    this.chooser.addMessage(this.emptyStateText)
  }

  renderSuggestion(m: any, el: HTMLElement): void {
    if (!m.item) {
      el.addClass('mod-complex')
      const content = el.createDiv('suggestion-content')
      const aux = el.createDiv('suggestion-aux')
      content.createDiv({ cls: 'suggestion-title', text: this.inputEl.value })
      aux.createSpan({ cls: 'suggestion-hotkey', text: S.enterToCreate })
      return
    }
    super.renderSuggestion(m, el)
  }

  getItems(): (TFolder | null)[] {
    const tops = topLevel(this.files)
    const folders = tops.filter(f => f instanceof TFolder)
    return this.app.vault.getAllFolders(true).filter((dest: TFolder) => !(folders.length > 0 && folders.some(f => !canMoveInto(f, dest))))
  }

  getItemText(f: TFolder | null): string {
    return f!.isRoot() ? '/' : f!.path
  }

  async onChooseItem(dest: TFolder | null): Promise<void> {
    const app = this.app as any
    if (!this.files || this.files.length === 0) return
    if (!dest) dest = await app.fileManager.getOrCreateFolder(this.inputEl.value)
    const items = filesToMove(this.files, dest!)
    if (items.length > 0) await moveFilesToFolder(app, items, dest!)
  }
}
