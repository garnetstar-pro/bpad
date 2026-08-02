// ZIP packing for backup archives. Deliberately synchronous: fflate's async API
// starts a Worker from a blob: URL, which our CSP (worker-src 'self', see
// public/staticwebapp.config.json) blocks in production while dev happily
// allows it. A personal-scale backup packs in well under a second, and the
// export already runs behind a progress indicator because of the downloads.
import { zipSync, unzipSync, type Zippable } from 'fflate'

export interface ZipEntry {
  bytes: Uint8Array
  // false for payloads that are already compressed — WebP and ciphertext gain
  // nothing from deflate and cost time.
  compress?: boolean
}

export function zipFiles(files: Record<string, ZipEntry>): Uint8Array {
  const data: Zippable = {}
  for (const [name, entry] of Object.entries(files)) {
    const level: 0 | 6 = entry.compress === false ? 0 : 6
    data[name] = [entry.bytes, { level }]
  }
  return zipSync(data)
}

export function unzipFiles(archive: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(archive)
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= ZIP_MAGIC.length && ZIP_MAGIC.every((b, i) => bytes[i] === b)
}
