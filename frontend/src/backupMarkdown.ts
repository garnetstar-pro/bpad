// The human-readable half of a plain backup: one markdown file per note, with
// image links pointing at the archive's images/ folder. Nothing here is ever
// read back — backup.json is the only source of truth for an import. Encrypted
// backups skip this entirely; it would hand out the very text the passphrase
// was meant to cover.
import { localizeImageRefs } from './imageRefs'
import type { BackupNote } from './backup'

const MAX_SLUG = 50

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks left over by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '')
  return slug || 'untitled'
}

// Minimal YAML quoting — enough for a title, which is the only free text here.
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function renderNoteMarkdown(note: BackupNote, paths: Map<string, string>): string {
  const front = [
    '---',
    `title: ${yamlString(note.title)}`,
    `created: ${note.created_at}`,
    `updated: ${note.updated_at}`,
    `tags: [${note.tags.map(yamlString).join(', ')}]`,
    '---',
    '',
  ].join('\n')
  return `${front}\n${localizeImageRefs(note.content, paths)}\n`
}

export function buildMarkdownFiles(
  notes: BackupNote[],
  paths: Map<string, string>,
): Record<string, string> {
  const files: Record<string, string> = {}
  for (const note of notes) {
    const base = `${note.created_at.slice(0, 10)}-${slugify(note.title)}`
    let name = `${base}.md`
    for (let n = 2; name in files; n++) name = `${base}-${n}.md`
    files[name] = renderNoteMarkdown(note, paths)
  }
  return files
}
