// Keeps Electron's window-drag regions in sync with the layout.
//
// Drag regions (`-webkit-app-region`) are recomputed when an element's app-region style changes, but a
// pure layout change (sidebar collapse/expand, tab strip growing) could leave the previous regions in
// place — a stale drag region then swallows clicks on whatever moved under it (e.g. the right sidebar
// toggle). Flipping the app-region of a hidden 0×0 probe forces a full recompute after layout changes.

export function installAppRegionRefresh(doc: Document = document): () => void {
  const win = doc.defaultView!
  const probe = doc.body.createDiv({ cls: 'qz-app-region-probe' })
  probe.setCssStyles({ position: 'fixed', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none' })
  let flip = false
  let queued = false
  const refresh = (): void => {
    if (queued) return
    queued = true
    win.requestAnimationFrame(() => {
      queued = false
      flip = !flip
      probe.style.setProperty('-webkit-app-region', flip ? 'drag' : 'no-drag')
    })
  }
  const ro = new (win as any).ResizeObserver(refresh) as ResizeObserver
  const observeStrips = (): void => {
    for (const el of Array.from(doc.querySelectorAll('.workspace-tab-header-container, .workspace-tab-header-spacer, .workspace-split'))) {
      ro.observe(el)
    }
  }
  observeStrips()
  // New tab groups / splits appear over time: re-scan when the DOM structure changes.
  const STRIP = '.workspace-tab-header-container, .workspace-split'
  const mo = new win.MutationObserver(records => {
    // Ignore editor/content churn: only react when a tab strip or split is added.
    const added = records.some(r => Array.from(r.addedNodes).some(n =>
      n.nodeType === 1 && ((n as Element).matches(STRIP) || (n as Element).querySelector(STRIP))))
    if (!added) return
    observeStrips()
    refresh()
  })
  mo.observe(doc.body, { childList: true, subtree: true })
  win.addEventListener('resize', refresh)
  return () => {
    ro.disconnect()
    mo.disconnect()
    win.removeEventListener('resize', refresh)
    probe.detach()
  }
}
