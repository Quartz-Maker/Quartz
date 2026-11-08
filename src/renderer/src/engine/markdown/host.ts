// The services the reading renderer needs from the rest of the app. Injected so that the
// renderer works before the full `App` (metadata cache, workspace) exists.
// Integration wires this to Quartz's stores; tests use the defaults.
export interface MarkdownHost {
  /** Resolve a link path (no subpath) from `sourcePath` to a vault path, or null. */
  resolveLink(linkpath: string, sourcePath: string): string | null
  /** URL usable in <img>/<video>/<audio> src for a vault path. */
  getResourcePath(path: string): string
  /** Read a vault file's text. */
  readFile(path: string): Promise<string>
  /** Whether a markdown note could be created at `linkpath` (unresolved embed message). */
  canCreate(linkpath: string): boolean
  openLinkText(linktext: string, sourcePath: string, newLeaf: boolean | string): void
  openExternal(href: string, newWindow: boolean | string): void
  onTagClick(tag: string): void
  /** Called on hover over an internal link / footnote ref (`hover-link`). */
  onHoverLink(info: { event: MouseEvent; targetEl: HTMLElement; linktext: string; sourcePath: string }): void
  /** Local storage helper (mermaid trust gate). */
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
  /** Vault config lookup (strictLineBreaks, rightToLeft, showIndentGuide, ...). */
  getConfig(key: string): unknown
  /** Called when post-processors change (every reading view re-renders). */
  onPostProcessorChange?(): void
}

const listeners = new Set<() => void>()

export const defaultHost: MarkdownHost = {
  resolveLink: () => null,
  getResourcePath: (p) => p,
  readFile: async () => '',
  canCreate: (p) => !/\.[a-z0-9]+$/i.test(p) || /\.md$/i.test(p),
  openLinkText: () => {},
  openExternal: (href, newWindow) => {
    window.open(href, typeof newWindow === 'string' ? newWindow : '')
  },
  onTagClick: () => {},
  onHoverLink: () => {},
  loadLocalStorage: (key) => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? null : JSON.parse(v)
    } catch {
      return null
    }
  },
  saveLocalStorage: (key, value) => {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  },
  getConfig: () => undefined
}

let host: MarkdownHost = defaultHost

export function getMarkdownHost(): MarkdownHost {
  return host
}
export function setMarkdownHost(h: Partial<MarkdownHost>): void {
  // Merge: several areas install their own hooks (links, query blocks, hover...).
  host = { ...host, ...h }
}

/** `post-processor-change`: every live preview re-renders fully. */
export function onPostProcessorChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
/** Announce a post-processor change. In the app this goes through the workspace `post-processor-change` event
 *  (which Live Preview widgets and plugins listen to, and which calls notifyPostProcessorChange back). */
export function triggerPostProcessorChange(): void {
  if (host.onPostProcessorChange) host.onPostProcessorChange()
  else notifyPostProcessorChange()
}
/** Re-render every registered reading view. */
export function notifyPostProcessorChange(): void {
  for (const cb of Array.from(listeners)) cb()
}
