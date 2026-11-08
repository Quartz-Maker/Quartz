// Math rendering (`renderMath` / `finishRenderMath` / `loadMathJax`).
// Runs MathJax 4 (CHTML output, `mathjax-tex` font) with `MathJax.tex2chtml(src,{display})`
// and refreshes the CHTML stylesheet 100 ms after the last render.
// The MathJax engine is installed by `setMathEngine` (see mathjaxEngine.ts) — until it is ready the
// source text is shown.

export interface MathEngine {
  tex2chtml(source: string, options: { display: boolean }): HTMLElement
  chtmlStylesheet?(): HTMLStyleElement
}

let engine: MathEngine | null = null
let enginePromise: Promise<MathEngine | null> | null = null
let loader: (() => Promise<MathEngine | null>) | null = null

export function setMathEngine(e: MathEngine | null) { engine = e }
export function setMathEngineLoader(fn: () => Promise<MathEngine | null>) { loader = fn }

export async function loadMathJax(): Promise<void> {
  if (engine || !loader) return
  if (!enginePromise) enginePromise = loader().then(e => (engine = e))
  await enginePromise
}

export function renderMath(source: string, display: boolean): HTMLElement {
  if (!engine) {
    void loadMathJax()
    throw new Error('MathJax not loaded')
  }
  return engine.tex2chtml(source, { display })
}

let sheet: HTMLStyleElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let pending: Promise<void> | null = null
let resolvePending: (() => void) | null = null

/** Flush the CHTML stylesheet into the document (debounced 100 ms). */
export function finishRenderMath(): Promise<void> {
  if (!pending) pending = new Promise(r => (resolvePending = r))
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    const css = engine?.chtmlStylesheet?.()
    if (css && css !== sheet) {
      sheet?.remove()
      sheet = css
      document.head.appendChild(css)
    }
    if (sheet) sheet.dataset.change = sheet.dataset.change === '1' ? '2' : '1'
    resolvePending?.()
    pending = null
    resolvePending = null
  }, 100)
  return pending
}

export function isMathLoaded(): boolean { return !!engine }
