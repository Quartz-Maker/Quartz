/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettingTab } from '../plugins/settingTab'
import { electron } from '../node'

/** `app.loadLocalStorage(key)` equivalent (`<appId>-<key>`, JSON encoded). */
export function lsGet(app: any, key: string): any {
  try {
    const v = localStorage.getItem(`${app.appId}-${key}`)
    return v === null ? null : JSON.parse(v)
  } catch {
    return null
  }
}
export function lsSet(app: any, key: string, value: any): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(`${app.appId}-${key}`)
    else localStorage.setItem(`${app.appId}-${key}`, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

/** A text fragment `text<br>link` as used for descriptions with a "Learn more" link. */
export function descWithLink(text: string, linkText: string, href: string, br = true): DocumentFragment {
  return createFragment(f => {
    f.appendText(text)
    if (br) f.createEl('br')
    f.createEl('a', { text: linkText, attr: { href, target: '_blank', rel: 'noopener' } })
  })
}

export function sendSync(channel: string, ...args: any[]): any {
  try {
    return (electron() as any).ipcRenderer.sendSync(channel, ...args)
  } catch {
    return undefined
  }
}

/** Base for built-in tabs: sets id/name/icon. */
export abstract class BuiltinTab extends SettingTab {
  constructor(app: any, id: string, name: string, icon: string) {
    super(app)
    this.id = id
    this.name = name
    this.icon = icon
  }
}

/** Project home (issues, docs). */
export const REPO_URL = 'https://github.com/Quartz-Maker/Quartz'
