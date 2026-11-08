// Window geometry helpers.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Does the rect overlap some display's work area by more than 2px. */
export function isOnSomeDisplay(b: Rect, workAreas: Rect[]): boolean {
  for (const u of workAreas) {
    if (b.x < u.x + u.width - 2 && b.x + b.width > u.x + 2 && b.y < u.y + u.height - 2 && b.y + b.height > u.y + 2) return true
  }
  return false
}

/**
 * Default size = primary work area capped at 1024×(800, workHeight-1)
 * (fallback 800×600). Saved bounds are used when fully specified and visible on a display,
 * or when only width/height are given. Result is clamped to at least 300×200.
 */
export function computeWindowBounds(
  saved: { x?: number; y?: number; width?: number; height?: number },
  primaryWorkArea: Rect | null,
  workAreas: Rect[]
): { width: number; height: number; x?: number; y?: number } {
  const r: { width: number; height: number; x?: number; y?: number } = { width: 800, height: 600 }
  if (primaryWorkArea) {
    r.width = Math.min(1024, primaryWorkArea.width)
    r.height = Math.min(800, primaryWorkArea.height - 1)
  }
  let use = false
  if (saved.x !== undefined && saved.y !== undefined && saved.width !== undefined && saved.height !== undefined) {
    use = isOnSomeDisplay(saved as Rect, workAreas)
  } else if (saved.x === undefined && saved.y === undefined && saved.width !== undefined && saved.height !== undefined) {
    use = true
  }
  if (use) {
    r.x = saved.x
    r.y = saved.y
    r.width = saved.width!
    r.height = saved.height!
  }
  if (r.width < 300) r.width = 300
  if (r.height < 200) r.height = 200
  return r
}

/** Parse a popout `window.open` feature string. */
export function parsePopupFeatures(features: string): {
  rect: { x?: number; y?: number; width?: number; height?: number }
  background: string
  parented: boolean
} {
  const rect: { x?: number; y?: number; width?: number; height?: number } = {}
  let background = ''
  let parented = false
  for (const part of features.split(',')) {
    const [k, v] = part.split('=')
    if (k === 'x' || k === 'y' || k === 'width' || k === 'height') rect[k] = parseInt(v)
    if (k === 'background') background = v
    if (k === 'parented') parented = v === '1'
  }
  return { rect, background, parented }
}
