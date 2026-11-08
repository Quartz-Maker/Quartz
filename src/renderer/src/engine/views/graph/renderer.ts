// Graph renderer, backend-agnostic core:
//   rAF loop that stops after 60 idle frames, ≤ 50 new node graphics per frame (nearest to viewport centre),
//   viewport culling, eased hover fades (0.9/frame), zoom easing (0.85) clamped to [1/128, 8], inertia pan,
//   keyboard pan/zoom, colours from `.graph-view.color-*` probes.
// The scene objects come from a SceneBackend (PIXI 7.2.4 in the app — ./pixiBackend.ts; fakes in tests).
import type { GraphData } from './data'
import { displayText } from './data'
import { setGraphData, relatedIds, type ModelNode } from './model'
import type { SimMessage } from './simulation'
import {
  FADED_ALPHA,
  ease,
  easeTint,
  nodeSize,
  nodeScaleFor,
  textAlphaFor,
  arrowRamp,
  outside,
  boxAround,
  ZOOM_MIN,
  ZOOM_MAX,
  wheelFactor,
  labelFontSize,
  LABEL_FONT,
  readGraphColors,
  type Box,
  type GraphColors
} from './formulas'

export interface SceneObject {
  x: number
  y: number
  visible: boolean
  alpha: number
  rotation: number
  scale: { x: number; y: number }
  parent: any
  zIndex: number
  destroy(options?: any): void
}
export interface TintedObject extends SceneObject {
  tint: number
}
export interface TextObject extends SceneObject {
  text: string
  style: any
}
export interface RingObject extends SceneObject {
  clear(): void
  lineStyle(width: number, color: number, alpha: number): void
  drawCircle(x: number, y: number, r: number): void
}
export interface LineObject extends TintedObject {
  width: number
  height: number
}
export interface ContainerObject extends SceneObject {
  pivot: { set(x: number, y: number): void }
  addChild(o: any): any
  removeChild(o: any): any
}
export interface ArrowObject extends TintedObject {
  pivot: { set(x: number, y: number): void }
}
export interface LabelStyle {
  fontSize: number
  fill: number
  fontFamily: string
  wordWrap: boolean
  wordWrapWidth: number
  align: 'center'
}

export interface SceneBackend {
  createCircle(node: GraphNode, color: { a: number; rgb: number }): TintedObject
  createText(text: string, style: LabelStyle): TextObject
  setTextStyle(text: TextObject, style: LabelStyle): void
  createRing(): RingObject
  createLinkContainer(): ContainerObject
  createLine(color: { a: number; rgb: number }): LineObject
  createArrow(color: { a: number; rgb: number }): ArrowObject
  /** Sort children by zIndex and draw. */
  present(): void
  /** PNG-able canvas of the current frame (transparent). */
  snapshot(): HTMLCanvasElement
  resize(width: number, height: number, dpr: number): void
  setTransform(panX: number, panY: number, scale: number): void
  destroy(): void
}

export interface WorkerLike {
  postMessage(msg: any): void
  terminate(): void
  onmessage: ((e: MessageEvent) => void) | null
}

function detachObj(o: SceneObject | null | undefined): void {
  if (!o) return
  if (o.parent) o.parent.removeChild(o)
  o.destroy()
}

export class GraphNode implements ModelNode {
  x: number | null = null
  y: number | null = null
  fx: number | null = null
  fy: number | null = null
  forward: Record<string, GraphLink> = {}
  reverse: Record<string, GraphLink> = {}
  weight = 0
  color: { a: number; rgb: number } | null = null
  rendered = false
  fadeAlpha = 0
  moveText = 0
  fontDirty = false
  circle: TintedObject | null = null
  highlight: RingObject | null = null
  text: TextObject | null = null

  constructor(
    public renderer: GraphRenderer,
    public id: string,
    public type: string
  ) {}

  initGraphics(): boolean {
    if (this.rendered) return false
    const r = this.renderer
    const scene = r.scene!
    this.rendered = true
    this.circle = scene.createCircle(this, this.getFillColor())
    this.text = scene.createText(this.getDisplayText(), this.getTextStyle())
    this.fadeAlpha = 0
    return true
  }

  clearGraphics(): void {
    if (!this.rendered) return
    this.rendered = false
    detachObj(this.circle)
    this.circle = null
    detachObj(this.highlight)
    this.highlight = null
    detachObj(this.text)
    this.text = null
  }

  getTextStyle(): LabelStyle {
    return {
      fontSize: labelFontSize(this.getSize()),
      fill: this.renderer.colors.text.rgb,
      fontFamily: LABEL_FONT,
      wordWrap: true,
      wordWrapWidth: 300,
      align: 'center'
    }
  }

  render(): void {
    if (!this.rendered) return
    const r = this.renderer
    const x = this.x as number, y = this.y as number
    const circle = this.circle!, text = this.text!
    const size = this.getSize()
    const fill = this.getFillColor()
    const textColor = r.colors.text
    const hl = r.getHighlightNode()
    const isHl = hl === this
    const ns = r.nodeScale
    const wasVisible = text.visible
    let target = FADED_ALPHA
    if (!hl || isHl || Object.prototype.hasOwnProperty.call(this.forward, hl.id) || Object.prototype.hasOwnProperty.call(this.reverse, hl.id)) target = 1
    const fade = (this.fadeAlpha = ease(this.fadeAlpha, target))
    const circleAlpha = fade * fill.a
    let ta = r.textAlpha * fade
    if (isHl) ta = 1
    ta *= textColor.a
    const move = isHl ? 15 : 0
    const moveText = (this.moveText = wasVisible ? ease(this.moveText, move) : move)
    let showText = ta > 0.001
    const vp = r.viewport!
    const showCircle = isHl || !outside(vp, boxAround(x, y, size * ns + 1))
    if (showText) showText = isHl || !outside(vp, { left: x - 300, right: x + 300, top: y, bottom: y + 200 })
    circle.tint = easeTint(circle.tint, fill.rgb)
    circle.visible = showCircle
    if (showCircle) {
      circle.x = x
      circle.y = y
      circle.scale.x = circle.scale.y = (size / 100) * ns
      circle.alpha = circleAlpha
    }
    text.visible = showText
    if (showText) {
      text.x = x
      text.y = y + (size + 5) * ns + moveText / r.scale
      text.scale.x = text.scale.y = ns
      if (isHl && r.scale < 1) text.scale.x = text.scale.y = 1 / r.scale
      text.alpha = ta
    }
    if (isHl) {
      let ring = this.highlight
      if (!ring) ring = this.highlight = r.scene!.createRing()
      ring.x = x
      ring.y = y
      ring.scale.x = ring.scale.y = ns
      ring.clear()
      const w = Math.max(1, 1 / r.scale / ns)
      const c = r.colors.circle
      ring.alpha = c.a
      ring.lineStyle(w, c.rgb, 1)
      ring.drawCircle(0, 0, size + w / 2)
    } else if (this.highlight) {
      detachObj(this.highlight)
      this.highlight = null
    }
    if (this.fontDirty) {
      this.fontDirty = false
      r.scene!.setTextStyle(text, this.getTextStyle())
    }
  }

  getFillColor(): { a: number; rgb: number } {
    const r = this.renderer
    if (r.getHighlightNode() === this) return r.colors.fillHighlight
    if (this.type === 'focused') {
      const c = r.colors.fillFocused
      if (c.a > 0) return c
    } else {
      if (this.color) return this.color
      if (this.type === 'tag') return r.colors.fillTag
      if (this.type === 'unresolved') return r.colors.fillUnresolved
      if (this.type === 'attachment') return r.colors.fillAttachment
    }
    return r.colors.fill
  }

  getSize(): number {
    return nodeSize(this.weight, this.renderer.fNodeSizeMult)
  }

  getDisplayText(): string {
    return displayText(this.id)
  }

  getRelated(): string[] {
    return relatedIds(this)
  }
}

export class GraphLink {
  rendered = false
  px: ContainerObject | null = null
  line: LineObject | null = null
  arrow: ArrowObject | null = null

  constructor(
    public renderer: GraphRenderer,
    public source: GraphNode,
    public target: GraphNode
  ) {}

  initGraphics(): void {
    if (this.rendered || !this.source.rendered || !this.target.rendered) return
    this.rendered = true
    const r = this.renderer
    const scene = r.scene!
    this.px = scene.createLinkContainer()
    const line = (this.line = scene.createLine(r.colors.line))
    line.alpha = FADED_ALPHA * r.colors.line.a
    this.px.addChild(line)
    const arrow = (this.arrow = scene.createArrow(r.colors.text))
    arrow.alpha = FADED_ALPHA * r.colors.text.a
  }

  clearGraphics(): void {
    if (!this.rendered) return
    this.rendered = false
    if (this.px) {
      detachObj(this.px)
      this.px.visible = false
      this.px = null
    }
    if (this.line) {
      this.line.destroy()
      this.line.visible = false
      this.line = null
    }
    if (this.arrow) {
      detachObj(this.arrow)
      this.arrow.visible = false
      this.arrow = null
    }
  }

  render(): void {
    if (!this.rendered) return
    const r = this.renderer
    const px = this.px!, line = this.line!, arrow = this.arrow!
    const s = this.source, t = this.target
    const hl = r.getHighlightNode()
    const touches = s === hl || t === hl
    let alpha = FADED_ALPHA
    if (!hl || touches) alpha = 1
    let arrowAlpha = alpha * arrowRamp(r.scale)
    const lineColor = touches ? r.colors.lineHighlight : r.colors.line
    const arrowColor = r.colors.arrow
    let showLine = !(Object.prototype.hasOwnProperty.call(s.reverse, t.id) && s.id.localeCompare(t.id) < 0)
    let showArrow = r.fShowArrow
    const thickness = r.fLineSizeMult / r.scale
    const sx = s.x as number, sy = s.y as number, tx = t.x as number, ty = t.y as number
    const a = boxAround(sx, sy, thickness), b = boxAround(tx, ty, thickness)
    const inView = !outside(r.viewport!, {
      left: Math.min(a.left, b.left),
      right: Math.max(a.right, b.right),
      top: Math.min(a.top, b.top),
      bottom: Math.max(a.bottom, b.bottom)
    })
    alpha *= lineColor.a
    arrowAlpha *= arrowColor.a
    line.alpha = ease(line.alpha, alpha)
    arrow.alpha = ease(arrow.alpha, arrowAlpha)
    showLine = showLine && inView
    showArrow = showArrow && inView && arrow.alpha > 0.001
    line.visible = showLine
    arrow.visible = showArrow
    if (!showLine && !showArrow) return
    const dx = tx - sx, dy = ty - sy
    const dist = Math.sqrt(dx * dx + dy * dy)
    const sr = s.getSize() * r.nodeScale
    let tr = t.getSize() * r.nodeScale
    arrow.visible = showArrow = showArrow && dist > thickness
    if (showLine) {
      px.x = sx + (dx * sr) / dist
      px.y = sy + (dy * sr) / dist
      px.pivot.set(0, 0)
      px.rotation = Math.atan2(dy, dx)
      line.x = 0
      line.y = -thickness / 2
      line.width = Math.max(0, dist - sr - tr)
      line.height = thickness
      line.tint = easeTint(line.tint, lineColor.rgb)
    }
    arrow.visible = showArrow
    if (showArrow) {
      tr += 1
      arrow.x = tx - (dx * tr) / dist
      arrow.y = ty - (dy * tr) / dist
      arrow.pivot.set(0, 0)
      arrow.rotation = Math.atan2(dy, dx)
      arrow.scale.x = arrow.scale.y = (2 * Math.sqrt(r.fLineSizeMult)) / r.scale
      arrow.tint = arrowColor.rgb
    }
  }
}

export interface RenderOptions {
  nodeSizeMultiplier?: number
  lineSizeMultiplier?: number
  showArrow?: boolean
  textFadeMultiplier?: number
}

export type NodeEventHandler = (evt: any, id: string, type: string) => void

export function createGraphWorker(): WorkerLike {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'Graph Worker' }) as unknown as WorkerLike
}

export interface GraphRendererOptions {
  worker?: WorkerLike
  /** Create the scene backend once the canvas exists (PIXI in the app). Omit for headless use. */
  createScene?: (renderer: GraphRenderer, canvas: HTMLCanvasElement) => SceneBackend
  dpr?: () => number
}

export class GraphRenderer {
  containerEl: HTMLElement
  interactiveEl: HTMLCanvasElement
  canvasEl: HTMLCanvasElement
  worker: WorkerLike
  scene: SceneBackend | null = null
  onNodeClick: NodeEventHandler | null = null
  onNodeRightClick: NodeEventHandler | null = null
  onNodeHover: NodeEventHandler | null = null
  onNodeUnhover: (() => void) | null = null
  workerResults: any = null
  nodeLookup: Record<string, GraphNode> = {}
  nodes: GraphNode[] = []
  links: GraphLink[] = []
  dragNode: GraphNode | null = null
  highlightNode: GraphNode | null = null
  scale = 1
  nodeScale = 1
  textAlpha = 1
  targetScale = 1
  panX = 0
  panY = 0
  panvX = 0
  panvY = 0
  keyboardActions: Record<string, boolean> = {}
  panning = false
  width = 0
  height = 0
  viewport: Box | null = null
  zoomCenterX = 0
  zoomCenterY = 0
  fNodeSizeMult = 1
  fLineSizeMult = 1
  fTextShowMult = 0
  fShowArrow = false
  mouseX: number | null = null
  mouseY: number | null = null
  colors = {} as GraphColors
  idleFrames = 0
  renderTimer: number | null = null
  renderCallback: (() => void) | null = null
  private dprFn: () => number

  constructor(containerEl: HTMLElement, options: GraphRendererOptions = {}) {
    this.containerEl = containerEl
    this.dprFn = options.dpr || (() => window.devicePixelRatio || 1)
    this.testCSS()
    const interactive = (this.interactiveEl = containerEl.createEl('canvas'))
    containerEl.style.padding = '0'
    containerEl.style.overflow = 'hidden'
    containerEl.style.position = 'relative'
    interactive.style.position = 'absolute'
    interactive.style.left = '0'
    interactive.style.top = '0'
    fillParent(interactive)
    interactive.addEventListener('mousedown', e => e.preventDefault())
    interactive.addEventListener('wheel', this.onWheel.bind(this), { passive: false })
    interactive.addEventListener('mousemove', this.onMouseMove.bind(this), { passive: true })
    interactive.addEventListener('mouseout', this.onMouseMove.bind(this))
    const worker = (this.worker = options.worker || createGraphWorker())
    worker.onmessage = e => {
      if (!e.data.ignore) {
        this.workerResults = e.data
        this.changed()
      }
    }
    const canvas = (this.canvasEl = containerEl.createEl('canvas'))
    fillParent(canvas)
    if (options.createScene) {
      const create = options.createScene
      setTimeout(() => {
        try {
          this.initGraphics(create(this, canvas))
        } catch (e) {
          console.error(e)
          setTimeout(() => {
            try {
              this.initGraphics(create(this, canvas))
            } catch (err) {
              console.error('Graph renderer failed to initialise', err)
            }
          }, 300)
        }
      }, 50)
    }
  }

  get dpr(): number {
    return this.dprFn()
  }

  destroy(): void {
    this.worker.terminate()
    this.workerResults = null
    this.destroyGraphics()
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!this.scene) return
    let t = this.targetScale
    t *= wheelFactor(e.deltaY, e.deltaMode)
    this.targetScale = t
    if (t < this.scale) this.zoomCenterX = this.zoomCenterY = 0
    else {
      const dpr = this.dpr
      this.zoomCenterX = e.offsetX * dpr
      this.zoomCenterY = e.offsetY * dpr
    }
    this.changed()
  }

  onMouseMove(e: MouseEvent): void {
    if (e.type === 'mouseout') this.mouseX = this.mouseY = null
    else {
      this.mouseX = e.offsetX
      this.mouseY = e.offsetY
    }
  }

  /** Attach a scene backend and start the render loop. */
  initGraphics(scene: SceneBackend): void {
    this.scene = scene
    this.onResize()
    this.resetPan()
    this.updateZoom()
    this.renderCallback = () => this.frame()
    this.queueRender()
  }

  /** One animation frame (render callback). */
  frame(): void {
    this.renderTimer = null
    if (!this.scene || this.idleFrames > 60) return
    const scene = this.scene
    const nodes = this.nodes, links = this.links
    const res = this.workerResults
    if (res) {
      const ids: string[] = res.id
      const buffer: ArrayBufferLike = res.buffer
      let fresh = true
      if (typeof SharedArrayBuffer === 'undefined' || !(buffer instanceof SharedArrayBuffer)) this.workerResults = null
      else {
        const ver = new Uint32Array(buffer, buffer.byteLength - 4, 1)
        if (ver[0] === res.v) fresh = false
        else res.v = ver[0]
      }
      if (fresh) {
        const f = new Float32Array(buffer, 0, ids.length * 2)
        for (let i = 0; i < ids.length; i++) {
          const n = this.nodeLookup[ids[i]]
          if (!n) continue
          n.x = f[2 * i]
          n.y = f[2 * i + 1]
          if (n.fx) n.x = n.fx
          if (n.fy) n.y = n.fy
        }
      }
    }
    const ka = this.keyboardActions
    const shift = !!ka.shift
    if (!this.panning) {
      const gx = this.panvX, gy = this.panvY
      this.panX += (1000 * gx) / 60
      this.panY += (1000 * gy) / 60
      let kx = 0, ky = 0
      if (ka.up) ky += 1
      if (ka.down) ky -= 1
      if (ka.left) kx += 1
      if (ka.right) kx -= 1
      if (kx !== 0 || ky !== 0) this.idleFrames = 0
      const mult = shift ? 3 : 1
      this.panvX = ease(gx, kx * mult)
      this.panvY = ease(gy, ky * mult)
    }
    const step = 1 + (shift ? 0.1 : 0.03)
    let zoomed = false
    if (ka.zoomin) {
      this.targetScale *= step
      zoomed = true
    }
    if (ka.zoomout) {
      this.targetScale /= step
      zoomed = true
    }
    if (zoomed) {
      this.idleFrames = 0
      const dpr = this.dpr
      this.zoomCenterX = (this.width / 2) * dpr
      this.zoomCenterY = (this.height / 2) * dpr
    }
    this.updateZoom()
    const s = this.scale
    const left = -this.panX / s, top = -this.panY / s
    const right = left + (this.width / s) * this.dpr, bottom = top + (this.height / s) * this.dpr
    this.viewport = { left, right, top, bottom }
    const cx = (left + right) / 2, cy = (top + bottom) / 2
    const pending: { node: GraphNode; dist: number }[] = []
    for (const n of nodes) {
      if (n.rendered) continue
      const dx = (n.x as number) - cx, dy = (n.y as number) - cy
      const d = dx * dx + dy * dy
      if (pending.length < 50 || d < pending[pending.length - 1].dist) {
        pending.push({ node: n, dist: d })
        pending.sort((a, b) => a.dist - b.dist)
        if (pending.length > 50) pending.pop()
      }
    }
    if (pending.length > 0) {
      for (const p of pending) p.node.initGraphics()
      this.idleFrames = 0
    }
    for (const l of links) l.initGraphics()
    for (const n of nodes) n.render()
    for (const l of links) l.render()
    scene.present()
    this.idleFrames++
    this.queueRender()
    const hl = this.highlightNode
    if (this.mouseX !== null && this.mouseY !== null && hl) {
      const dpr = this.dpr
      const mx = (this.mouseX * dpr - this.panX) / s, my = (this.mouseY * dpr - this.panY) / s
      const dx = (hl.x as number) - mx, dy = (hl.y as number) - my
      const r = hl.getSize() * this.nodeScale + 2
      if (dx * dx + dy * dy > r * r) {
        this.highlightNode = null
        this.idleFrames = 0
        this.onNodeUnhover && this.onNodeUnhover()
      }
    }
  }

  destroyGraphics(): void {
    for (const l of this.links) l.clearGraphics()
    for (const n of this.nodes) n.clearGraphics()
    if (this.scene) {
      this.scene.destroy()
      this.scene = null
    }
    if (this.renderTimer !== null) (this.containerEl.win || window).cancelAnimationFrame(this.renderTimer)
    this.renderTimer = null
    this.renderCallback = null
    document.body.removeClass('is-grabbing')
  }

  zoomTo(scale: number, center?: { x: number; y: number }): void {
    this.targetScale = scale
    if (center) {
      this.zoomCenterX = center.x
      this.zoomCenterY = center.y
    } else this.zoomCenterX = this.zoomCenterY = 0
  }

  onResize(): void {
    const dpr = this.dpr
    const w = this.containerEl.clientWidth, h = this.containerEl.clientHeight
    const prevW = Math.round(this.width * dpr), prevH = Math.round(this.height * dpr)
    this.width = w
    this.height = h
    if (this.scene) {
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
      this.interactiveEl.width = w
      this.interactiveEl.height = h
      this.scene.resize(w, h, dpr)
      this.setPan(this.panX + (pw - prevW) / 2, this.panY + (ph - prevH) / 2)
    }
    this.changed()
  }

  resetPan(): void {
    const dpr = this.dpr
    this.setPan((this.width / 2) * dpr, (this.height / 2) * dpr)
  }

  setData(data: GraphData): void {
    setGraphData(this.nodes, this.nodeLookup, this.links, data, {
      createNode: (id, type) => new GraphNode(this, id, type),
      createLink: (s, t) => new GraphLink(this, s, t),
      destroyNode: n => n.clearGraphics(),
      destroyLink: l => l.clearGraphics(),
      post: (m: SimMessage) => this.worker.postMessage(m),
      changed: () => this.changed()
    })
  }

  setRenderOptions(o: RenderOptions): void {
    if (Number.isNumber(o.nodeSizeMultiplier)) this.fNodeSizeMult = o.nodeSizeMultiplier as number
    if (Number.isNumber(o.lineSizeMultiplier)) this.fLineSizeMult = o.lineSizeMultiplier as number
    if (Number.isNumber(o.textFadeMultiplier)) this.fTextShowMult = o.textFadeMultiplier as number
    if (isBoolean(o.showArrow)) this.fShowArrow = o.showArrow as boolean
    this.changed()
  }

  setForces(forces: Record<string, number>): void {
    this.worker.postMessage({ forces, alpha: 0.3, run: true })
  }

  getHighlightNode(): GraphNode | null {
    return this.dragNode || this.highlightNode
  }

  updateZoom(): void {
    let s = this.scale
    const t = (this.targetScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetScale)))
    let px = this.panX, py = this.panY
    if ((s > t ? s / t : t / s) - 1 >= 0.01) {
      let zx = this.zoomCenterX, zy = this.zoomCenterY
      if (zx === 0 && zy === 0) {
        const dpr = this.dpr
        zx = (this.width / 2) * dpr
        zy = (this.height / 2) * dpr
      }
      const wx = (zx - px) / s, wy = (zy - py) / s
      s = ease(s, t, 0.85)
      px -= wx * s + px - zx
      py -= wy * s + py - zy
      this.changed()
    }
    this.setPan(px, py)
    this.setScale(s)
  }

  setPan(x: number, y: number): void {
    this.panX = x
    this.panY = y
    if (this.scene) this.scene.setTransform(this.panX, this.panY, this.scale)
  }

  setScale(s: number): void {
    this.scale = s
    this.nodeScale = nodeScaleFor(s)
    this.textAlpha = textAlphaFor(s, this.fTextShowMult)
    if (this.scene) this.scene.setTransform(this.panX, this.panY, this.scale)
  }

  changed(): void {
    this.idleFrames = 0
    this.queueRender()
  }

  queueRender(): void {
    if (this.renderTimer === null && this.renderCallback) {
      const win = this.containerEl.win || window
      this.renderTimer = win.requestAnimationFrame(this.renderCallback)
    }
  }

  testCSS(): void {
    this.colors = readGraphColors(this.containerEl.doc || document)
    for (const n of this.nodes) n.fontDirty = true
    this.changed()
  }

  getTransparentScreenshot(): HTMLCanvasElement {
    return this.scene!.snapshot()
  }

  getBackgroundScreenshot(): HTMLCanvasElement {
    const src = this.getTransparentScreenshot()
    const c = document.createElement('canvas')
    c.width = src.width
    c.height = src.height
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, src.width, src.height)
    ctx.drawImage(src, 0, 0)
    return c
  }

  static async copyToClipboard(canvas: HTMLCanvasElement, type = 'image/png'): Promise<void> {
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Failed to create image'))), type))
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })])
  }
}

function fillParent(el: HTMLElement): void {
  el.style.margin = '0'
  el.style.padding = '0'
  el.style.border = '0'
  el.style.width = '100%'
  el.style.height = '100%'
  el.style.overflow = 'hidden'
}
