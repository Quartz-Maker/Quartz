// Block Live Preview StateField.
//
// Walks the whole HyperMD token tree and produces:
//   - math widgets between `formatting-math-begin`/`-end` (block when `$$` sits alone on its lines;
//     a revealed block math is still shown below its source),
//   - internal embeds `![[…]]` and markdown images `![alt](url)` (images are atomic, always replaced),
//   - `is-unresolved` marks on unresolved `[[links]]`,
//   - callouts (`HyperMD-callout` + `HyperMD-quote-1` run, replaced unless touched),
//   - tables (always replaced unless a search match is inside),
//   - fenced code: rendered languages become a widget; other blocks get their fences hidden and a
//     language/copy flair at the end of the opening line,
//   - HTML blocks / inline HTML, and `---` rules.
// Rebuilds are skipped while composing / mouse-down / when the tree is not parsed far enough.
import { StateField, Prec } from '@codemirror/state'
import type { EditorState, Range, Transaction } from '@codemirror/state'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import { tokenClassProp, lineClassProp } from '../hypermd/streamLanguage'
import { getModeRegistry } from '../hypermd/registry.js'
import { getHost, hasFocus, isMouseDown, refreshLivePreview, rerenderLivePreview, searchTouches, selectionTouches, setSearchMatches } from './state'
import { HIDE, HIDE_END, hrWidget, unresolvedMark, CodeFlairWidget } from './widgets'
import { LIST_RE, isLocalUrl } from './inline'
import { canRenderLang } from './render'
import {
  EmbedWidget, MathWidget, HtmlWidget, CodeBlockWidget, CalloutWidget, ImageWidget, InternalEmbedWidget,
  HTML_EXCLUDED_TAGS, isInlineTag
} from './blockWidgets'
import { TableWidget, isCellEdit } from './table'

/** Fence regex: [1] fence, [2] language. */
export const FENCE_RE = /^\s*(~~~+|```+)[ \t]*([\w/+#-]*)[^\n`]*$/
const IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']

/** Remove and return the first element of `list` matching `pred`. */
function take<T>(list: T[], pred: (x: T) => boolean): T | null {
  for (let i = 0; i < list.length; i++) if (pred(list[i])) return list.splice(i, 1)[0]
  return null
}

/** Parse link text `target|alias` → href / title (link-text parser). */
export function parseLinktext(text: string): { href: string; title: string; isAlias: boolean } {
  let title = ''
  const bar = text.indexOf('|')
  const isAlias = bar > 0
  if (isAlias) { title = text.substring(bar + 1).trim(); text = text.substring(0, bar).trim() }
  else { text = text.trim(); title = text.split('#').filter(Boolean).join(' > ').trim() }
  if (text.endsWith('\\')) text = text.substring(0, text.length - 1)
  return { href: text.replace(/ /g, ' ').trim().normalize('NFC'), title, isAlias }
}

export function getLinkpath(href: string): string {
  const i = href.indexOf('#')
  return i === -1 ? href : href.substring(0, i)
}

/** First `---`…`---` frontmatter end offset, or -1. */
export function frontmatterEnd(state: EditorState): number {
  const doc = state.doc
  if (doc.line(1).text !== '---') return -1
  for (let n = 2; n <= doc.lines; n++) { const l = doc.line(n); if (l.text === '---') return l.to }
  return -1
}

interface Pools {
  embeds: EmbedWidget[]
  code: CodeBlockWidget[]
  callouts: CalloutWidget[]
  tables: TableWidget[]
  math: MathWidget[]
  html: HtmlWidget[]
  images: ImageWidget[]
}
const emptyPools = (): Pools => ({ embeds: [], code: [], callouts: [], tables: [], math: [], html: [], images: [] })

export interface BlockFieldValue { decorations: DecorationSet; pools: Pools }

function isImageEmbed(state: EditorState, w: EmbedWidget): boolean {
  if (w instanceof ImageWidget) return true
  if (w instanceof InternalEmbedWidget) {
    if (w.isImage) return true
    const app = getHost(state)?.app
    const file = app?.metadataCache?.getFirstLinkpathDest?.(w.href, w.sourcePath)
    return !!file && IMAGE_EXTENSIONS.includes(file.extension)
  }
  return false
}

function buildBlockDecorations(view: EditorView, tr: Transaction | null, state: EditorState, prev: Pools): BlockFieldValue {
  const doc = state.doc
  const tree = syntaxTree(state)
  const host = getHost(state)
  const path = host?.getPath() ?? ''
  const ranges = hasFocus(view) ? state.selection.ranges : []
  const touches = (from: number, to: number) => selectionTouches(ranges, from, to) || searchTouches(state, from, to)
  const replace = (spec: any, from: number, to: number) => {
    if (spec.block && to === doc.length) spec.inclusiveEnd = false
    return Decoration.replace(spec).range(from, to)
  }
  const old = {
    embeds: prev.embeds.slice(), code: prev.code.slice(), callouts: prev.callouts.slice(), tables: prev.tables.slice(),
    math: prev.math.slice(), html: prev.html.slice(), images: prev.images.slice()
  }
  if (tr && tr.effects.some(e => e.is(rerenderLivePreview))) old.code = []
  const pools = emptyPools()
  const out: Range<Decoration>[] = []
  const app = host?.app
  const isUnresolved = (linkpath: string) => host?.isUnresolved
    ? host.isUnresolved(linkpath, path)
    : app?.metadataCache ? app.metadataCache.isUnresolved(linkpath, path) : false

  let linkIsEmbed = false, linkFrom = -1, linkTextFrom = -1, linkTextTo = -1, linkText = ''
  let inImage = false, imageAlt = '', imageUrl = '', imageFrom = -1
  let mathFrom = -1, mathTextFrom = -1, mathBlock = false
  let codeFrom = -1, codeLang = ''
  let htmlFrom = -1, htmlTag = ''
  let calloutFrom = -1, calloutTo = -1
  let tableFrom = -1, tableTo = -1

  const internalEmbed = (linktext: string, from: number, to: number) => {
    const { href, title } = parseLinktext(linktext)
    let w = take(old.embeds, e => e instanceof InternalEmbedWidget && e.sourcePath === path && e.href === href) as InternalEmbedWidget | null
    if (w) { if (w.title !== title) w.applyTitle(title) }
    else {
      const file = app?.metadataCache?.getFirstLinkpathDest?.(getLinkpath(href), path)
      w = new InternalEmbedWidget(href, title, path, !!file && IMAGE_EXTENSIONS.includes(file.extension))
    }
    w.setPos(from, to)
    pools.embeds.push(w)
    return w
  }
  const place = (w: EmbedWidget, from: number, to: number) => {
    const line = doc.lineAt(from)
    const img = isImageEmbed(state, w)
    const fullLine = !img && from === line.from && line.text.slice(to - line.from).trim() === ''
    if (fullLine) {
      if (touches(line.from, line.to)) out.push(Decoration.widget({ widget: w, block: true, side: 1 }).range(line.to))
      else out.push(replace({ widget: w, block: true, side: 1 }, line.from, line.to))
    } else if (img || !touches(from, to)) {
      out.push(Decoration.replace({ widget: w, side: 1, isImageEmbed: img || undefined } as any).range(from, to))
    } else out.push(Decoration.widget({ widget: w, side: 1 }).range(to))
  }
  const closeCallout = (pos: number) => {
    if (calloutFrom !== -1 && calloutTo < pos) {
      const text = doc.sliceString(calloutFrom, calloutTo)
      let w = take(old.callouts, c => c.text === text)
      if (!touches(calloutFrom, calloutTo)) {
        if (!w) w = new CalloutWidget(text, path, { rtl: !!app?.vault?.getConfig?.('rightToLeft'), indentGuide: app?.vault?.getConfig?.('showIndentGuide') ?? true })
        out.push(replace({ widget: w, side: 1, block: true }, calloutFrom, calloutTo))
      }
      if (w) { w.setPos(calloutFrom, calloutTo); pools.callouts.push(w) }
      calloutFrom = calloutTo = -1
    }
  }
  const closeTable = (pos: number) => {
    if (tableFrom !== -1 && tableTo < pos) {
      const text = doc.sliceString(tableFrom, tableTo)
      const mapped = (t: TableWidget) => (tr && tr.docChanged ? tr.changes.mapPos(t.start) : t.start)
      let w = take(old.tables, t => mapped(t) === tableFrom && (t.text === text || t.editing)) || take(old.tables, t => t.text === text)
      if (w && w.text !== text) w.receiveUpdate(text, !!tr && isCellEdit(tr))
      if (!(searchTouches(state, tableFrom, tableTo))) {
        if (!w) w = new TableWidget(text, path)
        out.push(replace({ widget: w, side: 1, block: true }, tableFrom, tableTo))
      }
      if (w) { w.setPos(tableFrom, tableTo); pools.tables.push(w) }
      tableFrom = tableTo = -1
    }
  }

  tree.iterate({
    enter: node => {
      const from = node.from, to = node.to
      const cls = node.type.prop(tokenClassProp)
      if (cls) { closeCallout(from); closeTable(from) }
      if (cls && calloutFrom === -1 && tableFrom === -1) {
        const has = new Set(cls.split(' '))
        if (has.has('hmd-codeblock')) { /* code content */ }
        else if (has.has('formatting-math-begin')) { mathFrom = from; mathTextFrom = to; mathBlock = has.has('math-block') }
        else if (mathFrom !== -1) {
          if (has.has('formatting-math-end')) {
            const end = to
            const math = doc.sliceString(mathTextFrom, from)
            let block = mathBlock
            let w = take(old.math, m => m.math === math && m.block === block)
            if (!w) w = new MathWidget(math, block)
            pools.math.push(w)
            w.setPos(block && math.startsWith('\n') ? mathTextFrom + 1 : mathTextFrom, block && math.endsWith('\n') ? from - 1 : from)
            if (block) {
              const a = doc.lineAt(mathFrom), b = doc.lineAt(end)
              block = a.text.substr(0, mathFrom - a.from).trim() === '' && b.text.substr(end - b.from).trim() === ''
            }
            if (touches(mathFrom, end)) { if (mathBlock) out.push(Decoration.widget({ widget: w, block, side: 1 }).range(end)) }
            else out.push(replace({ widget: w, block, side: 1 }, mathFrom, end))
            mathFrom = mathTextFrom = -1
          }
        } else if (has.has('formatting-link-start')) {
          linkIsEmbed = has.has('formatting-embed'); linkFrom = from; linkTextFrom = to
        } else if (linkFrom > -1) {
          if (has.has('hmd-internal-link')) { linkText += doc.sliceString(from, to); linkTextTo = to }
          else {
            if (has.has('formatting-link-end') && linkText) {
              if (linkIsEmbed) place(internalEmbed(linkText, linkFrom, to), linkFrom, to)
              else if (isUnresolved(getLinkpath(parseLinktext(linkText).href))) out.push(unresolvedMark.range(linkTextFrom, linkTextTo))
            }
            linkText = ''
            linkFrom = -1
          }
        } else if (has.has('image-marker')) { inImage = true; imageFrom = from }
        else if (inImage) {
          if (has.has('image-alt-text') && !has.has('formatting')) imageAlt = doc.sliceString(from, to)
          else if (has.has('url') && !has.has('formatting')) imageUrl = doc.sliceString(from, to)
          else if (has.has('image') || (has.has('url') && !imageUrl)) { /* inside */ }
          else {
            if (has.has('url') && imageUrl) markdownImage(imageFrom, to, imageUrl, imageAlt)
            inImage = false; imageUrl = ''; imageAlt = ''; imageFrom = -1
          }
        } else if (has.has('hmd-html-begin')) htmlFrom = from
        else if (htmlFrom > -1 && !htmlTag && has.has('tag')) htmlTag = doc.sliceString(from, to)
        else if (has.has('hmd-html-end') && htmlTag && !HTML_EXCLUDED_TAGS.includes(htmlTag)) {
          let hFrom = htmlFrom, hTo = to
          const html = doc.sliceString(htmlFrom, hTo)
          const a = doc.lineAt(htmlFrom), b = doc.lineAt(hTo)
          const block = !isInlineTag(htmlTag)
          if (!doc.sliceString(a.from, htmlFrom).trim() && !doc.sliceString(hTo, b.to).trim()) { hFrom = a.from; hTo = b.to }
          if (!touches(hFrom, hTo)) {
            let w = take(old.html, h => h.html === html && h.block === block)
            if (!w) w = new HtmlWidget(html, block, el => app?.fixFileLinks?.(el, path))
            pools.html.push(w)
            w.setPos(hFrom, hTo)
            out.push(replace({ widget: w, block, side: 1 }, hFrom, hTo))
          }
          htmlFrom = -1; htmlTag = ''
        } else if (has.has('hr')) {
          if (!touches(from, to)) out.push(replace({ widget: hrWidget, block: true }, from, to))
        }
      }
      const lineCls = node.type.prop(lineClassProp)
      if (lineCls) {
        const has = new Set(lineCls.split(' '))
        if (has.has('HyperMD-callout') && has.has('HyperMD-quote-1')) { closeCallout(from); calloutFrom = from; calloutTo = to }
        if (has.has('HyperMD-quote') && calloutFrom !== -1) { if (from - calloutTo > 1) closeCallout(from); else calloutTo = to }
        if (has.has('HyperMD-table-row')) {
          closeCallout(from)
          if (from - tableTo > 1) closeTable(from)
          if (tableFrom === -1) tableFrom = from
          tableTo = to
        }
        if (has.has('HyperMD-codeblock-begin') && codeFrom === -1) {
          const line = doc.lineAt(from)
          codeFrom = from
          codeLang = ''
          let text = line.text
          if (has.has('HyperMD-list-line')) {
            const m = line.text.match(LIST_RE)
            if (m) { codeFrom = line.from + m[0].length; text = text.slice(m[0].length) }
          }
          const fm = text.match(FENCE_RE)
          if (fm) codeLang = fm[2]
        }
        if (has.has('HyperMD-codeblock-end') && codeFrom !== -1) {
          const start = codeFrom
          codeFrom = -1
          if (touches(start, to)) return
          const endLine = doc.lineAt(from)
          if (endLine.number <= 1) return
          const beginLine = doc.lineAt(start)
          if (beginLine.number >= doc.lines) return
          const codeStart = doc.line(beginLine.number + 1).from
          let codeEnd = doc.line(endLine.number - 1).to
          if (codeEnd < codeStart) codeEnd = codeStart
          const code = doc.sliceString(codeStart, codeEnd)
          if (canRenderLang(codeLang)) {
            let w = take(old.code, c => c.lang === codeLang && c.code === code)
            if (!w) w = new CodeBlockWidget(codeLang, code, path)
            w.setPos(codeStart, codeEnd)
            w.lineStart = beginLine.number - 1
            w.lineEnd = endLine.number - 1
            pools.code.push(w)
            out.push(replace({ widget: w, block: true }, start, to))
          } else {
            let label = codeLang
            try {
              const info = getModeRegistry().findModeByName?.(label)
              if (info && info.name !== 'null') label = info.name
            } catch { /* unknown */ }
            out.push(HIDE.range(start, beginLine.to))
            out.push(Decoration.widget({ widget: new CodeFlairWidget(label, code) }).range(beginLine.to))
            out.push(HIDE_END.range(endLine.from, endLine.to))
          }
        }
        closeCallout(from)
        closeTable(from)
      }
    }
  })
  closeCallout(doc.length + 1)
  closeTable(doc.length + 1)

  function markdownImage(from: number, to: number, url: string, alt: string) {
    url = url.trim()
    if (url.startsWith('<')) { const i = url.indexOf('>'); if (i !== -1) url = url.substring(1, i) }
    else { const ws = /\s/.exec(url); if (ws) url = url.substring(0, ws.index) }
    let w: EmbedWidget
    if (isLocalUrl(url)) {
      let decoded: string
      try { decoded = decodeURI(url) } catch { return }
      w = internalEmbed(decoded.replace(/ | /g, ' ').trim() + '|' + alt, from, to)
    } else {
      try { url = new URL(url).toString() } catch { try { url = encodeURI(decodeURI(url)) } catch { url = '' } }
      const resPrefix = (app?.vault?.adapter as any)?.resourcePathPrefix
      if (resPrefix && url.startsWith('file:///')) url = resPrefix + url.substr(8)
      let img = take(old.images, i => i.url === url)
      if (img) { if (img.title !== alt) img.applyTitle(alt) }
      else img = new ImageWidget(url, alt)
      pools.images.push(img)
      img.setPos(from, to)
      w = img
    }
    place(w, from, to)
  }

  return { decorations: Decoration.set(out, true), pools }
}

/** The block field for `view` (it needs the view for focus and widget callbacks). */
export function blockLivePreviewField(view: () => EditorView | null) {
  let building = false
  return StateField.define<BlockFieldValue>({
    create: () => ({ decorations: Decoration.none, pools: emptyPools() }),
    update(value, tr) {
      const v = view()
      if (!v) return { ...value, decorations: value.decorations.map(tr.changes) }
      let rebuild = !!ensureSyntaxTree(tr.state, v.viewport.to + 2000, 20)
      if (tr.effects.some(e => e.is(refreshLivePreview) || e.is(rerenderLivePreview) || e.is(setSearchMatches))) rebuild = true
      if (v.composing || building || isMouseDown(v)) rebuild = false
      if (rebuild) {
        building = true
        let next: BlockFieldValue
        try { next = buildBlockDecorations(v, tr, tr.state, value.pools) } finally { building = false }
        if (next.pools.tables.length && !tr.docChanged && tr.selection) {
          const focused = hasFocus(v)
          v.dom.ownerDocument.defaultView!.setTimeout(() => {
            for (const t of next.pools.tables) t.receiveSelection(v.state.selection.ranges, focused && hasFocus(v))
          })
        }
        return next
      }
      const decorations = value.decorations.map(tr.changes)
      if (tr.docChanged) {
        for (const t of value.pools.tables) {
          if (tr.changes.length < t.start || tr.changes.length < t.end) continue
          t.setPos(tr.changes.mapPos(t.start), tr.changes.mapPos(t.end))
        }
      }
      return { ...value, decorations }
    },
    provide: f => EditorView.decorations.from(f, v => v.decorations)
  })
}

/** Atomic ranges for image embeds (the caret steps over them). */
export function imageAtomicRanges(field: StateField<BlockFieldValue>) {
  let lastSet: DecorationSet | null = null
  let lastAtomic: DecorationSet = Decoration.none
  return EditorView.atomicRanges.of(view => {
    const v = view.state.field(field, false)
    if (!v) return Decoration.none
    if (v.decorations === lastSet) return lastAtomic
    const ranges: Range<Decoration>[] = []
    v.decorations.between(0, view.state.doc.length, (from, to, d) => { if ((d.spec as any).isImageEmbed) ranges.push(d.range(from, to)) })
    lastSet = v.decorations
    lastAtomic = Decoration.set(ranges)
    return lastAtomic
  })
}

/**
 * ArrowUp / ArrowDown step into block widgets one source line at a time (revealing the widget's
 * source and moving through it) instead of CodeMirror's default jump over the replaced block.
 */
export function blockStepKeymap(field: StateField<BlockFieldValue>) {
  const step = (forward: boolean, select: boolean) => (view: EditorView): boolean => {
    const v = view.state.field(field, false)
    const sel = view.state.selection
    if (!v || sel.ranges.length !== 1) return false
    const doc = view.state.doc
    const r = sel.main
    const head = doc.lineAt(r.head)
    const adjNo = head.number + (forward ? 1 : -1)
    if (adjNo < 1 || adjNo > doc.lines) return false
    const adj = doc.line(adjNo)
    let inBlock = false
    v.decorations.between(adj.from, adj.from, (from, to, d) => {
      const spec = d.spec as any
      if (spec.block && !spec.isImageEmbed && to > from && from <= adj.from && to >= adj.from) inBlock = true
    })
    if (!inBlock) return false
    const target = adj.from + Math.min(r.head - head.from, adj.length)
    view.dispatch({ selection: { anchor: select ? r.anchor : target, head: target }, scrollIntoView: true, userEvent: 'select' })
    return true
  }
  return Prec.high(keymap.of([
    { key: 'ArrowDown', run: step(true, false), shift: step(true, true) },
    { key: 'ArrowUp', run: step(false, false), shift: step(false, true) }
  ]))
}
