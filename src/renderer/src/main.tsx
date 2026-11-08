import { installEnhancements } from './engine/core/enhance'
import { installFrame } from './engine/app/frame'
import { installBodyClasses } from './engine/theme'
import { wireReadingRendererIntoLivePreview } from './engine/editor/wireReadingRenderer'
import { useVaultRegistryStore } from './stores/vaultRegistry'
import './styles/globals.css'

// Install the DOM/builtin helpers before anything else runs.
installEnhancements()
installBodyClasses()
// Live Preview block widgets render through the reading renderer (callouts, embeds, code blocks).
wireReadingRendererIntoLivePreview()
installFrame()

// The main process owns the window → vault mapping (`vault` IPC). A vault window boots
// the imperative shell straight into <body>; the starter window shows the vault picker.
const current = useVaultRegistryStore.getState().currentVault()
if (current.path) {
  void import('./shell/boot').then(m => m.bootVaultWindow(current.path!, current.configPath)).catch(e => {
    console.error('Failed to load vault', e)
    document.body.createDiv({ cls: 'quartz-boot-error', text: 'Failed to load vault: ' + String(e?.message ?? e) })
  })
} else {
  void import('./engine/app/starter').then(m => m.mountStarter())
}
