// Adapted from @codemirror/language `stream-parser.ts` (MIT, (C) Marijn Haverbeke and others).
//
// A StreamLanguage variant that hosts a CodeMirror 5 mode such as "hypermd":
//   - every distinct token class string gets its own node type; the string (words sorted, `line-*`
//     words removed) is stored in `tokenClassProp`;
//   - `line-X` / `line-background-X` words of a line are collected (deduplicated, sorted) into one
//     extra node spanning the whole line, whose string is stored in `lineClassProp`;
//   - a `line-parse-next` word makes the parser continue past the viewport (the next line's
//     styling depends on this one);
//   - the StringStream has `lookAhead(n)` and the editor's indent unit.
// The `tokenClassPlugin` (classPlugin.ts) turns these nodes into `cm-*` marks and line classes.
import { Language, defineLanguageFacet, getIndentUnit, indentNodeProp, languageDataProp, ParseContext, IndentContext } from '@codemirror/language'
import type { Input, PartialParse, TreeFragment } from '@lezer/common'
import { Tree, NodeType, NodeSet, NodeProp, Parser } from '@lezer/common'
import type { Facet } from '@codemirror/state'
import { StringStream, readToken } from './stream.js'

/** CM5-style mode object (startState/copyState/token/blankLine/indent/innerMode). */
export interface LegacyMode<S = any> {
  name?: string
  token(stream: StringStream, state: S): string | null | undefined
  blankLine?(state: S, indentUnit: number): string | null | undefined
  startState?(indentUnit: number): S
  copyState?(state: S): S
  indent?(state: S, textAfter: string, cx: IndentContext): number | null
  innerMode?(state: S): { mode: LegacyMode; state: any }
  languageData?: { [name: string]: any }
}

/** Node prop holding the (sorted, `line-`-free) token class string of a token node. */
export const tokenClassProp = new NodeProp<string>()
/** Node prop holding the line class string of a whole-line node. */
export const lineClassProp = new NodeProp<string>()

const typeArray: NodeType[] = [NodeType.none]
const nodeSet = new NodeSet(typeArray)
const typeByKey: { [key: string]: number } = Object.create(null)
const typeByName: { [name: string]: NodeType } = Object.create(null)

/** Node type id for a class string (one node type per distinct string). */
function classNodeType(cls: string, isLine: boolean): number {
  if (!cls) return 0
  const key = (isLine ? 'L:' : 'T:') + cls
  const known = typeByKey[key]
  if (known) return known
  const name = cls.replace(/ /g, '_')
  let type = typeByName[name]
  if (!type) {
    type = typeByName[name] = NodeType.define({
      id: typeArray.length,
      name,
      props: [isLine ? lineClassProp.add({ [name]: cls }) : tokenClassProp.add({ [name]: cls })]
    })
    typeArray.push(type)
  }
  return (typeByKey[key] = type.id)
}

const lineWordRE = /^line-(background-)?(.*)$/

interface FullMode {
  name: string
  token: LegacyMode['token']
  blankLine: (state: any, indentUnit: number) => string | null | undefined
  startState: (indentUnit: number) => any
  copyState: (state: any) => any
  indent: (state: any, textAfter: string, cx: IndentContext) => number | null
  languageData: { [name: string]: any }
}

function defaultCopyState(state: any) {
  if (typeof state != 'object') return state
  const newState: any = {}
  for (const prop in state) {
    const val = state[prop]
    newState[prop] = val instanceof Array ? val.slice() : val
  }
  return newState
}

function fullMode(mode: LegacyMode): FullMode {
  return {
    name: mode.name || '',
    token: mode.token,
    blankLine: mode.blankLine ? mode.blankLine.bind(mode) : () => null,
    startState: mode.startState ? mode.startState.bind(mode) : () => true,
    copyState: mode.copyState ? mode.copyState.bind(mode) : defaultCopyState,
    indent: mode.indent ? mode.indent.bind(mode) : () => null,
    languageData: mode.languageData || {}
  }
}

const IndentedFrom = new WeakMap<object, number>()

export class HyperMDStreamLanguage extends Language {
  /** @internal */ streamParser: FullMode
  /** @internal */ stateAfter: NodeProp<any>

  private constructor(mode: LegacyMode) {
    const data = defineLanguageFacet(mode.languageData)
    const p = fullMode(mode)
    let self: HyperMDStreamLanguage
    const impl = new (class extends Parser {
      createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]): PartialParse {
        return new Parse(self, input, fragments, ranges)
      }
    })()
    super(data, impl, [], mode.name)
    ;(this as any).topNode = docID(data, this)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    self = this
    this.streamParser = p
    this.stateAfter = new NodeProp({ perNode: true })
  }

  static define(mode: LegacyMode) { return new HyperMDStreamLanguage(mode) }

  /** @internal */
  getIndent(cx: any): number | null {
    let from: number | undefined = undefined
    const { overrideIndentation } = cx.options as any
    if (overrideIndentation) {
      from = IndentedFrom.get(cx.state)
      if (from != null && from < cx.pos - 1e4) from = undefined
    }
    const node = (cx as any).node ?? { tree: Tree.empty, from: 0 }
    const start = findState(this, node.tree, node.from, node.from, from ?? cx.pos)
    let statePos: number, state: any
    if (start) { state = start.state; statePos = start.pos + 1 }
    else { state = this.streamParser.startState(cx.unit); statePos = node.from }
    if (cx.pos - statePos > 10000) return null
    const doc = cx.state.doc
    while (statePos < cx.pos) {
      const line = doc.lineAt(statePos), end = Math.min(cx.pos, line.to)
      if (line.length) {
        const indentation = overrideIndentation ? overrideIndentation(line.from) : -1
        const stream = new StringStream(line.text, cx.state.tabSize, cx.unit,
          (n: number) => (n + line.number > doc.lines ? '' : doc.line(n + line.number).text),
          indentation < 0 ? undefined : indentation)
        while (stream.pos < end - line.from) readToken(this.streamParser.token, stream, state)
      } else {
        this.streamParser.blankLine(state, cx.unit)
      }
      if (end == cx.pos) break
      statePos = line.to + 1
    }
    const line = cx.lineAt(cx.pos)
    if (overrideIndentation && from == null) IndentedFrom.set(cx.state, line.from)
    return this.streamParser.indent(state, /^\s*(.*)/.exec(line.text)![1], cx)
  }

  get allowsNesting() { return false }
}

function findState(lang: HyperMDStreamLanguage, tree: Tree, off: number, startPos: number, before: number): { state: any; pos: number } | null {
  const state = off >= startPos && off + tree.length <= before && tree.prop(lang.stateAfter)
  if (state) return { state: lang.streamParser.copyState(state), pos: off + tree.length }
  for (let i = tree.children.length - 1; i >= 0; i--) {
    const child = tree.children[i], pos = off + tree.positions[i]
    const found = child instanceof Tree && pos < before && findState(lang, child, pos, startPos, before)
    if (found) return found
  }
  return null
}

function cutTree(lang: HyperMDStreamLanguage, tree: Tree, from: number, to: number, inside: boolean): Tree | null {
  if (inside && from <= 0 && to >= tree.length) return tree
  if (!inside && from == 0 && tree.type == (lang as any).topNode) inside = true
  for (let i = tree.children.length - 1; i >= 0; i--) {
    const pos = tree.positions[i], child = tree.children[i]
    let inner
    if (pos < to && child instanceof Tree) {
      if (!(inner = cutTree(lang, child, from - pos, to - pos, inside))) break
      return !inside ? inner
        : new Tree(tree.type, tree.children.slice(0, i).concat(inner), tree.positions.slice(0, i + 1), pos + inner.length)
    }
  }
  return null
}

function findStartInFragments(lang: HyperMDStreamLanguage, fragments: readonly TreeFragment[], startPos: number, endPos: number, editorState?: any) {
  for (const f of fragments) {
    const from = f.from + (f.openStart ? 25 : 0), to = f.to - (f.openEnd ? 25 : 0)
    const found = from <= startPos && to > startPos && findState(lang, f.tree, 0 - f.offset, startPos, to)
    let tree
    if (found && found.pos <= endPos && (tree = cutTree(lang, f.tree, startPos + f.offset, found.pos + f.offset, false)))
      return { state: found.state, tree }
  }
  return { state: lang.streamParser.startState(editorState ? getIndentUnit(editorState) : 4), tree: Tree.empty }
}

const ChunkSize = 512
/** Parse this far past the viewport end. */
const ParseAheadOfViewport = 5000

class Parse implements PartialParse {
  state: any
  parsedPos: number
  stoppedAt: number | null = null
  chunks: Tree[] = []
  chunkPos: number[] = []
  chunkStart: number
  chunk: number[] = []
  chunkReused: Tree[] | undefined = undefined
  rangeIndex = 0
  to: number
  /** raw style -> [token class, line classes] */
  tokenCache: { [style: string]: [string, string[]] } = Object.create(null)

  constructor(readonly lang: HyperMDStreamLanguage, readonly input: Input, readonly fragments: readonly TreeFragment[], readonly ranges: readonly { from: number; to: number }[]) {
    this.to = ranges[ranges.length - 1].to
    const context = ParseContext.get(), from = ranges[0].from
    const { state, tree } = findStartInFragments(lang, fragments, from, this.to, context?.state)
    this.state = state
    this.parsedPos = this.chunkStart = from + tree.length
    for (let i = 0; i < tree.children.length; i++) {
      this.chunks.push(tree.children[i] as Tree)
      this.chunkPos.push(tree.positions[i])
    }
    if (context && this.parsedPos < context.viewport.from - 100000 &&
        ranges.some(r => r.from <= context.viewport.from && r.to >= context.viewport.from)) {
      this.state = this.lang.streamParser.startState(getIndentUnit(context.state))
      context.skipUntilInView(this.parsedPos, context.viewport.from)
      this.parsedPos = context.viewport.from
    }
    this.moveRangeIndex()
  }

  get parsedPosition() { return this.parsedPos }

  advance() {
    const context = ParseContext.get()
    const parseEnd = this.stoppedAt == null ? this.to : Math.min(this.to, this.stoppedAt)
    let end = Math.min(parseEnd, this.chunkStart + ChunkSize)
    const viewEnd = context ? context.viewport.to + ParseAheadOfViewport : Infinity
    if (context) end = Math.min(end, viewEnd)
    let parseNext = false
    while (this.parsedPos < end) parseNext = this.parseLine(context)
    // a line marked `line-parse-next` forces the following line to be parsed too
    while (parseNext && this.parsedPos < this.to) parseNext = this.parseLine(context)
    if (this.chunkStart < this.parsedPos) this.finishChunk()
    if (this.parsedPos >= parseEnd) return this.finish()
    if (context && this.parsedPos >= viewEnd) {
      context.skipUntilInView(this.parsedPos - ParseAheadOfViewport, parseEnd)
      return this.finish()
    }
    return null
  }

  stopAt(pos: number) { this.stoppedAt = pos }

  lineAfter(pos: number) {
    let chunk = this.input.chunk(pos)
    if (!this.input.lineChunks) {
      const eol = chunk.indexOf('\n')
      if (eol > -1) chunk = chunk.slice(0, eol)
    } else if (chunk == '\n') {
      chunk = ''
    }
    return pos + chunk.length <= this.to ? chunk : chunk.slice(0, this.to - pos)
  }

  nextLine() {
    const from = this.parsedPos
    let line = this.lineAfter(from), end = from + line.length
    for (let index = this.rangeIndex; ;) {
      const rangeEnd = this.ranges[index].to
      if (rangeEnd >= end) break
      line = line.slice(0, rangeEnd - (end - line.length))
      index++
      if (index == this.ranges.length) break
      const rangeStart = this.ranges[index].from
      const after = this.lineAfter(rangeStart)
      line += after
      end = rangeStart + after.length
    }
    return { line, end }
  }

  skipGapsTo(pos: number, offset: number, side: -1 | 1) {
    for (;;) {
      const end = this.ranges[this.rangeIndex].to, offPos = pos + offset
      if (side > 0 ? end > offPos : end >= offPos) break
      const start = this.ranges[++this.rangeIndex].from
      offset += start - end
    }
    return offset
  }

  moveRangeIndex() {
    while (this.ranges[this.rangeIndex].to < this.parsedPos) this.rangeIndex++
  }

  emitToken(id: number, from: number, to: number, size: number, offset: number) {
    if (this.ranges.length > 1) {
      offset = this.skipGapsTo(from, offset, 1)
      from += offset
      const len0 = this.chunk.length
      offset = this.skipGapsTo(to, offset, -1)
      to += offset
      size += this.chunk.length - len0
    }
    this.chunk.push(id, from, to, size)
    return offset
  }

  /** Tokenize one line; returns true when the line asked for the next line to be parsed too. */
  parseLine(context: ParseContext | null): boolean {
    const { line, end } = this.nextLine()
    let offset = 0
    const { streamParser } = this.lang
    const cache = this.tokenCache
    const lineStart = this.parsedPos
    const stream = new StringStream(line, context ? context.state.tabSize : 4, context ? getIndentUnit(context.state) : 2, (n: number) => {
      let pos = this.parsedPos
      for (let i = 0; i < n; i++) {
        pos += this.lineAfter(pos).length
        if (pos < this.input.length) pos++
      }
      return this.lineAfter(pos)
    })
    const spans: { cls: string; from: number; to: number }[] = []
    const lineClasses = new Set<string>()
    if (stream.eol()) {
      const style = streamParser.blankLine(this.state, stream.indentUnit)
      if (style) for (const w of style.split(' ')) {
        if (!w) continue
        const m = w.match(lineWordRE)
        if (m) lineClasses.add(m[2])
      }
    } else {
      let last: { cls: string; from: number; to: number } | null = null
      while (!stream.eol()) {
        const style = readToken(streamParser.token, stream, this.state)
        if (!style) continue
        let entry = cache[style]
        if (!entry) {
          const lineWords: string[] = []
          const words = (style as string).split(" ").filter((w: string) => {
            if (!w) return false
            const m = w.match(lineWordRE)
            if (!m) return true
            lineWords.push(m[2])
            return false
          })
          entry = cache[style] = [words.sort().join(' '), lineWords]
        }
        for (const lw of entry[1]) lineClasses.add(lw)
        const from = lineStart + stream.start, to = lineStart + stream.pos
        if (last && last.cls === entry[0] && last.to === from) last.to = to
        else spans.push((last = { cls: entry[0], from, to }))
      }
      for (const s of spans) offset = this.emitToken(classNodeType(s.cls, false), s.from, s.to, 4, offset)
    }
    const parseNext = lineClasses.delete('parse-next')
    if (lineClasses.size > 0) {
      // the line node wraps the token nodes of the line
      offset = this.emitToken(classNodeType(Array.from(lineClasses).sort().join(' '), true), lineStart, lineStart + line.length, 4 * (spans.length + 1), offset)
    }
    this.parsedPos = end
    this.moveRangeIndex()
    if (this.parsedPos < this.to) this.parsedPos++
    return parseNext
  }

  finishChunk() {
    let tree = Tree.build({
      buffer: this.chunk,
      start: this.chunkStart,
      length: this.parsedPos - this.chunkStart,
      nodeSet,
      topID: 0,
      maxBufferLength: ChunkSize,
      reused: this.chunkReused
    })
    tree = new Tree(tree.type, tree.children, tree.positions, tree.length, [[this.lang.stateAfter, this.lang.streamParser.copyState(this.state)]])
    this.chunks.push(tree)
    this.chunkPos.push(this.chunkStart - this.ranges[0].from)
    this.chunk = []
    this.chunkReused = undefined
    this.chunkStart = this.parsedPos
  }

  finish() {
    return new Tree((this.lang as any).topNode, this.chunks, this.chunkPos, this.parsedPos - this.ranges[0].from).balance()
  }
}

function docID(data: Facet<{ [name: string]: any }>, lang: HyperMDStreamLanguage) {
  const type = NodeType.define({
    id: typeArray.length,
    name: 'Document',
    props: [
      languageDataProp.add(() => data),
      indentNodeProp.add(() => (cx: any) => lang.getIndent(cx))
    ],
    top: true
  })
  typeArray.push(type)
  return type
}
