/* eslint-disable @typescript-eslint/no-explicit-any */
// Public plugin-API helper functions that operate on CachedMetadata/frontmatter,
// plus the small data structures MetadataCache uses.
import type { CachedMetadata, FrontMatterCache, Reference, ReferenceCache, FrontmatterLinkCache } from 'obsidian'
import { TAG_PATTERN } from './parser/quartzParser'

/** Map of key → unique values (internal multimap, used for backlinks). */
export class CustomArrayDict<T> {
  data = new Map<string, T[]>()
  add(key: string, value: T): void {
    let a = this.data.get(key)
    if (!a) this.data.set(key, (a = []))
    if (!a.includes(value)) a.push(value)
  }
  remove(key: string, value: T): void {
    const a = this.data.get(key)
    if (!a) return
    const i = a.indexOf(value)
    if (i !== -1) a.splice(i, 1)
    if (a.length === 0) this.data.delete(key)
  }
  get(key: string): T[] | null {
    return this.data.get(key) || null
  }
  keys(): string[] {
    return Array.from(this.data.keys())
  }
  clear(key: string): void {
    this.data.delete(key)
  }
  clearAll(): void {
    this.data.clear()
  }
  contains(key: string, value: T): boolean {
    const a = this.data.get(key)
    return !!a && a.includes(value)
  }
  count(): number {
    let n = 0
    for (const a of this.data.values()) n += a.length
    return n
  }
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** `parseFrontMatterEntry`: value for a key (string) or the first key matching a regex. */
export function parseFrontMatterEntry(frontmatter: any | null, key: string | RegExp): any | null {
  if (!frontmatter) return null
  if (typeof key === 'string') return hasOwn(frontmatter, key) ? frontmatter[key] : null
  for (const k in frontmatter) if (hasOwn(frontmatter, k) && key.test(k)) return frontmatter[k]
  return null
}
/** `parseFrontMatterStringArray`: string values of a frontmatter key. */
export function parseFrontMatterStringArray(frontmatter: any | null, key: string | RegExp): string[] | null {
  const v = parseFrontMatterEntry(frontmatter, key)
  if (!v) return null
  if (typeof v === 'string') return [v.trim()]
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string').map(x => x.trim())
  return null
}
/** `parseFrontMatterAliases`: trimmed, non-empty aliases. */
export function parseFrontMatterAliases(frontmatter: any | null): string[] | null {
  const a = parseFrontMatterStringArray(frontmatter, /^aliases$/i)
  return a ? a.map(x => x.trim()).filter(x => !!x) : null
}
/** `parseFrontMatterTags`: tags without spaces, each prefixed with "#". */
export function parseFrontMatterTags(frontmatter: any | null): string[] | null {
  if (!frontmatter) return null
  let t = parseFrontMatterStringArray(frontmatter, /^tags$/i)
  if (t) {
    t = t.filter(x => !!x && !x.includes(' '))
    for (let i = 0; i < t.length; i++) if (t[i].charAt(0) !== '#') t[i] = '#' + t[i]
  }
  return t
}
export function parseFrontMatterCssClasses(frontmatter: any | null): string[] | null {
  if (!frontmatter) return null
  const c = parseFrontMatterStringArray(frontmatter, /^cssclasses$/i)
  return c ? c.filter(x => !!x && !x.includes(' ')) : null
}
/** `getAllTags`: frontmatter tags then inline tags. */
export function getAllTags(cache: CachedMetadata): string[] | null {
  if (!cache) return null
  const out: string[] = []
  const fm = parseFrontMatterTags(cache.frontmatter as FrontMatterCache)
  if (fm) out.push(...fm)
  if (cache.tags) for (const t of cache.tags) out.push(t.tag)
  return out
}
const VALID_TAG = new RegExp(TAG_PATTERN.source + '$')
export function isValidTag(tag: string): boolean {
  return !!tag && VALID_TAG.test(tag) && !/^#\d+$/.test(tag)
}

function iterate(list: Reference[] | undefined, cb: (ref: any) => boolean | void): boolean {
  if (!list) return false
  for (const r of list) if (cb(r) === true) return true
  return false
}
/** `iterateCacheRefs`: links then embeds. */
export function iterateCacheRefs(cache: CachedMetadata, cb: (ref: ReferenceCache) => boolean | void): boolean {
  return !!cache && (iterate(cache.links, cb) || iterate(cache.embeds, cb))
}
/** `iterateRefs` over frontmatter links, links and embeds. */
export function iterateRefs(cache: CachedMetadata, cb: (ref: Reference) => boolean | void): boolean {
  return !!cache && (iterate(cache.frontmatterLinks as FrontmatterLinkCache[], cb) || iterate(cache.links, cb) || iterate(cache.embeds, cb))
}
export function isReferenceCache(ref: Reference): ref is ReferenceCache {
  return hasOwn(ref, 'position')
}
export function isFrontmatterLinkCache(ref: Reference): ref is FrontmatterLinkCache {
  return hasOwn(ref, 'key')
}
