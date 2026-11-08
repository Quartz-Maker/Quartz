// How a global search runs: no index, no worker. A cancellable work queue of files (pre-sorted
// by the current sort order) is matched on the main thread in a cooperative loop that yields
// every 10 files once 5 ms have passed (pauses up to 100 ms). The queue stays subscribed to
// vault create/modify/rename/delete + metadataCache `changed`, re-matching single files, so the
// result list is live.
import type { CachedMetadata, TFile } from 'obsidian'
import { Component } from '../core/Component'
import { computeMetadata } from '../metadata/parser/computeMetadata'
import { SearchEnvironment, SearchQuery, SearchResult } from './query'
import { getSortComparator } from './sort'

/** Cooperative time slicer (batch 10, 5 ms budget, configurable max pause). */
export class TimeSlicer {
  processed = 0
  start = performance.now()
  batchSize: number
  duration: number
  maxDelay: number
  constructor(opts: { batchSize?: number; duration?: number; maxDelay?: number } = {}) {
    this.batchSize = opts.batchSize ?? 10
    this.duration = opts.duration ?? 5
    this.maxDelay = opts.maxDelay ?? 0
  }
  shouldPause(): boolean {
    this.processed++
    return this.processed % this.batchSize === 0 && performance.now() - this.start > this.duration
  }
  async pause(): Promise<void> {
    await new Promise<void>((resolve) => {
      const ric = (globalThis as any).requestIdleCallback as ((cb: () => void, o: { timeout: number }) => number) | undefined
      if (ric && this.maxDelay > 0) ric(() => resolve(), { timeout: this.maxDelay })
      else setTimeout(resolve, 0)
    })
    this.start = performance.now()
  }
}

export interface QueueCallbacks {
  onStart?: () => void
  onStop?: () => void
  onCancel?: () => void
}

/** Runnable state of a work queue: running ↔ idle, cancellable once. */
export class Runnable {
  running = false
  cancelled = false
  constructor(private cb: QueueCallbacks = {}) {}
  start(): void {
    if (this.cancelled || this.running) return
    this.running = true
    this.cb.onStart?.()
  }
  stop(): void {
    if (!this.running) return
    this.running = false
    this.cb.onStop?.()
  }
  cancel(): void {
    if (this.cancelled) return
    this.stop()
    this.cancelled = true
    this.cb.onCancel?.()
  }
  isCancelled(): boolean {
    return this.cancelled
  }
}

/** Unique FIFO of files; the generator idles (stop) when empty and resumes on `add`. */
export class WorkQueue<T> {
  items: T[] = []
  private wake: (() => void) | null = null
  runnable: Runnable
  /** `persistent: false` → the generator ends when the queue is empty instead of idling. */
  constructor(cb?: QueueCallbacks, public persistent = true) {
    this.runnable = new Runnable(cb)
  }
  addList(items: T[]): void {
    for (const i of items) if (!this.items.includes(i)) this.items.push(i)
    this.notify()
  }
  add(item: T): void {
    if (!this.items.includes(item)) this.items.push(item)
    this.notify()
  }
  remove(item: T): void {
    const i = this.items.indexOf(item)
    if (i !== -1) this.items.splice(i, 1)
  }
  clear(): void {
    this.items = []
  }
  private notify(): void {
    const w = this.wake
    if (w) {
      this.wake = null
      setTimeout(w, 0)
    }
  }
  cancel(): void {
    this.runnable.cancel()
    this.notify()
  }
  async *generator(): AsyncGenerator<T> {
    const r = this.runnable
    for (;;) {
      if (r.isCancelled()) return
      if (this.items.length === 0) {
        r.stop()
        if (!this.persistent) return
        await new Promise<void>((resolve) => (this.wake = resolve))
      } else {
        r.start()
        yield this.items.shift()!
      }
    }
  }
}

/** What the runner needs from the app. */
export interface SearchAppLike {
  vault: {
    getFiles(): TFile[]
    cachedRead(file: TFile): Promise<string>
    on(name: string, cb: (...args: any[]) => any, ctx?: any): any
    offref?(ref: any): void
  }
  metadataCache: {
    getFileCache(file: TFile): CachedMetadata | null
    isUserIgnored?(path: string): boolean
    isSupportedFile?(file: TFile): boolean
    on(name: string, cb: (...args: any[]) => any, ctx?: any): any
  }
  [k: string]: any
}

const canvasCacheStore = new WeakMap<TFile, { mtime: number; size: number; caches: Record<string, CachedMetadata> }>()

/** Per-text-node metadata for a canvas file (what the canvas index provides to search). */
export function canvasNodeCaches(file: TFile, content: string): Record<string, CachedMetadata> | null {
  const hit = canvasCacheStore.get(file)
  if (hit && hit.mtime === file.stat.mtime && hit.size === file.stat.size) return hit.caches
  let data: any
  try {
    data = JSON.parse(content)
  } catch {
    return null
  }
  const caches: Record<string, CachedMetadata> = {}
  if (data && Array.isArray(data.nodes)) for (const n of data.nodes) if (n && n.type === 'text' && typeof n.text === 'string') caches[n.id] = computeMetadata(n.text)
  canvasCacheStore.set(file, { mtime: file.stat.mtime, size: file.stat.size, caches })
  return caches
}

/** SearchEnvironment backed by an app (merged MetadataCache + canvas node caches). */
export function appSearchEnvironment(app: SearchAppLike): SearchEnvironment {
  return {
    getFileCache: (f) => app.metadataCache.getFileCache(f),
    getCanvasCaches: (f, content) => canvasNodeCaches(f, content)
  }
}

function isUserIgnored(app: SearchAppLike, path: string): boolean {
  return app.metadataCache.isUserIgnored ? app.metadataCache.isUserIgnored(path) : false
}
function isSupported(app: SearchAppLike, file: TFile): boolean {
  return app.metadataCache.isSupportedFile ? app.metadataCache.isSupportedFile(file) : true
}

/**
 * Drain `queue`, reading content only when the query needs it, and call `onFile` for every
 * searchable file. Returns when the queue is cancelled.
 */
export async function runSearch(
  app: SearchAppLike,
  required: { content?: boolean } | null,
  queue: WorkQueue<TFile>,
  onFile: (file: TFile, content: string) => void | Promise<void>,
  onPause?: () => void
): Promise<void> {
  const slicer = new TimeSlicer({ maxDelay: 100 })
  for await (const file of queue.generator()) {
    if (isUserIgnored(app, file.path)) continue
    if (!isSupported(app, file)) continue
    let content = ''
    if ((file.extension === 'md' || file.extension === 'canvas') && required && required.content) {
      try {
        content = await app.vault.cachedRead(file)
      } catch (e) {
        console.error(e)
      }
    }
    if (queue.runnable.isCancelled()) return
    await onFile(file, content)
    if (slicer.shouldPause()) {
      onPause?.()
      await slicer.pause()
    }
  }
}

/** The part of a result list the live queue talks to. */
export interface SearchResultSink {
  sortOrder: string
  startLoader(): void
  stopLoader(): void
  removeResult(file: TFile): unknown
}

/** Live search queue: owns the current work queue and feeds file changes back into it. */
export class SearchQueue extends Component {
  queue: WorkQueue<TFile> | null = null
  constructor(public app: SearchAppLike, public dom: SearchResultSink) {
    super()
  }
  onload(): void {
    const v = this.app.vault
    this.registerEvent(v.on('create', this.onNonMarkdownFileChanged, this))
    this.registerEvent(v.on('modify', this.onNonMarkdownFileChanged, this))
    this.registerEvent(v.on('rename', this.onFileChanged, this))
    this.registerEvent(v.on('delete', this.onFileDeleted, this))
    this.registerEvent(this.app.metadataCache.on('changed', this.onFileChanged, this))
  }
  onunload(): void {
    this.stop()
  }
  stop(): void {
    const q = this.queue
    if (q) {
      q.cancel()
      this.queue = null
    }
  }
  start(cb?: QueueCallbacks): WorkQueue<TFile> {
    const dom = this.dom
    const q = (this.queue = new WorkQueue<TFile>({
      onStart: () => {
        dom.startLoader()
        cb?.onStart?.()
      },
      onStop: () => {
        dom.stopLoader()
        cb?.onStop?.()
      },
      onCancel: () => {
        this.queue = null
        cb?.onCancel?.()
      }
    }))
    const files = this.app.vault.getFiles()
    if (dom.sortOrder) files.sort(getSortComparator(dom.sortOrder))
    q.addList(files)
    return q
  }
  onNonMarkdownFileChanged(file: any): void {
    if (isFile(file) && file.extension !== 'md') this.queue?.add(file)
  }
  onFileChanged(file: any): void {
    if (isFile(file)) this.queue?.add(file)
  }
  onFileDeleted(file: any): void {
    if (!isFile(file)) return
    this.queue?.remove(file)
    this.dom.removeResult(file)
  }
}

function isFile(f: any): f is TFile {
  return !!f && typeof f.extension === 'string' && !!f.stat && !('children' in f)
}

/**
 * Convenience: run `query` once over the whole vault (no live updates) and resolve with the
 * matches in `sortOrder`. Throws on query parse errors.
 */
export async function searchVault(
  app: SearchAppLike,
  query: string,
  opts: { caseSensitive?: boolean; sortOrder?: string } = {}
): Promise<Array<{ file: TFile; result: SearchResult; content: string }>> {
  const sq = new SearchQuery(appSearchEnvironment(app), query, !!opts.caseSensitive)
  if (!sq.matcher) return []
  const out: Array<{ file: TFile; result: SearchResult; content: string }> = []
  const cmp = getSortComparator(opts.sortOrder ?? 'alphabetical')
  const q = new WorkQueue<TFile>(undefined, false)
  q.addList(app.vault.getFiles().sort(cmp))
  await runSearch(app, sq.requiredInputs, q, (file, content) => {
    const r = sq.match(file, content)
    if (r) out.push({ file, result: r, content })
  })
  return out.sort((a, b) => cmp(a.file, b.file))
}
