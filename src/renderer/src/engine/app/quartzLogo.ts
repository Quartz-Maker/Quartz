// Quartz brand mark: the pixel-art quartz crystal (repo `icon-512.png`). Always drawn with nearest-neighbour
// scaling (`image-rendering: pixelated`) so the pixels stay crisp at any size.
export const QUARTZ_LOGO_URL: string = new URL('../../assets/quartz-logo.png', import.meta.url).href

/** `<svg class="..."><image/></svg>` holding the logo (same element shape as other logo svgs). */
export function quartzLogoSvg(cls: string, size: number): string {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image href="${QUARTZ_LOGO_URL}" width="${size}" height="${size}" style="image-rendering:pixelated"/></svg>`
}

let cached: Promise<HTMLImageElement> | null = null
/** The logo as a loaded image (for canvas drawing). */
export function loadQuartzLogo(): Promise<HTMLImageElement> {
  cached ??= new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = QUARTZ_LOGO_URL
  })
  return cached
}
