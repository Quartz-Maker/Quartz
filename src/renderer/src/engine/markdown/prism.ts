// Lazy Prism loader (`Prism.manual = true`).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazyLib } from './lazy'

export const prismLib = lazyLib<any>(async () => {
    const w = window as any
    w.Prism = w.Prism || {}
    w.Prism.manual = true
    const mod: any = await import('prismjs')
    const Prism = mod.default || mod
    w.Prism = Prism
    await import('./prism-languages')
    return Prism
})

export function loadPrism(): Promise<any> {
  return prismLib.promise
}
