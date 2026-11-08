// Ambient declarations for the legacy (pre-micromark) unified packages the
// reading view is built on. They ship without (usable) typings for our purposes.
declare module 'remark-parse' {
  const parse: any
  export default parse
}
declare module 'remark-parse/lib/util/interrupt' {
  const interrupt: (interruptors: any[], tokenizers: any, ctx: any, params: any[]) => boolean
  export default interrupt
}
declare module 'remark-parse/lib/util/get-indentation' {
  const getIndent: (value: string) => { indent: number; stops: Record<number, number> }
  export default getIndent
}
declare module 'remark-parse/lib/util/remove-indentation' {
  const removeIndent: (value: string, maximum: number) => string
  export default removeIndent
}
declare module 'mdast-util-to-hast' {
  const toHast: any
  export default toHast
}
declare module 'mdast-util-to-hast/lib/all' {
  const all: any
  export default all
}
declare module 'mdast-util-to-hast/lib/wrap' {
  const wrap: any
  export default wrap
}
declare module 'hast-util-to-html' {
  const toHtml: any
  export default toHtml
}
declare module 'unist-util-visit' {
  const visit: any
  export default visit
}
declare module 'mdast-util-definitions' {
  const definitions: any
  export default definitions
}
declare module 'vfile' {
  const vfile: any
  export default vfile
}
declare module 'unist-builder' {
  const u: any
  export default u
}
declare module 'unherit' {
  const unherit: any
  export default unherit
}
declare module 'is-decimal' {
  const decimal: (c: string) => boolean
  export default decimal
}
declare module 'prismjs' {
  const Prism: any
  export default Prism
}
declare module '*.css'
