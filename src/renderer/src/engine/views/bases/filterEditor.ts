/* eslint-disable @typescript-eslint/no-explicit-any */
// The Bases filter editor: nested and / or / not groups of statements. A statement is edited with
// property / operator / value controls ("simple" mode) or as a free-form expression ("advanced" mode).
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { Notice } from '../../ui/Notice'
import { setIcon } from '../../ui/icons'
import { ExprFilter, GroupFilter, type FilterNode, splitPropertyId, joinPropertyId } from './BaseConfig'
import { Combobox, PropertyCombobox, type ComboItem } from './combobox'
import { Formula } from './expr/Formula'
import { parseExpression, type Node } from './expr/parser'
import { L, TextButton, ToolbarItem } from './popover'
import type { QueryController } from './QueryController'

type Conj = 'and' | 'or' | 'not'
export type Category = 'text' | 'number' | 'date' | 'bool' | 'list' | 'null' | 'file'
const COMPARES = ['==', '!=', '<', '>', '<=', '>=']

// ------------------------------------------------------------------ operator tables
interface FuncDef { name: string; display: string; inverse: string; rhs: string | null; needsValue: boolean }
const FUNCS: Record<string, FuncDef> = {
  hasProperty: { name: 'hasProperty', display: 'has property', inverse: 'does not have property', rhs: 'property', needsValue: true },
  isEmpty: { name: 'isEmpty', display: 'is empty', inverse: 'is not empty', rhs: null, needsValue: false },
  startsWith: { name: 'startsWith', display: 'starts with', inverse: 'does not start with', rhs: 'text', needsValue: true },
  endsWith: { name: 'endsWith', display: 'ends with', inverse: 'does not end with', rhs: 'text', needsValue: true },
  contains: { name: 'contains', display: 'contains', inverse: 'does not contain', rhs: null, needsValue: true },
  containsAny: { name: 'containsAny', display: 'contains any of', inverse: 'does not contain any of', rhs: 'multitext', needsValue: true },
  containsAll: { name: 'containsAll', display: 'contains all of', inverse: 'does not contain all of', rhs: 'multitext', needsValue: true },
  hasLink: { name: 'hasLink', display: 'links to', inverse: 'does not link to', rhs: 'file', needsValue: true },
  inFolder: { name: 'inFolder', display: 'in folder', inverse: 'is not in folder', rhs: 'folder', needsValue: true },
  hasTag: { name: 'hasTag', display: 'has tag', inverse: 'does not have tag', rhs: 'multitext', needsValue: true }
}
const FUNCS_BY_CATEGORY: Record<Category, string[]> = {
  text: ['startsWith', 'endsWith', 'isEmpty', 'contains', 'containsAny', 'containsAll'],
  number: ['isEmpty'],
  date: ['isEmpty'],
  bool: [],
  list: ['isEmpty', 'contains', 'containsAny', 'containsAll'],
  null: ['isEmpty'],
  file: ['hasLink', 'inFolder', 'hasTag', 'hasProperty']
}
const COMPARE_ITEMS: Record<Category, [string, string][]> = {
  text: [['is', '=='], ['is not', '!=']],
  number: [['=', '=='], ['≠', '!='], ['<', '<'], ['≤', '<='], ['>', '>'], ['≥', '>=']],
  date: [['on', '=='], ['not on', '!='], ['before', '<'], ['on or before', '<='], ['after', '>'], ['on or after', '>=']],
  bool: [['is', '=='], ['is not', '!=']],
  list: [['is exactly', '=='], ['is not exactly', '!=']],
  null: [['is', '=='], ['is not', '!=']],
  file: []
}

export interface OperatorItem extends ComboItem {
  funcName?: string
  inverse?: boolean
}
export function operatorsFor(cat: Category): OperatorItem[] {
  const out: OperatorItem[] = COMPARE_ITEMS[cat].map(([display, value]) => ({ display, value }))
  const fns = FUNCS_BY_CATEGORY[cat]
  for (const f of fns) out.push({ display: FUNCS[f].display, value: f.toLowerCase(), funcName: f.toLowerCase(), inverse: false })
  for (const f of fns) out.push({ display: FUNCS[f].inverse, value: '!' + f.toLowerCase(), funcName: f.toLowerCase(), inverse: true })
  return out
}
const funcByLower = (n: string): FuncDef | null => Object.values(FUNCS).find(f => f.name.toLowerCase() === n.toLowerCase()) ?? null

/** `note.x` -> `x`, `formula.f` -> `formula.f`, `file.file` -> `file`. */
export function identFor(id: string): string {
  if (!id) return ''
  const { type, name } = splitPropertyId(id)
  if (type === 'file' && name === 'file') return 'file'
  if (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) === false) return `${type}[${JSON.stringify(name)}]`
  return type === 'note' ? name : `${type}.${name}`
}

// ------------------------------------------------------------------ editor
export class FilterEditor {
  innerContainerEl: HTMLElement
  root!: GroupNode
  saveFn: ((v: any) => void) | null = null
  viewConfig: any = null
  constructor(public app: any, parent: HTMLElement, public queryController: QueryController) {
    this.innerContainerEl = parent.createDiv('bases-query-container')
  }
  save(): void {
    this.saveFn?.(this.root.serialize())
  }
  emptyTopLevelFilter(): void {
    this.innerContainerEl.empty()
    this.root = new GroupNode(null, this, null)
    this.innerContainerEl.appendChild(this.root.containerEl)
    this.save()
  }
  updateQuery(saveFn: (v: any) => void, view: any, filter: FilterNode | undefined): void {
    this.saveFn = saveFn
    this.viewConfig = view
    const cur = this.root ? this.root.serialize() : undefined
    const incoming = filter ? filter.serialize() : null
    const changed = !this.root || (!!(cur || incoming) && JSON.stringify(cur) !== JSON.stringify(incoming))
    if (changed) {
      this.innerContainerEl.empty()
      this.root = (fromParsed(filter ?? null, this, null, true) as GroupNode)
      this.innerContainerEl.appendChild(this.root.containerEl)
    }
  }
}

abstract class FilterNodeUI {
  containerEl!: HTMLElement
  constructor(public editor: FilterEditor, public parent: GroupNode | null) {}
  abstract serialize(): any
}

function fromParsed(f: FilterNode | null, editor: FilterEditor, parent: GroupNode | null, top = false): FilterNodeUI {
  if (f instanceof GroupFilter) return new GroupNode(f, editor, parent)
  if (top) return new GroupNode(f ? ({ conj: 'and', filters: [f] } as any) : null, editor, parent)
  return new StatementNode(f as ExprFilter | null, editor, parent)
}

class GroupNode extends FilterNodeUI {
  children: FilterNodeUI[] = []
  conjunction: Conj = 'and'
  listEl: HTMLElement
  constructor(src: FilterNode | { conj: Conj; filters: FilterNode[] } | null, editor: FilterEditor, parent: GroupNode | null) {
    super(editor, parent)
    let kids: FilterNode[] = []
    if (src instanceof GroupFilter) {
      this.conjunction = src.conjunction
      kids = src.filters
    } else if (src) {
      this.conjunction = (src as any).conj
      kids = (src as any).filters
    }
    this.children = kids.length > 0 ? kids.map(k => fromParsed(k, editor, this)) : [new StatementNode(null, editor, this)]
    this.containerEl = createDiv('filter-group')
    this.containerEl.createDiv('filter-group-header', header => {
      const sel = header.createEl('select', { cls: 'conjunction dropdown' }) as HTMLSelectElement
      for (const [v, label] of [['and', L('labelAllTheFollowing')], ['or', L('labelAnyOfTheFollowing')], ['not', L('labelNoneOfTheFollowing')]] as const) {
        const o = sel.createEl('option', { text: label, attr: { value: v } })
        if (this.conjunction === v) o.selected = true
      }
      sel.addEventListener('change', () => {
        this.conjunction = sel.value as Conj
        this.renderChildren()
        if (this.children[this.children.length - 1].serialize()) this.editor.save()
      })
      header.createDiv('filter-group-header-actions', actions => {
        if (this.parent) {
          const btn = actions.createEl('button', { cls: 'clickable-icon' })
          setIcon(btn, 'lucide-trash-2')
          btn.addEventListener('click', () => (this.parent ? this.parent.removeChild(this) : this.editor.emptyTopLevelFilter()))
        }
      })
    })
    this.listEl = this.containerEl.createDiv('filter-group-statements')
    this.renderChildren()
    this.containerEl.createDiv('filter-group-actions', actions => {
      new TextButton(actions).setIcon('lucide-plus').setText(L('buttonAddFilter')).onClick(() => {
        const s = new StatementNode(null, this.editor, this)
        this.children.push(s)
        this.renderChildren()
        s.focusLHS()
      })
      new TextButton(actions).setIcon('lucide-plus').setText(L('buttonAddFilterGroup')).onClick(() => {
        this.children.push(new GroupNode({ conj: 'and', filters: [] }, this.editor, this))
        this.renderChildren()
      })
    })
  }
  renderChildren(): void {
    this.listEl.empty()
    this.children.forEach((c, i) => {
      const row = this.listEl.createDiv('filter-row')
      let label = this.conjunction === 'and' ? L('labelAnd') : L('labelOr')
      if (i === 0) label = L('labelWhere')
      row.createEl('span', { cls: 'conjunction', text: label })
      if (c instanceof GroupNode) row.addClass('mod-group')
      row.appendChild(c.containerEl)
    })
  }
  removeChild(c: FilterNodeUI): void {
    this.children.remove(c)
    if (this.children.length > 0) {
      this.renderChildren()
      this.editor.save()
      return
    }
    if (this.parent) this.parent.removeChild(this)
    else this.editor.emptyTopLevelFilter()
  }
  serialize(): any {
    const kids = this.children.map(c => c.serialize()).filter(x => !!x)
    if (kids.length === 0) return null
    return { [this.conjunction]: kids }
  }
}

class StatementNode extends FilterNodeUI {
  rightValue: any = null
  advanced = false
  advancedValue = ''
  advancedEditor: EditorView | null = null
  parsed: Formula | null
  leftEl: PropertyCombobox
  operatorEl: Combobox
  rhsEl: HTMLElement
  rightWidget: any = null
  advancedContainerEl: HTMLElement
  advancedHostEl: HTMLElement
  errorEl: HTMLElement
  toggleBtn: HTMLButtonElement
  constructor(src: ExprFilter | null, editor: FilterEditor, parent: GroupNode | null) {
    super(editor, parent)
    this.parsed = src?.expr ?? null
    const c = editor.queryController
    const st = (this.containerEl = createDiv('filter-statement'))
    const expr = st.createDiv('filter-expression metadata-property')
    this.leftEl = new PropertyCombobox(c, expr)
      .setPlaceholder(L('labelPropertyKey'))
      .filterProperties(id => id !== 'note.tags' && id !== 'file.backlinks')
      .onSelect(() => {
        const items = this.updateOperators()
        const cur = this.operatorEl.selected as OperatorItem | null
        const keep = cur && items.find(i => (i.funcName && cur.funcName === i.funcName && !!cur.inverse === !!i.inverse) || cur.value === i.value)
        if (!keep) {
          this.rightValue = null
          this.operatorEl.setValue(items[0] ?? null)
        } else this.operatorEl.setValue(keep)
        this.renderRight()
        this.operatorEl.focus()
        this.update()
      }) as PropertyCombobox
    this.leftEl.buttonEl.addClass('filter-property-select')
    this.operatorEl = new Combobox(c.app, expr).onSelect(() => {
      this.renderRight()
      this.update()
      if (this.rightWidget?.focus) this.rightWidget.focus()
      else (this.operatorEl.buttonEl.ownerDocument.activeElement as HTMLElement | null)?.blur()
    })
    this.operatorEl.buttonEl.addClass('filter-operator')
    this.rhsEl = expr.createDiv('filter-rhs-container metadata-property-value')
    this.advancedContainerEl = expr.createDiv('formula-editor-container')
    this.advancedHostEl = this.advancedContainerEl.createDiv('formula-editor')
    this.advancedContainerEl.hide()
    ;(this.advancedContainerEl as any).onNodeInserted(() => {})
    const actions = expr.createDiv('filter-row-actions')
    this.errorEl = st.createDiv('filter-row-error')
    this.errorEl.hide()
    this.toggleBtn = actions.createEl('button', { cls: 'clickable-icon filer-expression-mode-toggle' }) as HTMLButtonElement
    this.toggleBtn.setAttribute('aria-label', L('tooltipFilterAdvancedMode'))
    this.toggleBtn.addEventListener('click', () => this.toggleMode())
    const del = actions.createEl('button', { cls: 'clickable-icon' })
    del.setAttribute('aria-label', L('tooltipRemoveFilter'))
    setIcon(del, 'trash-2')
    del.addEventListener('click', () => (this.parent ? this.parent.removeChild(this) : this.editor.emptyTopLevelFilter()))
    this.setFieldValues(this.parsed)
  }

  private toggleMode(): void {
    const text = this.serialize()
    if (this.advanced) {
      if (!text) return this.setFieldValues(null)
      const f = new Formula(text)
      if (f.isInvalid) {
        new Notice(L('msgFilterCannotParse'))
        this.setErrorState(f.parseError ?? '')
      } else {
        this.setFieldValues(f)
        if (this.advanced) new Notice(L('msgFilterSimpleUnavailable'))
      }
    } else {
      this.advanced = true
      this.setAdvancedValue(text)
      this.reconcile()
    }
  }
  focusLHS(): void {
    if (this.advanced) this.advancedEditor?.focus()
    else this.leftEl.focus()
  }
  private leftValue(): string {
    return this.leftEl.selected?.value || ''
  }
  private category(): Category {
    const id = this.leftValue()
    if (!id) return 'null'
    if (id === 'file.file') return 'file'
    const w = this.editor.queryController.getWidgetForIdent(identFor(id))
    switch (w) {
      case 'text': return 'text'
      case 'number': return 'number'
      case 'date': case 'datetime': return 'date'
      case 'checkbox': return 'bool'
      case 'multitext': case 'tags': case 'aliases': return 'list'
      default: return 'null'
    }
  }
  updateOperators(): OperatorItem[] {
    const items = operatorsFor(this.category())
    this.operatorEl.setItems(items)
    return items
  }
  private selectedOp(): OperatorItem | null {
    return this.operatorEl.selected as OperatorItem | null
  }
  private selectedFuncName(): string {
    const o = this.selectedOp()
    return o ? o.funcName || o.value : ''
  }
  private setOperator(name: string, inverse: boolean): void {
    name = name.toLowerCase()
    for (const it of this.operatorEl.getItems() as OperatorItem[]) {
      if (it.funcName) {
        if (name === it.funcName && inverse === !!it.inverse) return void this.operatorEl.setValue(it)
      } else if (name === it.value && !inverse) return void this.operatorEl.setValue(it)
    }
    throw new Error('Unsupported operator')
  }
  private reconcile(): void {
    if (this.advanced) {
      this.advancedContainerEl.show()
      this.operatorEl.buttonEl.hide()
      this.leftEl.buttonEl.hide()
      this.rhsEl.hide()
      if (!this.advancedEditor) {
        this.advancedEditor = new EditorView({
          parent: this.advancedHostEl,
          state: EditorState.create({
            doc: this.advancedValue,
            extensions: [
              EditorView.lineWrapping,
              cmPlaceholder(L('placeholderFilterAdvancedMode')),
              EditorView.domEventHandlers({ blur: () => this.update() }),
              EditorView.updateListener.of(u => {
                if (u.docChanged) this.advancedValue = u.state.doc.toString()
              })
            ]
          })
        })
      }
      this.advancedContainerEl.show()
      this.toggleBtn.empty()
      setIcon(this.toggleBtn, 'mouse-pointer-click')
      this.toggleBtn.setAttribute('aria-label', L('tooltipFilterSimpleMode'))
    } else {
      this.advancedContainerEl.hide()
      this.leftEl.buttonEl.show()
      this.advancedEditor?.destroy()
      this.advancedEditor = null
      this.rhsEl.show()
      this.operatorEl.buttonEl.show()
      this.toggleBtn.empty()
      setIcon(this.toggleBtn, 'code-xml')
      this.toggleBtn.setAttribute('aria-label', L('tooltipFilterAdvancedMode'))
    }
  }
  private rhsWidgetType(): string | null {
    const f = this.selectedFuncName()
    if (COMPARES.includes(f)) {
      const id = this.leftValue()
      return id ? this.editor.queryController.getWidgetForIdent(identFor(id)) : 'text'
    }
    const def = funcByLower(f)
    return def ? def.rhs : null
  }
  private renderRight(): void {
    const w = this.rhsWidgetType()
    if (!w) {
      this.rightWidget = null
      this.rightValue = null
      this.rhsEl.empty()
      return
    }
    if (this.rightWidget && this.rightValue != null && this.rightWidget.type === w) return void this.rightWidget.setValue(this.rightValue)
    this.rhsEl.empty()
    const id = this.leftValue()
    const sp = id ? splitPropertyId(id) : null
    const tm = this.editor.app.metadataTypeManager
    this.rightWidget = tm.getWidget(w).render(this.rhsEl, this.rightValue, {
      app: this.editor.app,
      blur: () => {},
      key: sp && sp.type === 'note' ? sp.name : '',
      hoverSource: 'bases',
      onChange: (v: any) => {
        this.rightValue = v
        this.update()
      },
      sourcePath: ''
    })
  }
  private setFieldValues(f: Formula | null): void {
    this.advanced = false
    if (!f) {
      this.rightValue = null
      this.operatorEl.setValue(null)
      this.leftEl.setValueById('file.file')
      const items = this.updateOperators()
      this.operatorEl.setValue(items[0] ?? null)
      this.renderRight()
      return this.reconcile()
    }
    let ok = false
    try {
      const d = deserialize(f.toString())
      this.leftEl.setValueById(d.left)
      this.rightValue = d.right
      this.updateOperators()
      this.setOperator(d.op, d.inverse)
      this.renderRight()
      ok = true
    } catch (e) {
      if (f.isInvalid) this.setErrorState(f.parseError ?? '')
    }
    if (!ok) {
      this.advanced = true
      this.setAdvancedValue(f.toString())
    }
    this.reconcile()
  }
  private setAdvancedValue(v: string): void {
    this.advancedValue = v
    const ed = this.advancedEditor
    if (ed) ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: v } })
  }
  private setErrorState(msg: string): void {
    if (msg) {
      this.containerEl.addClass('mod-error')
      this.toggleBtn.empty()
      setIcon(this.toggleBtn, 'lucide-circle-alert')
      this.errorEl.setText(msg)
      this.errorEl.show()
    } else {
      this.containerEl.removeClass('mod-error')
      this.errorEl.hide()
      if (this.advanced) {
        this.toggleBtn.empty()
        setIcon(this.toggleBtn, 'mouse-pointer-click')
      }
    }
  }
  update(): void {
    this.setErrorState('')
    let save = true
    if (!this.advanced && this.rightWidget && (this.rightValue === null || this.rightValue === '' || (Array.isArray(this.rightValue) && this.rightValue.length === 0 && false))) save = false
    if (!save) return
    const f = (this.parsed = new Formula(this.serialize()))
    if (f.isInvalid && this.advanced && (this.advancedEditor?.state.doc.length ?? 0) > 0) this.setErrorState(f.parseError ?? '')
    try {
      this.editor.save()
    } catch {
      /* ignore */
    }
  }
  serialize(): string {
    if (this.advanced) return this.advancedValue
    const left = this.leftValue()
    if (!left) return ''
    const op = this.selectedOp()
    if (!op) return ''
    const ident = identFor(left)
    const def = op.funcName ? funcByLower(op.funcName) : null
    if (def) {
      let r: string
      if (def.needsValue) {
        const v = this.rightValue
        if (v === '' || v == null) return ''
        if (!def.rhs) return ''
        const args = Array.isArray(v) ? v.map(quoteValue) : [quoteValue(v)]
        r = `${ident}.${def.name}(${args.join(', ')})`
      } else r = `${ident}.${def.name}()`
      return op.inverse ? '!' + r : r
    }
    return COMPARES.includes(op.value) ? `${ident} ${op.value} ${quoteValue(this.rightValue)}` : ''
  }
}

export function quoteValue(v: any): string {
  if (typeof v === 'string') {
    if (v.startsWith('[[') && v.endsWith(']]')) {
      const bar = v.indexOf('|')
      return bar !== -1 ? `link("${v.slice(2, bar)}", "${v.slice(bar + 1, -2)}")` : `link("${v.slice(2, -2)}")`
    }
    const parts = v.split('.', 2)
    return parts.length === 2 && ['note', 'formula', 'file', 'this'].includes(parts[1]) ? v : `"${v}"`
  }
  return Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v)
}

// ------------------------------------------------------------------ deserialising a formula into builder fields
interface Deser { left: string; op: string; right: any; inverse: boolean }
function lhsId(n: Node): string {
  if (n.type === 'object_access' && n.object.type === 'ident' && ['note', 'formula', 'file'].includes(n.object.value) && n.index.type === 'ident') return `${n.object.value}.${n.index.value}`
  if (n.type === 'array_access' && n.array.type === 'ident' && ['file', 'formula', 'note'].includes(n.array.value) && n.index.type === 'primitive') return `${n.array.value}.${String(n.index.value)}`
  if (n.type === 'ident') {
    if (['true', 'false', 'null', 'this'].includes(n.value)) throw new Error('Unsupported left-hand side of formula')
    return n.value.startsWith('note.') || n.value.startsWith('formula.') || n.value.startsWith('file.') ? n.value : n.value === 'file' ? 'file.file' : `note.${n.value}`
  }
  throw new Error('Formula cannot be deserialized')
}
function rhsValue(args: Node[]): any {
  if (args.length === 0) return ''
  const one = (r: Node): any => {
    if (r.type === 'call' && r.object.type === 'ident' && r.object.value === 'link' && r.args.length >= 1) {
      const a = r.args[0]
      const b = r.args[1]
      if (a.type === 'primitive') return b && b.type === 'primitive' ? `[[${a.value}|${b.value}]]` : `[[${a.value}]]`
    } else if (r.type === 'array') {
      return r.elements.map(e => {
        if (e.type !== 'primitive') throw new Error('Formula cannot be deserialized')
        return String(e.value)
      })
    } else if (r.type === 'primitive') return r.value
    throw new Error('Formula cannot be deserialized')
  }
  if (args.length !== 1) {
    return args.map(r => {
      if (r.type === 'primitive') return String(r.value)
      const v = one(r)
      return v
    })
  }
  return one(args[0])
}
function deserialize(text: string): Deser {
  let n: Node = parseExpression(text)
  let inverse = false
  if (n.type === 'not') {
    inverse = true
    n = n.expr
  }
  if (n.type === 'compare') {
    if (!COMPARES.includes(n.op) || inverse) throw new Error('Unsupported operator')
    return { left: lhsId(n.left), op: n.op, right: rhsValue([n.right]), inverse }
  }
  if (n.type === 'call' && n.object.type === 'object_access') {
    const name = n.object.index.type === 'ident' ? n.object.index.value : ''
    return { left: lhsId(n.object.object), op: name, right: rhsValue(n.args), inverse }
  }
  throw new Error('Formula cannot be deserialized')
}

// ------------------------------------------------------------------ toolbar item
function countFilters(f: FilterNode | undefined | null): number {
  return f ? (f instanceof GroupFilter ? f.filters.length : 1) : 0
}
function hasError(f: FilterNode | undefined | null): boolean {
  if (!f) return false
  if (f instanceof ExprFilter) return f.expr.isInvalid
  return (f as GroupFilter).filters.some(hasError)
}

export class FilterMenu {
  toolbarItem: ToolbarItem
  private globalFlair!: HTMLElement
  private localFlair!: HTMLElement
  private toolbarFlair: HTMLElement
  private globalEditor!: FilterEditor
  private viewEditor!: FilterEditor
  constructor(private c: QueryController, parent: HTMLElement) {
    const item = (this.toolbarItem = new ToolbarItem(c.app, parent, L('labelFilter'), 'lucide-list-filter'))
    item.addClass('bases-toolbar-filter-menu')
    this.toolbarFlair = item.button.buttonEl.createSpan({ cls: 'flair toolbar-badge' })
    this.toolbarFlair.hide()
    const section = (title: string, collapsed: boolean, setFlair: (el: HTMLElement) => void, setEditor: (e: FilterEditor) => void): void => {
      item.scrollEl.createDiv('bases-toolbar-section', sec => {
        let isCollapsed = collapsed
        const head = sec.createDiv('bases-toolbar-section-header', h => {
          const arrow = h.createDiv({ cls: 'tree-item-icon collapse-icon' + (collapsed ? ' is-collapsed' : '') })
          setIcon(arrow, 'right-triangle')
          h.createSpan({ text: title })
          setFlair(h.createSpan({ cls: 'flair' }))
        })
        const content = sec.createDiv('bases-toolbar-section-content')
        if (collapsed) content.hide()
        setEditor(new FilterEditor(c.app, content, c))
        head.addEventListener('click', e => {
          e.preventDefault()
          isCollapsed = !isCollapsed
          head.toggleClass('is-collapsed', isCollapsed)
          head.querySelector('.collapse-icon')?.toggleClass('is-collapsed', isCollapsed)
          content.toggle(!isCollapsed)
        })
        if (collapsed) head.addClass('is-collapsed')
      })
    }
    section(L('labelAllViews'), true, el => (this.globalFlair = el), e => (this.globalEditor = e))
    section(L('labelCurrentView'), false, el => (this.localFlair = el), e => (this.viewEditor = e))
  }
  updateQuery(query: any, view: any): void {
    this.globalEditor.updateQuery(v => query.setGlobalFilters(v), view, query.filters)
    this.viewEditor.updateQuery(v => query.setViewFilters(view.name, v), view, view.filters)
    const g = countFilters(query.filters)
    const l = countFilters(view.filters)
    const set = (el: HTMLElement, n: number): void => {
      el.setText(String(n))
      el.toggle(n > 0)
    }
    set(this.globalFlair, g)
    set(this.localFlair, l)
    set(this.toolbarFlair, l)
    const btn = this.toolbarItem.button.buttonEl
    btn.toggleClass('mod-error', hasError(query.filters) || hasError(view.filters))
    btn.toggleClass('is-active', l > 0)
  }
  setEnabled(e: boolean): void {
    this.toolbarItem.setEnabled(e)
  }
}

void joinPropertyId
