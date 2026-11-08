/* eslint-disable @typescript-eslint/no-explicit-any */
// The app's Markdown dialect as an mdast parser: remark-parse@8
// configured {commonmark, breaks}, plus syntax extensions: ==highlight==, [[wikilinks]] and
// ![[embeds]], #tags, $math$/$$math$$, footnotes (^[inline], [^def]:, [^ref]),
// frontmatter, ^block-ids, %%comments%%, callouts, custom task characters and the
// table/blockquote changes. Output node types: ilink, iembed, tag,
// mark, inlineMath, math, comment, blockid, yaml, callout, fnRef…
import remarkParse from 'remark-parse'
import interrupt from 'remark-parse/lib/util/interrupt.js'
import list from './vendor/list'
import table from './vendor/table'
import blockquote from './vendor/blockquote'
import tokenizerFactory from './vendor/tokenizer'
import { isInternalUrl, normalizeHref, parseWikilinkInner } from '../linktext'
import { visit, type MdNode } from './visit'

const BaseParser: any = (remarkParse as any).Parser

type Tokenizer = ((this: any, eat: any, value: string, silent?: boolean) => any) & {
  locator?: (value: string, fromIndex: number) => number | undefined
  onlyAtStart?: boolean
}

function QuartzParser(this: any, doc: string, file: any) {
  BaseParser.call(this, doc, file)
}
QuartzParser.prototype = Object.create(BaseParser.prototype)
const proto: any = QuartzParser.prototype
proto.constructor = QuartzParser
proto.tokenizeBlock = tokenizerFactory('block')
proto.tokenizeInline = tokenizerFactory('inline')
proto.tokenizeFactory = tokenizerFactory
proto.blockTokenizers = { ...BaseParser.prototype.blockTokenizers, list, table, blockquote }
proto.inlineTokenizers = { ...BaseParser.prototype.inlineTokenizers }
proto.blockMethods = BaseParser.prototype.blockMethods.slice()
proto.inlineMethods = BaseParser.prototype.inlineMethods.slice()
proto.interruptParagraph = BaseParser.prototype.interruptParagraph.map((x: any[]) => x.slice())
proto.interruptList = BaseParser.prototype.interruptList.map((x: any[]) => x.slice())
proto.interruptBlockquote = BaseParser.prototype.interruptBlockquote.map((x: any[]) => x.slice())

function addInline(name: string, before: string, tok: Tokenizer, locator: Tokenizer['locator']): void {
  tok.locator = locator
  proto.inlineTokenizers[name] = tok
  const m: string[] = proto.inlineMethods
  m.splice(m.indexOf(before), 0, name)
}
function addBlock(name: string, before: string, tok: Tokenizer): void {
  proto.blockTokenizers[name] = tok
  const m: string[] = proto.blockMethods
  m.splice(m.indexOf(before), 0, name)
}
function insertInterruptAfter(listRef: any[][], after: string, name: string): void {
  let i = 0
  while (i < listRef.length && listRef[i][0] !== after) i++
  listRef.splice(i + 1, 0, [name])
}
const isWs = (c: string): boolean => /\s/.test(c)

// ---- ==highlight== ------------------------------------------------------------------
const HIGHLIGHT_COLORS: Record<string, string> = {
  '🔴': 'red', '🟥': 'red', '🟠': 'orange', '🟧': 'orange', '🟡': 'yellow', '🟨': 'yellow',
  '🟢': 'green', '🟩': 'green', '🔵': 'blue', '🟦': 'blue', '🟣': 'purple', '🟪': 'purple'
}
function highlightColor(s: string): { color: string; length: number } {
  const cp = s.codePointAt(0)
  const ch = cp === undefined ? '' : String.fromCodePoint(cp)
  const color = HIGHLIGHT_COLORS[ch] ?? ''
  return { color, length: color ? ch.length : 0 }
}
addInline(
  'mark',
  'text',
  function (eat, value, silent) {
    if (!this.options.gfm || value.substr(0, 2) !== '==' || value.substr(0, 4) === '====' || isWs(value.charAt(2))) return
    let cur = ''
    let prev = ''
    let prevPrev = ''
    let content = ''
    let i = 1
    const len = value.length
    const now = eat.now()
    now.column += 2
    now.offset += 2
    while (++i < len) {
      cur = value.charAt(i)
      if (cur === '=' && prev === '=' && (!prevPrev || !isWs(prevPrev))) {
        if (silent) return true
        const hl = highlightColor(content)
        const inner = content.slice(hl.length)
        now.column += hl.length
        now.offset += hl.length
        return eat('==' + content + '==')({
          type: 'mark',
          children: this.tokenizeInline(inner, now),
          data: { hName: 'mark', hProperties: hl.length ? { 'data-highlight': hl.color } : undefined }
        })
      }
      content += prev
      prevPrev = prev
      prev = cur
    }
  },
  (value, from) => value.indexOf('==', from)
)

// ---- [[wikilinks]] / ![[embeds]] --------------------------------------------------
const WIKILINK = /^(!?)\[\[(.+?)]]/
const WIKILINK_START = /!?\[\[/g
addInline(
  'ilink',
  'link',
  function (eat, value, silent) {
    const m = WIKILINK.exec(value)
    if (!m) return
    const inner = m[2].trim()
    if (inner.indexOf('[[') !== -1) return false
    if (silent) return true
    const { href, title } = parseWikilinkInner(inner)
    if (m[1] === '!') return eat(m[0])({ type: 'iembed', href, title })
    return eat(m[0])({ type: 'ilink', href, title })
  },
  (value, from) => {
    WIKILINK_START.lastIndex = from
    const m = WIKILINK_START.exec(value)
    return m ? m.index : -1
  }
)

// ---- #tags --------------------------------------------------------------------------
export const TAG_PATTERN = /^#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+/
addInline(
  'tag',
  'image', // not an inline method: inserted before the last one ("text")
  function (eat, value, silent) {
    const m = TAG_PATTERN.exec(value)
    if (!m) return
    const tag = m[0]
    if (/^#\d+$/.test(tag)) return false
    return silent || eat(tag)({ type: 'tag', tag })
  },
  (value, from) => {
    let i = from
    while ((i = value.indexOf('#', i)) !== -1) {
      if (i <= 0) return i
      if (/\s/.test(value.charAt(i - 1))) return i
      i++
    }
    return undefined
  }
)

// ---- $inline math$ ------------------------------------------------------------------
addInline(
  'math',
  'text',
  function (eat, value, silent) {
    const len = value.length
    let double = false
    let escaped = false
    let i = 0
    if (value.charCodeAt(i) === 92) {
      escaped = true
      i++
    }
    if (value.charCodeAt(i) !== 36) return
    i++
    if (escaped) return silent || eat(value.slice(0, i))({ type: 'text', value: '$' })
    if (value.charCodeAt(i) === 36) {
      double = true
      i++
    }
    let next = value.charCodeAt(i)
    if (!double && (next === 32 || next === 9)) return
    const start = i
    let contentEnd = 0
    let end: number | undefined
    while (i < len) {
      const code = next
      next = value.charCodeAt(i + 1)
      if (code === 36) {
        const prev = value.charCodeAt(i - 1)
        if ((!double && prev !== 32 && prev !== 9 && (next !== next || next < 48 || next > 57)) || (double && next === 36)) {
          contentEnd = i - 1
          i++
          if (double) {
            for (let d = ++i; d < len; ) {
              const ch = value.charAt(d)
              if (ch === '\n') {
                i = d + 1
                break
              }
              if (!/\s/.test(ch)) break
              d++
            }
          }
          end = i
          break
        }
      } else if (code === 92) {
        i++
        next = value.charCodeAt(i + 1)
      }
      i++
    }
    if (end === undefined) return
    if (silent) return true
    const content = value.slice(start, contentEnd + 1)
    return eat(value.slice(0, end))({ type: 'inlineMath', value: content })
  },
  (value, from) => value.indexOf('$', from)
)

// ---- $$ block math $$ ---------------------------------------------------------------
addBlock('math', 'fencedCode', function (eat, value, silent) {
  const len = value.length
  let i = 0
  while (i < len && value.charCodeAt(i) === 32) i++
  const indent = i
  while (i < len && value.charCodeAt(i) === 36) i++
  const fence = i - indent
  if (fence < 2) return
  while (i < len && value.charCodeAt(i) === 32) i++
  const infoStart = i
  while (i < len) {
    const c = value.charCodeAt(i)
    if (c === 36) return
    if (c === 10) break
    i++
  }
  if (value.charCodeAt(i) !== 10) return
  if (silent) return true
  const lines: string[] = []
  if (infoStart !== i) lines.push(value.slice(infoStart, i))
  i++
  let lineEnd = value.indexOf('\n', i + 1)
  if (lineEnd === -1) lineEnd = len
  while (i < len) {
    let closing = false
    let s = lineEnd
    let from = i
    let to = lineEnd
    let dollars = 0
    while (s > from && value.charCodeAt(s - 1) === 32) s--
    while (s > from && value.charCodeAt(s - 1) === 36) {
      dollars++
      s--
    }
    if (fence <= dollars && value.indexOf('$', from) === s) {
      closing = true
      to = s
    }
    while (from <= to && from - i < indent && value.charCodeAt(from) === 32) from++
    if (closing) while (to > from && value.charCodeAt(to - 1) === 32) to--
    if (!(closing && from === to)) lines.push(value.slice(from, to))
    if (closing) break
    i = lineEnd + 1
    lineEnd = value.indexOf('\n', i + 1)
    if (lineEnd === -1) lineEnd = len
  }
  const content = lines.join('\n')
  return eat(value.slice(0, lineEnd))({ type: 'math', value: content })
})
insertInterruptAfter(proto.interruptParagraph, 'fencedCode', 'math')
insertInterruptAfter(proto.interruptList, 'fencedCode', 'math')
insertInterruptAfter(proto.interruptBlockquote, 'fencedCode', 'math')

// ---- footnotes ----------------------------------------------------------------------
{
  const fdInterrupt: string[][] = []
  for (const m of proto.blockMethods as string[]) {
    if (m !== 'newline' && m !== 'indentedCode' && m !== 'paragraph' && m !== 'footnoteDefinition') fdInterrupt.push([m])
  }
  fdInterrupt.push(['footnoteDefinition'])
  proto.interruptFootnoteDefinition = fdInterrupt
  const anyInterrupts = (list: string[][], tokenizers: any, ctx: any, params: any[]): boolean => {
    for (const [name] of list) if (tokenizers[name].apply(ctx, params)) return true
    return false
  }

  addInline(
    'inlineNote',
    'reference',
    function (eat, value, silent) {
      const len = value.length + 1
      let i = 0
      let depth = 0
      let fence: number | undefined
      let end: number | undefined
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
              end = i
              i++
              break
            }
            depth--
            i++
          } else if (c === 96) {
            let n = 1
            while (value.charCodeAt(i + n) === 96) n++
            i += n
            fence = n
          } else i++
        } else if (c === 96) {
          let n = 1
          while (value.charCodeAt(i + n) === 96) n++
          i += n
          if (fence === n) fence = undefined
        } else i++
      }
      if (end === undefined) return
      if (silent) return true
      const now = eat.now()
      now.column += 2
      now.offset += 2
      return eat(value.slice(0, i))({ type: 'footnote', children: this.tokenizeInline(value.slice(start, end), now) })
    },
    (value, from) => value.indexOf('^[', from)
  )

  addBlock('footnoteDefinition', 'definition', function (eat, value, silent) {
    const self = this
    const offsets = self.offset
    let len = value.length + 1
    let i = 0
    let c = 0
    while (i < len && ((c = value.charCodeAt(i)) === 9 || c === 32)) i++
    if (value.charCodeAt(i++) !== 91 || value.charCodeAt(i++) !== 94) return
    const labelStart = i
    let labelEnd: number | undefined
    while (i < len) {
      c = value.charCodeAt(i)
      if (c !== c || c === 10 || c === 9 || c === 32) return
      if (c === 93) {
        labelEnd = i
        i++
        break
      }
      i++
    }
    if (labelEnd === undefined || labelStart === labelEnd || value.charCodeAt(i++) !== 58) return
    if (silent) return true
    const label = value.slice(labelStart, labelEnd)
    const now = eat.now()
    let lineStart = 0
    let size: number | undefined = 0
    let contentStart: number | undefined = i
    type Chunk = { start: number; contentStart: number; contentEnd: number; end: number }
    const chunks: Chunk[] = []
    let chunk: Chunk | undefined
    while (i < len) {
      c = value.charCodeAt(i)
      if (c !== c || c === 10) {
        chunk = { start: lineStart, contentStart: contentStart || i, contentEnd: i, end: i }
        chunks.push(chunk)
        if (c === 10) {
          lineStart = i + 1
          size = 0
          contentStart = undefined
          chunk.end = lineStart
        }
      } else if (size !== undefined) {
        if (c === 32 || c === 9) {
          size += c === 32 ? 1 : 4 - (size % 4)
          if (size > 4) {
            size = undefined
            contentStart = i
          }
        } else {
          if (
            size < 4 &&
            chunk &&
            (chunk.contentStart === chunk.contentEnd ||
              anyInterrupts(self.interruptFootnoteDefinition, self.blockTokenizers, self, [eat, value.slice(i, 1024), true]))
          )
            break
          size = undefined
          contentStart = i
        }
      }
      i++
    }
    len = chunks.length
    while (len > 0 && (chunk = chunks[len - 1]).contentStart === chunk.contentEnd) len--
    const add = eat(value.slice(0, chunk!.contentEnd))
    const parts: string[] = []
    for (let k = 0; k < len; k++) {
      const ch = chunks[k]
      offsets[now.line + k] = (offsets[now.line + k] || 0) + (ch.contentStart - ch.start)
      parts.push(value.slice(ch.contentStart, ch.end))
    }
    const exit = self.enterBlock()
    const children = self.tokenizeBlock(parts.join(''), now)
    exit()
    return add({ type: 'footnoteDefinition', identifier: label.toLowerCase(), label, children })
  })

  addInline(
    'footnoteCall',
    'reference',
    function (eat, value, silent) {
      const len = value.length + 1
      let i = 0
      if (value.charCodeAt(i++) !== 91 || value.charCodeAt(i++) !== 94) return
      const start = i
      let end: number | undefined
      while (i < len) {
        const c = value.charCodeAt(i)
        if (c !== c || c === 10 || c === 9 || c === 32) return
        if (c === 93) {
          end = i
          i++
          break
        }
        i++
      }
      if (end === undefined || start === end) return
      if (silent) return true
      const label = value.slice(start, end)
      return eat(value.slice(0, i))({ type: 'footnoteReference', identifier: label.toLowerCase(), label })
    },
    (value, from) => value.indexOf('[', from)
  )

  const origDefinition = proto.blockTokenizers.definition
  proto.blockTokenizers.definition = function (this: any, eat: any, value: string, silent?: boolean) {
    let i = 0
    let c = value.charCodeAt(i)
    while (c === 32 || c === 9) c = value.charCodeAt(++i)
    if (c === 91 && value.charCodeAt(i + 1) !== 94) return origDefinition.call(this, eat, value, silent)
  }
  const origReference = proto.inlineTokenizers.reference
  const reference: Tokenizer = function (this: any, eat: any, value: string, silent?: boolean) {
    let i = 0
    if (value.charCodeAt(i) === 33) i++
    if (value.charCodeAt(i) === 91 && value.charCodeAt(i + 1) !== 94) return origReference.call(this, eat, value, silent)
  }
  reference.locator = origReference.locator
  proto.inlineTokenizers.reference = reference
}

// ---- line breaks: with `breaks`, a single newline is a hard break ------------------
{
  const origBreak = proto.inlineTokenizers.break
  const brk: Tokenizer = function (this: any, eat: any, value: string, silent?: boolean) {
    if (!this.options.breaks) return origBreak.call(this, eat, value, silent)
    const len = value.length
    for (let i = 0; i < len; i++) {
      const c = value.charCodeAt(i)
      if (c === 10) return silent || eat(value.slice(0, i + 1))({ type: 'break' })
      if (c !== 32) return
    }
  }
  brk.locator = origBreak.locator
  proto.inlineTokenizers.break = brk
}

// ---- frontmatter ------------------------------------------------------------------
{
  const frontmatter: Tokenizer = function (eat, value, silent) {
    if (value.slice(0, 3) === '---' && value.charAt(3) === '\n') {
      let i = value.indexOf('---', 3)
      while (i !== -1 && value.charAt(i - 1) !== '\n') i = value.indexOf('---', i + 3)
      if (i !== -1) return silent || eat(value.slice(0, i + 3))({ type: 'yaml', value: value.slice(4, i - 1) })
    }
  }
  frontmatter.onlyAtStart = true
  proto.blockMethods.unshift('frontmatter')
  proto.blockTokenizers.frontmatter = frontmatter
}

// ---- ^block-ids -------------------------------------------------------------------
{
  const INLINE = /^\^([a-zA-Z0-9\-]+)$/
  addInline(
    'blockid',
    'text',
    function (eat, value, silent) {
      const m = INLINE.exec(value)
      if (m) return silent || eat(m[0])({ type: 'blockid', id: m[1] })
    },
    (value, from) => {
      let i = from
      while ((i = value.indexOf('^', i)) !== -1) {
        if (i <= 0) return -1
        if (/\s/.test(value.charAt(i - 1))) return i
        i++
      }
      return undefined
    }
  )
  const BLOCK = /^\^([a-zA-Z0-9\-]+)(?=$|\n$|\n\n)/
  addBlock('blockid', 'paragraph', function (eat, value, silent) {
    const m = BLOCK.exec(value)
    if (m) return silent || eat(m[0])({ type: 'blockid', id: m[1] })
  })
}

// ---- %%comments%% -----------------------------------------------------------------
{
  const INLINE = /^%%(.*?)%%/
  addInline(
    'comment',
    'text',
    function (eat, value, silent) {
      const m = INLINE.exec(value)
      if (!m) return
      if (silent) return true
      const now = eat.now()
      now.column += 2
      now.offset += 2
      return eat(m[0])({ type: 'comment', children: this.tokenizeInline(m[1], now) })
    },
    (value, from) => value.indexOf('%%', from)
  )
  addBlock('comment', 'fencedCode', function (eat, value, silent) {
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
  insertInterruptAfter(proto.interruptParagraph, 'fencedCode', 'comment')
  insertInterruptAfter(proto.interruptList, 'fencedCode', 'comment')
  insertInterruptAfter(proto.interruptBlockquote, 'fencedCode', 'comment')
}

// ---- tree transformers (run after parsing, in order) ------------------------------
function safeDecodeURI(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function transformLinks(root: MdNode): void {
  visit(root, 'link', (node, index, parent) => {
    const url = node.url
    if (url && isInternalUrl(url)) {
      let decoded: string
      try {
        decoded = decodeURI(url)
      } catch {
        return
      }
      const href = normalizeHref(decoded)
      parent!.children![index!] = { type: 'ilink', href, title: '', converted: true, data: { url }, children: node.children, position: node.position }
    }
  })
  visit(root, 'image', (node, index, parent) => {
    const url = node.url
    if (url && isInternalUrl(url)) {
      const href = normalizeHref(safeDecodeURI(url))
      parent!.children![index!] = { type: 'iembed', href, title: node.alt, children: node.children, position: node.position }
    }
  })
}

function transformFootnotes(root: MdNode): void {
  const order: { count: number; identifier: string }[] = []
  const content: Record<string, { children: MdNode[]; position: any; isInline?: boolean }> = {}
  const defined: Record<string, number> = {}
  const toRef = (node: MdNode, idx: number, n: number): void => {
    node.type = 'fnRef'
    node.data = {}
    if (!node.identifier && Object.prototype.hasOwnProperty.call(node, 'children')) {
      const c = node.children!
      const start = c[0]?.position?.start
      const end = c[c.length - 1]?.position?.end
      if (start && end) {
        node.data.contentPosition = { start, end }
        node.identifier = '[inline' + idx
      }
    }
    node.children = [{ type: 'element' }]
    void n
  }
  visit(root, 'footnoteDefinition', node => {
    const id = String(node.identifier)
    defined[':' + id] = -1
    content[':' + id] = { children: node.children!, position: node.position }
  })
  visit(root, ['footnote', 'footnoteReference'], node => {
    if (node.type === 'footnote') {
      const idx = order.length
      const key = String(idx)
      order.push({ count: 1, identifier: key })
      content[key] = { children: node.children!, position: node.position, isInline: !node.identifier && Object.prototype.hasOwnProperty.call(node, 'children') }
      toRef(node, idx, 0)
    } else {
      const key = String(node.identifier)
      if (!Object.prototype.hasOwnProperty.call(defined, ':' + key)) {
        node.type = 'text'
        node.value = key
        return
      }
      let idx = defined[':' + key]
      if (idx === -1) {
        idx = order.length
        defined[':' + key] = idx
        order.push({ count: 0, identifier: ':' + key })
      }
      const entry = order[idx]
      const n = entry.count
      entry.count++
      toRef(node, idx, n)
    }
  })
  const items: MdNode[] = []
  for (let i = 0; i < order.length; i++) {
    const entry = order[i]
    const def = content[entry.identifier]
    if (!def) continue
    let children = def.children
    const last = children[children.length - 1]
    if (last && last.type === 'paragraph') children = last.children!
    for (let k = 0; k < entry.count; k++) children.push({ type: 'element' })
    items.push({ type: 'listItem', synthetic: true, data: { isInline: def.isInline }, children: [{ type: 'paragraph', children: def.children }], position: def.position })
  }
  if (items.length) {
    const lastChild = root.children![root.children!.length - 1]
    const pt = lastChild ? { line: lastChild.position.end.line + 1, column: 1, offset: lastChild.position.end.offset } : { line: 1, column: 1, offset: 0 }
    const pos = { start: pt, end: pt }
    root.children = root.children!.concat(
      { type: 'text', value: '\n', position: pos },
      {
        type: 'element',
        position: pos,
        children: [
          { type: 'thematicBreak', position: pos },
          { type: 'list', position: pos, ordered: true, start: 1, spread: false, children: items }
        ]
      }
    )
  }
}

function transformBlockIds(root: MdNode): void {
  const nodes = root.children!
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type === 'blockid') {
      if (i > 0) nodes[i - 1].id = node.id
      nodes.splice(i, 1)
      i--
      continue
    }
    if (node.type === 'list') {
      visit(node, 'listItem', item => {
        let id: string | null = null
        visit(item, ['list', 'blockid'], n => {
          if (n.type === 'list') return 'skip'
          id = n.id
          return false
        })
        if (id) item.id = id
      })
      continue
    }
    let id: string | null = null
    visit(node, 'blockid', n => {
      id = n.id
    })
    if (id) node.id = id
  }
}

function transformCallouts(root: MdNode): void {
  visit(root, 'blockquote', node => {
    const callout = node.callout
    if (!callout) return
    node.type = 'callout'
    const out: MdNode[] = []
    const children = node.children!
    const first = children && children[0]
    if (first && first.position.start.line === node.position.start.line) {
      if (first.type === 'paragraph') {
        const inl = first.children!
        let s = 0
        let br: MdNode | undefined
        for (; s < inl.length; s++)
          if (inl[s].type === 'break') {
            br = inl[s]
            break
          }
        const rest = children.slice(1)
        if (br) {
          out.push({ type: 'callout-title', position: { start: first.position.start, end: br.position.start }, children: inl.slice(0, s) })
          first.position.start = br.position.end
          first.children = inl.slice(s + 1)
          rest.unshift(first)
        } else {
          out.push({ type: 'callout-title', position: first.position, children: inl })
        }
        if (rest.length > 0) out.push({ type: 'callout-content', position: { start: rest[0].position.start, end: rest[rest.length - 1].position.end }, children: rest })
      } else {
        out.push({ type: 'callout-title', position: first.position, children: [first] })
        const second = children[1]
        if (second) out.push({ type: 'callout-content', position: { start: second.position.start, end: children[children.length - 1].position.end }, children: children.slice(1) })
      }
    } else {
      const pos = { start: node.position.start, end: node.position.start }
      let title = callout.type.trim().replace(/\-/g, ' ').toLowerCase()
      title = title.charAt(0).toUpperCase() + title.substr(1)
      out.push({ type: 'callout-title', position: pos, children: [{ type: 'text', value: title, position: pos }] })
      if (first) out.push({ type: 'callout-content', position: node.position, children })
    }
    node.children = out
  })
}

/** A minimal stand-in for the vfile remark-parse expects. */
function makeFile(text: string): any {
  return {
    contents: text,
    toString: () => text,
    message: () => undefined,
    fail: (e: Error) => {
      throw e
    }
  }
}

export interface ParseOptions {
  commonmark?: boolean
  breaks?: boolean
}
const DEFAULT_OPTIONS: ParseOptions = { breaks: true, commonmark: true }

/** Parse markdown into mdast (with transformers applied). */
export function parseMarkdown(text: string, options: ParseOptions = DEFAULT_OPTIONS): MdNode {
  const file = makeFile(String(text))
  const parser = new (QuartzParser as any)(String(text), file)
  parser.setOptions(options)
  const root: MdNode = parser.parse()
  transformLinks(root)
  transformFootnotes(root)
  transformBlockIds(root)
  transformCallouts(root)
  return root
}
