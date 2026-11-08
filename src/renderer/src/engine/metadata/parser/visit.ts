/* eslint-disable @typescript-eslint/no-explicit-any */
// Pre-order tree walk with unist-util-visit semantics: the visitor may return
// 'skip' (don't descend), false (stop everything) or a number (next sibling index).
export interface MdNode {
  type: string
  children?: MdNode[]
  position?: any
  [key: string]: any
}
export type VisitResult = 'skip' | false | number | void | undefined | true
export type Visitor = (node: MdNode, index: number | null, parent: MdNode | null) => VisitResult

export function visit(tree: MdNode, test: string | string[] | null, visitor: Visitor): void {
  const matches = (node: MdNode): boolean =>
    test === null ? true : typeof test === 'string' ? node.type === test : test.includes(node.type)

  const one = (node: MdNode, index: number | null, parent: MdNode | null): VisitResult => {
    let result: VisitResult
    if (matches(node)) {
      result = visitor(node, index, parent)
      if (result === false) return false
    }
    if (node.children && result !== 'skip') {
      const sub = all(node.children, node)
      if (sub === false) return false
    }
    return typeof result === 'number' ? result : undefined
  }
  const all = (children: MdNode[], parent: MdNode): VisitResult => {
    let index = 0
    while (index > -1 && index < children.length) {
      const r = one(children[index], index, parent)
      if (r === false) return false
      index = typeof r === 'number' ? r : index + 1
    }
  }
  one(tree, null, null)
}
