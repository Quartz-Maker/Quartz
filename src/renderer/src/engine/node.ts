// Node/Electron access from the renderer. Vault windows run with nodeIntegration,
// so Node modules come from the runtime `require`, never from
// the bundler. Use these instead of `import fs from 'fs'` in renderer code.
/* eslint-disable @typescript-eslint/no-explicit-any */

export function nodeRequire<T = any>(id: string): T {
  const req = typeof window !== 'undefined' ? (window as any).require : undefined
  if (typeof req !== 'function') throw new Error(`Node module "${id}" unavailable (no nodeIntegration)`)
  return req(id) as T
}

let _fs: typeof import('fs') | null = null
/** Electron's asar-unaware fs when available ("original-fs"), else fs. */
export function fs(): typeof import('fs') {
  if (!_fs) {
    try {
      _fs = nodeRequire('original-fs')
    } catch {
      _fs = nodeRequire('fs')
    }
  }
  return _fs!
}
export const path = (): typeof import('path') => nodeRequire('path')
export const electron = (): typeof import('electron') => nodeRequire('electron')
