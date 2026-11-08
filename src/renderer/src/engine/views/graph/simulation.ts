// Graph force simulation — worker model (sim.js) on d3-force (ISC), runtime-agnostic so it runs
// in the Web Worker and in tests.
//   forces: forceX(0)+forceY(0) with strength = centerStrength (pull to origin, NOT forceCenter),
//           forceLink distance = linkDistance, strength = linkStrength × d3 default (1/min(degree)),
//           forceManyBody strength = −repel (|repel| < 1 → −1), distanceMin 30, theta 0.9,
//           forceCollide radius 60, strength 0.5.
//   tick:   alpha += (alphaTarget − alpha) · (1 − 0.001^(1/300)); forces; v *= 0.6; x += v. Runs while alpha > 0.001.
// Message protocol (main → worker), every key optional:
//   { nodes: {id: [x,y] | null | false}, links: [[src, tgt]], forceNode: {id, x, y}, forces: {centerStrength,
//     linkStrength, linkDistance, repelStrength}, alpha (only ever raises), alphaTarget, run }
// Worker → main: { id: string[], buffer: Float32 x/y pairs, v } — SharedArrayBuffer with a version counter in the
// last 4 bytes (posted only when the buffer is reallocated or v changes), or a transferred ArrayBuffer.
import { forceX, forceY, forceLink, forceManyBody, forceCollide } from 'd3-force'

export interface SimNode {
  id: string
  index?: number
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
}
interface SimLink {
  source: SimNode
  target: SimNode
}
export interface SimForces {
  centerStrength?: number
  linkStrength?: number
  linkDistance?: number
  repelStrength?: number
}
export interface SimMessage {
  nodes?: Record<string, [number, number] | null | false>
  links?: [string, string][]
  forceNode?: { id: string; x: number | null; y: number | null }
  forces?: SimForces
  alpha?: number
  alphaTarget?: number
  run?: boolean
}

export const ALPHA_MIN = 0.001
export const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300)
export const VELOCITY_KEEP = 0.6

/** d3's linear congruential generator (deterministic jiggle), seedable for tests. */
export function lcg(seed = 1): () => number {
  let s = seed
  return () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296
}

export class GraphSimulation {
  alpha = 1
  alphaTarget = 0
  center = 0.1
  linkMult = 1
  distance = 250
  charge = -1000
  nodes: SimNode[] = []
  links: SimLink[] = []
  lookup: Record<string, SimNode> = {}
  private dataDirty = false
  private linksDirty = false
  private forcesDirty = true
  private random: () => number
  private fx = forceX<SimNode>(0)
  private fy = forceY<SimNode>(0)
  private link = forceLink<SimNode, SimLink>([]).id(d => d.id)
  private linkDefaultStrength: (l: SimLink, i: number, links: SimLink[]) => number
  private manyBody = forceManyBody<SimNode>().distanceMin(30).theta(0.9)
  private collide = forceCollide<SimNode>(60).strength(0.5)

  constructor(random: () => number = lcg()) {
    this.random = random
    this.linkDefaultStrength = this.link.strength() as any
  }

  /** Apply one main-thread message. Returns true when the loop should be (re)started. */
  handleMessage(m: SimMessage): boolean {
    const nodes = m.nodes
    if (nodes) {
      const list: SimNode[] = []
      for (const id in this.lookup) {
        if (!Object.prototype.hasOwnProperty.call(this.lookup, id)) continue
        if (!Object.prototype.hasOwnProperty.call(nodes, id)) delete this.lookup[id]
        else list.push(this.lookup[id])
      }
      for (const id in nodes) {
        if (!Object.prototype.hasOwnProperty.call(nodes, id)) continue
        const pos = nodes[id]
        let n = this.lookup[id]
        if (!n) {
          n = this.lookup[id] = { id, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null }
          list.push(n)
        }
        if (pos) {
          n.x = pos[0]
          n.y = pos[1]
        }
      }
      list.forEach((n, i) => (n.index = i))
      this.nodes = list
      this.dataDirty = true
    }
    if (m.links) {
      const links: SimLink[] = []
      for (const [s, t] of m.links) {
        const a = this.lookup[s], b = this.lookup[t]
        if (a && b) links.push({ source: a, target: b })
      }
      this.links = links
      this.linksDirty = true
    }
    if (m.forceNode) {
      const n = this.lookup[m.forceNode.id]
      if (n) {
        n.fx = m.forceNode.x
        n.fy = m.forceNode.y
      }
    }
    const f = m.forces
    if (f !== undefined) {
      if (f.centerStrength !== undefined) this.center = f.centerStrength
      if (f.linkStrength !== undefined) this.linkMult = f.linkStrength
      if (f.linkDistance !== undefined) this.distance = f.linkDistance
      if (f.repelStrength !== undefined) {
        this.charge = -f.repelStrength
        if (Math.abs(f.repelStrength) < 1) this.charge = -1
      }
      this.forcesDirty = true
    }
    if (m.alpha !== undefined && this.alpha < m.alpha) this.alpha = m.alpha
    if (m.alphaTarget !== undefined) this.alphaTarget = m.alphaTarget
    return m.run !== undefined
  }

  get running(): boolean {
    return this.alpha > ALPHA_MIN
  }

  /** One simulation step (alpha update, forces, integration). */
  tick(): void {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY
    const forces = [this.fx, this.fy, this.link, this.manyBody, this.collide]
    if (this.dataDirty) {
      for (const force of forces) (force as any).initialize(this.nodes, this.random)
      this.dataDirty = false
      this.linksDirty = true
    }
    if (this.linksDirty) {
      this.link.links(this.links)
      this.linksDirty = false
    }
    if (this.forcesDirty) {
      this.fx.strength(this.center)
      this.fy.strength(this.center)
      const base = this.linkDefaultStrength, mult = this.linkMult
      this.link.strength((l, i, ls) => mult * base(l, i, ls))
      this.link.distance(this.distance)
      this.manyBody.strength(this.charge)
      this.forcesDirty = false
    }
    for (const force of forces) force(this.alpha)
    for (const n of this.nodes) {
      if (n.fx == null) n.x += n.vx *= VELOCITY_KEEP
      else {
        n.x = n.fx
        n.vx = 0
      }
      if (n.fy == null) n.y += n.vy *= VELOCITY_KEEP
      else {
        n.y = n.fy
        n.vy = 0
      }
    }
  }

  /** Write x/y pairs into a buffer, return the id order. */
  writePositions(buffer: ArrayBufferLike): string[] {
    const ids: string[] = []
    const f = new Float32Array(buffer, 0, this.nodes.length * 2)
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]
      ids.push(n.id)
      f[2 * i] = n.x
      f[2 * i + 1] = n.y
    }
    return ids
  }
}

/** Positions channel: SharedArrayBuffer + version counter, or transferable ArrayBuffer. */
export class PositionPoster {
  private shared: SharedArrayBuffer | null = null
  constructor(
    private post: (msg: any, transfer?: Transferable[]) => void,
    private useShared: boolean
  ) {}

  send(sim: GraphSimulation): void {
    if (this.useShared) {
      const size = 4 * sim.nodes.length * 2 + 4
      if (!this.shared || this.shared.byteLength !== size) this.shared = new SharedArrayBuffer(size)
      const ids = sim.writePositions(this.shared)
      const ver = new Uint32Array(this.shared, this.shared.byteLength - 4, 1)
      const v = ver[0]
      ver[0]++
      this.post({ id: ids, buffer: this.shared, v })
    } else {
      const buf = new ArrayBuffer(4 * sim.nodes.length * 2)
      const ids = sim.writePositions(buf)
      this.post({ id: ids, buffer: buf }, [buf])
    }
  }
}

/** The worker's 60 Hz loop: ticks while alpha > 0.001 and posts positions after each tick. */
export class SimulationLoop {
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    public sim: GraphSimulation,
    private poster: PositionPoster,
    private interval = 1000 / 60
  ) {}

  onMessage(m: SimMessage): void {
    if (this.sim.handleMessage(m)) this.schedule()
  }

  private schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => this.step(), this.interval)
  }

  private step(): void {
    this.timer = null
    if (!this.sim.running) return
    this.schedule()
    if (this.sim.nodes.length === 0) return
    this.sim.tick()
    this.poster.send(this.sim)
  }
}
