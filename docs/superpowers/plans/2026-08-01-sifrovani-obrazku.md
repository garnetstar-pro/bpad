# Client-Side Image Encryption (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Image blobs stop being readable by the server: the browser seals every picture with the user's data key before uploading it and opens it again before rendering.

**Architecture:** `uploadImage` seals the processed WebP with `sealBytes` (12-byte IV + AES-256-GCM) using the per-user `dataKey` that already encrypts notes, and `downloadImage` opens it again. Rendering goes through a new `loadImage(id)` that turns the decrypted bytes into a `blob:` URL and keeps it in a small in-memory LRU. There is **no backward compatibility**: existing plaintext blobs are deleted by hand, so no code path reads an unencrypted blob.

**Tech Stack:** React 19 + TypeScript, Web Crypto (AES-256-GCM) via the existing `crypto.ts`, vitest without jsdom.

**Spec:** `docs/superpowers/specs/2026-08-01-sifrovani-obrazku-design.md`

## Global Constraints

- **All work is in `frontend/`.** Run every command from `frontend/` (`cd frontend`). Nothing in `api/` changes — no new routes, no model changes, no Python. The one server-side action in this plan is a manual data cleanup in Task 4, not code.
- **No new dependency.** Everything needed (`sealBytes`, `openBytes`, `toArrayBuffer`) already exists in `frontend/src/crypto.ts`.
- **No new user-facing string.** Every failure path ends at the existing `images.failed` message; do not add keys to `frontend/src/i18n/en.ts`.
- **Code comments and logs are English.** (Design docs under `docs/` are Czech; code is not.)
- **There is no jsdom.** Tests run in plain Node. `document`, `URL.createObjectURL` and `URL.revokeObjectURL` must be stubbed with `vi.stubGlobal` — see `frontend/src/backupFile.test.ts` for the established pattern. `Blob`, `TextEncoder`, `crypto.subtle` and `fetch` **are** available natively in Node and need no stub.
- **`imageCache.ts` must not import anything.** `session.ts` empties the cache and `images.ts` imports `session.ts`, so a dependency from the cache back into `images.ts` would close the cycle `session → imageCache → images → session`.
- **The data key is `getDataKey()` from `./session`.** Never derive a key here — no Argon2id, no HKDF, no per-image key.
- **Verification gate:** `npm run test`, `npm run lint` and `npm run build` must all pass before the final commit of each task that changes code.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/imageCache.ts` *(new)* | Pure in-memory LRU of `image id → blob: URL`, with revocation. No imports. |
| `frontend/src/images.ts` | *+* sealing on upload, opening on download, `loadImage(id)` orchestration, and emptying the cache. |
| `frontend/src/markdown.tsx` | `BpadImage` renders the decrypted blob URL instead of the SAS URL. |

`session.ts` is **not** in the list: `clearSession()` already calls `clearImageUrlCache()`, and that function grows to empty the blob cache as well. Keeping the new call inside `images.ts` also keeps the dependency one-way — `images.ts` → `imageCache.ts`, and `imageCache.ts` imports nothing.
| `CLAUDE.md`, `docs/superpowers/specs/*` | Documentation of the new state. |

---

### Task 1: `imageCache.ts` — the in-memory LRU

The decrypted picture lives in a `Blob` behind an object URL. Anything that drops such a URL without revoking it leaks for the lifetime of the tab, so every removal path in this module revokes.

**Files:**
- Create: `frontend/src/imageCache.ts`
- Create: `frontend/src/imageCache.test.ts`

**Interfaces:**
- Consumes: nothing (this module has no imports by design).
- Produces:
  - `getCachedImage(id: string): string | undefined`
  - `putCachedImage(id: string, url: string, size: number): void`
  - `clearImageCache(): void`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/imageCache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCachedImage, putCachedImage, clearImageCache } from './imageCache'

const MIB = 1024 * 1024
const revokeObjectURL = vi.fn()

beforeEach(() => {
  revokeObjectURL.mockClear()
  vi.stubGlobal('URL', { revokeObjectURL })
})

afterEach(() => {
  // Clear before unstubbing: clearing revokes, and revoke is the stub.
  clearImageCache()
  vi.unstubAllGlobals()
})

describe('imageCache', () => {
  it('returns what was put in and undefined for an unknown id', () => {
    putCachedImage('a', 'blob:a', 10)
    expect(getCachedImage('a')).toBe('blob:a')
    expect(getCachedImage('nope')).toBeUndefined()
  })

  it('evicts the least recently used entry once the cap is exceeded', () => {
    putCachedImage('a', 'blob:a', 10 * MIB)
    putCachedImage('b', 'blob:b', 10 * MIB)
    putCachedImage('c', 'blob:c', 10 * MIB) // 30 MiB > 24 MiB cap
    expect(getCachedImage('a')).toBeUndefined()
    expect(getCachedImage('b')).toBe('blob:b')
    expect(getCachedImage('c')).toBe('blob:c')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a')
  })

  it('a read protects an entry from the next eviction', () => {
    putCachedImage('a', 'blob:a', 10 * MIB)
    putCachedImage('b', 'blob:b', 10 * MIB)
    getCachedImage('a') // 'a' is now the most recently used
    putCachedImage('c', 'blob:c', 10 * MIB)
    expect(getCachedImage('b')).toBeUndefined()
    expect(getCachedImage('a')).toBe('blob:a')
  })

  it('keeps an entry that exceeds the cap on its own', () => {
    putCachedImage('big', 'blob:big', 40 * MIB)
    expect(getCachedImage('big')).toBe('blob:big')
  })

  it('revokes the previous url when the same id is replaced', () => {
    putCachedImage('a', 'blob:old', 10)
    putCachedImage('a', 'blob:new', 10)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old')
    expect(getCachedImage('a')).toBe('blob:new')
  })

  it('revokes every url when cleared', () => {
    putCachedImage('a', 'blob:a', 10)
    putCachedImage('b', 'blob:b', 10)
    clearImageCache()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:b')
    expect(getCachedImage('a')).toBeUndefined()
  })

  it('frees its accounting on clear, so the cap applies afresh', () => {
    putCachedImage('a', 'blob:a', 20 * MIB)
    clearImageCache()
    putCachedImage('b', 'blob:b', 10 * MIB)
    putCachedImage('c', 'blob:c', 10 * MIB)
    expect(getCachedImage('b')).toBe('blob:b') // would have been evicted if the 20 MiB still counted
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- imageCache`
Expected: FAIL — `Failed to resolve import "./imageCache"`.

- [ ] **Step 3: Write `imageCache.ts`**

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- imageCache`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/imageCache.ts src/imageCache.test.ts
git commit -m "feat(web): in-memory LRU cache for decrypted images"
```

---

### Task 2: `images.ts` — seal on upload, open on download

**Files:**
- Modify: `frontend/src/images.ts:1-3` (header comment), `:57-74` (`uploadImage`), `:92-104` (`downloadImage`)
- Modify: `frontend/src/images.test.ts` (update the `uploadImage` and `downloadImage` blocks)

**Interfaces:**
- Consumes: `sealBytes`, `openBytes`, `toArrayBuffer` from `./crypto`; `getDataKey` from `./session`.
- Produces:
  - `uploadImage(blob: Blob): Promise<string>` *(signature unchanged; now uploads ciphertext)*
  - `downloadImage(id: string): Promise<{ bytes: Uint8Array; contentType: string }>` *(signature unchanged; now decrypts, `contentType` is always `image/webp`)*
  - `IMAGE_CONTENT_TYPE = 'image/webp'`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/images.test.ts`, replace the whole `describe('uploadImage', …)` block and the whole `describe('downloadImage', …)` block with the code below. Add `sealBytes` to the imports at the top:

```ts
import { sealBytes } from './crypto'
```

```ts
describe('uploadImage', () => {
  afterEach(() => { clearSession(); vi.restoreAllMocks() })

  it('inits the upload then PUTs the sealed blob and returns the id', async () => {
    withSession()
    const calls: string[] = []
    let posted: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (String(url).endsWith('/api/images')) {
        posted = JSON.parse(String(init?.body))
        return { ok: true, json: async () => ({ image_id: 'img1', upload_url: 'https://blob/put' }) } as Response
      }
      return { ok: true } as Response // the PUT to blob storage
    })
    vi.stubGlobal('fetch', fetchMock)

    const id = await uploadImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }))

    expect(id).toBe('img1')
    expect(calls[0]).toContain('POST http://localhost:7071/api/images')
    expect(calls[1]).toBe('PUT https://blob/put')
    // The server is told nothing about the picture: 12-byte IV + 3 bytes + 16-byte tag.
    expect(posted).toEqual({ content_type: 'application/octet-stream', size_bytes: 31 })
  })

  it('uploads ciphertext, not the picture', async () => {
    withSession()
    const plaintext = new Uint8Array([10, 20, 30, 40])
    let uploaded = new Uint8Array()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/images')) {
        return { ok: true, json: async () => ({ image_id: 'img1', upload_url: 'https://blob/put' }) } as Response
      }
      uploaded = new Uint8Array(init?.body as ArrayBuffer)
      return { ok: true } as Response
    }))

    await uploadImage(new Blob([plaintext], { type: 'image/webp' }))

    expect(uploaded.length).toBe(plaintext.length + 28)
    expect(uploaded.subarray(12, 16)).not.toEqual(plaintext)
  })

  it('refuses to upload without a data key', async () => {
    clearSession()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response))
    await expect(uploadImage(new Blob([new Uint8Array([1])]))).rejects.toThrow(/locked/i)
  })
})

describe('downloadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearImageUrlCache()
    clearSession()
  })

  // The whole session key is 32 zero bytes, the same one withSession() installs.
  const key = new Uint8Array(32)

  async function serving(sealed: Uint8Array) {
    return vi.fn(async (input: string) =>
      input.endsWith('/url')
        ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
        : ({ ok: true, arrayBuffer: async () => sealed.buffer } as never),
    )
  }

  it('opens the sealed bytes and reports image/webp', async () => {
    withSession()
    const picture = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal('fetch', await serving(await sealBytes(picture, key)))

    await expect(downloadImage('pic-1')).resolves.toEqual({
      bytes: picture,
      contentType: 'image/webp',
    })
  })

  it('rejects bytes that were not sealed with this key', async () => {
    withSession()
    vi.stubGlobal('fetch', await serving(await sealBytes(new Uint8Array([1]), new Uint8Array(32).fill(9))))
    await expect(downloadImage('pic-2')).rejects.toThrow()
  })

  it('rejects a blob that is not sealed at all', async () => {
    withSession()
    vi.stubGlobal('fetch', await serving(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])))
    await expect(downloadImage('pic-3')).rejects.toThrow()
  })

  it('throws when the blob cannot be fetched', async () => {
    withSession()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/url')
          ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
          : ({ ok: false, status: 404 } as never),
      ),
    )
    await expect(downloadImage('pic-4')).rejects.toThrow(/download/i)
  })

  it('refuses to download without a data key', async () => {
    clearSession()
    await expect(downloadImage('pic-5')).rejects.toThrow(/locked/i)
  })
})
```

Note: `withSession()` (already defined near the top of the file) installs a 32-byte zero data key, which is a valid AES-256 key — the tests above rely on that.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npm run test -- images.test`
Expected: FAIL — `uploadImage` still PUTs the plaintext and posts `content_type: "image/webp"`; `downloadImage` returns the sealed bytes verbatim.

- [ ] **Step 3: Implement**

In `frontend/src/images.ts`, replace the first three header lines with:

```ts
// Image clippings: parse references out of note markdown, size math, upload,
// and read-URL resolution. Blobs are sealed with the user's data key before
// they leave the browser (see the phase-2 design doc), so the server stores
// ciphertext and the bpad-img:ID scheme keeps working unchanged.
```

Add to the imports:

```ts
import { getDataKey, getToken } from './session'
import { sealBytes, openBytes, toArrayBuffer } from './crypto'
```

(The existing `import { getToken } from './session'` line is replaced by the first of those two.)

Add next to the other constants:

```ts
// What a picture is once opened. processImage always produces WebP, so the
// server is never told the real type — the upload goes up as opaque bytes.
export const IMAGE_CONTENT_TYPE = 'image/webp'
const BLOB_CONTENT_TYPE = 'application/octet-stream'
```

Replace `uploadImage`:

```ts
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
```

Replace `downloadImage`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npm run test -- images.test`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: all pass. `backupExport.test.ts` stubs `downloadImage` at the module level, so it is unaffected; if it instead stubs `fetch`, its fixture bytes must be sealed the same way the new `downloadImage` tests do it.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/images.ts src/images.test.ts
git commit -m "feat(web): seal image blobs with the user's data key"
```

---

### Task 3: `loadImage` and the render path

**Files:**
- Modify: `frontend/src/images.ts` (append `loadImage`, extend `clearImageUrlCache`)
- Modify: `frontend/src/images.test.ts` (append a `loadImage` block)
- Modify: `frontend/src/markdown.tsx:6` (import) and `:52-70` (`BpadImage`)

**Interfaces:**
- Consumes: `getCachedImage`, `putCachedImage`, `clearImageCache` from `./imageCache` (Task 1); `downloadImage` from Task 2.
- Produces: `loadImage(id: string): Promise<string>` — a `blob:` URL of the decrypted picture.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/images.test.ts` (and add `loadImage` to the import from `./images`):

```ts
describe('loadImage', () => {
  const key = new Uint8Array(32)

  afterEach(() => {
    vi.unstubAllGlobals()
    clearImageUrlCache()
    clearSession()
  })

  async function stubTransport(picture: Uint8Array) {
    const sealed = await sealBytes(picture, key)
    const fetchMock = vi.fn(async (input: string) =>
      input.endsWith('/url')
        ? ({ ok: true, json: async () => ({ url: `https://blob/x?sas=${Math.random()}` }) } as never)
        : ({ ok: true, arrayBuffer: async () => sealed.buffer } as never),
    )
    vi.stubGlobal('fetch', fetchMock)
    let made = 0
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:made-${++made}`),
      revokeObjectURL: vi.fn(),
    })
    return fetchMock
  }

  it('downloads once and serves the second call from the cache', async () => {
    withSession()
    const fetchMock = await stubTransport(new Uint8Array([1, 2, 3]))

    const first = await loadImage('pic-1')
    const second = await loadImage('pic-1')

    expect(first).toBe('blob:made-1')
    expect(second).toBe('blob:made-1')
    // One /url call and one blob GET, not two of each.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent requests for the same id into one download', async () => {
    withSession()
    const fetchMock = await stubTransport(new Uint8Array([4, 5, 6]))

    const [a, b] = await Promise.all([loadImage('pic-2'), loadImage('pic-2')])

    expect(a).toBe(b)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lets a failure be retried rather than caching it', async () => {
    withSession()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as never))
    await expect(loadImage('pic-3')).rejects.toThrow()
    await expect(loadImage('pic-3')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- images.test`
Expected: FAIL — `loadImage` is not exported.

- [ ] **Step 3: Implement `loadImage`**

In `frontend/src/images.ts`, add the import:

```ts
import { getCachedImage, putCachedImage, clearImageCache } from './imageCache'
```

Append at the end of the file:

```ts
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
  const job = (async () => {
    const { bytes, contentType } = await downloadImage(id)
    const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: contentType }))
    putCachedImage(id, url, bytes.length)
    return url
  })()
  pending.set(id, job)
  // A failure is not cached — the next render retries. finally() keeps the
  // rejection on the returned promise instead of swallowing it.
  return job.finally(() => pending.delete(id))
}
```

Extend `clearImageUrlCache` (the existing function) to:

```ts
export function clearImageUrlCache(): void {
  urlCache.clear()
  pending.clear()
  clearImageCache()
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- images.test`
Expected: PASS.

- [ ] **Step 5: Point the renderer at it**

`frontend/src/session.ts` needs **no change**: `clearSession()` already calls `clearImageUrlCache()`, which now empties the blob cache too.

In `frontend/src/markdown.tsx`, change the import on line 6 from `resolveImageUrl` to `loadImage`, and in `BpadImage` replace the effect body's call:

```tsx
  useEffect(() => {
    let active = true
    loadImage(id)
      .then((url) => active && setSrc(url))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [id])
```

The URL is owned by the cache, so the effect must **not** revoke it on unmount — scrolling a note in and out of view would then break every other copy of that picture.

- [ ] **Step 6: Run the whole suite**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: all pass, including `markdown.test.tsx` — its `renderToStaticMarkup` never runs effects, so `BpadImage` stays on its loading placeholder as before.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/images.ts src/images.test.ts src/markdown.tsx
git commit -m "feat(web): render images from decrypted blobs held in memory"
```

---

### Task 4: Documentation and the one-off cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-sifrovani-obrazku-design.md` (status line)
- Modify: `docs/superpowers/specs/2026-07-25-obrazky-vystrizky-design.md` (the phase-1 encryption row)
- Modify: `CLAUDE.md` (a paragraph on images)

- [ ] **Step 1: Mark the phase-2 spec implemented**

In `docs/superpowers/specs/2026-08-01-sifrovani-obrazku-design.md`, change the status line to:

```markdown
**Stav:** implementováno (klient); zbývá jednorázové smazání starých blobů — viz níže
```

- [ ] **Step 2: Close the loop on the phase-1 spec**

In `docs/superpowers/specs/2026-07-25-obrazky-vystrizky-design.md`, change the encryption row of the decision table to:

```markdown
| Šifrování obrázků | **Ne** — plaintext blob (vědomé zjednodušení fáze 1; vyřešeno ve fázi 2, viz `2026-08-01-sifrovani-obrazku-design.md`) |
```

- [ ] **Step 3: Describe images in CLAUDE.md**

Insert a new paragraph immediately after the **Storage is Azure Cosmos DB** paragraph:

```markdown
**Images in notes** are stored in Azure Blob Storage (private container `note-images`), one blob per picture, with metadata in the Cosmos container `images` (partition `/user_id`). The client downscales to 1600 px WebP, **seals the bytes with the user's data key** (`sealBytes`, IV in the first 12 bytes) and PUTs the ciphertext straight to a short-lived SAS URL, so the server sees `application/octet-stream` and never the picture — the same zero-knowledge property notes have. Markdown carries a stable `bpad-img:ID` reference, never a SAS URL; `images.ts:loadImage()` turns it into a `blob:` URL of the decrypted bytes, kept in the in-memory LRU in `imageCache.ts` (emptied by `clearSession()`, so a locked session shows no pictures). `imageCache.ts` deliberately imports nothing — `session.ts` empties it and `images.ts` imports `session.ts`. Because the server cannot read a note, the client reports the `image_ids` a note references on save and the API reconciles blob lifetime from that (`api/images_ops.py`).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-01-sifrovani-obrazku-design.md docs/superpowers/specs/2026-07-25-obrazky-vystrizky-design.md
git commit -m "docs: images are encrypted client-side"
```

- [ ] **Step 5: Hand the cleanup to the repo owner**

This step is **not code and not automatable from here** — it needs Azure credentials and it destroys data. Report to the user, verbatim, what has to happen after the deploy reaches an environment:

> Old plaintext blobs must be deleted in **both** environments, otherwise those pictures show the "image failed" placeholder forever while still being readable in the portal:
> - delete every blob in the `note-images` container (dev storage account and prod storage account),
> - delete every document in the Cosmos container `images` (database `bpad` for dev, `bpad-prod` for prod).
>
> Notes that referenced them keep their `![](bpad-img:…)` text; re-inserting the picture is the fix.

Do not attempt this with the Azure CLI on the user's behalf unless they explicitly ask.

---

## Manual verification (after deploying to dev)

`crypto.subtle` needs a secure context, so this cannot be checked over http on a LAN IP — it has to happen on `dev.bpad.pro`.

1. Paste an image into a note, save, reopen the note — the picture renders.
2. Reload the tab — it renders again (fresh download + decrypt).
3. Open the note twice in a row without reloading — the second time is instant and shows no network request for the blob.
4. Lock the session (or log out and back in) — the picture reappears after unlocking.
5. Export a backup and open the archive — `images/<id>.webp` is a real, viewable picture.
6. In the Azure portal, download the blob for that picture — it must **not** open as an image.
