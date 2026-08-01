// In-memory cache of decrypted images, keyed by bpad image id. The values are
// object URLs; the picture's bytes live in the Blob each URL points at, so an
// entry dropped without revokeObjectURL leaks for the lifetime of the tab —
// every removal path below revokes.
//
// Deliberately import-free: session.ts has to empty this cache, and images.ts
// already imports session.ts, so reaching from here into images.ts would close
// the cycle session → imageCache → images → session.

interface Entry {
  url: string
  // Only accounting for the cap; the bytes themselves belong to the Blob.
  size: number
}

// Roughly a few dozen pictures at the sizes processImage produces (1600 px WebP).
const MAX_BYTES = 24 * 1024 * 1024

// A Map iterates in insertion order, so re-inserting on read makes the first
// key the least recently used one — LRU eviction for free.
const entries = new Map<string, Entry>()
let total = 0

function drop(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  entries.delete(id)
  total -= entry.size
  URL.revokeObjectURL(entry.url)
}

export function getCachedImage(id: string): string | undefined {
  const entry = entries.get(id)
  if (!entry) return undefined
  entries.delete(id)
  entries.set(id, entry)
  return entry.url
}

export function putCachedImage(id: string, url: string, size: number): void {
  drop(id)
  entries.set(id, { url, size })
  total += size
  // Never evict the entry just added: a single picture over the cap is still
  // better cached than downloaded again for the render happening right now.
  while (total > MAX_BYTES && entries.size > 1) {
    drop(entries.keys().next().value as string)
  }
}

export function clearImageCache(): void {
  for (const entry of entries.values()) URL.revokeObjectURL(entry.url)
  entries.clear()
  total = 0
}
