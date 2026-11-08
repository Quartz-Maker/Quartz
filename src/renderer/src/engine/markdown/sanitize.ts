// HTML sanitisation with DOMPurify. DOMPurify is pinned to 3.0.1
// because attribute order in the output depends on it (3.0.x re-sets attributes
// while walking them backwards).
import createDOMPurify from 'dompurify'

export const PURIFY_CONFIG = {
  ALLOW_UNKNOWN_PROTOCOLS: true,
  RETURN_DOM_FRAGMENT: true,
  FORBID_TAGS: ['style'],
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['frameborder', 'allowfullscreen', 'allow', 'sandbox', 'data-tooltip-position'],
  FORBID_ATTR: ['data-background-iframe']
}

const IFRAME_SANDBOX = new Set([
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts'
])
const IFRAME_ALLOW = new Set([
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'hid',
  'idle-detection',
  'oversized-images',
  'picture-in-picture',
  'sync-xhr'
])
/** Keep only allowlisted tokens (lower-cased, trimmed); rewrite only when changed. */
export function filterTokens(el: Element, attr: string, sep: string, allowed: Set<string>): void {
  const value = el.getAttribute(attr) ?? ''
  const kept: string[] = []
  for (let tok of value.split(sep)) {
    tok = tok.trim().toLowerCase()
    if (allowed.has(tok)) kept.push(tok)
  }
  const out = kept.join(sep)
  if (out !== value) el.setAttribute(attr, out)
}

type Purifier =ReturnType<typeof createDOMPurify>
let purifier: Purifier | null = null
let purifierWindow: Window | null = null

export function getPurifier(win: Window = window): Purifier {
  if (purifier && purifierWindow === win) return purifier
  const p = createDOMPurify(win as never)
  p.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.nodeName === 'A') {
      node.setAttribute('target', '_blank')
      if (!node.hasAttribute('rel')) node.setAttribute('rel', 'noopener nofollow')
    }
  })
  // Desktop iframe policy: sandbox/allow tokens are filtered to an allowlist.
  p.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.nodeName !== 'IFRAME') return
    if (node.hasAttribute('sandbox')) filterTokens(node, 'sandbox', ' ', IFRAME_SANDBOX)
    else node.setAttribute('sandbox', 'allow-forms allow-presentation allow-same-origin allow-scripts allow-modals')
    if (node.hasAttribute('allow')) filterTokens(node, 'allow', ';', IFRAME_ALLOW)
  })
  purifier = p
  purifierWindow = win
  return p
}

/** Sanitise an HTML string into a DocumentFragment owned by `doc`. */
export function sanitizeHTMLToDom(html: string, doc: Document = document): DocumentFragment {
  const frag = getPurifier(doc.defaultView ?? window).sanitize(html, PURIFY_CONFIG) as unknown as DocumentFragment
  return doc.importNode(frag, true)
}
