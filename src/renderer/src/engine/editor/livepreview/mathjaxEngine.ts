// MathJax 4 engine: TeX input with the bundled package list, CHTML output with the `mathjax-tex` font, no menu / enrichment.
// MathJax is Apache-2.0 (https://github.com/mathjax/MathJax-src).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mathjax } from '@mathjax/src/mjs/mathjax.js'
import { TeX } from '@mathjax/src/mjs/input/tex.js'
import { CHTML } from '@mathjax/src/mjs/output/chtml.js'
import { browserAdaptor } from '@mathjax/src/mjs/adaptors/browserAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js'
import { SafeHandler } from '@mathjax/src/mjs/ui/safe/SafeHandler.js'
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/mjs/chtml.js'
import '@mathjax/src/mjs/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/mjs/input/tex/textmacros/TextMacrosConfiguration.js'
import '@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js'
import '@mathjax/src/mjs/input/tex/configmacros/ConfigMacrosConfiguration.js'
import '@mathjax/src/mjs/input/tex/action/ActionConfiguration.js'
import '@mathjax/src/mjs/input/tex/amscd/AmsCdConfiguration.js'
import '@mathjax/src/mjs/input/tex/bbox/BboxConfiguration.js'
import '@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import '@mathjax/src/mjs/input/tex/braket/BraketConfiguration.js'
import '@mathjax/src/mjs/input/tex/bussproofs/BussproofsConfiguration.js'
import '@mathjax/src/mjs/input/tex/cancel/CancelConfiguration.js'
import '@mathjax/src/mjs/input/tex/cases/CasesConfiguration.js'
import '@mathjax/src/mjs/input/tex/centernot/CenternotConfiguration.js'
import '@mathjax/src/mjs/input/tex/color/ColorConfiguration.js'
import '@mathjax/src/mjs/input/tex/colortbl/ColortblConfiguration.js'
import '@mathjax/src/mjs/input/tex/empheq/EmpheqConfiguration.js'
import '@mathjax/src/mjs/input/tex/enclose/EncloseConfiguration.js'
import '@mathjax/src/mjs/input/tex/extpfeil/ExtpfeilConfiguration.js'
import '@mathjax/src/mjs/input/tex/gensymb/GensymbConfiguration.js'
import '@mathjax/src/mjs/input/tex/html/HtmlConfiguration.js'
import '@mathjax/src/mjs/input/tex/mathtools/MathtoolsConfiguration.js'
import '@mathjax/src/mjs/input/tex/mhchem/MhchemConfiguration.js'
import '@mathjax/src/mjs/input/tex/noerrors/NoErrorsConfiguration.js'
import '@mathjax/src/mjs/input/tex/tagformat/TagFormatConfiguration.js'
import '@mathjax/src/mjs/input/tex/textcomp/TextcompConfiguration.js'
import '@mathjax/src/mjs/input/tex/unicode/UnicodeConfiguration.js'
import '@mathjax/src/mjs/input/tex/upgreek/UpgreekConfiguration.js'
import '@mathjax/src/mjs/input/tex/verb/VerbConfiguration.js'
import type { MathEngine } from './math'

export const TEX_PACKAGES = ['base', 'ams', 'newcommand', 'textmacros', 'noundefined', 'configmacros', 'action', 'amscd', 'bbox', 'boldsymbol',
  'braket', 'bussproofs', 'cancel', 'cases', 'centernot', 'color', 'colortbl', 'empheq', 'enclose', 'extpfeil', 'gensymb', 'html', 'mathtools',
  'mhchem', 'noerrors', 'tagformat', 'textcomp', 'unicode', 'upgreek', 'verb']

/** Create the engine. `fontURL` points at the mathjax-tex woff2 directory served to the renderer. */
export function createMathJaxEngine(fontURL?: string): MathEngine {
  const adaptor = browserAdaptor()
  SafeHandler(RegisterHTMLHandler(adaptor) as any)
  const tex = new TeX({ packages: TEX_PACKAGES, macros: { RequirePackage: ['\\require{#1}', 1], usepackage: ['\\require{#1}', 1] }, inlineMath: [], displayMath: [], processEscapes: false, processEnvironments: false, processRefs: false } as any)
  const chtml = new CHTML({ fontData: MathJaxTexFont, ...(fontURL ? { fontURL } : {}) } as any)
  let root: any = document
  try { mathjax.handlers.document(document, {}) } catch { root = document.createDocumentFragment() }
  const doc = mathjax.document(root, { InputJax: tex, OutputJax: chtml, safeOptions: { safeProtocols: { http: true, https: true, file: true, javascript: false, data: false } } } as any)
  return {
    tex2chtml(source, { display }) {
      return doc.convert(source, { display }) as HTMLElement
    },
    chtmlStylesheet() {
      return chtml.styleSheet(doc as any) as HTMLStyleElement
    }
  }
}
