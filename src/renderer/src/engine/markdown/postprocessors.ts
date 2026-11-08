/* eslint-disable @typescript-eslint/no-explicit-any */
// Built-in reading-view post-processors and recyclers, registered in this order:
// frontmatter, footnote ids, copy button, MathJax, images, callouts,
// tables, dir=auto, mermaid (trust gate), file links, Prism (sortOrder 100).
// Relies on the DOM helpers (core/enhance.ts) being installed.
import { MarkdownPreviewRenderer as R, getCodeText, codeTextCache, type MarkdownSection } from './MarkdownPreviewRenderer'
import { setIcon } from './icons'
import { prismLib } from './prism'
import { mathjaxLib, refreshMathJaxStylesheet } from './mathjax'
import { getMarkdownHost, triggerPostProcessorChange } from './host'
import { sanitizeHTMLToDom } from './sanitize'
import { isInternalUrl } from './pipeline'
import { normalizeLinkPath } from './parser'

let installed = false

// --- helpers -----------------------------------------------------------------

const STRONG_DIR =
  /(?:([‏\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Syriac}\p{sc=Thaana}])|([‎\p{sc=Armenian}\p{sc=Bengali}\p{sc=Bopomofo}\p{sc=Braille}\p{sc=Buhid}\p{sc=Canadian_Aboriginal}\p{sc=Cherokee}\p{sc=Cyrillic}\p{sc=Devanagari}\p{sc=Ethiopic}\p{sc=Georgian}\p{sc=Greek}\p{sc=Gujarati}\p{sc=Gurmukhi}\p{sc=Han}\p{sc=Hangul}\p{sc=Hanunoo}\p{sc=Hiragana}\p{sc=Kannada}\p{sc=Katakana}\p{sc=Khmer}\p{sc=Lao}\p{sc=Latin}\p{sc=Limbu}\p{sc=Malayalam}\p{sc=Mongolian}\p{sc=Myanmar}\p{sc=Ogham}\p{sc=Oriya}\p{sc=Runic}\p{sc=Sinhala}\p{sc=Tagalog}\p{sc=Tagbanwa}\p{sc=Tamil}\p{sc=Telugu}\p{sc=Thai}\p{sc=Tibetan}\p{sc=Yi}]))/u

/** First strong direction of a string: rtl / ltr / auto. */
export function textDirection(s: string): 'rtl' | 'ltr' | 'auto' {
  const m = s.match(STRONG_DIR)
  if (m) {
    if (m[1]) return 'rtl'
    if (m[2]) return 'ltr'
  }
  return 'auto'
}
/** Direction of an element from its first text node with a strong character. */
export function elementDirection(el: Element): 'rtl' | 'ltr' | 'auto' {
  const it = el.ownerDocument.createNodeIterator(el, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = it.nextNode())) {
    const d = textDirection(n.nodeValue || '')
    if (d !== 'auto') return d
  }
  return 'auto'
}

const YOUTUBE =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/(?:[\w-]+\?(?:.*?&)*v=|embed\/|v\/)?)([\w-]+)(?:\??&?(?:t|start)=([0-9]+))?(?:\S+)?$/
const TWITTER = /^(?:https?:\/\/)?(?:mobile\.)?(?:twitter|x)\.com\/.+\/(\d+)/

/** YouTube / X URLs used as images become embeds; returns the iframe URL or null. */
export function externalEmbedUrl(src: string): string | null {
  if (!src || typeof src !== 'string') return null
  let m = src.match(YOUTUBE)
  if (m) {
    // Quartz embeds YouTube directly (the main process supplies the Referer YouTube requires).
    let url = 'https://www.youtube-nocookie.com/embed/' + m[1]
    if (m[2]) url += '?start=' + m[2]
    return url
  }
  m = src.match(TWITTER)
  if (m) {
    const dark = document.body.classList.contains('theme-dark')
    return `https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=${dark ? 'dark' : 'light'}&id=${m[1]}`
  }
  return null
}

export function createExternalEmbed(url: string): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.className = 'external-embed mod-receives-events'
  f.setAttribute('sandbox', 'allow-forms allow-presentation allow-same-origin allow-popups-to-escape-sandbox allow-scripts allow-modals allow-popups')
  f.setAttribute('allow', 'fullscreen')
  f.setAttribute('frameborder', '0')
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  f.src = url
  if (url.includes('platform.twitter.com')) {
    f.setAttribute('scrolling', 'no')
    ;(f as any).onWindowMigrated?.(() => {})
    window.addEventListener('message', (e) => {
      if (e.source !== f.contentWindow) return
      const d = (e.data as any)?.['twttr.embed']
      if (d && d.method === 'twttr.private.resize') {
        const h = d.params?.[0]?.height
        if (typeof h === 'number') f.style.height = String(Math.min(1000, h)) + 'px'
      }
    })
  }
  return f
}

/** Collapse/expand a callout body (non-animated: hide/show). */
function setBodyCollapsed(el: HTMLElement, collapsed: boolean, animate: boolean): void {
  void animate
  if (collapsed) (el as any).hide()
  else (el as any).show()
}

/** `--callout-icon` value → icon (lucide id, or quoted/inline `<svg>`). */
export function applyCalloutIcon(iconEl: HTMLElement, value: string): void {
  if (value.startsWith("'") && value.endsWith("'")) value = value.substring(1, value.length - 1).replace(/\\'/g, "'")
  else if (value.startsWith('"')) {
    try {
      const v = JSON.parse(value)
      if (typeof v === 'string') value = v
    } catch {
      /* keep */
    }
  }
  if (value.startsWith('<svg')) {
    const svg = sanitizeHTMLToDom(value, iconEl.ownerDocument).firstChild as Element | null
    if (svg && svg.nodeName.toLowerCase() === 'svg') {
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('fill', 'currentColor')
      svg.setAttribute('stroke', 'currentColor')
      iconEl.textContent = ''
      iconEl.appendChild(svg)
    }
  } else setIcon(iconEl, value)
}

function setupCallout(callout: HTMLElement): void {
  const fold = callout.getAttribute('data-callout-fold')
  if (fold === '+' || fold === '-') {
    callout.classList.add('is-collapsible')
    const title = callout.querySelector('.callout-title') as HTMLElement | null
    const content = callout.querySelector('.callout-content') as HTMLElement | null
    if (title && content && !title.querySelector('.callout-fold')) {
      let collapsed = false
      const set = (c: boolean, animate: boolean) => {
        collapsed = c
        callout.classList.toggle('is-collapsed', collapsed)
        foldEl.classList.toggle('is-collapsed', collapsed)
        setBodyCollapsed(content, collapsed, animate)
      }
      const toggle = () => set(!collapsed, true)
      const foldEl = document.createElement('div')
      foldEl.className = 'callout-fold'
      title.appendChild(foldEl)
      foldEl.addEventListener('mousedown', (e) => e.preventDefault())
      foldEl.addEventListener('click', (e) => {
        if (e.button === 0) {
          e.preventDefault()
          toggle()
        }
      })
      setIcon(foldEl, 'lucide-chevron-down')
      title.addEventListener('mousedown', (e) => {
        if (e.detail > 1) e.preventDefault()
      })
      title.addEventListener('click', (e) => {
        setTimeout(() => {
          if (e.button === 0 && !e.defaultPrevented) {
            e.preventDefault()
            toggle()
          }
        }, 0)
      })
      if (fold === '-') set(true, false)
    }
  }
  const icon = callout.querySelector('.callout-icon') as HTMLElement | null
  if (!icon || icon.firstChild) return
  let value = callout.getAttribute('data-callout-icon') || ''
  if (!value) value = (callout as any).getCssPropertyValue('--callout-icon')
  if (value) {
    applyCalloutIcon(icon, value)
    return
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  icon.appendChild(svg)
  if (!(callout as any).isShown()) {
    ;(callout as any).onNodeInserted(() => {
      const v = (callout as any).getCssPropertyValue('--callout-icon')
      if (v) applyCalloutIcon(icon, v)
    }, true)
  }
}

// --- mermaid -------------------------------------------------------------------

const MERMAID_TRUST_KEY = 'mermaid-vault-trust'
let mermaidPromise: Promise<any> | null = null
function loadMermaid(): Promise<any> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m: any) => {
      const mermaid = m.default || m
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        themeVariables: { fontFamily: 'var(--font-mermaid)' },
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
        gantt: { useMaxWidth: true, axisFormatter: [['%Y-%m-%d', (d: Date) => d.getDay() === 1]] },
        journey: { useMaxWidth: true },
        class: { useMaxWidth: true },
        git: { useMaxWidth: false },
        state: { useMaxWidth: true },
        er: { useMaxWidth: false },
        pie: { useMaxWidth: true }
      })
      return mermaid
    })
  }
  return mermaidPromise
}
function randomId(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
async function renderMermaid(container: HTMLElement, code: HTMLElement): Promise<void> {
  const mermaid = await loadMermaid()
  const source = getCodeText(code)
  const pre = code.parentElement!
  const doc = code.ownerDocument
  let width = pre.clientWidth
  if (width === 0) width = container.clientWidth
  if (width === 0) width = window.innerWidth
  const id = 'm' + randomId(16)
  const tmp = document.body.createDiv('mermaid')
  try {
    tmp.style.width = width + 'px'
    tmp.style.visibility = 'hidden'
    tmp.style.position = 'absolute'
    const { svg } = await mermaid.render(id, source, tmp)
    tmp.remove()
    const out = createDiv('mermaid')
    out.innerHTML = svg
    pre.replaceWith(out)
    codeTextCache.set(out, source)
    for (const div of out.findAll('[*|class*="internal-link"] > g.label foreignObject > div')) {
      const text = div.textContent
      if (text) {
        div.empty()
        div.createEl('a', { cls: 'internal-link', href: text, text })
      }
    }
    const stack: Node[] = [out]
    while (stack.length > 0) {
      const n = stack.pop()!
      stack.push(...Array.from(n.childNodes))
      if (n instanceof SVGAElement && n.href && !n.href.baseVal) n.href.baseVal = n.getAttribute('href') || ''
    }
    const style = out.find('style')
    if (style) {
      let css = style.innerHTML
      const orig = css
      for (const marker of out.findAll('marker')) {
        const mid = marker.id
        if (!mid) continue
        const nid = id + '-' + mid
        marker.id = nid
        for (const attr of ['marker-start', 'marker-end']) {
          for (const el of out.findAll(`[${attr}="url(#${mid})"]`)) el.setAttr(attr, `url(#${nid})`)
        }
        css = css.replace(new RegExp('#' + escapeRegExp(mid) + '(?!\\w|-)', 'g'), '#' + nid)
      }
      if (css !== orig) style.innerHTML = css
    }
  } catch (err: any) {
    doc.getElementById('d' + id)?.remove()
    tmp.remove()
    console.error(err)
    code.empty()
    code.appendText('Error parsing Mermaid diagram!\n\n' + (err?.str || err?.message))
  }
}
function renderMermaidAll(container: HTMLElement, codes: HTMLElement[]): Promise<void> {
  const ps: Promise<void>[] = []
  for (const c of codes) {
    if ((c as any).isShown() || (container as any).isShown()) ps.push(renderMermaid(container, c))
    else (c as any).onNodeInserted(() => renderMermaid(container, c), true)
  }
  return Promise.all(ps).then(() => undefined)
}
function isMermaidTrusted(): boolean {
  return getMarkdownHost().loadLocalStorage(MERMAID_TRUST_KEY) === true
}
export function setMermaidTrusted(v: boolean): void {
  getMarkdownHost().saveLocalStorage(MERMAID_TRUST_KEY, v || null)
  triggerPostProcessorChange()
}
function mermaidGuard(el: HTMLElement, source: string): void {
  if (isMermaidTrusted()) {
    const pre = el.createEl('pre')
    const code = pre.createEl('code', 'language-mermaid')
    code.setText(source)
    void renderMermaidAll(el, [code])
    return
  }
  const wrap = el.createDiv('mermaid-wrapper is-guarded')
  const header = wrap.createDiv('mermaid-guard-header')
  header.createDiv('mermaid-guard-text', (t: HTMLElement) => {
    t.createDiv({ cls: 'mermaid-guard-title', text: 'Display Mermaid diagrams in this vault?' })
    t.createDiv({ cls: 'mermaid-guard-description', text: "Only allow if you trust this vault's contents." })
  })
  header.createDiv('mermaid-guard-actions', (a: HTMLElement) => {
    a.createEl('button', { text: 'Allow' }, (b: HTMLElement) => {
      b.addEventListener('click', () => setMermaidTrusted(true))
    })
  })
  wrap.createDiv('mermaid-guard-source').createEl('pre').createEl('code', 'language-mermaid').setText(source)
}

/** Live Preview: a rendered ```mermaid block behind the same per-vault trust gate as reading view. */
export function renderMermaidBlock(el: HTMLElement, source: string): void {
  el.empty()
  mermaidGuard(el, source)
}

// --- registration ------------------------------------------------------------

/** Register the built-in post-processors and recyclers once. */
export function installBuiltinPostProcessors(): void {
  if (installed) return
  installed = true

  // 1. frontmatter: hidden, its section marked mod-frontmatter mod-ui
  R.registerPostProcessor((el) => {
    const fm = el.find('.frontmatter')
    fm?.hide()
    fm?.parentElement?.addClass('mod-frontmatter', 'mod-ui')
  })

  // 2. footnote ids get the document id
  R.registerPostProcessor((el, ctx) => {
    for (const n of el.findAll('[data-footnote-id]')) {
      const id = n.getAttr('data-footnote-id')
      n.setAttr('data-footnote-id', id + '-' + ctx.docId)
      n.id = id + '-' + ctx.docId
    }
    for (const a of el.findAll('a.footnote-link')) {
      a.setAttr('href', a.getAttr('href') + '-' + ctx.docId)
    }
  })

  // recycler: mermaid diagrams with identical source
  R.registerRecycler((el, recycled) => {
    for (const code of el.findAll('code.language-mermaid')) {
      const src = getCodeText(code)
      const found = findInSections(recycled, '.mermaid', (m) => getCodeText(m) === src)
      if (found) {
        found.detach()
        code.parentElement!.replaceWith(found)
      }
    }
  })

  // 3. copy button on every pre > code
  R.registerPostProcessor((el) => {
    for (const code of el.findAll('pre > code')) {
      const pre = code.parentElement
      if (!pre) continue
      if (pre.findAll('.copy-code-button').length > 0) continue
      const text = getCodeText(code)
      const btn = pre.createEl('button', { cls: 'copy-code-button' })
      setIcon(btn, 'lucide-copy')
      btn.onClickEvent(async (evt: MouseEvent) => {
        evt.preventDefault()
        await navigator.clipboard.writeText(text)
        setIcon(btn, 'lucide-check')
        btn.setCssStyles({ color: 'var(--text-success)', display: 'inline-flex' })
        window.setTimeout(() => {
          setIcon(btn, 'lucide-copy')
          btn.setCssStyles({ color: '', display: '' })
        }, 1000)
      })
    }
  })

  // 4. Prism syntax highlighting (sortOrder 100)
  R.registerPostProcessor((el) => {
    const codes = el.findAll('code[class*="language-"]:not(.is-loaded)')
    if (codes.length === 0) return
    return prismLib.then((Prism) => {
      for (const code of codes) {
        getCodeText(code)
        Prism.highlightElement(code)
        code.parentElement?.removeAttribute('tabindex')
        code.addClass('is-loaded')
      }
    })
  }, 100)

  const langOf = (el: Element) => el.className.split(' ').filter((c) => c.startsWith('language-'))[0]
  R.registerRecycler((el, recycled) => {
    for (const code of el.findAll('code[class*="language-"]:not(.is-loaded)')) {
      const src = getCodeText(code)
      const lang = langOf(code)
      const found = findInSections(recycled, 'code[class*="language-"].is-loaded', (c) => codeTextCache.get(c) === src && langOf(c) === lang)
      if (found) {
        found.detach()
        code.replaceWith(found)
      }
    }
  })

  // 5. MathJax
  const mathSource = new WeakMap<Element, string>()
  R.registerPostProcessor((el) => {
    const nodes = el.findAll('.math:not(.is-loaded)')
    if (nodes.length === 0) return
    return mathjaxLib.then((mj) => {
      if (!mj) return
      for (const n of nodes) {
        const src = decodeHtmlEntities(n.innerHTML)
        n.empty()
        try {
          n.appendChild(mj.tex2chtml(src, { display: n.classList.contains('math-block') }))
        } catch {
          n.appendText(src)
        }
        n.addClass('is-loaded')
        mathSource.set(n, src)
      }
      return refreshMathJaxStylesheet()
    })
  })
  R.registerRecycler((el, recycled) => {
    for (const n of el.findAll('.math:not(.is-loaded)')) {
      const src = decodeHtmlEntities(n.innerHTML)
      const block = n.classList.contains('math-block')
      const found = findInSections(recycled, '.math.is-loaded', (m) => mathSource.get(m) === src && m.classList.contains('math-block') === block)
      if (found) {
        found.detach()
        n.replaceWith(found)
      }
    }
  })

  // recycler: loaded embeds with identical src/width/height/alt
  R.registerRecycler((el, recycled) => {
    for (const span of el.findAll('.internal-embed:not(.is-loaded)')) {
      const found = findInSections(recycled, '.internal-embed.is-loaded', (e) =>
        ['src', 'width', 'height', 'alt'].every((a) => e.getAttr(a) === span.getAttr(a))
      )
      if (found) {
        found.detach()
        span.replaceWith(found)
      }
    }
  })

  // 6. images: no-referrer; YouTube / X image URLs become iframes
  R.registerPostProcessor((el) => {
    const imgs = el.findAll('img') as HTMLImageElement[]
    if (imgs.length === 0) return
    const waits: Promise<unknown>[] = []
    for (const img of imgs) {
      const embed = externalEmbedUrl(img.src)
      if (embed) {
        img.replaceWith(createExternalEmbed(embed))
        continue
      }
      img.setAttribute('referrerpolicy', 'no-referrer')
      if (!img.complete) {
        waits.push(
          new Promise((r) => {
            img.addEventListener('load', r)
            img.addEventListener('error', r)
          })
        )
      }
    }
    return Promise.all(waits)
  })
  R.registerRecycler((el, recycled) => {
    for (const img of el.findAll('img') as HTMLImageElement[]) {
      const src = img.src
      const found = findInSections(recycled, 'img', (e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).src === src) as HTMLImageElement | null
      if (found) {
        found.setAttr('width', img.getAttr('width'))
        found.setAttr('height', img.getAttr('height'))
        found.setAttr('alt', img.getAttr('alt'))
        found.detach()
        img.replaceWith(found)
      }
    }
  })

  // 7. callouts: fold behaviour + icon
  R.registerPostProcessor((el) => {
    for (const c of el.findAll('.callout')) setupCallout(c)
  })

  // 8. tables that are the sole child: horizontal scroll + per-cell direction
  R.registerPostProcessor((el) => {
    for (const table of el.findAll('table')) {
      const parent = table.parentNode as HTMLElement | null
      if (!parent || parent.nodeType !== 1 || table !== parent.firstChild || table !== parent.lastChild) continue
      parent.style.overflowX = 'auto'
      const cells = table.findAll('th, td')
      for (let i = 0; i < cells.length; i++) {
        const d = elementDirection(cells[i])
        cells[i].dir = d
        if (i === 0) parent.dir = d
      }
    }
  })

  // 9. dir="auto"
  R.registerPostProcessor((el) => {
    for (const n of el.findAll('h1, h2, h3, h4, h5, h6, blockquote, .callout-title')) n.dir = 'auto'
    for (const n of el.findAll('li, p')) if (!n.parentElement!.dir) n.dir = 'auto'
  })

  // 10. mermaid behind the vault trust gate
  R.registerPostProcessor((el, ctx) => {
    const codes = el.findAll('code.language-mermaid')
    if (codes.length === 0) return
    if (isMermaidTrusted()) return renderMermaidAll(ctx.containerEl, codes)
    for (const code of codes) {
      const pre = code.parentElement
      if (!pre) continue
      const src = getCodeText(code)
      const div = createDiv()
      pre.replaceWith(div)
      mermaidGuard(div, src)
    }
  })

  // 11. desktop: vault-relative media src in raw HTML resolves through the link resolver
  R.registerPostProcessor((el, ctx) => fixFileLinks(el, ctx.sourcePath))
}

export function fixFileLinks(el: HTMLElement, sourcePath: string): void {
  const host = getMarkdownHost()
  for (const n of el.findAll('img, audio, video, source, iframe')) {
    let src = n.getAttr('src')
    if (!src) continue
    if (src.startsWith('file:///')) (n as any).src = host.getResourcePath('file:///' + src.substring(8))
    if (isInternalUrl(src) && ['IMG', 'AUDIO', 'VIDEO', 'SOURCE'].includes(n.tagName)) {
      try {
        src = decodeURI(src)
      } catch {
        /* keep */
      }
      src = normalizeLinkPath(src)
      const dest = host.resolveLink(src, sourcePath)
      if (dest) (n as any).src = host.getResourcePath(dest)
    }
  }
}

function findInSections(sections: MarkdownSection[], selector: string, pred: (el: HTMLElement) => boolean): HTMLElement | null {
  for (const s of sections) for (const el of s.el.findAll(selector)) if (pred(el)) return el
  return null
}

const entityDecoder = typeof document !== 'undefined' ? document.createElement('textarea') : null
function decodeHtmlEntities(s: string): string {
  if (!entityDecoder) return s
  entityDecoder.innerHTML = s
  return entityDecoder.value
}
