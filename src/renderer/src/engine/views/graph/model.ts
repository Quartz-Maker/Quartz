// Renderer-side graph model (`setData`): diff-based node/link identity, new-node
// placement and weights. Independent of PIXI so it can be tested headlessly.
//   - existing nodes keep their object and position; only colour/type change
//   - new nodes: centroid of already-placed neighbours ± jitter √(3600·n); otherwise a random point in the ring
//     between the current extent R and √(3600·n/π + R²)
//   - weight = neighbour count (forward + reverse keys) unless data.weights is given (local graph)
//   - any topology/weight change posts {nodes, links, alpha: .3, run: true} to the worker
import type { GraphData, GraphColor } from './data'
import type { SimMessage } from './simulation'

export interface ModelNode {
  id: string
  type: string
  x: number | null
  y: number | null
  fx: number | null
  fy: number | null
  forward: Record<string, ModelLink>
  reverse: Record<string, ModelLink>
  weight: number
  color: GraphColor | null
  getRelated(): string[]
}
export interface ModelLink {
  source: ModelNode
  target: ModelLink['source']
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export interface ModelHooks<N extends ModelNode, L extends ModelLink> {
  createNode(id: string, type: string): N
  createLink(source: N, target: N): L
  destroyNode(node: N): void
  destroyLink(link: L): void
  post(msg: SimMessage): void
  changed(): void
  random?: () => number
}

export function relatedIds(n: { forward: object; reverse: object }): string[] {
  return Object.keys(n.forward).concat(Object.keys(n.reverse))
}

export function setGraphData<N extends ModelNode, L extends ModelLink>(
  nodes: N[],
  lookup: Record<string, N>,
  links: L[],
  data: GraphData,
  hooks: ModelHooks<N, L>
): void {
  const random = hooks.random || Math.random
  const incoming = data.nodes
  const positions: Record<string, [number, number] | false> = {}
  const removedNodes: N[] = []
  const removedLinks: L[] = []
  let topology = false
  let visual = false
  let maxSq = 0
  for (const n of nodes) {
    if (hasOwn(incoming, n.id)) {
      maxSq = Math.max(maxSq, (n.x as number) * (n.x as number) + (n.y as number) * (n.y as number))
      positions[n.id] = false
    } else {
      removedNodes.push(n)
      topology = true
    }
  }
  const extent = Math.sqrt(maxSq)
  const added: N[] = []
  for (const id in incoming) {
    if (!hasOwn(incoming, id)) continue
    const d = incoming[id]
    if (hasOwn(lookup, id)) {
      const n = lookup[id]
      const color = d.color || null
      if (n.color !== color) {
        n.color = color
        visual = true
      }
      if (n.type !== d.type) {
        n.type = d.type
        visual = true
      }
    } else {
      const n = hooks.createNode(id, d.type)
      n.color = d.color || null
      nodes.push(n)
      lookup[id] = n
      topology = true
      added.push(n)
    }
  }
  for (const id in incoming) {
    if (!hasOwn(incoming, id) || !hasOwn(lookup, id)) continue
    const n = lookup[id]
    const want = incoming[id].links
    for (const t in n.forward) if (hasOwn(n.forward, t) && !hasOwn(want, t)) {
      removedLinks.push(n.forward[t] as L)
      topology = true
    }
    for (const t in want) {
      if (!hasOwn(want, t) || hasOwn(n.forward, t) || !hasOwn(lookup, t)) continue
      const target = lookup[t]
      const l = hooks.createLink(n, target)
      links.push(l)
      n.forward[target.id] = l
      target.reverse[n.id] = l
      topology = true
    }
  }
  const dropLink = (l: L) => {
    hooks.destroyLink(l)
    const i = links.indexOf(l)
    if (i !== -1) links.splice(i, 1)
    delete l.source.forward[l.target.id]
    delete l.target.reverse[l.source.id]
  }
  for (const l of removedLinks) dropLink(l)
  for (const n of removedNodes) {
    hooks.destroyNode(n)
    const i = nodes.indexOf(n)
    if (i !== -1) nodes.splice(i, 1)
    delete lookup[n.id]
    for (const t in n.forward) if (hasOwn(n.forward, t)) dropLink(n.forward[t] as L)
    for (const t in n.reverse) if (hasOwn(n.reverse, t)) dropLink(n.reverse[t] as L)
  }
  const count = added.length
  if (count > 0) {
    const area = 60 * count * 60
    const ring = Math.sqrt(area / Math.PI + extent * extent) - extent
    const jitter = Math.sqrt(area)
    for (const n of added) {
      let sx = 0, sy = 0, k = 0
      for (const id of n.getRelated()) {
        if (!hasOwn(lookup, id)) continue
        const o = lookup[id]
        if (o.x !== null && o.y !== null) {
          sx += o.x
          sy += o.y
          k++
        }
      }
      if (k > 0) {
        n.x = sx / k + (random() - 0.5) * jitter
        n.y = sy / k + (random() - 0.5) * jitter
      } else {
        const a = 2 * random() * Math.PI
        const r = extent + Math.sqrt(random()) * ring
        n.x = r * Math.cos(a)
        n.y = r * Math.sin(a)
      }
      positions[n.id] = [n.x, n.y]
    }
  }
  const weights = data.weights
  for (const id in lookup) {
    if (!hasOwn(lookup, id)) continue
    const n = lookup[id]
    const w = weights ? (hasOwn(weights, id) ? weights[id] : 0) : n.getRelated().length
    if (n.weight !== w) {
      n.weight = w
      topology = true
    }
  }
  if (topology) {
    hooks.post({ nodes: positions as any, links: links.map(l => [l.source.id, l.target.id]), alpha: 0.3, run: true })
    hooks.changed()
  } else if (visual) hooks.changed()
}

/** Plain model node (tests / headless use). */
export function plainNode(id: string, type: string): ModelNode {
  const n: ModelNode = {
    id,
    type,
    x: null,
    y: null,
    fx: null,
    fy: null,
    forward: {},
    reverse: {},
    weight: 0,
    color: null,
    getRelated: () => relatedIds(n)
  }
  return n
}
