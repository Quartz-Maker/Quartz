/* eslint-disable @typescript-eslint/no-explicit-any */
// Builds `CachedMetadata` from markdown text — the job of the
// "Metadata Cache Worker". Field order, empty-array removal and 0-based
// {line,col,offset} positions are part of the plugin-facing format.
import { parse as parseYaml } from 'yaml'
import type { CachedMetadata, FrontMatterCache, FrontmatterLinkCache, Pos } from 'obsidian'
import { parseMarkdown } from './quartzParser'
import { visit, type MdNode } from './visit'
import { isInternalUrl, parseWikilinkInner, MDLINK_FULL } from '../linktext'

const loc = (p: any) => ({ line: p.line - 1, col: p.column - 1, offset: p.offset })
export const toPos = (p: any): Pos => ({ start: loc(p.start), end: loc(p.end) })

/** Parse frontmatter YAML; null when invalid, undefined when not a mapping. */
export function parseFrontMatterYaml(src: string): FrontMatterCache | null | undefined {
  try {
    const v = parseYaml(src, undefined as any, {})
    if (v && typeof v === 'object' && !Array.isArray(v)) return v || undefined
  } catch {
    return null
  }
  return undefined
}

/** Plain-text rendering of a node, used as display text for converted links. */
function nodesText(nodes: MdNode[] | undefined): string[] {
  const out: string[] = []
  if (!nodes) return out
  for (const n of nodes) out.push(nodeText(n))
  return out
}
export function nodeText(node: MdNode | undefined): string {
  if (!node) return ''
  const t = node.type
  if (t === 'html') return ''
  if (t === 'iembed') return node.href
  if (t === 'listItem') {
    const parts = nodesText(node.children)
    return parts.length === 1 ? parts[0] + '\n' : parts.join('\n')
  }
  if (t === 'tag') return node.tag
  if (t === 'comment') return ''
  let r: string =
    node.value || node.alt || node.title || (Object.prototype.hasOwnProperty.call(node, 'children') && nodesText(node.children).join('')) || ''
  if (t === 'list' && node.start !== undefined && node.start !== null) r = node.start + '. ' + r
  if (t === 'paragraph' || t === 'break' || t === 'heading' || t === 'code') r += '\n'
  else if (r.endsWith('\n')) r = r.substring(0, r.length - 1)
  if (t === 'tableCell') r += ' '
  else if (t === 'tableRow') r += '\n'
  return r
}

/** Heading text: source between first and last inline child, trimmed. */
export function headingText(text: string, node: MdNode): string {
  let start = node.position.end
  let end = node.position.end
  const c = node.children!
  if (c.length > 0) {
    start = c[0].position.start
    end = c[c.length - 1].position.end
  }
  return text.substring(start.offset, end.offset).trim()
}

/** Links found in frontmatter string values (nested keys joined with "."). */
export function getFrontmatterLinks(fm: any): FrontmatterLinkCache[] {
  const out: FrontmatterLinkCache[] = []
  const value = (prefix: string, key: string, v: any): void => {
    const k = prefix ? prefix + '.' + key : key
    if (typeof v === 'string') {
      if (v.startsWith('[[') && v.endsWith(']]')) {
        const { title, href } = parseWikilinkInner(v.substring(2, v.length - 2))
        out.push({ key: k, link: href, original: v, displayText: title })
      }
      if (v.startsWith('[') && v.endsWith(')')) {
        const m = v.match(MDLINK_FULL)
        if (m) {
          let url = m[5]
          if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1).trim()
          if (isInternalUrl(url)) {
            let link = url
            try {
              link = decodeURI(url)
            } catch {
              /* keep raw */
            }
            out.push({ key: k, link, original: v, displayText: m[2] })
          }
        }
      }
    } else walk(k, v)
  }
  const walk = (prefix: string, v: any): void => {
    if (Array.isArray(v)) for (let i = 0; i < v.length; i++) value(prefix, String(i), v[i])
    else if (typeof v === 'object') for (const key in v) if (Object.prototype.hasOwnProperty.call(v, key)) value(prefix, key, v[key])
  }
  walk('', fm)
  return out
}

export function computeMetadata(text: string, omitOriginal = false): CachedMetadata {
  const md: any = {
    links: [], embeds: [], tags: [], headings: [], footnotes: [], footnoteRefs: [],
    referenceLinks: [], sections: [], listItems: [], blocks: {}
  }
  const root = parseMarkdown(text)
  const first = root.children![0]
  if (first && first.type === 'yaml') {
    const fm = parseFrontMatterYaml(first.value)
    if (fm) {
      md.frontmatter = fm
      md.frontmatterPosition = toPos(first.position)
      md.frontmatterLinks = getFrontmatterLinks(fm)
    }
  }
  for (const node of root.children!) {
    const position = toPos(node.position)
    const section: any = { type: node.type, position }
    const id = node.id
    if (id && typeof id === 'string') {
      section.id = id
      md.blocks[id.toLowerCase()] = { position, id }
    }
    md.sections.push(section)
  }
  visit(root, ['heading', 'ilink', 'iembed', 'tag', 'listItem', 'fnRef', 'footnoteDefinition', 'definition'], (node, _i, parent) => {
    switch (node.type) {
      case 'fnRef': {
        const cp = node.data?.contentPosition
        if (cp) md.footnotes.push({ position: toPos(cp), id: node.identifier || '' })
        else md.footnoteRefs.push({ position: toPos(node.position), id: node.identifier || '' })
        return
      }
      case 'footnoteDefinition':
        md.footnotes.push({ position: toPos(node.position), id: node.identifier || '' })
        return
      case 'definition':
        if (node.url) md.referenceLinks.push({ position: toPos(node.position), id: node.label || node.identifier || '', link: node.url || '' })
        return
      case 'heading':
        if (parent!.type === 'root') md.headings.push({ position: toPos(node.position), heading: headingText(text, node), level: node.depth || 1 })
        return
      case 'ilink': {
        const original = text.substring(node.position.start.offset, node.position.end.offset)
        let displayText = node.title || ''
        if (!displayText && node.converted) displayText = nodeText(node)
        const ref: any = { position: toPos(node.position), link: node.href || '', original, displayText }
        if (omitOriginal) delete ref.original
        md.links.push(ref)
        return
      }
      case 'iembed': {
        const original = text.substring(node.position.start.offset, node.position.end.offset)
        const ref: any = { position: toPos(node.position), link: node.href || '', original, displayText: node.title || '' }
        if (omitOriginal) delete ref.original
        md.embeds.push(ref)
        return
      }
      case 'tag':
        md.tags.push({ position: toPos(node.position), tag: node.tag || '' })
        return
      case 'listItem': {
        if (node.synthetic) {
          if (node.data?.isInline) return
          return 'skip'
        }
        const position = toPos(node.position)
        const kids = node.children
        if (kids && kids.length > 1) {
          for (let b = kids.length - 1; b >= 0; b--) {
            const k = kids[b]
            if (k.type !== 'list') {
              position.end = loc(k.position.end)
              break
            }
            k.listParentPosition = node.position
          }
        }
        let parentLine = 0
        if (parent!.type === 'list') {
          if (parent!.listParentPosition) parentLine = parent!.listParentPosition.start.line - 1
          else if ((parentLine = -(parent!.position.start.line - 1)) == 0) parentLine = -1
        }
        const item: any = { position, parent: parentLine }
        if (typeof node.checklist === 'string') item.task = node.checklist
        const bid = node.id
        if (bid && typeof bid === 'string') {
          item.id = bid
          md.blocks[bid.toLowerCase()] = { position, id: bid }
        }
        md.listItems.push(item)
        return
      }
    }
  })
  for (const k of ['links', 'embeds', 'tags', 'headings', 'footnotes', 'footnoteRefs', 'referenceLinks']) if (md[k].length === 0) delete md[k]
  if (md.sections.length === 0 || omitOriginal) delete md.sections
  if (md.listItems.length === 0) delete md.listItems
  if (Object.keys(md.blocks).length === 0) delete md.blocks
  return md as CachedMetadata
}
