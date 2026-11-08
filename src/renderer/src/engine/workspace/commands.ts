// Workspace commands (ids, names, icons, default hotkeys). The command
// area registers these with `app.commands.addCommand`; behaviour lives here with the model.
import { WorkspaceTabs } from './WorkspaceTabs'
import { ItemView } from '../view/View'
import { EmptyView } from '../view/EmptyView'
import type { Workspace } from './Workspace'

export interface Hotkey {
  modifiers: string[]
  key: string
}

export interface WorkspaceCommand {
  id: string
  name: string
  icon?: string
  hotkeys?: Hotkey[]
  checkCallback: (checking: boolean) => boolean | void
}

const hk = (modifiers: string[], key: string): Hotkey => ({ modifiers, key })

export function workspaceCommands(ws: Workspace, opts: { isMacOS?: boolean } = {}): WorkspaceCommand[] {
  const mac = !!opts.isMacOS
  const activeTabs = () => {
    const l = ws.activeLeaf
    return l && l.parent instanceof WorkspaceTabs ? l.parent : null
  }
  const cmds: WorkspaceCommand[] = [
    {
      id: 'workspace:toggle-pin',
      name: 'Toggle pin',
      icon: 'lucide-pin',
      checkCallback: c => {
        const l = ws.activeLeaf
        if (!l || !(l.view instanceof ItemView) || l.view instanceof EmptyView) return false
        if (!c) l.togglePinned()
        return true
      }
    },
    {
      id: 'workspace:split-vertical',
      name: 'Split right',
      icon: 'lucide-separator-vertical',
      checkCallback: c => {
        const l = ws.activeLeaf
        if (!l || !(l.view instanceof ItemView) || ws.isInSidebar(l)) return false
        if (!c) void ws.duplicateLeaf(l, 'vertical')
        return true
      }
    },
    {
      id: 'workspace:split-horizontal',
      name: 'Split down',
      icon: 'lucide-separator-horizontal',
      checkCallback: c => {
        const l = ws.activeLeaf
        if (!l || !(l.view instanceof ItemView)) return false
        if (!c) void ws.duplicateLeaf(l, 'horizontal')
        return true
      }
    },
    {
      id: 'workspace:toggle-stacked-tabs',
      name: 'Toggle stacked tabs',
      icon: 'lucide-layers',
      checkCallback: c => {
        const p = ws.activeLeaf?.parent
        if (!(p instanceof WorkspaceTabs)) return false
        const r = p.getRoot()
        if (r === ws.leftSplit || r === ws.rightSplit) return false
        if (!c) p.setStacked(!p.isStacked)
        return true
      }
    },
    {
      id: 'workspace:undo-close-pane',
      name: 'Undo close tab',
      icon: 'lucide-undo-2',
      hotkeys: [hk(['Mod', 'Shift'], 'T')],
      checkCallback: c => {
        if (ws.undoHistory.length === 0) return false
        if (!c) ws.undoCloseLeaf()
        return true
      }
    },
    {
      id: 'workspace:next-tab',
      name: 'Go to next tab',
      icon: 'lucide-arrow-right',
      hotkeys: [hk(['Ctrl'], 'Tab'), mac ? hk(['Meta', 'Shift'], ']') : hk(['Ctrl'], 'PageDown')],
      checkCallback: c => {
        const p = activeTabs()
        if (!p) return false
        if (!c) {
          let i = p.currentTab + 1
          if (i >= p.children.length) i = 0
          p.selectTabIndex(i)
          ws.setActiveLeaf(p.children[i], { focus: true })
        }
        return true
      }
    }
  ]
  for (let n = 1; n <= 8; n++) {
    cmds.push({
      id: `workspace:goto-tab-${n}`,
      name: `Go to tab #${n}`,
      hotkeys: [hk(['Mod'], String(n))],
      checkCallback: c => {
        const p = activeTabs()
        const l = p?.children[n - 1]
        if (!l) return false
        if (!c) ws.setActiveLeaf(l, { focus: true })
        return true
      }
    })
  }
  cmds.push(
    {
      id: 'workspace:goto-last-tab',
      name: 'Go to last tab',
      hotkeys: [hk(['Mod'], '9')],
      checkCallback: c => {
        const p = activeTabs()
        const l = p?.children[p.children.length - 1]
        if (!l) return false
        if (!c) ws.setActiveLeaf(l, { focus: true })
        return true
      }
    },
    {
      id: 'workspace:previous-tab',
      name: 'Go to previous tab',
      icon: 'lucide-arrow-left',
      hotkeys: [hk(['Ctrl', 'Shift'], 'Tab'), mac ? hk(['Meta', 'Shift'], '[') : hk(['Ctrl'], 'PageUp')],
      checkCallback: c => {
        const p = activeTabs()
        if (!p) return false
        if (!c) {
          let i = p.currentTab - 1
          if (i < 0) i = p.children.length - 1
          p.selectTabIndex(i)
          ws.setActiveLeaf(p.children[i], { focus: true })
        }
        return true
      }
    },
    {
      id: 'workspace:new-tab',
      name: 'New tab',
      hotkeys: [hk(['Mod'], 'T')],
      checkCallback: c => {
        const l = ws.getMostRecentLeaf()
        if (!l || !(l.parent instanceof WorkspaceTabs)) return false
        if (!c) ws.newTabIn(l.parent)
        return true
      }
    },
    {
      id: 'workspace:close',
      name: 'Close current tab',
      icon: 'lucide-x',
      hotkeys: [hk(['Mod'], 'W')],
      checkCallback: c => {
        let l = ws.activeLeaf
        // A sidebar leaf that is not an ItemView defers to the main area.
        if (l && ws.isInSidebar(l) && !(l.view instanceof ItemView)) l = ws.getMostRecentLeaf(ws.rootSplit)
        if (!l) return false
        if (!c) {
          // Mod+W on a pinned tab unpins it first.
          if (l.pinned) l.setPinned(false)
          else l.detach()
        }
        return true
      }
    },
    {
      id: 'workspace:close-others',
      name: 'Close all other tabs',
      icon: 'lucide-x',
      checkCallback: c => {
        const a = ws.activeLeaf
        if (!a) return false
        const list: any[] = []
        ws.iterateLeaves(a.getContainer(), l => {
          if (l !== a && !l.pinned) list.push(l)
        })
        if (!c) list.forEach(l => l.detach())
        return list.length > 0
      }
    },
    {
      id: 'workspace:close-tab-group',
      name: 'Close this tab group',
      icon: 'lucide-x',
      checkCallback: c => {
        const a = ws.activeLeaf
        if (!a || ws.isInSidebar(a)) return false
        if (!c) for (const l of (a.parent as WorkspaceTabs).children.slice()) if (!l.pinned) l.detach()
        return true
      }
    },
    {
      id: 'workspace:close-others-tab-group',
      name: 'Close others in tab group',
      icon: 'lucide-x',
      checkCallback: c => {
        const a = ws.activeLeaf
        if (!a || ws.isInSidebar(a) || (a.parent as WorkspaceTabs).children.length <= 1) return false
        if (!c) for (const l of (a.parent as WorkspaceTabs).children.slice()) if (l !== a && !l.pinned) l.detach()
        return true
      }
    },
    {
      id: 'app:go-back',
      name: 'Navigate back',
      icon: 'lucide-arrow-left',
      hotkeys: [hk(['Mod', 'Alt'], 'ArrowLeft')],
      checkCallback: c => {
        const l = ws.activeLeaf
        if (!l || !l.view.navigation) return false
        if (!c) void l.history.back()
        return true
      }
    },
    {
      id: 'app:go-forward',
      name: 'Navigate forward',
      icon: 'lucide-arrow-right',
      hotkeys: [hk(['Mod', 'Alt'], 'ArrowRight')],
      checkCallback: c => {
        const l = ws.activeLeaf
        if (!l || !l.view.navigation) return false
        if (!c) void l.history.forward()
        return true
      }
    },
    {
      id: 'app:toggle-left-sidebar',
      name: 'Toggle left sidebar',
      checkCallback: c => {
        if (!c) ws.leftSplit.toggle()
        return true
      }
    },
    {
      id: 'app:toggle-right-sidebar',
      name: 'Toggle right sidebar',
      checkCallback: c => {
        if (!c) ws.rightSplit.toggle()
        return true
      }
    }
  )
  return cmds
}

/** Runs a workspace command by id (used by tests and until the command area exists). */
export function executeWorkspaceCommand(ws: Workspace, id: string): boolean {
  const cmd = workspaceCommands(ws).find(c => c.id === id)
  if (!cmd || !cmd.checkCallback(true)) return false
  cmd.checkCallback(false)
  return true
}
