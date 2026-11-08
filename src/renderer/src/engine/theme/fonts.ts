// Inter as one full variable face named "Inter" (like the reference; the unicode-range subsets of the
// @fontsource build lacked symbols such as ↵, so those fell back to another font).
import interNormal from 'inter-ui/variable/InterVariable.woff2?url'
import interItalic from 'inter-ui/variable/InterVariable-Italic.woff2?url'

if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.id = 'quartz-fonts'
  style.textContent =
    `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(${interNormal}) format("woff2")}` +
    `@font-face{font-family:"Inter";font-style:italic;font-weight:100 900;font-display:swap;src:url(${interItalic}) format("woff2")}`
  document.head.prepend(style)
}
