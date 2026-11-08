/* eslint-disable @typescript-eslint/no-explicit-any */
// File recovery core plugin: IndexedDB `<appId>-backup` v1, store `backups`
// (autoIncrement; indexes `path`, `ts`; records {path, ts, data}); snapshots for md/canvas/base files at most every
// `intervalMinutes`, pending re-save every 60s, cleanup of snapshots older than `keepDays` hourly.
import type { CorePluginDef } from '../app/InternalPlugins'
import { Modal, Notice, moment } from '../ui'
import { AbstractInputSuggest } from '../ui/suggest'
import DiffMatchPatch, { DIFF_DELETE, DIFF_INSERT, type Diff } from 'diff-match-patch'
import { t } from '../settings/i18n'

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))))


// File recovery diff (diff-match-patch line mode + semantic cleanup; changed line pairs that are similar
// get word-level highlights; unchanged runs fold).
const dmp = new DiffMatchPatch()
dmp.Diff_Timeout = 1

function lineMode(a: string, b: string): Diff[] {
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(a, b)
  const d = dmp.diff_main(chars1, chars2, false)
  dmp.diff_charsToLines_(d, lineArray)
  return d
}

/** Words and single non-word characters as units, diffed like lines. */
function wordMode(a: string, b: string): Diff[] {
  const arr: string[] = ['']
  const map: Record<string, number> = {}
  const enc = (text: string): string => {
    let out = ''
    const put = (w: string): void => {
      if (Object.prototype.hasOwnProperty.call(map, w)) out += String.fromCharCode(map[w])
      else {
        out += String.fromCharCode(arr.length)
        map[w] = arr.length
        arr.push(w)
      }
    }
    let start = 0
    let i = -1
    while (i < text.length - 1) {
      i = start
      while (i < text.length && !/\W/.test(text[i])) i++
      if (i >= text.length) {
        put(text.substring(start))
        break
      }
      if (start !== i) put(text.substring(start, i))
      put(text[i])
      start = i + 1
    }
    return out
  }
  const c1 = enc(a)
  const c2 = enc(b)
  const d = dmp.diff_main(c1, c2, false)
  dmp.diff_charsToLines_(d, arr)
  return d
}

const splitLines = (t: string): string[] => {
  const l = t.split('\n')
  if (l.length > 1 && l[l.length - 1] === '') l.pop()
  return l
}

function diffView(before: string, after: string): HTMLElement {
  if (!before.endsWith('\n')) before += '\n'
  if (!after.endsWith('\n')) after += '\n'
  const diffs = lineMode(before, after)
  dmp.diff_cleanupSemantic(diffs)
  const root = createDiv('diff-view')
  const line = (content: string | DocumentFragment | null, side: 'left' | 'right' | null): HTMLElement => {
    const el = createDiv('diff-line')
    if (side) el.addClass('mod-' + side)
    if (typeof content === 'string') el.setText(content)
    else if (content) el.appendChild(content)
    el.createEl('br')
    return el
  }
  let same: HTMLElement[] = []
  let lefts: HTMLElement[] = []
  let rights: HTMLElement[] = []
  const flushSame = (atEnd: boolean): void => {
    if (!same.length) return
    const first = root.childNodes.length === 0
    const limit = first || atEnd ? 5 : 10
    if (same.length > limit) {
      const hidden: HTMLElement[] = []
      const fold = createDiv('diff-collapsed')
      fold.addEventListener('click', () => {
        const parent = fold.parentNode
        if (!parent) return
        for (const h of hidden) parent.insertBefore(h, fold)
        fold.detach()
      })
      if (first) {
        hidden.push(...same.slice(0, same.length - 3))
        root.appendChild(fold)
        for (const l of same.slice(-3)) root.appendChild(l)
      } else if (atEnd) {
        for (const l of same.slice(0, 3)) root.appendChild(l)
        root.appendChild(fold)
        hidden.push(...same.slice(3))
      } else {
        for (const l of same.slice(0, 3)) root.appendChild(l)
        hidden.push(...same.slice(3, same.length - 3))
        root.appendChild(fold)
        for (const l of same.slice(-3)) root.appendChild(l)
      }
      fold.setText(`${hidden.length} lines folded`)
    } else for (const l of same) root.appendChild(l)
    same = []
  }
  const flushChanged = (): void => {
    if (!lefts.length && !rights.length) return
    for (const l of lefts) root.appendChild(l)
    for (const r of rights) root.appendChild(r)
    lefts = []
    rights = []
  }
  const pair = (a: string | null | undefined, b: string | null | undefined): void => {
    const changed = a !== b
    if (a && b && changed) {
      const w = wordMode(a, b)
      if (dmp.diff_levenshtein(w) < Math.max(a.length, b.length) / 2) {
        const fa = createFragment()
        const fb = createFragment()
        for (const [op, text] of w) {
          if (op === DIFF_INSERT) fb.createSpan({ cls: 'diff-changed', text })
          else if (op === DIFF_DELETE) fa.createSpan({ cls: 'diff-changed', text })
          else fa.createSpan({ text }), fb.createSpan({ text })
        }
        flushSame(false)
        lefts.push(line(fa, 'left'))
        rights.push(line(fb, 'right'))
        return
      }
    }
    if (changed) {
      flushSame(false)
      lefts.push(line(a ?? null, 'left'))
      rights.push(line(b ?? null, 'right'))
    } else {
      flushChanged()
      same.push(line(a ?? null, null))
    }
  }
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]
    const lines = splitLines(text)
    if (op === DIFF_DELETE && i + 1 < diffs.length && diffs[i + 1][0] === DIFF_INSERT) {
      const next = splitLines(diffs[i + 1][1])
      for (let k = 0; k < Math.max(lines.length, next.length); k++) pair(lines[k], next[k])
      i++
    } else
      for (const l of lines) {
        if (op === DIFF_INSERT) pair(null, l)
        else if (op === DIFF_DELETE) pair(l, null)
        else pair(l, l)
      }
  }
  flushChanged()
  flushSame(true)
  return root
}

const size = (n: number): string => {
  if (n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (i < u.length - 1 && n >= Math.pow(1024, i + 1)) i++
  const v = n / Math.pow(1024, i)
  return `${i === 0 ? v : v.toFixed(2).replace(/\.?0+$/, '')} ${u[i]}`
}

type Snapshot = { path: string; ts: number; data: string }

/** "File recovery" (sync-history style dialog): choose a file on the left, its snapshots below; the
 *  selected snapshot's text (or its diff against the previous one) on the right with Copy / Restore. */
class RecoveryModal extends Modal {
  private versions: Snapshot[] = []
  private versionEls: HTMLElement[] = []
  private activeEl: HTMLElement | null = null
  private current: Snapshot | null = null
  private listEl!: HTMLElement
  private searchInput!: HTMLInputElement
  private contentContainer!: HTMLElement
  private contentTitleEl!: HTMLElement
  private textareaEl!: HTMLTextAreaElement
  private diffEl!: HTMLElement
  private diffToggle!: HTMLElement

  constructor(app: any, private store: Store, private initial?: string) {
    super(app)
    this.setTitle(t('plugins.fileRecovery.name'))
    this.modalEl.addClass('mod-sync-history', 'mod-sidebar-layout')
    const sidebar = this.contentEl.createDiv('modal-sidebar mod-history')
    const inner = sidebar.createDiv('modal-sidebar-inner')
    const sc = inner.createDiv('search-input-container mod-raised')
    this.searchInput = sc.createEl('input', { type: 'search', attr: { enterkeyhint: 'search', spellcheck: 'false', placeholder: t('plugins.fileRecovery.placeholderChooseFile') } })
    sc.createDiv('search-input-clear-button').addEventListener('click', () => ((this.searchInput.value = ''), this.searchInput.dispatchEvent(new Event('input'))))
    this.listEl = inner.createDiv({ cls: 'modal-sidebar-list', attr: { tabindex: -1 } })
    const cc = (this.contentContainer = this.contentEl.createDiv('sync-history-content-container mod-empty'))
    cc.createEl('p', { cls: 'sync-history-content-empty', text: t('plugins.fileRecovery.labelSelectFile') })
    const content = cc.createDiv('sync-history-content')
    const bar = content.createDiv('modal-setting-titlebar')
    this.contentTitleEl = bar.createDiv('modal-setting-title')
    const actions = bar.createDiv('modal-setting-titlebar-actions')
    const tog = actions.createSpan({ cls: 'modal-setting-titlebar-toggle', text: 'Show changes' })
    this.diffToggle = tog.createEl('label', { cls: 'checkbox-container mod-small', attr: { tabindex: 0 } })
    this.diffToggle.createEl('input', { type: 'checkbox', attr: { tabindex: -1 } })
    this.diffToggle.addEventListener('click', e => {
      e.preventDefault()
      this.diffToggle.toggleClass('is-enabled', !this.diffToggle.hasClass('is-enabled'))
      this.renderCurrent()
    })
    actions.createEl('button', { text: 'Copy' }).addEventListener('click', () => {
      if (!this.current) return
      void navigator.clipboard.writeText(this.current.data)
      new Notice('Copied to your clipboard')
    })
    actions.createEl('button', { text: 'Restore' }).addEventListener('click', async () => {
      const v = this.current
      if (!v) return
      const dir = v.path.includes('/') ? v.path.slice(0, v.path.lastIndexOf('/')) : ''
      if (dir && !(await this.app.vault.adapter.exists(dir))) await this.app.vault.createFolder(dir)
      await this.app.vault.adapter.write(v.path, v.data)
      await this.store.add({ path: v.path, ts: Date.now(), data: v.data })
      new Notice(`Restored version from ${moment(v.ts).fromNow()}`)
      void this.loadVersions(v.path)
    })
    this.textareaEl = content.createEl('textarea', { cls: 'file-recovery-text', attr: { spellcheck: 'false' } })
    this.diffEl = content.createDiv('file-recovery-diff')
  }

  async onOpen(): Promise<void> {
    const paths = (await this.store.paths()).sort((a, b) => a.localeCompare(b))
    if (!paths.length) return void this.contentEl.createEl('p', { text: t('plugins.fileRecovery.labelNoHistoryFound') })
    const modal = this
    new (class extends AbstractInputSuggest<string> {
      getSuggestions(q: string): string[] {
        const lq = q.toLowerCase()
        return paths.filter(p => p.toLowerCase().includes(lq)).slice(0, 100)
      }
      renderSuggestion(p: string, el: HTMLElement): void {
        el.setText(p.replace(/\.md$/, ''))
      }
      selectSuggestion(p: string): void {
        void modal.switchToPath(p)
        this.close()
      }
    })(this.app, this.searchInput)
    if (this.initial && paths.includes(this.initial)) void this.switchToPath(this.initial)
    else this.searchInput.focus({ preventScroll: true })
  }

  async switchToPath(path: string): Promise<void> {
    const name = path.replace(/\.md$/, '')
    this.searchInput.value = name
    this.searchInput.blur()
    this.contentTitleEl.setText(name)
    this.setTitle(name)
    await this.loadVersions(path)
  }

  private async loadVersions(path: string): Promise<void> {
    this.listEl.empty()
    this.versionEls = []
    this.versions = (await this.store.forPath(path)).sort((a, b) => b.ts - a.ts)
    this.activeEl = null
    this.versions.forEach((v, i) => {
      const item = this.listEl.createDiv({ cls: 'modal-sidebar-list-item file-recovery-list-item-header tappable', attr: { tabindex: -1 } })
      const details = item.createDiv({ cls: 'modal-sidebar-list-item-details file-recovery-list-item-details', text: moment(v.ts).format('llll') })
      details.createDiv({ cls: 'u-small u-muted', text: size(v.data.length) })
      details.addEventListener('click', () => this.selectVersion(i))
      this.versionEls.push(item)
    })
    if (this.versions.length) this.selectVersion(0)
  }

  private selectVersion(i: number): void {
    const v = this.versions[i]
    if (!v) return
    this.activeEl?.removeClass('is-active')
    this.activeEl = this.versionEls[i]
    this.activeEl.addClass('is-active')
    this.contentContainer.removeClass('mod-empty')
    this.current = v
    this.renderCurrent()
  }

  private renderCurrent(): void {
    const v = this.current
    if (!v) return
    const i = this.versions.indexOf(v)
    const prev = this.versions[i + 1]
    this.textareaEl.value = v.data
    this.textareaEl.setAttr('data-ext', v.path.split('.').pop() ?? '')
    const showDiff = this.diffToggle.hasClass('is-enabled')
    this.textareaEl.toggle(!showDiff)
    this.diffEl.toggle(showDiff)
    this.diffEl.empty()
    if (showDiff) this.diffEl.appendChild(diffView(prev ? prev.data : '', v.data))
  }
}

class Store {
  db: IDBDatabase | null = null
  constructor(private name: string) {}
  async open(): Promise<void> {
    const r = indexedDB.open(this.name, 1)
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('backups', { autoIncrement: true })
      s.createIndex('path', 'path')
      s.createIndex('ts', 'ts')
    }
    this.db = await req(r)
  }
  private os(mode: IDBTransactionMode): IDBObjectStore {
    return this.db!.transaction('backups', mode).objectStore('backups')
  }
  add(rec: { path: string; ts: number; data: string }): Promise<unknown> {
    return req(this.os('readwrite').add(rec))
  }
  async forPath(path: string): Promise<{ path: string; ts: number; data: string }[]> {
    return req(this.os('readonly').index('path').getAll(path)) as any
  }
  /** Every path with snapshots (unique index keys; `index.getAllKeys()` would return the record ids). */
  paths(): Promise<string[]> {
    return new Promise((res, rej) => {
      const out: string[] = []
      const r = this.os('readonly').index('path').openKeyCursor(null, 'nextunique')
      r.onsuccess = () => {
        const c = r.result
        if (!c) return res(out)
        out.push(String(c.key))
        c.continue()
      }
      r.onerror = () => rej(r.error)
    })
  }
  async clear(): Promise<void> {
    await req(this.os('readwrite').clear())
  }
  async cleanup(olderThan: number): Promise<void> {
    const os = this.os('readwrite')
    const r = os.index('ts').openCursor(IDBKeyRange.upperBound(olderThan))
    await new Promise<void>(res => {
      r.onsuccess = () => {
        const c = r.result
        if (c) c.delete(), c.continue()
        else res()
      }
      r.onerror = () => res()
    })
  }
  close(): void {
    this.db?.close()
  }
}

export const fileRecoveryPlugin: CorePluginDef = {
  id: 'file-recovery',
  name: t('plugins.fileRecovery.name'),
  description: t('plugins.fileRecovery.desc'),
  defaultOn: true,
  async onEnable(app, p) {
    const store = new Store(`${app.appId}-backup`)
    await store.open()
    p.register(() => store.close())
    const o = () => p.instance.options as { intervalMinutes: number; keepDays: number }
    const last = new Map<string, number>()
    const pending = new Set<string>()
    const eligible = (f: any): boolean => f && !f.children && ['md', 'canvas', 'base'].includes(f.extension)
    const snap = async (f: any): Promise<void> => {
      const now = Date.now()
      const prev = last.get(f.path)
      if (prev !== undefined && now - prev < o().intervalMinutes * 60000) return void pending.add(f.path)
      pending.delete(f.path)
      last.set(f.path, now)
      try {
        await store.add({ path: f.path, ts: now, data: await app.vault.cachedRead(f) })
      } catch (e) {
        console.error(e)
      }
    }
    app.workspace.onLayoutReady(() => p.registerEvent(app.vault.on('create', (f: any) => eligible(f) && void snap(f))))
    p.registerEvent(app.vault.on('modify', (f: any) => eligible(f) && void snap(f)))
    p.registerEvent(app.workspace.on('file-open', (f: any) => eligible(f) && void snap(f)))
    p.registerInterval(
      window.setInterval(() => {
        for (const path of Array.from(pending)) {
          const f = app.vault.getAbstractFileByPath(path)
          if (f) void snap(f)
          else pending.delete(path)
        }
      }, 60000)
    )
    const clean = (): void => void store.cleanup(Date.now() - o().keepDays * 86400000)
    p.registerInterval(window.setInterval(clean, 3600000))
    window.setTimeout(clean, 60000)

    p.instance.openModal = (initial?: string): void => void new RecoveryModal(app, store, initial).open()
    p.instance.clearData = async (): Promise<void> => {
      await store.clear()
      new Notice(t('plugins.fileRecovery.msgClearComplete'))
    }
    p.registerGlobalCommand({
      id: 'file-recovery:open',
      name: `${p.instance.name}: ${t('plugins.fileRecovery.actionOpen')}`,
      icon: 'lucide-rotate-ccw',
      callback: () => p.instance.openModal(app.workspace.getActiveFile()?.path)
    })
  }
}
