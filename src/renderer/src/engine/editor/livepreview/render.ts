// Rendering hooks used by the Live Preview block widgets.
//
// Callouts, table cells, embeds and code-block post-processors with the reading
// renderer (`MarkdownRenderer.render`). That renderer is built in `engine/markdown/`; until it is
// wired in (`setMarkdownRenderer`), a small fallback produces the same outer DOM for callouts and
// escaped text elsewhere.

export interface RenderComponent {
  addChild?(child: any): any
  removeChild?(child: any): any
}

export type MarkdownRenderFn = (el: HTMLElement, markdown: string, sourcePath: string, component?: RenderComponent) => Promise<void> | void

let renderer: MarkdownRenderFn | null = null
let codeBlockProcessors: () => Record<string, (source: string, el: HTMLElement, ctx: any) => any> = () => ({})
let embedLoader: ((el: HTMLElement, linktext: string, sourcePath: string) => void) | null = null

/** Plug in the reading renderer (`(el, md, path, comp) => MarkdownRenderer.render(app, md, el, path, comp)`). */
export function setMarkdownRenderer(fn: MarkdownRenderFn | null): void { renderer = fn }
/** Registered `registerMarkdownCodeBlockProcessor` handlers (language -> handler). */
export function setCodeBlockProcessorSource(fn: typeof codeBlockProcessors): void { codeBlockProcessors = fn }
export function getCodeBlockProcessors() { return codeBlockProcessors() }
/** Embed loader for `![[…]]` (linking/embeds area); fills `.internal-embed` containers. */
export function setEmbedLoader(fn: typeof embedLoader): void { embedLoader = fn }
export function loadEmbed(el: HTMLElement, linktext: string, sourcePath: string): boolean {
  if (!embedLoader) return false
  embedLoader(el, linktext, sourcePath)
  return true
}

/** Render `markdown` into `el` (reading-view DOM). */
export async function renderMarkdownInto(el: HTMLElement, markdown: string, sourcePath: string, component?: RenderComponent): Promise<void> {
  if (renderer) return renderer(el, markdown, sourcePath, component)
  fallbackRender(el, markdown)
}

/** True when the language has a renderer (mermaid, query, or a registered code-block processor). */
export function canRenderLang(lang: string): boolean {
  return lang === 'mermaid' || lang === 'query' || Object.prototype.hasOwnProperty.call(codeBlockProcessors(), lang)
}

// ---- fallback ----------------------------------------------------------------------------------

const CALLOUT_RE = /^>\s*\[!([^\]]*)\]([+-]?)\s?(.*)$/

/** Inline fallback: wikilinks become `a.internal-link`, everything else is text. */
function inline(parent: HTMLElement, text: string) {
  const re = /!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)))
    const a = document.createElement('a')
    a.setAttribute('data-href', m[1])
    a.setAttribute('href', m[1])
    a.className = 'internal-link'
    a.textContent = m[2] ?? m[1]
    parent.appendChild(a)
    last = m.index + m[0].length
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
}

function para(parent: HTMLElement, text: string) {
  const p = document.createElement('p')
  p.setAttribute('dir', 'auto')
  inline(p, text)
  parent.appendChild(p)
}

function fallbackRender(el: HTMLElement, markdown: string) {
  const lines = markdown.split('\n')
  const m = lines[0]?.match(CALLOUT_RE)
  if (m) {
    const type = m[1].trim().toLowerCase()
    const callout = document.createElement('div')
    callout.setAttribute('data-callout-metadata', '')
    callout.setAttribute('data-callout-fold', m[2])
    callout.setAttribute('data-callout', type)
    callout.className = 'callout' + (m[2] ? ' is-collapsible' + (m[2] === '-' ? ' is-collapsed' : '') : '')
    const title = callout.appendChild(document.createElement('div'))
    title.className = 'callout-title'
    title.setAttribute('dir', 'auto')
    const icon = title.appendChild(document.createElement('div'))
    icon.className = 'callout-icon'
    const inner = title.appendChild(document.createElement('div'))
    inner.className = 'callout-title-inner'
    inner.textContent = m[3] || type.charAt(0).toUpperCase() + type.slice(1)
    const body = lines.slice(1).map(l => l.replace(/^>\s?/, ''))
    if (body.some(l => l.trim())) {
      const content = callout.appendChild(document.createElement('div'))
      content.className = 'callout-content'
      for (const chunk of body.join('\n').split(/\n\s*\n/)) if (chunk.trim()) para(content, chunk)
    }
    el.appendChild(callout)
    return
  }
  for (const chunk of markdown.split(/\n\s*\n/)) if (chunk.trim()) para(el, chunk)
}
