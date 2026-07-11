import { stripInlineMarkdown } from './titles'

const HEADING_RE = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/

// Pro zobrazení v detailu: když se první nadpis obsahu shoduje s titlem,
// odstraní ho (jinak by se název ukázal dvakrát). Když se liší, obsah nechá.
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
