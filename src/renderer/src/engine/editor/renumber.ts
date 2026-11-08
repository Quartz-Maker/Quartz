// Ordered-list renumbering on edit (smart lists; a smart-indent transaction filter).
// After any user change, ordered items on the touched lines (and the following
// items of the same list level) are renumbered so the list stays consecutive; the fix-up is appended
// to the same transaction with userEvent "input.renumber".
import { EditorState } from '@codemirror/state'
import type { Text, Transaction } from '@codemirror/state'
import { LIST_RE } from './livepreview/inline'

/** Nesting depth of a list prefix (tabs / 4-space units, after an optional quote marker). */
function depth(prefix: string): number {
  let n = 0
  const units = () => {
    while (prefix.startsWith('\t')) { prefix = prefix.substring(1); n++ }
    while (prefix.startsWith('    ')) { prefix = prefix.substring(4); n++ }
  }
  if (prefix.startsWith('>')) {
    prefix = prefix.substring(1)
    units()
    if (prefix.startsWith(' ')) prefix = prefix.substring(1)
  }
  units()
  return n
}
const quotes = (prefix: string) => (prefix.match(/>/g) || []).length
/** Lines that end a list: quote, heading, rule, fence. */
const LIST_BREAK = /^\s*(?:> |#{1,6} |([-_*])(\s*\1){2,}\s*$|~~~|```)/

type Match = RegExpExecArray

function previousNumber(doc: Text, lineNo: number, d: number, q: number, m: (t: string) => Match): number | null {
  let found: number | null = null
  let gap = false
  for (let s = lineNo - 1; s >= 1; s--) {
    const line = doc.line(s)
    const c = m(line.text)
    const cq = quotes(c[1])
    if (line.text && line.text !== c[1]) {
      if (c && c[0]) {
        if (c[2]) {
          const cd = depth(c[1])
          if (cd === d && cq === q) { if (c[4]) found = parseInt(c[4], 10); break }
          if (cd < d || cq < q) break
        } else gap = true
      } else {
        if (q || LIST_BREAK.test(line.text)) break
        gap = true
      }
    } else if (q > cq || gap) break
  }
  return found
}

function firstNumber(doc: Text, lineNo: number, d: number, q: number, m: (t: string) => Match): number {
  let found = 1
  let gap = false
  for (let s = lineNo; s >= 1; s--) {
    const line = doc.line(s)
    if (line.text) {
      const c = m(line.text)
      if (c && c[0]) {
        if (c[2]) {
          const cd = depth(c[1]), cq = quotes(c[1])
          if (cd === d && cq === q && c[4]) found = parseInt(c[4], 10)
          if (cd < d || cq < q) break
        } else gap = true
      } else {
        if (q || LIST_BREAK.test(line.text)) break
        gap = true
      }
    } else if (q || gap) break
  }
  return found
}

export function renumberLists(isBlocked: () => boolean = () => false) {
  return EditorState.transactionFilter.of((tr: Transaction) => {
    if (!tr.docChanged || isBlocked() || tr.isUserEvent('set') || tr.isUserEvent('input.renumber')) return tr
    const doc = tr.newDoc, old = tr.startState.doc
    const cache = new Map<string, Match>()
    const m = (t: string) => { let r = cache.get(t); if (!r) cache.set(t, (r = LIST_RE.exec(t)!)); return r }
    const changes: { insert: string; from: number; to: number }[] = []
    let lines: number[] = []
    const ranges: { from: number; to: number }[] = []
    tr.changes.iterChangedRanges((_fA, _tA, fB, tB) => {
      ranges.push({ from: fB, to: tB })
      for (let n = doc.lineAt(fB).number; n <= doc.lineAt(tB).number + 1; n++) lines.push(n)
    })
    lines = Array.from(new Set(lines)).sort((a, b) => a - b)
    const done = new Set<number>()
    const process = (line: { number: number; from: number; to: number; text: string }) => {
      if (done.has(line.number)) return
      done.add(line.number)
      const r = m(line.text)
      if (!(r && r[0] && r[4])) return
      const prefix = r[1], d = depth(prefix), q = quotes(prefix), delim = r[5]
      let num = previousNumber(doc, line.number, d, q, m)
      if (num === null) {
        num = 1
        let changedMarker = false
        for (const g of ranges) {
          if (g.from <= line.to && g.to >= line.from) {
            const y = m(old.lineAt(tr.changes.invertedDesc.mapPos(line.to)).text)
            if (!y || y[2] !== r[2]) { changedMarker = true; break }
          }
        }
        if (changedMarker) num = parseInt(r[4], 10)
        else {
          const ol = old.lineAt(tr.changes.invertedDesc.mapPos(line.to))
          const y = m(ol.text)
          if (y && depth(y[1]) === d) num = firstNumber(old, ol.number, d, quotes(y[1]), m)
        }
      } else num++
      if (String(num) !== r[4]) changes.push({ insert: num + delim, from: line.from + prefix.length, to: line.from + prefix.length + r[3].length })
      let blank = false
      for (let n = line.number + 1; n <= doc.lines && !done.has(n); n++) {
        const l = doc.line(n)
        if (l.text) {
          const c = m(l.text)
          if (c && c[0]) {
            const cd = depth(c[1]), cq = quotes(c[1])
            if (!c[1] || c[2]) {
              if (cd === d && cq === q) {
                if (!c[4]) break
                num++
                if (String(num) === c[4]) { done.add(n); break }
                changes.push({ insert: num + c[5], from: l.from + c[1].length, to: l.from + c[1].length + c[3].length })
                done.add(n)
              }
              if (cd < d) break
            }
          } else if (blank || LIST_BREAK.test(l.text)) break
        } else blank = true
      }
    }
    for (const n of lines) if (n <= doc.lines) process(doc.line(n))
    return changes.length ? [tr, { changes, sequential: true, userEvent: 'input.renumber' }] : tr
  })
}
