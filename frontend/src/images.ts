// Image clippings: parse references out of note markdown, size math, upload,
// and read-URL resolution. Blobs are sealed with the user's data key before
// they leave the browser (see the phase-2 design doc), so the server stores
// ciphertext and the bpad-img:ID scheme keeps working unchanged.

import { getDataKey, getToken } from './session'
import { sealBytes, openBytes, toArrayBuffer } from './crypto'
import { getCachedImage, putCachedImage, clearImageCache } from './imageCache'

// The pure reference helpers live in imageRefs.ts; re-exported here so existing
// importers (api.ts) keep their import path.
export { parseImageIds } from './imageRefs'

const API_URL = import.meta.env.DEV ? 'http://localhost:7071/api/images' : '/api/images'
export const MAX_EDGE = 1600
export const MAX_INPUT_BYTES = 10 * 1024 * 1024 // 10 MiB

// What a picture is once opened. processImage always produces WebP, so the
// server is never told the real type — the upload goes up as opaque bytes.
export const IMAGE_CONTENT_TYPE = 'image/webp'
const BLOB_CONTENT_TYPE = 'application/octet-stream'

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { 'X-Auth-Token': token } : {}
}

// Fit (w,h) within a max longest-edge, never upscaling.
export function fitDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w, h }
  const scale = max / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

// Downscale + re-encode to WebP so blobs (and the offline cache) stay small.
export async function processImage(file: Blob): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('too-large')
  const bitmap = await createImageBitmap(file)
  const { w, h } = fitDimensions(bitmap.width, bitmap.height, MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode-failed'))),
      'image/webp',
      0.85,
    ),
  )
}

// A restore uploads one image per note reference and the API allows 60 per 10
// minutes, so hitting the limit is expected on a large vault — the importer has
// to tell it apart from a genuine failure and stop cleanly.
export class UploadRateLimited extends Error {
  constructor() {
    super('image-upload-rate-limited')
    this.name = 'UploadRateLimited'
  }
}

// Seal a processed image with the session's data key and upload the ciphertext;
// returns its stable bpad image id.
export async function uploadImage(blob: Blob): Promise<string> {
  const key = getDataKey()
  if (!key) throw new Error('locked')
  const sealed = await sealBytes(new Uint8Array(await blob.arrayBuffer()), key)
  const init = await fetch(API_URL, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: BLOB_CONTENT_TYPE, size_bytes: sealed.length }),
  })
  if (init.status === 429) throw new UploadRateLimited()
  if (!init.ok) throw new Error('upload-init-failed')
  const { image_id, upload_url } = await init.json()
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': BLOB_CONTENT_TYPE },
    body: toArrayBuffer(sealed),
  })
  if (!put.ok) throw new Error('upload-failed')
  return image_id
}

// Resolve a bpad image id to a short-lived readable URL, cached in memory.
// Refreshed before the server's 15-minute SAS lapses.
const urlCache = new Map<string, { url: string; expires: number }>()
const READ_TTL_MS = 10 * 60 * 1000

export async function resolveImageUrl(id: string): Promise<string> {
  const hit = urlCache.get(id)
  if (hit && hit.expires > Date.now()) return hit.url
  const res = await fetch(`${API_URL}/${id}/url`, { headers: authHeaders() })
  if (!res.ok) throw new Error('resolve-failed')
  const { url } = await res.json()
  urlCache.set(id, { url, expires: Date.now() + READ_TTL_MS })
  return url
}

// Fetch an image's bytes through a fresh read URL and open them. Used by the
// backup export and by loadImage; the content type is not read back from the
// response, which now says application/octet-stream for every blob.
export async function downloadImage(
  id: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const key = getDataKey()
  if (!key) throw new Error('locked')
  const url = await resolveImageUrl(id)
  const res = await fetch(url)
  if (!res.ok) throw new Error('image-download-failed')
  const sealed = new Uint8Array(await res.arrayBuffer())
  return { bytes: await openBytes(sealed, key), contentType: IMAGE_CONTENT_TYPE }
}

// Bumped on every clear, so a loadImage job started before a logout can tell,
// once its download finally lands, that the cache it was about to join has
// since been emptied — pending.clear() alone only drops the tracking entry,
// it does not stop the closure already running.
let generation = 0

export function clearImageUrlCache(): void {
  generation++
  urlCache.clear()
  pending.clear()
  clearImageCache()
}

// In-flight downloads, so the three occurrences of one picture in a note cause
// one download. Cleared with the cache: a job started before a logout must not
// put its object URL into a cache that has already been emptied.
const pending = new Map<string, Promise<string>>()

// Resolve a bpad image id to a blob: URL of the decrypted picture, cached in
// memory for the rest of the session. This is what rendering uses; the SAS URL
// never reaches an <img> any more, because the blob behind it is ciphertext.
export async function loadImage(id: string): Promise<string> {
  const cached = getCachedImage(id)
  if (cached) return cached
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const startedAt = generation
  const job = (async () => {
    const { bytes, contentType } = await downloadImage(id)
    const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: contentType }))
    if (generation !== startedAt) {
      // The session was cleared while this download was in flight: the data
      // key that decrypted it is gone and the cache belongs to whatever comes
      // next. Revoke the URL instead of leaking decrypted bytes past logout.
      URL.revokeObjectURL(url)
      throw new Error('session-cleared')
    }
    putCachedImage(id, url, bytes.length)
    return url
  })()
  pending.set(id, job)
  // A failure is not cached — the next render retries. finally() keeps the
  // rejection on the returned promise instead of swallowing it. Only drop our
  // own entry: clearImageUrlCache may have already cleared pending and a new
  // loadImage call for the same id may have inserted its own job by now.
  return job.finally(() => {
    if (pending.get(id) === job) pending.delete(id)
  })
}
