/* eslint-disable @typescript-eslint/no-explicit-any */
// Small `obsidian` exports that had no home elsewhere in Quartz yet (minimal but working,
// following the plugin API typings): YAML, binary/hex helpers, apiVersion, EditorSuggest, Bases value
// classes, SecretStorage, TExternalFile, RenderContext, misc loaders.
import { parse, stringify } from 'yaml'
import { PopoverSuggest } from '../ui/suggest'
import { TAbstractFile } from '../vault/TAbstractFile'
import { Component } from '../core/Component'
import { Events } from '../core/Events'

export const apiVersion = '1.14.4'

export function requireApiVersion(version: string): boolean {
  const a = apiVersion.split('.').map(Number)
  const b = String(version).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return true
}

export function parseYaml(yaml: string): any {
  return parse(yaml)
}
export function stringifyYaml(obj: any): string {
  return stringify(obj)
}

export function getLanguage(): string {
  try {
    return localStorage.getItem('language') || (navigator.language || 'en').split('-')[0]
  } catch {
    return 'en'
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const s = atob(base64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}
export function arrayBufferToHex(data: ArrayBuffer): string {
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('')
}
export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const out = new Uint8Array(Math.floor(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out.buffer
}
export function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer()
}

export function parsePropertyId(propertyId: string): { type: string; name: string } {
  const m = /^(note|file|formula)\.(.*)$/s.exec(propertyId)
  return m ? { type: m[1], name: m[2] } : { type: 'note', name: propertyId }
}

export async function loadPdfJs(): Promise<any> {
  return (window as any).pdfjsLib ?? null
}
export async function loadMermaid(): Promise<any> {
  const mod: any = await import('mermaid')
  return mod.default ?? mod
}

/** Reading-view render context (`RenderContext`). */
export class RenderContext {
  constructor(public app: any = null) {}
}

export class TExternalFile extends TAbstractFile {
  extension = ''
  basename = ''
}

/** `app.secretStorage` (localStorage-backed). */
export class SecretStorage extends Events {
  constructor(private app: any = null) {
    super()
  }
  private key(id: string): string {
    return `${this.app?.appId ?? 'quartz'}-secret-${id}`
  }
  getSecret(id: string): string | null {
    try {
      return localStorage.getItem(this.key(id))
    } catch {
      return null
    }
  }
  setSecret(id: string, secret: string): void {
    try {
      localStorage.setItem(this.key(id), secret)
    } catch {
      /* ignore */
    }
    this.trigger('changed')
  }
  deleteSecret(id: string): void {
    try {
      localStorage.removeItem(this.key(id))
    } catch {
      /* ignore */
    }
    this.trigger('changed')
  }
  getLastAccess(_id: string): number | null {
    return null
  }
  isEncryptionAvailable(): boolean {
    return false
  }
  listSecrets(): string[] {
    const prefix = this.key('')
    const out: string[] = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!
        if (k.startsWith(prefix)) out.push(k.slice(prefix.length))
      }
    } catch {
      /* ignore */
    }
    return out
  }
}

// ------------------------------------------------------------------ EditorSuggest
export interface EditorSuggestTriggerInfo {
  start: { line: number; ch: number }
  end: { line: number; ch: number }
  query: string
}
export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
  editor: any
  file: any
}

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: EditorSuggestContext | null = null
  limit = 100
  /** @internal */ instructionsEl: HTMLElement = createDiv('prompt-instructions')
  constructor(app: any) {
    super(app)
    this.suggestEl.addEventListener('mousedown', e => e.preventDefault())
  }
  setInstructions(instructions: { command: string; purpose: string }[]): void {
    if (instructions.length > 0) {
      this.instructionsEl.empty()
      for (const i of instructions) {
        this.instructionsEl.createDiv('prompt-instruction', row => {
          row.createSpan({ cls: 'prompt-instruction-command', text: i.command })
          row.createSpan({ text: i.purpose })
        })
      }
      this.suggestEl.appendChild(this.instructionsEl)
    } else this.instructionsEl.detach()
  }
  abstract onTrigger(cursor: { line: number; ch: number }, editor: any, file: any): EditorSuggestTriggerInfo | null
  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>
  /** @internal Called by `app.workspace.editorSuggest` on every (debounced) editor update. */
  trigger(editor: any, file: any, forced: boolean): boolean {
    const from = editor.getCursor('from')
    const to = editor.getCursor('to')
    if (from.line !== to.line || from.ch !== to.ch) {
      this.context = null
      return false
    }
    const info = this.onTrigger(from, editor, file)
    if (!info) {
      this.context = null
      return false
    }
    const ctx = (this.context = { editor, file, start: info.start, end: info.end, query: info.query })
    if (forced || this.isOpen) {
      const res = this.getSuggestions(ctx)
      if (Array.isArray(res)) this.showSuggestions(res)
      else if (res) {
        void res.then(list => {
          if (!editor.hasFocus()) return this.close()
          if (list) this.showSuggestions(list)
        })
      }
    }
    return true
  }
  /** @internal */
  showSuggestions(list: T[]): void {
    if (list.length === 0) return this.close()
    const n = this.limit
    if (n > 0 && list.length > n) list = list.slice(0, n)
    this.suggestions.setSuggestions(list)
    this.updatePosition(true)
  }
  /** @internal */
  updatePosition(_initial?: boolean): void {
    const ctx = this.context
    if (!ctx) return
    const ed = ctx.editor
    const a = ed.coordsAtPos(ctx.start)
    const b = ed.coordsAtPos(ctx.end)
    if (!a || !b) return
    const rect = { top: a.top, left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), bottom: b.bottom }
    this.open()
    this.reposition({ x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top } as any)
  }
  close(): void {
    this.context = null
    super.close()
  }
}

// ------------------------------------------------------------------ Bases
// The real implementation lives in views/bases; re-exported here for the 'obsidian' module.
export {
  Value, NullValue, NotNullValue, PrimitiveValue, StringValue, NumberValue, BooleanValue, DateValue, RelativeDateValue, DurationValue,
  ListValue, ObjectValue, LinkValue, FileValue, UrlValue, TagValue, HTMLValue, IconValue, ImageValue, RegExpValue
} from '../views/bases/values'
export { BasesEntry, BasesEntryGroup, BasesQueryResult, BasesViewConfig, QueryController, BasesView } from '../views/bases/api'
