// `requestUrl` / `request` (plugin API, obsidian.d.ts).
// Desktop: the main process performs the request (ipc `request-url`, see src/main/core.ts) — no
// CORS. Without Electron, falls back to fetch(). Status >= 400 rejects with an Error carrying
// `status`/`headers` unless `throw: false`. The returned promise also exposes `.arrayBuffer`,
// `.json` and `.text` promises. Both functions are also installed as window globals.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RequestUrlParam {
  url: string
  method?: string
  contentType?: string
  body?: string | ArrayBuffer
  headers?: Record<string, string>
  throw?: boolean
}

export interface RequestUrlResponse {
  status: number
  headers: Record<string, string>
  arrayBuffer: ArrayBuffer
  json: any
  text: string
}

export interface RequestUrlResponsePromise extends Promise<RequestUrlResponse> {
  arrayBuffer: Promise<ArrayBuffer>
  json: Promise<any>
  text: Promise<string>
}

/** Error thrown for HTTP status >= 400. */
export class RequestUrlError extends Error {
  status: number
  headers: Record<string, string>
  constructor(message: string, status: number, headers: Record<string, string>) {
    super(message)
    this.status = status
    this.headers = headers
    Object.setPrototypeOf(this, RequestUrlError.prototype)
  }
}

function makeResponse(req: RequestUrlParam, status: number, headers: Record<string, string>, body: ArrayBuffer): RequestUrlResponse {
  if ((req.throw ?? true) && status >= 400) throw new RequestUrlError('Request failed, status ' + status, status, headers)
  return {
    status,
    headers,
    arrayBuffer: body,
    get json() {
      return JSON.parse(new TextDecoder().decode(body))
    },
    get text() {
      return new TextDecoder().decode(body)
    }
  }
}

function getIpc(): any | null {
  try {
    const req = (window as any).require
    if (typeof req !== 'function') return null
    return req('electron')?.ipcRenderer ?? null
  } catch {
    return null
  }
}

function randomId(): string {
  let s = ''
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

function viaIpc(ipc: any, req: RequestUrlParam): Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const channel = randomId()
    ipc.once(channel, (_e: any, res: any) => {
      if (res && res.body) resolve(res)
      else reject(res?.error)
    })
    ipc.send('request-url', channel, req)
  })
}

async function doRequest(param: RequestUrlParam | string): Promise<RequestUrlResponse> {
  const req: RequestUrlParam = typeof param === 'string' ? { url: param } : param
  const ipc = getIpc()
  if (ipc) {
    const r = await viaIpc(ipc, req)
    return makeResponse(req, r.status, r.headers, r.body)
  }
  const headers: Record<string, string> | undefined = req.contentType ? { 'Content-Type': req.contentType } : undefined
  const res = await fetch(req.url, { method: req.method, headers, body: req.body as any })
  const body = await res.arrayBuffer()
  const h: Record<string, string> = {}
  res.headers.forEach((v, k) => (h[k] = v))
  return makeResponse(req, res.status, h, body)
}

export function requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise {
  const p = doRequest(request) as RequestUrlResponsePromise
  Object.defineProperty(p, 'arrayBuffer', { get: () => p.then(r => r.arrayBuffer) })
  Object.defineProperty(p, 'json', { get: () => p.then(r => r.json) })
  Object.defineProperty(p, 'text', { get: () => p.then(r => r.text) })
  return p
}

export async function request(request: RequestUrlParam | string): Promise<string> {
  return (await doRequest(request)).text
}

if (typeof window !== 'undefined') {
  ;(window as any).request = request
  ;(window as any).requestUrl = requestUrl
}
