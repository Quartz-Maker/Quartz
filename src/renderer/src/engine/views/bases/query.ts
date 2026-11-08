/* eslint-disable @typescript-eslint/no-explicit-any */
// Query execution: filter -> sort -> group -> limit, and column summaries.
import type { BaseConfig, ViewConfig } from './BaseConfig'
import { BasesEntry, FILE_PROPERTIES, type BasesContext } from './context'
import { splitPropertyId } from './BaseConfig'
import { Formula, type FormulaContext } from './expr/Formula'
import {
  Value, NullValue, NULL, NumberValue, DateValue, DurationValue, BooleanValue, ListValue, StringValue, LinkValue, compareNatural, frontmatterObject
} from './values'

export class BasesEntryGroup {
  constructor(public key: Value | undefined, public entries: BasesEntry[] = []) {}
  hasKey(): boolean {
    return !!this.key && !(this.key instanceof NullValue)
  }
}

/** Standard summaries per value type (merged from the specific class up to Value). */
const SUMMARIES: [any, Record<string, string>][] = [
  [NumberValue, { Average: 'values.mean().round(2)', Min: 'values.min()', Max: 'values.max()', Sum: 'values.sum().round(2)', Range: 'values.max() - values.min()', Median: 'values.median()', Stddev: 'values.stddev().round(2)' }],
  [DateValue, { Earliest: 'values.earliest()', Latest: 'values.latest()', Range: '(values.latest() - values.earliest())' }],
  [BooleanValue, { Checked: 'values.filter(value == true).length', Unchecked: 'values.filter(value == false).length' }],
  [Value, { Empty: 'values.filter(value.isType("null")).length', Filled: 'values.filter(!value.isType("null")).length', Unique: 'values.unique().length' }]
]
export function standardSummaries(type: any): Record<string, string> {
  let out: Record<string, string> = {}
  for (let t = type; t; t = Object.getPrototypeOf(t)) {
    const m = SUMMARIES.find(s => s[0] === t)
    if (m) out = { ...m[1], ...out }
    if (t === Value) break
  }
  return out
}

class SummaryContext implements FormulaContext {
  constructor(public app: any, public values: Value[]) {}
  keys(): string[] {
    return ['values']
  }
  getByIdentifier(id: string): Value | null {
    return id.toLowerCase() === 'values' ? new ListValue(this.values) : NULL
  }
}

export class BasesQueryResult {
  data: BasesEntry[] = []
  properties: string[] = []
  groupedData: BasesEntryGroup[] = []
  constructor(public query?: BaseConfig, public app?: any) {}
  getSummaryValue(_controller: any, entries: BasesEntry[], prop: string, summaryKey: string): Value {
    const query = this.query!
    const values = entries.map(e => e.getValue(prop) || NULL)
    const custom = query.summaryFormulas && Object.hasOwn(query.summaryFormulas, summaryKey) ? query.summaryFormulas[summaryKey] : null
    let formula = custom
    if (!formula) {
      const type = valueClassOf(values)
      const text = standardSummaries(type)[summaryKey]
      if (text) formula = new Formula(text)
    }
    if (!formula) return NULL
    return formula.getValue(new SummaryContext(this.app, values)) || NULL
  }
}
export function valueClassOf(values: Value[]): any {
  for (const v of values) if (v && !(v instanceof NullValue)) return v.constructor
  return Value
}

const natural = (a: string, b: string): number => compareNatural(a, b)
/** Display text of a value: a link shows its alias when it has one. */
export function displayString(v: Value): string {
  return v instanceof LinkValue && v.display ? v.display.toString() : v.toString()
}

/**
 * Row comparison used by view sorting. Nulls always sort last (regardless of direction), booleans
 * order false < true, numbers / dates / durations compare numerically and everything else compares
 * its display text with a natural collation. Returns the signed order for `dir`, or `null` to fall
 * through to the next sort criterion.
 */
function compareForSort(a: Value | null, b: Value | null, dir: 'ASC' | 'DESC'): number | null {
  const aNull = !a || a instanceof NullValue
  const bNull = !b || b instanceof NullValue
  let u = 0
  if (aNull && bNull) u = 0
  else if (a instanceof BooleanValue || b instanceof BooleanValue) u = (a && a.isTruthy() ? 1 : -1) - (b && b.isTruthy() ? 1 : -1)
  else if (aNull) return 1
  else if (bNull) return -1
  else if (a instanceof NumberValue && b instanceof NumberValue) u = a.value - b.value
  else if (a instanceof DateValue && b instanceof DateValue) u = a.date.getTime() - b.date.getTime()
  else if (a instanceof DurationValue && b instanceof DurationValue) u = a.getMilliseconds() - b.getMilliseconds()
  else u = natural(displayString(a!), displayString(b!))
  if (u === 0) return null
  return dir === 'ASC' ? u : -u
}
export const compareValues = (a: Value | null, b: Value | null, dir: 'ASC' | 'DESC'): number => compareForSort(a, b, dir) ?? 0

export const DEFAULT_SORT_SPEC: { property: string; direction: 'ASC' | 'DESC' }[] = [{ property: 'file.name', direction: 'ASC' }]

/** Sort `entries` in place by the view's sort list (limited to known properties); ties keep their order. */
export function sortEntries(entries: BasesEntry[], view: ViewConfig, known: Set<string> | null): void {
  let specs = view.getSort().filter(s => !known || known.has(s.property))
  if (specs.length === 0) specs = DEFAULT_SORT_SPEC.slice()
  const cmp = (i: number, a: BasesEntry, b: BasesEntry): number => {
    if (i >= specs.length) return 0
    const { property, direction } = specs[i]
    let va: Value | null
    let vb: Value | null
    try {
      va = a.getValue(property)
      vb = b.getValue(property)
    } catch {
      return 0
    }
    const r = compareForSort(va, vb, direction)
    return r === null ? cmp(i + 1, a, b) : r
  }
  entries.sort((a, b) => cmp(0, a, b))
}

/** The property ids a view can sort / group by: file props, props used by its rows, formulas. */
export function knownProperties(app: any, query: BaseConfig, relevant: Set<string>): string[] {
  const out: string[] = FILE_PROPERTIES.slice()
  for (const r of relevant) out.push('note.' + (app.metadataTypeManager?.getPropertyInfo?.(r)?.name ?? r))
  for (const k of Object.keys(query.formulas || {})) out.push('formula.' + k)
  return out
}

export interface RunOptions { search?: string | null; local?: any }
export interface RunResult {
  all: BasesEntry[]
  result: BasesQueryResult
  errors: string[]
  /** Rows in the view before the search box and the limit are applied (the "N results" count). */
  resultCount: number
  /** Rows matching the search box. */
  searchCount: number
  /** Properties used by the matching rows (lower-cased frontmatter keys). */
  relevant: Set<string>
}

/** Value of a stored group key (`groupOrder` entries are raw frontmatter values). */
export function parseGroupKey(app: any, file: any, property: string, raw: any): Value {
  const name = splitPropertyId(property).name
  return frontmatterObject(app, file, { [name]: raw }).objectAccess(name) ?? NULL
}
export const groupKeyEquals = (a: Value, b: Value): boolean => Value.looseEquals(a, b) || (a instanceof StringValue && a.value === b.toString())

/** Drop rows whose group is not listed in the view's manual group order. */
function filterByGroupOrder(app: any, query: BaseConfig, view: ViewConfig, entries: BasesEntry[]): BasesEntry[] {
  const g = view.groupBy
  const order = view.groupOrder
  if (!g || !order) return entries
  const keys = order.map(o => parseGroupKey(app, (query as any).file, g.property, o))
  return entries.filter(e => {
    const v = e.getValue(g.property) || NULL
    return keys.some(k => groupKeyEquals(k, v))
  })
}

function applySearch(entries: BasesEntry[], search: string | null | undefined, props: string[]): BasesEntry[] {
  if (!search || !search.trim()) return entries
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return entries
  return entries.filter(e => {
    const left = tokens.slice()
    for (const p of props) {
      try {
        const v = e.getValue(p)
        if (!v || v instanceof NullValue) continue
        const text = displayString(v).toLowerCase()
        for (let i = left.length - 1; i >= 0; i--) if (text.includes(left[i])) left.splice(i, 1)
        if (left.length === 0) return true
      } catch {
        /* ignore */
      }
    }
    return false
  })
}

/** Evaluate `view` of `query` over the vault. */
export function runQuery(app: any, query: BaseConfig, view: ViewConfig, ctx: BasesContext, opts: RunOptions = {}): RunResult {
  const errors: string[] = []
  const all: BasesEntry[] = []
  for (const file of app.vault.getFiles()) {
    if (app.metadataCache.isUserIgnored?.(file.path)) continue
    const entry = new BasesEntry(ctx, file)
    try {
      if (query.filters && !query.filters.test(entry)) continue
      if (view.filters && !view.filters.test(entry)) continue
    } catch (e: any) {
      errors.push(e.message)
      continue
    }
    all.push(entry)
  }
  const inView = filterByGroupOrder(app, query, view, all)
  const searched = applySearch(inView, opts.search, view.getOrder())
  searched.sort((a, b) => natural(a.file.path, b.file.path))
  const relevant = new Set<string>()
  for (const e of searched) for (const k of e.getPropertyKeys()) relevant.add(k.toLowerCase())
  const rows = searched.slice()
  sortEntries(rows, view, new Set(knownProperties(app, query, relevant)))
  const limit = view.getLimit()
  if (limit > 0 && rows.length > limit) rows.length = limit
  const result = new BasesQueryResult(query, app)
  result.data = rows
  result.properties = view.getOrder().slice()
  result.groupedData = group(app, query, view, rows)
  return { all, result, errors, resultCount: inView.length, searchCount: searched.length, relevant }
}

function compareGroupKeys(a: Value, b: Value): number {
  if (Value.equals(a, b)) return 0
  if (a instanceof NumberValue && b instanceof NumberValue) return a.value - b.value
  return natural(a.toString(), b.toString())
}

function group(app: any, query: BaseConfig, view: ViewConfig, entries: BasesEntry[]): BasesEntryGroup[] {
  const g = view.groupBy
  if (!g) return [new BasesEntryGroup(undefined, entries)]
  const order = view.groupOrder
  if (order) {
    const groups = order.map(o => new BasesEntryGroup(parseGroupKey(app, (query as any).file, g.property, o), []))
    for (const e of entries) {
      const v = e.getValue(g.property) || NULL
      const i = groups.findIndex(gr => groupKeyEquals(gr.key as Value, v))
      if (i === -1) continue
      const gr = groups[i]
      if (gr.entries.length === 0) gr.key = v
      gr.entries.push(e)
    }
    return groups.filter(gr => gr.entries.length > 0)
  }
  const groups: BasesEntryGroup[] = []
  for (const e of entries) {
    const key = e.getValue(g.property) || NULL
    let grp = groups.find(x => Value.looseEquals(x.key as Value, key))
    if (!grp) groups.push((grp = new BasesEntryGroup(key)))
    grp.entries.push(e)
  }
  const sign = g.direction === 'ASC' ? 1 : -1
  groups.sort((a, b) => (a.hasKey() && b.hasKey() ? compareGroupKeys(a.key as Value, b.key as Value) * sign : a.hasKey() ? -1 : b.hasKey() ? 1 : 0))
  return groups
}

/** Every property id the user can add as a column. */
export function allPropertyIds(app: any, query: BaseConfig, all: BasesEntry[]): string[] {
  const out = new Set<string>(FILE_PROPERTIES)
  for (const k of Object.keys(query.formulas || {})) out.add('formula.' + k)
  const props = app.metadataTypeManager?.getAllProperties?.() || {}
  for (const k of Object.keys(props)) out.add('note.' + props[k].name)
  for (const e of all) for (const k of Object.keys(e.frontmatter || {})) out.add('note.' + k)
  return Array.from(out)
}
void StringValue
