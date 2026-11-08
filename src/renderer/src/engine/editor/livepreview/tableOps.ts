// Pure table model + operations for the Live Preview table editor and the `editor:table-*` commands.
//
// Visual row index: 0 = header, 1.. = body rows (the delimiter row is not a row). Rows are arrays of
// raw cell source (trimmed). Serialisation pads every column to max(3, widest cell) and aligns cell
// content per the column alignment.

export type Align = 'left' | 'center' | 'right' | null

export interface TableData { rows: string[][]; aligns: Align[]; /** column widths before the operation (delimiter cell / widest cell): columns never shrink on edit */ sepW: number[] }

const width = (s: string) => [...s].length

/** Split a table source line into trimmed cell strings (honours `\|` and code spans). */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let i = 0
  while (i < line.length && /\s/.test(line[i])) i++
  if (line[i] === '|') i++
  let start = i
  let inCode = 0
  for (; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === '`') { let n = 1; while (line[i + n] === '`') n++; inCode = inCode === n ? 0 : inCode || n; i += n - 1; continue }
    if (ch === '|' && !inCode) { cells.push(line.slice(start, i).trim()); start = i + 1 }
  }
  if (line.slice(start).trim() !== '' || cells.length === 0) cells.push(line.slice(start).trim())
  return cells
}

export function parseTableData(text: string): TableData {
  const lines = text.split('\n')
  const sepCells = splitRow(lines[1] ?? '')
  const aligns = sepCells.map<Align>(t => {
    const l = t.startsWith(':'), r = t.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  const ncols = Math.max(aligns.length, splitRow(lines[0]).length)
  const rows = lines.filter((_, i) => i !== 1).map(l => {
    const c = splitRow(l)
    while (c.length < ncols) c.push('')
    return c.slice(0, ncols)
  })
  while (aligns.length < ncols) aligns.push(null)
  const sepW = Array.from({ length: ncols }, (_, i) => Math.max(3, sepCells[i]?.length ?? 3, ...rows.map(r => width(r[i] ?? ''))))
  return { rows, aligns: aligns.slice(0, ncols), sepW }
}

function pad(text: string, w: number, a: Align): string {
  const gap = Math.max(0, w - width(text))
  if (a === 'right') return ' '.repeat(gap) + text
  if (a === 'center') { const l = Math.floor(gap / 2); return ' '.repeat(l) + text + ' '.repeat(gap - l) }
  return text + ' '.repeat(gap)
}

export function columnWidths(d: TableData): number[] {
  return d.aligns.map((_, c) => Math.max(3, d.sepW[c] ?? 3, ...d.rows.map(r => width(r[c] ?? ''))))
}

const sepCell = (w: number, a: Align) =>
  a === 'center' ? ':' + '-'.repeat(w - 2) + ':' : a === 'right' ? '-'.repeat(w - 1) + ':' : a === 'left' ? ':' + '-'.repeat(w - 1) : '-'.repeat(w)

/** Serialise; `onlyCols` limits re-padding to those columns (others keep their source line text). */
export function formatTable(d: TableData): string {
  const w = columnWidths(d)
  const line = (cells: string[]) => '| ' + cells.map((t, c) => pad(t, w[c], d.aligns[c])).join(' | ') + ' |'
  const out = [line(d.rows[0])]
  out.push('| ' + w.map((x, c) => sepCell(x, d.aligns[c])).join(' | ') + ' |')
  for (let r = 1; r < d.rows.length; r++) out.push(line(d.rows[r]))
  return out.join('\n')
}

/** Re-pad only column `col` of an otherwise untouched table source (what typing in a cell does). */
export function formatColumn(text: string, col: number): string {
  const d = parseTableData(text)
  const w = columnWidths(d)[col]
  if (w === undefined) return text
  const src = text.split('\n')
  const out = src.map((ln, i) => {
    const cells = splitRow(ln)
    if (col >= cells.length) return ln
    if (i === 1) cells[col] = sepCell(w, d.aligns[col])
    else cells[col] = pad(d.rows[i === 0 ? 0 : i - 1][col] ?? '', w, d.aligns[col])
    // keep untouched cells' original padding
    const orig = rawCells(ln)
    return '|' + cells.map((c, k) => (k === col ? ' ' + c + ' ' : orig[k] ?? ' ' + c + ' ')).join('|') + '|'
  })
  return out.join('\n')
}

function rawCells(line: string): string[] {
  let i = 0
  while (i < line.length && /\s/.test(line[i])) i++
  if (line[i] === '|') i++
  const out: string[] = []
  let start = i, inCode = 0
  for (; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === '`') { let n = 1; while (line[i + n] === '`') n++; inCode = inCode === n ? 0 : inCode || n; i += n - 1; continue }
    if (ch === '|' && !inCode) { out.push(line.slice(start, i)); start = i + 1 }
  }
  if (line.slice(start).trim() !== '') out.push(line.slice(start))
  return out
}

export type TableOp =
  | 'row-before' | 'row-after' | 'row-up' | 'row-down' | 'row-copy' | 'row-delete'
  | 'col-before' | 'col-after' | 'col-left' | 'col-right' | 'col-copy' | 'col-delete'
  | 'col-align-left' | 'col-align-center' | 'col-align-right' | 'sort-az' | 'sort-za'

export interface OpResult { text: string; row: number; col: number }

export const compareCells = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Apply an operation at (row, col). Returns null when the operation does not apply. */
export function applyTableOp(text: string, op: TableOp, row: number, col: number): OpResult | null {
  const d = parseTableData(text)
  const ncols = d.aligns.length
  const emptyRow = () => Array<string>(ncols).fill('')
  const done = (r: number, c: number): OpResult => ({ text: formatTable(d), row: r, col: c })
  switch (op) {
    case 'row-before': d.rows.splice(row, 0, emptyRow()); return done(row, col)
    case 'row-after': d.rows.splice(row + 1, 0, emptyRow()); return done(row + 1, col)
    case 'row-up': if (row <= 0) return null; [d.rows[row - 1], d.rows[row]] = [d.rows[row], d.rows[row - 1]]; return done(row - 1, col)
    case 'row-down': if (row >= d.rows.length - 1) return null; [d.rows[row + 1], d.rows[row]] = [d.rows[row], d.rows[row + 1]]; return done(row + 1, col)
    case 'row-copy': d.rows.splice(row + 1, 0, [...d.rows[row]]); return done(row + 1, col)
    case 'row-delete':
      if (d.rows.length <= 1) return null
      d.rows.splice(row, 1); return done(Math.max(0, row - 1), col)
    case 'col-before': case 'col-after': {
      const at = op === 'col-before' ? col : col + 1
      d.rows.forEach(r => r.splice(at, 0, '')); d.aligns.splice(at, 0, d.aligns[col]); d.sepW.splice(at, 0, 3); return done(row, at)
    }
    case 'col-left': case 'col-right': {
      const to = op === 'col-left' ? col - 1 : col + 1
      if (to < 0 || to >= ncols) return null
      d.rows.forEach(r => { [r[to], r[col]] = [r[col], r[to]] });
      [d.aligns[to], d.aligns[col]] = [d.aligns[col], d.aligns[to]];
      [d.sepW[to], d.sepW[col]] = [d.sepW[col], d.sepW[to]]
      return done(row, to)
    }
    case 'col-copy': d.rows.forEach(r => r.splice(col + 1, 0, r[col])); d.aligns.splice(col + 1, 0, d.aligns[col]); d.sepW.splice(col + 1, 0, d.sepW[col]); return done(row, col + 1)
    case 'col-delete':
      if (ncols <= 1) return null
      d.rows.forEach(r => r.splice(col, 1)); d.aligns.splice(col, 1); d.sepW.splice(col, 1); return done(row, Math.max(0, col - 1))
    case 'col-align-left': d.aligns[col] = 'left'; return done(row, col)
    case 'col-align-center': d.aligns[col] = 'center'; return done(row, col)
    case 'col-align-right': d.aligns[col] = 'right'; return done(row, col)
    case 'sort-az': case 'sort-za': {
      const body = d.rows.slice(1)
      body.sort((a, b) => (op === 'sort-az' ? compareCells(a[col], b[col]) : compareCells(b[col], a[col])))
      d.rows = [d.rows[0], ...body]
      return done(row, col)
    }
  }
}

/** Where the caret goes after an operation: start of the cell text, or the raw end of an empty cell. */
export function cursorInCell(text: string, visualRow: number, col: number): { line: number; ch: number } {
  const lines = text.split('\n')
  const line = visualRow === 0 ? 0 : visualRow + 1
  const src = lines[line] ?? ''
  let i = 0
  while (i < src.length && /\s/.test(src[i])) i++
  if (src[i] === '|') i++
  const raws = rawCells(src)
  let pos = i
  for (let k = 0; k < raws.length; k++) {
    if (k === col) {
      const lead = raws[k].length - raws[k].trimStart().length
      return { line, ch: raws[k].trim() === '' ? pos + raws[k].length : pos + lead }
    }
    pos += raws[k].length + 1
  }
  return { line, ch: src.length }
}

export const TABLE_COMMANDS: { id: string; op: TableOp; name: string; icon: string }[] = [
  { id: 'row-before', op: 'row-before', name: 'Add row above', icon: 'lucide-panel-top-close' },
  { id: 'row-after', op: 'row-after', name: 'Add row below', icon: 'lucide-panel-bottom-close' },
  { id: 'row-up', op: 'row-up', name: 'Move row up', icon: 'lucide-arrow-up' },
  { id: 'row-down', op: 'row-down', name: 'Move row down', icon: 'lucide-arrow-down' },
  { id: 'row-copy', op: 'row-copy', name: 'Duplicate row', icon: 'lucide-copy' },
  { id: 'row-delete', op: 'row-delete', name: 'Delete row', icon: 'lucide-trash-2' },
  { id: 'col-before', op: 'col-before', name: 'Add column to the left', icon: 'lucide-panel-left-close' },
  { id: 'col-after', op: 'col-after', name: 'Add column to the right', icon: 'lucide-panel-right-close' },
  { id: 'col-left', op: 'col-left', name: 'Move column left', icon: 'lucide-arrow-left' },
  { id: 'col-right', op: 'col-right', name: 'Move column right', icon: 'lucide-arrow-right' },
  { id: 'col-copy', op: 'col-copy', name: 'Duplicate column', icon: 'lucide-copy' },
  { id: 'col-delete', op: 'col-delete', name: 'Delete column', icon: 'lucide-trash-2' },
  { id: 'col-align-left', op: 'col-align-left', name: 'Align left', icon: 'lucide-align-left' },
  { id: 'col-align-center', op: 'col-align-center', name: 'Align center', icon: 'lucide-align-center' },
  { id: 'col-align-right', op: 'col-align-right', name: 'Align right', icon: 'lucide-align-right' }
]
