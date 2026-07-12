// Derives a note's title from its markdown — client-side version (the
// server never sees the content). Must match the earlier backend behavior.
import { translate } from './i18n'

const IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK_RE = /\[([^\]]+)\]\([^)]*\)/g
const CODE_RE = /`([^`]+)`/g
const EMPHASIS_RE = /(\*\*\*|\*\*|\*|___|__|_)(.+?)\1/g
const STRIKE_RE = /~~(.+?)~~/g

// Strips inline markdown (bold, italic, links, images, code) down to plain text.
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(IMAGE_RE, '$1')
    .replace(LINK_RE, '$1')
    .replace(CODE_RE, '$1')
    .replace(EMPHASIS_RE, '$2')
    .replace(STRIKE_RE, '$1')
    .trim()
}

const HEADING_RE = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/

// The first ATX heading, else the first non-blank line, else a placeholder.
export function extractTitle(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const m = line.match(HEADING_RE)
    if (m) return stripInlineMarkdown(m[1])
  }
  for (const line of lines) {
    if (line.trim()) return stripInlineMarkdown(line)
  }
  return translate('common.untitled')
}

// Use the given title if any, else derive it from the content (never empty).
export function resolveTitle(title: string | undefined, content: string): string {
  if (title && title.trim()) return title.trim()
  return extractTitle(content)
}
