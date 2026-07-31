// The bpad-img: reference scheme as pure text operations. Split out of
// images.ts, which reaches for the session and the network, so the backup
// format modules can depend on this without dragging either in.

// Matches an image (not a link): ![alt](bpad-img:ID). IDs are uuid-shaped.
// Built fresh per call: a shared /g regex carries lastIndex between calls.
// Three groups: (1) "![alt](", (2) the ID, (3) ")" — so replacement is anchored to the ref.
const IMG_PATTERN = '(!\\[[^\\]]*\\]\\()bpad-img:([A-Za-z0-9-]+)(\\))'
const imgRe = () => new RegExp(IMG_PATTERN, 'g')

export function parseImageIds(markdown: string): string[] {
  const ids = new Set<string>()
  for (const m of markdown.matchAll(imgRe())) ids.add(m[2])
  return [...ids]
}

// Point every reference at its replacement id. An id missing from the map is
// left as it is: on import that means one broken picture, which beats losing
// the note it sits in.
export function rewriteImageRefs(markdown: string, map: Map<string, string>): string {
  return markdown.replace(imgRe(), (_: unknown, open: string, id: string, close: string) => {
    const next = map.get(id)
    return `${open}bpad-img:${next ?? id}${close}`
  })
}

// Replace ids with their position in the text (#1, #2, …). An import uploads
// every image afresh and rewrites the ids, so raw content cannot recognise a
// note it has already restored — the normalised form can.
export function normalizeImageRefs(markdown: string): string {
  const seen = new Map<string, number>()
  return markdown.replace(imgRe(), (_: unknown, open: string, id: string, close: string) => {
    let idx = seen.get(id)
    if (idx === undefined) {
      idx = seen.size + 1
      seen.set(id, idx)
    }
    return `${open}bpad-img:#${idx}${close}`
  })
}

// Swap the scheme for a plain relative path. Only the human-readable markdown
// export uses this — nothing produced by it is ever imported back.
export function localizeImageRefs(markdown: string, paths: Map<string, string>): string {
  return markdown.replace(imgRe(), (_: unknown, open: string, id: string, close: string) => {
    const path = paths.get(id)
    return path ? `${open}${path}${close}` : `${open}bpad-img:${id}${close}`
  })
}
