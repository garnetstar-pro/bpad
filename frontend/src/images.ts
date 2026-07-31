// Image clippings: parse references out of note markdown, size math, upload,
// and read-URL resolution. Phase 1 stores blobs unencrypted (see the design doc);
// the bpad-img:ID scheme is kept stable so encryption is a later, content-only change.

import { getToken } from './session'

// The pure reference helpers live in imageRefs.ts; re-exported here so existing
// importers (api.ts) keep their import path.
export { parseImageIds } from './imageRefs'

const API_URL = import.meta.env.DEV ? 'http://localhost:7071/api/images' : '/api/images'
export const MAX_EDGE = 1600
export const MAX_INPUT_BYTES = 10 * 1024 * 1024 // 10 MiB

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

// Upload a processed image; returns its stable bpad image id.
export async function uploadImage(blob: Blob): Promise<string> {
  const init = await fetch(API_URL, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: blob.type, size_bytes: blob.size }),
  })
  if (init.status === 429) throw new UploadRateLimited()
  if (!init.ok) throw new Error('upload-init-failed')
  const { image_id, upload_url } = await init.json()
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': blob.type },
    body: blob,
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

// Fetch an image's bytes through a fresh read URL. Used by the backup export;
// rendering goes straight to the URL and never needs the bytes.
export async function downloadImage(
  id: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = await resolveImageUrl(id)
  const res = await fetch(url)
  if (!res.ok) throw new Error('image-download-failed')
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('Content-Type') || 'image/webp',
  }
}

export function clearImageUrlCache(): void {
  urlCache.clear()
}
