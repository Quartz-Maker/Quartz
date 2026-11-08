/* eslint-disable @typescript-eslint/no-explicit-any */
// "Export as image" (desktop): options dialog (viewport, zoom, logo, privacy mode), save dialog, then the
// canvas is captured with `webContents.capturePage` — the viewport directly, or the full canvas tile by tile
// stitched into one PNG (`generateHDImage`).
import { Modal } from '../../ui/Modal'
import { Setting } from '../../ui/setting'
import { Notice } from '../../ui/Notice'
import { expandBBox, rectToBBox, unionBBox } from './geometry'
import { withKeymap } from './modals'
import { S } from './strings'
import { loadQuartzLogo } from '../../app/quartzLogo'
import type { Canvas } from './Canvas'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r(null)))

function remote(): any {
  try {
    return (window as any).require?.('@electron/remote') ?? null
  } catch {
    return null
  }
}

interface ExportOptions {
  frame: 'full' | 'viewport'
  zoom: number
  logo: boolean
  privacy: boolean
}

function askOptions(canvas: Canvas, width: number, height: number, pixelRatio: number, maxZoom: number): Promise<ExportOptions | null> {
  return new Promise(resolve => {
    const o: ExportOptions = { frame: 'full', zoom: Math.min(1, maxZoom), logo: true, privacy: false }
    let zoomLog = Math.log2(o.zoom)
    let done = false
    const m = new Modal(withKeymap(canvas.app))
    m.setTitle(S.actionExportPng)
    m.modalEl.addClass('mod-narrow')
    const c = m.contentEl
    c.createEl('p', { cls: 'u-muted', text: S.labelExportPngDesc(canvas.view.file?.basename ?? '') })
    let zoomSetting: Setting
    let logoSetting: Setting
    new Setting(c)
      .setName(S.optionExportPngFrame)
      .setDesc(S.optionExportPngFrameDesc)
      .addDropdown(d =>
        d
          .addOption('full', S.optionExportPngFrameFull)
          .addOption('viewport', S.optionExportPngFrameViewport)
          .setValue(o.frame)
          .onChange(v => {
            o.frame = v as any
            const full = v === 'full'
            ;(zoomSetting as any).setVisibility?.(full) ?? zoomSetting.settingEl.toggle(full)
            ;(logoSetting as any).setVisibility?.(full) ?? logoSetting.settingEl.toggle(full)
          })
      )
    const dims = () => zoomSetting.setDesc(S.labelExportPngDimensions(`${Math.ceil(width * o.zoom * pixelRatio).toLocaleString()}px x ${Math.ceil(height * o.zoom * pixelRatio).toLocaleString()}px`))
    zoomSetting = new Setting(c)
      .setName(S.optionExportPngZoom)
      .setDesc(S.optionExportPngZoomDesc)
      .addSlider(s =>
        (s as any)
          .setDisplayFormat?.((v: number) => Math.pow(2, v).toFixed(2))
          ?.setLimits(Math.min(-1, Math.log2(maxZoom)), Math.log2(maxZoom), 'any')
          .setValue(zoomLog)
          .onChange((v: number) => {
            zoomLog = v
            o.zoom = Math.pow(2, v)
            dims()
          }) ??
        s
          .setLimits(Math.min(-1, Math.log2(maxZoom)), Math.log2(maxZoom), 0.01)
          .setValue(zoomLog)
          .onChange(v => {
            o.zoom = Math.pow(2, v)
            dims()
          })
      )
    dims()
    logoSetting = new Setting(c)
      .setName(S.optionExportPngShowLogo)
      .setDesc(S.optionExportPngShowLogoDesc)
      .addToggle(t => t.setValue(o.logo).onChange(v => (o.logo = v)))
    new Setting(c)
      .setName(S.optionExportPngPrivacyMode)
      .setDesc(S.optionExportPngPrivacyModeDesc)
      .addToggle(t => t.setValue(o.privacy).onChange(v => (o.privacy = v)))
    c.createDiv('modal-button-container', b => {
      b.createEl('button', { cls: 'mod-cta', text: S.save }).addEventListener('click', () => {
        done = true
        m.close()
        resolve(o)
      })
    })
    ;(m as any).onClose = () => {
      if (!done) resolve(null)
    }
    m.open()
  })
}

export async function exportCanvasImage(canvas: Canvas): Promise<void> {
  const r = remote()
  const wc = r?.getCurrentWebContents?.()
  if (!wc) {
    new Notice('Export as image requires the desktop app.')
    return
  }
  const zoomFactor = Math.pow(1.2, wc.getZoomLevel?.() ?? 0)
  const ratio = Math.round((window.devicePixelRatio / zoomFactor) * 1e5) / 1e5
  const bounds = expandBBox(unionBBox(Array.from(canvas.nodes.values()).map(n => rectToBBox(n))), 100)
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  const maxZoom = Math.min(2, 16284 / ratio / w, 16284 / ratio / h)
  const o = await askOptions(canvas, w, h, ratio, maxZoom)
  if (!o) return
  const res = await r.dialog.showSaveDialog({
    defaultPath: (canvas.view.file?.basename ?? 'Canvas') + '.png',
    filters: [
      { name: 'PNG Files', extensions: ['png'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['showOverwriteConfirmation']
  })
  if (res.canceled || !res.filePath) return
  const fs = (window as any).require('fs')
  const wrap = canvas.wrapperEl
  const state = canvas.getState()
  canvas.deselectAll()
  wrap.addClass('is-screenshotting')
  if (o.privacy) wrap.addClass('is-text-garbled')
  try {
    await sleep(10)
    await nextFrame()
    if (o.frame === 'viewport') {
      const nb = unionBBox(Array.from(canvas.nodes.values()).map(n => rectToBBox(n)))
      const a = canvas.domFromPos({ x: nb.minX, y: nb.minY })
      const b = canvas.domFromPos({ x: nb.maxX, y: nb.maxY })
      const cr = canvas.canvasRect
      const wr = wrap.getBoundingClientRect()
      const x1 = Math.max(wr.x, a.x + cr.cx - 10)
      const y1 = Math.max(wr.y, a.y + cr.cy - 10)
      const x2 = Math.min(wr.right, b.x + cr.cx + 10)
      const y2 = Math.min(wr.bottom, b.y + cr.cy + 10)
      const img = await wc.capturePage({ x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) })
      await fs.promises.writeFile(res.filePath, img.toPNG())
    } else {
      canvas.screenshotting = true
      const wr = wrap.getBoundingClientRect()
      const px = Math.ceil(wr.x * zoomFactor + 1)
      const py = Math.ceil(wr.y * zoomFactor + 1)
      const tw = Math.floor(wr.width * zoomFactor) - 2
      const th = Math.floor(wr.height * zoomFactor) - 2
      const z = o.zoom
      canvas.zoom = canvas.tZoom = Math.log2(z / zoomFactor)
      const stepX = tw / z
      const stepY = th / z
      const cols = Math.ceil(w / stepX)
      const rows = Math.ceil(h / stepY)
      const out = document.createElement('canvas')
      out.width = Math.ceil(w * z * ratio)
      out.height = Math.ceil(h * z * ratio)
      const ctx = out.getContext('2d')!
      canvas.viewportChanged = true
      canvas.requestFrame()
      await sleep(500)
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          canvas.x = canvas.tx = bounds.minX + stepX / 2 + col * stepX
          canvas.y = canvas.ty = bounds.minY + stepY / 2 + row * stepY
          canvas.viewportChanged = true
          canvas.finishViewportAnimation = true
          canvas.requestFrame()
          await sleep(100)
          await nextFrame()
          const img = await wc.capturePage({ x: px, y: py, width: tw, height: th })
          const blob = new Blob([img.toPNG()], { type: 'image/png' })
          const url = URL.createObjectURL(blob)
          const el = new Image()
          el.src = url
          await new Promise((ok, fail) => {
            el.onload = ok
            el.onerror = fail
          })
          ctx.drawImage(el, col * tw * ratio, row * th * ratio)
          URL.revokeObjectURL(url)
        }
      }
      if (o.logo) {
        // Quartz watermark, bottom left (pixel art: no smoothing).
        const logo = await loadQuartzLogo()
        const size = Math.max(32, Math.round(32 * ratio * z))
        const margin = Math.round(size / 2.5)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(logo, margin, out.height - margin - size, size, size)
      }
      const blob: Blob = await new Promise(ok => out.toBlob(b => ok(b!), 'image/png'))
      await fs.promises.writeFile(res.filePath, new Uint8Array(await blob.arrayBuffer()))
    }
    new Notice(res.filePath, 10000)
  } finally {
    wrap.removeClass('is-screenshotting')
    wrap.removeClass('is-text-garbled')
    canvas.screenshotting = false
    canvas.setViewport(state.x, state.y, state.zoom)
    canvas.onResize()
  }
}
