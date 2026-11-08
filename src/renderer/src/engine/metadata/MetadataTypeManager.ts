/* eslint-disable @typescript-eslint/no-explicit-any */
// app.metadataTypeManager — property name -> widget type registry persisted as `.quartz/types.json`
// (`{"types": {"<name>": "<widget>"}}`). Types that are not assigned are
// inferred from the values found in the vault's frontmatter.
import { Events } from '../core/Events'
import { widgets, UNKNOWN_WIDGET, type TypeWidget } from '../views/properties/widgets'

export type WidgetType = 'text' | 'multitext' | 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'aliases' | 'file' | 'folder' | 'property' | string

export interface PropertyInfo {
  name: string
  widget: string
}
export interface TypeInfo {
  expected: TypeWidget
  inferred: TypeWidget
}

/** Types every vault has (listed first in types.json). */
const DEFAULT_ASSIGNED: Record<string, PropertyInfo> = {
  aliases: { name: 'aliases', widget: 'aliases' },
  cssclasses: { name: 'cssclasses', widget: 'multitext' },
  tags: { name: 'tags', widget: 'tags' }
}
const DATETIME = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/
const DATE = /^\d{4}-[01]\d-[0-3]\d$/
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Widget type inferred from a frontmatter value. */
export function inferWidget(v: unknown): string {
  if (v == null) return 'text'
  const t = typeof v
  if (t === 'string') return DATETIME.test(v as string) ? 'datetime' : DATE.test(v as string) ? 'date' : 'text'
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'checkbox'
  if (Array.isArray(v) && v.every(x => typeof x === 'string' || x == null)) return 'multitext'
  return 'unknown'
}

export class MetadataTypeManager extends Events {
  app: any
  assignedWidgets: Record<string, PropertyInfo> = {}
  properties: Record<string, PropertyInfo> = {}
  registeredTypeWidgets: Record<string, TypeWidget> = widgets
  lastSave = 0
  private _loaded = false
  private listening = false

  constructor(app: any) {
    super()
    this.app = app
  }

  async load(): Promise<void> {
    await this.loadData()
    this._loaded = true
    this.registerListeners()
    this.rebuildProperties()
  }

  registerListeners(): void {
    if (this.listening) return
    this.listening = true
    const { vault, metadataCache } = this.app
    vault.on('raw', (path: string) => {
      if (path === vault.configDir + '/types.json') void this.onConfigFileChange()
    })
    vault.on('config-changed', (k: string) => {
      if (k === 'userIgnoreFilters') this.rebuildProperties()
    })
    metadataCache.on('changed', (file: any, _d: string, cache: any) => this.onCacheChanged(file, cache))
    metadataCache.on('finished', () => this.rebuildProperties())
    this.on('changed', () => this.rebuildProperties())
  }

  private async onConfigFileChange(): Promise<void> {
    try {
      const st = await this.app.vault.adapter.stat(this.app.vault.getConfigFile('types'))
      if (st && this.lastSave < st.mtime) {
        await this.loadData()
        this.lastSave = st.mtime
      }
    } catch {
      /* ignore */
    }
  }

  private onCacheChanged(file: any, cache: any): void {
    const fm = cache?.frontmatter
    if (!fm || this.app.metadataCache.isUserIgnored?.(file.path)) return
    for (const key of Object.keys(fm)) {
      const k = key.toLowerCase()
      if (hasOwn(this.assignedWidgets, k)) continue
      const v = fm[key]
      const cur = hasOwn(this.properties, k) ? this.properties[k] : null
      if (cur) {
        if (v != null) {
          cur.name = key
          cur.widget = inferWidget(v)
        }
      } else this.properties[k] = { name: key, widget: v != null ? inferWidget(v) : 'text' }
    }
  }

  rebuildProperties(): void {
    const acc: Record<string, { name: string; widget?: string }> = {}
    for (const k of Object.keys(this.assignedWidgets)) acc[k] = { name: this.assignedWidgets[k].name, widget: this.assignedWidgets[k].widget }
    this.app.metadataCache.iterateFileCache((_p: string, meta: any) => {
      const fm = meta?.frontmatter
      if (!fm) return
      for (const key of Object.keys(fm)) {
        const k = key.toLowerCase()
        const cur = hasOwn(acc, k) ? acc[k] : null
        const v = fm[key]
        if (cur) {
          if (cur.widget === undefined && v != null) cur.widget = inferWidget(v)
        } else acc[k] = { name: key, widget: v != null ? inferWidget(v) : undefined }
      }
    })
    this.properties = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { name: v.name, widget: v.widget ?? 'text' }]))
  }

  getAllProperties(): Record<string, PropertyInfo> {
    return this.properties
  }

  /** Lower-cased property name -> number of notes using it. */
  getPropertyOccurrences(): Record<string, number> {
    const out: Record<string, number> = {}
    this.app.metadataCache.iterateFileCache((_p: string, meta: any) => {
      const fm = meta?.frontmatter
      if (!fm) return
      for (const key of Object.keys(fm)) {
        const k = key.toLowerCase()
        out[k] = (out[k] ?? 0) + 1
      }
    })
    return out
  }

  getAssignedWidget(key: string): string | null {
    const k = key.toLowerCase()
    return hasOwn(this.assignedWidgets, k) ? this.assignedWidgets[k].widget : null
  }

  getWidget(type: string): TypeWidget {
    const k = (type ?? '').toLowerCase()
    return hasOwn(this.registeredTypeWidgets, k) ? this.registeredTypeWidgets[k] : UNKNOWN_WIDGET
  }

  getTypeInfo(key: string, value?: unknown): TypeInfo {
    let assigned: TypeWidget | undefined
    const a = this.getAssignedWidget(key)
    if (a) {
      assigned = this.getWidget(a)
      if (value == null || assigned.validate(value)) return { expected: assigned, inferred: assigned }
    }
    if (value == null) {
      const w = this.getWidget(this.getPropertyInfo(key).widget)
      if (w !== UNKNOWN_WIDGET) return { inferred: w, expected: assigned ?? w }
    }
    const inferred = this.getWidget(inferWidget(value))
    return { inferred, expected: assigned ?? inferred }
  }

  getPropertyInfo(key: string): PropertyInfo {
    const k = key.toLowerCase()
    return hasOwn(this.properties, k) ? this.properties[k] : { name: key, widget: 'text' }
  }

  async loadData(): Promise<void> {
    const data = await this.app.vault.readConfigJson('types')
    const prev = this.assignedWidgets
    this.assignedWidgets = {}
    if (data && hasOwn(data, 'types')) {
      for (const name of Object.keys(data.types)) {
        const widget = data.types[name]
        const k = name.toLowerCase()
        if (!hasOwn(this.assignedWidgets, k)) this.assignedWidgets[k] = { name, widget }
        if (this._loaded && !(hasOwn(prev, k) && prev[k].widget === widget)) this.trigger('changed', k)
      }
    }
    Object.assign(this.assignedWidgets, structuredCloneShallow(DEFAULT_ASSIGNED))
  }

  async save(): Promise<void> {
    const types: Record<string, string> = {}
    for (const k of Object.keys(this.assignedWidgets)) types[this.assignedWidgets[k].name] = this.assignedWidgets[k].widget
    const now = Date.now()
    this.lastSave = now
    await this.app.vault.writeConfigJson('types', { types }, { mtime: now })
  }

  async setType(key: string, widget: string): Promise<void> {
    const k = key.toLowerCase()
    const cur = this.assignedWidgets[k]
    if (cur) cur.widget = widget
    else this.assignedWidgets[k] = { name: key, widget }
    await this.save()
    this.trigger('changed', k)
  }

  async unsetType(key: string): Promise<void> {
    const k = key.toLowerCase()
    delete this.assignedWidgets[k]
    await this.save()
    this.trigger('changed', k)
  }
}

function structuredCloneShallow(o: Record<string, PropertyInfo>): Record<string, PropertyInfo> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v }]))
}
