// Search query language: matcher tree evaluated per file (split from query.ts).
import type { FrontMatterCache, HeadingCache } from 'obsidian'
import {
  type InputKey, type MatchInput, type MatchResult, type PropertyMatch, type Range, type SearchResult, type ResultKey,
  PROPERTY_VALUE, SECTION_DATA, countMatches, escapeRegex, execAll, getRegex, mergeInto, mergeRanges, shiftRanges, wholeWordRegex
} from './queryCore'
import type { ParseState } from './queryParser'
import { LABELS, tokenEnd, type Token, type TokenType } from './queryTokens'

// ---------------------------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------------------------

export interface RequiredInputs {
  content?: boolean
}

export interface MatcherContext {
  matcherStack: Matcher[]
  token: Token
}

export abstract class Matcher {
  matchedTokens: Token[] = []
  abstract match(input: MatchInput): MatchResult
  abstract getInfo(): string
  abstract requiredInputs(): RequiredInputs
  eatToken(state: ParseState): void {
    this.matchedTokens.push(state.tokens[state.pos])
    state.pos++
  }
  /** Matcher stack + token under the cursor position `pos` (used by the search suggest). */
  getContext(pos: number): MatcherContext | null {
    for (const t of this.matchedTokens) if (pos >= t.pos && pos <= tokenEnd(t)) return { matcherStack: [this], token: t }
    return null
  }
}

/** `TRUE` / `FALSE` / `EMPTY` literal against a property value. */
export class LiteralMatcher extends Matcher {
  expected: boolean | null = null
  constructor(word: string) {
    super()
    if (word === 'TRUE') this.expected = true
    else if (word === 'FALSE') this.expected = false
  }
  match(input: MatchInput): MatchResult {
    const v = input.getData(PROPERTY_VALUE)
    return v === this.expected ? { content: [[0, String(v).length]] } : null
  }
  getInfo(): string {
    return this.expected === true ? LABELS.matchTrue : this.expected === false ? LABELS.matchFalse : LABELS.matchEmpty
  }
  requiredInputs(): RequiredInputs {
    return {}
  }
}

/** Matches every non-empty searched string with an empty range (`task:""`). */
export class AnyMatcher extends Matcher {
  match(input: MatchInput): MatchResult {
    const r: SearchResult = {}
    for (const k of input.keys) if (input.strings[k]) r[k] = [[0, 0]]
    return r
  }
  getInfo(): string {
    return ''
  }
  requiredInputs(): RequiredInputs {
    return {}
  }
}

function regexMatch(input: MatchInput, source: string, useGroup: boolean): MatchResult {
  const re = getRegex(source, input.caseSensitive)
  let any = false
  const r: SearchResult = {}
  for (const k of input.keys) {
    const ranges = execAll(re, input.strings[k], useGroup)
    if (ranges.length > 0) {
      r[k] = ranges
      any = true
    }
  }
  return any ? r : null
}

/** `/regex/` */
export class RegexMatcher extends Matcher {
  constructor(public regex: string) {
    super()
  }
  match(input: MatchInput): MatchResult {
    if (this.regex !== '') return regexMatch(input, this.regex, false)
    return undefined
  }
  getInfo(): string {
    return LABELS.matchRegex + '/' + this.regex + '/'
  }
  requiredInputs(): RequiredInputs {
    return { content: true }
  }
}

/** `[key]` / `[key:value]` */
export class PropertyMatcher extends Matcher {
  constructor(public key: Matcher, public value: Matcher | null) {
    super()
  }
  match(input: MatchInput): MatchResult {
    if (!input.has('content')) return undefined
    const fm = input.cache?.frontmatter as FrontMatterCache | undefined
    if (!fm) return null
    const keys: string[] = []
    for (const k in fm) {
      if (!Object.prototype.hasOwnProperty.call(fm, k)) continue
      const c = input.clone()
      c.keys = ['propertyName']
      c.strings.propertyName = k
      if (this.key.match(c)) keys.push(k)
    }
    const out: PropertyMatch[] = []
    for (const k of keys) {
      if (this.value === null) {
        out.push({ key: k })
        continue
      }
      const v = fm[k]
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const m = this.value.match(input.cloneForPropertyContent(v[i]))
          if (m && m.content) for (const pos of mergeRanges(m.content)) out.push({ key: k, subkey: [i], pos })
        }
      } else {
        const m = this.value.match(input.cloneForPropertyContent(v))
        if (m && m.content) for (const pos of m.content) out.push({ key: k, pos })
      }
    }
    return out.length > 0 ? { properties: out } : null
  }
  getInfo(): string {
    return LABELS.matchProperty
  }
  requiredInputs(): RequiredInputs {
    return {}
  }
  getContext(pos: number): MatcherContext | null {
    const c = this.key.getContext(pos) || this.value?.getContext(pos)
    if (c) {
      c.matcherStack.push(this)
      return c
    }
    return super.getContext(pos)
  }
}

/** `"exact text"` */
export class ExactMatcher extends Matcher {
  wholeWordRegex: string
  partialMatchRegex: string
  constructor(public text: string) {
    super()
    this.wholeWordRegex = wholeWordRegex(text)
    this.partialMatchRegex = escapeRegex(text)
  }
  match(input: MatchInput): MatchResult {
    if (this.text === '') return undefined
    let any = false
    const r: SearchResult = {}
    for (const k of input.keys) {
      if (k === 'propertyName') {
        if (input.strings[k]!.toLowerCase() === this.text.toLowerCase()) {
          r[k] = [[0, this.text.length]]
          any = true
        }
        continue
      }
      const content = k === 'content'
      const ranges = execAll(getRegex(content ? this.wholeWordRegex : this.partialMatchRegex, input.caseSensitive), input.strings[k], content)
      if (ranges.length > 0) {
        r[k] = ranges
        any = true
      }
    }
    return any ? r : null
  }
  getInfo(): string {
    return LABELS.matchExactText + '"' + this.text + '"'
  }
  requiredInputs(): RequiredInputs {
    return { content: true }
  }
}

/** Bare word: escaped substring regex. */
export class TextMatcher extends RegexMatcher {
  constructor(public text: string) {
    super(escapeRegex(text))
  }
  setText(text: string): void {
    this.text = text
    this.regex = escapeRegex(text)
  }
  getInfo(): string {
    return LABELS.matchText + '"' + this.text + '"'
  }
  match(input: MatchInput): MatchResult {
    return this.text === '' ? null : super.match(input)
  }
}

export abstract class GroupMatcher extends Matcher {
  constructor(public matchers: Matcher[]) {
    super()
  }
  requiredInputs(): RequiredInputs {
    const r: RequiredInputs = {}
    for (const m of this.matchers) Object.assign(r, m.requiredInputs())
    return r
  }
  getContext(pos: number): MatcherContext | null {
    for (const m of this.matchers) {
      const c = m.getContext(pos)
      if (c) {
        c.matcherStack.push(this)
        return c
      }
    }
    const c = super.getContext(pos)
    if (c) c.matcherStack.push(this)
    return c
  }
}

/** Juxtaposition. */
export class AndMatcher extends GroupMatcher {
  match(input: MatchInput): MatchResult {
    let acc: MatchResult = undefined
    for (const m of this.matchers) {
      const r = m.match(input)
      if (r === null) return null
      if (acc) {
        if (r) mergeInto(acc, r)
      } else acc = r
    }
    return acc
  }
  getInfo(): string {
    return LABELS.matchAll
  }
}

/** `OR` */
export class OrMatcher extends GroupMatcher {
  match(input: MatchInput): MatchResult {
    let acc: MatchResult = undefined
    for (const m of this.matchers) {
      const r = m.match(input)
      if (acc || r === undefined) {
        if (r) mergeInto(acc!, r)
      } else acc = r
    }
    return acc
  }
  getInfo(): string {
    return LABELS.matchAny
  }
}

/** A matcher wrapping exactly one sub-matcher. */
export abstract class WrapperMatcher extends Matcher {
  constructor(public matcher: Matcher) {
    super()
  }
  requiredInputs(): RequiredInputs {
    return this.matcher.requiredInputs()
  }
  getContext(pos: number): MatcherContext | null {
    const c = this.matcher.getContext(pos)
    if (c) {
      c.matcherStack.push(this)
      return c
    }
    return super.getContext(pos)
  }
}

/** `>x` / `<x` against a property value. */
export class CompareMatcher extends Matcher {
  text: string
  constructor(public type: 'lessthan' | 'greaterthan', operand: Matcher) {
    super()
    if (operand instanceof TextMatcher) this.text = operand.text
    else if (operand instanceof ExactMatcher) this.text = operand.text
    else throw new Error(type + ' operator cannot be applied to matcher ' + operand.getInfo())
  }
  match(input: MatchInput): MatchResult {
    const v = input.getData(PROPERTY_VALUE)
    return v != null && ((this.type === 'lessthan' && v < this.text) || (this.type === 'greaterthan' && v > this.text))
      ? { content: [[0, String(v).length]] }
      : null
  }
  getInfo(): string {
    return this.type === 'lessthan' ? LABELS.lessThan + this.text : LABELS.greaterThan + this.text
  }
  requiredInputs(): RequiredInputs {
    return {}
  }
}

/** `-x` */
export class NotMatcher extends WrapperMatcher {
  match(input: MatchInput): MatchResult {
    const r = this.matcher.match(input)
    if (r !== undefined) return r ? null : {}
    return undefined
  }
  getInfo(): string {
    return LABELS.excluding
  }
}

/** `match-case:` / `ignore-case:` */
export class CaseMatcher extends WrapperMatcher {
  constructor(matcher: Matcher, public caseSensitive: boolean) {
    super(matcher)
  }
  match(input: MatchInput): MatchResult {
    const c = input.clone()
    c.caseSensitive = this.caseSensitive
    return this.matcher.match(c)
  }
  getInfo(): string {
    return this.caseSensitive ? LABELS.caseSensitive : LABELS.caseInsensitive
  }
}

abstract class KeyRestrictMatcher extends WrapperMatcher {
  abstract key: InputKey
  match(input: MatchInput): MatchResult {
    if (!input.has(this.key)) return undefined
    const c = input.clone()
    c.keys = [this.key]
    return this.matcher.match(c)
  }
}

/** `path:` */
export class PathMatcher extends KeyRestrictMatcher {
  key: InputKey = 'filepath'
  getInfo(): string {
    return LABELS.filePath
  }
  requiredInputs(): RequiredInputs {
    return {}
  }
}

/** `file:` */
export class FileMatcher extends KeyRestrictMatcher {
  key: InputKey = 'filename'
  getInfo(): string {
    return LABELS.fileName
  }
  requiredInputs(): RequiredInputs {
    return {}
  }
}

/** `content:` */
export class ContentMatcher extends KeyRestrictMatcher {
  key: InputKey = 'content'
  getInfo(): string {
    return LABELS.content
  }
  requiredInputs(): RequiredInputs {
    return { content: true }
  }
}

type SplitEmit = (text: string, offset: number) => void

/** Base for operators that re-run the operand on parts of the content (line/block/section/task). */
export abstract class SplitMatcher extends WrapperMatcher {
  splitContentMatch(input: MatchInput, iterate: (sub: MatchInput, emit: SplitEmit) => void): MatchResult {
    const sub = input.clone()
    sub.keys = ['content']
    let matched = false
    let sawUndefined = false
    const ranges: Range[] = []
    iterate(sub, (text, offset) => {
      sub.strings.content = text
      const r = this.matcher.match(sub)
      if (r === undefined) sawUndefined = true
      else if (r) {
        matched = true
        const c = r.content
        if (c) {
          shiftRanges(c, offset)
          for (const x of c) ranges.push(x)
        } else ranges.push([offset, offset])
      }
    })
    return matched ? { content: ranges } : sawUndefined ? undefined : null
  }
  requiredInputs(): RequiredInputs {
    return { content: true }
  }
}

/** `line:` */
export class LineMatcher extends SplitMatcher {
  match(input: MatchInput): MatchResult {
    if (!input.has('content')) return undefined
    const text = input.strings.content!
    return this.splitContentMatch(input, (_sub, emit) => {
      let off = 0
      for (const line of text.split('\n')) {
        emit(line, off)
        off = off + line.length + 1
      }
    })
  }
  getInfo(): string {
    return LABELS.line
  }
}

/** `block:` — every non-list section plus every list item. */
export class BlockMatcher extends SplitMatcher {
  match(input: MatchInput): MatchResult {
    if (!input.has('content')) return undefined
    const cache = input.cache
    if (!cache) return null
    const text = input.strings.content!
    return this.splitContentMatch(input, (_sub, emit) => {
      if (cache.sections) for (const s of cache.sections) {
        if (s.type === 'list') continue
        const a = s.position.start.offset
        emit(text.substring(a, s.position.end.offset), a)
      }
      if (cache.listItems) for (const li of cache.listItems) {
        const a = li.position.start.offset
        emit(text.substring(a, li.position.end.offset), a)
      }
    })
  }
  getInfo(): string {
    return LABELS.block
  }
}

interface HeadingSection {
  start: number
  end: number
  children: number
}

function headingSections(headings: HeadingCache[], length: number): HeadingSection[] {
  const out: HeadingSection[] = []
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const next = headings[i + 1]
    const start = h.position.start.offset
    if (i === 0 && start > 0) out.push({ start: 0, end: start, children: 0 })
    const end = next ? next.position.start.offset : length
    let children = 0
    for (let j = i + 1; j < headings.length && headings[j].level > h.level; j++) children++
    out.push({ start, end, children })
  }
  return out
}

/** `section:` — heading-delimited sections; nested `section:` narrows to child headings. */
export class SectionMatcher extends SplitMatcher {
  match(input: MatchInput): MatchResult {
    if (!input.has('content')) return undefined
    const cache = input.cache
    if (!cache) return null
    const parent = input.getData(SECTION_DATA) as { sections: HeadingSection[] | null; index: number } | null | undefined
    const headings = cache.headings
    if (!headings) {
      if (parent) return null
      input.setData(SECTION_DATA, { sections: null, index: 0 })
      const r = this.matcher.match(input)
      input.deleteData(SECTION_DATA)
      return r
    }
    const original = input.original
    let sections: HeadingSection[]
    let base = 0
    let from: number
    let to: number
    if (parent) {
      sections = parent.sections!
      const h = sections[parent.index]
      if (h.children === 0) return null
      base = h.start
      from = parent.index + 1
      to = Math.min(sections.length, from + h.children)
    } else {
      sections = headingSections(headings, original.length)
      from = 0
      to = sections.length
    }
    return this.splitContentMatch(input, (sub, emit) => {
      for (let i = from; i < to; i++) {
        const { start, end } = sections[i]
        if (end <= start) continue
        sub.setData(SECTION_DATA, { sections, index: i })
        emit(original.substring(start, end), start - base)
      }
    })
  }
  getInfo(): string {
    return LABELS.section
  }
}

/** `task:` / `task-todo:` / `task-done:` */
export class TaskMatcher extends SplitMatcher {
  constructor(matcher: Matcher, public completed: boolean | undefined) {
    super(matcher instanceof ExactMatcher && matcher.text === '' ? new AnyMatcher() : matcher)
  }
  match(input: MatchInput): MatchResult {
    if (!input.has('content')) return undefined
    const cache = input.cache
    if (!cache) return null
    const text = input.strings.content!
    const completed = this.completed
    return this.splitContentMatch(input, (_sub, emit) => {
      if (cache.listItems) for (const li of cache.listItems) {
        if (li.task === undefined) continue
        if (typeof completed === 'boolean' && completed !== (li.task !== ' ')) continue
        const a = li.position.start.offset
        emit(text.substring(a, li.position.end.offset), a)
      }
    })
  }
  getInfo(): string {
    return this.completed === true ? LABELS.taskDone : this.completed === false ? LABELS.taskTodo : LABELS.task
  }
}

/** Frontmatter list value for a key matched by `re` (strings only, trimmed). */
function frontmatterList(fm: FrontMatterCache | undefined, re: RegExp): string[] | null {
  if (!fm) return null
  let v: unknown = null
  for (const k in fm) {
    if (Object.prototype.hasOwnProperty.call(fm, k) && re.test(k)) {
      v = fm[k]
      break
    }
  }
  if (!v) return null
  if (typeof v === 'string') return [v.trim()]
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').map((x: string) => x.trim())
  return null
}

/** Frontmatter `tags` normalised to `#tag` (entries with spaces dropped). */
export function frontmatterTags(fm: FrontMatterCache | undefined): string[] | null {
  if (!fm) return null
  let t = frontmatterList(fm, /^tags$/i)
  if (t) {
    t = t.filter((x) => !!x && !x.includes(' '))
    for (let i = 0; i < t.length; i++) if (t[i].charAt(0) !== '#') t[i] = '#' + t[i]
  }
  return t
}

/** The actual spelling of `key` in `obj` (case-insensitive lookup). */
function actualKey(obj: object, key: string): string {
  if (Object.prototype.hasOwnProperty.call(obj, key)) return key
  const lower = key.toLowerCase()
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return k
  return key
}

/** `tag:` */
export class TagMatcher extends Matcher {
  matcher: TextMatcher
  constructor(matcher: TextMatcher) {
    super()
    if (matcher.text.charAt(0) !== '#') matcher.setText('#' + matcher.text)
    this.matcher = matcher
  }
  match(input: MatchInput): MatchResult {
    const re = new RegExp('^' + this.matcher.regex + '($|\\/)', 'i')
    if (input.has('tag') && re.test(input.strings.tag!)) return {}
    if (!input.has('content')) return undefined
    const cache = input.cache
    if (!cache) return null
    let properties: PropertyMatch[] | undefined = undefined
    const ranges: Range[] = []
    let found = false
    const fmTags = frontmatterTags(cache.frontmatter)
    if (fmTags) {
      const key = actualKey(cache.frontmatter!, 'tags')
      for (const t of fmTags) if (re.test(t)) {
        found = true
        properties = [{ key }]
      }
    }
    if (cache.tags) for (const t of cache.tags) if (re.test(t.tag)) {
      ranges.push([t.position.start.offset, t.position.end.offset])
      found = true
    }
    return found ? { content: ranges, properties } : null
  }
  getInfo(): string {
    return LABELS.tag + this.matcher.text
  }
  requiredInputs(): RequiredInputs {
    return { content: true }
  }
  getContext(pos: number): MatcherContext | null {
    const c = this.matcher.getContext(pos)
    if (c) {
      c.matcherStack.push(this)
      return c
    }
    return super.getContext(pos)
  }
}

