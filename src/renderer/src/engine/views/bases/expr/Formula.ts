/* eslint-disable @typescript-eslint/no-explicit-any */
// Formula evaluation (typed values, operators, calls) over a FormulaContext. Semantics: null
// propagation, string-RHS date/duration coercion, lambda scopes for map/filter/reduce, case-insensitive property access, error values.
import { bt } from '../strings'
import { parseExpression, type Node } from './parser'
import { registry } from '../functions'
import {
  Value, NullValue, NULL, ErrorValue, StringValue, NumberValue, BooleanValue, ListValue, ObjectValue, RegExpValue, DateValue, DurationValue, toValue
} from '../values'

/** The context a formula is evaluated in (a BasesEntry, or a lambda scope layered on one). */
export interface FormulaContext {
  app: any
  keys(): string[]
  getByIdentifier(name: string): Value | null
}
const F = (k: string, vars?: Record<string, string | number>): string => bt('formulas.' + k, vars)

export abstract class ExprNode {
  constructor(public type: string) {}
  abstract getValue(ctx: FormulaContext): Value
  test(ctx: FormulaContext): boolean {
    return this.getValue(ctx).isTruthy()
  }
}
class InvalidNode extends ExprNode {
  constructor(public value: string, public parseError: string) {
    super('invalid')
  }
  getErrorMessage(): string {
    return this.parseError || 'Unable to parse formula.'
  }
  getValue(): Value {
    return NULL
  }
  test(): boolean {
    return false
  }
}
class EmptyNode extends ExprNode {
  constructor() {
    super('empty')
  }
  getValue(): Value {
    return NULL
  }
  test(): boolean {
    return false
  }
}
class CompareNode extends ExprNode {
  constructor(public operator: string, public left: ExprNode, public right: ExprNode) {
    super('comparison')
  }
  getValue(ctx: FormulaContext): Value {
    const { left, right } = this
    switch (this.operator) {
      case '&&': return new BooleanValue(left.getValue(ctx).isTruthy() && right.getValue(ctx).isTruthy())
      case '||': return new BooleanValue(left.getValue(ctx).isTruthy() || right.getValue(ctx).isTruthy())
    }
    const a = left.getValue(ctx)
    let b = right.getValue(ctx)
    switch (this.operator) {
      case '==': return new BooleanValue(Value.looseEquals(a, b))
      case '!=': return new BooleanValue(!Value.looseEquals(a, b))
    }
    if (a instanceof NullValue || b instanceof NullValue) return NULL
    let x: any
    if (a instanceof DateValue) {
      x = a.date.getTime()
      if (b instanceof StringValue) {
        const p = DateValue.parseFromString(b.value)
        if (p) b = p
      }
    } else if (a instanceof DurationValue) {
      x = a.getMilliseconds()
      if (b instanceof StringValue) {
        const p = DurationValue.parseFromString(b.value)
        if (p) b = p
      }
    } else x = a instanceof NumberValue ? a.value : a.toString()
    const y: any = b instanceof DateValue ? b.date.getTime() : b instanceof DurationValue ? b.getMilliseconds() : b instanceof NumberValue ? b.value : b.toString()
    switch (this.operator) {
      case '<': return new BooleanValue(x < y)
      case '>': return new BooleanValue(x > y)
      case '<=': return new BooleanValue(x <= y)
      case '>=': return new BooleanValue(x >= y)
    }
    return NULL
  }
}
class MathNode extends ExprNode {
  constructor(public operator: string, public left: ExprNode, public right: ExprNode) {
    super('arithmetic')
  }
  getValue(ctx: FormulaContext): Value {
    const a = this.left.getValue(ctx)
    let b = this.right.getValue(ctx)
    const op = this.operator
    if (a instanceof NumberValue && b instanceof NumberValue) {
      switch (op) {
        case '+': return new NumberValue(a.value + b.value)
        case '-': return new NumberValue(a.value - b.value)
        case '*': return new NumberValue(a.value * b.value)
        case '/': return new NumberValue(a.value / b.value)
        case '%': return new NumberValue(a.value % b.value)
        default: throw new Error('Invalid operator')
      }
    }
    if (a instanceof DateValue && b instanceof StringValue) {
      const d = DurationValue.parseFromString(b.value)
      if (d) b = d
    }
    if (a instanceof DateValue && b instanceof DurationValue) {
      if (op !== '+' && op !== '-') throw new Error('Invalid date operator')
      return b.addToDate(a, op === '-')
    }
    if (a instanceof DurationValue && b instanceof NumberValue && (op === '*' || op === '/')) {
      const m = op === '*' ? b.value : 1 / b.value
      return new DurationValue(a.years * m, a.months * m, a.days * m, a.hours * m, a.minutes * m, a.seconds * m, a.milliseconds * m)
    }
    if (a instanceof DurationValue && b instanceof DurationValue && (op === '+' || op === '-')) {
      const m = op === '+' ? 1 : -1
      return new DurationValue(a.years + b.years * m, a.months + b.months * m, a.days + b.days * m, a.hours + b.hours * m, a.minutes + b.minutes * m, a.seconds + b.seconds * m, a.milliseconds + b.milliseconds * m)
    }
    if (a instanceof ListValue && b instanceof ListValue && op === '+') return a.concat(b)
    if (op === '+' && (a instanceof StringValue || b instanceof StringValue)) {
      return new StringValue((a === NULL ? '' : a.toString()) + (b === NULL ? '' : b.toString()))
    }
    if (op === '-' && a instanceof DateValue && b instanceof DateValue) return DurationValue.fromMilliseconds(a.date.getTime() - b.date.getTime())
    if (a === NULL || b === NULL) return NULL
    throw new Error('Invalid operator between ' + a.constructor.toString() + ' and ' + b.constructor.toString())
  }
}
class NegateNode extends ExprNode {
  constructor(public expr: ExprNode) {
    super('negate')
  }
  getValue(ctx: FormulaContext): Value {
    const v = this.expr.getValue(ctx)
    if (v === NULL) return v
    if (!(v instanceof NumberValue)) throw new Error('Unable to negate ' + v.toString())
    return new NumberValue(-v.value)
  }
}
class NotNode extends ExprNode {
  constructor(public expr: ExprNode) {
    super('not')
  }
  getValue(ctx: FormulaContext): Value {
    const v = this.expr.getValue(ctx)
    return v === NULL ? v : new BooleanValue(!v.isTruthy())
  }
}
class ParenNode extends ExprNode {
  constructor(public value: ExprNode) {
    super('paren_expr')
  }
  getValue(ctx: FormulaContext): Value {
    return this.value.getValue(ctx)
  }
}
class PrimitiveNode extends ExprNode {
  constructor(public value: any) {
    super('primitive')
  }
  getValue(): Value {
    return toValue(this.value)
  }
}
class RegExpNode extends ExprNode {
  value: RegExpValue
  constructor(r: RegExp) {
    super('regexp')
    this.value = new RegExpValue(r)
  }
  getValue(): Value {
    return this.value
  }
}
class ArrayNode extends ExprNode {
  constructor(public elements: ExprNode[]) {
    super('array')
  }
  getValue(ctx: FormulaContext): Value {
    return new ListValue(this.elements.map(e => e.getValue(ctx)))
  }
}
class IdentNode extends ExprNode {
  constructor(public id: string) {
    super('ident')
  }
  getValue(ctx: FormulaContext): Value {
    return ctx.getByIdentifier(this.id) as Value
  }
}
class ObjectAccessNode extends ExprNode {
  constructor(public object: ExprNode, public index: string) {
    super('object_access')
  }
  getValue(ctx: FormulaContext): Value {
    const o = this.object.getValue(ctx)
    if (!o || o === NULL) return NULL
    const r = o.objectAccess(this.index)
    if (r === null) throw new Error(F('msgErrorInvalidObjectAccess', { index: this.index, type: o.constructor.toString() }))
    return r
  }
}
class ArrayAccessNode extends ExprNode {
  constructor(public array: ExprNode, public index: ExprNode) {
    super('array_access')
  }
  getValue(ctx: FormulaContext): Value {
    const a = this.array.getValue(ctx)
    if (!a || a === NULL) return NULL
    const n = this.index.getValue(ctx)
    if (!n || n === NULL) return NULL
    if (a instanceof ListValue) {
      if (!(n instanceof NumberValue)) throw new Error('Array index must be an integer. Got ' + n.constructor.toString())
      let i = n.value
      if (i < 0) i += a.length()
      return a.get(i)
    }
    if (a instanceof ObjectValue) {
      if (!(n instanceof StringValue)) throw new Error('Object access must be an string. Got ' + n.constructor.toString())
      return a.objectAccess(n.value)!
    }
    if (a instanceof StringValue) {
      if (!(n instanceof NumberValue)) throw new Error('String index must be an integer. Got ' + n.constructor.toString())
      return new StringValue(a.value.charAt(n.value))
    }
    if (n instanceof StringValue) {
      const r = a.objectAccess(n.toString())
      if (r === null) throw new Error(F('msgErrorInvalidObjectAccess', { index: n.value, type: a.constructor.toString() }))
      return r
    }
    throw new Error(F('msgErrorInvalidArrayAccess', { index: n.toString() }))
  }
}

/** A lambda scope: extra identifiers layered over a parent context. */
function scope(ctx: FormulaContext, vars: Record<string, Value>): FormulaContext {
  return {
    app: ctx.app,
    keys: () => ctx.keys().concat(Object.keys(vars)),
    getByIdentifier: (id: string) => (Object.hasOwn(vars, id) ? vars[id] : ctx.getByIdentifier(id))
  }
}

class CallNode extends ExprNode {
  constructor(public name: string, public subject: ExprNode | null, public args: ExprNode[]) {
    super('function')
  }
  getValue(ctx: FormulaContext): Value {
    const { name } = this
    let subject = this.subject
    let args = this.args
    if (name === 'if') {
      const n = args.length + (subject ? 1 : 0)
      if (n < 2) throw new Error(F('msgErrorNotEnoughArguments', { function: name }))
      if (n > 3) throw new Error(F('msgErrorTooManyArguments', { function: name }))
      if (!subject) {
        subject = args[0]
        args = args.slice(1)
      }
      if ((subject.getValue(ctx) || NULL).isTruthy()) return args[0].getValue(ctx)
      return args.length === 2 ? args[1].getValue(ctx) : NULL
    }
    let s: Value | null = null
    let fn: any
    if (subject) {
      s = subject.getValue(ctx) || NULL
      fn = registry.findForValue(s, name)
      if (!fn && s === NULL) return NULL
    } else fn = registry.findGlobal(name)

    const tooFew = (): Error => new Error(F('msgErrorNotEnoughArguments', { function: name }))
    const tooMany = (): Error => new Error(F('msgErrorTooManyArguments', { function: name }))
    if (s instanceof ListValue) {
      if (name === 'reduce') {
        if (args.length < 2) throw tooFew()
        if (args.length > 2) throw tooMany()
        const body = args[0]
        let acc = args[1].getValue(ctx)
        for (let i = 0; i < s.length(); i++) acc = body.getValue(scope(ctx, { index: new NumberValue(i), value: s.get(i), acc }))
        return acc
      }
      if (name === 'filter' || name === 'map') {
        if (args.length < 1) throw tooFew()
        if (args.length > 1) throw tooMany()
        const body = args[0]
        const out: Value[] = []
        for (let i = 0; i < s.length(); i++) {
          const v = s.get(i)
          const sc = scope(ctx, { index: new NumberValue(i), value: v })
          if (name === 'filter') {
            if (body.test(sc)) out.push(v)
          } else out.push(body.getValue(sc))
        }
        return new ListValue(out)
      }
    } else if (s instanceof ObjectValue) {
      if (name === 'filter' || name === 'map') {
        if (args.length < 1) throw tooFew()
        if (args.length > 1) throw tooMany()
        const body = args[0]
        const keys = s.keys()
        if (name === 'filter') {
          const out: Record<string, Value> = {}
          for (const k of keys) {
            const v = s.get(k)!
            if (body.test(scope(ctx, { key: new StringValue(k), value: v }))) out[k] = v
          }
          return new ObjectValue(out)
        }
        const out: Value[] = []
        for (const k of keys) out.push(body.getValue(scope(ctx, { key: new StringValue(k), value: s.get(k)! })))
        return new ListValue(out)
      }
    }
    if (!fn) throw new Error(s ? F('msgErrorInvalidInstanceFunction', { function: name, type: s.constructor.toString() }) : F('msgErrorInvalidFunction', { function: name }))

    const params = fn.params as any[]
    let x = 0
    const call: any[] = []
    const take = (v: Value): boolean => {
      if (x === params.length) {
        if (!params[params.length - 1].variadic) throw tooMany()
        x--
      }
      const p = params[x]
      if (p.optional && v === NULL) call.push(null)
      else {
        if (!p.type.some((t: any) => v instanceof t)) {
          if (v === NULL) return false
          throw new Error(F('msgErrorTypeError', { function: name, parameter: p.name, expected: p.type[0].toString(), given: v.constructor.toString() }))
        }
        call.push(v)
      }
      x++
      return true
    }
    if (s && !take(s)) return NULL
    for (const a of args) if (!take(a.getValue(ctx) || NULL)) return NULL
    if (x < params.length) for (let h = x; h < params.length; h++) if (!params[h].optional && !params[h].variadic) throw tooFew()
    return fn.applyWithContext(ctx, ...call)
  }
}

export function build(n: Node): ExprNode {
  switch (n.type) {
    case 'empty': return new EmptyNode()
    case 'ident': return new IdentNode(n.value)
    case 'paren': return new ParenNode(build(n.value))
    case 'not': return new NotNode(build(n.expr))
    case 'negate':
      if (n.expr.type === 'primitive' && typeof n.expr.value === 'number') return new PrimitiveNode(-n.expr.value)
      return new NegateNode(build(n.expr))
    case 'call': {
      let obj = n.object
      let subject: ExprNode | null = null
      if (obj.type === 'object_access') {
        subject = build(obj.object)
        obj = obj.index
      }
      if (obj.type !== 'ident') throw new Error('Invalid function name')
      return new CallNode(obj.value, subject, n.args.map(build))
    }
    case 'object_access': return new ObjectAccessNode(build(n.object), (n.index as any).value)
    case 'array_access': return new ArrayAccessNode(build(n.array), build(n.index))
    case 'math': return new MathNode(n.op, build(n.left), build(n.right))
    case 'compare': return new CompareNode(n.op, build(n.left), build(n.right))
    case 'primitive': return new PrimitiveNode(n.value)
    case 'regexp': return new RegExpNode(new RegExp(n.pattern, n.flags))
    case 'array': return new ArrayNode(n.elements.map(build))
  }
}

/** A parsed formula string. Syntax errors give a formula that evaluates to null. */
export class Formula {
  formula: ExprNode
  constructor(public text: string) {
    try {
      this.formula = build(parseExpression(text))
    } catch (e: any) {
      this.formula = new InvalidNode(text, e.message)
    }
  }
  get isInvalid(): boolean {
    return this.formula instanceof InvalidNode
  }
  get parseError(): string | null {
    return this.formula instanceof InvalidNode ? this.formula.getErrorMessage() : null
  }
  toString(): string {
    return this.text
  }
  /** Truthiness of the formula; evaluation errors throw (callers show "Failed to evaluate a filter"). */
  test(ctx: FormulaContext): boolean {
    return this.formula.test(ctx)
  }
  getValue(ctx: FormulaContext): Value {
    try {
      return this.formula.getValue(ctx)
    } catch (e) {
      return new ErrorValue(e)
    }
  }
}
