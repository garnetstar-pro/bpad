import { stripInlineMarkdown } from './titles'

const HEADING_RE = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/

// For the detail view: when the content's first heading matches the title,
// strip it (otherwise the title would show twice). If it differs, leave the content alone.
export function contentWithoutTitleHeading(content: string, title: string): string {
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.trim() !== '')
  if (idx === -1) return content

  const match = lines[idx].match(HEADING_RE)
  if (!match) return content
  if (stripInlineMarkdown(match[1]) !== title.trim()) return content

  const rest = lines.slice(idx + 1)
  if (rest[0] !== undefined && rest[0].trim() === '') rest.shift()
  return rest.join('\n')
}
