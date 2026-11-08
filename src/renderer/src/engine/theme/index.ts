// Quartz's base stylesheet (community-theme-compatible theming contract) + appearance wiring.
// Import once at boot, before any component CSS.
//   fonts      - bundled open fonts: Inter (inter-ui, full variable font), Source Code Pro and Flow Circular (@fontsource)
//   variables  - the full CSS custom-property contract (generated from measurements)
//   components - per-component rules keyed on the app's DOM classes (generated)
//   legacy     - aliases of the old Quartz variable names for the remaining React UI
import './fonts'
import '@fontsource/source-code-pro/400.css'
import '@fontsource/source-code-pro/400-italic.css'
import '@fontsource/source-code-pro/700.css'
import '@fontsource/source-code-pro/700-italic.css'
import '@fontsource/flow-circular/400.css'
import './variables.css'
import './components.css'
import './overrides.css'
import './legacy.css'

export * from './appearance'
export * from './styleOrder'
