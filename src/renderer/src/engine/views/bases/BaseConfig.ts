/* eslint-disable @typescript-eslint/no-explicit-any */
// `.base` file format: parse / validate / serialize, with stable key order, error strings and
// property-id normalisation.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { bt } from './strings'
import { Formula } from './expr/Formula'

export { bt } from './strings'
const P = (k: string, vars?: Record<string, string | number>): string => bt('plugins.bases.' + k, vars)

export const DEFAULT_ORDER = ['file.name']
export const DEFAULT_SORT = [{ property: 'file.name', direction: 'ASC' }]
export const FILE_PROPERTIES = ['file.file', 'file.name', 'file.basename', 'file.fullname', 'file.path', 'file.folder', 'file.ext', 'file.ctime', 'file.mtime', 'file.size', 'file.links', 'file.backlinks', 'file.embeds', 'file.tags']
const FILE_LABELS: Record<string, string> = {
  'file.file': 'labelFilePropFile', 'file.name': 'labelFilePropName', 'file.basename': 'labelFilePropBaseName', 'file.fullname': 'labelFilePropFullName',
  'file.path': 'labelFilePropPath', 'file.folder': 'labelFilePropFolder', 'file.ext': 'labelFilePropExt', 'file.ctime': 'labelFilePropCtime',
  'file.mtime': 'labelFilePropMtime', 'file.size': 'labelFilePropSize', 'file.backlinks': 'labelFilePropBacklinks', 'file.links': 'labelFilePropLinks',
  'file.embeds': 'labelFilePropEmbeds', 'file.tags': 'labelFilePropTags'
}
/** Properties that cannot be hidden/grouped by (file identity columns). */
export const NO_GROUP_PROPS = ['file.file', 'file.path', 'file.ctime', 'file.mtime', 'file.name', 'file.fullname', 'file.basename']

export interface PropertyRef { type: 'note' | 'file' | 'formula'; name: string }
/** `note.x` / `file.x` / `formula.x` -> {type,name}; a bare name is a note property. */
export function splitPropertyId(id: string): PropertyRef {
  const i = id.indexOf('.')
  if (i === -1) return { type: 'note', name: id }
  const type = id.slice(0, i)
  if (type !== 'note' && type !== 'formula' && type !== 'file') return { type: 'note', name: id }
  return { type, name: id.slice(i + 1) } as PropertyRef
}
export const joinPropertyId = (type: string, name: string): string => `${type}.${name}`
/** Property id as written to disk: the `note.` prefix is dropped, `file.file` is `file`. */
export function serializePropertyId(id: string): string {
  if (id.length > 5 && id.startsWith('note.')) {
    const rest = id.substring(5)
    const head = rest.split('.')[0]
    return ['file', 'formula', 'note'].includes(head) ? id : rest
  }
  return id === 'file.file' ? 'file' : id
}
/** Property id as used in memory (inverse of serializePropertyId). */
export function deserializePropertyId(id: string): string {
  if (id.startsWith('note.') || id.startsWith('formula.') || id.startsWith('file.')) return id
  return id === 'file' ? 'file.file' : 'note.' + id
}

// ------------------------------------------------------------------ filters
export abstract class FilterNode {
  abstract serialize(): any
  abstract test(ctx: any): boolean
}
export class ExprFilter extends FilterNode {
  constructor(public expr: Formula) {
    super()
  }
  serialize(): any {
    return this.expr.toString()
  }
  test(ctx: any): boolean {
    const v = this.expr.getValue(ctx)
    if (v && (v as any).constructor?.type === 'Error') throw new Error((v as any).message)
    return v ? v.isTruthy() : false
  }
}
export abstract class GroupFilter extends FilterNode {
  abstract conjunction: 'and' | 'or' | 'not'
  constructor(public filters: FilterNode[]) {
    super()
  }
  serialize(): any {
    return { [this.conjunction]: this.filters.map(f => f.serialize()) }
  }
}
export class AndFilter extends GroupFilter {
  conjunction = 'and' as const
  test(ctx: any): boolean {
    for (const f of this.filters) if (!f.test(ctx)) return false
    return true
  }
}
export class OrFilter extends GroupFilter {
  conjunction = 'or' as const
  test(ctx: any): boolean {
    if (this.filters.length === 0) return true
    for (const f of this.filters) if (f.test(ctx)) return true
    return false
  }
}
export class NotFilter extends GroupFilter {
  conjunction = 'not' as const
  test(ctx: any): boolean {
    for (const f of this.filters) if (f.test(ctx)) return false
    return true
  }
}

export function parseFilter(e: any): FilterNode {
  if (typeof e === 'string') return new ExprFilter(new Formula(e))
  if (typeof e !== 'object' || e === null) throw new Error(P('msgErrorFilterType'))
  const keys = Object.keys(e)
  if (keys.length !== 1) throw new Error(P('msgErrorFilterAllowedKeys'))
  const k = keys[0]
  if (k !== 'and' && k !== 'or' && k !== 'not') throw new Error(P('msgErrorFilterAllowedKeys'))
  if (!Array.isArray(e[k])) throw new Error(P('msgErrorFilterMustBeArray', { conjunction: k }))
  const kids = e[k].map(parseFilter)
  return k === 'and' ? new AndFilter(kids) : k === 'or' ? new OrFilter(kids) : new NotFilter(kids)
}

// ------------------------------------------------------------------ property config
export class PropertyConfig {
  displayName?: string
  unrecognizedData: Record<string, any> = {}
  constructor(public query: BaseConfig, public propertyId: string) {}
  static deserialize(query: BaseConfig, id: string, data: any): PropertyConfig {
    const c = new PropertyConfig(query, id)
    for (const k of Object.keys(data)) {
      if (k === 'displayName') {
        if (typeof data[k] === 'string') c.displayName = data[k]
      } else c.unrecognizedData[k] = data[k]
    }
    return c
  }
  serialize(): any {
    const o = Object.assign({}, this.unrecognizedData)
    if (this.displayName) o.displayName = this.displayName
    return Object.keys(o).length > 0 ? o : null
  }
  getDisplayName(): string {
    if (this.displayName) return this.displayName
    if (Object.prototype.hasOwnProperty.call(FILE_LABELS, this.propertyId)) return P(FILE_LABELS[this.propertyId])
    return splitPropertyId(this.propertyId).name
  }
  setDisplayName(name: string): void {
    this.displayName = name
    this.query.save()
  }
  migrateDisplayName(name: string): void {
    if (!this.displayName) this.displayName = name
  }
}

// ------------------------------------------------------------------ view config
export interface SortSpec { property: string; direction: 'ASC' | 'DESC' }

export class ViewConfig {
  filters?: FilterNode
  groupBy?: { property: string; direction: 'ASC' | 'DESC' } | null
  groupOrder?: any[] | null
  order?: string[]
  sort?: SortSpec[]
  limit?: number
  summaries?: Record<string, string>
  data?: Record<string, any>
  constructor(public query: BaseConfig, public type: string, public name: string) {}

  clone(name: string): ViewConfig {
    const s = this.serialize()
    s.name = name
    return parseView(this.query, s, this.query.views.length)
  }
  serialize(): any {
    const o: any = { type: this.type, name: this.name }
    if (this.filters) o.filters = this.filters.serialize()
    if (this.groupBy) o.groupBy = { property: serializePropertyId(this.groupBy.property), direction: this.groupBy.direction }
    if (this.groupOrder) o.groupOrder = this.groupOrder.slice()
    if (this.order) o.order = this.order.map(serializePropertyId)
    if (this.sort) o.sort = this.sort.map(s => ({ property: serializePropertyId(s.property), direction: s.direction }))
    if (this.limit) o.limit = this.limit
    if (this.summaries) {
      const s: Record<string, string> = (o.summaries = {})
      for (const k of Object.keys(this.summaries)) s[serializePropertyId(k)] = this.summaries[k]
    }
    if (this.data) for (const k of Object.keys(this.data)) if (!Object.prototype.hasOwnProperty.call(this, k)) o[k] = this.data[k]
    return o
  }
  getViewName(): string {
    return this.name
  }
  getAll(): Record<string, any> {
    return this.data || {}
  }
  get(key: string): any {
    return this.data?.[key]
  }
  getAsPropertyId(key: string): string | null {
    const v = this.data?.[key]
    return v && typeof v === 'string' ? deserializePropertyId(v) : null
  }
  set(key: string, value: any): void {
    if (!this.data) this.data = {}
    if (value === null) delete this.data[key]
    else this.data[key] = value
    this.query.save()
  }
  getOrder(): string[] {
    return this.order || DEFAULT_ORDER.slice()
  }
  setOrder(order: string[]): void {
    this.order = order
    this.query.save()
  }
  getSummaryKey(prop: string): string | null {
    return this.summaries && Object.prototype.hasOwnProperty.call(this.summaries, prop) ? this.summaries[prop] : null
  }
  setSummaryKey(prop: string, key: string | null): void {
    if (key === null) {
      if (!this.summaries || !Object.prototype.hasOwnProperty.call(this.summaries, prop)) return
      delete this.summaries[prop]
    } else {
      if (!this.summaries) this.summaries = {}
      this.summaries[prop] = key
    }
    this.query.save()
  }
  getSort(): SortSpec[] {
    return this.sort || []
  }
  setSortProperty(prop: string, dir: 'ASC' | 'DESC' | 'NONE' | 'TOGGLE'): void {
    const sort = this.getSort()
    const i = sort.findIndex(s => s.property === prop)
    if (i >= 0) {
      if (dir === 'TOGGLE') dir = sort[i].direction === 'ASC' ? 'DESC' : 'NONE'
      sort.splice(i, 1)
    }
    if (dir === 'TOGGLE') dir = 'ASC'
    if (dir === 'ASC' || dir === 'DESC') sort.unshift({ property: prop, direction: dir })
    this.sort = sort
    this.query.save()
  }
  setLimit(n: number): void {
    this.limit = n
    this.query.save()
  }
  getLimit(): number {
    return this.limit || 0
  }
  setGroupBy(g: { property: string; direction: 'ASC' | 'DESC' } | null): void {
    const cur = this.groupBy
    if (!g && !cur) return
    if (!g && cur) {
      this.groupBy = null
      this.groupOrder = null
      this.query.save()
      return
    }
    if (cur && g!.property === cur.property && g!.direction === cur.direction) return
    if (g!.property !== cur?.property) this.groupOrder = this.groupOrder ? [] : null
    this.groupBy = g
    this.query.save()
  }
  setGroupOrder(order: any[] | null): void {
    if (order || this.groupOrder) {
      this.groupOrder = order ? order.slice() : null
      this.query.save()
    }
  }
  getDisplayName(prop: string): string {
    return this.getPropertyConfig(prop).getDisplayName()
  }
  getPropertyConfig(prop: string): PropertyConfig {
    return this.query.getPropertyConfig(prop)
  }
}

export function parseView(query: BaseConfig, v: any, index: number): ViewConfig {
  if (typeof v !== 'object' || v === null) throw new Error(P('msgErrorViewInvalidFormat', { index }))
  const name = v.name
  if (!name || typeof name !== 'string') throw new Error(P('msgErrorViewNameInvalid', { index }))
  const type = v.type
  if (!type) throw new Error(P('msgErrorViewMissingRequiredKey', { key: 'type', viewName: name }))
  if (typeof type !== 'string') throw new Error(P('msgErrorViewIncorrectType', { key: 'type', type: 'string', viewName: name }))
  const view = new ViewConfig(query, type, name)
  for (const k of Object.keys(v)) {
    switch (k) {
      case 'type':
      case 'name':
        break
      case 'filters':
        try {
          view.filters = parseFilter(v.filters)
        } catch (e: any) {
          throw new Error(P('msgErrorViewParsingFilters', { message: e.message, viewName: name }))
        }
        break
      case 'groupBy': {
        const g = v.groupBy
        if (typeof g !== 'object' || g === null || !Object.hasOwn(g, 'property') || !Object.hasOwn(g, 'direction')) throw new Error(P('msgErrorViewIncorrectType', { key: 'groupBy', type: 'object', viewName: name }))
        const { property, direction } = g
        if (property && typeof property === 'string' && (direction === 'ASC' || direction === 'DESC')) view.groupBy = { property: deserializePropertyId(property), direction }
        break
      }
      case 'groupOrder':
        if (Array.isArray(v.groupOrder)) view.groupOrder = v.groupOrder.slice()
        break
      case 'summaries':
        if (typeof v.summaries !== 'object') throw new Error(P('msgErrorViewIncorrectType', { key: 'summaries', type: 'object', viewName: name }))
        view.summaries = {}
        for (const sk of Object.keys(v.summaries)) {
          const sv = v.summaries[sk]
          if (typeof sv !== 'string') throw new Error(P('msgErrorViewIncorrectValueType', { key: 'summaries', type: 'string', viewName: name }))
          view.summaries[deserializePropertyId(sk)] = sv
        }
        break
      case 'order':
        if (!Array.isArray(v.order)) throw new Error(P('msgErrorViewIncorrectType', { key: 'order', type: 'array', viewName: name }))
        view.order = v.order.map(deserializePropertyId)
        break
      case 'sort':
        if (Array.isArray(v.sort)) {
          view.sort = []
          for (const s of v.sort) {
            if (s.column) s.property = s.column
            const { property, direction } = s
            if (property && typeof property === 'string' && (direction === 'ASC' || direction === 'DESC')) view.sort.push({ property: deserializePropertyId(property), direction })
          }
        }
        break
      case 'limit':
        if (typeof v.limit === 'number' && !Number.isNaN(v.limit) && v.limit > 0) view.limit = v.limit
        break
      default:
        if (!view.data) view.data = {}
        view.data[k] = v[k]
    }
  }
  if (!view.groupBy) view.groupOrder = null
  return view
}

// ------------------------------------------------------------------ the base
export class BaseConfig {
  views: ViewConfig[] = []
  unrecognizedData: Record<string, any> = {}
  properties: Record<string, PropertyConfig> = {}
  filters?: FilterNode
  formulas?: Record<string, Formula>
  summaryFormulas?: Record<string, Formula>
  newItemFolder?: string
  newItemTemplate?: string
  saveFn?: ((q: BaseConfig) => void) | null
  file?: any

  static fromString(text: string): BaseConfig {
    if (text.trim() === '') {
      const q = new BaseConfig()
      q.views.push(new ViewConfig(q, 'table', P('labelDefaultView')))
      return q
    }
    return BaseConfig.parse(parseYaml(text))
  }

  static parse(data: any): BaseConfig {
    if (typeof data !== 'object' || data === null) throw new Error(P('msgErrorInvalidQueryFormat'))
    let { views, filters, display, properties, formulas, summaries, newItemFolder, newItemTemplate } = data
    if (views === undefined) views = []
    else if (!Array.isArray(views)) throw new Error(P('msgErrorViewType'))
    const q = new BaseConfig()
    q.views = []
    for (let i = 0; i < views.length; i++) q.views.push(parseView(q, views[i], i + 1))
    if (q.views.length === 0) q.views.push(new ViewConfig(q, 'table', P('labelDefaultView')))
    if (filters) q.filters = parseFilter(filters)
    if (properties) {
      if (typeof properties !== 'object') throw new Error(P('msgErrorInvalidPropertiesSection'))
      for (const k of Object.keys(properties)) {
        const pv = properties[k]
        if (pv != null) {
          if (typeof pv !== 'object') throw new Error(P('msgErrorInvalidPropertiesSection'))
          q.properties[k] = PropertyConfig.deserialize(q, deserializePropertyId(k), pv)
        }
      }
    }
    if (display) {
      if (typeof display !== 'object') throw new Error(P('msgErrorMustBeAType', { key: 'display', type: 'object' }))
      for (const k of Object.keys(display)) {
        if (typeof display[k] !== 'string') throw new Error(P('msgErrorDisplayValues', { key: k }))
        q.getPropertyConfig(deserializePropertyId(k)).migrateDisplayName(display[k])
      }
    }
    q.formulas = {}
    if (formulas) {
      if (typeof formulas !== 'object') throw new Error(P('msgErrorMustBeAType', { key: 'formulas', type: 'object' }))
      for (const k of Object.keys(formulas)) {
        if (typeof formulas[k] !== 'string') throw new Error(P('msgErrorFormulaValues', { key: k }))
        q.formulas[k] = new Formula(formulas[k])
      }
    }
    if (summaries) {
      if (typeof summaries !== 'object') throw new Error(P('msgErrorMustBeAType', { key: 'summaries', type: 'object' }))
      q.summaryFormulas = {}
      for (const k of Object.keys(summaries)) {
        if (typeof summaries[k] !== 'string') throw new Error(P('msgErrorFormulaValues', { key: k }))
        q.summaryFormulas[k] = new Formula(summaries[k])
      }
    }
    if (newItemFolder) {
      if (typeof newItemFolder !== 'string') throw new Error(P('msgErrorMustBeAType', { key: 'newItemFolder', type: 'string' }))
      q.newItemFolder = newItemFolder
    }
    if (newItemTemplate) {
      if (typeof newItemTemplate !== 'string') throw new Error(P('msgErrorMustBeAType', { key: 'newItemTemplate', type: 'string' }))
      q.newItemTemplate = newItemTemplate
    }
    for (const k of Object.keys(data)) {
      switch (k) {
        case 'views': case 'filters': case 'display': case 'properties': case 'formulas': case 'newItemFolder': case 'newItemTemplate':
          continue
        default:
          q.unrecognizedData[k] = data[k]
      }
    }
    return q
  }

  getSerializable(): any {
    const o: any = Object.assign({}, this.unrecognizedData)
    if (this.filters) o.filters = this.filters.serialize()
    if (this.formulas) {
      const keys = Object.keys(this.formulas)
      if (keys.length > 0) {
        o.formulas = {}
        for (const k of keys) o.formulas[k] = this.formulas[k].toString()
      }
    }
    if (this.summaryFormulas) {
      o.summaries = {}
      for (const k of Object.keys(this.summaryFormulas)) o.summaries[k] = this.summaryFormulas[k].toString()
    }
    const props: Record<string, any> = {}
    let none = true
    for (const k of Object.keys(this.properties)) {
      const s = this.properties[k].serialize()
      if (s !== null) {
        none = false
        props[k] = s
      }
    }
    if (!none) o.properties = props
    if (this.views) o.views = this.views.map(v => v.serialize())
    if (this.newItemFolder) o.newItemFolder = this.newItemFolder
    if (this.newItemTemplate) o.newItemTemplate = this.newItemTemplate
    return o
  }
  toString(): string {
    const o = this.getSerializable()
    return Object.keys(o).length > 0 ? stringifyBaseYaml(o) : ''
  }
  clone(): BaseConfig {
    return BaseConfig.parse(this.getSerializable())
  }
  save(): void {
    this.saveFn?.(this)
  }
  setGlobalFilters(f: any): void {
    if (f) this.filters = parseFilter(f)
    else delete this.filters
    this.save()
  }
  setViewFilters(viewName: string, f: any): void {
    const v = this.getViewConfig(viewName)
    if (!v) throw new Error('Invalid view specified')
    if (f) v.filters = parseFilter(f)
    else delete v.filters
    this.save()
  }
  setFormulas(f: Record<string, Formula>): void {
    this.formulas = f
    this.save()
  }
  setSummaryFormula(name: string, f: Formula | null): void {
    if (!this.summaryFormulas && f) this.summaryFormulas = {}
    if (f) this.summaryFormulas![name] = f
    else if (this.summaryFormulas) delete this.summaryFormulas[name]
    this.save()
  }
  deleteSummaryFormula(name: string): void {
    if (this.summaryFormulas) delete this.summaryFormulas[name]
    for (const v of this.views) if (v.summaries) for (const k of Object.keys(v.summaries)) if (v.summaries[k] === name) delete v.summaries[k]
    this.save()
  }
  renameSummaryFormula(from: string, to: string): void {
    if (this.summaryFormulas && Object.hasOwn(this.summaryFormulas, from)) {
      this.summaryFormulas[to] = this.summaryFormulas[from]
      delete this.summaryFormulas[from]
    }
    for (const v of this.views) if (v.summaries) for (const k of Object.keys(v.summaries)) if (v.summaries[k] === from) v.summaries[k] = to
    this.save()
  }
  getPropertyConfig(id: string): PropertyConfig {
    const p = this.properties
    return Object.hasOwn(p, id) ? p[id] : (p[id] = new PropertyConfig(this, id))
  }
  removeFormula(name: string): void {
    if (this.formulas && Object.prototype.hasOwnProperty.call(this.formulas, name)) {
      const id = joinPropertyId('formula', name)
      delete this.formulas[name]
      delete this.properties[id]
      for (const v of this.views) {
        if (v.order) v.order = v.order.filter(x => x !== id)
        if (v.sort) v.sort = v.sort.filter(s => s.property !== id)
        if (v.summaries) delete v.summaries[id]
        if (v.groupBy?.property === id) {
          delete v.groupBy
          delete v.groupOrder
        }
      }
      this.save()
    }
  }
  getViewConfig(name?: string | null): ViewConfig | null {
    if (!name) return this.views[0]
    for (const v of this.views) if (v.name === name) return v
    return null
  }
}

/** The YAML dump used for `.base` files (same options as frontmatter writing). */
export function stringifyBaseYaml(o: unknown): string {
  return stringifyYaml(o, null as any, { nullStr: '', lineWidth: 0, aliasDuplicateObjects: false } as any)
}
