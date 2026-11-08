/* eslint-disable @typescript-eslint/no-explicit-any */
// Appearance tab (id `appearance`): base color scheme, accent, themes, CSS snippets,
// font pages, font size. Live effects come from engine/theme/appearance (config-changed handlers).
import { t } from '../i18n'
import { BuiltinTab } from '../util'
import { SettingPage } from '../../plugins/settingTab'
import { parseFontList } from '../../theme/appearance'
import { Notice, setIcon } from '../../ui'
import { electron, nodeRequire } from '../../node'
import { CommunityThemesModal } from '../community/CommunityThemesModal'
import { withLoading } from '../community/CommunityModal'

const A = 'setting.appearance.'
const DEFAULT_FONT_SIZE = 16

// ---- system font detection (font list: Inter + Source Code Pro, the system's font families, plus
// common font names that measure differently from the generic fallbacks; sorted) ---------------------------------
const COMMON_FONTS = ["Arial","Arial Black","Bahnschrift","Calibri","Cambria","Cambria Math","Candara","Comic Sans MS","Consolas","Constantia","Corbel","Courier New","Ebrima","Franklin Gothic Medium","Gabriola","Gadugi","Georgia","HoloLens MDL2 Assets","Impact","Ink Free","Javanese Text","Leelawadee UI","Lucida Console","Lucida Sans Unicode","Malgun Gothic","Marlett","Microsoft Himalaya","Microsoft JhengHei","Microsoft New Tai Lue","Microsoft PhagsPa","Microsoft Sans Serif","Microsoft Tai Le","Microsoft YaHei","Microsoft Yi Baiti","MingLiU-ExtB","Mongolian Baiti","MS Gothic","MV Boli","Myanmar Text","Nirmala UI","Palatino Linotype","Segoe MDL2 Assets","Segoe Print","Segoe Script","Segoe UI","Segoe UI Historic","Segoe UI Emoji","Segoe UI Symbol","SimSun","Sitka","Sylfaen","Symbol","Tahoma","Times New Roman","Trebuchet MS","Verdana","Webdings","Wingdings","Yu Gothic","American Typewriter","Andale Mono","Arial","Arial Black","Arial Narrow","Arial Rounded MT Bold","Arial Unicode MS","Avenir","Avenir Next","Avenir Next Condensed","Baskerville","Big Caslon","Bodoni 72","Bodoni 72 Oldstyle","Bodoni 72 Smallcaps","Bradley Hand","Brush Script MT","Chalkboard","Chalkboard SE","Chalkduster","Charter","Cochin","Comic Sans MS","Copperplate","Courier","Courier New","Didot","DIN Alternate","DIN Condensed","Futura","Geneva","Georgia","Gill Sans","Helvetica","Helvetica Neue","Herculanum","Hoefler Text","Impact","Lucida Grande","Luminari","Marker Felt","Menlo","Microsoft Sans Serif","Monaco","Noteworthy","Optima","Palatino","Papyrus","Phosphate","Rockwell","Savoye LET","SignPainter","Skia","Snell Roundhand","Tahoma","Times","Times New Roman","Trattatello","Trebuchet MS","Verdana","Zapfino"]
const FALLBACKS = ['monospace', 'sans-serif', 'serif']
const PROBE = 'abcdefghijklmnopqrstuvwxyz0123456789'

interface FontProbe { ctx: CanvasRenderingContext2D; base: Record<string, number> }
function fontProbe(): FontProbe {
  const ctx = document.createElement('canvas').getContext('2d')!
  const base: Record<string, number> = {}
  for (const f of FALLBACKS) {
    ctx.font = '72px ' + f
    base[f] = ctx.measureText(PROBE).width
  }
  return { ctx, base }
}
/** Whether `font` renders differently from every generic fallback, i.e. is installed. */
function fontAvailable(p: FontProbe, font: string): boolean {
  for (const f of FALLBACKS) {
    p.ctx.font = `72px ${font}, ${f}`
    if (p.ctx.measureText(PROBE).width !== p.base[f]) return true
  }
  return false
}

/** System font families: fontconfig on Linux (first family name of each face), Local Font Access elsewhere. */
async function systemFamilies(): Promise<string[]> {
  try {
    const cp = nodeRequire<any>('child_process')
    const out: string = await new Promise((res, rej) => cp.execFile('fc-list', [':', 'family'], { maxBuffer: 1 << 24 }, (e: any, so: string) => (e ? rej(e) : res(so))))
    return out.split('\n').map(l => l.split(',')[0].trim()).filter(Boolean)
  } catch {
    /* no fontconfig */
  }
  try {
    const q = (window as any).queryLocalFonts
    if (q) return (await q.call(window)).map((f: any) => f.family)
  } catch {
    /* permission denied */
  }
  return []
}

let fontListPromise: Promise<string[]> | null = null
function loadFontList(): Promise<string[]> {
  if (!fontListPromise)
    fontListPromise = (async () => {
      const seen = new Set<string>()
      const out: string[] = ['Inter', 'Source Code Pro']
      const add = (f: string): void => {
        if (!seen.has(f)) {
          seen.add(f)
          out.push(f)
        }
      }
      for (const f of await systemFamilies()) add(f)
      const probe = fontProbe()
      for (const f of COMMON_FONTS) if (!seen.has(f)) { seen.add(f); if (fontAvailable(probe, f)) out.push(f) }
      return out.sort()
    })()
  return fontListPromise
}

/** Page editing an ordered font list (interface / text / monospace font): the chosen fonts (X to remove, drag to
 *  rearrange; "not detected" warning) and below them every available font (click to add) with a filter that also
 *  offers the typed name. */
class FontPage extends SettingPage {
  private fonts: string[]
  constructor(title: string, private app: any, private key: string) {
    super(title)
    this.fonts = parseFontList(app.vault.getConfig(key))
  }
  private save(): void {
    this.app.vault.setConfig(this.key, this.fonts.join(','))
  }
  display(): void {
    const el = this.containerEl
    el.empty()
    const probe = fontProbe()
    const desc = el.createEl('p', 'setting-page-desc')
    const chosen = el.createDiv('setting-group mod-list').createDiv('setting-items')
    const renderChosen = (): void => {
      desc.setText(this.fonts.length ? t(A + 'labelFontApplied') : t(A + 'labelNoCustomFontSet'))
      chosen.empty()
      this.fonts.forEach((f, i) => {
        const row = chosen.createDiv({ cls: 'setting-item', attr: { tabindex: -1 } })
        const info = row.createDiv('setting-item-info')
        const name = info.createDiv({ cls: 'setting-item-name', text: f })
        name.style.fontFamily = f
        const d = info.createDiv('setting-item-description')
        if (!fontAvailable(probe, f)) d.addClass('mod-warning'), d.setText(t(A + 'msgFontNotFound'))
        const ctl = row.createDiv('setting-item-control')
        const del = ctl.createDiv({ cls: 'clickable-icon extra-setting-button', attr: { tabindex: 0, 'aria-label': t('interface.deleteActionShortName') } })
        setIcon(del, 'lucide-x')
        del.addEventListener('click', () => {
          this.fonts.splice(i, 1)
          changed()
        })
        const drag = ctl.createDiv({ cls: 'clickable-icon extra-setting-button mod-drag-handle', attr: { tabindex: -1, 'aria-label': t('interface.dragToRearrange') } })
        setIcon(drag, 'lucide-menu')
        drag.addEventListener('pointerdown', e =>
          dragRow(e, row, (from, to) => {
            const [x] = this.fonts.splice(from, 1)
            this.fonts.splice(to, 0, x)
            changed()
          })
        )
      })
    }
    const add = el.createDiv('setting-group mod-list')
    const search = add.createDiv({ cls: 'setting-group-search', attr: { tabindex: '-1' } })
    const sc = search.createDiv('search-input-container')
    const input = sc.createEl('input', { type: 'search', attr: { enterkeyhint: 'search', spellcheck: 'false', placeholder: t(A + 'optionFontPlaceholder') } })
    sc.createDiv('search-input-clear-button').addEventListener('click', () => ((input.value = ''), filter()))
    const list = add.createDiv('setting-items')
    const rows: Record<string, HTMLElement> = {}
    const mkRow = (name: string, onClick: () => void): HTMLElement => {
      const row = list.createDiv({ cls: 'setting-item mod-action tappable', attr: { tabindex: -1 } })
      const info = row.createDiv('setting-item-info')
      const n = info.createDiv({ cls: 'setting-item-name', text: name })
      n.style.fontFamily = name
      n.style.color = 'var(--text-normal)'
      info.createDiv('setting-item-description')
      row.createDiv('setting-item-control')
      row.addEventListener('click', onClick)
      return row
    }
    // the typed (custom) font name, shown only when it is not in the list
    const custom = mkRow('', () => {
      const v = input.value.trim()
      if (v && !this.fonts.includes(v)) this.fonts.push(v), changed()
    })
    custom.toggle(false)
    const filter = (): void => {
      const q = input.value.trim()
      const words = q.toLowerCase().split(' ').filter(Boolean)
      for (const [name, row] of Object.entries(rows)) {
        const l = name.toLowerCase()
        row.toggle(!this.fonts.includes(name) && words.every(w => l.includes(w)))
      }
      const known = Object.keys(rows).some(n => n.toLowerCase() === q.toLowerCase())
      if (!q || this.fonts.includes(q) || known) custom.toggle(false)
      else {
        custom.toggle(true)
        const n = custom.querySelector('.setting-item-name') as HTMLElement
        n.setText(q)
        n.style.fontFamily = q
        const d = custom.querySelector('.setting-item-description') as HTMLElement
        const ok = fontAvailable(probe, q)
        d.toggleClass('mod-warning', !ok)
        d.setText(ok ? '' : t(A + 'msgFontNotFound'))
      }
    }
    const changed = (): void => {
      this.save()
      renderChosen()
      filter()
    }
    input.addEventListener('input', filter)
    renderChosen()
    list.addClass('is-loading')
    void loadFontList().then(fonts => {
      list.removeClass('is-loading')
      for (const f of fonts)
        if (!rows[f])
          rows[f] = mkRow(f, () => {
            this.fonts.push(f)
            changed()
          })
      filter()
    })
  }
}

/** Drag a row by its handle within its list; calls `done(from, to)` on drop. */
function dragRow(evt: PointerEvent, rowEl: HTMLElement, done: (from: number, to: number) => void): void {
  if (evt.button !== 0) return
  evt.preventDefault()
  const listEl = rowEl.parentElement!
  const rows = (): HTMLElement[] => Array.from(listEl.children) as HTMLElement[]
  const from = rows().indexOf(rowEl)
  const doc = rowEl.ownerDocument
  rowEl.addClass('is-being-dragged')
  doc.body.addClass('is-grabbing')
  const move = (e: PointerEvent): void => {
    for (const r of rows()) {
      if (r === rowEl) continue
      const b = r.getBoundingClientRect()
      if (e.clientY > b.top && e.clientY < b.bottom) {
        listEl.insertBefore(rowEl, e.clientY < b.top + b.height / 2 ? r : r.nextSibling)
        break
      }
    }
  }
  const up = (): void => {
    doc.removeEventListener('pointermove', move)
    doc.removeEventListener('pointerup', up)
    rowEl.removeClass('is-being-dragged')
    doc.body.removeClass('is-grabbing')
    const to = rows().indexOf(rowEl)
    if (from >= 0 && to !== from) done(from, to)
  }
  doc.addEventListener('pointermove', move)
  doc.addEventListener('pointerup', up)
}

export class AppearanceTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'appearance', t(A + 'name'), 'palette')
  }

  getSettingDefinitions(): any[] {
    const app = this.app
    const vault = app.vault
    const css = app.customCss
    const defs: any[] = []
    defs.push({
      name: t(A + 'optionBaseTheme'),
      desc: t(A + 'optionBaseThemeDescription'),
      aliases: [t(A + 'aliasBaseTheme')],
      render: (s: any) =>
        s.addDropdown((d: any) => {
          d.addOption('obsidian', t(A + 'darkTheme')).addOption('moonstone', t(A + 'lightTheme')).addOption('system', t(A + 'systemTheme'))
          d.onChange((v: string) => app.changeTheme(v))
          d.setValue(vault.getConfig('theme'))
        })
    })
    defs.push({
      name: t(A + 'optionAccentColor'),
      desc: t(A + 'optionAccentColorDescription'),
      aliases: [t(A + 'aliasAccentColor')],
      render: (s: any) => {
        let reset: any, picker: any
        const sync = (): void => reset.extraSettingsEl.setAttr('aria-disabled', !vault.getConfig('accentColor'))
        s.setClass('mod-toggle')
        s.addExtraButton((b: any) => {
          reset = b.setIcon('lucide-rotate-ccw').setTooltip(t('setting.hotkeys.tooltipRestoreDefault')).onClick(() => {
            vault.setConfig('accentColor', '')
            picker.colorPickerEl.value = app.getAccentColor()
            sync()
          })
        })
        s.addColorPicker((c: any) => {
          picker = c.setValue(app.getAccentColor()).onChange((v: string) => {
            vault.setConfig('accentColor', v)
            sync()
          })
        })
        sync()
      }
    })
    defs.push({
      name: t(A + 'optionThemes'),
      desc: t(A + 'optionManageThemesDescription'),
      aliases: [t(A + 'aliasThemes')],
      render: (s: any) => {
        s.addExtraButton((b: any) =>
          b.setIcon('lucide-folder-open').setTooltip(t(A + 'buttonOpenThemesFolder')).onClick(async () => {
            const dir = css.getThemeFolder()
            if (!(await vault.adapter.exists(dir))) await vault.adapter.mkdir(dir)
            ;(electron() as any).shell?.openPath?.(vault.adapter.getFullPath(dir))
          })
        )
        s.addDropdown((d: any) => {
          d.addOption('', t(A + 'labelDefaultTheme'))
          for (const name of Object.keys(css.themes)) d.addOption(name, name)
          for (const name of css.oldThemes) if (!css.themes[name]) d.addOption(name, name + ' (Legacy)')
          d.setValue(css.themes[css.theme] || css.oldThemes.includes(css.theme) ? css.theme : '')
          d.onChange((v: string) => css.setTheme(v))
        })
        s.addButton((b: any) =>
          b.setButtonText(t(A + 'optionThemeButtonManage')).onClick(() =>
            new CommunityThemesModal(app)
              .setCloseCallback(() => this.refreshPage())
              .setChangeCallback(() => this.refreshPage())
              .open()
          )
        )
      }
    })
    defs.push({
      name: t(A + 'labelCurrentThemes'),
      render: (s: any) => {
        const n = Object.keys(css.themes).length + css.oldThemes.length
        const u = Object.keys(css.updates).length
        s.setDesc(t(A + 'labelCurrentlyInstalled', { count: n }) + ' ' + (u > 0 ? t(A + 'msgUpdatesFound', { count: u }) : ''))
        if (u > 0) {
          s.addButton((b: any) =>
            b.setButtonText(t(A + 'buttonViewUpdates')).onClick(() =>
              new CommunityThemesModal(app)
                .setOnlyShowUpdates(true)
                .setCloseCallback(() => this.refreshPage())
                .setChangeCallback(() => this.refreshPage())
                .open()
            )
          )
          s.addButton((b: any) =>
            b.setButtonText(t(A + 'buttonUpdateAllThemes')).onClick(() =>
              withLoading(this.containerEl, async () => {
                for (const up of Object.values<any>(css.updates)) await css.installTheme(up.themeInfo, up.version)
                this.refreshPage()
              })
            )
          )
        } else if (n > 0)
          s.addButton((b: any) =>
            b.setButtonText(t(A + 'buttonCheckForUpdates')).onClick(async () => {
              await withLoading(this.containerEl, () => css.checkForUpdates())
              this.refreshPage()
            })
          )
      }
    })
    // CSS snippets sub-page
    defs.push({
      type: 'page',
      name: t(A + 'optionCssSnippets'),
      desc: t(A + 'optionCssSnippetsDescription'),
      displayValue: () => t(A + 'labelEnabledSnippetsCount', { count: css.snippets.filter((n: string) => css.enabledSnippets.has(n)).length }),
      items: [
        {
          type: 'list',
          extraButtons: [
            (b: any) =>
              b.setIcon('lucide-refresh-cw').setTooltip(t(A + 'buttonReloadSnippets')).onClick(async () => {
                await css.readSnippets()
                await css.applySnippets()
                new Notice(t(A + 'msgReloadedSnippets'))
                this.refreshPage()
              }),
            (b: any) =>
              b.setIcon('lucide-folder-open').setTooltip(t(A + 'buttonOpenSnippetsFolder')).onClick(async () => {
                const dir = css.getSnippetsFolder()
                if (!(await vault.adapter.exists(dir))) await vault.adapter.mkdir(dir)
                ;(electron() as any).shell?.openPath?.(vault.adapter.getFullPath(dir))
              })
          ],
          search: { placeholder: t(A + 'placeholderSearchSnippet'), match: (d: any, q: string) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()) },
          items: () => css.snippets.map((name: string) => ({
            name,
            render: (s: any) => {
              s.addToggle((tg: any) => tg.setValue(css.enabledSnippets.has(name)).onChange((v: boolean) => css.setCssEnabledStatus(name, v)))
              s.settingEl.addEventListener('contextmenu', (e: MouseEvent) => {
                e.preventDefault()
                ;(electron() as any).shell?.showItemInFolder?.(vault.adapter.getFullPath(css.getSnippetPath(name)))
              })
            }
          })),
          emptyState: createFragment(f => {
            f.appendText(t(A + 'noSnippetDescription', { path: 'vault/' + css.getSnippetsFolder() }))
            f.appendText(' ')
            f.createEl('a', { text: t('interface.buttonLearnMore'), attr: { href: 'https://github.com/Quartz-Maker/Quartz', target: '_blank' } })
          })
        }
      ]
    })
    const font = (name: string, desc: string, key: string): any => ({
      type: 'page',
      name: t(A + name),
      desc: t(A + desc),
      displayValue: () => {
        const n = parseFontList(vault.getConfig(key)).length
        return n ? t(A + 'labelFontCount', { count: n }) : ''
      },
      status: () => (parseFontList(vault.getConfig(key)).some(f => !fontAvailable(fontProbe(), f)) ? 'warning' : null),
      page: () => new FontPage(t(A + name), app, key)
    })
    defs.push({
      type: 'group',
      heading: t(A + 'optionFont'),
      items: [
        font('optionInterfaceFont', 'optionInterfaceFontDescription', 'interfaceFontFamily'),
        font('optionTextFont', 'optionTextFontDescription', 'textFontFamily'),
        font('optionMonospaceFont', 'optionMonospaceFontDescription', 'monospaceFontFamily'),
        {
          name: t(A + 'optionFontSize'),
          desc: t(A + 'optionFontSizeDescription'),
          aliases: [t(A + 'aliasFontSize')],
          render: (s: any) => {
            let reset: any
            let slider: any
            const sync = (): void => reset.extraSettingsEl.setAttribute('aria-disabled', String(slider.getValue() === DEFAULT_FONT_SIZE))
            s.addExtraButton((b: any) => {
              reset = b.setIcon('lucide-rotate-ccw').setTooltip(t('setting.hotkeys.tooltipRestoreDefault')).onClick(() => {
                slider.setValue(DEFAULT_FONT_SIZE)
              })
            })
            s.addSlider((sl: any) => {
              slider = sl
              sl.setLimits(10, 30, 1).setValue(app.getBaseFontSize?.() ?? DEFAULT_FONT_SIZE).onChange((v: number) => {
                app.setBaseFontSize?.(v) // per-device (localStorage), never written to appearance.json
                sync()
              })
              sync()
            })
          }
        },
        { name: t(A + 'optionFontSizeAction'), desc: t(A + 'optionFontSizeActionDescription'), control: { type: 'toggle', key: 'baseFontSizeAction' } }
      ]
    })
    defs.push({
      type: 'group',
      heading: t(A + 'optionAdvanced'),
      items: [
        {
          name: t(A + 'optionCustomIcon'),
          desc: t(A + 'optionCustomIconDesc'),
          render: (s: any) => renderCustomIcon(s)
        }
      ]
    })
    return defs
  }

  private refreshPage(): void {
    this.app.setting.refreshCurrentPage?.()
  }
}

// ---- Custom app icon (copied into the user data folder by the main process, applied on relaunch) -------

const ipc = (): any => (window as any).require('electron').ipcRenderer
const ICNS_TYPES = ['ic07', 'ic13', 'ic08', 'ic14', 'ic09', 'ic10']
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]
const IHDR = [73, 72, 68, 82]
const str4 = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
const be32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const le32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** The largest PNG image inside an .icns file. */
function pngFromIcns(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || str4(b, 0) !== 'icns') return null
  let o = 8
  let best: Uint8Array | null = null
  while (o + 8 <= b.byteLength) {
    const type = str4(b, o)
    const len = be32(b, o + 4)
    if (len < 8) break
    if (ICNS_TYPES.includes(type)) best = b.slice(o + 8, o + len)
    o += len
  }
  return best
}

/** The largest PNG-encoded image inside an .ico file. */
function pngFromIco(b: Uint8Array): Uint8Array | null {
  if (b.length < 6) return null
  const n = b[4] | (b[5] << 8)
  let area = 0
  let best: Uint8Array | null = null
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i
    const off = le32(b, e + 12)
    const img = b.slice(off, off + le32(b, e + 8))
    if (!PNG_SIG.every((v, k) => img[k] === v) || !IHDR.every((v, k) => img[12 + k] === v)) continue
    const a = be32(img, 16) * be32(img, 20)
    if (a > area) {
      area = a
      best = img
    }
  }
  return best
}

/** Adds a transparent margin to icons that touch their edges (system icons are full-bleed squares). */
async function padIcon(png: Uint8Array): Promise<Uint8Array> {
  const img = new Image()
  let bin = ''
  for (const x of png) bin += String.fromCharCode(x)
  await new Promise<void>(res => {
    img.addEventListener('load', () => res())
    img.addEventListener('error', () => res())
    img.src = 'data:image/png;base64,' + btoa(bin)
  })
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) return png
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  const m = Math.floor((3 * Math.min(w, h)) / 32)
  const data = ctx.getImageData(0, 0, w, h).data
  const alpha = (y: number, x: number): number => data[4 * (y * w + x) + 3]
  let clear = true
  for (let i = 0; i < Math.floor(m / 2) && clear; i++) {
    for (let x = 0; x < w && clear; x++) if (alpha(i, x) > 128 || alpha(h - i - 1, x) > 128) clear = false
    for (let y = 0; y < h && clear; y++) if (alpha(y, i) > 128 || alpha(y, w - i - 1) > 128) clear = false
  }
  if (clear) return png
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, m, m, w - 2 * m, h - 2 * m)
  const b64 = cv.toDataURL('image/png').split(',')[1]
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function renderCustomIcon(s: any): void {
  const remote = (): any => nodeRequire<any>('@electron/remote')
  const path = (): any => nodeRequire<any>('path')
  const iconUrl = (name: string): string => {
    let href: string = nodeRequire<any>('url').pathToFileURL(path().join(remote().app.getPath('userData'), name)).href
    if (href.startsWith('file:///')) href = href.substring(8)
    else if (href.startsWith('file://')) href = '%5C%5C' + href.substring(7)
    return ((window as any).app?.vault?.adapter?.resourcePathPrefix ?? '') + href + '?' + Date.now()
  }
  let reset: any
  let relaunch: any
  const refresh = (): void => {
    let name: string | null = null
    try {
      name = ipc().sendSync('get-icon')
    } catch {
      /* no main process (tests) */
    }
    reset.extraSettingsEl.toggle(!!name)
    if (name) s.setDesc(createFragment(f => f.createEl('img', { attr: { width: 64, height: 64, src: iconUrl(name) } })))
    else s.setDesc(t(A + 'optionCustomIconDesc'))
  }
  s.addExtraButton((b: any) => {
    reset = b.setIcon('lucide-rotate-ccw').setTooltip(t('setting.hotkeys.tooltipRestoreDefault')).onClick(() => {
      ipc().sendSync('set-icon', null, null)
      refresh()
      relaunch.buttonEl.show()
    })
  })
  s.addButton((b: any) =>
    b.setButtonText(t('dialogue.buttonChoose')).onClick(async () => {
      const picked: string[] | undefined = remote().dialog.showOpenDialogSync({
        title: t(A + 'optionCustomIcon'),
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'PNG/ICO/ICNS', extensions: ['png', 'ico', 'icns'] }]
      })
      if (!picked || !picked.length) return
      let ext = path().extname(picked[0]).slice(1).toLowerCase()
      if (!['png', 'ico', 'icns'].includes(ext)) return void new Notice('Supported file types are: png, ico, icns')
      let data = new Uint8Array(nodeRequire<any>('fs').readFileSync(picked[0]))
      if (ext === 'icns') {
        const png = pngFromIcns(data)
        if (!png) return void new Notice('This icns file does not have usable icons.')
        data = png
        ext = 'png'
      }
      if (ext === 'ico' && process.platform !== 'win32') {
        const png = pngFromIco(data)
        if (!png) return void new Notice('This ico file does not have usable icons.')
        data = png
        ext = 'png'
      }
      if (ext === 'png') data = await padIcon(data)
      ipc().sendSync('set-icon', 'icon.' + ext, data)
      refresh()
      relaunch.buttonEl.show()
    })
  )
  s.addButton((b: any) => {
    relaunch = b
    b.setCta().setButtonText(t('setting.about.buttonRelaunch')).onClick(() => ipc().sendSync('relaunch'))
    b.buttonEl.hide()
  })
  refresh()
}
