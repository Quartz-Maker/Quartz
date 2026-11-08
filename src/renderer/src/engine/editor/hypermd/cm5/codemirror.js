// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE
//
// The *mode system* subset of CodeMirror 5.64.0 (src/modes.js, src/util/StringStream.js,
// src/util/misc.js countColumn) — enough to host CM5 legacy modes (markdown, hypermd and the
// fenced-code-block languages) without the CM5 editor itself; only the mode registry is needed.

export function countColumn(string, end, tabSize, startIndex, startValue) {
  if (end == null) {
    end = string.search(/[^\s ]/)
    if (end == -1) end = string.length
  }
  for (let i = startIndex || 0, n = startValue || 0; ;) {
    let nextTab = string.indexOf('\t', i)
    if (nextTab < 0 || nextTab >= end) return n + (end - i)
    n += nextTab - i
    n += tabSize - (n % tabSize)
    i = nextTab + 1
  }
}

/** CM5's StringStream (constructor(string, tabSize, lineOracle)). */
export class StringStream {
  constructor(string, tabSize, lineOracle) {
    this.pos = this.start = 0
    this.string = string
    this.tabSize = tabSize || 8
    this.lastColumnPos = this.lastColumnValue = 0
    this.lineStart = 0
    this.lineOracle = lineOracle
  }
  eol() { return this.pos >= this.string.length }
  sol() { return this.pos == this.lineStart }
  peek() { return this.string.charAt(this.pos) || undefined }
  next() { if (this.pos < this.string.length) return this.string.charAt(this.pos++) }
  eat(match) {
    let ch = this.string.charAt(this.pos)
    let ok
    if (typeof match == 'string') ok = ch == match
    else ok = ch && (match.test ? match.test(ch) : match(ch))
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
    return countColumn(this.string, null, this.tabSize) - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0)
  }
  match(pattern, consume, caseInsensitive) {
    if (typeof pattern == 'string') {
      let cased = str => caseInsensitive ? str.toLowerCase() : str
      let substr = this.string.substr(this.pos, pattern.length)
      if (cased(substr) == cased(pattern)) { if (consume !== false) this.pos += pattern.length; return true }
    } else {
      let match = this.string.slice(this.pos).match(pattern)
      if (match && match.index > 0) return null
      if (match && consume !== false) this.pos += match[0].length
      return match
    }
  }
  current() { return this.string.slice(this.start, this.pos) }
  hideFirstChars(n, inner) { this.lineStart += n; try { return inner() } finally { this.lineStart -= n } }
  lookAhead(n) { let oracle = this.lineOracle; return oracle && oracle.lookAhead(n) }
  baseToken() { let oracle = this.lineOracle; return oracle && oracle.baseToken(this.pos) }
}

function createObj(base, props) {
  let inst = Object.create(base)
  if (props) copyObj(props, inst)
  return inst
}
function copyObj(obj, target, overwrite) {
  if (!target) target = {}
  for (let prop in obj)
    if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop))) target[prop] = obj[prop]
  return target
}

/** Create an isolated CM5-compatible mode registry object. */
export function createModeSystem() {
  const CodeMirror = {}
  const modes = {}
  const mimeModes = {}
  const modeExtensions = {}
  const helpers = {}

  CodeMirror.modes = modes
  CodeMirror.mimeModes = mimeModes
  CodeMirror.modeExtensions = modeExtensions
  CodeMirror.helpers = helpers
  CodeMirror.Pass = { toString() { return 'CodeMirror.Pass' } }
  CodeMirror.StringStream = StringStream
  CodeMirror.countColumn = countColumn
  CodeMirror.commands = {}
  CodeMirror.version = '5.64.0'

  CodeMirror.defineMode = function (name, mode) {
    if (arguments.length > 2) mode.dependencies = Array.prototype.slice.call(arguments, 2)
    modes[name] = mode
  }
  CodeMirror.defineMIME = function (mime, spec) { mimeModes[mime] = spec }
  CodeMirror.resolveMode = function resolveMode(spec) {
    if (typeof spec == 'string' && mimeModes.hasOwnProperty(spec)) {
      spec = mimeModes[spec]
    } else if (spec && typeof spec.name == 'string' && mimeModes.hasOwnProperty(spec.name)) {
      let found = mimeModes[spec.name]
      if (typeof found == 'string') found = { name: found }
      spec = createObj(found, spec)
      spec.name = found.name
    } else if (typeof spec == 'string' && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
      return resolveMode('application/xml')
    } else if (typeof spec == 'string' && /^[\w\-]+\/[\w\-]+\+json$/.test(spec)) {
      return resolveMode('application/json')
    }
    if (typeof spec == 'string') return { name: spec }
    else return spec || { name: 'null' }
  }
  CodeMirror.getMode = function getMode(options, spec) {
    spec = CodeMirror.resolveMode(spec)
    let mfactory = modes[spec.name]
    if (!mfactory) return getMode(options, 'text/plain')
    let modeObj = mfactory(options, spec)
    if (modeExtensions.hasOwnProperty(spec.name)) {
      let exts = modeExtensions[spec.name]
      for (let prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue
        if (modeObj.hasOwnProperty(prop)) modeObj['_' + prop] = modeObj[prop]
        modeObj[prop] = exts[prop]
      }
    }
    modeObj.name = spec.name
    if (spec.helperType) modeObj.helperType = spec.helperType
    if (spec.modeProps) for (let prop in spec.modeProps) modeObj[prop] = spec.modeProps[prop]
    return modeObj
  }
  CodeMirror.extendMode = function (mode, properties) {
    let exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {})
    copyObj(properties, exts)
  }
  CodeMirror.copyState = function (mode, state) {
    if (state === true) return state
    if (mode.copyState) return mode.copyState(state)
    let nstate = {}
    for (let n in state) {
      let val = state[n]
      if (val instanceof Array) val = val.concat([])
      nstate[n] = val
    }
    return nstate
  }
  CodeMirror.innerMode = function (mode, state) {
    let info
    while (mode.innerMode) {
      info = mode.innerMode(state)
      if (!info || info.mode == mode) break
      state = info.state
      mode = info.mode
    }
    return info || { mode: mode, state: state }
  }
  CodeMirror.startState = function (mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : true
  }
  CodeMirror.registerHelper = function (type, name, value) {
    if (!helpers.hasOwnProperty(type)) helpers[type] = CodeMirror[type] = { _global: [] }
    helpers[type][name] = value
  }
  CodeMirror.registerGlobalHelper = function (type, name, predicate, value) {
    CodeMirror.registerHelper(type, name, value)
    helpers[type]._global.push({ pred: predicate, val: value })
  }

  CodeMirror.defineMode('null', () => ({ token: stream => stream.skipToEnd() }))
  CodeMirror.defineMIME('text/plain', 'null')
  return CodeMirror
}
