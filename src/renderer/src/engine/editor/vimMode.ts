// Vim key bindings (`vimMode` setting). Uses @replit/codemirror-vim (MIT), with
// ex-command hooks: `:w` saves the file, `:q` closes the pane, `:wq` / `:x` do both. The extension goes in
// at the highest precedence so it sees keys before the markdown keymaps; the `vimMode` setting toggles it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prec } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { vim, Vim } from '@replit/codemirror-vim'

let defined = false

function app(): any { return (window as any).app }
const run = (id: string) => { try { app()?.commands?.executeCommandById(id) } catch (e) { console.error(e) } }

function defineExCommands(): void {
  if (defined) return
  defined = true
  const save = () => run('editor:save-file')
  const close = () => run('workspace:close')
  Vim.defineEx('write', 'w', save)
  Vim.defineEx('quit', 'q', close)
  Vim.defineEx('wq', 'wq', () => { save(); close() })
  Vim.defineEx('xit', 'x', () => { save(); close() })
}

/** The vim extension (highest precedence) with the ex-command hooks. */
export function vimExtension(): Extension {
  defineExCommands()
  return Prec.highest(vim({ status: false }))
}
