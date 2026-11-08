/* eslint-disable @typescript-eslint/no-explicit-any */
// Legacy remark parser for the reading view.
//
// Parses with the tokenizer-based remark-parse 8 API
// (`inlineTokenizers`/`blockMethods`/`locator`) and splices extra tokenizers in.
// This module builds the parser from the MIT `remark-parse@8.0.3` package:
// the stock tokenizers are reused as-is, two tokenizers are modified
// (blockquote → callouts, list item → custom task status) and derived from
// remark-parse's MIT sources below, and the syntax tokenizers are registered
// in a fixed order so that tokenizer precedence is deterministic.
//
// remark-parse is (c) Titus Wormer, MIT licence.
import remarkParse from 'remark-parse'
import interrupt from 'remark-parse/lib/util/interrupt'
import getIndent from 'remark-parse/lib/util/get-indentation'
import removeIndent from 'remark-parse/lib/util/remove-indentation'
import { tokenizerFactory } from './tokenizer'

const BaseParser: any = remarkParse.Parser

/** Parser class with its own copies of the tokenizer tables (never mutates remark-parse). */
function createParserClass(): any {
  function QuartzParser(this: any, doc: string, file: any) {
    BaseParser.call(this, doc, file)
  }
  const proto = (QuartzParser.prototype = Object.create(BaseParser.prototype))
  proto.constructor = QuartzParser
  const base = BaseParser.prototype
  proto.blockTokenizers = { ...base.blockTokenizers }
  proto.inlineTokenizers = { ...base.inlineTokenizers }
  proto.blockMethods = base.blockMethods.slice()
  proto.inlineMethods = base.inlineMethods.slice()
  proto.interruptParagraph = base.interruptParagraph.map((x: any[]) => x.slice())
  proto.interruptList = base.interruptList.map((x: any[]) => x.slice())
  proto.interruptBlockquote = base.interruptBlockquote.map((x: any[]) => x.slice())
  proto.tokenizeBlock = tokenizerFactory('block')
  proto.tokenizeInline = tokenizerFactory('inline')
  proto.tokenizeFactory = tokenizerFactory
  return QuartzParser
}

/** Insert an inline tokenizer before `before` (index -1 ⇒ before the last entry, like Array#splice). */
function addInline(P: any, name: string, before: string, fn: any, locator: any): void {
  fn.locator = locator
  const proto = P.prototype
  proto.inlineTokenizers[name] = fn
  proto.inlineMethods.splice(proto.inlineMethods.indexOf(before), 0, name)
}
function addBlock(P: any, name: string, before: string, fn: any): void {
  fn.locator = undefined
  const proto = P.prototype
  proto.blockTokenizers[name] = fn
  proto.blockMethods.splice(proto.blockMethods.indexOf(before), 0, name)
}
/** Add an interruptor (without option guards) right after `after`. */
function addInterrupt(list: any[][], after: string, name: string): void {
  let i = 0
  while (i < list.length && list[i][0] !== after) i++
  list.splice(i + 1, 0, [name])
}

const isWs = (c: string): boolean => /\s/.test(c)
const isDecimal = (c: string): boolean => c.length === 1 && c >= '0' && c <= '9'

// ---------------------------------------------------------------------------
// Link text helpers (shared with transformers)
// ---------------------------------------------------------------------------
/** NBSP → space, trim, NFC. */
export function normalizeLinkPath(s: string): string {
  return s.replace(/ /g, ' ').trim().normalize('NFC')
}
/** `a#b#c` → `a > b > c` */
export function linkDisplayText(href: string): string {
  return href
    .split('#')
    .filter((x) => !!x)
    .join(' > ')
    .trim()
}
/** Split wikilink inner text into href/title/isAlias. */
export function parseLinktext(inner: string): { href: string; title: string; isAlias: boolean } {
  let title = ''
  const pipe = inner.indexOf('|')
  const isAlias = pipe > 0
  if (isAlias) {
    title = inner.substring(pipe + 1).trim()
    inner = inner.substring(0, pipe).trim()
  } else {
    inner = inner.trim()
    title = linkDisplayText(inner)
  }
  if (inner.endsWith('\\')) inner = inner.substring(0, inner.length - 1)
  return { href: normalizeLinkPath(inner), title, isAlias }
}

// ---------------------------------------------------------------------------
// Highlight colours
// ---------------------------------------------------------------------------
const HIGHLIGHT_EMOJI: Record<string, string> = {
  '🔴': 'red',
  '🟥': 'red',
  '🟠': 'orange',
  '🟧': 'orange',
  '🟡': 'yellow',
  '🟨': 'yellow',
  '🟢': 'green',
  '🟩': 'green',
  '🔵': 'blue',
  '🟦': 'blue',
  '🟣': 'purple',
  '🟪': 'purple'
}
function leadingHighlightColor(s: string): { color: string; length: number } {
  const cp = s.codePointAt(0)
  const ch = cp === undefined ? '' : String.fromCodePoint(cp)
  const color = HIGHLIGHT_EMOJI[ch] ?? ''
  return { color, length: color ? ch.length : 0 }
}

export const TAG_REGEX = /^#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/

// ---------------------------------------------------------------------------
// Modified stock tokenizers
// ---------------------------------------------------------------------------
const CALLOUT_REGEX = /^\[!([^\]]+)\]([+-]?)(?:\s|$)/

/** remark-parse blockquote tokenizer + callout header detection on the first line. */
function blockquote(this: any, eat: any, value: string, silent: boolean): any {
  const self = this
  const offsets = self.offset
  const tokenizers = self.blockTokenizers
  const interruptors = self.interruptBlockquote
  const now = eat.now()
  let currentLine = now.line
  let length = value.length
  const values: string[] = []
  const contents: string[] = []
  const indents: number[] = []
  let index = 0
  let character: string

  while (index < length) {
    character = value.charAt(index)
    if (character !== ' ' && character !== '\t') break
    index++
  }
  if (value.charAt(index) !== '>') return
  if (silent) return true

  index = 0
  let callout: any = null
  while (index < length) {
    let nextIndex = value.indexOf('\n', index)
    const startIndex = index
    let prefixed = false
    if (nextIndex === -1) nextIndex = length
    while (index < length) {
      character = value.charAt(index)
      if (character !== ' ' && character !== '\t') break
      index++
    }
    if (value.charAt(index) === '>') {
      index++
      prefixed = true
      if (value.charAt(index) === ' ') index++
    } else {
      index = startIndex
    }
    let content = value.slice(index, nextIndex)
    if (!prefixed && !content.trim()) {
      index = startIndex
      break
    }
    if (!prefixed) {
      const rest = value.slice(index)
      if (interrupt(interruptors, tokenizers, self, [eat, rest, true])) break
    }
    if (startIndex === 0) {
      const m = content.match(CALLOUT_REGEX)
      if (m) {
        const raw = m[1]
        let type = raw
        let data = ''
        const pipe = raw.indexOf('|')
        if (pipe !== -1) {
          type = raw.substr(0, pipe)
          data = raw.substr(pipe + 1)
        }
        callout = { type: type.trim().toLowerCase().replace(/\s+/g, '-'), fold: m[2], data }
        const len = m[0].length
        index += len
        content = content.substr(len)
      }
    }
    const line = startIndex === index ? content : value.slice(startIndex, nextIndex)
    indents.push(index - startIndex)
    values.push(line)
    contents.push(content)
    index = nextIndex + 1
  }

  index = -1
  length = indents.length
  const add = eat(values.join('\n'))
  while (++index < length) {
    offsets[currentLine] = (offsets[currentLine] || 0) + indents[index]
    currentLine++
  }
  const exit = self.enterBlock()
  let children: any[] = []
  if (callout && contents[0]) {
    children = self.tokenizeBlock(contents.shift(), now)
    now.line += 1
  }
  const rest = self.tokenizeBlock(contents.join('\n'), now)
  children.push(...rest)
  exit()
  return add({ type: 'blockquote', children, callout })
}

const looseListItemExpression = /\n\n(?!\s*$)/
const taskItemExpression = /^\[(.)][ \t]/
const bulletExpression = /^([ \t]*)([*+-]|\d+[.)])( {1,4}(?! )| |\t|$|(?=\n))([^\n]*)/
const pedanticBulletExpression = /^([ \t]*)([*+-]|\d+[.)])([ \t]+)/
const initialIndentExpression = /^( {1,4}|\t)?/gm

/** remark-parse list tokenizer; list items accept any task status character. */
function list(this: any, eat: any, value: string, silent: boolean): any {
  const self = this
  const commonmark = self.options.commonmark
  const pedantic = self.options.pedantic
  const tokenizers = self.blockTokenizers
  const interuptors = self.interruptList
  let index = 0
  let length = value.length
  let start: number | null = null
  let size: number
  let queue: string
  let ordered: boolean
  let character: string
  let marker: string
  let nextIndex: number
  let startIndex: number
  let prefixed: boolean
  let currentMarker: string | null
  let content: string
  let line: string
  let previousEmpty: boolean | undefined
  let empty: boolean | undefined
  let item: any
  let spread = false
  let end: number
  let indented: boolean

  while (index < length) {
    character = value.charAt(index)
    if (character !== '\t' && character !== ' ') break
    index++
  }
  character = value.charAt(index)
  if (character === '*' || character === '+' || character === '-') {
    marker = character
    ordered = false
  } else {
    ordered = true
    queue = ''
    while (index < length) {
      character = value.charAt(index)
      if (!isDecimal(character)) break
      queue += character
      index++
    }
    character = value.charAt(index)
    if (!queue || !(character === '.' || (commonmark && character === ')'))) return
    if (silent && queue !== '1') return
    start = parseInt(queue, 10)
    marker = character
  }
  character = value.charAt(++index)
  if (character !== ' ' && character !== '\t' && (pedantic || (character !== '\n' && character !== ''))) return
  if (silent) return true

  index = 0
  const items: any[] = []
  let allLines: string[] = []
  let emptyLines: string[] = []

  while (index < length) {
    nextIndex = value.indexOf('\n', index)
    startIndex = index
    prefixed = false
    indented = false
    if (nextIndex === -1) nextIndex = length
    size = 0
    while (index < length) {
      character = value.charAt(index)
      if (character === '\t') size += 4 - (size % 4)
      else if (character === ' ') size++
      else break
      index++
    }
    if (item && size >= item.indent) indented = true
    character = value.charAt(index)
    currentMarker = null
    if (!indented) {
      if (character === '*' || character === '+' || character === '-') {
        currentMarker = character
        index++
        size++
      } else {
        queue = ''
        while (index < length) {
          character = value.charAt(index)
          if (!isDecimal(character)) break
          queue += character
          index++
        }
        character = value.charAt(index)
        index++
        if (queue && (character === '.' || (commonmark && character === ')'))) {
          currentMarker = character
          size += queue.length + 1
        }
      }
      if (currentMarker) {
        character = value.charAt(index)
        if (character === '\t') {
          size += 4 - (size % 4)
          index++
        } else if (character === ' ') {
          end = index + 4
          while (index < end) {
            if (value.charAt(index) !== ' ') break
            index++
            size++
          }
          if (index === end && value.charAt(index) === ' ') {
            index -= 4 - 1
            size -= 4 - 1
          }
        } else if (character !== '\n' && character !== '') {
          currentMarker = null
        }
      }
    }
    if (currentMarker) {
      if (!pedantic && marker !== currentMarker) break
      prefixed = true
    } else {
      if (!commonmark && !indented && value.charAt(startIndex) === ' ') {
        indented = true
      } else if (commonmark && item) {
        indented = size >= item.indent || size > 4
      }
      prefixed = false
      index = startIndex
    }
    line = value.slice(startIndex, nextIndex)
    content = startIndex === index ? line : value.slice(index, nextIndex)
    if (currentMarker === '*' || currentMarker === '_' || currentMarker === '-') {
      if (tokenizers.thematicBreak.call(self, eat, line, true)) break
    }
    previousEmpty = empty
    empty = !prefixed && !content.trim().length
    if (indented && item) {
      item.value = item.value.concat(emptyLines, line)
      allLines = allLines.concat(emptyLines, line)
      emptyLines = []
    } else if (prefixed) {
      if (emptyLines.length !== 0) {
        spread = true
        item.value.push('')
        item.trail = emptyLines.concat()
      }
      item = { value: [line], indent: size, trail: [] }
      items.push(item)
      allLines = allLines.concat(emptyLines, line)
      emptyLines = []
    } else if (empty) {
      if (previousEmpty && !commonmark) break
      emptyLines.push(line)
    } else {
      if (previousEmpty) break
      if (interrupt(interuptors, tokenizers, self, [eat, line, true])) break
      item.value = item.value.concat(emptyLines, line)
      allLines = allLines.concat(emptyLines, line)
      emptyLines = []
    }
    index = nextIndex + 1
  }

  const node = eat(allLines.join('\n')).reset({ type: 'list', ordered, start, spread, children: [] })
  const enterTop = self.enterList()
  const exitBlockquote = self.enterBlock()
  index = -1
  length = items.length
  while (++index < length) {
    let text = items[index].value.join('\n')
    const now = eat.now()
    eat(text)(listItem(self, text, now), node)
    text = items[index].trail.join('\n')
    if (index !== length - 1) text += '\n'
    eat(text)
  }
  enterTop()
  exitBlockquote()
  return node
}

function listItem(ctx: any, value: string, position: any): any {
  const offsets = ctx.offset
  const fn = ctx.options.pedantic ? pedanticListItem : normalListItem
  let checked: boolean | null = null
  let checklist: string | null = null
  value = fn(ctx, value, position)
  if (ctx.options.gfm) {
    const task = value.match(taskItemExpression)
    if (task) {
      const indent = task[0].length
      checked = task[1] !== ' '
      checklist = task[1]
      offsets[position.line] += indent
      value = value.slice(indent)
    }
  }
  return {
    type: 'listItem',
    spread: looseListItemExpression.test(value),
    checked,
    checklist,
    children: ctx.tokenizeBlock(value, position)
  }
}

function pedanticListItem(ctx: any, value: string, position: any): string {
  const offsets = ctx.offset
  let line = position.line
  const replacer = ($0: string): string => {
    offsets[line] = (offsets[line] || 0) + $0.length
    line++
    return ''
  }
  value = value.replace(pedanticBulletExpression, replacer)
  line = position.line
  return value.replace(initialIndentExpression, replacer)
}

function normalListItem(ctx: any, value: string, position: any): string {
  const offsets = ctx.offset
  let line = position.line
  let max = ''
  let bullet = ''
  let rest = ''
  value = value.replace(bulletExpression, ($0: string, $1: string, $2: string, $3: string, $4: string) => {
    bullet = $1 + $2 + $3
    rest = $4
    if (Number($2) < 10 && bullet.length % 2 === 1) $2 = ' ' + $2
    max = $1 + ' '.repeat($2.length) + $3
    return max + rest
  })
  const lines = value.split('\n')
  const trimmedLines = removeIndent(value, getIndent(max).indent).split('\n')
  trimmedLines[0] = rest
  offsets[line] = (offsets[line] || 0) + bullet.length
  line++
  let index = 0
  const length = lines.length
  while (++index < length) {
    offsets[line] = (offsets[line] || 0) + lines[index].length - trimmedLines[index].length
    line++
  }
  return trimmedLines.join('\n')
}

// ---------------------------------------------------------------------------
// Syntax tokenizers
// ---------------------------------------------------------------------------
function installMark(P: any): void {
  addInline(
    P,
    'mark',
    'text',
    function (this: any, eat: any, value: string, silent: boolean) {
      if (!this.options.gfm || value.substr(0, 2) !== '==' || value.substr(0, 4) === '====' || isWs(value.charAt(2))) return
      let ch = ''
      let prev = ''
      let prevPrev = ''
      let content = ''
      let i = 1
      const len = value.length
      const now = eat.now()
      now.column += 2
      now.offset += 2
      while (++i < len) {
        ch = value.charAt(i)
        if (ch === '=' && prev === '=' && (!prevPrev || !isWs(prevPrev))) {
          if (silent) return true
          const hl = leadingHighlightColor(content)
          const inner = content.slice(hl.length)
          now.column += hl.length
          now.offset += hl.length
          return eat('==' + content + '==')({
            type: 'mark',
            children: this.tokenizeInline(inner, now),
            data: { hName: 'mark', hProperties: hl ? { 'data-highlight': hl.color } : undefined }
          })
        }
        content += prev
        prevPrev = prev
        prev = ch
      }
    },
    (value: string, from: number) => value.indexOf('==', from)
  )
}

function installWikilinks(P: any): void {
  const locatorRe = /!?\[\[/g
  const re = /^(!?)\[\[(.+?)]]/
  addInline(
    P,
    'ilink',
    'link',
    function (eat: any, value: string, silent: boolean) {
      const m = re.exec(value)
      if (!m) return
      const inner = m[2].trim()
      if (inner.indexOf('[[') !== -1) return false
      if (silent) return true
      const { href, title, isAlias } = parseLinktext(inner)
      if (m[1] === '!') {
        return eat(m[0])({
          type: 'iembed',
          href,
          title,
          data: {
            hName: 'span',
            hProperties: { className: 'internal-embed', src: href, alt: title },
            hChildren: [{ type: 'text', value: title }]
          }
        })
      }
      const props: any = { className: 'internal-link', href, dataHref: href }
      if (isAlias) {
        props['aria-label'] = linkDisplayText(href)
        props['data-tooltip-position'] = 'top'
      }
      return eat(m[0])({
        type: 'ilink',
        href,
        title,
        data: { hName: 'a', hProperties: props, hChildren: [{ type: 'text', value: title }] }
      })
    },
    (value: string, from: number) => {
      locatorRe.lastIndex = from
      const r = locatorRe.exec(value)
      return r ? r.index : -1
    }
  )
}

function installTags(P: any): void {
  const numeric = /^#\d+$/
  addInline(
    P,
    'tag',
    'image', // not an inline method ⇒ lands before the last entry (`text`)
    function (eat: any, value: string, silent: boolean) {
      const m = TAG_REGEX.exec(value)
      if (!m) return
      const tag = m[0]
      if (numeric.test(tag)) return false
      if (silent) return true
      return eat(tag)({
        type: 'tag',
        tag,
        data: { hName: 'a', hProperties: { className: 'tag', href: tag }, hChildren: [{ type: 'text', value: tag }] }
      })
    },
    (value: string, from: number) => {
      let i = from
      while ((i = value.indexOf('#', i)) !== -1) {
        if (i <= 0) return i
        if (isWs(value.charAt(i - 1))) return i
        i++
      }
      return undefined
    }
  )
}

function installInlineMath(P: any): void {
  addInline(
    P,
    'math',
    'text',
    function (eat: any, value: string, silent: boolean) {
      const len = value.length
      let display = false
      let escaped = false
      let i = 0
      let ch: number
      let next: number
      let contentStart: number
      let contentEnd = 0
      let end: number | undefined
      if (value.charCodeAt(i) === 92) {
        escaped = true
        i++
      }
      if (value.charCodeAt(i) !== 36) return
      i++
      if (escaped) return silent ? true : eat(value.slice(0, i))({ type: 'text', value: '$' })
      if (value.charCodeAt(i) === 36) {
        display = true
        i++
      }
      next = value.charCodeAt(i)
      if (!display && (next === 32 || next === 9)) return
      contentStart = i
      while (i < len) {
        ch = next
        next = value.charCodeAt(i + 1)
        if (ch === 36) {
          const before = value.charCodeAt(i - 1)
          if ((!display && before !== 32 && before !== 9 && (next !== next || next < 48 || next > 57)) || (display && next === 36)) {
            contentEnd = i - 1
            i++
            if (display) {
              let f = ++i
              while (f < len) {
                const c = value.charAt(f)
                if (c === '\n') {
                  i = f + 1
                  break
                }
                if (!/\s/.test(c)) break
                f++
              }
            }
            end = i
            break
          }
        } else if (ch === 92) {
          i++
          next = value.charCodeAt(i + 1)
        }
        i++
      }
      if (end === undefined) return
      if (silent) return true
      const content = value.slice(contentStart, contentEnd + 1)
      return eat(value.slice(0, end))({
        type: 'inlineMath',
        value: content,
        data: {
          hName: 'span',
          hProperties: { className: display ? 'math math-block' : 'math math-inline' },
          hChildren: [{ type: 'text', value: content }]
        }
      })
    },
    (value: string, from: number) => value.indexOf('$', from)
  )
}

function installBlockMath(P: any): void {
  addBlock(P, 'math', 'fencedCode', function (eat: any, value: string, silent: boolean) {
    const len = value.length
    let i = 0
    while (i < len && value.charCodeAt(i) === 32) i++
    const indent = i
    while (i < len && value.charCodeAt(i) === 36) i++
    const fence = i - indent
    if (fence < 2) return
    while (i < len && value.charCodeAt(i) === 32) i++
    const firstStart = i
    while (i < len) {
      const c = value.charCodeAt(i)
      if (c === 36) return
      if (c === 10) break
      i++
    }
    if (value.charCodeAt(i) !== 10) return
    if (silent) return true
    const lines: string[] = []
    if (firstStart !== i) lines.push(value.slice(firstStart, i))
    i++
    let lineEnd = value.indexOf('\n', i + 1)
    if (lineEnd === -1) lineEnd = len
    while (i < len) {
      let closed = false
      let s = i
      let e = lineEnd
      let a = lineEnd
      let dollars = 0
      while (a > s && value.charCodeAt(a - 1) === 32) a--
      while (a > s && value.charCodeAt(a - 1) === 36) {
        dollars++
        a--
      }
      if (fence <= dollars && value.indexOf('$', s) === a) {
        closed = true
        e = a
      }
      while (s <= e && s - i < indent && value.charCodeAt(s) === 32) s++
      if (closed) while (e > s && value.charCodeAt(e - 1) === 32) e--
      if (!(closed && s === e)) lines.push(value.slice(s, e))
      if (closed) break
      i = lineEnd + 1
      lineEnd = value.indexOf('\n', i + 1)
      if (lineEnd === -1) lineEnd = len
    }
    const content = lines.join('\n')
    return eat(value.slice(0, lineEnd))({
      type: 'math',
      value: content,
      data: { hName: 'div', hProperties: { className: 'math math-block' }, hChildren: [{ type: 'text', value: content }] }
    })
  })
  const proto = P.prototype
  addInterrupt(proto.interruptParagraph, 'fencedCode', 'math')
  addInterrupt(proto.interruptList, 'fencedCode', 'math')
  addInterrupt(proto.interruptBlockquote, 'fencedCode', 'math')
}

/** Run interruptors without option guards (used by footnote definitions). */
function interruptAny(list: any[][], tokenizers: any, ctx: any, params: any[]): boolean {
  for (let i = 0; i < list.length; i++) if (tokenizers[list[i][0]].apply(ctx, params)) return true
  return false
}

function installFootnotes(P: any): void {
  const proto = P.prototype
  const interruptors: any[][] = []
  for (const m of proto.blockMethods) {
    if (m !== 'newline' && m !== 'indentedCode' && m !== 'paragraph' && m !== 'footnoteDefinition') interruptors.push([m])
  }
  interruptors.push(['footnoteDefinition'])
  proto.interruptFootnoteDefinition = interruptors

  // ^[inline note]
  addInline(
    P,
    'inlineNote',
    'reference',
    function (this: any, eat: any, value: string, silent: boolean) {
      const len = value.length + 1
      let i = 0
      let depth = 0
      let close: number | undefined
      let fence: number | undefined
      let run: number | undefined
      if (value.charCodeAt(i++) !== 94 || value.charCodeAt(i++) !== 91) return
      const start = i
      while (i < len) {
        const c = value.charCodeAt(i)
        if (c !== c) return
        if (fence === undefined) {
          if (c === 92) i += 2
          else if (c === 91) {
            depth++
            i++
          } else if (c === 93) {
            if (depth === 0) {
              close = i
              i++
              break
            }
            depth--
            i++
          } else if (c === 96) {
            let n = 1
            while (value.charCodeAt(i + n) === 96) n++
            fence = n
            i += n
          } else i++
        } else if (c === 96) {
          let n = 1
          while (value.charCodeAt(i + n) === 96) n++
          run = n
          i += n
          if (fence === run) fence = undefined
          run = undefined
        } else i++
      }
      if (close === undefined) return
      if (silent) return true
      const now = eat.now()
      now.column += 2
      now.offset += 2
      return eat(value.slice(0, i))({ type: 'footnote', children: this.tokenizeInline(value.slice(start, close), now) })
    },
    (value: string, from: number) => value.indexOf('^[', from)
  )

  // [^id]: definition
  addBlock(P, 'footnoteDefinition', 'definition', function (this: any, eat: any, value: string, silent: boolean) {
    const self = this
    const interrupts = self.interruptFootnoteDefinition
    const offsets = self.offset
    let len = value.length + 1
    let k = 0
    const content: string[] = []
    let c: number
    while (k < len && ((c = value.charCodeAt(k)) === 9 || c === 32)) k++
    if (value.charCodeAt(k++) !== 91 || value.charCodeAt(k++) !== 94) return
    const idStart = k
    let idEnd: number | undefined
    while (k < len) {
      c = value.charCodeAt(k)
      if (c !== c || c === 10 || c === 9 || c === 32) return
      if (c === 93) {
        idEnd = k
        k++
        break
      }
      k++
    }
    if (idEnd === undefined || idStart === idEnd || value.charCodeAt(k++) !== 58) return
    if (silent) return true
    const label = value.slice(idStart, idEnd)
    const now = eat.now()
    let lineStart = 0
    let indent: number | undefined = 0
    let contentStart: number | undefined = k
    const lines: any[] = []
    let line: any
    while (k < len) {
      c = value.charCodeAt(k)
      if (c !== c || c === 10) {
        line = { start: lineStart, contentStart: contentStart || k, contentEnd: k, end: k }
        lines.push(line)
        if (c === 10) {
          lineStart = k + 1
          indent = 0
          contentStart = undefined
          line.end = lineStart
        }
      } else if (indent !== undefined) {
        if (c === 32 || c === 9) {
          indent += c === 32 ? 1 : 4 - (indent % 4)
          if (indent > 4) {
            indent = undefined
            contentStart = k
          }
        } else {
          if (
            indent < 4 &&
            line &&
            (line.contentStart === line.contentEnd ||
              interruptAny(interrupts, self.blockTokenizers, self, [eat, value.slice(k, 1024), true]))
          ) {
            break
          }
          indent = undefined
          contentStart = k
        }
      }
      k++
    }
    k = -1
    len = lines.length
    while (len > 0 && (line = lines[len - 1]).contentStart === line.contentEnd) len--
    const add = eat(value.slice(0, line.contentEnd))
    while (++k < len) {
      line = lines[k]
      offsets[now.line + k] = (offsets[now.line + k] || 0) + (line.contentStart - line.start)
      content.push(value.slice(line.contentStart, line.end))
    }
    const exit = self.enterBlock()
    const children = self.tokenizeBlock(content.join(''), now)
    exit()
    return add({ type: 'footnoteDefinition', identifier: label.toLowerCase(), label, children })
  })

  // [^id]
  addInline(
    P,
    'footnoteCall',
    'reference',
    function (eat: any, value: string, silent: boolean) {
      const len = value.length + 1
      let i = 0
      let close: number | undefined
      if (value.charCodeAt(i++) !== 91 || value.charCodeAt(i++) !== 94) return
      const start = i
      while (i < len) {
        const c = value.charCodeAt(i)
        if (c !== c || c === 10 || c === 9 || c === 32) return
        if (c === 93) {
          close = i
          i++
          break
        }
        i++
      }
      if (close === undefined || start === close) return
      if (silent) return true
      const label = value.slice(start, close)
      return eat(value.slice(0, i))({ type: 'footnoteReference', identifier: label.toLowerCase(), label })
    },
    (value: string, from: number) => value.indexOf('[', from)
  )

  const blockT = proto.blockTokenizers
  const inlineT = proto.inlineTokenizers
  const origDefinition = blockT.definition
  const origReference = inlineT.reference
  blockT.definition = function (this: any, eat: any, value: string, silent: boolean) {
    let i = 0
    let c = value.charCodeAt(i)
    while (c === 32 || c === 9) c = value.charCodeAt(++i)
    if (c === 91 && value.charCodeAt(i + 1) !== 94) return origDefinition.call(this, eat, value, silent)
  }
  const reference = function (this: any, eat: any, value: string, silent: boolean) {
    let i = 0
    if (value.charCodeAt(i) === 33) i++
    if (value.charCodeAt(i) === 91 && value.charCodeAt(i + 1) !== 94) return origReference.call(this, eat, value, silent)
  }
  ;(reference as any).locator = origReference.locator
  inlineT.reference = reference
}

function installBreaks(P: any): void {
  const t = P.prototype.inlineTokenizers
  const orig = t.break
  const brk = function (this: any, eat: any, value: string, silent: boolean) {
    if (!this.options.breaks) return orig.call(this, eat, value, silent)
    const len = value.length
    for (let i = 0; i < len; i++) {
      const c = value.charCodeAt(i)
      if (c === 10) return silent ? true : eat(value.slice(0, i + 1))({ type: 'break' })
      if (c !== 32) return
    }
  }
  ;(brk as any).locator = orig.locator
  t.break = brk
}

function installFrontmatter(P: any): void {
  const fn = function (eat: any, value: string, silent: boolean) {
    if (value.slice(0, 3) !== '---' || value.charAt(3) !== '\n') return
    let end = value.indexOf('---', 3)
    while (end !== -1 && value.charAt(end - 1) !== '\n') end = value.indexOf('---', end + 3)
    if (end === -1) return
    if (silent) return true
    return eat(value.slice(0, end + 3))({ type: 'yaml', value: value.slice(4, end - 1) })
  }
  ;(fn as any).onlyAtStart = true
  const proto = P.prototype
  proto.blockMethods.unshift('frontmatter')
  proto.blockTokenizers.frontmatter = fn
}

function installBlockIds(P: any): void {
  const inlineRe = /^\^([a-zA-Z0-9-]+)$/
  addInline(
    P,
    'blockid',
    'text',
    function (eat: any, value: string, silent: boolean) {
      const m = inlineRe.exec(value)
      if (!m) return
      if (silent) return true
      return eat(m[0])({ type: 'blockid', id: m[1] })
    },
    (value: string, from: number) => {
      let i = from
      while ((i = value.indexOf('^', i)) !== -1) {
        if (i <= 0) return -1
        if (isWs(value.charAt(i - 1))) return i
        i++
      }
      return undefined
    }
  )
  const blockRe = /^\^([a-zA-Z0-9-]+)(?=$|\n$|\n\n)/
  addBlock(P, 'blockid', 'paragraph', function (eat: any, value: string, silent: boolean) {
    const m = blockRe.exec(value)
    if (!m) return
    if (silent) return true
    return eat(m[0])({ type: 'blockid', id: m[1] })
  })
}

function installComments(P: any): void {
  const inlineRe = /^%%(.*?)%%/
  addInline(
    P,
    'comment',
    'text',
    function (this: any, eat: any, value: string, silent: boolean) {
      const m = inlineRe.exec(value)
      if (!m) return
      if (silent) return true
      const now = eat.now()
      now.column += 2
      now.offset += 2
      return eat(m[0])({ type: 'comment', children: this.tokenizeInline(m[1], now) })
    },
    (value: string, from: number) => value.indexOf('%%', from)
  )
  addBlock(P, 'comment', 'fencedCode', function (this: any, eat: any, value: string, silent: boolean) {
    const len = value.length
    let i = 0
    while (i < len && value.charCodeAt(i) === 32) i++
    if (value.charCodeAt(i) !== 37 || value.charCodeAt(i + 1) !== 37) return
    i += 2
    const start = i
    while (i < len) {
      const c = value.charCodeAt(i)
      if (c === 37) return
      if (c === 10) break
      i++
    }
    if (silent) return true
    let end = len
    while (i < len) {
      if (value.charCodeAt(i) === 37 && value.charCodeAt(i + 1) === 37) {
        end = i + 2
        break
      }
      i++
    }
    const content = value.substring(start, i)
    const now = eat.now()
    return eat(value.slice(0, end))({ type: 'comment', value: content, children: this.tokenizeInline(content, now) })
  })
  const proto = P.prototype
  addInterrupt(proto.interruptParagraph, 'fencedCode', 'comment')
  addInterrupt(proto.interruptList, 'fencedCode', 'comment')
  addInterrupt(proto.interruptBlockquote, 'fencedCode', 'comment')
}

/** Build the parser class. Extension order is the registration order. */
export function buildParser(): any {
  const P = createParserClass()
  P.prototype.blockTokenizers.blockquote = blockquote
  P.prototype.blockTokenizers.list = list
  installMark(P)
  installWikilinks(P)
  installTags(P)
  installInlineMath(P)
  installBlockMath(P)
  installFootnotes(P)
  installBreaks(P)
  installFrontmatter(P)
  installBlockIds(P)
  installComments(P)
  return P
}

export const QuartzParser = buildParser()
