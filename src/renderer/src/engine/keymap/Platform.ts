// Plugin API `Platform`. Detection uses Node's process.platform
// when available, else the user agent. Quartz is always the desktop app.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type OSName = 'win' | 'mac' | 'linux' | 'unknown'

function detectOS(): OSName {
  const p = typeof process !== 'undefined' && (process as any)?.platform ? String((process as any).platform) : ''
  if (p === 'win32') return 'win'
  if (p === 'darwin') return 'mac'
  if (p === 'linux') return 'linux'
  if (p) return 'unknown'
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (ua.indexOf('Win') !== -1) return 'win'
  if (ua.indexOf('Mac') !== -1) return 'mac'
  if (ua.indexOf('X11') !== -1 || ua.indexOf('Linux') !== -1) return 'linux'
  return 'unknown'
}

const os = detectOS()
const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: os === 'mac',
  isWin: os === 'win',
  isLinux: os === 'linux',
  isSafari: /^((?!chrome|android).)*safari/i.test(ua),
  resourcePathPrefix: 'file:///',
  get canExportPdf() { return Platform.isDesktopApp },
  get canPopoutWindow() { return Platform.isDesktopApp && Platform.isDesktop },
  get canStackTabs() { return !Platform.isPhone },
  get canSplit() { return !Platform.isPhone },
  get canDisplayRibbon() { return !Platform.isPhone },
  get canPinSidebar() { return Platform.isMobile && !Platform.isPhone },
  get canOpenExternalFiles() { return Platform.isDesktopApp && Platform.isDesktop },
  supportsIndexedDb: typeof window !== 'undefined' && !!(window as any).indexedDB,
  mobileSoftKeyboardVisible: false,
  hasPhysicalKeyboard: true,
  version: '',
  build: '',
  manufacturer: '',
  model: '',
  osName: '',
  osVersion: '',
  deviceName: ''
}
