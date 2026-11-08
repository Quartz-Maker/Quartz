/* eslint-disable @typescript-eslint/no-explicit-any */
// `editor:download-attachments` — fetch remote/data-URI images referenced by a note (markdown images and
// frontmatter properties holding an image URL), save them with `app.saveAttachment` (attachment-folder rules)
// and rewrite the references to internal links.
import { ConfirmationModal, Notice } from '../ui'
import { requestUrl } from '../ui/request'
import { parseMarkdown, getFrontMatter } from '../markdown/pipeline'
import { getFrontMatterInfo } from '../metadata/linkUpdate'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { DL } from '../pdf/strings'

const IMAGE_EXTS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']
const REMOTE = /^(https?:\/\/|data:)/
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp' }

interface Found {
  /** frontmatter properties whose whole value is an image URL */
  props: { key: string; value: string }[]
  /** markdown image nodes with remote urls */
  images: { url: string; alt: string; from: number; to: number }[]
  urls: string[]
}

function walk(node: any, fn: (n: any) => void): void {
  fn(node)
  if (node && Array.isArray(node.children)) for (const c of node.children) walk(c, fn)
}

export function findRemoteAttachments(text: string): Found {
  const out: Found = { props: [], images: [], urls: [] }
  const tree = parseMarkdown(text)
  let fm: any = null
  try {
    fm = getFrontMatter(tree) ?? (getFrontMatterInfo(text).exists ? parseYaml(getFrontMatterInfo(text).frontmatter) : null)
  } catch { /* invalid yaml */ }
  if (fm && typeof fm === 'object') {
    for (const key of Object.keys(fm)) {
      const v = fm[key]
      if (typeof v !== 'string' || !/^https?:\/\/\S+$/.test(v)) continue
      let ext = ''
      try { ext = new URL(v).pathname.split('.').pop()!.toLowerCase() } catch { continue }
      if (IMAGE_EXTS.includes(ext)) {
        out.props.push({ key, value: v })
        out.urls.push(v)
      }
    }
  }
  walk(tree, n => {
    if (n.type === 'image' && n.url && REMOTE.test(n.url) && n.position) {
      out.images.push({ url: n.url, alt: typeof n.alt === 'string' ? n.alt : '', from: n.position.start.offset, to: n.position.end.offset })
      out.urls.push(n.url)
    }
  })
  out.urls = Array.from(new Set(out.urls))
  return out
}

function parseDataUri(uri: string): { contentType: string; arrayBuffer: ArrayBuffer } | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri)
  if (!m) return null
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { contentType: m[1], arrayBuffer: bytes.buffer }
}

interface Item { url: string; name: string; checked: boolean; el: HTMLElement }
function makeItem(url: string): Item {
  const item: Item = { url, name: '', checked: true, el: createDiv('download-attachment-item') }
  const box = item.el.createEl('input', { type: 'checkbox' })
  const set = (c: boolean): void => {
    item.checked = c
    box.checked = c
    item.el.toggleClass('is-selected', c)
  }
  set(true)
  item.el.addEventListener('click', e => { if (e.button === 0 && !e.defaultPrevented) set(!item.checked) })
  box.addEventListener('change', () => set(box.checked))
  item.el.createEl('img', { attr: { src: url } })
  return item
}

async function promptForDownload(app: any, urls: string[]): Promise<Record<string, any> | null> {
  const items = urls.map(makeItem)
  for (const it of items) {
    if (it.url.startsWith('data:')) {
      const d = parseDataUri(it.url)
      if (d) it.name = 'Image.' + (MIME_EXT[d.contentType] || 'jpg')
    } else {
      const last = new URL(it.url).pathname.split('/').filter(Boolean).pop() || ''
      const dot = last.lastIndexOf('.')
      if (dot !== -1 && /^[a-z0-9]+$/i.test(last.slice(dot + 1))) it.name = last
    }
  }
  const modal = new ConfirmationModal(app)
  modal.titleEl.setText(DL.title)
  modal.modalEl.addClass('mod-scrollable-content')
  modal.contentEl.createDiv('attachments-gallery').append(...items.map(i => i.el))
  const accepted = await new Promise<boolean>(resolve => {
    let done = false
    const finish = (v: boolean): void => { if (!done) { done = true; resolve(v) } }
    modal.addButton(b => b.setCta().setButtonText(DL.button).onClick(() => finish(true)))
    modal.addCancelButton()
    const close = modal.onClose.bind(modal)
    modal.onClose = () => { close(); finish(false) }
    modal.open()
  })
  if (!accepted) return null
  const map: Record<string, any> = {}
  for (const it of items) {
    if (!it.checked) continue
    try {
      if (it.url.startsWith('data:')) {
        const d = parseDataUri(it.url)
        if (!d) continue
        const name = it.name ? it.name.replace(/\.[^.]+$/, '') : 'Image'
        map[it.url] = await app.saveAttachment(name, MIME_EXT[d.contentType] || 'jpg', d.arrayBuffer)
      } else {
        const res = await requestUrl({ url: it.url })
        let name = it.name
        const disp: string = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'] || ''
        const parts = disp.split(';').map((s: string) => s.trim()).filter(Boolean)
        if (parts.includes('attachment')) for (const p of parts) if (p.startsWith('filename=')) { name = p.slice(9).replace(/"/g, ''); break }
        if (!name) {
          const ct: string = ((res.headers?.['content-type'] || '') as string).split(';')[0].trim().toLowerCase()
          if (ct.startsWith('image/')) name = 'Image.' + (MIME_EXT[ct] || 'jpg')
        }
        if (!name) name = 'Image.jpg'
        const dot = name.lastIndexOf('.')
        map[it.url] = await app.saveAttachment(dot > 0 ? name.slice(0, dot) : name, dot > 0 ? name.slice(dot + 1) : 'jpg', res.arrayBuffer)
      }
    } catch (e) {
      console.error(e)
    }
  }
  modal.close()
  const n = Object.keys(map).length
  new Notice((n === 1 ? DL.downloaded : DL.downloadedPlural).replace('{{count}}', String(n)))
  return map
}

export async function downloadAttachmentsForNote(app: any, file: any): Promise<void> {
  if (file.extension !== 'md') return
  const text: string = await app.vault.read(file)
  const found = findRemoteAttachments(text)
  if (found.urls.length === 0) {
    new Notice(DL.none)
    return
  }
  const map = await promptForDownload(app, found.urls)
  if (!map || Object.keys(map).length === 0) return
  await app.vault.process(file, (data: string) => {
    const cur = data === text ? found : findRemoteAttachments(data)
    const edits: { from: number; to: number; text: string }[] = []
    for (const img of cur.images) {
      const dest = map[img.url]
      if (dest) edits.push({ from: img.from, to: img.to, text: '!' + app.fileManager.generateMarkdownLink(dest, file.path, '', img.alt) })
    }
    edits.sort((a, b) => b.from - a.from)
    for (const e of edits) data = data.substring(0, e.from) + e.text + data.substring(e.to)
    if (cur.props.length > 0) {
      const info = getFrontMatterInfo(data)
      if (info.exists) {
        let fm: any = {}
        try { fm = parseYaml(info.frontmatter) ?? {} } catch { return data }
        for (const p of cur.props) {
          const dest = map[p.value]
          if (dest && fm[p.key] === p.value) fm[p.key] = `[[${app.metadataCache.fileToLinktext(dest, '', false)}]]`
        }
        data = '---\n' + stringifyYaml(fm) + '---\n' + data.slice(info.contentStart)
      }
    }
    return data
  })
}
