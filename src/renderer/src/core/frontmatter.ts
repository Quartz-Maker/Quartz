/**
 * Parse YAML frontmatter from markdown content.
 * Returns properties and the character offset where the body starts.
 */
export function parseFrontmatter(content: string): { properties: Record<string, any>; bodyStart: number } {
  if (!content.startsWith('---')) {
    return { properties: {}, bodyStart: 0 }
  }

  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) {
    return { properties: {}, bodyStart: 0 }
  }

  const yamlBlock = content.substring(4, endIdx).trim()
  const bodyStart = endIdx + 4 // after \n---

  const properties: Record<string, any> = {}

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx <= 0) continue

    const key = line.substring(0, colonIdx).trim()
    let value: any = line.substring(colonIdx + 1).trim()

    // Type inference
    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (value === '' || value === 'null') value = null
    else if (/^\d+$/.test(value)) value = parseInt(value, 10)
    else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value)
    else if (/^\d{4}-\d{2}-\d{2}/.test(value)) value = value // Keep as date string
    else if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array: [item1, item2]
      value = value.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean)
    }
    // Strip surrounding quotes
    else if ((value.startsWith('"') && value.endsWith('"')) ||
             (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    properties[key] = value
  }

  return { properties, bodyStart }
}

/**
 * Serialize properties back into frontmatter + body content.
 */
export function serializeFrontmatter(properties: Record<string, any>, body: string): string {
  const keys = Object.keys(properties).filter(k => properties[k] !== null && properties[k] !== undefined)

  if (keys.length === 0) {
    return body
  }

  const lines: string[] = ['---']

  for (const key of keys) {
    const value = properties[key]
    lines.push(`${key}: ${formatValue(value)}`)
  }

  lines.push('---')
  lines.push('')

  // Ensure body doesn't start with extra newlines
  const cleanBody = body.startsWith('\n') ? body : body

  return lines.join('\n') + cleanBody
}

/**
 * Update frontmatter of existing content.
 * Preserves body, replaces frontmatter block.
 */
export function updateFrontmatter(content: string, newProperties: Record<string, any>): string {
  const { bodyStart } = parseFrontmatter(content)
  const body = bodyStart > 0 ? content.substring(bodyStart) : content
  return serializeFrontmatter(newProperties, body)
}

/**
 * Add a single property to existing frontmatter.
 */
export function addProperty(content: string, key: string, value: any): string {
  const { properties, bodyStart } = parseFrontmatter(content)
  properties[key] = value
  const body = bodyStart > 0 ? content.substring(bodyStart) : content
  return serializeFrontmatter(properties, body)
}

function formatValue(value: any): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  if (typeof value === 'string') {
    // Quote if contains special chars
    if (value.includes(':') || value.includes('#') || value.includes('{')) {
      return `"${value}"`
    }
    return value
  }
  return String(value)
}
