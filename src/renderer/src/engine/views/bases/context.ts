/* eslint-disable @typescript-eslint/no-explicit-any */
// Evaluation contexts: BasesContext (shared per query run), BasesEntry (one file's property
// access: note.* / file.* / formula.*), FormulaResults (cycle-safe formula cache).
import { bt } from './strings'
import { Value, NULL, ObjectValue, FileValue, ThisFileValue, ListValue, NotNullValue, frontmatterObject, insensitiveKey } from './values'
import type { Formula, FormulaContext } from './expr/Formula'
import { splitPropertyId } from './BaseConfig'

export const FILE_PROPERTIES = ['file.file', 'file.name', 'file.basename', 'file.fullname', 'file.path', 'file.folder', 'file.ext', 'file.ctime', 'file.mtime', 'file.size', 'file.links', 'file.backlinks', 'file.embeds', 'file.tags']
const LOOP = Symbol('formula-loop')

export class FormulasValue extends NotNullValue {
  static type = 'Formulas'
  constructor(private results: FormulaResults) {
    super()
  }
  toString(): string {
    return 'Formulas' + JSON.stringify(this.keys())
  }
  isTruthy(): boolean {
    return true
  }
  keys(): string[] {
    return Object.keys(this.results.formulas)
  }
  objectAccess(k: string): Value | null {
    return this.results.getFormulaValue(k)
  }
}

export class FormulaResults {
  cache: Record<string, any> = {}
  constructor(public ctx: FormulaContext, public formulas: Record<string, Formula>) {}
  getFormulaValue(name: string): Value | null {
    const { ctx, formulas, cache } = this
    name = insensitiveKey(formulas, name)
    if (Object.hasOwn(cache, name)) {
      const v = cache[name]
      if (v === LOOP) throw new Error(bt('plugins.bases.msgErrorInfiniteLoop'))
      return v
    }
    if (Object.hasOwn(formulas, name)) {
      cache[name] = LOOP
      const v = formulas[name].getValue(ctx)
      cache[name] = v
      return v
    }
    return null
  }
}

export class BasesContext {
  _local: BasesEntry | null = null
  localUsed = false
  constructor(public app: any, public filter: any, public formulas: Record<string, Formula>, localFile?: any) {
    if (localFile) this._local = new BasesEntry(this, localFile)
  }
  get local(): BasesEntry | null {
    this.localUsed = true
    return this._local
  }
  regenerateLocal(): BasesContext {
    return new BasesContext(this.app, this.filter, this.formulas, this._local?.file)
  }
}

export class BasesEntry implements FormulaContext {
  app: any
  file: any
  frontmatter: any
  note: ObjectValue
  implicit: FileValue
  formulaResults: FormulaResults
  formula: FormulasValue
  constructor(public ctx: BasesContext, file: any) {
    const app = (this.app = ctx.app)
    this.file = file
    this.frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    this.note = frontmatterObject(app, file, this.frontmatter)
    this.implicit = new FileValue(app, file)
    this.formulaResults = new FormulaResults(this, ctx.formulas)
    this.formula = new FormulasValue(this.formulaResults)
  }
  /** Value of a property id (`note.x`, `file.x`, `formula.x`; a bare name is a note property). */
  getValue(prop: string): Value | null {
    const { type, name } = splitPropertyId(prop)
    switch (type) {
      case 'note': return this.note.objectAccess(name)
      case 'file': return this.implicit.objectAccess(name)
      case 'formula': return this.formulaResults.getFormulaValue(name)
    }
    return null
  }
  keys(): string[] {
    const s = new Set(Object.keys(this.frontmatter))
    s.add('this')
    s.add('note')
    s.add('file')
    s.add('formula')
    return Array.from(s)
  }
  getByIdentifier(id: string): Value | null {
    switch (id.toLowerCase()) {
      case 'this': {
        const l = this.ctx.local
        return l ? new ThisFileValue(this.app, l.file, l) : NULL
      }
      case 'note': return this.note
      case 'file': return this.implicit
      case 'formula': return this.formula
    }
    return this.note.getInsensitive(id)
  }
  getPropertyKeys(): string[] {
    return Object.keys(this.frontmatter)
  }
  getRawProperty(key: string): any {
    const k = insensitiveKey(this.frontmatter, key)
    return Object.hasOwn(this.frontmatter, k) ? this.frontmatter[k] : null
  }
  static FILE_PROPERTIES = FILE_PROPERTIES
}
void ListValue
