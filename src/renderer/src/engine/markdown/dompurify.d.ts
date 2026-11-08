// DOMPurify 3.0.1 (pinned version) ships no type declarations.
declare module 'dompurify' {
  interface DOMPurifyI {
    sanitize(source: string | Node, config?: Record<string, unknown>): any
    addHook(entryPoint: string, hookFunction: (...args: any[]) => void): void
    removeHook(entryPoint: string): void
    removeAllHooks(): void
    setConfig(config: Record<string, unknown>): void
    clearConfig(): void
    isSupported: boolean
    version: string
    removed: unknown[]
  }
  function createDOMPurify(window?: Window): DOMPurifyI
  export default createDOMPurify
}
