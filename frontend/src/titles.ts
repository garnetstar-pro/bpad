// Odvození titulku poznámky z markdownu — klientská verze (server na obsah
// nevidí). Musí odpovídat dřívějšímu backendovému chování.

const IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK_RE = /\[([^\]]+)\]\([^)]*\)/g
const CODE_RE = /`([^`]+)`/g
const EMPHASIS_RE = /(\*\*\*|\*\*|\*|___|__|_)(.+?)\1/g
const STRIKE_RE = /~~(.+?)~~/g

// Odstraní inline markdown (tučné, kurzíva, odkazy, obrázky, kód) na plain text.
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

// První ATX nadpis, jinak první neprázdný řádek, jinak placeholder.
export function extractTitle(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const m = line.match(HEADING_RE)
    if (m) return stripInlineMarkdown(m[1])
  }
  for (const line of lines) {
    if (line.trim()) return stripInlineMarkdown(line)
  }
  return '(bez názvu)'
}

// Použij zadaný titulek, jinak ho odvoď z obsahu (nikdy prázdný).
export function resolveTitle(title: string | undefined, content: string): string {
  if (title && title.trim()) return title.trim()
  return extractTitle(content)
}
