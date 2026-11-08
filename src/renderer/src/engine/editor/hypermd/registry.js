// Builds the CodeMirror 5 mode registry the editor relies on: xml / htmlmixed / yaml /
// markdown, the hypermd mode, meta.js mode lookup, and the legacy language modes for fenced code.
import { createModeSystem } from './cm5/codemirror.js'
import installMeta from './cm5/meta.js'
import installOverlay from './cm5/addons/overlay.js'
import installXml from './cm5/modes/xml.js'
import installHtmlMixed from './cm5/modes/htmlmixed.js'
import installYaml from './cm5/modes/yaml.js'
import installMarkdown from './markdown.js'
import installHyperMD from './hypermd.js'
import { lazyModeInstallers } from './cm5/lazyModes.js'

let registry = null

/** The shared CM5-compatible mode registry (created on first use). */
export function getModeRegistry() {
  if (registry) return registry
  const CM = createModeSystem()
  installOverlay(CM)
  installXml(CM)
  installHtmlMixed(CM)
  installYaml(CM)
  installMarkdown(CM)
  installHyperMD(CM)
  installMeta(CM)
  for (const install of lazyModeInstallers) install(CM)
  registry = CM
  return CM
}
