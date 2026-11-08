// Canvas URL / drag-and-drop text helpers: URL checks, YouTube/tweet embed URLs, DataTransfer text.

/** http(s) URL (paste/drop check). */
export function isUrl(s: string): boolean {
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return false
  }
  return u.protocol === 'http:' || u.protocol === 'https:'
}
const YOUTUBE_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/(?:[\w-]+\?(?:.*?&)*v=|embed\/|v\/)?)([\w-]+)(?:\??&?(?:t|start)=([0-9]+))?(?:\S+)?$/
const TWEET_RE = /^(?:https?:\/\/)?(?:mobile\.)?(?:twitter|x)\.com\/.+\/(\d+)/
export function isYouTubeUrl(s: string): boolean {
  return YOUTUBE_RE.test(s)
}
/** Embeddable URL for YouTube / tweets (youtube-nocookie / platform.twitter.com), else null. */
export function embedUrlFor(url: string): string | null {
  if (!url || typeof url !== 'string') return null
  let m = url.match(YOUTUBE_RE)
  if (m) return 'https://www.youtube-nocookie.com/embed/' + m[1] + (m[2] ? '?start=' + m[2] : '')
  if ((m = url.match(TWEET_RE))) return `https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=${document.body.hasClass('theme-dark') ? 'dark' : 'light'}&id=${m[1]}`
  return null
}

/** Text of a DataTransfer: text/plain, else the first uri-list line, else the text of text/html. */
export function dataTransferText(dt: DataTransfer | null): string {
  if (!dt) return ''
  const t = dt.getData('text/plain')
  if (t) return t
  const uris = dt.getData('text/uri-list')
  const i = uris.indexOf('\n')
  const first = (i === -1 ? uris : uris.substring(0, i)).trim()
  if (first) return first
  const html = dt.getData('text/html')
  if (!html) return ''
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || ''
}
