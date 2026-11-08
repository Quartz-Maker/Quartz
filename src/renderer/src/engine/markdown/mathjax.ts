// MathJax hook for the math post-processor. Lazy-loads a static MathJax 4 bundle
// (mathjax-bundle.ts) with the TeX package list below. `setMathJaxLoader` can override it.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const MATHJAX_TEX_PACKAGES = [
  'action', 'amscd', 'bbox', 'boldsymbol', 'braket', 'bussproofs', 'cancel', 'cases', 'centernot', 'color',
  'colortbl', 'empheq', 'enclose', 'extpfeil', 'gensymb', 'html', 'mathtools', 'mhchem', 'noerrors',
  'tagformat', 'textcomp', 'unicode', 'upgreek', 'verb'
]

export interface MathJaxLike {
  tex2chtml(src: string, opts: { display: boolean }): Element
  chtmlStylesheet(): HTMLStyleElement
}

import { lazyLib, type LazyLib } from './lazy'

let loader: (() => Promise<MathJaxLike | null>) | null = null
const makeLib = (): LazyLib<MathJaxLike | null> =>
  lazyLib(() => {
    const load = loader ?? (() => import('./mathjax-bundle').then((m) => m.createMathJax()))
    return load().catch((e) => {
      console.error(e)
      return null
    })
  })
/** Lazy MathJax handle (`then` is synchronous once loaded). */
export let mathjaxLib = makeLib()

/** Install a loader returning a configured MathJax (e.g. window.MathJax after script load). */
export function setMathJaxLoader(fn: () => Promise<MathJaxLike | null>): void {
  loader = fn
  mathjaxLib = makeLib()
}

export function loadMathJax(): Promise<MathJaxLike | null> {
  return mathjaxLib.promise
}

let sheet: HTMLStyleElement | null = null
let timer = 0
let pending: { promise: Promise<void>; resolve: () => void } | null = null

/** Debounced (100 ms) CHTML stylesheet refresh. */
export function refreshMathJaxStylesheet(): Promise<void> {
  if (!pending) {
    let resolve!: () => void
    const p = new Promise<void>((r) => (resolve = r))
    pending = { promise: p, resolve }
  }
  clearTimeout(timer)
  timer = window.setTimeout(async () => {
    const mj = await loadMathJax()
    if (mj) {
      const s = mj.chtmlStylesheet()
      if (!sheet || s !== sheet) {
        sheet?.remove()
        sheet = s
        document.head.appendChild(s)
      }
      sheet.dataset.change = sheet.dataset.change === '1' ? '2' : '1'
    }
    const p = pending!
    pending = null
    p.resolve()
  }, 100)
  return pending.promise
}
