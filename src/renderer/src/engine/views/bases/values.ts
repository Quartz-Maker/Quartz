/* eslint-disable @typescript-eslint/no-explicit-any */
// Bases typed values (the `obsidian` module's Value classes):
// strings/numbers/booleans/dates/durations/lists/objects/links/files/regexps/null/errors.
import { moment } from '../../ui/moment'

const collator = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true })
export const compareNatural = (a: any, b: any): number => collator.compare(a, b)

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}
/** Case-insensitive key lookup: exact key, else the first key equal ignoring case, else the input. */
export function insensitiveKey(o: object, k: string): string {
  if (hasOwn(o, k)) return k
  const l = k.toLowerCase()
  for (const x of Object.keys(o)) if (x.toLowerCase() === l) return x
  return k
}
const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
export const printDate = (d: Date): string => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const printTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

export interface RenderContext {
  app: any
  renderFileLink(target: any, display: any, el: HTMLElement): void
  renderExternalLink(url: string, display: any, el: HTMLElement): void
  renderTag(tag: string, el: HTMLElement): void
  [k: string]: any
}

export abstract class Value {
  static type = 'Any'
  static toString(): string {
    return this.type
  }
  icon = ''
  static equals(a: Value | null, b: Value | null): boolean {
    return a === b || (!!a && !!b && a.constructor === b.constructor && a.equals(b))
  }
  static looseEquals(a: Value | null, b: Value | null): boolean {
    if (a === b) return true
    if (!a || !b) return false
    if (a.constructor === b.constructor && a.equals(b)) return true
    return a.looseEquals(b) || b.looseEquals(a)
  }
  abstract toString(): string
  abstract isTruthy(): boolean
  equals(_other: any): boolean {
    return false
  }
  looseEquals(_other: any): boolean {
    return false
  }
  renderTo(el: HTMLElement, _ctx?: RenderContext): void {
    el.setText(this.toString())
  }
  keys(): string[] {
    return []
  }
  get type(): any {
    return this.constructor
  }
  objectAccess(_key: string): Value | null {
    return null
  }
}

export class ErrorValue extends Value {
  static type = 'Error'
  message: string
  constructor(e?: any) {
    super()
    this.icon = 'lucide-alert-triangle'
    this.message = e ? (e instanceof Error || e instanceof ErrorValue ? e.message : String(e)) : ''
  }
  toString(): string {
    return 'Error: ' + this.message
  }
  isTruthy(): boolean {
    return false
  }
  equals(o: any): boolean {
    return o.message === this.message
  }
  renderTo(el: HTMLElement): void {
    const box = el.createDiv('bases-formula-error')
    box.createDiv('warning-icon')
    box.createDiv({ text: this.message, cls: 'bases-formula-error-message' })
    box.setAttr('title', this.message)
  }
}

export class NullValue extends Value {
  static type = 'Null'
  static value: NullValue
  constructor() {
    super()
    if (NullValue.value) throw new Error('Use NullValue.value instead of creating a new NullValue.')
  }
  toString(): string {
    return 'null'
  }
  isTruthy(): boolean {
    return false
  }
  equals(): boolean {
    return true
  }
  renderTo(): void {
    /* empty */
  }
}
NullValue.value = new NullValue()
export const NULL = NullValue.value

export abstract class NotNullValue extends Value {}

export class PrimitiveValue<T = any> extends NotNullValue {
  value: T
  constructor(value: T) {
    super()
    this.value = value
  }
  /** Internal alias used by builtin functions. */
  get data(): T {
    return this.value
  }
  toString(): string {
    return String(this.value)
  }
  isTruthy(): boolean {
    return !!this.value
  }
  equals(o: any): boolean {
    return this.value === o.value
  }
  looseEquals(o: any): boolean {
    // eslint-disable-next-line eqeqeq
    return o instanceof PrimitiveValue && (this.value as any) == o.value
  }
}

export class StringValue extends PrimitiveValue<string> {
  static type = 'String'
  constructor(v: string) {
    super(v)
    this.icon = 'lucide-text'
  }
  toString(): string {
    return this.value
  }
  keys(): string[] {
    return super.keys().concat(['length'])
  }
  objectAccess(k: string): Value | null {
    return k.toLowerCase() === 'length' ? new NumberValue(this.value.length) : super.objectAccess(k)
  }
  renderTo(el: HTMLElement): void {
    el.setText(this.value)
  }
}
export class NumberValue extends PrimitiveValue<number> {
  static type = 'Number'
  constructor(v: number) {
    super(v)
    this.icon = 'lucide-binary'
  }
  renderTo(el: HTMLElement): void {
    el.setText(isFinite(this.value) || isNaN(this.value) ? this.toString() : '∞')
  }
}
export class BooleanValue extends PrimitiveValue<boolean> {
  static type = 'Boolean'
  constructor(v: boolean) {
    super(v)
    this.icon = 'lucide-check-square'
  }
  isTruthy(): boolean {
    return this.value
  }
  renderTo(el: HTMLElement): void {
    const i = el.createEl('input', { type: 'checkbox', attr: { disabled: true } }) as HTMLInputElement
    i.checked = this.value
  }
}

export class UrlValue extends StringValue {
  static type = 'URL'
  display: any
  constructor(v: string, display?: any) {
    super(v)
    this.icon = 'lucide-link'
    this.display = display ?? null
  }
  equals(o: any): boolean {
    return this.value === o.value && Value.equals(this.display, o.display)
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    if (ctx) ctx.renderExternalLink(this.value, this.display, el)
    else el.setText(this.value)
  }
}
export class ImageValue extends StringValue {
  static type = 'Image'
  constructor(v: string) {
    super(v)
    this.icon = 'lucide-image'
  }
  toString(): string {
    return isInternalPath(this.value) ? `![[${this.value}]]` : `![](${this.value})`
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    if (isInternalPath(this.value)) {
      const f = ctx?.app.metadataCache.getFirstLinkpathDest(this.value, '')
      if (f && ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(f.extension)) {
        const img = el.createEl('img') as HTMLImageElement
        img.src = ctx!.app.vault.getResourcePath(f)
      }
    } else {
      const img = el.createEl('img') as HTMLImageElement
      img.src = this.value
    }
  }
}
export class HTMLValue extends StringValue {
  static type = 'HTML'
  constructor(v: string) {
    super(v)
    this.icon = 'lucide-code-2'
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    el.innerHTML = sanitizeHtml(this.value)
    ctx?.app.fixFileLinks?.(el, '')
  }
}
export class IconValue extends StringValue {
  constructor(v: string) {
    super(v)
    this.icon = 'lucide-image'
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    ctx?.renderIcon?.(this.value, el)
  }
}
let sanitizer: ((s: string) => string) | null = null
export function setHtmlSanitizer(fn: (s: string) => string): void {
  sanitizer = fn
}
function sanitizeHtml(s: string): string {
  return sanitizer ? sanitizer(s) : s.replace(/<script[\s\S]*?<\/script>/gi, '')
}
export function isInternalPath(p: string): boolean {
  return p.startsWith('./') || p.startsWith('../') || p.indexOf(':') === -1
}
function isUrl(s: string): boolean {
  if (!s) return false
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

export class RegExpValue extends NotNullValue {
  static type = 'RegExp'
  regexp: RegExp
  constructor(r: RegExp) {
    super()
    this.icon = 'lucide-regex'
    this.regexp = r
  }
  toString(): string {
    return this.regexp.toString()
  }
  isTruthy(): boolean {
    return true
  }
}

const hasTime = (v: Value): boolean => v instanceof DateValue && v.time
export class DateValue extends NotNullValue {
  static type = 'Date'
  date: Date
  time: boolean
  constructor(date: Date, time = true) {
    super()
    this.date = date
    this.time = time
    this.icon = time ? 'lucide-clock' : 'lucide-calendar'
  }
  toString(): string {
    return this.time ? `${printDate(this.date)}T${printTime(this.date)}` : printDate(this.date)
  }
  printDate(): string {
    return printDate(this.date)
  }
  printTime(): string {
    return printTime(this.date)
  }
  dateOnly(): DateValue {
    return this.time ? new DateValue(new Date(this.printDate() + 'T00:00:00'), false) : this
  }
  relative(): string {
    return moment(this.date).fromNow()
  }
  isTruthy(): boolean {
    return true
  }
  equals(o: any): boolean {
    return this.time === o.time && this.date.getTime() === o.date.getTime()
  }
  looseEquals(o: any): boolean {
    if (o instanceof StringValue) {
      const p = DateValue.parseFromString(o.value)
      if (p) o = p
    }
    if (!(o instanceof DateValue)) return false
    return this.time && o.time ? this.date.getTime() === o.date.getTime() : this.dateOnly().date.getTime() === o.dateOnly().date.getTime()
  }
  keys(): string[] {
    return super.keys().concat(['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond', 'timestamp'])
  }
  objectAccess(k: string): Value | null {
    const d = this.date
    switch (k.toLowerCase()) {
      case 'year': return new NumberValue(d.getFullYear())
      case 'month': return new NumberValue(d.getMonth() + 1)
      case 'day': return new NumberValue(d.getDate())
      case 'hour': return new NumberValue(d.getHours())
      case 'minute': return new NumberValue(d.getMinutes())
      case 'second': return new NumberValue(d.getSeconds())
      case 'millisecond': return new NumberValue(d.getMilliseconds())
      case 'timestamp': return new NumberValue(d.getTime())
    }
    return super.objectAccess(k)
  }
  renderTo(el: HTMLElement): void {
    el.setText(moment(this.date).format(this.time ? 'L LT' : 'L'))
  }
  static parseFromString(s: string): DateValue | null {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(s)) return new DateValue(new Date(s), true)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new DateValue(new Date(s + 'T00:00:00'), false)
    return null
  }
}
export class RelativeDateValue extends DateValue {
  toString(): string {
    return this.relative()
  }
  renderTo(el: HTMLElement): void {
    el.createSpan(this.time ? 'mod-datetime' : 'mod-date').setText(this.relative())
  }
}

export class DurationValue extends NotNullValue {
  static type = 'Duration'
  constructor(public years: number, public months: number, public days: number, public hours: number, public minutes: number, public seconds: number, public milliseconds: number) {
    super()
    this.icon = 'lucide-calendar-range'
  }
  toString(): string {
    const { years, months, days, hours, minutes, seconds, milliseconds } = this
    return moment.duration({ years, months, days, hours, minutes, seconds, milliseconds }).humanize()
  }
  isTruthy(): boolean {
    return this.years !== 0 || this.months !== 0 || this.days !== 0 || this.hours !== 0 || this.minutes !== 0 || this.seconds !== 0 || this.milliseconds !== 0
  }
  equals(o: any): boolean {
    return this.years === o.years && this.months === o.months && this.days === o.days && this.hours === o.hours && this.minutes === o.minutes && this.seconds === o.seconds && this.milliseconds === o.milliseconds
  }
  looseEquals(o: any): boolean {
    if (o instanceof StringValue) {
      const p = DurationValue.parseFromString(o.value)
      if (p) o = p
    }
    return o instanceof DurationValue && this.getMilliseconds() === o.getMilliseconds()
  }
  addToDate(d: DateValue, subtract = false): DateValue {
    const n = subtract ? -1 : 1
    const out = new Date(d.date)
    let time = d.time
    if (this.years !== 0) out.setFullYear(out.getFullYear() + n * this.years)
    if (this.months !== 0) out.setMonth(out.getMonth() + n * this.months)
    if (this.days !== 0) out.setDate(out.getDate() + n * this.days)
    if (this.hours !== 0) { out.setHours(out.getHours() + n * this.hours); time = true }
    if (this.minutes !== 0) { out.setMinutes(out.getMinutes() + n * this.minutes); time = true }
    if (this.seconds !== 0) { out.setSeconds(out.getSeconds() + n * this.seconds); time = true }
    if (this.milliseconds !== 0) { out.setMilliseconds(out.getMilliseconds() + n * this.milliseconds); time = true }
    return new DateValue(out, time)
  }
  getMilliseconds(): number {
    const now = new DateValue(new Date())
    return this.addToDate(now).date.getTime() - now.date.getTime()
  }
  keys(): string[] {
    return super.keys().concat(['years', 'months', 'days', 'weeks', 'hours', 'minutes', 'seconds', 'milliseconds'])
  }
  objectAccess(k: string): Value | null {
    const unit = k.toLowerCase()
    switch (unit) {
      case 'years': case 'months': case 'weeks': case 'days': case 'hours': case 'minutes': case 'seconds': case 'milliseconds': {
        const base = new DateValue(new Date())
        const end = this.addToDate(base)
        return new NumberValue(moment(end.date).diff(base.date, unit as any, true))
      }
    }
    return super.objectAccess(k)
  }
  static parseFromString(s: string): DurationValue | null {
    const iso = s.match(/P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/)
    if (iso) {
      const n = (x?: string): number => (x === undefined ? 0 : parseInt(x))
      return new DurationValue(n(iso[1]), n(iso[2]), 7 * n(iso[3]) + n(iso[4]), n(iso[5]), n(iso[6]), n(iso[7]), 0)
    }
    const m = s.match(/^(-?\d+) ?([dhmswMy]|(?:second|minute|hour|day|week|month|year)[s]?)$/)
    if (m) {
      const a = m[2]
      const v = parseFloat(m[1])
      if (a === 'y' || a === 'year' || a === 'years') return new DurationValue(v, 0, 0, 0, 0, 0, 0)
      if (a === 'M' || a === 'month' || a === 'months') return new DurationValue(0, v, 0, 0, 0, 0, 0)
      if (a === 'w' || a === 'week' || a === 'weeks') return new DurationValue(0, 0, 7 * v, 0, 0, 0, 0)
      if (a === 'd' || a === 'day' || a === 'days') return new DurationValue(0, 0, v, 0, 0, 0, 0)
      if (a === 'h' || a === 'hour' || a === 'hours') return new DurationValue(0, 0, 0, v, 0, 0, 0)
      if (a === 'm' || a === 'minute' || a === 'minutes') return new DurationValue(0, 0, 0, 0, v, 0, 0)
      if (a === 's' || a === 'second' || a === 'seconds') return new DurationValue(0, 0, 0, 0, 0, v, 0)
    }
    return null
  }
  static fromMilliseconds(ms: number): DurationValue {
    return new DurationValue(0, 0, 0, 0, 0, 0, ms)
  }
}

export class ListValue extends NotNullValue {
  static type = 'List'
  value: any[]
  lazyEvaluator: (key: any, raw: any) => Value = (_k, raw) => toValue(raw)
  constructor(value: any[] = []) {
    super()
    this.icon = 'lucide-list'
    this.value = value
  }
  get data(): any[] {
    return this.value
  }
  getNumbers(): number[] {
    const out: number[] = []
    for (const v of this.value) {
      if (typeof v === 'number' && !Number.isNaN(v)) out.push(v)
      else if (v instanceof NumberValue) out.push(v.value)
    }
    return out
  }
  getDates(): Date[] {
    const out: Date[] = []
    for (const v of this.value) {
      let d: DateValue | null = null
      if (typeof v === 'string') d = DateValue.parseFromString(v)
      else if (v instanceof StringValue) d = DateValue.parseFromString(v.value)
      else if (v instanceof DateValue) d = v
      if (d) out.push(d.date)
    }
    return out
  }
  toString(): string {
    return this.join(', ').value
  }
  isTruthy(): boolean {
    return this.value.length > 0
  }
  includes(v: Value): boolean {
    for (let i = 0; i < this.value.length; i++) if (Value.looseEquals(v, this.get(i))) return true
    return false
  }
  private compare(o: ListValue, f: (a: Value | null, b: Value | null) => boolean): boolean {
    const a = this.value
    const b = o.value
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !f(this.get(i), o.get(i))) return false
    return true
  }
  equals(o: any): boolean {
    return this.compare(o, Value.equals)
  }
  looseEquals(o: any): boolean {
    return o instanceof ListValue ? this.compare(o, Value.looseEquals) : this.value.length === 1 && Value.looseEquals(this.get(0), o)
  }
  length(): number {
    return this.value.length
  }
  get(i: number): Value {
    const v = this.value[i]
    if (v === null || v === undefined) return NULL
    if (v instanceof Value) return v
    return (this.value[i] = this.lazyEvaluator(i, v))
  }
  slice(s?: number, e?: number): ListValue {
    return new ListValue(this.value.slice(s, e))
  }
  reverse(): ListValue {
    return new ListValue(this.value.slice().reverse())
  }
  flatten(): ListValue {
    const out: any[] = []
    const walk = (a: any[]): void => {
      for (const x of a) {
        if (x instanceof ListValue) walk(x.value)
        else if (Array.isArray(x)) walk(x)
        else out.push(x)
      }
    }
    walk(this.value)
    return new ListValue(out)
  }
  unique(): ListValue {
    const buckets: Record<string, Value[]> = {}
    for (let i = 0; i < this.value.length; i++) {
      const v = this.get(i)
      const key = v.toString()
      if (hasOwn(buckets, key)) {
        if (!buckets[key].some(x => Value.equals(v, x))) buckets[key].push(v)
      } else buckets[key] = [v]
    }
    const out: Value[] = []
    for (const k in buckets) out.push(...buckets[k])
    return new ListValue(out)
  }
  sort(): ListValue {
    const arr = this.value.slice()
    arr.sort((a, b) => {
      const x = a instanceof PrimitiveValue ? a.value : a instanceof Value ? a.toString() : a
      const y = b instanceof PrimitiveValue ? b.value : b instanceof Value ? b.toString() : b
      return typeof x === 'number' && typeof y === 'number' && !Number.isNaN(x) && !Number.isNaN(y) ? x - y : compareNatural(x, y)
    })
    return new ListValue(arr)
  }
  concat(o: ListValue): ListValue {
    return new ListValue(this.value.concat(o.value))
  }
  earliest(): Value {
    const d = this.getDates()
    if (d.length === 0) return NULL
    let m = d[0]
    for (const x of d) if (x < m) m = x
    return new DateValue(m)
  }
  latest(): Value {
    const d = this.getDates()
    if (d.length === 0) return NULL
    let m = d[0]
    for (const x of d) if (x > m) m = x
    return new DateValue(m)
  }
  sum(): Value {
    const n = this.getNumbers()
    return n.length === 0 ? NULL : new NumberValue(n.reduce((a, b) => a + b, 0))
  }
  median(): Value {
    const n = this.getNumbers().sort((a, b) => a - b)
    const l = n.length
    return l === 0 ? NULL : new NumberValue(l % 2 === 0 ? (n[l / 2] + n[l / 2 - 1]) / 2 : n[(l - 1) / 2])
  }
  mean(): Value {
    const s = this.sum()
    return s instanceof NullValue ? NULL : new NumberValue((s as NumberValue).value / this.length())
  }
  min(): Value {
    const n = this.getNumbers()
    return n.length === 0 ? NULL : new NumberValue(Math.min(...n))
  }
  max(): Value {
    const n = this.getNumbers()
    return n.length === 0 ? NULL : new NumberValue(Math.max(...n))
  }
  stddev(): Value {
    const n = this.getNumbers()
    if (n.length === 0) return NULL
    const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length
    const m = avg(n)
    return new NumberValue(Math.sqrt(avg(n.map(x => Math.pow(x - m, 2)))))
  }
  join(sep: string): StringValue {
    const parts: string[] = []
    for (let i = 0; i < this.value.length; i++) {
      const v = this.value[i]
      if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') parts.push(String(v))
      else parts.push(this.get(i).toString())
    }
    return new StringValue(parts.join(sep))
  }
  keys(): string[] {
    return super.keys().concat(['length'])
  }
  objectAccess(k: string): Value | null {
    return k.toLowerCase() === 'length' ? new NumberValue(this.value.length) : super.objectAccess(k)
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    const box = el.createDiv('value-list-container')
    const n = this.value.length
    for (let i = 0; i < n; i++) {
      this.get(i).renderTo(box.createSpan('value-list-element'), ctx)
      if (i < n - 1) box.createSpan('value-list-gap').setText('\n')
    }
  }
}

export class TagValue extends StringValue {
  lowerTag: string
  constructor(tag: string) {
    super(tag.charAt(0) === '#' ? tag : '#' + tag)
    this.lowerTag = this.value.toLowerCase()
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    if (ctx) ctx.renderTag(this.value, el)
    else el.setText(this.value)
  }
  tagMatches(o: Value): boolean {
    if (o instanceof StringValue) {
      const q = o instanceof TagValue ? o.lowerTag : (o.value.charAt(0) === '#' ? o.value : '#' + o.value).toLowerCase()
      const t = this.lowerTag
      if (t.startsWith(q) && (t.length === q.length || t.charAt(q.length) === '/')) return true
    }
    return false
  }
}
export class TagListValue extends ListValue {
  constructor(tags: string[]) {
    super(tags.map(t => new TagValue(t)))
    this.icon = 'lucide-tags'
  }
  includes(v: Value): boolean {
    for (const t of this.value) if ((t as TagValue).tagMatches(v)) return true
    return false
  }
}

export class ObjectValue extends NotNullValue {
  static type = 'Object'
  value: Record<string, any>
  lazyEvaluator: (key: string, raw: any) => Value = (_k, raw) => toValue(raw)
  constructor(value: Record<string, any> = {}) {
    super()
    this.icon = 'lucide-list'
    this.value = value
  }
  get data(): Record<string, any> {
    return this.value
  }
  toString(): string {
    const o: Record<string, string> = {}
    for (const k in this.value) if (hasOwn(this.value, k)) o[k] = this.get(k)!.toString()
    return JSON.stringify(o)
  }
  isTruthy(): boolean {
    return !this.isEmpty()
  }
  isEmpty(): boolean {
    return Object.keys(this.value).length === 0
  }
  equals(o: any): boolean {
    const a = this.value
    const b = o.value
    if (a === b) return true
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!hasOwn(b, k)) return false
    for (const k of ka) if (!Value.equals(this.get(k), o.get(k))) return false
    return true
  }
  valuesRaw(): any[] {
    return Object.values(this.value)
  }
  get(k: string): Value | null {
    if (!hasOwn(this.value, k)) return NULL
    const v = this.value[k]
    return v instanceof Value ? v : (this.value[k] = this.lazyEvaluator(k, v))
  }
  getInsensitive(k: string): Value | null {
    return this.get(insensitiveKey(this.value, k))
  }
  keys(): string[] {
    return Object.keys(this.value)
  }
  objectAccess(k: string): Value | null {
    return this.getInsensitive(k)
  }
  renderTo(el: HTMLElement): void {
    el.setText(this.toString())
  }
}

export class FileValue extends NotNullValue {
  static type = 'File'
  app: any
  file: any
  private _links?: ListValue
  private _backlinks?: ListValue
  private _embeds?: ListValue
  private _tags?: TagListValue
  private _props?: ObjectValue
  constructor(app: any, file: any) {
    super()
    this.icon = 'lucide-file'
    this.app = app
    this.file = file
  }
  toString(): string {
    return this.file.path
  }
  isTruthy(): boolean {
    return true
  }
  equals(o: any): boolean {
    return this.file === o.file
  }
  looseEquals(o: any): boolean {
    return o instanceof StringValue && this.file.path === o.value
  }
  getLinks(): ListValue {
    if (this._links) return this._links
    const out: Value[] = []
    iterateRefsForFile(this.app, this.file, ref => out.push(LinkValue.fromReference(this.app, this.file.path, ref)))
    return (this._links = new ListValue(out))
  }
  getBacklinks(): ListValue {
    if (this._backlinks) return this._backlinks
    const resolved = this.app.metadataCache.resolvedLinks
    const out: Value[] = []
    for (const src in resolved) if (hasOwn(resolved, src) && hasOwn(resolved[src], this.file.path)) out.push(new LinkValue(this.app, src, '', new StringValue(basenameNoMd(src))))
    return (this._backlinks = new ListValue(out))
  }
  getEmbeds(): ListValue {
    if (this._embeds) return this._embeds
    const out: Value[] = []
    const cache = this.app.metadataCache.getFileCache(this.file)
    if (cache?.embeds) for (const e of cache.embeds) out.push(LinkValue.fromReference(this.app, this.file.path, e))
    return (this._embeds = new ListValue(out))
  }
  getTags(): TagListValue {
    if (this._tags) return this._tags
    const tags: string[] = []
    const cache = this.app.metadataCache.getFileCache(this.file)
    if (cache) {
      if (cache.tags) for (const t of cache.tags) tags.push(t.tag)
      const fm = frontmatterTags(cache.frontmatter)
      if (fm) tags.push(...fm)
    }
    return (this._tags = new TagListValue(Array.from(new Set(tags))))
  }
  getProps(): ObjectValue {
    if (this._props) return this._props
    const cache = this.app.metadataCache.getFileCache(this.file)
    return (this._props = frontmatterObject(this.app, this.file, cache?.frontmatter || {}))
  }
  keys(): string[] {
    return super.keys().concat(['file', 'name', 'basename', 'fullname', 'path', 'folder', 'ext', 'ctime', 'mtime', 'size', 'links', 'embeds', 'backlinks', 'tags', 'properties'])
  }
  objectAccess(k: string): Value | null {
    const f = this.file
    switch (k.toLowerCase()) {
      case 'file': return this
      case 'name': return new StringValue(shortName(f))
      case 'basename': return new StringValue(f.basename)
      case 'fullname': return new StringValue(f.name)
      case 'path': return new StringValue(f.path)
      case 'folder': return new StringValue(f.parent.path)
      case 'ext': return new StringValue(f.extension)
      case 'ctime': return new DateValue(new Date(f.stat.ctime))
      case 'mtime': return new DateValue(new Date(f.stat.mtime))
      case 'size': return new NumberValue(f.stat.size)
      case 'links': return this.getLinks()
      case 'embeds': return this.getEmbeds()
      case 'backlinks': return this.getBacklinks()
      case 'tags': return this.getTags()
      case 'properties': return this.getProps()
    }
    return super.objectAccess(k)
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    if (ctx) ctx.renderFileLink(this.file, null, el)
    else el.setText(this.file.path)
  }
}
/** `this` : the file the base is embedded in / opened as. */
export class ThisFileValue extends FileValue {
  static type = 'ThisFile'
  constructor(app: any, file: any, public entry: any) {
    super(app, file)
  }
  keys(): string[] {
    return this.entry.keys()
  }
  objectAccess(k: string): Value | null {
    return this.entry.getByIdentifier(k)
  }
}

function shortName(f: any): string {
  return typeof f.getShortName === 'function' ? f.getShortName() : f.extension === 'md' ? f.basename : f.name
}
const basenameNoMd = (p: string): string => {
  const n = p.slice(p.lastIndexOf('/') + 1)
  return n.endsWith('.md') ? n.slice(0, -3) : n
}
export function iterateRefsForFile(app: any, file: any, cb: (ref: any) => void): void {
  app.metadataCache.iterateRefsForFile(file, cb)
}
function frontmatterTags(fm: any): string[] | null {
  if (!fm) return null
  const key = Object.keys(fm).find(k => /^tags$/i.test(k))
  if (key === undefined) return null
  let v = fm[key]
  if (typeof v === 'string') v = v.split(/[,\s]+/)
  if (!Array.isArray(v)) return null
  const t = v.filter((x: any) => typeof x === 'string' && !!x && !x.includes(' '))
  return t.map((x: string) => (x.charAt(0) === '#' ? x : '#' + x))
}

export class LinkValue extends StringValue {
  static type = 'Link'
  app: any
  sourcePath: string
  display: StringValue | null
  private resolvedFile: any = null
  constructor(app: any, path: string, sourcePath: string, display?: Value | null) {
    super(path)
    this.icon = 'lucide-link'
    this.app = app
    this.sourcePath = sourcePath
    this.display = (display as StringValue) ?? null
  }
  toString(): string {
    return `[[${this.value}${this.display ? '|' + this.display : ''}]]`
  }
  isTruthy(): boolean {
    return true
  }
  equals(o: any): boolean {
    return this.value === o.value && this.sourcePath === o.sourcePath && Value.equals(this.display, o.display)
  }
  looseEquals(o: any): boolean {
    if (o instanceof LinkValue) {
      const a = this.resolve()
      const b = o.resolve()
      return a && b ? a === b : this.value === o.value
    }
    if (o instanceof StringValue) {
      const p = LinkValue.parseFromString(this.app, o.value, '')
      if (p) return this.looseEquals(p)
    }
    return o instanceof FileValue && this.resolve() === o.file
  }
  resolve(): any {
    return this.app.metadataCache.getFirstLinkpathDest(stripSubpath(this.value), this.sourcePath)
  }
  renderTo(el: HTMLElement, ctx?: RenderContext): void {
    if (ctx) ctx.renderFileLink(this.value, this.display, el)
    else el.setText(this.display ? this.display.value : this.value)
  }
  static parseFromString(app: any, s: string, sourcePath: string): LinkValue | null {
    if (s.startsWith('[[') && s.endsWith(']]')) {
      let inner = s.slice(2, -2)
      let display: StringValue | null = null
      const bar = inner.lastIndexOf('|')
      if (bar !== -1) {
        display = new StringValue(inner.substring(bar + 1))
        inner = inner.substring(0, bar)
      }
      return new LinkValue(app, inner, sourcePath, display)
    }
    return null
  }
  static fromReference(app: any, sourcePath: string, ref: any): LinkValue {
    return new LinkValue(app, ref.link, sourcePath, ref.displayText ? new StringValue(ref.displayText) : null)
  }
}
export const stripSubpath = (s: string): string => {
  const i = s.indexOf('#')
  return i === -1 ? s : s.substring(0, i)
}

/** JS value -> Value. */
export function toValue(v: any): Value {
  if (v === null || v === undefined || typeof v === 'function') return NULL
  if (v instanceof Value) return v
  if (typeof v === 'string') return new StringValue(v)
  if (typeof v === 'number') return new NumberValue(v)
  if (v === true || v === false) return new BooleanValue(v)
  if (Array.isArray(v)) return new ListValue(v.slice())
  if (v instanceof Date) return new DateValue(new Date(v))
  if (typeof v === 'object') return new ObjectValue(Object.assign({}, v))
  throw new Error('Value type is unsupported ' + String(v))
}

/** Frontmatter -> ObjectValue with lazy typed conversion (links, urls, dates, tags). */
export function frontmatterObject(app: any, file: any, fm: any): ObjectValue {
  const obj = new ObjectValue(Object.assign({}, fm))
  const conv = (key: any, raw: any): Value => {
    if (typeof key === 'string' && key.toLowerCase() === 'tags') {
      if (Array.isArray(raw) && raw.every(x => typeof x === 'string')) return new TagListValue(raw)
      if (typeof raw === 'string') return new TagListValue([raw])
    }
    if (typeof raw === 'string') {
      const l = LinkValue.parseFromString(app, raw, file ? file.path : '')
      if (l) return l
      if (!raw.includes(' ') && isUrl(raw)) return new UrlValue(raw)
      const d = DateValue.parseFromString(raw)
      if (d) return d
    }
    const v = toValue(raw)
    if (v instanceof ListValue || v instanceof ObjectValue) (v as any).lazyEvaluator = conv
    return v
  }
  obj.lazyEvaluator = conv
  return obj
}
