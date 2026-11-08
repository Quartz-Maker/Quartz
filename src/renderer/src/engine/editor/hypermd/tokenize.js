// Run the hypermd mode over a whole document exactly like the editor's stream-language host.
import { getModeRegistry } from './registry.js'
import { StringStream, readToken } from './stream.js'

let modeCache = null
export function getHyperMDMode() {
  if (!modeCache) {
    const CM = getModeRegistry()
    modeCache = CM.getMode({}, { name: 'hypermd' })
  }
  return modeCache
}

/**
 * @param {string} text
 * @param {{tabSize?: number, indentUnit?: number}} [opts]
 * @returns {Array<Array<[string, string|null]>>} per line: [tokenText, style]; empty lines give [['', blankLineStyle]]
 */
export function tokenizeDocument(text, opts = {}) {
  const tabSize = opts.tabSize ?? 4
  const indentUnit = opts.indentUnit ?? 4
  const CM = getModeRegistry()
  const mode = getHyperMDMode()
  const state = CM.startState(mode)
  const lines = text.split(/\r\n?|\n/)
  const out = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const stream = new StringStream(line, tabSize, indentUnit, n => (li + n >= lines.length ? '' : lines[li + n]))
    const toks = []
    if (stream.eol()) {
      toks.push(['', mode.blankLine(state, indentUnit) || null])
    } else {
      while (!stream.eol()) {
        const style = readToken(mode.token, stream, state)
        toks.push([stream.current(), style || null])
      }
    }
    out.push(toks)
  }
  return out
}
