// PIXI 7.2.4 scene backend for the graph renderer.
//   - nodes: white circle Graphics r=100 (pivot 100) tinted per node, zIndex 1; labels: PIXI.Text, resolution 2,
//     anchor (0.5, 0), zIndex 2; links: 1-px white Sprite inside a rotated container; arrows: 4×4 triangle, zIndex 1
//   - pointer events go through an overlay canvas (renderer.events target) in device-pixel stage coordinates
//   - node drag pins (fx/fy) and reheats {alpha .3, alphaTarget .3}; release unpins {alphaTarget 0}; a press that
//     moved < 5 px is a click; background drag pans with inertia.
import * as PIXI from 'pixi.js'
import { Platform } from '../../keymap/Platform'
import type { GraphRenderer, GraphNode, SceneBackend, LabelStyle } from './renderer'
import { ease } from './formulas'

const R = 100

function isMacCtrlClick(e: any): boolean {
  return Platform.isMacOS && e.button === 0 && e.ctrlKey
}

function isMouse(e: any): boolean {
  return typeof MouseEvent !== 'undefined' && (e instanceof MouseEvent || (e && e.instanceOf && e.instanceOf(MouseEvent)))
}

export function createPixiScene(renderer: GraphRenderer, canvas: HTMLCanvasElement): SceneBackend {
  const settings: any = (PIXI as any).settings
  if (settings && settings.RENDER_OPTIONS) settings.RENDER_OPTIONS.hello = false
  const app = new PIXI.Application({ view: canvas, antialias: true, backgroundAlpha: 0, autoStart: false })
  const interactive = renderer.interactiveEl
  ;(app.renderer as any).events.setTargetElement(interactive)
  const stage = app.stage
  const hanger = new PIXI.Container()
  hanger.eventMode = 'static'
  let downPos: PIXI.Point | null = null
  let lastTime = performance.now()
  let dt = 0

  const onPointerDown = (node: GraphNode, e: PIXI.FederatedPointerEvent) => {
    if (e.nativeEvent.target !== interactive) return
    renderer.dragNode = node
    downPos = e.getLocalPosition(stage)
  }
  const release = (e: PIXI.FederatedPointerEvent) => {
    const node = renderer.dragNode
    if (!node) return
    const ne: any = e.nativeEvent
    if (downPos && renderer.onNodeClick && ((isMouse(ne) && (ne.button === 0 || ne.button === 1) && !isMacCtrlClick(ne)) || ne.type?.startsWith('touch')))
      renderer.onNodeClick(ne, node.id, node.type)
    node.fx = null
    node.fy = null
    renderer.worker.postMessage({ alphaTarget: 0, forceNode: { id: node.id, x: null, y: null } })
    downPos = null
    renderer.dragNode = null
    renderer.changed()
  }
  stage
    .on('pointermove', (e: PIXI.FederatedPointerEvent) => {
      const node = renderer.dragNode
      if (!node) return
      if (downPos) {
        const p = e.getLocalPosition(stage)
        const dx = p.x - downPos.x, dy = p.y - downPos.y
        if (dx * dx + dy * dy > 25) downPos = null
      }
      const w = e.getLocalPosition(hanger)
      node.fx = w.x
      node.fy = w.y
      renderer.worker.postMessage({ alpha: 0.3, alphaTarget: 0.3, run: true, forceNode: { id: node.id, x: w.x, y: w.y } })
      renderer.changed()
    })
    .on('pointerup', release)
    .on('pointerupoutside', release)
  stage.eventMode = 'static'

  // Background: pan with inertia.
  const bg = new PIXI.Graphics()
  bg.eventMode = 'static'
  bg.beginFill(0)
  bg.drawRect(0, 0, 10000, 10000)
  bg.endFill()
  bg.alpha = 0
  let panStart: PIXI.Point | null = null
  let panOrigin: { x: number; y: number } | null = null
  const endPan = () => {
    panStart = null
    document.body.removeClass('is-grabbing')
    renderer.panning = false
    const t = performance.now() - lastTime
    dt = ease(dt, t, 0.8)
    if (t > 100) renderer.panvX = renderer.panvY = 0
    else {
      renderer.panvX /= dt
      renderer.panvY /= dt
    }
  }
  bg.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
    panStart = e.getLocalPosition(stage)
    panOrigin = { x: hanger.x, y: hanger.y }
    document.body.addClass('is-grabbing')
    renderer.panning = true
  })
  stage
    .on('pointermove', (e: PIXI.FederatedPointerEvent) => {
      if (!panStart || !panOrigin) return
      const p = e.getLocalPosition(stage)
      const x = panOrigin.x + p.x - panStart.x, y = panOrigin.y + p.y - panStart.y
      const now = performance.now()
      dt = ease(dt, now - lastTime, 0.8)
      lastTime = now
      renderer.panvX = ease(renderer.panvX, x - renderer.panX, 0.8)
      renderer.panvY = ease(renderer.panvY, y - renderer.panY, 0.8)
      renderer.setPan(x, y)
      renderer.changed()
    })
    .on('pointerup', () => panStart && endPan())
    .on('pointerupoutside', () => panStart && endPan())
  stage.addChild(bg)
  stage.addChild(hanger)

  const toStyle = (s: LabelStyle) => new PIXI.TextStyle(s as any)

  return {
    createCircle(node, color) {
      const g = new PIXI.Graphics()
      g.eventMode = 'static'
      g.beginFill(0xffffff)
      g.drawCircle(R, R, R)
      g.endFill()
      g.pivot.x = R
      g.pivot.y = R
      g.cursor = 'pointer'
      g.zIndex = 1
      const onClick = (e: PIXI.FederatedPointerEvent) => {
        const ne: any = e.nativeEvent
        if (e.button === 2 || (isMouse(ne) && isMacCtrlClick(ne))) renderer.onNodeRightClick && renderer.onNodeRightClick(ne, node.id, node.type)
      }
      g.on('pointerdown', e => onPointerDown(node, e))
        .on('pointerover', (e: PIXI.FederatedPointerEvent) => {
          if (e.pointerType === 'touch') return
          renderer.highlightNode = node
          renderer.changed()
          const ne: any = e.nativeEvent
          if (isMouse(ne)) {
            renderer.mouseX = ne.offsetX
            renderer.mouseY = ne.offsetY
          }
          renderer.onNodeHover && renderer.onNodeHover(ne, node.id, node.type)
        })
        .on('pointerout', () => {
          renderer.highlightNode = null
          renderer.changed()
          renderer.onNodeUnhover && renderer.onNodeUnhover()
        })
        .on('click', onClick)
        .on('rightclick', onClick)
      g.alpha = color.a
      g.tint = color.rgb
      hanger.addChild(g)
      return g as any
    },
    createText(text, style) {
      const t = new PIXI.Text(text, toStyle(style))
      t.eventMode = 'none'
      t.resolution = 2
      t.anchor.set(0.5, 0)
      t.zIndex = 2
      hanger.addChild(t)
      return t as any
    },
    setTextStyle(text, style) {
      ;(text as any).style = toStyle(style)
    },
    createRing() {
      const g = new PIXI.Graphics()
      g.eventMode = 'none'
      g.zIndex = 1
      hanger.addChild(g)
      return g as any
    },
    createLinkContainer() {
      const c = new PIXI.Container()
      hanger.addChild(c)
      return c as any
    },
    createLine(color) {
      const s = new PIXI.Sprite(PIXI.Texture.WHITE)
      s.eventMode = 'none'
      s.tint = color.rgb
      return s as any
    },
    createArrow(color) {
      const g = new PIXI.Graphics()
      g.eventMode = 'none'
      g.tint = color.rgb
      g.beginFill(0xffffff)
      g.moveTo(0, 0)
      g.lineTo(-4, -2)
      g.lineTo(-3, 0)
      g.lineTo(-4, 2)
      g.lineTo(0, 0)
      g.endFill()
      g.zIndex = 1
      hanger.addChild(g)
      return g as any
    },
    present() {
      hanger.sortChildren()
      app.render()
    },
    snapshot() {
      app.render()
      return app.view as HTMLCanvasElement
    },
    resize(w, h, dpr) {
      const r: any = app.renderer
      r.view.style.width = w + 'px'
      r.view.style.height = h + 'px'
      r.resize(Math.round(w * dpr), Math.round(h * dpr))
      r.events.resolutionChange(1 / dpr)
    },
    setTransform(x, y, s) {
      hanger.x = x
      hanger.y = y
      hanger.scale.x = hanger.scale.y = s
    },
    destroy() {
      ;(app.renderer as any).events.setTargetElement(null)
      app.destroy(false, { children: true, texture: true, baseTexture: true })
    }
  }
}
