/* eslint-disable @typescript-eslint/no-explicit-any */
// "General" tab (id `about`).
import { t } from '../i18n'
import pkg from '../../../../../../package.json'
import { BuiltinTab, REPO_URL, lsGet, lsSet, sendSync } from '../util'

const LANGUAGES: [string, string][] = [
  ['am', 'አማርኛ'], ['ar', 'اَلْعَرَبِيَّةُ'], ['be', 'беларуская мова'], ['bg', 'български език'], ['bn', 'বাংলা'], ['ca', 'català'], ['cs', 'čeština'], ['da', 'Dansk'],
  ['de', 'Deutsch'], ['el', 'Ελληνικά'], ['en', 'English'], ['en-GB', 'English (GB)'], ['es', 'Español'], ['fa', 'فارسی'], ['fi', 'suomi'], ['fr', 'Français'],
  ['ga', 'Gaeilge'], ['gl', 'Galego'], ['he', 'עברית'], ['hu', 'Magyar'], ['id', 'Bahasa Indonesia'], ['it', 'Italiano'], ['ja', '日本語'], ['ka', 'ქართული'],
  ['kab', 'Taqbaylit'], ['km', 'ខ្មែរ'], ['ko', '한국어'], ['lv', 'Latviešu'], ['ms', 'Bahasa Melayu'], ['ne', 'नेपाली'], ['nl', 'Nederlands'], ['no', 'Norsk'],
  ['pl', 'Polski'], ['pt', 'Português'], ['pt-BR', 'Português do Brasil'], ['ro', 'Română'], ['ru', 'Pусский'], ['sa', 'संस्कृतम्'], ['si', 'සිංහල'], ['sk', 'Slovenčina'],
  ['sq', 'Shqip'], ['sr', 'српски језик'], ['sv', 'Svenska'], ['ta', 'தமிழ்'], ['th', 'ไทย'], ['tr', 'Türkçe'], ['uk', 'Українська'], ['uz', 'oʻzbekcha'],
  ['vi', 'Tiếng Việt'], ['zh', '简体中文'], ['zh-TW', '繁體中文']
]
const VERSION: string = pkg.version

export class AboutTab extends BuiltinTab {
  constructor(app: any) {
    super(app, 'about', t('setting.about.name'), 'circle-user')
  }

  getSettingDefinitions(): any[] {
    const app = this.app
    const defs: any[] = []
    defs.push({
      name: t('setting.about.labelVersion', { version: VERSION }),
      desc: 'Quartz is open source software released under the MIT license.',
      render: (s: any) => s.addButton((b: any) => b.setButtonText('GitHub').onClick(() => window.open(REPO_URL)))
    })
    defs.push({
      name: t('setting.about.optionLanguage'),
      desc: t('setting.about.optionLanguageDescription'),
      render: (s: any) => {
        const cur: string = lsGet(app, 'language') ?? 'en'
        let chosen = cur
        let relaunch: any
        s.addButton((b: any) => {
          relaunch = b
          b.setCta().setButtonText(t('setting.about.buttonRelaunch')).onClick(() => {
            localStorage.setItem('language', chosen)
            window.location.reload()
          })
          b.buttonEl.hide()
        })
        s.addDropdown((d: any) => {
          for (const [code, name] of LANGUAGES) d.addOption(code, name)
          d.setValue(cur).onChange((v: string) => {
            chosen = v
            relaunch.buttonEl.toggle(cur !== v)
          })
        })
      }
    })
    defs.push({
      name: t('setting.about.optionGetHelp'),
      desc: t('setting.about.optionGetHelpDescription'),
      render: (s: any) => s.addButton((b: any) => b.setButtonText(t('setting.about.buttonOpen')).onClick(() => window.open(REPO_URL + '/issues')))
    })
    defs.push({
      type: 'group',
      heading: t('setting.about.optionAdvanced'),
      items: [
        {
          name: t('setting.about.optionCheckSlowStartup'),
          desc: t('setting.about.optionCheckSlowStartupDescription'),
          render: (s: any) => {
            s.addExtraButton((b: any) =>
              b.setIcon('lucide-timer').setTooltip(t('setting.about.buttonCheckStartup')).onClick(async () => {
                const { StartupTimeModal } = await import('../../ui/StartupTimeModal')
                new StartupTimeModal(app, VERSION).open()
              })
            )
            s.addToggle((tg: any) => tg.setValue(!!lsGet(app, 'slow-startup-check')).onChange((v: boolean) => lsSet(app, 'slow-startup-check', v ? '1' : null)))
          }
        },
        {
          name: t('setting.about.optionCli'),
          desc: t('setting.about.optionCliDescription'),
          render: (s: any) => s.addToggle((tg: any) => tg.setValue(!!sendSync('cli', null)).onChange((v: boolean) => sendSync('cli', v)))
        },
        {
          name: t('setting.about.optionHwAcceleration'),
          desc: t('setting.about.optionHwAccelerationDescription') + ' ' + t('setting.about.optionHwAccelerationWarning'),
          render: (s: any) => {
            let btn: any
            s.addButton((b: any) => {
              btn = b
              b.setCta().setButtonText(t('setting.about.buttonRelaunch')).onClick(() => sendSync('relaunch'))
              b.buttonEl.hide()
            })
            s.addToggle((tg: any) =>
              tg.setValue(!sendSync('disable-gpu')).onChange((v: boolean) => {
                sendSync('disable-gpu', !v)
                btn.buttonEl.show()
              })
            )
          }
        }
      ]
    })
    return defs
  }
}
