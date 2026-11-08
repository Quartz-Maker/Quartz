/* eslint-disable @typescript-eslint/no-explicit-any */
// The community plugin / theme registry: URL helpers, requests, version pick and loaders. Quartz reads the
// public GitHub registry only — never releases.obsidian.md (no proxy fallback, no stats endpoint; theme
// download counts are not published on GitHub, so they are 0).
import { requestUrl, type RequestUrlResponsePromise } from '../../ui/request'
import { apiVersion } from '../../plugins/extras'

const GITHUB = 'https://github.com/'
const RAW = 'https://raw.githubusercontent.com/'
const RELEASES_REPO = 'obsidianmd/obsidian-releases'

/** `raw.githubusercontent.com/<repo>/<ref|HEAD>/<path>` */
export function rawUrl(repo: string, path: string, ref?: string): string {
  return RAW + repo + '/' + (ref || 'HEAD') + '/' + path
}
/** `github.com/<repo>` */
export function repoUrl(repo: string): string {
  return GITHUB + repo
}
/** `github.com/<repo>/releases/download/<version>/<file>` */
export function releaseAssetUrl(repo: string, version: string, file: string): string {
  return GITHUB + repo + '/releases/download/' + version + '/' + file
}

/** GET with promise helpers (`.json` / `.text`); status >= 400 rejects. */
export function fetchUrl(url: string): RequestUrlResponsePromise {
  return requestUrl({ url })
}

function parseVersion(v: unknown): number[] | null {
  if (!v || typeof v !== 'string') return null
  let ok = true
  const parts = v.split('.').map(x => {
    const n = parseInt(x)
    if (isNaN(n)) ok = false
    return n
  })
  return ok ? parts : null
}

/** True when `b` is a valid version newer than `a` (or `a` is not a valid version). */
export function isNewerVersion(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!y) return false
  if (!x) return true
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    if (x[i] < y[i]) return true
    if (x[i] > y[i]) return false
  }
  return x.length < y.length
}

/** The release to install: the manifest's version, or — when the app is older than its minAppVersion — the
 *  newest entry of the repo's versions.json this app supports (null if none). */
export async function pickVersion(repo: string, manifest: any): Promise<string | null> {
  let version: string | null = manifest.version || null
  const min = manifest.minAppVersion
  if (!min || !isNewerVersion(apiVersion, min)) return version
  try {
    version = null
    const versions = await fetchUrl(rawUrl(repo, 'versions.json')).json
    if (versions) {
      for (const v of Object.keys(versions)) {
        if (isNewerVersion(apiVersion, versions[v])) continue
        if (version && !isNewerVersion(version, v)) continue
        version = v
      }
      return version
    }
  } catch {
    /* no versions.json */
  }
  return null
}

/** Memoise an async loader for `ttl` ms (failures are retried after `retry` ms). */
function cached<T>(fn: () => Promise<T>, ttl: number, retry = ttl): () => Promise<T | null> {
  let value: T | null = null
  let until = 0
  let pending: Promise<T | null> | null = null
  return () => {
    if (pending) return pending
    if (value && until > Date.now()) return Promise.resolve(value)
    pending = (async () => {
      until = Date.now() + retry
      try {
        value = await fn()
      } catch {
        pending = null
        return null
      }
      until = Date.now() + ttl
      pending = null
      setTimeout(() => {
        if (until > Date.now()) value = null
      }, ttl)
      return value
    })()
    return pending
  }
}

export interface CommunityPluginEntry {
  id: string
  name: string
  author: string
  description: string
  repo: string
}
export interface CommunityThemeEntry {
  name: string
  author: string
  repo: string
  screenshot: string
  modes: string[]
  legacy?: boolean
}

export const loadCommunityPlugins = cached(async (): Promise<CommunityPluginEntry[]> => {
  const list = await fetchUrl(rawUrl(RELEASES_REPO, 'community-plugins.json')).json
  if (!Array.isArray(list)) throw new Error('Failed to parse community plugins.')
  return list
}, 3e5, 6e4)

/** `{ [id]: { downloads, updated, <version>: count } }` */
export const loadCommunityPluginStats = cached(() => fetchUrl(rawUrl(RELEASES_REPO, 'community-plugin-stats.json')).json, 3e5, 6e4)

export const loadCommunityThemes = cached(async (): Promise<CommunityThemeEntry[]> => {
  const list = await fetchUrl(rawUrl(RELEASES_REPO, 'community-css-themes.json')).json
  if (!Array.isArray(list)) throw new Error('Failed to parse community themes.')
  return list
}, 3e5, 6e4)

/** Theme download counts are not published on GitHub, so none are available. */
export async function loadCommunityThemeStats(): Promise<Record<string, { download: number }>> {
  return {}
}

/** `8.7M`, `12k`, `950`. */
export function formatCount(n: number): string {
  if (!n) return '0'
  if (n < 1e3) return String(n)
  if (n < 1e6) return Math.floor(n / 1e3) + 'k'
  return Math.floor(n / 1e5) / 10 + 'M'
}

/** Truncates `s` to `max` characters, ending with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trim() + '…'
}

/** Strips inline source maps from a plugin's main.js (appends a marker so they are not re-added). */
export function stripSourceMap(code: string): string {
  return code.replace(/^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm, '') + '\n/* nosourcemap */'
}
