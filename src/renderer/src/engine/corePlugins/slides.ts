/* eslint-disable @typescript-eslint/no-explicit-any */
// Slides (reveal.js) and Audio recorder core plugins.
import type { CorePluginDef } from '../app/InternalPlugins'
import { Notice, moment } from '../ui'
import { t } from '../settings/i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MarkdownView } from '../views/markdown/MarkdownView'
import { Component } from '../core/Component'

export const slidesPlugin: CorePluginDef = {
  id: 'slides',
  name: t('plugins.slides.name'),
  description: t('plugins.slides.desc'),
  defaultOn: false,
  onEnable(app, p) {
    async function start(file: any): Promise<void> {
      const [{ default: Reveal }] = await Promise.all([import('reveal.js'), import('reveal.js/reveal.css')])
      const text: string = (app.workspace.getActiveViewOfType(MarkdownView)?.editor?.getValue?.() ?? (await app.vault.read(file))).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      const container = document.body.createDiv('slides-container')
      container.style.cssText = 'position:fixed;inset:0;z-index:var(--layer-modal, 50);background:var(--background-primary)'
      const reveal = container.createDiv('reveal')
      const slidesEl = reveal.createDiv('slides')
      const comp = new Component()
      comp.load()
      for (const part of text.split(/^\s*---\s*$/m)) {
        const section = slidesEl.createEl('section')
        await MarkdownRenderer.render(app, part.trim(), section, file.path, comp)
      }
      const deck = new (Reveal as any)(reveal, { embedded: false, hash: false, controls: true, progress: true, slideNumber: false, keyboard: true })
      await deck.initialize()
      const close = (e?: KeyboardEvent): void => {
        if (e && e.key !== 'Escape') return
        window.removeEventListener('keydown', close, true)
        try {
          deck.destroy()
        } catch {
          /* ignore */
        }
        comp.unload()
        container.detach()
      }
      window.addEventListener('keydown', close, true)
    }
    p.registerGlobalCommand({
      id: 'slides:start',
      name: `${p.instance.name}: ${t('plugins.slides.actionStart')}`,
      icon: 'lucide-monitor',
      checkCallback: (checking: boolean) => {
        const f = app.workspace.getActiveFile()
        if (!f || f.extension !== 'md') return false
        if (!checking) void start(f)
        return true
      }
    })
    p.registerEvent(
      app.workspace.on('file-menu', (menu: any, file: any) => {
        if (file?.extension === 'md') menu.addItem((i: any) => i.setSection('view').setTitle(t('plugins.slides.actionStart')).setIcon('lucide-monitor').onClick(() => void start(file)))
      })
    )
  }
}

export const audioRecorderPlugin: CorePluginDef = {
  id: 'audio-recorder',
  name: t('plugins.audioRecorder.name'),
  description: t('plugins.audioRecorder.desc'),
  defaultOn: false,
  onEnable(app, p) {
    let rec: MediaRecorder | null = null
    let chunks: BlobPart[] = []
    let stream: MediaStream | null = null
    const mime = ((): { type: string; ext: string } => {
      if (MediaRecorder.isTypeSupported('audio/mp4')) return { type: 'audio/mp4', ext: 'm4a' }
      return { type: 'audio/webm;codecs=opus', ext: 'webm' }
    })()
    async function start(): Promise<void> {
      if (rec) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e: any) {
        new Notice(t(e?.name === 'NotFoundError' ? 'plugins.audioRecorder.msgNoMicrophone' : 'plugins.audioRecorder.msgAccessDenied'))
        return
      }
      chunks = []
      rec = new MediaRecorder(stream, { mimeType: mime.type })
      rec.ondataavailable = e => chunks.push(e.data)
      const view = app.workspace.getActiveViewOfType(MarkdownView)
      rec.onstop = async () => {
        stream?.getTracks().forEach(tr => tr.stop())
        const blob = new Blob(chunks, { type: mime.type })
        const src = app.workspace.getActiveFile()
        const name = `Recording ${moment().format('YYYYMMDDHHmmss')}`
        const path = await app.vault.getAvailablePathForAttachments(name, mime.ext, src)
        const f = await app.vault.createBinary(path, await blob.arrayBuffer())
        view?.editor?.replaceSelection?.(`\n![[${app.metadataCache.fileToLinktext(f, src?.path ?? '')}]]\n`)
        rec = null
        statusEl.hide()
      }
      rec.start()
      statusEl.show()
    }
    function stop(): void {
      if (rec && rec.state !== 'inactive') rec.stop()
    }
    const statusEl = p.addStatusBarItem()
    statusEl.addClass('mod-clickable')
    statusEl.setText('● ' + t('plugins.audioRecorder.actionStop'))
    statusEl.addEventListener('click', stop)
    statusEl.hide()
    p.addRibbonIcon('lucide-mic', t('plugins.audioRecorder.actionToggle'), () => (rec ? stop() : void start()))
    const pre = p.instance.name + ': '
    p.registerGlobalCommand({ id: 'audio-recorder:start', name: pre + t('plugins.audioRecorder.actionStart'), icon: 'lucide-play-circle', checkCallback: (c: boolean) => (rec ? false : (c || void start(), true)) })
    p.registerGlobalCommand({ id: 'audio-recorder:stop', name: pre + t('plugins.audioRecorder.actionStop'), icon: 'lucide-stop-circle', checkCallback: (c: boolean) => (rec ? (c || stop(), true) : false) })
    p.register(stop)
  }
}
