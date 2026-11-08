/* eslint-disable @typescript-eslint/no-explicit-any */
// Rendering and in-place editing of property values (shared by table/cards/list/kanban).
import { splitPropertyId } from './BaseConfig'
import type { BasesEntry } from './context'
import { Value, NULL, NullValue, ListValue, StringValue, insensitiveKey } from './values'
import type { QueryController } from './QueryController'

/** Header / property icon for a property id. */
export function propertyIcon(ctrl: QueryController, prop: string): string {
  const { type } = splitPropertyId(prop)
  if (type === 'formula') return 'lucide-square-function'
  if (type === 'file') return 'lucide-info'
  switch (ctrl.getPropertyType(prop)) {
    case 'number': return 'lucide-binary'
    case 'checkbox': return 'lucide-check-square'
    case 'date': return 'lucide-calendar'
    case 'datetime': return 'lucide-clock'
    case 'multitext': return 'lucide-list'
    case 'tags': return 'lucide-tags'
    case 'aliases': return 'lucide-forward'
    default: return 'lucide-text'
  }
}

/** Write `value` (a plain JS value, or undefined to delete) to a note property through the frontmatter API. */
export async function writeProperty(app: any, file: any, name: string, value: any): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: any) => {
    const key = insensitiveKey(fm, name)
    if (value === undefined) delete fm[key]
    else fm[key] = value
  })
}

export function isEditable(prop: string): boolean {
  return splitPropertyId(prop).type === 'note'
}

/** Read-only rendering of a value into `el`. */
export function renderValue(ctrl: QueryController, entry: BasesEntry, prop: string, el: HTMLElement, asLink = false): void {
  if (prop === 'file.name' && asLink) {
    el.empty()
    ctrl.renderCtx.renderFileLink(entry.file, null, el)
    return
  }
  const v = (entry.getValue(prop) as Value | null) ?? NULL
  el.empty()
  if (v instanceof NullValue) return
  v.renderTo(el, ctrl.renderCtx)
}

/**
 * Editable table cell. Returns the cell element; `.bases-metadata-value.metadata-property-value` wraps
 * an input matching the property's widget, `.bases-rendered-value` is used for computed values.
 */
export function renderCell(ctrl: QueryController, entry: BasesEntry, prop: string, parent: HTMLElement, editable = true): HTMLElement {
  const v = (entry.getValue(prop) as Value | null) ?? NULL
  const { name } = splitPropertyId(prop)
  if (prop === 'file.name' || !editable || !isEditable(prop) || (v instanceof ListValue && v.length() > 0 && !(v.get(0) instanceof StringValue))) {
    const el = parent.createDiv({ cls: 'bases-table-cell bases-rendered-value' })
    renderValue(ctrl, entry, prop, el, true)
    return el
  }
  // Same widgets as the Properties editor (reference cells render the metadata type widget in place).
  const raw = entry.getRawProperty(name)
  const widget = ctrl.app.metadataTypeManager?.getTypeInfo?.(name, raw)?.expected
  const wrap = parent.createDiv({ cls: 'bases-table-cell bases-metadata-value metadata-property-value' })
  const commit = (val: any): void => void writeProperty(ctrl.app, entry.file, name, val)
  if (widget?.render) {
    wrap.setAttr('data-property-type', widget.type)
    widget.render(wrap, raw, { app: ctrl.app, key: name, sourcePath: entry.file.path, hoverSource: 'bases', onChange: (val: any) => commit(val === '' ? undefined : val), blur: () => {} })
  } else {
    const i = wrap.createEl('input', { cls: 'metadata-input metadata-input-text', type: 'text' }) as HTMLInputElement
    i.value = raw === null || raw === undefined ? '' : String(raw)
    i.addEventListener('change', () => commit(i.value === '' ? undefined : i.value))
  }
  return wrap
}

