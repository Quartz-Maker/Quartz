/* eslint-disable @typescript-eslint/no-explicit-any */
// MathJax 4.1.3 (Apache-2.0) configured with:
// TeX input with an extra package list, CHTML output with the MathJax-TeX font and
// the mhchem font extension, menu off, safe protocols http/https/file. Bundled statically
// (no runtime loader), loaded lazily by mathjax.ts.
import { mathjax } from '@mathjax/src/mjs/mathjax.js'
import { TeX } from '@mathjax/src/mjs/input/tex.js'
import { CHTML } from '@mathjax/src/mjs/output/chtml.js'
import { browserAdaptor } from '@mathjax/src/mjs/adaptors/browserAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js'
import '@mathjax/src/mjs/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js'
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
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/mjs/chtml.js'
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/mjs/chtml.js'
import { MATHJAX_TEX_PACKAGES, type MathJaxLike } from './mathjax'

export function createMathJax(): MathJaxLike {
  ;(MathJaxTexFont as any).addExtension(MathJaxMhchemFontExtension)
  const adaptor = browserAdaptor()
  RegisterHTMLHandler(adaptor)
  const tex = new TeX({
    packages: ['base', 'ams', 'newcommand', 'noundefined', 'configmacros', ...MATHJAX_TEX_PACKAGES],
    macros: { RequirePackage: ['\\require{#1}', 1], usepackage: ['\\require{#1}', 1] },
    inlineMath: [],
    displayMath: [],
    processEscapes: false,
    processEnvironments: false,
    processRefs: false
  } as any)
  const chtml = new CHTML({ fontData: MathJaxTexFont, fontURL: 'lib/mathjax/woff2' } as any) // same served fonts as the editor engine
  const doc = mathjax.document(document, {
    InputJax: tex,
    OutputJax: chtml,
    enableMenu: false,
    safeOptions: { safeProtocols: { http: true, https: true, file: true, javascript: false, data: false } }
  } as any)
  return {
    tex2chtml(src: string, opts: { display: boolean }): Element {
      return doc.convert(src, { display: opts.display }) as Element
    },
    chtmlStylesheet(): HTMLStyleElement {
      return chtml.styleSheet(doc) as HTMLStyleElement
    }
  }
}
