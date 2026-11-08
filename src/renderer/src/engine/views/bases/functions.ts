/* eslint-disable @typescript-eslint/no-explicit-any */
// The Bases function library: global functions plus per-type instance functions,
// registered in a registry that the plugin API (`registerGlobalFunc`) can extend.
import { moment } from '../../ui/moment'
import { bt } from './strings'
import {
  Value, NotNullValue, NullValue, NULL, StringValue, NumberValue, BooleanValue, ListValue, ObjectValue, RegExpValue, DateValue, RelativeDateValue,
  DurationValue, FileValue, LinkValue, UrlValue, ImageValue, HTMLValue, IconValue, TagValue, stripSubpath
} from './values'

export interface ParamDef { name: string; type: any[]; optional?: boolean; variadic?: boolean; customWidget?: string }
const P = (name: string, ...type: any[]): ParamDef => ({ name, type })
const OPT = (name: string, ...type: any[]): ParamDef => ({ name, type, optional: true })
const VAR = (name: string, ...type: any[]): ParamDef => ({ name, type, variadic: true })

export interface FuncCtx { app: any }
export abstract class FunctionDef {
  ctx: FuncCtx | null = null
  abstract name: string
  abstract params: ParamDef[]
  docKey = ''
  get docString(): string {
    return this.docKey ? bt('formulas.funcs.' + this.docKey) : ''
  }
  abstract apply(...args: any[]): Value | null
  applyWithContext(ctx: FuncCtx, ...args: any[]): Value | null {
    this.ctx = ctx
    try {
      return this.apply(...args)
    } finally {
      this.ctx = null
    }
  }
  serialize(...args: string[]): string {
    return `${this.name}(${args.join(', ')})`
  }
}
class Fn extends FunctionDef {
  constructor(public name: string, public params: ParamDef[], docKey: string, private fn: (this: Fn, ...a: any[]) => Value | null, private bool = false) {
    super()
    this.docKey = docKey
  }
  apply(...args: any[]): Value | null {
    const r = this.fn.apply(this, args)
    return this.bool ? new BooleanValue(!!r) : (r as Value | null)
  }
  serialize(...args: string[]): string {
    return this.params[0]?.name === 'self' && this.fn.length >= 0 && this.isInstance ? `${args[0]}.${this.name}(${args.slice(1).join(', ')})` : `${this.name}(${args.join(', ')})`
  }
  isInstance = false
}

export class FunctionRegistry {
  global: Record<string, FunctionDef> = {}
  instance = new Map<any, Record<string, FunctionDef>>()
  addForType(type: any, fn: FunctionDef): void {
    let m = this.instance.get(type)
    if (!m) this.instance.set(type, (m = {}))
    m[fn.name.toLowerCase()] = fn
    ;(fn as any).isInstance = true
  }
  removeForType(type: any, name: string): void {
    const m = this.instance.get(type)
    if (m) delete m[name.toLowerCase()]
  }
  addGlobal(fn: FunctionDef): void {
    this.global[fn.name.toLowerCase()] = fn
  }
  removeGlobal(name: string): void {
    delete this.global[name.toLowerCase()]
  }
  getAllForValue(v: Value): Record<string, FunctionDef> {
    let out: Record<string, FunctionDef> = {}
    for (let t: any = v.type; t; t = Object.getPrototypeOf(t)) {
      const m = this.instance.get(t)
      if (m) out = { ...m, ...out }
      if (t === Value) break
    }
    return out
  }
  findForValue(v: Value, name: string): FunctionDef | null {
    const n = name.toLowerCase()
    for (let t: any = v.type; t; t = Object.getPrototypeOf(t)) {
      const m = this.instance.get(t)
      if (m && Object.hasOwn(m, n)) return m[n]
      if (t === Value) break
    }
    return null
  }
  getAllGlobal(): FunctionDef[] {
    return Object.values(this.global)
  }
  findGlobal(name: string): FunctionDef | null {
    const n = name.toLowerCase()
    return Object.hasOwn(this.global, n) ? this.global[n] : null
  }
}
export const registry = new FunctionRegistry()

const g = (name: string, params: ParamDef[], doc: string, fn: (this: Fn, ...a: any[]) => Value | null): void => registry.addGlobal(new Fn(name, params, doc, fn))
const i = (type: any, name: string, params: ParamDef[], doc: string, fn: (this: Fn, ...a: any[]) => Value | null): void => registry.addForType(type, new Fn(name, params, doc, fn))
const ib = (type: any, name: string, params: ParamDef[], doc: string, fn: (this: Fn, ...a: any[]) => any): void => registry.addForType(type, new Fn(name, params, doc, fn as any, true))

const app = (f: Fn): any => f.ctx!.app

// ------------------------------------------------------------------ global
g('now', [], 'labelGlobalNow', () => new DateValue(new Date(), true))
g('today', [], 'labelGlobalToday', () => new DateValue(new Date()).dateOnly())
g('date', [P('input', StringValue, DateValue)], 'labelGlobalDate', (e: Value) => {
  if (e instanceof DateValue) return e
  const s = (e as StringValue).value
  const t = DateValue.parseFromString(s)
  if (t) return t
  if (/^\d{12}$/.test(s)) return new DateValue(new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)), true)
  if (/^\d{8}$/.test(s)) return new DateValue(new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)), false)
  return NULL
})
g('if', [P('condition', BooleanValue), P('true_result', Value), OPT('false_result', Value)], 'labelGlobalIf', (c: Value, t: Value, f: Value | null) => ((c as any).value ? t : f || NULL))
g('random', [], 'labelGlobalRandom', () => new NumberValue(Math.random()))
g('min', [VAR('inputs', NumberValue)], 'labelGlobalMin', (...a: Value[]) => {
  const n = a.filter(Boolean).map(x => (x as NumberValue).value)
  return n.length === 0 ? null : new NumberValue(Math.min(...n))
})
g('max', [VAR('inputs', NumberValue)], 'labelGlobalMax', (...a: Value[]) => {
  const n = a.filter(Boolean).map(x => (x as NumberValue).value)
  return n.length === 0 ? null : new NumberValue(Math.max(...n))
})
g('list', [P('self', NotNullValue)], 'labelGlobalList', (e: Value) => (e instanceof ListValue ? e : new ListValue([e])))
g('link', [P('self', StringValue, FileValue), OPT('display', Value)], 'labelGlobalLink', function (e: Value, d: Value | null) {
  if (e instanceof UrlValue || (e instanceof StringValue && isUrl(e.value))) return new UrlValue((e as StringValue).value, d)
  if (e instanceof FileValue) return new LinkValue(app(this), e.file.path, '', d)
  const l = LinkValue.parseFromString(app(this), (e as StringValue).value, '')
  return l || new LinkValue(app(this), (e as StringValue).value, '', d)
})
g('number', [P('input', NotNullValue)], 'labelGlobalNumber', (e: Value) => {
  if (e instanceof NumberValue) return e
  if (e instanceof StringValue) {
    const n = parseFloat(e.value)
    if (isNaN(n)) throw new Error(`Unable to parse "${e.value}" as a number.`)
    return new NumberValue(n)
  }
  if (e instanceof BooleanValue) return new NumberValue(e.value ? 1 : 0)
  if (e instanceof DateValue) return new NumberValue(e.date.getTime())
  throw new Error(`Unable to convert "${e.constructor.toString()}" to a number.`)
})
g('duration', [P('input', StringValue)], 'labelGlobalDuration', (e: StringValue) => DurationValue.parseFromString(e.value) ?? NULL)
g('image', [P('input', StringValue, FileValue, LinkValue, UrlValue)], 'labelGlobalImage', function (e: Value) {
  if (e instanceof LinkValue) {
    const f = e.resolve()
    return f ? new ImageValue(f.path) : NULL
  }
  if (e instanceof StringValue || e instanceof UrlValue) return new ImageValue((e as StringValue).value)
  if (e instanceof FileValue) return new ImageValue(e.file.path)
  return NULL
})
g('icon', [P('input', StringValue)], 'labelGlobalIcon', (e: StringValue) => new IconValue(e.value))
g('file', [P('input', StringValue, LinkValue, FileValue)], 'labelGlobalFile', function (e: Value) {
  if (e instanceof FileValue) return e
  let f: any = null
  if (e instanceof LinkValue) f = e.resolve()
  else if (e instanceof StringValue) f = app(this).metadataCache.getFirstLinkpathDest(stripSubpath(e.value), '')
  return f ? new FileValue(app(this), f) : NULL
})
g('html', [P('input', StringValue)], 'labelGlobalHtml', (e: StringValue) => new HTMLValue(e.value))
g('escapeHTML', [P('input', StringValue)], 'labelGlobalEscapeHtml', (e: StringValue) => new StringValue(e.value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)))

function isUrl(s: string): boolean {
  if (!s) return false
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ any / null
i(Value, 'toString', [P('self', Value)], 'labelValueToString', (e: Value) => new StringValue(e.toString()))
i(Value, 'isTruthy', [P('self', Value)], 'labelValueIsTruthy', (e: Value) => new BooleanValue(e.isTruthy()))
i(Value, 'isType', [P('self', Value), P('type', StringValue)], 'labelValueIsType', (e: Value, t: StringValue) => {
  const n = t.value.toLowerCase()
  for (let c: any = e.type; c; c = Object.getPrototypeOf(c)) {
    if (c.toString().toLowerCase() === n) return new BooleanValue(true)
    if (c === Value) break
  }
  return new BooleanValue(false)
})
ib(NullValue, 'isEmpty', [P('self', NullValue)], 'labelNullIsEmpty', () => true)

// ------------------------------------------------------------------ string
ib(StringValue, 'startsWith', [P('self', StringValue), P('query', StringValue)], 'labelStringStartsWith', (e: StringValue, q: StringValue) => e.value.startsWith(q.value))
ib(StringValue, 'endsWith', [P('self', StringValue), P('query', StringValue)], 'labelStringEndsWith', (e: StringValue, q: StringValue) => e.value.endsWith(q.value))
i(StringValue, 'trim', [P('self', StringValue)], 'labelStringTrim', (e: StringValue) => {
  const t = e.value.trim()
  return t === e.value ? e : new StringValue(t)
})
i(StringValue, 'title', [P('self', StringValue)], 'labelStringTitle', (e: StringValue) => new StringValue(e.value.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')))
ib(StringValue, 'isEmpty', [P('self', StringValue)], 'labelStringIsEmpty', (e: StringValue) => e.value.length === 0)
i(StringValue, 'replace', [P('value', StringValue), P('pattern', StringValue, RegExpValue), P('replacement', StringValue)], 'labelStringReplace', (e: StringValue, p: Value, r: StringValue) =>
  p instanceof RegExpValue ? new StringValue(e.value.replace(p.regexp, r.value)) : (p as StringValue).value === '' ? e : new StringValue(e.value.split((p as StringValue).value).join(r.value))
)
i(StringValue, 'reverse', [P('self', StringValue)], 'labelStringReverse', (e: StringValue) => new StringValue(e.value.split('').reverse().join('')))
i(StringValue, 'lower', [P('self', StringValue)], 'labelStringLower', (e: StringValue) => new StringValue(e.value.toLowerCase()))
i(StringValue, 'split', [P('self', StringValue), P('separator', StringValue, RegExpValue), OPT('n', NumberValue)], 'labelStringSplit', (e: StringValue, s: Value, n: NumberValue | null) => {
  const sep: any = s instanceof StringValue ? s.value : (s as RegExpValue).regexp
  return new ListValue(n ? e.value.split(sep, n.value) : e.value.split(sep))
})
ib(StringValue, 'contains', [P('self', StringValue), P('value', StringValue)], 'labelStringContains', (e: StringValue, v: StringValue) => v.value !== '' && e.value.toLowerCase().includes(v.value.toLowerCase()))
ib(StringValue, 'containsAny', [P('self', StringValue), VAR('values', StringValue)], 'labelStringContainsAny', (e: StringValue, ...v: StringValue[]) => {
  const l = e.value.toLowerCase()
  return v.some(x => l.includes(x.value.toLowerCase()))
})
ib(StringValue, 'containsAll', [P('self', StringValue), VAR('values', StringValue)], 'labelStringContainsAll', (e: StringValue, ...v: StringValue[]) => {
  const l = e.value.toLowerCase()
  return v.every(x => l.includes(x.value.toLowerCase()))
})
i(StringValue, 'slice', [P('self', StringValue), P('start', NumberValue), OPT('end', NumberValue)], 'labelStringSlice', (e: StringValue, s: NumberValue, n: NumberValue | null) => new StringValue(e.value.slice(s.value, n ? n.value : undefined)))
i(StringValue, 'repeat', [P('self', StringValue), P('count', NumberValue)], 'labelStringRepeat', (e: StringValue, c: NumberValue) => new StringValue(e.value.repeat(c.value)))
ib(TagValue, 'matches', [P('self', TagValue), P('value', StringValue)], 'labelTagMatches', (e: TagValue, v: StringValue) => e.tagMatches(v))

// ------------------------------------------------------------------ number
i(NumberValue, 'round', [P('self', NumberValue), OPT('digits', NumberValue)], 'labelNumberRound', (e: NumberValue, d: NumberValue | null) => {
  if (d && d.value > 0) {
    const m = Math.pow(10, d.value)
    return new NumberValue(Math.round(e.value * m) / m)
  }
  return new NumberValue(Math.round(e.value))
})
for (const [n, f] of [['ceil', Math.ceil], ['floor', Math.floor], ['abs', Math.abs]] as const) {
  i(NumberValue, n, [P('self', NumberValue)], 'labelNumber' + n[0].toUpperCase() + n.slice(1), (e: NumberValue) => new NumberValue(f(e.value)))
}
i(NumberValue, 'toFixed', [P('self', NumberValue), P('precision', NumberValue)], 'labelNumberToFixed', (e: NumberValue, p: NumberValue) => new StringValue(e.value.toFixed(p.value)))
ib(NumberValue, 'isEmpty', [P('self', NumberValue)], 'labelNumberIsEmpty', () => false)

// ------------------------------------------------------------------ list
ib(ListValue, 'isEmpty', [P('self', ListValue)], 'labelListIsEmpty', (e: ListValue) => e.length() === 0)
const L = (name: string, doc: string, f: (l: ListValue) => Value): void => i(ListValue, name, [P('self', ListValue)], doc, f)
L('earliest', 'labelListEarliestLatest', l => l.earliest())
L('latest', 'labelListEarliestLatest', l => l.latest())
L('median', 'labelListMedian', l => l.median())
L('mean', 'labelListMean', l => l.mean())
L('max', 'labelListMinMax', l => l.max())
L('min', 'labelListMinMax', l => l.min())
L('sum', 'labelListSum', l => l.sum())
L('stddev', 'labelListStdDev', l => l.stddev())
i(ListValue, 'join', [P('self', ListValue), P('separator', StringValue)], 'labelListJoin', (l: ListValue, s: StringValue) => l.join(s.value))
L('reverse', 'labelListReverse', l => l.reverse())
L('flat', 'labelListFlat', l => l.flatten())
L('unique', 'labelListUnique', l => l.unique())
ib(ListValue, 'contains', [P('self', ListValue), { name: 'value', type: [Value], customWidget: 'text' }], 'labelListContains', (l: ListValue, v: Value) => l.includes(v))
ib(ListValue, 'containsAny', [P('self', ListValue), VAR('values', Value)], 'labelListContainsAny', (l: ListValue, ...v: Value[]) => {
  if (v.length === 1 && v[0] instanceof ListValue) {
    const o = v[0] as ListValue
    for (let k = 0; k < o.length(); k++) if (l.includes(o.get(k))) return true
    return false
  }
  return v.some(x => l.includes(x))
})
ib(ListValue, 'containsAll', [P('self', ListValue), VAR('values', Value)], 'labelListContainsAll', (l: ListValue, ...v: Value[]) => {
  if (v.length === 1 && v[0] instanceof ListValue) {
    const o = v[0] as ListValue
    for (let k = 0; k < o.length(); k++) if (!l.includes(o.get(k))) return false
    return true
  }
  return v.every(x => l.includes(x))
})
i(ListValue, 'slice', [P('self', ListValue), P('start', NumberValue), OPT('end', NumberValue)], 'labelListSlice', (l: ListValue, s: NumberValue, e: NumberValue | null) => l.slice(s.value, e ? e.value : undefined))
L('sort', 'labelListSort', l => l.sort())
// map/filter/reduce are evaluated with lambda scopes by the call node; these entries carry the signature.
i(ListValue, 'map', [P('self', ListValue), P('value', Value)], 'labelListMap', (l: ListValue) => l)
i(ListValue, 'filter', [P('self', ListValue), P('value', BooleanValue)], 'labelListFilter', (l: ListValue) => l)
i(ListValue, 'reduce', [P('self', ListValue), P('value', Value), P('acc', Value)], 'labelListReduce', (l: ListValue) => l)

// ------------------------------------------------------------------ object
ib(ObjectValue, 'isEmpty', [P('self', ObjectValue)], 'labelObjectIsEmpty', (o: ObjectValue) => o.isEmpty())
i(ObjectValue, 'keys', [P('self', ObjectValue)], 'labelObjectKeys', (o: ObjectValue) => new ListValue(o.keys()))
i(ObjectValue, 'values', [P('self', ObjectValue)], 'labelObjectValues', (o: ObjectValue) => new ListValue(o.valuesRaw()))
i(ObjectValue, 'map', [P('self', ObjectValue), P('value', Value)], 'labelObjectMap', (o: ObjectValue) => new ListValue(o.valuesRaw()))
i(ObjectValue, 'filter', [P('self', ObjectValue), P('value', BooleanValue)], 'labelObjectFilter', (o: ObjectValue) => o)

// ------------------------------------------------------------------ regexp / date
ib(RegExpValue, 'matches', [P('self', RegExpValue), P('value', StringValue)], 'labelRegExpMatches', (r: RegExpValue, v: StringValue) => r.regexp.test(v.value))
i(DateValue, 'format', [P('self', DateValue), P('format', StringValue)], 'labelDateFormat', (d: DateValue, f: StringValue) => new StringValue(moment(d.date).format(f.value)))
i(DateValue, 'date', [P('self', DateValue)], 'labelDateDate', (d: DateValue) => (d.time ? d.dateOnly() : d))
i(DateValue, 'time', [P('self', DateValue)], 'labelDateTime', (d: DateValue) => new StringValue(d.printTime()))
i(DateValue, 'relative', [P('self', DateValue)], 'labelDateRelative', (d: DateValue) => new RelativeDateValue(d.date, d.time))
ib(DateValue, 'isEmpty', [P('self', DateValue)], 'labelDateIsEmpty', () => false)

// ------------------------------------------------------------------ file / link
i(FileValue, 'asLink', [P('self', FileValue), OPT('display', Value)], 'labelFileAsLink', function (f: FileValue, d: Value | null) {
  return new LinkValue(app(this), f.file.path, '', d)
})
ib(FileValue, 'hasLink', [P('self', FileValue), { name: 'dest', type: [FileValue, LinkValue, StringValue], customWidget: 'file' }], 'labelFileHasLink', function (f: FileValue, dest: Value) {
  let target: any
  let path: string
  if (dest instanceof FileValue) {
    target = dest.file
    path = dest.file.path
  } else if (dest instanceof LinkValue) {
    target = dest.resolve()
    path = target ? target.path : dest.value
  } else {
    target = app(this).metadataCache.getFirstLinkpathDest(stripSubpath((dest as StringValue).value), '')
    path = (dest as StringValue).value
  }
  const links = f.getLinks()
  for (let k = 0; k < links.length(); k++) {
    const l = links.get(k)
    if (l instanceof LinkValue) {
      if (target && l.resolve() === target) return true
      if (!target && l.value === path) return true
    }
  }
  return false
})
ib(FileValue, 'inFolder', [P('self', FileValue), { name: 'folder', type: [StringValue], customWidget: 'folder' }], 'labelFileInFolder', (f: FileValue, folder: StringValue) => {
  const n = normalizeFolder(folder.value)
  return n === '/' || f.file.path.startsWith(n + '/')
})
ib(FileValue, 'hasTag', [P('self', FileValue), { name: 'values', type: [StringValue], variadic: true, customWidget: 'tags' }], 'labelFileHasTag', (f: FileValue, ...vals: StringValue[]) => {
  const q = vals.map(v => new TagValue(v.value))
  const tags = f.getTags()
  for (let k = 0; k < tags.length(); k++) for (const x of q) if ((tags.get(k) as TagValue).tagMatches(x)) return true
  return false
})
ib(FileValue, 'hasProperty', [P('self', FileValue), { name: 'property', type: [StringValue], customWidget: 'property' }], 'labelFileHasProperty', (f: FileValue, p: StringValue) => f.getProps().keys().includes(p.value))
ib(LinkValue, 'linksTo', [P('self', LinkValue), P('file', FileValue)], 'labelLinkLinksTo', function (l: LinkValue, f: FileValue) {
  return app(this).metadataCache.getFirstLinkpathDest(l.value, '') === f.file
})
i(LinkValue, 'asFile', [P('self', LinkValue)], 'labelLinkAsFile', function (l: LinkValue) {
  const f = l.resolve()
  return f ? new FileValue(app(this), f) : NULL
})

function normalizeFolder(p: string): string {
  let s = p.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '')
  if (s === '') s = '/'
  return s.replace(/ | /g, ' ').normalize('NFC')
}
