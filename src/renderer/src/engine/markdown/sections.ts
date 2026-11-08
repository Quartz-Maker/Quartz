/* eslint-disable @typescript-eslint/no-explicit-any */
// Section splitting for the reading view: parse once,
// serialise each top-level mdast child separately, with `data-line` on list items,
// checkboxes and code relative to the section start. Level = heading depth or 7.
import visit from 'unist-util-visit'
import { parseMarkdown, mdastToHtml, getFrontMatter, globalParseOptions, type ParseOptions } from './pipeline'

export interface Loc {
  line: number
  col: number
  offset: number
}
export interface ParsedSection {
  html: string
  pos: { start: Loc; end: Loc }
  level: number
}
export interface ParsedSections {
  sections: ParsedSection[]
  frontmatter: Record<string, unknown> | null | undefined
}

/** unist position → `{line, col, offset}` (0-based line/col). */
function toLoc(p: any): Loc {
  return { line: p.line - 1, col: p.column - 1, offset: p.offset }
}

export function parseSections(text: string, options: ParseOptions = globalParseOptions): ParsedSections {
  const tree = parseMarkdown(text, options)
  const definitions: any[] = []
  visit(tree, 'definition', (n: any) => {
    definitions.push(n)
  })
  const frontmatter = getFrontMatter(tree)
  const children = tree.children
  const sections: ParsedSection[] = []
  for (const node of children) {
    const level = node.type === 'heading' ? node.depth || 1 : 7
    visit(node, ['checklist', 'listItem', 'code'], (n: any) => {
      const data = (n.data = n.data || {})
      ;(data.hProperties = data.hProperties || {})['data-line'] = String(n.position.start.line - node.position.start.line)
    })
    const html = mdastToHtml({ ...tree, children: [node] }, definitions)
    sections.push({ html, pos: { start: toLoc(node.position.start), end: toLoc(node.position.end) }, level })
  }
  return { sections, frontmatter }
}
