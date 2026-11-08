/* eslint-disable @typescript-eslint/no-explicit-any */
// Interface tab (id `interface`) — desktop items only.
import { t } from '../i18n'
import { BuiltinTab, sendSync } from '../util'
import { electron } from '../../node'
import { setIcon } from '../../ui'

const A = 'setting.appearance.'

function webFrame(): any {
  try {
    return (electron() as any).webFrame
  } catch {
    return null
  }
}

/** Ribbon configuration page (buildRibbonPage): visible actions in a list with X (hide) and drag to
 *  rearrange; hidden ones under "Additional ribbon items", click to show again. */
function ribbonPageDef(app: any): any {
  const ribbon = app.workspace.leftRibbon
  const change = (): void => {
    ribbon?.onChange?.(true)
    app.setting.refreshCurrentPage?.()
  }
  return {
    type: 'page',
    name: t(A + 'optionConfigureRibbon'),
    desc: t(A + 'optionConfigureRibbonDesc'),
    items: () => {
      const all: any[] = ribbon?.items ?? []
      // placeholders (no title) keep the saved position of actions whose plugin is not loaded; not listed
      const shown = all.filter(i => !i.hidden && i.title)
      const defs: any[] = [
        {
          type: 'list',
          onReorder: (from: number, to: number) => {
            const a = all.indexOf(shown[from])
            const b = all.indexOf(shown[to])
            const [it] = all.splice(a, 1)
            all.splice(b, 0, it)
            change()
          },
          onDelete: (i: number) => {
            shown[i].hidden = true
            change()
          },
          items: shown.map(i => ({ name: i.title, icon: i.icon, searchable: false }))
        }
      ]
      const hidden = all.filter(i => i.hidden && i.title)
      if (hidden.length)
        defs.push({
          type: 'list',
          heading: t(A + 'labelAdditionalRibbonItems'),
          items: hidden.map(i => ({
            name: i.title,
            icon: i.icon,
            searchable: false,
            action: () => {
              i.hidden = false
              change()
            }
          }))
        })
      return defs
    }
  }
}

export class InterfaceTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'interface', t('setting.interface.name'), 'monitor')
  }

  getSettingDefinitions(): any[] {
    const app = this.app
    const vault = app.vault
    const defs: any[] = []
    defs.push({ name: t(A + 'optionShowViewHeader'), desc: t(A + 'optionShowViewHeaderDesc'), control: { type: 'toggle', key: 'showViewHeader' } })
    defs.push({
      name: t(A + 'optionShowRibbon'),
      desc: t(A + 'optionShowRibbonDesc'),
      render: (s: any) =>
        s.addToggle((tg: any) =>
          tg.setValue(!!vault.getConfig('showRibbon')).onChange((v: boolean) => {
            vault.setConfig('showRibbon', v)
            app.setting.refreshCurrentPage?.()
          })
        )
    })
    if (vault.getConfig('showRibbon')) {
      defs.push(ribbonPageDef(app))
    }
    const adv: any[] = []
    const setZoom = (z: number): void => webFrame()?.setZoomLevel(z)
    adv.push({
      name: t(A + 'optionZoomLevel'),
      desc: t(A + 'optionZoomLevelDescription'),
      render: (s: any) => {
        let btn: any
        let slider: any
        const dis = (v: number): void => btn.extraSettingsEl.setAttribute('aria-disabled', String(v === 0))
        s.addExtraButton((b: any) => {
          btn = b.setIcon('lucide-rotate-ccw').setTooltip(t('setting.hotkeys.tooltipRestoreDefault')).onClick(() => {
            setZoom(0)
            slider.setValue(0)
          })
        })
        s.addSlider((sl: any) => {
          slider = sl
          sl.setDisplayFormat((v: number) => `${Math.round(100 * Math.pow(1.2, v))}%`)
            .setLimits(-2.5, 3, 0.5)
            .setValue(webFrame()?.getZoomLevel() ?? 0)
            .onChange((v: number) => {
              setZoom(v)
              dis(v)
            })
          dis(sl.getValue())
        })
      }
    })
    adv.push({
      name: t(A + 'optionNativeMenus'),
      desc: t(A + 'optionNativeMenusDesc'),
      render: (s: any) => s.addToggle((tg: any) => tg.setValue(!!vault.getConfig('nativeMenus')).onChange((v: boolean) => vault.setConfig('nativeMenus', v)))
    })
    adv.push({
      name: t(A + 'optionFrameStyle'),
      desc: t(A + 'optionFrameDescription'),
      render: (s: any) => {
        let btn: any
        const cur = sendSync('frame')
        s.addButton((b: any) => {
          btn = b
          b.setCta().setButtonText(t('setting.about.buttonRelaunch')).onClick(() => sendSync('relaunch'))
          b.buttonEl.hide()
        })
        s.addDropdown((d: any) => {
          d.onChange((v: string) => {
            sendSync('frame', v)
            btn.buttonEl.show()
          })
          d.addOption('hidden', t(A + 'optionFrameHidden'))
          d.addOption('custom', t(A + 'optionFrameObsidian'))
          d.addOption('native', t(A + 'optionFrameNative'))
          d.setValue(cur || 'hidden')
        })
      }
    })
    adv.push({
      name: t(A + 'optionOpenSettingsInWindow'),
      desc: t(A + 'optionOpenSettingsInWindowDescription'),
      render: (s: any) =>
        s.addToggle((tg: any) =>
          tg.setValue(!!vault.getConfig('settingsPopoutWindow')).onChange((v: boolean) => {
            vault.setConfig('settingsPopoutWindow', v)
            // reopen Settings in the new host (window <-> overlay) on this tab
            const setting = (this.app as any).setting
            setting.close()
            setTimeout(() => {
              setting.open()
              setting.openTab(this)
            })
          })
        )
    })
    defs.push({ type: 'group', heading: t('setting.interface.optionAdvanced'), items: adv })
    return defs
  }
}
