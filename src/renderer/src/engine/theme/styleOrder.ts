// <head> style element ordering (CustomCss):
//   app stylesheet  <  plugin styles.css  <  theme  <  CSS snippets (natural-sorted by name)
// One persistent theme <style> is appended after the app stylesheet at startup; plugin
// styles are inserted before it, snippet styles after it.

let themeEl: HTMLStyleElement | null = null
const snippetEls = new Map<string, HTMLStyleElement>()
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function getThemeStyleEl(): HTMLStyleElement {
  if (themeEl && themeEl.isConnected) return themeEl
  themeEl = document.createElement('style')
  themeEl.setAttribute('type', 'text/css')
  themeEl.id = 'quartz-community-theme'
  document.head.appendChild(themeEl)
  return themeEl
}

/** Set the theme CSS ('' clears). Returns true if the text changed. */
export function setThemeCss(css: string): boolean {
  const el = getThemeStyleEl()
  if (el.textContent === css) return false
  el.textContent = css
  return true
}

/** Insert a plugin's styles.css element (before the theme style, as loadCSS does). */
export function insertPluginStyle(el: HTMLStyleElement): void {
  document.head.insertBefore(el, getThemeStyleEl())
}

/** Replace the set of snippet styles (name → css). Order: natural sort, after the theme. */
export function setSnippetStyles(snippets: Map<string, string>): void {
  for (const [name, el] of snippetEls) if (!snippets.has(name)) { el.remove(); snippetEls.delete(name) }
  let after: Element = getThemeStyleEl()
  for (const name of [...snippets.keys()].sort(collator.compare)) {
    let el = snippetEls.get(name)
    if (!el) {
      el = document.createElement('style')
      el.setAttribute('type', 'text/css')
      el.id = `quartz-snippet-${name}`
      snippetEls.set(name, el)
    }
    if (el.textContent !== snippets.get(name)) el.textContent = snippets.get(name)!
    after.after(el)
    after = el
  }
}

export function setSnippetStyle(name: string, css: string | null): void {
  const m = new Map<string, string>()
  for (const [n, el] of snippetEls) m.set(n, el.textContent ?? '')
  if (css === null) m.delete(name)
  else m.set(name, css)
  setSnippetStyles(m)
}

export const naturalCompare = collator.compare
