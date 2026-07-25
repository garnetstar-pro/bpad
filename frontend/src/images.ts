// Image clippings: parse references out of note markdown, size math, upload,
// and read-URL resolution. Phase 1 stores blobs unencrypted (see the design doc);
// the bpad-img:ID scheme is kept stable so encryption is a later, content-only change.

// Matches an image (not a link): ![alt](bpad-img:ID). IDs are uuid-shaped.
const IMG_RE = /!\[[^\]]*\]\(bpad-img:([A-Za-z0-9-]+)\)/g

export function parseImageIds(markdown: string): string[] {
  const ids = new Set<string>()
  for (const m of markdown.matchAll(IMG_RE)) ids.add(m[1])
  return [...ids]
}

// Fit (w,h) within a max longest-edge, never upscaling.
export function fitDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w, h }
  const scale = max / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}
