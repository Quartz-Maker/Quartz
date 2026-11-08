import { getApp } from '@/engine/App'
import { readTemplate } from './templates'

/** Options of the Daily notes core plugin (`<configDir>/daily-notes.json`). */
function options(): { folder?: string; format?: string; template?: string } {
  return (getApp() as any)?.internalPlugins?.plugins?.['daily-notes']?.instance?.options ?? {}
}
const moment = (d?: Date): any => (window as any).moment(d)

function folderOf(vaultPath: string): string {
  const f = (options().folder ?? '').replace(/^\/+|\/+$/g, '')
  return f ? `${vaultPath}/${f}` : vaultPath
}

/**
 * Get the file path for a daily note (`format` may contain folders, e.g. YYYY/MM/YYYY-MM-DD).
 */
export function getDailyNotePath(vaultPath: string, date?: Date): string {
  const name = moment(date).format(options().format || 'YYYY-MM-DD')
  return `${folderOf(vaultPath)}/${name}.md`
}

/**
 * Open or create today's daily note (template from the plugin options, if any).
 */
export async function openOrCreateDailyNote(vaultPath: string): Promise<string> {
  const filePath = getDailyNotePath(vaultPath)
  const dirPath = filePath.slice(0, filePath.lastIndexOf('/'))
  await window.quartzAPI.vault.createDir(dirPath)
  const existing = await window.quartzAPI.vault.stat(filePath)
  if (existing) return filePath
  const tpl = (options().template ?? '').replace(/^\/+/, '')
  let content = ''
  if (tpl) {
    const templatePath = `${vaultPath}/${/\.md$/.test(tpl) ? tpl : tpl + '.md'}`
    content = (await readTemplate(templatePath, moment().format(options().format || 'YYYY-MM-DD'))) ?? ''
  }
  await window.quartzAPI.vault.createFile(filePath, content)
  return filePath
}

/**
 * Get previous/next daily note paths for navigation.
 */
export function getAdjacentDailyNotePath(vaultPath: string, currentDate: string, direction: 'prev' | 'next'): string {
  const current = moment(new Date(currentDate))
  const adjacent = direction === 'next' ? current.add(1, 'day') : current.subtract(1, 'day')
  return getDailyNotePath(vaultPath, adjacent.toDate())
}
