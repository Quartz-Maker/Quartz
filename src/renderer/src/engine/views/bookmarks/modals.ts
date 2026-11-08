/* eslint-disable @typescript-eslint/no-explicit-any */
// "Edit bookmark" (path / title / group) and "Bookmark all tabs" modals.
import { ConfirmationModal } from '../../ui/Modal'
import { Setting } from '../../ui/setting'
import type { BookmarkItem, BookmarksPlugin } from './BookmarksPlugin'
import { walkItems } from './BookmarksPlugin'

function describeItem(item: BookmarkItem): string {
  switch (item.type) {
    case 'file':
      return (item.path ?? '').replace(/\.md$/, '') + (item.subpath ?? '')
    case 'folder':
      return item.path ?? ''
    case 'search':
      return item.query ?? ''
    case 'url':
      return item.url ?? ''
    default:
      return item.title ?? ''
  }
}

/** All groups (nested ones too) with a stable id each. */
function groupOptions(plugin: BookmarksPlugin): { id: string; group: BookmarkItem; label: string }[] {
  const out: { id: string; group: BookmarkItem; label: string }[] = []
  const rec = (items: BookmarkItem[], prefix: string) => {
    for (const it of items)
      if (it.type === 'group') {
        const label = prefix + (it.title ?? '')
        out.push({ id: String(it.ctime) + ':' + out.length, group: it, label })
        rec(it.items ?? [], label + ' / ')
      }
  }
  rec(plugin.items, '')
  return out
}

export class EditBookmarkModal extends ConfirmationModal {
  constructor(app: any, plugin: BookmarksPlugin, item: BookmarkItem, isEdit: boolean) {
    super(app)
    this.containerEl.addClass('mod-bookmark')
    this.modalEl.addClass('mod-bookmark', 'mod-lg')
    this.setTitle(isEdit ? 'Edit bookmark' : 'Add bookmark')
    const c = this.contentEl
    new Setting(c).setName('Path').addText(t => {
      t.setValue(describeItem(item)).setDisabled(true)
      t.inputEl.spellcheck = false
    })
    let title = item.title ?? ''
    const s = new Setting(c).setName('Title').addText(t => {
      t.setValue(title).setPlaceholder(plugin.getItemTitle({ ...item, title: undefined }) ?? '')
      t.inputEl.spellcheck = false
      t.inputEl.setAttribute('enterkeyhint', 'done')
      t.onChange(v => (title = v))
      t.inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault()
          save()
        }
      })
    })
    void s
    const opts = groupOptions(plugin).filter(o => o.group !== item)
    const cur = (item as any)[Symbol.for('x')] // placeholder to keep structure simple
    void cur
    let target: BookmarkItem | null | undefined = undefined
    new Setting(c).setName('Bookmark group').addDropdown(d => {
      for (const o of opts) d.addOption(o.id, o.label)
      const parent = Object.getOwnPropertySymbols(item).map(k => (item as any)[k]).find(v => v && v.type === 'group')
      const sel = opts.find(o => o.group === parent)
      if (sel) d.setValue(sel.id)
      d.onChange(v => (target = opts.find(o => o.id === v)?.group ?? null))
    })
    const save = () => {
      if (title.trim()) item.title = title.trim()
      else if (item.type === 'file' || item.type === 'folder' || item.type === 'search') delete item.title
      this.close()
      if (isEdit) {
        if (target !== undefined) plugin.moveItem(item, target, target ? target.items!.length : plugin.items.length)
        else plugin.editItem(item)
      } else plugin.addItem(item, target ?? null)
    }
    if (isEdit)
      this.addButton(b =>
        b
          .setButtonText('Remove')
          .setWarning?.()
          ?.onClick(() => plugin.removeItem(item))
      )
    this.addButton(b => b.setButtonText('Cancel').setCancel())
    this.addButton(b => b.setButtonText('Save').setCta?.().onClick(() => save()))
    // Button classes: mod-destructive mod-secondary / mod-cancel / mod-cta
    const btns = this.buttonContainerEl.querySelectorAll('button')
    btns.forEach(bt => {
      if (bt.textContent === 'Remove') bt.classList.add('mod-destructive', 'mod-secondary')
      if (bt.textContent === 'Save') bt.classList.add('mod-cta')
    })
  }
}

/** Bookmark several items at once (all tabs / tab group / multiple files), optionally into a group. */
export class BookmarkTabsModal extends ConfirmationModal {
  constructor(app: any, plugin: BookmarksPlugin, items: BookmarkItem[]) {
    super(app)
    this.modalEl.addClass('mod-bookmark', 'mod-lg')
    this.setTitle(`Bookmark ${items.length} item${items.length === 1 ? '' : 's'}`)
    let group = ''
    const c = this.contentEl
    new Setting(c).setName('Group title').addText(t => {
      t.setPlaceholder('Optional').onChange(v => (group = v))
      t.inputEl.spellcheck = false
    })
    this.addButton(b => b.setButtonText('Cancel').setCancel())
    this.addButton(b =>
      b
        .setButtonText('Bookmark')
        .setCta?.()
        .onClick(() => {
          const existing = new Set<string>()
          walkItems(plugin.items, it => it.path && it.type === 'file' && !it.subpath && existing.add(it.path))
          const fresh = items.filter(it => !(it.type === 'file' && !it.subpath && it.path && existing.has(it.path)))
          if (group.trim()) {
            const g: BookmarkItem = { type: 'group', ctime: Date.now(), title: group.trim(), items: fresh }
            for (const it of fresh) (it as any)[Symbol.for('parent')] = g
            plugin.addItem(g, null)
            plugin.items.forEach(() => {})
          } else for (const it of fresh) plugin.addItem(it, null)
        })
    )
  }
}
