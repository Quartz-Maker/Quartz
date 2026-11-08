import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'

interface SlashCommand {
  label: string
  detail: string
  insert: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { label: 'Heading 1', detail: 'h1', insert: '# ' },
  { label: 'Heading 2', detail: 'h2', insert: '## ' },
  { label: 'Heading 3', detail: 'h3', insert: '### ' },
  { label: 'Heading 4', detail: 'h4', insert: '#### ' },
  { label: 'Bullet list', detail: 'list', insert: '- ' },
  { label: 'Numbered list', detail: 'ordered', insert: '1. ' },
  { label: 'Task list', detail: 'todo', insert: '- [ ] ' },
  { label: 'Blockquote', detail: 'quote', insert: '> ' },
  { label: 'Code block', detail: 'code', insert: '```\n\n```' },
  { label: 'Horizontal rule', detail: 'hr', insert: '---\n' },
  { label: 'Bold', detail: 'bold', insert: '****' },
  { label: 'Italic', detail: 'italic', insert: '**' },
  { label: 'Link', detail: 'link', insert: '[](url)' },
  { label: 'Image', detail: 'img', insert: '![alt](url)' },
  { label: 'Table', detail: 'table', insert: '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |' },
  { label: 'Callout', detail: 'callout', insert: '> [!note]\n> ' },
]

function slashCommandCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const textBefore = line.text.slice(0, context.pos - line.from)
  
  // Only trigger on / at start of line or after space
  const match = textBefore.match(/(?:^|\s)\/(\w*)$/)
  if (!match) return null

  const query = match[1].toLowerCase()
  const from = context.pos - match[1].length - 1  // Include the /

  const filtered = SLASH_COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(query) || cmd.detail.includes(query)
  )

  if (filtered.length === 0) return null

  return {
    from,
    options: filtered.map(cmd => ({
      label: cmd.label,
      detail: cmd.detail,
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: cmd.insert } })
      }
    }))
  }
}

export const slashCommands = autocompletion({
  override: [slashCommandCompletion],
  activateOnTyping: true
})
