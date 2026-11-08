/* eslint-disable @typescript-eslint/no-explicit-any */
// `.canvas` link index + updater (the canvas core plugin's link updater):
//   - file cards and group backgrounds are embed references (`link` = path + subpath)
//   - links / embeds inside text cards come from the card's markdown metadata (with positions)
// so canvases take part in resolvedLinks/unresolvedLinks/backlinks and in rename link-updating.
// Rewrites are written with the canvas printer (tab indent, compact cards/edges).
import type { MetadataCache, LinkUpdater } from './MetadataCache'
import type { TFile } from '../vault/TAbstractFile'
import { applyLinkChanges, type LinkChange } from './linkUpdate'
import { computeMetadata } from './parser/computeMetadata'
import { stringifyCanvas } from '../views/canvas/json'

interface CanvasRef {
  link: string
  original: string
  displayText?: string
  position?: any
  nodeId: string
  /** 'file' (card), 'background' (group) or 'text' (link inside a text card). */
  kind: 'file' | 'background' | 'text'
}

export class CanvasLinkUpdater implements LinkUpdater {
  refs: Record<string, CanvasRef[]> = {}
  constructor(private mc: MetadataCache) {}

  /** Parse a canvas file's JSON and remember its references. */
  index(path: string, text: string): void {
    const out: CanvasRef[] = []
    try {
      const data = JSON.parse(text)
      for (const n of data?.nodes ?? []) {
        if (!n) continue
        if (n.type === 'file' && typeof n.file === 'string') {
          const link = n.file + (typeof n.subpath === 'string' ? n.subpath : '')
          out.push({ link, original: '[[' + link + ']]', displayText: link, nodeId: n.id, kind: 'file' })
        } else if (n.type === 'group' && typeof n.background === 'string' && n.background) {
          out.push({ link: n.background, original: '[[' + n.background + ']]', displayText: n.background, nodeId: n.id, kind: 'background' })
        } else if (n.type === 'text' && typeof n.text === 'string') {
          try {
            const md: any = computeMetadata(n.text)
            for (const r of [...(md.links ?? []), ...(md.embeds ?? [])]) out.push({ ...r, nodeId: n.id, kind: 'text' })
          } catch (e) {
            console.error(e)
          }
        }
      }
    } catch {
      /* invalid canvas: no references */
    }
    this.refs[path] = out
  }
  forget(path: string): void {
    delete this.refs[path]
  }
  rename(oldPath: string, newPath: string): void {
    if (this.refs[oldPath]) {
      this.refs[newPath] = this.refs[oldPath]
      delete this.refs[oldPath]
    }
  }
  iterateReferences(cb: (path: string, ref: any) => void): void {
    for (const p of Object.keys(this.refs)) for (const r of this.refs[p]) cb(p, r)
  }
  iterateReferencesForFile(path: string, cb: (ref: any) => void): void {
    for (const r of this.refs[path] ?? []) cb(r)
  }
  async applyUpdates(file: TFile, changes: LinkChange[]): Promise<void> {
    await this.mc.vault.process(file, text => {
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        return text
      }
      const byNode = new Map<string, LinkChange[]>()
      for (const c of changes) {
        const ref = c.reference as unknown as CanvasRef
        const node = (data.nodes ?? []).find((n: any) => n.id === ref.nodeId)
        if (!node) continue
        if (ref.kind === 'text') {
          if (!byNode.has(node.id)) byNode.set(node.id, [])
          byNode.get(node.id)!.push(c)
          continue
        }
        const inner = c.change.replace(/^!?\[\[/, '').replace(/]]$/, '').split('|')[0]
        const i = inner.indexOf('#')
        const dest = this.mc.getFirstLinkpathDest(i === -1 ? inner : inner.slice(0, i), file.path)
        if (!dest) continue
        if (ref.kind === 'background') node.background = dest.path
        else {
          node.file = dest.path
          if (i !== -1) node.subpath = inner.slice(i)
        }
      }
      for (const n of data.nodes ?? []) {
        const list = byNode.get(n.id)
        if (list && n.type === 'text') n.text = applyLinkChanges(n.text, list)
      }
      return stringifyCanvas(data) ?? text
    })
  }
}
