// Search query language: tokenizer and explain-label strings (split from query.ts).
// ---------------------------------------------------------------------------------------------

export type TokenType =
  | 'text' | 'quote' | 'regex' | 'bracket' | 'parenthesis' | 'colon' | 'greaterthan' | 'lessthan'
  | 'not' | 'or' | 'true' | 'false' | 'empty'
export interface Token {
  type: TokenType
  content: string
  pos: number
}

export function tokenize(q: string): Token[] {
  const n = q.length
  const out: Token[] = []
  let t = 0
  const word = (w: string, pos: number): void => {
    const type: TokenType = w === 'TRUE' ? 'true' : w === 'FALSE' ? 'false' : w === 'EMPTY' ? 'empty' : w === 'OR' ? 'or' : 'text'
    out.push({ type, content: w, pos })
  }
  const SINGLE: Record<string, TokenType> = { '[': 'bracket', ']': 'bracket', '(': 'parenthesis', ')': 'parenthesis', ':': 'colon', '>': 'greaterthan', '<': 'lessthan' }
  while (t < n) {
    const c = q.charAt(t)
    if (c === '"') {
      const pos = t++
      let s = ''
      for (;;) {
        if (t >= n) {
          out.push({ type: 'quote', content: s, pos })
          break
        }
        const h = q.charAt(t++)
        if (h === '\\' && t < n) s += q.charAt(t++)
        else if (h === '"') {
          out.push({ type: 'quote', content: s, pos })
          break
        } else s += h
      }
    } else if (c === '/') {
      const pos = t++
      let s = ''
      for (;;) {
        if (t >= n) {
          out.push({ type: 'regex', content: s, pos })
          break
        }
        const h = q.charAt(t++)
        if (h === '\\' && t < n) {
          const nx = q.charAt(t)
          if (nx === '/') {
            s += nx
            t++
            continue
          }
          if (nx === '\\') {
            s += '\\\\'
            t++
            continue
          }
        }
        if (h === '/') {
          out.push({ type: 'regex', content: s, pos })
          break
        }
        s += h
      }
    } else if (c === '-') {
      out.push({ type: 'not', content: c, pos: t })
      t++
    } else {
      const pos = t
      let s = ''
      for (;;) {
        if (t >= n) {
          if (s) word(s, pos)
          break
        }
        const h = q.charAt(t++)
        const single = SINGLE[h]
        if (single) {
          if (s) word(s, pos)
          out.push({ type: single, content: h, pos: t - 1 })
          break
        }
        if (h === ' ') {
          if (s) word(s, pos)
          break
        }
        s += h
      }
    }
  }
  return out
}

export function tokenEnd(t: Token): number {
  const e = t.pos + t.content.length
  return t.type === 'quote' || t.type === 'regex' ? e + 2 : e
}

// ---------------------------------------------------------------------------------------------
// Explain labels (i18n `plugins.search.*`, English)
// ---------------------------------------------------------------------------------------------

export const LABELS = {
  matchTrue: 'Is true',
  matchFalse: 'Is false',
  matchEmpty: 'Is empty',
  matchRegex: 'Matches regex: ',
  matchProperty: 'Contains property:',
  matchExactText: 'Contains exact text: ',
  matchText: 'Matches text: ',
  matchAll: 'Match all of: ',
  matchAny: 'Match any of: ',
  lessThan: 'Less than: ',
  greaterThan: 'Greater than: ',
  excluding: 'Excluding: ',
  caseSensitive: 'Case sensitive',
  caseInsensitive: 'Case insensitive',
  filePath: 'Match file path: ',
  fileName: 'Match file name: ',
  content: 'Match file content: ',
  line: 'Match line: ',
  block: 'Match block: ',
  section: 'Match section: ',
  task: 'Match task: ',
  taskTodo: 'Match task (todo): ',
  taskDone: 'Match task (done): ',
  tag: 'Match tag: '
}
