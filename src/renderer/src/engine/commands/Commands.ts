// `app.commands` — the command registry.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Events } from '../core/Events'
import type { Hotkey } from '../keymap/keys'
import { Platform } from '../keymap/Platform'

export interface Command {
  id: string
  name: string
  icon?: string
  mobileOnly?: boolean
  repeatable?: boolean
  callback?: () => any
  checkCallback?: (checking: boolean) => boolean | void
  editorCallback?: (editor: any, ctx: any) => any
  editorCheckCallback?: (checking: boolean, editor: any, ctx: any) => boolean | void
  hotkeys?: Hotkey[]
  /** @internal Editor commands normally refuse to run in reading view. */
  allowPreview?: boolean
  /** @internal Editor commands normally refuse to run while a property is focused. */
  allowProperties?: boolean
  /** @internal */
  showOnMobileToolbar?: boolean
}

/** The active markdown editor as seen by commands (`app.workspace.activeEditor`). */
export interface ActiveEditorInfo {
  editor: any
  getMode?: () => string
  inlineTitleEl?: HTMLElement
  titleEl?: HTMLElement
  /** True for a full MarkdownView (inline/view title + properties focus checks apply). */
  isMarkdownView?: boolean
  [k: string]: any
}

export interface CommandsHost {
  hotkeyManager: { addDefaultHotkeys(id: string, keys: Hotkey[]): void; removeDefaultHotkeys(id: string): void }
  workspace: { activeEditor: ActiveEditorInfo | null }
  lastEvent?: any
}

const isActive = (el?: HTMLElement): boolean => !!el && el.ownerDocument?.activeElement === el

/** Runs a command for real: checkCallback(false), else callback(). */
function runCommand(cmd: Command): void {
  if (cmd.checkCallback) cmd.checkCallback(false)
  else if (cmd.callback) cmd.callback()
  else console.error(`Command ${cmd} did not provide a callback`)
}

export class Commands extends Events {
  commands: Record<string, Command> = {}
  editorCommands: Record<string, Command> = {}
  app: CommandsHost

  constructor(app: CommandsHost) {
    super()
    this.app = app
  }

  addCommand(command: Command): void {
    if (command.mobileOnly && !Platform.isMobile) return
    if (command.editorCallback || command.editorCheckCallback) {
      command.checkCallback = (checking: boolean) => {
        const active = this.app.workspace.activeEditor
        if (!active) return null as any
        if (!command.allowPreview && active.getMode && active.getMode() === 'preview') return undefined
        const editor = active.editor
        if (active.isMarkdownView) {
          if (isActive(active.inlineTitleEl)) return
          if (isActive(active.titleEl)) return
          const focused = (globalThis as any).activeDocument?.activeElement ?? document.activeElement
          if (!command.allowProperties && focused && focused.closest && focused.closest('.metadata-container')) return
        }
        if (command.editorCheckCallback) return command.editorCheckCallback(checking, editor, active)
        if (command.editorCallback) {
          if (!checking) command.editorCallback(editor, active)
          return true
        }
        return undefined
      }
      this.editorCommands[command.id] = command
    }
    if (command.showOnMobileToolbar) this.editorCommands[command.id] = command
    this.commands[command.id] = command
    if (command.hotkeys) this.app.hotkeyManager.addDefaultHotkeys(command.id, command.hotkeys)
    this.trigger('changed')
  }

  removeCommand(id: string): void {
    if (Object.prototype.hasOwnProperty.call(this.commands, id)) this.app.hotkeyManager.removeDefaultHotkeys(id)
    delete this.commands[id]
    delete this.editorCommands[id]
    this.trigger('changed')
  }

  findCommand(id: string): Command | undefined {
    return this.commands[id]
  }

  /** Commands currently available: those without checkCallback, or whose checkCallback(true) is truthy. */
  listCommands(): Command[] {
    return Object.values(this.commands).filter(cmd => {
      if (!cmd.checkCallback) return true
      try {
        return cmd.checkCallback(true)
      } catch (e) {
        console.log('Command failed to execute: ', cmd.id)
        console.error(e)
        return false
      }
    })
  }

  executeCommandById(id: string, evt?: any): boolean {
    const cmd = this.findCommand(id)
    return !!cmd && this.executeCommand(cmd, evt)
  }

  /** Returns true unless the command threw (a declining checkCallback still counts as handled). */
  executeCommand(cmd: Command, evt?: any): boolean {
    this.app.lastEvent = evt || null
    try {
      runCommand(cmd)
    } catch (e) {
      console.log('Command failed to execute: ', cmd.id)
      console.error(e)
      return false
    }
    return true
  }
}
