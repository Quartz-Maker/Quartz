// Bases expression language: tokenizer + recursive-descent parser producing a tree of node types
// (ident, paren, not, negate, call, object_access, array_access, math, compare, primitive, regexp,
// array). Any syntax error makes the whole formula invalid (it then evaluates to null).

export type Node =
  | { type: 'ident'; value: string }
  | { type: 'paren'; value: Node }
  | { type: 'not'; expr: Node }
  | { type: 'negate'; expr: Node }
  | { type: 'call'; object: Node; args: Node[] }
  | { type: 'object_access'; object: Node; index: Node }
  | { type: 'array_access'; array: Node; index: Node }
  | { type: 'math'; op: string; left: Node; right: Node }
  | { type: 'compare'; op: string; left: Node; right: Node }
  | { type: 'primitive'; value: string | number | boolean | null }
  | { type: 'regexp'; pattern: string; flags: string }
  | { type: 'array'; elements: Node[] }
  | { type: 'empty' }

export class ParseError extends Error {
  constructor(msg: string, public pos: number) {
    super(msg)
  }
}

type Tok = { k: 'num' | 'str' | 'id' | 'op' | 're' | 'eof'; v: string; pos: number; num?: number; str?: string; flags?: string }

const IDENT_START = /[\p{L}_$]/u
const IDENT_PART = /[\p{L}\p{N}_$]/u

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  // a `/` starts a regexp literal when an operand is expected
  const operandExpected = (): boolean => {
    const last = toks[toks.length - 1]
    if (!last) return true
    if (last.k === 'num' || last.k === 'str' || last.k === 'id' || last.k === 're') return false
    return !(last.v === ')' || last.v === ']')
  }
  while (i < n) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const start = i
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9]/.test(src[j])) j++
      if (src[j] === '.') {
        j++
        while (j < n && /[0-9]/.test(src[j])) j++
      }
      toks.push({ k: 'num', v: src.slice(i, j), pos: start, num: parseFloat(src.slice(i, j)) })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let closed = false
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === c) {
          closed = true
          break
        }
        j++
      }
      if (!closed) throw new ParseError('Unterminated string', i)
      toks.push({ k: 'str', v: src.slice(i, j + 1), pos: start, str: decodeString(src.slice(i, j + 1), i) })
      i = j + 1
      continue
    }
    if (c === '/' && operandExpected()) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < n) {
        const d = src[j]
        if (d === '\\') {
          j += 2
          continue
        }
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) {
          closed = true
          break
        }
        j++
      }
      if (!closed) throw new ParseError('Unterminated regexp', i)
      let k = j + 1
      while (k < n && /[A-Za-z]/.test(src[k])) k++
      toks.push({ k: 're', v: src.slice(i, k), pos: start, str: src.slice(i + 1, j), flags: src.slice(j + 1, k) })
      i = k
      continue
    }
    if (IDENT_START.test(c)) {
      let j = i + 1
      while (j < n && IDENT_PART.test(src[j])) j++
      toks.push({ k: 'id', v: src.slice(i, j), pos: start })
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '<=' || two === '>=') {
      toks.push({ k: 'op', v: two, pos: start })
      i += 2
      continue
    }
    if ('+-*/%!<>()[].,'.includes(c)) {
      toks.push({ k: 'op', v: c, pos: start })
      i++
      continue
    }
    throw new ParseError(`Unexpected character "${c}"`, i)
  }
  toks.push({ k: 'eof', v: '', pos: n })
  return toks
}

function decodeString(raw: string, pos: number): string {
  try {
    if (raw[0] === '"') return JSON.parse(raw)
    const body = raw.slice(1, -1).replace(/\\'/g, "'")
    const parts = body.split('\\"').map(p => p.replace(/"/g, '\\"'))
    return JSON.parse('"' + parts.join('\\"') + '"')
  } catch {
    throw new ParseError('Invalid string', pos)
  }
}

export function parseExpression(src: string): Node {
  if (src.trim() === '') return { type: 'empty' }
  const toks = tokenize(src)
  let p = 0
  const peek = (): Tok => toks[p]
  const isOp = (v: string): boolean => toks[p].k === 'op' && toks[p].v === v
  const expectOp = (v: string): void => {
    if (!isOp(v)) throw new ParseError(`Expected "${v}"`, toks[p].pos)
    p++
  }

  const binary = (ops: string[], next: () => Node, kind: 'math' | 'compare'): (() => Node) => () => {
    let left = next()
    while (toks[p].k === 'op' && ops.includes(toks[p].v)) {
      const op = toks[p++].v
      const right = next()
      left = { type: kind, op, left, right } as Node
    }
    return left
  }

  const parsePrimary = (): Node => {
    const t = peek()
    switch (t.k) {
      case 'num':
        p++
        return { type: 'primitive', value: t.num! }
      case 'str':
        p++
        return { type: 'primitive', value: t.str! }
      case 're':
        p++
        try {
          new RegExp(t.str!, t.flags)
        } catch {
          throw new ParseError('Invalid regular expression', t.pos)
        }
        return { type: 'regexp', pattern: t.str!, flags: t.flags! }
      case 'id':
        p++
        if (t.v === 'true') return { type: 'primitive', value: true }
        if (t.v === 'false') return { type: 'primitive', value: false }
        if (t.v === 'null') return { type: 'primitive', value: null }
        return { type: 'ident', value: t.v }
      case 'op':
        if (t.v === '(') {
          p++
          const e = parseOr()
          expectOp(')')
          return { type: 'paren', value: e }
        }
        if (t.v === '[') {
          p++
          const elements: Node[] = []
          if (!isOp(']')) {
            for (;;) {
              elements.push(parseOr())
              if (isOp(',')) {
                p++
                continue
              }
              break
            }
          }
          expectOp(']')
          return { type: 'array', elements }
        }
    }
    throw new ParseError('Unexpected token', t.pos)
  }

  const parsePostfix = (): Node => {
    let e = parsePrimary()
    for (;;) {
      if (isOp('.')) {
        p++
        const t = peek()
        if (t.k !== 'id') throw new ParseError('Expected property name', t.pos)
        p++
        e = { type: 'object_access', object: e, index: { type: 'ident', value: t.v } }
      } else if (isOp('[')) {
        p++
        const idx = parseOr()
        expectOp(']')
        e = { type: 'array_access', array: e, index: idx }
      } else if (isOp('(')) {
        p++
        const args: Node[] = []
        if (!isOp(')')) {
          for (;;) {
            args.push(parseOr())
            if (isOp(',')) {
              p++
              continue
            }
            break
          }
        }
        expectOp(')')
        const callee = e
        if (!(callee.type === 'ident' || (callee.type === 'object_access' && callee.index.type === 'ident'))) throw new ParseError('Invalid function name', toks[p - 1].pos)
        e = { type: 'call', object: callee, args }
      } else break
    }
    return e
  }

  const parseUnary = (): Node => {
    if (isOp('!')) {
      p++
      return { type: 'not', expr: parseUnary() }
    }
    if (isOp('-')) {
      p++
      return { type: 'negate', expr: parseUnary() }
    }
    return parsePostfix()
  }
  const parseMul = binary(['*', '/', '%'], parseUnary, 'math')
  const parseAdd = binary(['+', '-'], parseMul, 'math')
  const parseRel = binary(['<', '>', '<=', '>='], parseAdd, 'compare')
  const parseEq = binary(['==', '!='], parseRel, 'compare')
  const parseAnd = binary(['&&'], parseEq, 'compare')
  const parseOr: () => Node = binary(['||'], parseAnd, 'compare')

  const tree = parseOr()
  if (peek().k !== 'eof') throw new ParseError('Unexpected token', peek().pos)
  return tree
}
