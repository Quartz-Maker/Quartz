// Tiny equivalents of the helper packages remark-parse@8 depends on (MIT originals:
// trim@0.0.1, repeat-string, is-decimal, is-whitespace-character).
import getIndent from 'remark-parse/lib/util/get-indentation.js'

export function trim(str: string): string {
  return str.replace(/^\s*|\s*$/g, '')
}
export function repeat(str: string, n: number): string {
  return str.repeat(n)
}
export function decimal(character: string | number): boolean {
  const code = typeof character === 'string' ? character.charCodeAt(0) : character
  return code >= 48 && code <= 57
}
const ws = /\s/
export function whitespace(character: string | number): boolean {
  return ws.test(typeof character === 'number' ? String.fromCharCode(character) : character.charAt(0))
}

// remark-parse@8 lib/util/remove-indentation.js (MIT), with an extra
// `stopAtUnindented` flag: the list tokenizer passes false so that unindented lazy
// lines don't cancel the indentation removal of the other lines.
export function removeIndentation(value: string, maximum: number, stopAtUnindented = true): string {
  const values = value.split('\n')
  let position = values.length + 1
  let minIndent = Infinity
  const matrix: Record<number, number>[] = []
  values.unshift(' '.repeat(maximum) + '!')
  while (position--) {
    const indentation = getIndent(values[position])
    matrix[position] = indentation.stops
    if (trim(values[position]).length === 0) continue
    if (indentation.indent) {
      if (indentation.indent > 0 && indentation.indent < minIndent) minIndent = indentation.indent
    } else if (stopAtUnindented) {
      minIndent = Infinity
      break
    }
  }
  if (minIndent !== Infinity) {
    position = values.length
    while (position--) {
      const stops = matrix[position]
      let index = minIndent
      while (index && !(index in stops)) index--
      values[position] = values[position].slice(stops[index] + 1)
    }
  }
  values.shift()
  return values.join('\n')
}
