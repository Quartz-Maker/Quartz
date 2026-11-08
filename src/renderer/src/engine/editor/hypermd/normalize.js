// What the editor DOM actually shows for a tokenized line (mirrors the stream-language host):
// `line-` / `line-background-` words become line classes (deduplicated, sorted, `parse-next`
// dropped); the remaining words are sorted and adjacent tokens with identical classes merge.
const lineWordRE = /^line-(background-)?(.*)$/

/** Split a raw style string into [tokenClass (sorted words), lineClasses[]]. */
export function splitStyle(style) {
  const lineClasses = []
  const words = style.split(' ').filter(w => {
    if (!w) return false
    const m = w.match(lineWordRE)
    if (m) { lineClasses.push(m[2]); return false }
    return true
  })
  return [words.sort().join(' '), lineClasses]
}

/** @returns {{line: string, spans: Array<[number, number, string]>}} */
export function normalizeLine(tokens) {
  const lineSet = new Set()
  const spans = []
  let pos = 0
  for (const [text, style] of tokens) {
    const from = pos
    pos += text.length
    if (!style) continue
    const [cls, lineClasses] = splitStyle(style)
    for (const c of lineClasses) lineSet.add(c)
    if (text.length === 0) continue
    const last = spans[spans.length - 1]
    if (last && last[2] === cls && last[1] === from) last[1] = pos
    else if (cls) spans.push([from, pos, cls])
  }
  lineSet.delete('parse-next')
  return { line: Array.from(lineSet).sort().join(' '), spans }
}
