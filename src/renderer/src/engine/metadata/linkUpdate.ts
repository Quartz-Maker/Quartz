/* eslint-disable @typescript-eslint/no-explicit-any */
// Rewriting a reference in place when its target moves: keep the alias and `\|`, keep markdown-link `<…>`/title, update a
// display text that equalled the old name, and apply edits by exact offset; frontmatter
// links are rewritten in the parsed YAML and re-serialised.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Reference } from 'obsidian'
import { WIKILINK_FULL, MDLINK_FULL, getLinkpath, encodeLinkDestination } from './linktext'
import { isReferenceCache, isFrontmatterLinkCache } from './helpers'
import { stem, stripMd, basename, extname } from '../vault/path'

export interface LinkChange {
  sourcePath: string
  reference: Reference
  change: string
}

const NBSP_LIKE = / | /g
/** Display name used for comparisons: basename without ".md" (other extensions kept). */
const shortName = (p: string): string => (extname(basename(p)) === 'md' ? stem(p) : basename(p))

/** New source text for `reference` when it should point to `newLink` (path + subpath). */
export function replaceReference(reference: Reference, newLink: string): string {
  const original = reference.original
  const oldLink = reference.link
  const wl = original.match(WIKILINK_FULL)
  if (wl) {
    const open = wl[1]
    const target = wl[2]
    let alias = wl[4] === undefined ? '' : wl[4]
    const close = wl[5]
    if (alias) {
      const bar = /\\\|/.test(original) ? '\\|' : '|'
      if (target.includes('/')) {
        if (stem(target) === alias.trim()) alias = stem(getLinkpath(newLink))
      }
      return open + newLink + bar + alias + close
    }
    return open + newLink + close
  }
  const md = original.match(MDLINK_FULL)
  const dest = !md || !md[5].startsWith('<') ? encodeLinkDestination(newLink) : '<' + newLink + '>'
  if (md) {
    let text = md[2]
    const t = text.replace(NBSP_LIKE, ' ').trim()
    const oldPath = getLinkpath(oldLink)
    if (t === shortName(oldPath)) text = shortName(getLinkpath(newLink))
    else if (t.includes('/') && t === stripMd(oldPath)) text = stripMd(getLinkpath(newLink))
    return md[1] + text + md[3] + dest + (md[6] ?? '') + md[8]
  }
  let out = '[](' + dest + ')'
  if (original.startsWith('!')) out = '!' + out
  return out
}

const FM_START = /^---(\r?\n)/g
const FM_END = /---(\r?\n|$)/g
export function getFrontMatterInfo(text: string): { exists: boolean; frontmatter: string; from: number; to: number; contentStart: number } {
  const none = { exists: false, contentStart: 0, from: 0, to: 0, frontmatter: '' }
  FM_START.lastIndex = 0
  if (!FM_START.exec(text)) return none
  const from = FM_START.lastIndex
  FM_END.lastIndex = from
  let m = FM_END.exec(text)
  while (m && text.charAt(m.index - 1) !== '\n') m = FM_END.exec(text)
  if (!m) return none
  return { exists: true, frontmatter: text.slice(from, m.index), from, to: m.index, contentStart: FM_END.lastIndex }
}

export function stringifyFrontmatterYaml(obj: unknown): string {
  return stringifyYaml(obj, null as any, { nullStr: '', lineWidth: 0, aliasDuplicateObjects: false } as any)
}

function setDeep(obj: any, keys: string[], value: unknown): void {
  while (obj && keys.length) {
    const k = keys.shift()!
    if (Array.isArray(obj)) {
      const i = parseInt(k)
      if (isNaN(i) || i < 0 || i >= obj.length) return
      if (!(keys.length > 0)) {
        obj[i] = value
        return
      }
      obj = obj[i]
    } else {
      if (typeof obj !== 'object') return
      if (!(keys.length > 0)) {
        obj[k] = value
        return
      }
      obj = obj[k]
    }
  }
}

/** Apply a set of reference changes to a file's text. */
export function applyLinkChanges(text: string, changes: LinkChange[]): string {
  const edits: { start: number; end: number; text: string }[] = []
  const fm: { key: string; value: string }[] = []
  for (const c of changes) {
    if (isReferenceCache(c.reference)) {
      const p = (c.reference as any).position
      edits.push({ start: p.start.offset, end: p.end.offset, text: c.change })
    } else if (isFrontmatterLinkCache(c.reference)) fm.push({ key: c.reference.key, value: c.change })
  }
  edits.sort((a, b) => b.start - a.start)
  for (const e of edits) text = text.substring(0, e.start) + e.text + text.substring(e.end)
  if (fm.length === 0) return text
  const info = getFrontMatterInfo(text)
  if (!info.exists) return text
  let obj: any
  try {
    obj = parseYaml(info.frontmatter, null as any, {} as any)
  } catch {
    return text
  }
  for (const f of fm) setDeep(obj, f.key.split('.'), f.value)
  return text.slice(0, info.from) + stringifyFrontmatterYaml(obj) + text.slice(info.to)
}
