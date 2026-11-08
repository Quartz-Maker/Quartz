// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE
//
// StringStream as used by CodeMirror 6's stream-language host (@codemirror/language, MIT), extended
// the way the editor drives legacy modes: `lookAhead(n)` returns the text of the n-th
// following line ("" past the end of the document), and `indentUnit` is the editor indent unit.
import { countColumn } from './cm5/codemirror.js'

export class StringStream {
  constructor(string, tabSize, indentUnit, lookAhead, overrideIndent) {
    this.string = string
    this.tabSize = tabSize
    this.indentUnit = indentUnit
    this.lookAhead = lookAhead || (() => '')
    this.overrideIndent = overrideIndent
    this.pos = 0
    this.start = 0
    this.lineStart = 0
    this.lastColumnPos = 0
    this.lastColumnValue = 0
  }
  eol() { return this.pos >= this.string.length }
  sol() { return this.pos == this.lineStart }
  peek() { return this.string.charAt(this.pos) || undefined }
  next() { if (this.pos < this.string.length) return this.string.charAt(this.pos++) }
  eat(match) {
    let ch = this.string.charAt(this.pos)
    let ok
    if (typeof match == 'string') ok = ch == match
    else ok = ch && (match instanceof RegExp ? match.test(ch) : match(ch))
    if (ok) { ++this.pos; return ch }
  }
  eatWhile(match) { let start = this.pos; while (this.eat(match)) { /* */ } return this.pos > start }
  eatSpace() { let start = this.pos; while (/[\s ]/.test(this.string.charAt(this.pos))) ++this.pos; return this.pos > start }
  skipToEnd() { this.pos = this.string.length }
  skipTo(ch) { let found = this.string.indexOf(ch, this.pos); if (found > -1) { this.pos = found; return true } }
  backUp(n) { this.pos -= n }
  column() {
    if (this.lastColumnPos < this.start) {
      this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue)
      this.lastColumnPos = this.start
    }
    return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0)
  }
  indentation() {
    return this.overrideIndent ?? (countColumn(this.string, null, this.tabSize) - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0))
  }
  match(pattern, consume, caseInsensitive) {
    if (typeof pattern == 'string') {
      let cased = str => caseInsensitive ? str.toLowerCase() : str
      let substr = this.string.substr(this.pos, pattern.length)
      if (cased(substr) == cased(pattern)) { if (consume !== false) this.pos += pattern.length; return true }
      return null
    }
    let match = this.string.slice(this.pos).match(pattern)
    if (match && match.index > 0) return null
    if (match && consume !== false) this.pos += match[0].length
    return match
  }
  current() { return this.string.slice(this.start, this.pos) }
  hideFirstChars(n, inner) { this.lineStart += n; try { return inner() } finally { this.lineStart -= n } }
}

/** Call `token` until the stream advances (CM6 retries up to 10 times). */
export function readToken(token, stream, state) {
  stream.start = stream.pos
  for (let i = 0; i < 10; i++) {
    let result = token(stream, state)
    if (stream.pos > stream.start) return result
  }
  throw new Error('Stream parser failed to advance stream.')
}
