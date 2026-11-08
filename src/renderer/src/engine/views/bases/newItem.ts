/* eslint-disable @typescript-eslint/no-explicit-any */
// "New item" support for Bases: where a note created from a view is placed and which frontmatter it starts
// with. Both are derived from the view's filters (written from observed behaviour):
//   file.inFolder("x") / file.folder == "x"   -> folder
//   prop == v, >= v, <= v                      -> prop: v
//   !prop.isEmpty()                            -> prop: ""
//   prop.contains/startsWith/endsWith/containsAll(v), containsAny(v)  -> prop: v (list for list-typed props)
//   file.hasTag("t"), file.tags.contains(..)   -> tags: [t]
//   file.hasProperty("p")                      -> p: null
// and every other column of the view starts as `prop: null`.
import { ExprFilter, AndFilter, NotFilter, splitPropertyId, type FilterNode, type ViewConfig, type BaseConfig } from './BaseConfig'
import { parseExpression, type Node } from './expr/parser'
import { build } from './expr/Formula'
import { ErrorValue, FileValue, LinkValue, ListValue, NullValue, ObjectValue, PrimitiveValue, type Value } from './values'

interface Prop { type: 'note' | 'file' | 'formula'; name: string }

const SCOPES = ['note', 'file', 'formula']

/** Leaf expressions that must all hold (top-level `and` groups are flattened; negated ones are skipped). */
function rules(f: FilterNode | undefined, out: Node[]): Node[] {
  if (!f) return out
  if (f instanceof ExprFilter) {
    try {
      out.push(parseExpression(f.expr.text))
    } catch {
      /* invalid formula */
    }
  } else if (f instanceof AndFilter) for (const k of f.filters) rules(k, out)
  else if (f instanceof NotFilter) void 0
  return out
}

function propOf(n: Node): Prop {
  switch (n.type) {
    case 'object_access': {
      if (n.object.type === 'ident' && n.index.type === 'ident') {
        const id = n.object.value
        return SCOPES.includes(id) || id === 'file' ? { type: id as Prop['type'], name: n.index.value } : { type: 'note', name: id + '.' + n.index.value }
      }
      break
    }
    case 'array_access':
      if (n.array.type === 'ident' && SCOPES.includes(n.array.value) && n.index.type === 'primitive') return { type: n.array.value as Prop['type'], name: String(n.index.value) }
      break
    case 'ident':
      if (['true', 'false', 'null'].includes(n.value)) throw new Error('Unsupported left-hand side of formula')
      return n.value === 'file' ? { type: 'file', name: 'file' } : { type: 'note', name: n.value }
    case 'call':
      if (n.object.type === 'ident' && n.object.value === 'list' && n.args.length === 1) return propOf(n.args[0])
  }
  throw new Error('Formula cannot be deserialized')
}

/** A value as it is stored in frontmatter. */
export function toFrontmatter(app: any, v: Value, source: string): any {
  if (v instanceof FileValue) return `[[${app.metadataCache.fileToLinktext(v.file, source)}]]`
  if (v instanceof LinkValue) {
    const dest = app.metadataCache.getFirstLinkpathDest(v.value, source)
    const target = dest ? app.metadataCache.fileToLinktext(dest, source) : v.value
    return `[[${target}${v.display ? '|' + v.display : ''}]]`
  }
  if (v instanceof PrimitiveValue) return v.value
  if (v instanceof NullValue) return null
  if (v instanceof ListValue) return Array.from({ length: v.length() }, (_, i) => toFrontmatter(app, v.get(i), source))
  if (v instanceof ObjectValue) return Object.fromEntries(v.keys().map((k: string) => [k, toFrontmatter(app, v.get(k)!, source)]))
  return v.toString()
}

export function deriveNewItem(app: any, query: BaseConfig, view: ViewConfig | null, entry?: any): { frontmatter: Record<string, any>; folder: string } {
  const fm: Record<string, any> = {}
  let folder = ''
  const source = entry ? entry.file.path : ''
  const scope = entry ?? { app, keys: () => [], getByIdentifier: () => null }
  const arg = (nodes: Node[]): any => {
    if (nodes.length === 0) throw new Error('Formula cannot be deserialized')
    const vals = nodes.map(n => {
      let v: Value | null = null
      try {
        v = build(n).getValue(scope)
      } catch {
        /* ignore */
      }
      if (!v || v instanceof ErrorValue) v = null
      return v ? toFrontmatter(app, v, source) : null
    })
    return vals.length > 1 ? vals : vals[0]
  }
  const leaves = [...rules(query.filters, []), ...rules(view?.filters, [])]
  for (let node of leaves) {
    while (node.type === 'paren') node = node.value
    if (node.type === 'not') {
      const d = node.expr
      if (d.type === 'call' && d.object.type === 'object_access' && d.object.index.type === 'ident' && d.object.index.value === 'isEmpty') {
        try {
          const p = propOf(d.object.object)
          if (p.type === 'note' && !Object.hasOwn(fm, p.name)) fm[p.name] = ''
        } catch {
          /* ignore */
        }
      }
    } else if (node.type === 'compare') {
      try {
        if (!['>=', '<=', '=='].includes(node.op)) continue
        const p = propOf(node.left)
        const y = arg([node.right])
        if (p.type === 'note') fm[p.name] = y
        else if (p.type === 'file' && p.name === 'folder' && node.op === '==' && typeof y === 'string') folder = y
      } catch {
        /* ignore */
      }
    } else if (node.type === 'call' && node.object.type === 'object_access' && node.object.index.type === 'ident') {
      const fn = node.object.index.value
      try {
        const p = propOf(node.object.object)
        let y = arg(node.args)
        if (p.type === 'note') {
          if (['startsWith', 'endsWith', 'contains', 'containsAll'].includes(fn)) {
            if (app.metadataTypeManager?.getTypeInfo?.(p.name).inferred.type === 'multitext' && !Array.isArray(y)) y = [y]
            fm[p.name] = y
          } else if (fn === 'containsAny') {
            const w = Array.isArray(y) ? y[0] : y
            fm[p.name] = app.metadataTypeManager?.getTypeInfo?.(p.name).inferred.type === 'multitext' ? [w] : w
          }
        } else if (p.type === 'file') {
          if (fn === 'hasTag' && typeof y === 'string') {
            const cur = Object.hasOwn(fm, 'tags') ? fm.tags : []
            if (Array.isArray(cur)) {
              cur.push(y)
              fm.tags = cur
            }
          } else if (fn === 'inFolder' && typeof y === 'string') folder = y
          else if (fn === 'hasProperty' && typeof y === 'string') fm[y] = null
          else if (p.name === 'tags') {
            if (fn === 'containsAny') fm.tags = [Array.isArray(y) ? y[0] : y]
            else if (fn === 'contains' || fn === 'containsAll') fm.tags = Array.isArray(y) ? y : [y]
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  for (const id of view?.getOrder() ?? []) {
    const { type, name } = splitPropertyId(id)
    if (type === 'note' && !Object.hasOwn(fm, name)) fm[name] = null
  }
  return { frontmatter: fm, folder }
}

/** The frontmatter value that puts a note into the group `key` of property `prop` (null clears the property). */
export function groupKeyToFrontmatter(app: any, key: Value, prop: string, file: any): any {
  const v = toFrontmatter(app, key, file.path)
  return app.metadataTypeManager?.getTypeInfo?.(prop).inferred.type === 'multitext' && v !== null && !Array.isArray(v) ? [v] : v
}
