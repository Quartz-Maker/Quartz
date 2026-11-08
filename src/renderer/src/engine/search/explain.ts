// "Explain search terms": the matcher tree rendered as nested `.search-info-children` blocks.
import { GroupMatcher, Matcher, PropertyMatcher, WrapperMatcher } from './query'

function div(parent: HTMLElement, cls?: string, text?: string): HTMLElement {
  const el = parent.ownerDocument.createElement('div')
  if (cls) el.className = cls
  if (text) el.textContent = text
  parent.appendChild(el)
  return el
}

export function renderSearchInfo(m: Matcher, parent: HTMLElement): void {
  div(parent, undefined, m.getInfo())
  if (m instanceof GroupMatcher) {
    const c = div(parent, 'search-info-children')
    for (const sub of m.matchers) renderSearchInfo(sub, c)
  } else if (m instanceof WrapperMatcher) {
    renderSearchInfo(m.matcher, div(parent, 'search-info-children'))
  } else if (m instanceof PropertyMatcher) {
    const c = div(parent, 'search-info-children')
    const span = (t: string): void => {
      const s = parent.ownerDocument.createElement('span')
      s.textContent = t
      c.appendChild(s)
    }
    span('Key:')
    renderSearchInfo(m.key, div(c, 'search-info-children'))
    if (m.value) {
      span('Value:')
      renderSearchInfo(m.value, div(c, 'search-info-children'))
    }
  }
}

/** Parse error line shown in place of the explanation. */
export function renderSearchError(message: string, parent: HTMLElement): void {
  div(parent, 'search-info', message)
}

/** `plugins.search.labelResultCount` ("{{count}} result" / "{{count}} results"). */
export function resultCountText(count: number): string {
  return count === 1 ? `${count} result` : `${count} results`
}
