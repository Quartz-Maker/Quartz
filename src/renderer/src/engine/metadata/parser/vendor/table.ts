// @ts-nocheck
// Based on remark-parse@8.0.3 lib/tokenize/table.js (MIT, (c) Titus Wormer).
// Modifications:
//  - rows stop when a line's leading-pipe style differs from the header row's;
//  - spaces inside a row are not eaten separately: each cell eats its padding and
//    records it as `padding: {start, end}`, and its inline content starts after it.
import { whitespace } from './util'

export default table

const tab = '\t'
const lineFeed = '\n'
const space = ' '
const dash = '-'
const colon = ':'
const backslash = '\\'
const verticalBar = '|'
const minColumns = 1
const minRows = 2
const left = 'left'
const center = 'center'
const right = 'right'

function padding(value) {
  let start = 0
  let end = 0
  for (let i = 0, n = value.length; i < n; i++) {
    const c = value[i]
    if (c !== tab && c !== space) break
    start += 1
  }
  for (let i = value.length - 1; i >= start; i--) {
    const c = value[i]
    if (c !== tab && c !== space) break
    end += 1
  }
  return { start, end }
}

function table(eat, value, silent) {
  const self = this
  if (!self.options.gfm) return

  let index = 0
  let lineCount = 0
  let length = value.length + 1
  const lines = []
  let noLeadingPipe

  while (index < length) {
    let lineIndex = value.indexOf(lineFeed, index)
    const pipeIndex = value.indexOf(verticalBar, index + 1)
    if (lineIndex === -1) lineIndex = value.length
    if (pipeIndex === -1 || pipeIndex > lineIndex) {
      if (lineCount < minRows) return
      break
    }
    const line = value.slice(index, lineIndex)
    if (lineCount === 0) noLeadingPipe = line[0] !== verticalBar
    else if ((noLeadingPipe && line[0] === verticalBar) || (!noLeadingPipe && line[0] !== verticalBar)) break
    lines.push(line)
    lineCount++
    index = lineIndex + 1
  }

  let subvalue = lines.join(lineFeed)
  const alignments = lines.splice(1, 1)[0] || []
  index = 0
  length = alignments.length
  lineCount--
  let alignment = false
  const align = []
  let hasDash
  let first

  while (index < length) {
    const character = alignments.charAt(index)
    if (character === verticalBar) {
      hasDash = null
      if (alignment === false) {
        if (first === false) return
      } else {
        align.push(alignment)
        alignment = false
      }
      first = false
    } else if (character === dash) {
      hasDash = true
      alignment = alignment || null
    } else if (character === colon) {
      if (alignment === left) alignment = center
      else if (hasDash && alignment === null) alignment = right
      else alignment = left
    } else if (!whitespace(character)) {
      return
    }
    index++
  }

  if (alignment !== false) align.push(alignment)
  if (align.length < minColumns) return
  if (silent) return true

  let position = -1
  const rows = []
  const node = eat(subvalue).reset({ type: 'table', align, children: rows })

  while (++position < lineCount) {
    const line = lines[position]
    const row = { type: 'tableRow', children: [] }
    if (position) eat(lineFeed)
    eat(line).reset(row, node)

    length = line.length + 1
    index = 0
    let queue = ''
    let cell = ''
    let preamble = true

    while (index < length) {
      let character = line.charAt(index)
      if (character === '' || character === verticalBar) {
        if (preamble) {
          eat(character)
        } else {
          if ((cell || character) && !preamble) {
            subvalue = cell
            if (queue.length > 1) {
              if (character) {
                subvalue += queue.slice(0, -1)
                queue = queue.charAt(queue.length - 1)
              } else {
                subvalue += queue
                queue = ''
              }
            }
            const pad = padding(subvalue)
            const inner = subvalue.slice(pad.start, subvalue.length - pad.end)
            const now = eat.now()
            now.offset += pad.start
            now.column += pad.start
            eat(subvalue)({ type: 'tableCell', padding: pad, children: self.tokenizeInline(inner, now) }, row)
          }
          eat(queue + character)
          queue = ''
          cell = ''
        }
      } else {
        if (queue) {
          cell += queue
          queue = ''
        }
        cell += character
        if (character === backslash && index !== length - 2) {
          cell += line.charAt(index + 1)
          index++
        }
      }
      preamble = false
      index++
    }

    if (!position) eat(lineFeed + alignments)
  }

  return node
}
