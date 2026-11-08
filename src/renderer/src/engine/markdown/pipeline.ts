/* eslint-disable @typescript-eslint/no-explicit-any */
// markdown → mdast → hast → HTML string for the reading view
// (parse, mdast transformers, handlers, hast transformers, serialise).
import vfile from 'vfile'
import visit from 'unist-util-visit'
import u from 'unist-builder'
import toHast from 'mdast-util-to-hast'
import all from 'mdast-util-to-hast/lib/all'
import wrap from 'mdast-util-to-hast/lib/wrap'
import toHtml from 'hast-util-to-html'
import definitions from 'mdast-util-definitions'
import { parse as parseYaml } from 'yaml'
import { QuartzParser, normalizeLinkPath } from './parser'

export type MdastNode = any
export type MdastTransformer = (tree: MdastNode, source: string) => void
export type HastTransformer = (tree: any, source: string) => void

export interface ParseOptions {
  /** `!strictLineBreaks` — single newlines become `<br>` (default true). */
  breaks: boolean
  commonmark: boolean
}

/** Default `globalOptions` for the parser class (`{breaks:true, commonmark:true}`). */
export const globalParseOptions: ParseOptions = { breaks: true, commonmark: true }

export const mdastTransformers: MdastTransformer[] = []
export const hastTransformers: HastTransformer[] = []
export const hastHandlers: Record<string, (h: any, node: any, parent?: any) => any> = {}

/** URLs that refer to vault files: `./x`, `../x`, or anything without a scheme colon. */
export function isInternalUrl(url: string): boolean {
  return url.startsWith('./') || url.startsWith('../') || url.indexOf(':') === -1
}
function safeDecodeURI(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

/** Parse `W` / `WxH`. */
export function parseSize(s: string): { x: number; y: number } | null {
  const m = s.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/)
  return m ? { x: parseInt(m[1]), y: m[2] ? parseInt(m[2]) : 0 } : null
}
function applySize(s: string, node: any): boolean {
  const size = parseSize(s)
  if (!size) return false
  const data = (node.data = node.data || {})
  const props = (data.hProperties = data.hProperties || {})
  props.width = String(size.x)
  if (size.y !== 0) props.height = String(size.y)
  return true
}

/** Raw source of a node's content (children range), trimmed. */
function nodeContentSource(source: string, node: any): string {
  let start = node.position.end
  let end = node.position.end
  const c = node.children
  if (c.length > 0) {
    start = c[0].position.start
    end = c[c.length - 1].position.end
  }
  return source.substring(start.offset, end.offset).trim()
}

// --- mdast transformers (registration order matters) ------------------------

// Task list items: any status char; checkbox node in front of the content.
mdastTransformers.push((tree) => {
  visit(tree, 'listItem', (item: any) => {
    if (typeof item.checked !== 'boolean') return
    const data = (item.data = item.data || {})
    const props = (data.hProperties = data.hProperties || {})
    props.className = 'task-list-item'
    if (item.checked) props.className += ' is-checked'
    if (item.checklist) props.dataTask = item.checklist
    let target = item
    const first = item.children[0]
    if (first && first.type === 'paragraph') target = first
    target.children.unshift({
      type: 'checklist',
      data: { hName: 'input', hProperties: { className: 'task-list-item-checkbox', type: 'checkbox', checked: item.checked } },
      position: item.position
    })
    delete item.checked
  })
})

// Markdown links with internal URLs → internal links.
mdastTransformers.push((tree) => {
  visit(tree, 'link', (node: any, index: number, parent: any) => {
    const url = node.url
    if (!url || !isInternalUrl(url)) return
    let decoded: string
    try {
      decoded = decodeURI(url)
    } catch {
      return
    }
    const href = normalizeLinkPath(decoded)
    parent.children[index] = {
      type: 'ilink',
      href,
      title: '',
      converted: true,
      data: { url, hName: 'a', hProperties: { href, dataHref: href, className: 'internal-link', title: node.title } },
      children: node.children,
      position: node.position
    }
  })
})

// Markdown images with internal URLs → internal embeds.
mdastTransformers.push((tree) => {
  visit(tree, 'image', (node: any, index: number, parent: any) => {
    const url = node.url
    if (!url || !isInternalUrl(url)) return
    const href = normalizeLinkPath(safeDecodeURI(url))
    parent.children[index] = {
      type: 'iembed',
      href,
      title: node.alt,
      data: { hName: 'span', hProperties: { className: 'internal-embed', src: href, alt: node.alt } },
      children: node.children,
      position: node.position
    }
  })
})

// Footnotes: numbering, reference markup, footnote section.
mdastTransformers.push((tree) => {
  const order: { count: number; identifier: string }[] = []
  const content: Record<string, any> = {}
  const indexById: Record<string, number> = {}
  const own = Object.prototype.hasOwnProperty
  function markRef(node: any, n: number, repeat: number): void {
    const num = String(n + 1)
    let label = num
    if (repeat > 0) label += '-' + repeat
    node.type = 'fnRef'
    node.data = { hName: 'sup', hProperties: { className: 'footnote-ref', 'data-footnote-id': 'fnref-' + label } }
    if (!node.identifier && own.call(node, 'children')) {
      const c = node.children
      const start = c[0]?.position?.start
      const end = c[c.length - 1]?.position?.end
      if (start && end) {
        node.data.contentPosition = { start, end }
        node.identifier = '[inline' + n
      }
    }
    node.children = [
      {
        type: 'element',
        data: {
          hName: 'a',
          hProperties: { className: 'footnote-link', href: '#fn-' + num, 'data-footref': node.identifier },
          hChildren: [{ type: 'text', value: '[' + label + ']' }]
        }
      }
    ]
  }
  visit(tree, 'footnoteDefinition', (node: any) => {
    const id = String(node.identifier)
    indexById[':' + id] = -1
    content[':' + id] = { children: node.children, position: node.position }
  })
  visit(tree, ['footnote', 'footnoteReference'], (node: any) => {
    if (node.type === 'footnote') {
      const n = order.length
      const key = String(n)
      order.push({ count: 1, identifier: key })
      content[key] = { children: node.children, position: node.position, isInline: !node.identifier && own.call(node, 'children') }
      markRef(node, n, 0)
    } else {
      const id = String(node.identifier)
      if (!own.call(indexById, ':' + id)) {
        node.type = 'text'
        node.value = id
        return
      }
      let n = indexById[':' + id]
      if (n === -1) {
        n = order.length
        indexById[':' + id] = n
        order.push({ count: 0, identifier: ':' + id })
      }
      const entry = order[n]
      const repeat = entry.count
      entry.count++
      markRef(node, n, repeat)
    }
  })
  const items: any[] = []
  for (let a = 0; a < order.length; a++) {
    const entry = order[a]
    const def = content[entry.identifier]
    if (!def) continue
    let target = def.children
    const last = target[target.length - 1]
    if (last && last.type === 'paragraph') target = last.children
    const num = String(a + 1)
    for (let p = 0; p < entry.count; p++) {
      let label = num
      if (p > 0) label += '-' + p
      target.push({
        type: 'element',
        data: {
          hName: 'a',
          hProperties: { className: 'footnote-backref footnote-link', href: '#fnref-' + label },
          hChildren: [{ type: 'text', value: '↩︎' }]
        }
      })
    }
    items.push({
      type: 'listItem',
      synthetic: true,
      data: { hProperties: { 'data-footnote-id': 'fn-' + num }, isInline: def.isInline },
      children: [{ type: 'paragraph', children: def.children }],
      position: def.position
    })
  }
  if (items.length !== 0) {
    const lastChild = tree.children[tree.children.length - 1]
    const point = lastChild
      ? { line: lastChild.position.end.line + 1, column: 1, offset: lastChild.position.end.offset }
      : { line: 1, column: 1, offset: 0 }
    const pos = { start: point, end: point }
    tree.children = tree.children.concat(
      { type: 'text', value: '\n', position: pos },
      {
        type: 'element',
        position: pos,
        data: { hName: 'section', hProperties: { className: 'footnotes' } },
        children: [
          { type: 'thematicBreak', position: pos },
          { type: 'list', position: pos, ordered: true, start: 1, spread: false, children: items }
        ]
      }
    )
  }
})

// `![alt|WxH](url)` sizing.
mdastTransformers.push((tree) => {
  visit(tree, 'image', (node: any) => {
    let alt = node.alt
    if (!alt) return
    const pipe = alt.lastIndexOf('|')
    let size = alt
    if (pipe !== -1) {
      size = alt.substr(pipe + 1)
      alt = alt.substr(0, pipe)
    }
    if (applySize(size, node)) node.alt = alt
  })
})

// `![[x|WxH]]` sizing; alt falls back to the href.
mdastTransformers.push((tree) => {
  visit(tree, 'iembed', (node: any) => {
    let title = node.title
    if (!title) return
    const pipe = title.lastIndexOf('|')
    if (pipe !== -1) {
      if (applySize(title.substr(pipe + 1), node)) title = title.substr(0, pipe)
    } else if (applySize(title, node)) title = ''
    if (!title) title = node.href
    node.data.hProperties.alt = title
  })
})

// Block ids: removed from output, attached to the owning block / list item.
hastHandlers.blockid = () => null
mdastTransformers.push((tree) => {
  const children = tree.children
  let next = 0
  for (let r = 0; r < children.length; r++) {
    const node = children[r]
    if (node.type === 'blockid') {
      if (r > 0) children[r - 1].id = node.id
      children.splice(r, 1)
      r--
      continue
    }
    if (node.type === 'list') {
      visit(node, 'listItem', (item: any) => {
        let id: string | null = null
        visit(item, ['list', 'blockid'], (n: any) => {
          if (n.type === 'list') return 'skip'
          id = n.id
          return false
        })
        if (id) item.id = id
      })
      continue
    }
    let id: string | null = null
    visit(node, 'blockid', (n: any) => {
      id = n.id
    })
    if (id) node.id = id
  }
  void next
})

// Headings carry their raw source text.
mdastTransformers.push((tree, source) => {
  visit(tree, 'heading', (node: any) => {
    node.data = { hProperties: { dataHeading: nodeContentSource(source, node) } }
  })
})

// Callouts.
hastHandlers.callout = (h: any, node: any) => {
  const c = node.callout
  let color = c.color
  let style: string | null = null
  if (color) {
    color = color.replace(/^#([a-f\d])([a-f\d])([a-f\d])$/i, (_: string, r: string, g: string, b: string) => '#' + r + r + g + g + b + b)
    if (/^#[a-f\d]{6}$/i.test(color)) style = '--callout-color: ' + color + ';'
  }
  return h(
    node,
    'div',
    {
      className: 'callout',
      dataCallout: c.type,
      dataCalloutIcon: c.icon,
      dataCalloutFold: c.fold,
      dataCalloutMetadata: c.data,
      style
    },
    all(h, node)
  )
}
hastHandlers['callout-title'] = (h: any, node: any) =>
  h(node, 'div', { className: 'callout-title' }, [
    h({}, 'div', { className: 'callout-icon' }),
    h({}, 'div', { className: 'callout-title-inner' }, all(h, node))
  ])
hastHandlers['callout-content'] = (h: any, node: any) => h(node, 'div', { className: 'callout-content' }, wrap(all(h, node), true))
mdastTransformers.push((tree) => {
  visit(tree, 'blockquote', (node: any) => {
    const callout = node.callout
    if (!callout) return
    node.type = 'callout'
    const out: any[] = []
    const kids = node.children
    const first = kids && kids[0]
    if (first && first.position.start.line === node.position.start.line) {
      if (first.type === 'paragraph') {
        const inl = first.children
        let a = 0
        let brk: any
        for (; a < inl.length; a++) {
          if (inl[a].type === 'break') {
            brk = inl[a]
            break
          }
        }
        const rest = kids.slice(1)
        if (brk) {
          out.push({ type: 'callout-title', position: { start: first.position.start, end: brk.position.start }, children: inl.slice(0, a) })
          first.position.start = brk.position.end
          first.children = inl.slice(a + 1)
          rest.unshift(first)
        } else {
          out.push({ type: 'callout-title', position: first.position, children: inl })
        }
        if (rest.length > 0) {
          out.push({
            type: 'callout-content',
            position: { start: rest[0].position.start, end: rest[rest.length - 1].position.end },
            children: rest
          })
        }
      } else {
        out.push({ type: 'callout-title', position: first.position, children: [first] })
        const second = kids[1]
        if (second) {
          out.push({
            type: 'callout-content',
            position: { start: second.position.start, end: kids[kids.length - 1].position.end },
            children: kids.slice(1)
          })
        }
      }
    } else {
      const pos = { start: node.position.start, end: node.position.start }
      let title = callout.type.trim().replace(/-/g, ' ').toLowerCase()
      title = title.charAt(0).toUpperCase() + title.substr(1)
      out.push({ type: 'callout-title', position: pos, children: [{ type: 'text', value: title, position: pos }] })
      if (first) out.push({ type: 'callout-content', position: node.position, children: kids })
    }
    node.children = out
  })
})

// External links (hast): every <a> without a class.
hastTransformers.push((tree) => {
  visit(tree, { type: 'element', tagName: 'a' }, (el: any) => {
    const p = el.properties
    if (!p || p.className) return
    p.className = 'external-link'
    p.target = '_blank'
    p.rel = 'noopener nofollow'
    let text = ''
    const c = el.children
    if (c && c.length > 0) text = c[0].value
    if (p.href !== text) {
      p['aria-label'] = p.href
      p['data-tooltip-position'] = 'top'
    }
  })
})

// Frontmatter → hidden `pre.frontmatter`.
hastHandlers.yaml = (h: any, node: any) =>
  h(node.position, 'pre', { className: 'frontmatter' }, [h(node, 'code', { className: 'language-yaml' }, [u('text', node.value || '')])])

// %%comments%% vanish.
hastHandlers.comment = () => null

// --- entry points ----------------------------------------------------------

/** Parse markdown into mdast (after transformers). */
export function parseMarkdown(markdown: string, options: ParseOptions = globalParseOptions): MdastNode {
  const file = vfile(markdown)
  const parser = new QuartzParser(String(file), file)
  parser.setOptions(options)
  const tree = parser.parse()
  for (const t of mdastTransformers) t(tree, markdown)
  return tree
}

/** Frontmatter object of a parsed tree (first `yaml` node), `null` on YAML error. */
export function getFrontMatter(tree: MdastNode): Record<string, unknown> | null | undefined {
  const first = tree.children[0]
  if (!first || first.type !== 'yaml') return undefined
  try {
    const v = parseYaml(first.value)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v || undefined
  } catch {
    return null
  }
  return undefined
}

export function collectDefinitions(tree: MdastNode): any {
  return definitions(tree)
}

/** mdast → HTML string (unsanitised). `defs` lets a section see the whole document's link definitions. */
export function mdastToHtml(tree: MdastNode, defs?: any[]): string {
  let root = tree
  if (defs && defs.length) root = { ...tree, children: [...defs, ...tree.children] }
  const hast = toHast(root, { allowDangerousHtml: true, handlers: hastHandlers })
  for (const t of hastTransformers) t(hast, '')
  return toHtml(hast, { allowDangerousHtml: true })
}

/** Markdown → HTML string (unsanitised). */
export function markdownToHtml(markdown: string, options?: ParseOptions): string {
  return mdastToHtml(parseMarkdown(markdown, options))
}
