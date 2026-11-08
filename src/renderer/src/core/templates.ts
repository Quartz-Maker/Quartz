import { getApp } from '@/engine/App'

/** Options of the Templates core plugin (`<configDir>/templates.json`). */
function options(): { folder?: string; dateFormat?: string; timeFormat?: string } {
  return (getApp() as any)?.internalPlugins?.plugins?.templates?.instance?.options ?? {}
}
const moment = (): any => (window as any).moment()

/**
 * Get the templates folder path for a vault.
 */
export function getTemplateFolder(vaultPath: string): string {
  const f = (options().folder ?? '').replace(/^\/+|\/+$/g, '')
  return f ? `${vaultPath}/${f}` : vaultPath
}

/**
 * List all template files in the Templates folder.
 */
export async function listTemplates(vaultPath: string): Promise<Array<{ name: string; path: string }>> {
  const folder = getTemplateFolder(vaultPath)
  const entries = await window.quartzAPI.vault.readDir(folder)
  return entries
    .filter(e => !e.isDirectory && e.name.endsWith('.md'))
    .map(e => ({ name: e.name.replace(/\.md$/, ''), path: e.path }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Read a template and process its variables.
 */
export async function readTemplate(templatePath: string, title: string = 'Untitled'): Promise<string | null> {
  const content = await window.quartzAPI.vault.readFile(templatePath)
  if (content === null) return null
  return processTemplateVariables(content, title)
}

/**
 * Replace template variables with actual values.
 * Supported: {{title}}, {{date}}, {{time}}, {{date:FORMAT}}
 */
export function processTemplateVariables(content: string, title: string): string {
  const now = moment()
  const o = options()
  const date = o.dateFormat || 'YYYY-MM-DD'
  const time = o.timeFormat || 'HH:mm'
  return content
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_m, f?: string) => now.format(f || date))
    .replace(/\{\{time(?::([^}]+))?\}\}/g, (_m, f?: string) => now.format(f || time))
}

/**
 * Create a new file from a template.
 */
export async function createFromTemplate(
  templatePath: string,
  targetPath: string
): Promise<boolean> {
  const title = (targetPath.split('/').pop() || 'Untitled').replace(/\.md$/, '')
  const content = await readTemplate(templatePath, title)
  if (content === null) return false
  return await window.quartzAPI.vault.createFile(targetPath, content)
}

/**
 * Ensure the Templates folder exists and create a sample template if empty.
 */
export async function ensureTemplateFolder(vaultPath: string): Promise<void> {
  const folder = getTemplateFolder(vaultPath)
  await window.quartzAPI.vault.createDir(folder)
}
