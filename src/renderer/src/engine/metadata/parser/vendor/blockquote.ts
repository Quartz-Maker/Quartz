// @ts-nocheck
// Based on remark-parse@8.0.3 lib/tokenize/blockquote.js (MIT, (c) Titus Wormer).
// MODIFIED: callout support. On the first line, `[!type|meta]+/-` after `>` marks a
// callout; that prefix is consumed (counted in the line offset), the rest of the first
// line is tokenized as its own block (the title) and the remaining lines separately.
import { trim } from './util'
import interrupt from 'remark-parse/lib/util/interrupt.js'

export default blockquote

const lineFeed = '\n'
const tab = '\t'
const space = ' '
const greaterThan = '>'
const calloutExpression = /^\[!([^\]]+)\]([+\-]?)(?:\s|$)/

function blockquote(eat, value, silent) {
  const self = this
  const offsets = self.offset
  const tokenizers = self.blockTokenizers
  const interruptors = self.interruptBlockquote
  const now = eat.now()
  let currentLine = now.line
  let length = value.length
  const values = []
  let contents = []
  const indents = []
  let index = 0
  let character
  let callout = null

  while (index < length) {
    character = value.charAt(index)
    if (character !== space && character !== tab) break
    index++
  }

  if (value.charAt(index) !== greaterThan) return
  if (silent) return true

  index = 0

  while (index < length) {
    let nextIndex = value.indexOf(lineFeed, index)
    const startIndex = index
    let prefixed = false
    if (nextIndex === -1) nextIndex = length

    while (index < length) {
      character = value.charAt(index)
      if (character !== space && character !== tab) break
      index++
    }

    if (value.charAt(index) === greaterThan) {
      index++
      prefixed = true
      if (value.charAt(index) === space) index++
    } else {
      index = startIndex
    }

    let content = value.slice(index, nextIndex)

    if (!prefixed && !trim(content)) {
      index = startIndex
      break
    }

    if (!prefixed) {
      const rest = value.slice(index)
      if (interrupt(interruptors, tokenizers, self, [eat, rest, true])) break
    }

    if (startIndex === 0) {
      const match = content.match(calloutExpression)
      if (match) {
        const raw = match[1]
        let type = raw
        let data = ''
        const bar = raw.indexOf('|')
        if (bar !== -1) {
          type = raw.substr(0, bar)
          data = raw.substr(bar + 1)
        }
        callout = { type: type.trim().toLowerCase().replace(/\s+/g, '-'), fold: match[2], data }
        const len = match[0].length
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
  const add = eat(values.join(lineFeed))

  while (++index < length) {
    offsets[currentLine] = (offsets[currentLine] || 0) + indents[index]
    currentLine++
  }

  const exit = self.enterBlock()
  let children = []
  if (callout && contents[0]) {
    children = self.tokenizeBlock(contents.shift(), now)
    now.line += 1
  }
  contents = self.tokenizeBlock(contents.join(lineFeed), now)
  children.push(...contents)
  exit()

  return add({ type: 'blockquote', children, callout })
}
