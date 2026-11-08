// Window frame. The main process creates
// windows frameless unless `quartz.json` has `frame: "native"`; the renderer then draws a
// `.titlebar` with this DOM/classes:
//   body.is-frameless[.is-hidden-frameless] > div.titlebar > div.titlebar-inner >
//     div.titlebar-text | div.titlebar-button-container.mod-left | …mod-right > div.titlebar-button.mod-{minimize,maximize,close}
//
// In "hidden" mode the bar is an overlay (shell/shell.css): the workspace tab header strips are
// the drag region and leave room for the window buttons.
import { electron } from '@/engine/node'
import { quartzLogoSvg } from './quartzLogo'

const MAXIMIZE_SVG =
  '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect></svg>'
const RESTORE_SVG =
  '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3.5H8.5V10.5H1.5V3.5Z" stroke="currentColor"/> <path d="M4 2H10V8H9V9H11V1H3V3H4V2Z" fill="currentColor"/></svg>'
const MINIMIZE_SVG =
  '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6"></rect></svg>'
const CLOSE_SVG =
  '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"> <path fill="currentColor" fill-rule="evenodd" d="M10.052 10.968 1.03 1.93l.849-.848 9.023 9.037-.849.848Z"/><path fill="currentColor" fill-rule="evenodd" d="M1.023 10.112 10.06 1.09l.848.85-9.037 9.023-.848-.85Z"/></svg>'

// Titlebar styling comes from the theme (engine/theme); only the React starter window's
// #root needs layout help here.
// Body stays display:block: a flex body let in-flow helpers appended to <body> (e.g. the
// tab-drag `.workspace-fake-target-container`) steal height from `.app-container`.
const CSS = ``

/** Installs the custom titlebar into `hostWin` (the main window, or a popout whose `electron`/`electronWindow` are set). */
export function installFrame(hostWin: any = window): void {
  let style: string = 'hidden'
  let win: any
  try {
    const el = (hostWin === window ? electron() : hostWin.electron) as any
    style = el.ipcRenderer.sendSync('frame') || 'hidden'
    win = hostWin === window ? el.remote?.getCurrentWindow() : hostWin.electronWindow
  } catch {
    return
  }
  hostWin.titlebarStyle = style
  if (style === 'native' || !win) return
  const doc: Document = hostWin.document
  const body = doc.body
  body.classList.add('is-frameless')
  if (style === 'hidden') body.classList.add('is-hidden-frameless')
  const isMac = process.platform === 'darwin'
  if (isMac) body.classList.add('mod-macos')
  const css = doc.createElement('style')
  css.textContent = CSS
  doc.head.appendChild(css)

  const bar = doc.createElement('div')
  bar.className = 'titlebar'
  body.insertBefore(bar, body.firstChild)
  const inner = bar.appendChild(doc.createElement('div'))
  inner.className = 'titlebar-inner'
  const text = inner.appendChild(doc.createElement('div'))
  text.className = 'titlebar-text'
  text.textContent = 'Quartz'
  let titleEl = doc.head.querySelector('title')
  if (!titleEl) titleEl = doc.head.appendChild(doc.createElement('title'))
  const updateTitle = (): void => {
    text.textContent = doc.title
  }
  new MutationObserver(updateTitle).observe(titleEl, { subtree: true, characterData: true, childList: true })
  updateTitle()
  const left = inner.appendChild(doc.createElement('div'))
  left.className = 'titlebar-button-container mod-left'
  if (!isMac) {
    // `.titlebar-button.mod-logo > svg.logo-full + svg.logo-wireframe` (the pixel-art Quartz mark).
    const logo = left.appendChild(doc.createElement('div'))
    logo.className = 'titlebar-button mod-logo'
    logo.innerHTML = quartzLogoSvg('logo-full', 14) + quartzLogoSvg('logo-wireframe', 14)
  }
  const right = inner.appendChild(doc.createElement('div'))
  right.className = 'titlebar-button-container mod-right'
  if (isMac) return
  const button = (cls: string, svg: string, label: string, onclick: () => void): HTMLDivElement => {
    const b = right.appendChild(doc.createElement('div'))
    b.className = 'titlebar-button ' + cls
    b.innerHTML = svg
    b.setAttribute('aria-label', label)
    b.onclick = onclick
    return b
  }
  if (win.minimizable) button('mod-minimize', MINIMIZE_SVG, 'Minimize', () => win.minimize())
  if (win.maximizable) {
    const max = button('mod-maximize', MAXIMIZE_SVG, 'Maximize', () => {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      sync()
    })
    const sync = (): void => {
      const m = win.isMaximized()
      max.innerHTML = m ? RESTORE_SVG : MAXIMIZE_SVG
      max.setAttribute('aria-label', m ? 'Restore down' : 'Maximize')
    }
    sync()
    hostWin.addEventListener('resize', sync)
  }
  if (win.closable) button('mod-close', CLOSE_SVG, 'Close window', () => win.close())
}
