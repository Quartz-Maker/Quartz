// Search query language: recursive-descent parser building the matcher tree (split from query.ts).
import { Matcher, AndMatcher, OrMatcher, CaseMatcher, PathMatcher, FileMatcher, ContentMatcher, LineMatcher, BlockMatcher, SectionMatcher, TaskMatcher, TextMatcher, TagMatcher, PropertyMatcher, ExactMatcher, RegexMatcher, NotMatcher, CompareMatcher, AnyMatcher, LiteralMatcher } from './queryMatchers'
import { type Token, type TokenType } from './queryTokens'

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

export interface SearchOperator {
  exclusive?: boolean
  allowSelf?: boolean
  operate(m: Matcher): Matcher
}

export const SEARCH_OPERATORS: Record<string, SearchOperator> = {
  'match-case': { operate: (m) => new CaseMatcher(m, true) },
  'ignore-case': { operate: (m) => new CaseMatcher(m, false) },
  path: { exclusive: true, operate: (m) => new PathMatcher(m) },
  file: { exclusive: true, operate: (m) => new FileMatcher(m) },
  content: { exclusive: true, operate: (m) => new ContentMatcher(m) },
  line: { exclusive: true, operate: (m) => new LineMatcher(m) },
  block: { exclusive: true, operate: (m) => new BlockMatcher(m) },
  section: { exclusive: true, allowSelf: true, operate: (m) => new SectionMatcher(m) },
  task: { exclusive: true, operate: (m) => new TaskMatcher(m, undefined) },
  'task-todo': { exclusive: true, operate: (m) => new TaskMatcher(m, false) },
  'task-done': { exclusive: true, operate: (m) => new TaskMatcher(m, true) },
  tag: {
    exclusive: true,
    operate: (m) => {
      if (!(m instanceof TextMatcher)) throw new Error('Operator "tag" can only be followed by text')
      return new TagMatcher(m)
    }
  }
}

export interface ParseState {
  tokens: Token[]
  pos: number
  operatorStack: string[]
  operators: Record<string, SearchOperator>
}

export function parseQuery(tokens: Token[], operators: Record<string, SearchOperator> = SEARCH_OPERATORS): Matcher | null {
  return parseOr({ tokens, pos: 0, operatorStack: [], operators })
}

function parseOr(s: ParseState): Matcher | null {
  const items: Matcher[] = []
  const ors: Token[] = []
  while (s.pos < s.tokens.length) {
    const m = parseAnd(s)
    if (m) {
      items.push(m)
      if (s.pos < s.tokens.length) {
        const t = s.tokens[s.pos]
        if (t.type === 'or') {
          ors.push(t)
          s.pos++
          continue
        }
      }
    }
    break
  }
  if (items.length === 0) return null
  if (items.length === 1) return items[0]
  const or = new OrMatcher(items)
  or.matchedTokens = ors
  return or
}

function parseAnd(s: ParseState): Matcher | null {
  const items: Matcher[] = []
  while (s.pos < s.tokens.length) {
    const m = parseTerm(s)
    if (!m) break
    items.push(m)
  }
  return items.length === 0 ? null : items.length === 1 ? items[0] : new AndMatcher(items)
}

function peekType(s: ParseState, type: TokenType): boolean {
  return s.pos < s.tokens.length && s.tokens[s.pos].type === type
}

function parseTerm(s: ParseState): Matcher | null {
  const tok = s.tokens[s.pos]
  if (!tok) return null
  const { type, content } = tok
  if (type === 'text' && s.pos < s.tokens.length - 1 && s.tokens[s.pos + 1].type === 'colon' && !s.operatorStack.includes('[')) {
    const name = content.toLowerCase()
    const op = Object.prototype.hasOwnProperty.call(s.operators, name) ? s.operators[name] : undefined
    if (!op) throw new Error('Operator "' + name + '" not recognized')
    if (op.exclusive) {
      for (const outer of s.operatorStack) {
        const o = s.operators[outer]
        if (o.exclusive && (!o.allowSelf || outer !== name)) throw new Error('Operator "' + name + '" cannot be nested within "' + outer + '"')
      }
    }
    s.operatorStack.push(name)
    s.pos++
    const colon = s.tokens[s.pos]
    s.pos++
    let operand = parseTerm(s)
    s.operatorStack.pop()
    if (!operand) operand = new TextMatcher('')
    const m = op.operate(operand)
    m.matchedTokens.push(tok)
    m.matchedTokens.push(colon)
    return m
  }
  if (type === 'bracket' && content === '[') {
    if (s.operatorStack.includes('[')) throw new Error('Property cannot be nested within a property.')
    s.operatorStack.push(content)
    s.pos++
    let key = parseOr(s)
    if (!key) key = new TextMatcher('')
    let value: Matcher | null = null
    const colons: Token[] = []
    if (peekType(s, 'colon')) {
      const c = s.tokens[s.pos]
      s.operatorStack.push(c.content)
      colons.push(c)
      s.pos++
      value = parseOr(s)
      s.operatorStack.pop()
    }
    const m = new PropertyMatcher(key, value)
    m.matchedTokens = colons
    m.matchedTokens.push(tok)
    s.operatorStack.pop()
    if (peekType(s, 'bracket')) m.eatToken(s)
    return m
  }
  if (type === 'bracket' && content === ']') return null
  if (type === 'text') {
    const m = new TextMatcher(content)
    m.eatToken(s)
    return m
  }
  if (type === 'quote') {
    const m = new ExactMatcher(content)
    m.eatToken(s)
    return m
  }
  if (type === 'regex') {
    try {
      new RegExp(content)
    } catch (e: any) {
      throw new Error('Failed to parse regular expression. ' + e.message)
    }
    const m = new RegexMatcher(content)
    m.eatToken(s)
    return m
  }
  if (type === 'parenthesis' && content === '(') {
    s.pos++
    let m = parseOr(s)
    if (s.pos < s.tokens.length) {
      const t = s.tokens[s.pos]
      if (t.type === 'parenthesis' && t.content === ')') {
        if (m) m.matchedTokens.push(t)
        s.pos++
      }
    }
    if (!m) m = new TextMatcher('')
    m.matchedTokens.push(tok)
    return m
  }
  if (type === 'parenthesis' && content === ')') return null
  if (type === 'or') return null
  if (type === 'false' || type === 'true' || type === 'empty') {
    const m = new LiteralMatcher(content)
    m.eatToken(s)
    return m
  }
  if (type === 'colon') return null
  if (type === 'not') {
    s.pos++
    const inner = parseTerm(s)
    if (!inner) return null
    const m = new NotMatcher(inner)
    m.matchedTokens.push(tok)
    return m
  }
  if (type === 'greaterthan' || type === 'lessthan') {
    s.pos++
    const inner = parseTerm(s)
    if (!inner) return null
    const m = new CompareMatcher(type, inner)
    m.matchedTokens.push(tok)
    return m
  }
  throw new Error('Failed to parse, error at ' + tok.pos + ' "' + content + '"')
}

