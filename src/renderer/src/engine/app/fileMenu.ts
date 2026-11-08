/* eslint-disable @typescript-eslint/no-explicit-any */
// App-level `file-menu` / `files-menu` handlers (every file context menu: explorer, tab header,
// "more options", search, bases ...): a "Copy path" submenu, "Move file/folder to...", system actions and "Open in new window".
import { Notice } from '../ui/Notice'
import { MoveFileModal } from '../views/file-explorer/MoveFileModal'

const isFolder = (f: any): boolean => !!f && Array.isArray(f.children)
const isRoot = (f: any): boolean => isFolder(f) && (f.isRoot?.() ?? f.path === '/')

export function registerCoreFileMenu(app: any): void {
  const ws = app.workspace
  ws.on('file-menu', (menu: any, file: any) => {
    menu.setSectionSubmenu('info.copy', { title: 'Copy path', icon: 'lucide-clipboard' })
    const isFile = !!file && !isFolder(file)
    if (isFile) {
      menu.addItem((i: any) => i.setSection('info.copy').setTitle('as Quartz URL').setIcon('lucide-link').onClick(() => app.copyObsidianUrl(file)))
      menu.addItem((i: any) => i.setSection('system').setTitle('Open in default app').setIcon('lucide-arrow-up-right').onClick(() => app.openWithDefaultApp?.(file.path)))
    }
    if (file && !isRoot(file)) {
      menu.addItem((i: any) =>
        i
          .setSection('action')
          .setTitle(isFile ? 'Move file to...' : 'Move folder to...')
          .setIcon('lucide-folder-tree')
          .onClick(() => new MoveFileModal(app, [file]).open())
      )
    }
    if (file && !isRoot(file)) {
      menu.addItem((i: any) =>
        i
          .setSection('info.copy')
          .setTitle('from vault folder')
          .setIcon('vault')
          .onClick(() => {
            void navigator.clipboard?.writeText(file.path)
            new Notice('Copied to your clipboard')
          })
      )
      const full = app.vault.adapter?.getFullPath?.(file.path)
      if (full) {
        menu.addItem((i: any) =>
          i
            .setSection('info.copy')
            .setTitle('from system root')
            .setIcon('lucide-hard-drive')
            .onClick(() => {
              void navigator.clipboard?.writeText(full)
              new Notice('Copied to your clipboard')
            })
        )
        menu.addItem((i: any) => i.setSection('system').setTitle('Show in system explorer').setIcon('lucide-arrow-up-right').onClick(() => app.showInFolder?.(file.path)))
      }
    }
    if (isFile) {
      menu.addItem((i: any) =>
        i
          .setSection('open')
          .setTitle('Open in new window')
          .setIcon('lucide-picture-in-picture-2')
          .onClick(async () => {
            await ws.openPopoutLeaf().openFile(file)
          })
      )
    }
  })
  ws.on('files-menu', (menu: any, files: any[]) => {
    menu.addItem((i: any) =>
      i
        .setSection('action')
        .setTitle(`Move ${files.length} items to...`)
        .setIcon('lucide-folder-tree')
        .onClick(() => new MoveFileModal(app, files).open())
    )
  })
}
