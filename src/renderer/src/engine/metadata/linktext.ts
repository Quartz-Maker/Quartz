// Link-text helpers (plugin API: parseLinktext, getLinkpath, stripHeading…).

const NBSP = / /g

/** Normalise a link href: NBSP → space, trim, NFC. */
export function normalizeHref(href: string): string {
  return href.replace(NBSP, ' ').trim().normalize('NFC')
}

/** Default display text for a link without alias: `a#b#c` → `a > b > c`. */
export function defaultDisplayText(link: string): string {
  return link
    .split('#')
    .filter(s => !!s)
    .join(' > ')
    .trim()
}

/** Split the inside of `[[…]]` into href/title (alias at the first `|` with index > 0). */
export function parseWikilinkInner(inner: string): { href: string; title: string; isAlias: boolean } {
  let title = ''
  let href = inner
  const bar = href.indexOf('|')
  const isAlias = bar > 0
  if (isAlias) {
    title = href.substring(bar + 1).trim()
    href = href.substring(0, bar).trim()
  } else {
    href = href.trim()
    title = defaultDisplayText(href)
  }
  if (href.endsWith('\\')) href = href.substring(0, href.length - 1)
  return { href: normalizeHref(href), title, isAlias }
}

/** True for links that point inside the vault (relative, or no URL scheme). */
export function isInternalUrl(url: string): boolean {
  return url.startsWith('./') || url.startsWith('../') || url.indexOf(':') === -1
}

/** `getLinkpath`: the part before the first `#`. */
export function getLinkpath(linktext: string): string {
  const i = linktext.indexOf('#')
  return i === -1 ? linktext : linktext.substring(0, i)
}

/** `parseLinktext`: split linktext into path and `#subpath`. */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const i = linktext.indexOf('#')
  return { path: i === -1 ? linktext : linktext.substring(0, i), subpath: i === -1 ? '' : linktext.substring(i) }
}

/** Percent-encode the few characters that need escaping in markdown-link destinations. */
export function encodeLinkDestination(s: string): string {
  return s.replace(/[\\\x00\x08\x0B\x0C\x0E-\x1F ]/g, c => encodeURIComponent(c))
}

const HEADING_ILLEGAL = /([:#|^\\\r\n]|%%|\[\[|]])/g
/** Clean a heading for use in a link subpath (`stripHeadingForLink`). */
export function stripHeadingForLink(heading: string): string {
  return heading.replace(HEADING_ILLEGAL, ' ').replace(/\s+/g, ' ').trim()
}
const HEADING_SEARCH = /[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g
/** `stripHeading`: normalise a heading for comparison. */
export function stripHeading(heading: string): string {
  return heading.replace(HEADING_SEARCH, ' ').replace(/\s+/g, ' ').trim()
}

/** Regexes used to rewrite a reference in place. */
export const WIKILINK_FULL = /^(!?\[\[)(.*?)(\|(.*))?(]])$/
export const MDLINK_FULL = /^(!?\[)(.*?)(]\(\s*)((<[^>]*?>|[^ "]+?)(\s+([^ ]+|"[^"]+"|'[^']+'|\([^']+\)))?)?(\s*\))$/
