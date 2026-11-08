// Side-effect CSS imports are handled by Vite.
declare module '*.css'

/** Vite `?url` asset imports (font files). */
declare module '*?url' {
  const url: string
  export default url
}
