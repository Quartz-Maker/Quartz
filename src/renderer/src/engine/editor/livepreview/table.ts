// Live Preview table widget.
//
// Tables are ALWAYS rendered as `div.cm-embed-block.cm-table-widget.markdown-rendered` (only a search
// match inside reveals the source). Clicking a cell opens a nested editor on that cell's source;
// edits are written straight back into the table text in the outer document.
//
// Also here: multi-cell selection (`td.is-selected`), row/column drag handles, the table context
// menu, `editor:table-*` operations and re-formatting on edit (tableOps.ts):
// typing re-pads the edited column, leaving the cell formats the whole table, Tab/Enter in the
// last cell/row appends a row.
import { Annotation, EditorState } from '@codemirror/state'
import type { Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { setIcon, setTooltip } from '../../workspace/dom'
import { EmbedWidget } from './blockWidgets'
import { renderMarkdownInto } from './render'
import { hypermdLanguage, tokenClassPlugin } from '../hypermd'
import { livePreviewHost, mousedownState } from './state'
import { inlineLivePreview } from './inline'
import { Menu } from '../../ui/Menu'
import {
  applyTableOp, cursorInCell, formatColumn, formatTable, parseTableData, compareCells,
  type TableOp
} from './tableOps'

type TableMenuBuilder = (menu: Menu, ev: MouseEvent, w: TableWidget, vrow: number, col: number) => void
let tableMenuBuilder: TableMenuBuilder | null = null
/** The editor installs the builder for the full cell context menu (editor menu + table items). */
export function setTableMenuBuilder(fn: TableMenuBuilder | null) { tableMenuBuilder = fn }

/** Widgets per outer editor so editor commands can find the table under the caret. */
const registry = new WeakMap<EditorView, Set<TableWidget>>()
const visualRow = (modelRow: number) => (modelRow === 0 ? 0 : modelRow - 1)
const modelRow = (vr: number) => (vr === 0 ? 0 : vr + 1)

/** The table (and visual row / column of the cell) the main selection is in. */
export function tableAtSelection(view: EditorView): { widget: TableWidget; row: number; col: number } | null {
  const set = registry.get(view)
  if (!set) return null
  const sel = view.state.selection.main
  for (const w of set) {
    if (!w.containerEl?.isConnected || w.start < 0 || sel.from < w.start || sel.to > w.end) continue
    const ed = w.activeCell
    const c = ed ?? w.cellAtOffset(sel.head - w.start)
    return { widget: w, row: visualRow(c.row), col: c.col }
  }
  return null
}

function minimalChange(oldText: string, next: string, base: number) {
  let a = 0
  while (a < oldText.length && a < next.length && oldText[a] === next[a]) a++
  let b = 0
  while (b < oldText.length - a && b < next.length - a && oldText[oldText.length - 1 - b] === next[next.length - 1 - b]) b++
  return { from: base + a, to: base + oldText.length - b, insert: next.slice(a, next.length - b) }
}

export interface TableCell { from: number; to: number; text: string; /** end of the raw cell (before the closing pipe) */ rawTo: number }
export interface TableRow { from: number; to: number; cells: TableCell[] }
export interface TableModel { rows: TableRow[]; aligns: (string | null)[] }

/** Split the table source into rows / cells with source offsets relative to the table start. */
export function parseTable(text: string): TableModel {
  const rows: TableRow[] = []
  let pos = 0
  for (const line of text.split('\n')) {
    const cells: TableCell[] = []
    let i = 0
    while (i < line.length && /\s/.test(line[i])) i++
    if (line[i] === '|') i++
    let start = i
    const pushCell = (end: number) => {
      let a = start, b = end
      while (b > a && /\s/.test(line[b - 1])) b--
      while (a < b && /\s/.test(line[a])) a++
      cells.push({ from: pos + a, to: pos + b, text: line.slice(a, b), rawTo: pos + end })
    }
    let inCode = 0
    for (; i < line.length; i++) {
      const ch = line[i]
      if (ch === '\\') { i++; continue }
      if (ch === '`') { let n = 1; while (line[i + n] === '`') n++; inCode = inCode === n ? 0 : inCode || n; i += n - 1; continue }
      if (ch === '|' && !inCode) { pushCell(i); start = i + 1 }
    }
    if (line.slice(start).trim() !== '' || cells.length === 0) pushCell(line.length)
    rows.push({ from: pos, to: pos + line.length, cells })
    pos += line.length + 1
  }
  const aligns = (rows[1]?.cells || []).map(c => {
    const t = c.text.trim(), l = t.startsWith(':'), r = t.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  return { rows, aligns }
}

const strongLTR = /[A-Za-zÀ-ʸͰ-֏ऀ-῿Ⰰ-﬜ﹰ-﻿]/
const strongRTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/
/** First-strong-character direction ('auto' when there is none). */
export function detectDir(text: string): 'ltr' | 'rtl' | 'auto' {
  for (const ch of text) {
    if (strongRTL.test(ch)) return 'rtl'
    if (strongLTR.test(ch)) return 'ltr'
  }
  return 'auto'
}

/** Escape unescaped pipes typed into a cell. */
function escapeCell(text: string): string {
  return text.replace(/\n/g, ' ').replace(/(^|[^\\])\|/g, '$1\\|')
}

const fromCell = Annotation.define<boolean>()

function dragHandle(cls: string, icon: string): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  el.setAttribute('data-ignore-swipe', 'true')
  setIcon(el, icon)
  return el
}

export class TableWidget extends EmbedWidget {
  model: TableModel
  private cellEditor: { view: EditorView; row: number; col: number } | null = null
  private outer: EditorView | null = null
  private selAnchor: { row: number; col: number } | null = null
  private selHead: { row: number; col: number } | null = null
  private dragStop: (() => void) | null = null

  get activeCell() { return this.cellEditor ? { row: this.cellEditor.row, col: this.cellEditor.col } : null }
  get hasSelection() { return !!(this.selAnchor && this.selHead) }

  constructor(public text: string, readonly sourcePath: string) {
    super()
    this.model = parseTable(text)
  }

  get editing() { return !!this.cellEditor }

  /** New source for this (same) table; keeps an open cell editor when the change came from it. */
  receiveUpdate(text: string, fromCellEditor: boolean) {
    if (text === this.text) return
    this.text = text
    this.model = parseTable(text)
    if (!fromCellEditor && this.containerEl) this.renderTable()
  }

  initDOM(view: EditorView) {
    this.outer = view
    let set = registry.get(view)
    if (!set) registry.set(view, (set = new Set()))
    set.add(this)
    const el = document.createElement('div')
    el.className = 'cm-embed-block cm-table-widget markdown-rendered'
    el.setAttribute('dir', 'ltr')
    this.containerEl = el
    el.addEventListener('contextmenu', ev => this.onContextMenu(ev))
    el.addEventListener('click', ev => { if (ev.target === el) this.exit(true) })
    this.renderTable()
    this.resizeWidget(view, el)
    return el
  }

  private renderTable() {
    const el = this.containerEl!
    this.closeCellEditor(false)
    this.selAnchor = this.selHead = null
    el.classList.remove('has-selection')
    while (el.firstChild) el.removeChild(el.firstChild)
    const wrapper = el.appendChild(document.createElement('div'))
    wrapper.className = 'table-wrapper'
    const table = wrapper.appendChild(document.createElement('table'))
    table.className = 'table-editor'
    table.tabIndex = -1
    const nl = () => document.createTextNode('\n')
    const { rows, aligns } = this.model
    const ncols = rows[0]?.cells.length ?? 0
    const section = (tag: string, rowIdx: number[]) => {
      const sec = document.createElement(tag)
      sec.appendChild(nl())
      for (const r of rowIdx) {
        const tr = sec.appendChild(document.createElement('tr'))
        tr.appendChild(nl())
        for (let c = 0; c < ncols; c++) {
          const cell = rows[r].cells[c]
          const td = tr.appendChild(document.createElement(r === 0 ? 'th' : 'td'))
          if (aligns[c]) td.setAttribute('align', aligns[c]!)
          td.setAttribute('dir', detectDir(cell?.text ?? ''))
          const inner = td.appendChild(document.createElement('div'))
          inner.className = 'table-cell-wrapper'
          this.renderCell(inner, cell?.text ?? '')
          if (r === 0) this.wireHandle(td.appendChild(dragHandle('table-col-drag-handle', 'lucide-grip-horizontal')), 'col')
          if (c === 0) this.wireHandle(td.appendChild(dragHandle('table-row-drag-handle', 'lucide-grip-vertical')), 'row')
          td.addEventListener('mousedown', ev => {
            if ((ev.target as HTMLElement).closest('.table-col-drag-handle, .table-row-drag-handle, .cm-editor')) return
            if (ev.button !== 0) return
            ev.preventDefault()
            this.beginCellPress(visualRow(r), c, ev)
          })
          tr.appendChild(nl())
        }
        sec.appendChild(nl())
      }
      return sec
    }
    table.appendChild(nl())
    table.appendChild(section('thead', [0]))
    table.appendChild(nl())
    const body = rows.map((_, i) => i).filter(i => i >= 2)
    if (body.length) { table.appendChild(section('tbody', body)); table.appendChild(nl()) }
    const addRow = wrapper.appendChild(document.createElement('div'))
    addRow.className = 'table-row-btn'
    setTooltip(addRow, 'Add row below')
    setIcon(addRow, 'lucide-plus')
    addRow.addEventListener('click', () => this.addRow())
    const addCol = wrapper.appendChild(document.createElement('div'))
    addCol.className = 'table-col-btn'
    setTooltip(addCol, 'Add column to the right')
    setIcon(addCol, 'lucide-plus')
    addCol.addEventListener('click', () => this.addColumn())
  }

  private renderCell(el: HTMLElement, text: string) {
    while (el.firstChild) el.removeChild(el.firstChild)
    if (!text) return
    const tmp = document.createElement('div')
    void Promise.resolve(renderMarkdownInto(tmp, text, this.sourcePath)).then(() => {
      // inline content only: unwrap the single paragraph the renderer produces
      const only = tmp.children.length === 1 && tmp.firstElementChild!.tagName === 'P' ? tmp.firstElementChild! : tmp
      while (only.firstChild) el.appendChild(only.firstChild)
    })
  }

  private cellEl(row: number, col: number): HTMLElement | null {
    const trs = this.containerEl?.querySelectorAll('tr')
    if (!trs) return null
    const tr = trs[row === 0 ? 0 : row - 1]
    return (tr?.children[col] as HTMLElement | undefined) ?? null
  }

  /** Cell (row, col) and offset inside its text for a table-relative source offset. */
  cellAtOffset(offset: number): { row: number; col: number; at: number } {
    const { rows } = this.model
    let r = rows.findIndex(row => offset >= row.from && offset <= row.to)
    if (r < 0) r = rows.length - 1
    if (r === 1) return { row: 0, col: 0, at: 0 }
    const cells = rows[r].cells
    let c = cells.findIndex((cell, i) => offset <= (cell.text === '' ? cell.rawTo : cell.to) || (i + 1 < cells.length && offset < cells[i + 1].from - 1))
    if (c < 0) c = cells.length - 1
    const cell = cells[c]
    return { row: r, col: c, at: Math.max(0, Math.min(cell.text.length, offset - cell.from)) }
  }

  /** Outer selection changed: open the cell editor where a focused caret lands inside the table. */
  receiveSelection(ranges: readonly { from: number; to: number; empty: boolean }[], focused: boolean) {
    if (!this.containerEl || this.start < 0) return
    const inside = focused && ranges.length === 1 && ranges[0].from >= this.start && ranges[0].to <= this.end
    if (!inside) { if (focused) this.closeCellEditor(true); return }
    const a = this.cellAtOffset(ranges[0].from - this.start)
    const b = this.cellAtOffset(ranges[0].to - this.start)
    if (a.row !== b.row || a.col !== b.col) return
    const ed = this.cellEditor
    if (!(ed && ed.row === a.row && ed.col === a.col)) this.openCellEditor(a.row, a.col, a.at)
    else if (ranges[0].empty && ed.view.state.selection.main.head !== a.at) ed.view.dispatch({ selection: { anchor: Math.min(a.at, ed.view.state.doc.length) } })
    const cell = this.model.rows[a.row]?.cells[a.col]
    if (cell && cell.text !== '' && ranges[0].empty && this.outer) {
      const target = this.start + cell.from + a.at
      if (target !== ranges[0].from) this.outer.dispatch({ selection: { anchor: target } })
    }
  }

  openCellEditor(row: number, col: number, cursor: 'start' | 'end' | 'all' | number = 'end') {
    const outer = this.outer
    if (!outer || row === 1) return
    this.closeCellEditor(true)
    const td = this.cellEl(row, col)
    const staticWrapper = td?.querySelector(':scope > .table-cell-wrapper') as HTMLElement | null
    if (!td || !staticWrapper) return
    const cell = this.model.rows[row]?.cells[col]
    const text = cell?.text ?? ''
    staticWrapper.style.display = 'none'
    const wrapper = td.appendChild(document.createElement('div'))
    wrapper.className = 'table-cell-wrapper'
    wrapper.setAttribute('data-ignore-swipe', 'true')
    this.cellEl(0, col)?.classList.add('mod-active-col-handle')
    this.cellEl(row, 0)?.classList.add('mod-active-row-handle')
    const move = (dr: number, dc: number, addRow = false) => () => {
      const ncols = this.model.rows[0].cells.length
      let r = row, c = col + dc
      if (c >= ncols) { c = 0; r++ } else if (c < 0) { c = ncols - 1; r-- }
      r += dr
      if (r === 1) r += dr || (dc > 0 ? 1 : -1)
      if (r >= this.model.rows.length && addRow) {
        // Tab in the last cell / Enter in the last row appends a row and lands in it
        this.runOp('row-after', visualRow(this.model.rows.length - 1), c)
        return true
      }
      if (r < 0 || r >= this.model.rows.length) { this.exit(dr > 0 || dc > 0); return true }
      this.normalize()
      this.openCellEditor(r, c, 'all')
      return true
    }
    const anchor = typeof cursor === 'number' ? Math.min(cursor, text.length) : cursor === 'end' ? text.length : 0
    const view = new EditorView({
      parent: wrapper,
      state: EditorState.create({
        doc: text,
        extensions: [
          hypermdLanguage, tokenClassPlugin, history(), EditorView.lineWrapping,
          livePreviewHost.of(outer.state.facet(livePreviewHost) ?? { getPath: () => this.sourcePath }),
          mousedownState, inlineLivePreview,
          keymap.of([
            { key: 'Tab', run: move(0, 1, true), shift: move(0, -1) },
            { key: 'Enter', run: move(1, 0, true) },
            { key: 'Escape', run: () => true },
            { key: 'ArrowUp', run: move(-1, 0) },
            { key: 'ArrowDown', run: move(1, 0) },
            ...historyKeymap, ...defaultKeymap
          ]),
          EditorView.updateListener.of(u => {
            if (u.docChanged) this.writeCell(row, col, u.state.doc.toString())
            if (u.selectionSet && this.cellEditor?.view === u.view) this.syncOuterSelection(row, col, u.state.selection.main.head, u.state.selection.main.anchor)
          }),
          EditorView.domEventHandlers({ blur: () => { setTimeout(() => { if (this.cellEditor?.view === view && !view.hasFocus) this.closeCellEditor(true) }, 0) } })
        ]
      })
    })
    this.cellEditor = { view, row, col }
    this.containerEl?.classList.add('has-focus')
    view.focus()
    view.dispatch({ selection: cursor === 'all' ? { anchor: 0, head: text.length } : { anchor } })
  }

  private syncOuterSelection(row: number, col: number, head: number, anchor = head) {
    const cell = this.model.rows[row]?.cells[col]
    const outer = this.outer
    if (!cell || !outer || this.start < 0) return
    // An empty cell keeps a caret that is already inside its raw span (raw end after operations)
    const m0 = outer.state.selection.main
    if (cell.text === '' && head === 0 && anchor === 0 && m0.empty && m0.head >= this.start + cell.from && m0.head <= this.start + cell.rawTo) return
    let at = cell.from + head
    if (cell.text === '' && head === 0) at = cell.rawTo
    const target = this.start + at
    const from = this.start + cell.from + anchor
    const main = outer.state.selection.main
    if (!(main.head === target && main.anchor === from) && !(anchor === head && main.empty && main.head === target)) outer.dispatch({ selection: { anchor: anchor === head ? target : from, head: target } })
  }

  private writeCell(row: number, col: number, value: string) {
    const outer = this.outer
    const cell = this.model.rows[row]?.cells[col]
    if (!outer || !cell || this.start < 0) return
    const insert = escapeCell(value)
    const edited = this.text.slice(0, cell.from) + insert + this.text.slice(cell.to)
    this.replaceTable(formatColumn(edited, col), true)
  }

  /** Swap the table source for `next` (minimal change); the open cell editor keeps living. */
  private replaceTable(next: string, fromCell_: boolean) {
    const outer = this.outer
    if (!outer || this.start < 0 || next === this.text) return
    const change = minimalChange(this.text, next, this.start)
    this.text = next
    this.model = parseTable(next)
    outer.dispatch({ changes: change, annotations: fromCell_ ? fromCell.of(true) : undefined, userEvent: 'input' })
    const ed = this.cellEditor
    if (ed) this.syncOuterSelection(ed.row, ed.col, ed.view.state.selection.main.head, ed.view.state.selection.main.anchor)
  }

  /** Format the whole table (what leaving a cell does). */
  normalize() {
    if (this.start < 0) return
    this.replaceTable(formatTable(parseTableData(this.text)), true)
  }

  closeCellEditor(rerender: boolean) {
    const ed = this.cellEditor
    if (!ed) return
    this.cellEditor = null
    if (rerender) this.normalize()
    const editorWrapper = ed.view.dom.parentElement
    ed.view.destroy()
    editorWrapper?.remove()
    this.containerEl?.classList.remove('has-focus')
    this.containerEl?.querySelectorAll('.mod-active-col-handle, .mod-active-row-handle').forEach(e => e.classList.remove('mod-active-col-handle', 'mod-active-row-handle'))
    const td = this.cellEl(ed.row, ed.col)
    const w = td?.querySelector(':scope > .table-cell-wrapper') as HTMLElement | null
    if (w) {
      w.style.display = ''
      if (rerender) this.renderCell(w, this.model.rows[ed.row]?.cells[ed.col]?.text ?? '')
    }
  }

  private exit(after: boolean) {
    const outer = this.outer
    this.closeCellEditor(true)
    if (!outer || this.start < 0) return
    const doc = outer.state.doc
    let pos: number
    if (after) {
      const line = doc.lineAt(Math.min(this.end, doc.length))
      pos = line.number < doc.lines ? doc.line(line.number + 1).from : line.to
    } else {
      const line = doc.lineAt(this.start)
      pos = line.number > 1 ? doc.line(line.number - 1).to : line.from
    }
    outer.focus()
    outer.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  }

  private addRow() {
    const res = applyTableOp(this.text, 'row-after', this.model.rows.length - 2, 0)
    if (res) this.replaceTable(res.text, false)
  }

  private addColumn() {
    const res = applyTableOp(this.text, 'col-after', 0, this.model.rows[0].cells.length - 1)
    if (res) this.replaceTable(res.text, false)
  }

  /** Run a table operation at a visual (row, col) and place the caret. */
  runOp(op: TableOp, vrow: number, col: number): boolean {
    const outer = this.outer
    if (!outer || this.start < 0) return false
    const res = applyTableOp(this.text, op, vrow, col)
    if (!res) return false
    this.deselect()
    this.closeCellEditor(false)
    const start = this.start
    outer.focus()
    outer.dispatch({ changes: minimalChange(this.text, res.text, start), userEvent: 'input' })
    const c = cursorInCell(res.text, res.row, res.col)
    const lines = res.text.split('\n')
    let off = 0
    for (let i = 0; i < c.line; i++) off += lines[i].length + 1
    outer.dispatch({ selection: { anchor: start + off + c.ch }, scrollIntoView: true })
    return true
  }

  // ---- multi-cell selection -------------------------------------------------------------------

  private tdAt(vrow: number, col: number): HTMLElement | null { return this.cellEl(modelRow(vrow), col) }

  private bounds() {
    const a = this.selAnchor, h = this.selHead
    if (!a || !h) return null
    return { minRow: Math.min(a.row, h.row), maxRow: Math.max(a.row, h.row), minCol: Math.min(a.col, h.col), maxCol: Math.max(a.col, h.col) }
  }

  private paint(dragging: boolean) {
    this.containerEl?.querySelectorAll('td.is-selected, th.is-selected').forEach(e => e.classList.remove('mod-dragging', 'is-selected', 'start', 'end', 'top', 'bottom'))
    const b = this.bounds()
    if (!b) { this.containerEl?.classList.remove('has-selection'); return }
    for (let r = b.minRow; r <= b.maxRow; r++) {
      for (let c = b.minCol; c <= b.maxCol; c++) {
        const cl = ['is-selected']
        if (dragging) cl.push('mod-dragging')
        if (c === b.minCol) cl.push('start')
        if (c === b.maxCol) cl.push('end')
        if (r === b.minRow) cl.push('top')
        if (r === b.maxRow) cl.push('bottom')
        this.tdAt(r, c)?.classList.add(...cl)
      }
    }
    this.containerEl?.classList.add('has-selection')
  }

  selectCells(anchor: { row: number; col: number }, head: { row: number; col: number }, dragging = false) {
    this.selAnchor = anchor
    this.selHead = head
    this.paint(dragging)
  }

  deselect() {
    if (!this.hasSelection) return
    this.selAnchor = this.selHead = null
    this.paint(false)
  }

  /** Visual (row, col) of the table cell element under a point, or null. */
  private cellFromPoint(doc: Document, x: number, y: number): { row: number; col: number } | null {
    const el = (doc.elementFromPoint(x, y) as HTMLElement | null)?.closest('td, th') as HTMLElement | null
    if (!el || !this.containerEl?.contains(el)) return null
    const tr = el.parentElement as HTMLTableRowElement
    const row = [...this.containerEl.querySelectorAll('tr')].indexOf(tr)
    const col = [...tr.children].indexOf(el)
    return row < 0 || col < 0 ? null : { row, col }
  }

  /** Mouse press on a cell: a click opens the cell editor, dragging across cells selects a range. */
  private beginCellPress(vr: number, c: number, ev: MouseEvent) {
    this.deselect()
    const doc = (ev.target as HTMLElement).ownerDocument
    let moved = false
    const onMove = (e: MouseEvent) => {
      const p = this.cellFromPoint(doc, e.clientX, e.clientY)
      if (!p || (!moved && p.row === vr && p.col === c)) return
      if (!moved) { moved = true; this.closeCellEditor(true); doc.defaultView?.getSelection()?.removeAllRanges() }
      this.selectCells({ row: vr, col: c }, p, true)
    }
    const onUp = () => {
      doc.removeEventListener('mousemove', onMove, true)
      doc.removeEventListener('mouseup', onUp, true)
      this.dragStop = null
      if (moved) this.paint(false)
    }
    this.dragStop = onUp
    doc.addEventListener('mousemove', onMove, true)
    doc.addEventListener('mouseup', onUp, true)
    this.openCellEditor(modelRow(vr), c)
  }

  /** Delete the selected cells: whole rows / columns when the selection spans them, else clear. */
  deleteSelection() {
    const b = this.bounds()
    if (!b) return
    const d = parseTableData(this.text)
    const nrows = d.rows.length, ncols = d.aligns.length
    const allCols = b.minCol === 0 && b.maxCol === ncols - 1
    const allRows = b.minRow === 0 && b.maxRow === nrows - 1
    this.deselect()
    if (allCols && allRows) {
      const outer = this.outer
      if (outer && this.start >= 0) outer.dispatch({ changes: { from: this.start, to: this.end, insert: '' }, selection: { anchor: this.start } })
      return
    }
    if (allCols) d.rows.splice(b.minRow, b.maxRow - b.minRow + 1)
    else if (allRows) {
      const n = b.maxCol - b.minCol + 1
      d.rows.forEach(r => r.splice(b.minCol, n)); d.aligns.splice(b.minCol, n); d.sepW.splice(b.minCol, n)
    } else this.clearCells(b, d)
    this.replaceTable(formatTable(d), false)
  }

  private clearCells(b: { minRow: number; maxRow: number; minCol: number; maxCol: number }, d = parseTableData(this.text)) {
    for (let r = b.minRow; r <= b.maxRow; r++) for (let c = b.minCol; c <= b.maxCol; c++) d.rows[r][c] = ''
    return d
  }

  private setAlignment(cols: number[], a: 'left' | 'center' | 'right') {
    const d = parseTableData(this.text)
    for (const c of cols) d.aligns[c] = a
    this.replaceTable(formatTable(d), false)
  }

  // ---- drag handles ---------------------------------------------------------------------------

  private wireHandle(el: HTMLElement, kind: 'row' | 'col') {
    el.addEventListener('mousedown', ev => {
      if (ev.button !== 0) return
      ev.preventDefault()
      ev.stopPropagation()
      const td = el.parentElement as HTMLElement
      const from = kind === 'col' ? [...(td.parentElement as HTMLElement).children].indexOf(td) : [...this.containerEl!.querySelectorAll('tr')].indexOf(td.parentElement as HTMLTableRowElement)
      const nr = this.model.rows.length - 2, nc = this.model.rows[0].cells.length - 1
      const span = (i: number, dragging: boolean) =>
        this.selectCells(kind === 'col' ? { row: 0, col: i } : { row: i, col: 0 }, kind === 'col' ? { row: nr, col: i } : { row: i, col: nc }, dragging)
      let to = from, moved = false
      const doc = el.ownerDocument
      const onMove = (e: MouseEvent) => {
        const p = this.cellFromPoint(doc, e.clientX, e.clientY)
        if (!p) return
        const v = kind === 'col' ? p.col : p.row
        if (!moved && v === from) return
        if (!moved) { moved = true; this.containerEl?.classList.add('is-dragging'); this.closeCellEditor(true) }
        to = v
        span(to, true)
      }
      const onUp = () => {
        doc.removeEventListener('mousemove', onMove, true)
        doc.removeEventListener('mouseup', onUp, true)
        this.dragStop = null
        this.containerEl?.classList.remove('is-dragging')
        if (!moved) { this.closeCellEditor(true); span(from, false); return }
        this.deselect()
        if (to === from) return
        let text = this.text
        const op = (kind === 'col' ? (to > from ? 'col-right' : 'col-left') : (to > from ? 'row-down' : 'row-up')) as TableOp
        for (let cur = from; cur !== to; cur += to > from ? 1 : -1) {
          const r = applyTableOp(text, op, kind === 'row' ? cur : 0, kind === 'col' ? cur : 0)
          if (!r) break
          text = r.text
        }
        this.replaceTable(text, false)
      }
      this.dragStop = onUp
      doc.addEventListener('mousemove', onMove, true)
      doc.addEventListener('mouseup', onUp, true)
    })
  }

  // ---- context menu ---------------------------------------------------------------------------

  /** Table menu items (Row / Column submenus + sort, or the selection menu). Also used by the editor menu. */
  addMenuItems(menu: Menu, vrow: number, col: number) {
    const b = this.bounds()
    const nrows = this.model.rows.length - 1, ncols = this.model.rows[0].cells.length
    if (b) {
      const cols: number[] = []
      for (let c = b.minCol; c <= b.maxCol; c++) cols.push(c)
      this.makeAlignmentMenu(menu, cols)
      menu.addItem(i => i.setSection('table').setIcon('lucide-eraser').setTitle('Clear cells').onClick(() => this.replaceTable(formatTable(this.clearCells(b)), false)))
      menu.addItem(i => i.setSection('table').setIcon('lucide-trash-2').setTitle('Delete cells').onClick(() => this.deleteSelection()))
      return
    }
    const run = (op: TableOp) => () => { this.runOp(op, vrow, col) }
    menu.addItem(i => {
      const sub = i.setSection('table').setIcon('lucide-table').setTitle('Row').setSubmenu()
      sub.addItem(x => x.setSection('table-add').setIcon('lucide-panel-top-close').setTitle('Add row above').onClick(run('row-before')))
      sub.addItem(x => x.setSection('table-add').setIcon('lucide-panel-bottom-close').setTitle('Add row below').onClick(run('row-after')))
      if (vrow > 0) sub.addItem(x => x.setSection('table-move').setIcon('lucide-arrow-up').setTitle('Move row up').onClick(run('row-up')))
      if (vrow !== nrows - 1) sub.addItem(x => x.setSection('table-move').setIcon('lucide-arrow-down').setTitle('Move row down').onClick(run('row-down')))
      sub.addItem(x => x.setSection('table-modify').setIcon('lucide-copy').setTitle('Duplicate row').onClick(run('row-copy')))
      sub.addItem(x => x.setSection('table-modify').setIcon('lucide-trash-2').setTitle('Delete row').onClick(run('row-delete')))
    })
    menu.addItem(i => {
      const sub = i.setSection('table').setIcon('lucide-table').setTitle('Column').setSubmenu()
      sub.addItem(x => x.setSection('table-add').setIcon('lucide-panel-left-close').setTitle('Add column to the left').onClick(run('col-before')))
      sub.addItem(x => x.setSection('table-add').setIcon('lucide-panel-right-close').setTitle('Add column to the right').onClick(run('col-after')))
      if (col > 0) sub.addItem(x => x.setSection('table-move').setIcon('lucide-arrow-left').setTitle('Move column left').onClick(run('col-left')))
      if (col < ncols - 1) sub.addItem(x => x.setSection('table-move').setIcon('lucide-arrow-right').setTitle('Move column right').onClick(run('col-right')))
      this.makeAlignmentMenu(sub, [col])
      sub.addItem(x => x.setSection('table-modify').setIcon('lucide-copy').setTitle('Duplicate column').onClick(run('col-copy')))
      sub.addItem(x => x.setSection('table-modify').setIcon('lucide-trash-2').setTitle('Delete column').onClick(run('col-delete')))
    })
    menu.addItem(i => i.setSection('table-sort').setIcon('lucide-arrow-down-az').setTitle('Sort by column (A to Z)').onClick(run('sort-az')))
    menu.addItem(i => i.setSection('table-sort').setIcon('lucide-arrow-up-za').setTitle('Sort by column (Z to A)').onClick(run('sort-za')))
  }

  private makeAlignmentMenu(menu: Menu, cols: number[]) {
    menu.addItem(i => i.setSection('table-align').setIcon('lucide-align-left').setTitle('Align left').onClick(() => this.setAlignment(cols, 'left')))
    menu.addItem(i => i.setSection('table-align').setIcon('lucide-align-center').setTitle('Align center').onClick(() => this.setAlignment(cols, 'center')))
    menu.addItem(i => i.setSection('table-align').setIcon('lucide-align-right').setTitle('Align right').onClick(() => this.setAlignment(cols, 'right')))
  }

  /** Right click: the editor menu (built by the host hook, which calls addMenuItems) or just the table items. */
  private onContextMenu(ev: MouseEvent) {
    if (!this.outer) return
    ev.preventDefault()
    ev.stopPropagation()
    const td = (ev.target as HTMLElement).closest('td, th') as HTMLElement | null
    const tr = td?.parentElement as HTMLTableRowElement | undefined
    const row = tr ? [...this.containerEl!.querySelectorAll('tr')].indexOf(tr) : (this.activeCell ? visualRow(this.activeCell.row) : 0)
    const col = td && tr ? [...tr.children].indexOf(td) : (this.activeCell?.col ?? 0)
    const menu = new Menu()
    if (tableMenuBuilder) tableMenuBuilder(menu, ev, this, row, col)
    else this.addMenuItems(menu, row, col)
    menu.showAtMouseEvent(ev)
  }

  destroy() {
    this.closeCellEditor(false)
    this.dragStop?.()
    super.destroy()
  }

  get estimatedHeight() { return this.model.rows.length * 36 }
}

/** Was this transaction written by a table cell editor? */
export function isCellEdit(tr: Transaction): boolean {
  return !!tr.annotation(fromCell)
}
