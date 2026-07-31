# Backup Export/Import Including Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backup file carries the images embedded in notes, and restoring it into any account re-uploads those images and rewires the note text to them.

**Architecture:** The backup file becomes a ZIP (format `version: 2`) holding `backup.json` (today's manifest, plus an `images` array), an `images/` folder with the raw picture bytes, and — in plain mode only — a human-readable `notes/*.md` folder. Export downloads every referenced image through the existing SAS-URL path and packs it; import uploads the images **first**, then rewrites each note's `bpad-img:OLD` references to the new server-assigned ids before creating the note. The `bpad-img:` scheme, the notes API and the whole backend stay untouched.

**Tech Stack:** React 19 + TypeScript, Web Crypto (AES-256-GCM) + Argon2id via `hash-wasm`, fflate for ZIP, vitest without jsdom.

**Spec:** `docs/superpowers/specs/2026-07-31-export-import-s-obrazky-design.md`

## Global Constraints

- **All work is in `frontend/`.** Run every command from `frontend/` (`cd frontend`). Nothing in `api/` changes — no new routes, no model changes, no Python.
- **One new dependency, and only one:** `fflate`. Nothing else may be added — no jsdom, no testing-library, no JSZip.
- **Use `zipSync`/`unzipSync`, never fflate's async API.** The async API spawns a Worker from a `blob:` URL and our CSP in `frontend/public/staticwebapp.config.json` says `worker-src 'self'`, so it would fail in production while working fine in dev.
- **No user-facing string may be hardcoded in a component.** Every label goes through `t()` from `./i18n`; the dictionary is `frontend/src/i18n/en.ts`.
- **Code comments and logs are English.** (Design docs under `docs/` are Czech; code is not.)
- **There is no jsdom.** Tests run in plain Node. Never use `document`, `window`, `localStorage` or `URL.createObjectURL` in a test without stubbing the global yourself (`vi.stubGlobal`) — see `frontend/src/backupFile.test.ts` for the established pattern. `Blob`, `File`, `TextEncoder`, `crypto.subtle` and `fetch` **are** available natively in Node and need no stub.
- **Argon2id is slow on purpose.** Any test that calls `encryptBackup`, `deriveBackupKey` or `buildArchive` with a passphrase must pass an explicit timeout: `it('…', async () => { … }, 30_000)`. Derive the key **once** per archive — never once per image.
- **The backup format is a long-lived contract.** Never change the meaning of an existing field; add fields and bump `BACKUP_VERSION`. Reading a `version: 1` file must keep working forever.
- **Verification gate:** `npm run test`, `npm run lint` and `npm run build` must all pass before the final commit of each task that changes code. **One documented exception:** `npm run build` is expected to fail from the end of Task 10 until Task 13, because `backupFile.ts` drops `downloadBackup`/`readTextFile` before `Account.tsx` and `Restore.tsx` stop importing them. Tasks 10, 11 and 12 say so in their own gates and require `npm run test` and `npm run lint` to pass regardless. Task 13 restores the full gate. This is not licence to skip the gate anywhere else.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/imageRefs.ts` *(new)* | The `bpad-img:` scheme as pure text operations. No session, no network. |
| `frontend/src/crypto.ts` | *+* `sealBytes`/`openBytes` (raw-byte AES-GCM, IV in the first 12 bytes), `toArrayBuffer` exported. |
| `frontend/src/backupZip.ts` *(new)* | Thin fflate wrapper over `Uint8Array`. No domain knowledge. |
| `frontend/src/backup.ts` | Format v2: types, manifest, manifest encryption, normalised note identity. Pure. |
| `frontend/src/backupMarkdown.ts` *(new)* | The human-readable `notes/*.md` export. Pure. |
| `frontend/src/backupArchive.ts` *(new)* | Builds and reads the whole archive. Pure — takes and returns bytes. |
| `frontend/src/images.ts` | *+* `downloadImage`, `UploadRateLimited`. |
| `frontend/src/backupExport.ts` *(new)* | Export orchestration: list notes, download images, pack. Touches the network. |
| `frontend/src/backupFile.ts` | Browser edges: turn an archive into a download, turn a picked `File` into an archive handle. |
| `frontend/src/backupImport.ts` | Two-phase import: images, then notes. |
| `frontend/src/Account.tsx` | Export UI. |
| `frontend/src/Restore.tsx` | Import UI. |
| `frontend/src/i18n/en.ts` | New strings. |

---

### Task 1: `imageRefs.ts` — the `bpad-img:` scheme as pure text

The format modules need to parse and rewrite image references, but `images.ts` imports `./session` and talks to the network. Pull the pure part out; `images.ts` re-exports `parseImageIds` so existing importers (`api.ts`, `images.test.ts`) are untouched.

**Files:**
- Create: `frontend/src/imageRefs.ts`
- Create: `frontend/src/imageRefs.test.ts`
- Modify: `frontend/src/images.ts:7-8` (drop `IMG_RE`), `:19-23` (drop `parseImageIds`, re-export instead)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseImageIds(markdown: string): string[]`
  - `rewriteImageRefs(markdown: string, map: Map<string, string>): string`
  - `normalizeImageRefs(markdown: string): string`
  - `localizeImageRefs(markdown: string, paths: Map<string, string>): string`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/imageRefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseImageIds,
  rewriteImageRefs,
  normalizeImageRefs,
  localizeImageRefs,
} from './imageRefs'

describe('parseImageIds', () => {
  it('finds every reference and dedups', () => {
    const md = 'a ![](bpad-img:aaa) b ![alt](bpad-img:bbb) c ![](bpad-img:aaa)'
    expect(parseImageIds(md).sort()).toEqual(['aaa', 'bbb'])
  })

  it('ignores plain images and links', () => {
    expect(parseImageIds('![p](https://x/y.png) [l](bpad-img:nope)')).toEqual([])
  })
})

describe('rewriteImageRefs', () => {
  it('swaps ids listed in the map', () => {
    const map = new Map([['old', 'new']])
    expect(rewriteImageRefs('![a](bpad-img:old)', map)).toBe('![a](bpad-img:new)')
  })

  it('leaves an id that is not in the map alone', () => {
    expect(rewriteImageRefs('![](bpad-img:gone)', new Map())).toBe('![](bpad-img:gone)')
  })

  it('rewrites every occurrence, including repeats of the same id', () => {
    const map = new Map([['a', 'x']])
    expect(rewriteImageRefs('![](bpad-img:a) ![](bpad-img:a)', map)).toBe(
      '![](bpad-img:x) ![](bpad-img:x)',
    )
  })

  it('does not touch anything outside the scheme', () => {
    const md = 'see [bpad-img:a](http://x) and ![](https://y/z.png)'
    expect(rewriteImageRefs(md, new Map([['a', 'x']]))).toBe(md)
  })
})

describe('normalizeImageRefs', () => {
  it('numbers references by first appearance', () => {
    expect(normalizeImageRefs('![](bpad-img:zzz) ![](bpad-img:aaa)')).toBe(
      '![](bpad-img:#1) ![](bpad-img:#2)',
    )
  })

  it('gives the same id the same number every time', () => {
    expect(normalizeImageRefs('![](bpad-img:a) ![](bpad-img:b) ![](bpad-img:a)')).toBe(
      '![](bpad-img:#1) ![](bpad-img:#2) ![](bpad-img:#1)',
    )
  })

  it('makes two texts that differ only in ids identical', () => {
    const before = '# R\n![](bpad-img:old-1)'
    const after = '# R\n![](bpad-img:new-1)'
    expect(normalizeImageRefs(before)).toBe(normalizeImageRefs(after))
  })

  it('leaves text without images untouched', () => {
    expect(normalizeImageRefs('plain note')).toBe('plain note')
  })
})

describe('localizeImageRefs', () => {
  it('replaces the scheme with a plain path', () => {
    const paths = new Map([['a', '../images/a.webp']])
    expect(localizeImageRefs('![alt](bpad-img:a)', paths)).toBe('![alt](../images/a.webp)')
  })

  it('leaves an id with no path alone', () => {
    expect(localizeImageRefs('![](bpad-img:a)', new Map())).toBe('![](bpad-img:a)')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- imageRefs`
Expected: FAIL — `Failed to resolve import "./imageRefs"`.

- [ ] **Step 3: Write `imageRefs.ts`**

```ts
// The bpad-img: reference scheme as pure text operations. Split out of
// images.ts, which reaches for the session and the network, so the backup
// format modules can depend on this without dragging either in.

// Matches an image (not a link): ![alt](bpad-img:ID). IDs are uuid-shaped.
// Built fresh per call: a shared /g regex carries lastIndex between calls.
// Three capture groups so a rewrite can be anchored at the reference rather
// than searched for — alt text is free-form and may itself contain the
// literal "bpad-img:ID", which a substring replace would clobber instead.
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
  return markdown.replace(imgRe(), (whole, open: string, id: string, close: string) => {
    const next = map.get(id)
    return next ? `${open}bpad-img:${next}${close}` : whole
  })
}

// Replace ids with their position in the text (#1, #2, …). An import uploads
// every image afresh and rewrites the ids, so raw content cannot recognise a
// note it has already restored — the normalised form can.
export function normalizeImageRefs(markdown: string): string {
  const seen = new Map<string, number>()
  return markdown.replace(imgRe(), (_whole, open: string, id: string, close: string) => {
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
  return markdown.replace(imgRe(), (whole, open: string, id: string, close: string) => {
    const path = paths.get(id)
    return path ? `${open}${path}${close}` : whole
  })
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- imageRefs`
Expected: PASS.

- [ ] **Step 5: Point `images.ts` at the new module**

In `frontend/src/images.ts`, delete the `IMG_RE` constant (line 7-8) and the `parseImageIds` function (lines 19-23), and add near the top imports:

```ts
// The pure reference helpers live in imageRefs.ts; re-exported here so existing
// importers (api.ts) keep their import path.
export { parseImageIds } from './imageRefs'
```

- [ ] **Step 6: Run the whole suite**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: all pass. `images.test.ts` still exercises `parseImageIds` through the re-export.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/imageRefs.ts src/imageRefs.test.ts src/images.ts
git commit -m "refactor(web): pure bpad-img reference helpers in imageRefs.ts"
```

---

### Task 2: `crypto.ts` — raw-byte seal/open

Image files inside the archive carry their IV in the first 12 bytes rather than in a separate base64 field, so they need a raw-byte variant of the existing AES-GCM helpers.

**Files:**
- Modify: `frontend/src/crypto.ts:25-29` (export the buffer helper), append after line 117
- Modify: `frontend/src/crypto.test.ts` (append tests)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sealBytes(plaintext: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array>`
  - `openBytes(sealed: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array>`
  - `toArrayBuffer(bytes: Uint8Array): ArrayBuffer` — the existing private `buf`, now exported

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/crypto.test.ts`:

```ts
describe('sealBytes / openBytes', () => {
  const key = new Uint8Array(32).fill(7)

  it('round-trips binary data', async () => {
    const data = new Uint8Array([0, 1, 2, 250, 251, 255])
    const sealed = await sealBytes(data, key)
    await expect(openBytes(sealed, key)).resolves.toEqual(data)
  })

  it('carries the IV in the first 12 bytes and the tag on the end', async () => {
    const data = new Uint8Array(100)
    const sealed = await sealBytes(data, key)
    // 12-byte IV + 100 bytes of ciphertext + 16-byte GCM tag
    expect(sealed.length).toBe(128)
  })

  it('uses a fresh IV every time', async () => {
    const data = new Uint8Array([1, 2, 3])
    const a = await sealBytes(data, key)
    const b = await sealBytes(data, key)
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12))
  })

  it('rejects the wrong key', async () => {
    const sealed = await sealBytes(new Uint8Array([1, 2, 3]), key)
    await expect(openBytes(sealed, new Uint8Array(32).fill(8))).rejects.toThrow()
  })

  it('rejects a payload too short to hold an IV and a tag', async () => {
    await expect(openBytes(new Uint8Array(10), key)).rejects.toThrow(/too short/i)
  })
})
```

Add `sealBytes, openBytes` to the existing import from `./crypto` at the top of the file.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- crypto`
Expected: FAIL — `sealBytes` is not exported.

- [ ] **Step 3: Implement**

In `frontend/src/crypto.ts`, rename the private `buf` to an exported `toArrayBuffer` (update all its call sites in the file — lines 66, 99, 105, 112, 114):

```ts
// Web Crypto wants a BufferSource over an ArrayBuffer (not ArrayBufferLike/Shared).
// Copies the bytes into a fresh ArrayBuffer so both the types and the runtime line up.
// Exported because Blob construction hits the same friction.
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}
```

Then append after `decryptBytes` (line 117):

```ts
// Raw-byte AES-GCM for payloads that travel as files rather than as JSON: the
// IV rides in the first 12 bytes instead of a separate base64 field, so a
// sealed image is one self-contained blob.
const IV_BYTES = 12
const GCM_TAG_BYTES = 16

export async function sealBytes(plaintext: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES)
  const key = await importAesKey(keyBytes)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext)),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return out
}

export async function openBytes(sealed: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < IV_BYTES + GCM_TAG_BYTES) throw new Error('sealed payload is too short')
  const key = await importAesKey(keyBytes)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(sealed.subarray(0, IV_BYTES)) },
    key,
    toArrayBuffer(sealed.subarray(IV_BYTES)),
  )
  return new Uint8Array(pt)
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- crypto`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/crypto.ts src/crypto.test.ts
git commit -m "feat(web): raw-byte AES-GCM seal/open for binary backup payloads"
```

---

### Task 3: `backupZip.ts` — the ZIP layer

**Files:**
- Modify: `frontend/package.json` (add `fflate`)
- Create: `frontend/src/backupZip.ts`
- Create: `frontend/src/backupZip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ZipEntry { bytes: Uint8Array; compress?: boolean }`
  - `zipFiles(files: Record<string, ZipEntry>): Uint8Array`
  - `unzipFiles(archive: Uint8Array): Record<string, Uint8Array>`
  - `looksLikeZip(bytes: Uint8Array): boolean`

- [ ] **Step 1: Add the dependency**

```bash
cd frontend && npm install fflate
```

Expected: `fflate` appears under `dependencies` in `package.json`, with no transitive dependencies added.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/backupZip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { zipFiles, unzipFiles, looksLikeZip } from './backupZip'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('zipFiles / unzipFiles', () => {
  it('round-trips text and binary entries', () => {
    const binary = new Uint8Array([0, 1, 2, 253, 254, 255])
    const archive = zipFiles({
      'backup.json': { bytes: enc.encode('{"a":1}') },
      'images/x.webp': { bytes: binary, compress: false },
    })
    const back = unzipFiles(archive)
    expect(Object.keys(back).sort()).toEqual(['backup.json', 'images/x.webp'])
    expect(dec.decode(back['backup.json'])).toBe('{"a":1}')
    expect(back['images/x.webp']).toEqual(binary)
  })

  it('keeps nested folder paths', () => {
    const archive = zipFiles({ 'notes/2026-01-01-a.md': { bytes: enc.encode('# a') } })
    expect(Object.keys(unzipFiles(archive))).toContain('notes/2026-01-01-a.md')
  })

  it('handles an archive with a single entry and no images', () => {
    const archive = zipFiles({ 'backup.json': { bytes: enc.encode('{}') } })
    expect(Object.keys(unzipFiles(archive))).toEqual(['backup.json'])
  })

  it('survives a large incompressible payload', () => {
    const noise = new Uint8Array(200_000)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256
    const archive = zipFiles({ 'images/n.webp': { bytes: noise, compress: false } })
    expect(unzipFiles(archive)['images/n.webp']).toEqual(noise)
  })
})

describe('looksLikeZip', () => {
  it('recognises an archive we just built', () => {
    expect(looksLikeZip(zipFiles({ 'a.txt': { bytes: enc.encode('x') } }))).toBe(true)
  })

  it('rejects JSON text', () => {
    expect(looksLikeZip(enc.encode('{"format":"bpad-backup"}'))).toBe(false)
  })

  it('rejects a buffer shorter than the magic bytes', () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backupZip`
Expected: FAIL — `Failed to resolve import "./backupZip"`.

- [ ] **Step 4: Write `backupZip.ts`**

```ts
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
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backupZip`
Expected: PASS, 7 tests.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add package.json package-lock.json src/backupZip.ts src/backupZip.test.ts
git commit -m "feat(web): ZIP packing layer for backup archives"
```

---

### Task 4: `backup.ts` — format version 2

The manifest grows an `images` array; encrypted backups carry it inside the ciphertext next to `notes`. The KDF and key handling get split so a caller can derive the key once and reuse it for the manifest and every image.

**Files:**
- Modify: `frontend/src/backup.ts` (throughout)
- Modify: `frontend/src/backup.test.ts` (update, extend)

**Interfaces:**
- Consumes: `toBase64`, `fromBase64`, `randomBytes`, `encryptBytes`, `decryptBytes` from `./crypto`.
- Produces:
  - `BACKUP_VERSION = 2`
  - `interface BackupImage { id: string; content_type: string; size_bytes: number; path: string }`
  - `interface BackupContent { notes: BackupNote[]; images: BackupImage[] }`
  - `PlainBackup` gains `images: BackupImage[]`
  - `serializeBackup(notes: Note[], meta: { username: string; exportedAt?: string; images?: BackupImage[] }): PlainBackup`
  - `newBackupKdf(): BackupKdf`
  - `deriveBackupKey(passphrase: string, kdf: BackupKdf): Promise<Uint8Array>`
  - `encryptBackupWithKey(backup: PlainBackup, kdf: BackupKdf, key: Uint8Array): Promise<EncryptedBackup>`
  - `encryptBackup(backup: PlainBackup, passphrase: string): Promise<EncryptedBackup>` *(unchanged signature)*
  - `decryptBackupWithKey(file: EncryptedBackup, key: Uint8Array): Promise<BackupContent>`
  - `decryptBackup(file: EncryptedBackup, passphrase: string): Promise<BackupContent>` *(return type changed)*
  - `contentOf(file: BackupFile, passphrase?: string): Promise<BackupContent>` *(replaces `notesOf`)*
  - `imagePath(id: string, contentType: string, encrypted: boolean): string`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/backup.test.ts`, replace the `notesOf` describe block with the block below and append the two new blocks. Update the import at the top to pull `contentOf`, `imagePath`, `newBackupKdf`, `deriveBackupKey`, `encryptBackupWithKey`, `decryptBackupWithKey` and `type BackupImage` instead of `notesOf`.

```ts
const image: BackupImage = {
  id: 'abc-123',
  content_type: 'image/webp',
  size_bytes: 48210,
  path: 'images/abc-123.webp',
}

describe('contentOf', () => {
  it('returns notes and images of a plain backup without a passphrase', async () => {
    const plain = serializeBackup([note], { username: 'jan', images: [image] })
    await expect(contentOf(plain)).resolves.toEqual({ notes: plain.notes, images: [image] })
  })

  it('decrypts an encrypted backup with the passphrase', async () => {
    const plain = serializeBackup([note], { username: 'jan', images: [image] })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    await expect(contentOf(enc, 'correct horse battery staple')).resolves.toEqual({
      notes: plain.notes,
      images: [image],
    })
  }, 30_000)

  it('refuses an encrypted backup with no passphrase', async () => {
    const enc = await encryptBackup(serializeBackup([note], { username: 'jan' }), 'a passphrase')
    await expect(contentOf(enc)).rejects.toThrow(/password-protected/i)
  }, 30_000)
})

describe('version 2 manifest', () => {
  it('defaults images to an empty array', () => {
    expect(serializeBackup([note], { username: 'jan' }).images).toEqual([])
  })

  it('writes version 2', () => {
    expect(serializeBackup([note], { username: 'jan' }).version).toBe(2)
  })

  it('round-trips the images array through text', () => {
    const text = JSON.stringify(serializeBackup([note], { username: 'jan', images: [image] }))
    const parsed = parseBackup(text)
    expect(isEncrypted(parsed)).toBe(false)
    if (!isEncrypted(parsed)) expect(parsed.images).toEqual([image])
  })

  it('reads a version 1 file as a backup with no images', () => {
    const v1 = {
      format: 'bpad-backup',
      version: 1,
      exported_at: '2026-07-20T10:00:00Z',
      username: 'jan',
      encrypted: false,
      notes: [{ title: 'T', content: 'c', url: null, created_at: 'x', updated_at: 'x', tags: [] }],
    }
    const parsed = parseBackup(JSON.stringify(v1))
    expect(isEncrypted(parsed)).toBe(false)
    if (!isEncrypted(parsed)) {
      expect(parsed.images).toEqual([])
      expect(parsed.notes).toHaveLength(1)
    }
  })

  it('keeps the images array out of the encrypted header', async () => {
    const plain = serializeBackup([note], { username: 'jan', images: [image] })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    expect(JSON.stringify(enc)).not.toContain('abc-123')
  }, 30_000)

  it('reads a version 1 encrypted payload that has no images key', async () => {
    const kdf = newBackupKdf()
    const key = await deriveBackupKey('a passphrase here', kdf)
    const legacy = await encryptBackupWithKey(
      { ...serializeBackup([note], { username: 'jan' }), images: [] },
      kdf,
      key,
    )
    await expect(decryptBackupWithKey(legacy, key)).resolves.toEqual({
      notes: serializeBackup([note], { username: 'jan' }).notes,
      images: [],
    })
  }, 30_000)
})

describe('imagePath', () => {
  it('uses the extension that matches the content type', () => {
    expect(imagePath('abc', 'image/webp', false)).toBe('images/abc.webp')
    expect(imagePath('abc', 'image/jpeg', false)).toBe('images/abc.jpg')
    expect(imagePath('abc', 'image/png', false)).toBe('images/abc.png')
  })

  it('falls back to .bin for an unknown content type', () => {
    expect(imagePath('abc', 'application/weird', false)).toBe('images/abc.bin')
  })

  it('uses .bin for an encrypted archive whatever the content type', () => {
    expect(imagePath('abc', 'image/webp', true)).toBe('images/abc.bin')
  })
})
```

Also update the existing `serializeBackup` test `'keeps every user-visible field'` — it asserts the exact shape of `b.notes[0]`, which does not change, so it stays as it is. The existing `'rejects a version from the future'` test uses `version: 99`, which still exceeds 2 — unchanged.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npm run test -- backup.test`
Expected: FAIL — `contentOf` / `imagePath` are not exported.

- [ ] **Step 3: Implement the format changes**

In `frontend/src/backup.ts`:

Bump the version and add the new types next to `BackupNote`:

```ts
export const BACKUP_VERSION = 2

// An image as it is listed in the manifest. `path` locates its bytes inside the
// archive; `size_bytes` is the size of the picture itself, not of the sealed
// file, so it stays meaningful in an encrypted backup.
export interface BackupImage {
  id: string
  content_type: string
  size_bytes: number
  path: string
}

// What a backup actually holds, once opened. Plain and encrypted backups both
// resolve to this.
export interface BackupContent {
  notes: BackupNote[]
  images: BackupImage[]
}
```

Add `images` to `PlainBackup`:

```ts
export interface PlainBackup extends BackupHeader {
  encrypted: false
  notes: BackupNote[]
  images: BackupImage[]
}
```

Widen `serializeBackup`:

```ts
export function serializeBackup(
  notes: Note[],
  meta: { username: string; exportedAt?: string; images?: BackupImage[] },
): PlainBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: meta.exportedAt ?? new Date().toISOString(),
    username: meta.username,
    encrypted: false,
    notes: notes.map((n) => ({
      title: n.title,
      content: n.content,
      url: n.url,
      created_at: n.created_at,
      updated_at: n.updated_at,
      tags: n.tags,
    })),
    images: meta.images ?? [],
  }
}
```

In `parseBackup`, replace the final plain-backup return so a version 1 file gains an empty manifest:

```ts
  if (!Array.isArray(raw.notes)) {
    throw new Error(translate('errors.backupDamaged'))
  }
  // A version 1 file has no images key at all.
  return {
    ...(raw as unknown as PlainBackup),
    images: Array.isArray(raw.images) ? (raw.images as BackupImage[]) : [],
  }
```

Add the path helper below the KDF constants:

```ts
// Extension by content type so the human-readable export links to something a
// picture viewer recognises. Encrypted archives are always .bin — the bytes are
// not an image until they are opened.
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export function imagePath(id: string, contentType: string, encrypted: boolean): string {
  const ext = encrypted ? 'bin' : (IMAGE_EXTENSIONS[contentType] ?? 'bin')
  return `images/${id}.${ext}`
}
```

Split the key handling — export `deriveBackupKey`, add `newBackupKdf`, and split encrypt/decrypt so one derived key can seal a whole archive:

```ts
export function newBackupKdf(): BackupKdf {
  return { ...BACKUP_KDF, salt: toBase64(randomBytes(16)) }
}

// …existing comment about no HKDF stays here…
export async function deriveBackupKey(passphrase: string, kdf: BackupKdf): Promise<Uint8Array> {
  return argon2id({ /* unchanged body */ })
}

// Takes an already-derived key: an archive seals its manifest and every image
// with the same key, and Argon2id must run once, not once per file.
export async function encryptBackupWithKey(
  backup: PlainBackup,
  kdf: BackupKdf,
  key: Uint8Array,
): Promise<EncryptedBackup> {
  const body = textEncoder.encode(JSON.stringify({ notes: backup.notes, images: backup.images }))
  const { iv, ct } = await encryptBytes(body, key)
  return {
    format: backup.format,
    version: backup.version,
    exported_at: backup.exported_at,
    username: backup.username,
    encrypted: true,
    kdf,
    cipher: 'AES-256-GCM',
    iv,
    ct,
  }
}

export async function encryptBackup(
  backup: PlainBackup,
  passphrase: string,
): Promise<EncryptedBackup> {
  const kdf = newBackupKdf()
  return encryptBackupWithKey(backup, kdf, await deriveBackupKey(passphrase, kdf))
}

export async function decryptBackupWithKey(
  file: EncryptedBackup,
  key: Uint8Array,
): Promise<BackupContent> {
  let bytes: Uint8Array
  try {
    bytes = await decryptBytes({ iv: file.iv, ct: file.ct }, key)
  } catch {
    // AES-GCM cannot tell a wrong key from a damaged file: both fail the tag
    // check. The passphrase is by far the likelier cause, so lead with it.
    throw new Error(translate('errors.backupWrongPassphrase'))
  }
  const body = JSON.parse(textDecoder.decode(bytes)) as Partial<BackupContent>
  if (!Array.isArray(body.notes)) throw new Error(translate('errors.backupDamaged'))
  return { notes: body.notes, images: Array.isArray(body.images) ? body.images : [] }
}

export async function decryptBackup(
  file: EncryptedBackup,
  passphrase: string,
): Promise<BackupContent> {
  return decryptBackupWithKey(file, await deriveBackupKey(passphrase, file.kdf))
}

// Replaces notesOf: a backup is notes *and* images now.
export async function contentOf(file: BackupFile, passphrase?: string): Promise<BackupContent> {
  if (!isEncrypted(file)) return { notes: file.notes, images: file.images }
  if (!passphrase) throw new Error(translate('errors.backupNeedsPassphrase'))
  return decryptBackup(file, passphrase)
}
```

Delete `notesOf`.

- [ ] **Step 4: Fix the existing call sites the compiler flags**

`decryptBackup` now resolves to `BackupContent`, so the two existing assertions of `.toEqual(plain.notes)` in the `encryptBackup / decryptBackup` describe block — in `'round-trips the notes'` and `'survives a full parse round trip through text'` — must become `.toEqual({ notes: plain.notes, images: [] })`.

`Restore.tsx` still imports `notesOf` — it is fixed in Task 13. Until then `npm run build` will fail on that one import; that is expected and Task 13 closes it. To keep this task's gate honest, temporarily leave `Restore.tsx` compiling by changing its import to `contentOf` and its one call site:

```ts
// Restore.tsx — minimal change to keep the build green; the real rework is Task 13.
import { contentOf } from './backup'
…
const opened = (await contentOf(target, pass)).notes
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd frontend && npm run test -- backup.test`
Expected: PASS. Argon2id makes this block take ~30 s.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/backup.ts src/backup.test.ts src/Restore.tsx
git commit -m "feat(web): backup format v2 with an image manifest"
```

---

### Task 5: Normalised note identity

Import rewrites image ids, so raw content no longer identifies a note across an import and re-importing the same file would duplicate everything.

**Files:**
- Modify: `frontend/src/backup.ts` (the `identity` function, ~line 203)
- Modify: `frontend/src/backup.test.ts` (extend the `diffAgainst` block)

**Interfaces:**
- Consumes: `normalizeImageRefs` from `./imageRefs` (Task 1).
- Produces: no new exports — `diffAgainst` keeps its signature and gains the behaviour.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('diffAgainst', …)` in `frontend/src/backup.test.ts`:

```ts
  it('recognises a note whose image ids were rewritten by an earlier import', () => {
    const stored: Note = {
      ...note,
      content: '# Recipe\n![](bpad-img:new-id-from-server)',
    }
    const incomingNote = incoming({ content: '# Recipe\n![](bpad-img:id-from-the-file)' })
    const d = diffAgainst([stored], [incomingNote])
    expect(d.toImport).toHaveLength(0)
    expect(d.duplicates).toHaveLength(1)
  })

  it('still separates notes that differ in more than their image ids', () => {
    const stored: Note = { ...note, content: '# Recipe\n![](bpad-img:a)' }
    const incomingNote = incoming({ content: '# Dinner\n![](bpad-img:b)' })
    expect(diffAgainst([stored], [incomingNote]).toImport).toHaveLength(1)
  })

  it('separates notes that reference a different number of images', () => {
    const stored: Note = { ...note, content: 'x ![](bpad-img:a)' }
    const incomingNote = incoming({ content: 'x ![](bpad-img:a) ![](bpad-img:b)' })
    expect(diffAgainst([stored], [incomingNote]).toImport).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backup.test`
Expected: FAIL — the first new test reports 1 to import, 0 duplicates.

- [ ] **Step 3: Implement**

In `frontend/src/backup.ts`, add the import and rewrite `identity`:

```ts
import { normalizeImageRefs } from './imageRefs'

// Identity of a note for import purposes. The server-side id is not in the
// file, so a note is "the same note" when it was created at the same instant
// and still says the same thing. Image references are normalised first: an
// import re-uploads every image and rewrites its id, so the raw text of a note
// that has already been restored no longer matches the file it came from.
function identity(n: { created_at: string; content: string }): string {
  return `${n.created_at} ${normalizeImageRefs(n.content)}`
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backup.test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/backup.ts src/backup.test.ts
git commit -m "fix(web): dedupe imported notes by normalised image references"
```

---

### Task 6: `backupMarkdown.ts` — the human-readable export

**Files:**
- Create: `frontend/src/backupMarkdown.ts`
- Create: `frontend/src/backupMarkdown.test.ts`

**Interfaces:**
- Consumes: `localizeImageRefs` from `./imageRefs` (Task 1); `BackupNote` from `./backup`.
- Produces:
  - `slugify(title: string): string`
  - `renderNoteMarkdown(note: BackupNote, paths: Map<string, string>): string`
  - `buildMarkdownFiles(notes: BackupNote[], paths: Map<string, string>): Record<string, string>` — keys are file names **without** the `notes/` prefix

- [ ] **Step 1: Write the failing test**

Create `frontend/src/backupMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { slugify, renderNoteMarkdown, buildMarkdownFiles } from './backupMarkdown'
import type { BackupNote } from './backup'

const bn = (over: Partial<BackupNote> = {}): BackupNote => ({
  title: 'Groceries',
  content: 'milk',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-03T03:04:05Z',
  tags: ['home'],
  ...over,
})

describe('slugify', () => {
  it('strips diacritics and lowercases', () => {
    expect(slugify('Příliš žluťoučký kůň')).toBe('prilis-zlutoucky-kun')
  })

  it('collapses punctuation and spaces into single dashes', () => {
    expect(slugify('Shopping: milk, bread!')).toBe('shopping-milk-bread')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --- hello ---  ')).toBe('hello')
  })

  it('caps the length and does not end in a dash', () => {
    const s = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30))
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('-')).toBe(false)
  })

  it('falls back for a title with nothing usable in it', () => {
    expect(slugify('★★★')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
  })
})

describe('renderNoteMarkdown', () => {
  it('writes front matter and the body', () => {
    const out = renderNoteMarkdown(bn(), new Map())
    expect(out).toBe(
      '---\ntitle: "Groceries"\ncreated: 2026-01-02T03:04:05Z\n' +
        'updated: 2026-01-03T03:04:05Z\ntags: ["home"]\n---\n\nmilk\n',
    )
  })

  it('escapes quotes and backslashes in the title', () => {
    const out = renderNoteMarkdown(bn({ title: 'He said "hi" \\ bye' }), new Map())
    expect(out).toContain('title: "He said \\"hi\\" \\\\ bye"')
  })

  it('writes an empty tag list', () => {
    expect(renderNoteMarkdown(bn({ tags: [] }), new Map())).toContain('tags: []')
  })

  it('rewrites image references to relative paths', () => {
    const paths = new Map([['abc', '../images/abc.webp']])
    const out = renderNoteMarkdown(bn({ content: 'see ![pic](bpad-img:abc)' }), paths)
    expect(out).toContain('see ![pic](../images/abc.webp)')
  })

  it('leaves a reference with no path alone', () => {
    const out = renderNoteMarkdown(bn({ content: '![](bpad-img:missing)' }), new Map())
    expect(out).toContain('![](bpad-img:missing)')
  })
})

describe('buildMarkdownFiles', () => {
  it('names files by creation date and slug', () => {
    const files = buildMarkdownFiles([bn()], new Map())
    expect(Object.keys(files)).toEqual(['2026-01-02-groceries.md'])
  })

  it('disambiguates colliding names', () => {
    const files = buildMarkdownFiles([bn(), bn(), bn()], new Map())
    expect(Object.keys(files)).toEqual([
      '2026-01-02-groceries.md',
      '2026-01-02-groceries-2.md',
      '2026-01-02-groceries-3.md',
    ])
  })

  it('handles an empty vault', () => {
    expect(buildMarkdownFiles([], new Map())).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backupMarkdown`
Expected: FAIL — `Failed to resolve import "./backupMarkdown"`.

- [ ] **Step 3: Write `backupMarkdown.ts`**

```ts
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
    .replace(/[\u0300-\u036f]/g, '') // combining marks left over by NFD
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backupMarkdown`
Expected: PASS, 13 tests.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/backupMarkdown.ts src/backupMarkdown.test.ts
git commit -m "feat(web): human-readable markdown export for plain backups"
```

---

### Task 7: `backupArchive.ts` — build and read the archive

**Files:**
- Create: `frontend/src/backupArchive.ts`
- Create: `frontend/src/backupArchive.test.ts`

**Interfaces:**
- Consumes: `zipFiles`, `unzipFiles`, `type ZipEntry` from `./backupZip`; `serializeBackup`, `parseBackup`, `isEncrypted`, `newBackupKdf`, `deriveBackupKey`, `encryptBackupWithKey`, `decryptBackupWithKey`, `imagePath`, types from `./backup`; `sealBytes`, `openBytes` from `./crypto`; `buildMarkdownFiles` from `./backupMarkdown`; `translate` from `./i18n/translate`.
- Produces:
  - `interface ArchiveImage { id: string; content_type: string; bytes: Uint8Array }`
  - `buildArchive(input: { notes: Note[]; images: ArchiveImage[]; username: string; exportedAt?: string; passphrase?: string }): Promise<Uint8Array>`
  - `interface ArchiveHandle { file: BackupFile; entries: Record<string, Uint8Array> }`
  - `readArchive(bytes: Uint8Array): ArchiveHandle`
  - `interface OpenedBackup { notes: BackupNote[]; images: Map<string, ArchiveImage> }`
  - `openArchive(handle: ArchiveHandle, passphrase?: string): Promise<OpenedBackup>`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/backupArchive.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildArchive, readArchive, openArchive, type ArchiveImage } from './backupArchive'
import { unzipFiles } from './backupZip'
import { isEncrypted } from './backup'
import type { Note } from './types'

const dec = new TextDecoder()

const note: Note = {
  id: 'server-id',
  title: 'Recipe',
  content: '# Recipe\n![](bpad-img:pic-1)',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T03:04:05Z',
  tags: ['food'],
}

const picture: ArchiveImage = {
  id: 'pic-1',
  content_type: 'image/webp',
  bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]),
}

describe('buildArchive — plain', () => {
  it('writes backup.json, the image and the readable markdown', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const names = Object.keys(unzipFiles(archive)).sort()
    expect(names).toEqual([
      'backup.json',
      'images/pic-1.webp',
      'notes/2026-01-02-recipe.md',
    ])
  })

  it('lists the image in the manifest with its plaintext size', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const manifest = JSON.parse(dec.decode(unzipFiles(archive)['backup.json']))
    expect(manifest.version).toBe(2)
    expect(manifest.images).toEqual([
      { id: 'pic-1', content_type: 'image/webp', size_bytes: 8, path: 'images/pic-1.webp' },
    ])
  })

  it('leaves the note content referencing bpad-img, not a path', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const manifest = JSON.parse(dec.decode(unzipFiles(archive)['backup.json']))
    expect(manifest.notes[0].content).toContain('bpad-img:pic-1')
  })

  it('points the markdown export at the relative image path', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const md = dec.decode(unzipFiles(archive)['notes/2026-01-02-recipe.md'])
    expect(md).toContain('![](../images/pic-1.webp)')
  })

  it('builds an archive for a vault with no images at all', async () => {
    const archive = await buildArchive({ notes: [note], images: [], username: 'jan' })
    const names = Object.keys(unzipFiles(archive)).sort()
    expect(names).toEqual(['backup.json', 'notes/2026-01-02-recipe.md'])
  })
})

describe('buildArchive — encrypted', () => {
  it('seals the manifest and the image, and writes no readable markdown', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [picture],
      username: 'jan',
      passphrase: 'correct horse battery staple',
    })
    const entries = unzipFiles(archive)
    expect(Object.keys(entries).sort()).toEqual(['backup.json', 'images/pic-1.bin'])
    const manifest = JSON.parse(dec.decode(entries['backup.json']))
    expect(manifest.encrypted).toBe(true)
    expect(JSON.stringify(manifest)).not.toContain('Recipe')
    expect(entries['images/pic-1.bin']).not.toEqual(picture.bytes)
  }, 60_000)
})

describe('readArchive / openArchive', () => {
  it('round-trips a plain archive', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const opened = await openArchive(readArchive(archive))
    expect(opened.notes[0].title).toBe('Recipe')
    expect(opened.images.get('pic-1')?.bytes).toEqual(picture.bytes)
    expect(opened.images.get('pic-1')?.content_type).toBe('image/webp')
  })

  it('round-trips an encrypted archive with the passphrase', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [picture],
      username: 'jan',
      passphrase: 'correct horse battery staple',
    })
    const opened = await openArchive(readArchive(archive), 'correct horse battery staple')
    expect(opened.notes[0].content).toContain('bpad-img:pic-1')
    expect(opened.images.get('pic-1')?.bytes).toEqual(picture.bytes)
  }, 60_000)

  it('rejects the wrong passphrase', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [picture],
      username: 'jan',
      passphrase: 'right passphrase here',
    })
    await expect(openArchive(readArchive(archive), 'wrong passphrase here')).rejects.toThrow(
      /passphrase/i,
    )
  }, 60_000)

  it('exposes the header before the passphrase is known', async () => {
    const archive = await buildArchive({
      notes: [note],
      images: [],
      username: 'jan',
      passphrase: 'correct horse battery staple',
    })
    const handle = readArchive(archive)
    expect(handle.file.username).toBe('jan')
    expect(isEncrypted(handle.file)).toBe(true)
  }, 60_000)

  it('skips an image the manifest lists but the archive does not carry', async () => {
    const archive = await buildArchive({ notes: [note], images: [picture], username: 'jan' })
    const handle = readArchive(archive)
    delete handle.entries['images/pic-1.webp']
    const opened = await openArchive(handle)
    expect(opened.notes).toHaveLength(1)
    expect(opened.images.size).toBe(0)
  })

  it('rejects an archive with no backup.json', () => {
    const bogus = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
    expect(() => readArchive(bogus)).toThrow()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backupArchive`
Expected: FAIL — `Failed to resolve import "./backupArchive"`.

- [ ] **Step 3: Write `backupArchive.ts`**

```ts
// Assembles and reads a version 2 backup archive. Pure: bytes in, bytes out —
// no network, no DOM, no browser storage. The layout is
//   backup.json            the manifest (plain or sealed)
//   images/<id>.<ext>      picture bytes (.bin when sealed)
//   notes/<date>-<slug>.md readable copy, plain archives only
import { zipFiles, unzipFiles, type ZipEntry } from './backupZip'
import { buildMarkdownFiles } from './backupMarkdown'
import { sealBytes, openBytes } from './crypto'
import { translate } from './i18n/translate'
import {
  serializeBackup,
  parseBackup,
  isEncrypted,
  newBackupKdf,
  deriveBackupKey,
  encryptBackupWithKey,
  decryptBackupWithKey,
  imagePath,
  type BackupContent,
  type BackupFile,
  type BackupImage,
  type BackupNote,
} from './backup'
import type { Note } from './types'

const MANIFEST = 'backup.json'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// An image on its way in or out of an archive: always the *plaintext* picture.
// Sealing happens inside buildArchive and unsealing inside openArchive.
export interface ArchiveImage {
  id: string
  content_type: string
  bytes: Uint8Array
}

export interface BuildArchiveInput {
  notes: Note[]
  images: ArchiveImage[]
  username: string
  exportedAt?: string
  // Undefined means a plain archive.
  passphrase?: string
}

function json(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value, null, 2))
}

export async function buildArchive(input: BuildArchiveInput): Promise<Uint8Array> {
  const encrypted = input.passphrase !== undefined && input.passphrase !== ''
  const manifest: BackupImage[] = input.images.map((img) => ({
    id: img.id,
    content_type: img.content_type,
    size_bytes: img.bytes.length,
    path: imagePath(img.id, img.content_type, encrypted),
  }))
  const plain = serializeBackup(input.notes, {
    username: input.username,
    exportedAt: input.exportedAt,
    images: manifest,
  })

  const files: Record<string, ZipEntry> = {}

  if (encrypted) {
    // One Argon2id run for the whole archive: the manifest and every image are
    // sealed with the same key.
    const kdf = newBackupKdf()
    const key = await deriveBackupKey(input.passphrase as string, kdf)
    files[MANIFEST] = { bytes: json(await encryptBackupWithKey(plain, kdf, key)) }
    for (const [i, img] of input.images.entries()) {
      files[manifest[i].path] = { bytes: await sealBytes(img.bytes, key), compress: false }
    }
    return zipFiles(files)
  }

  files[MANIFEST] = { bytes: json(plain) }
  for (const [i, img] of input.images.entries()) {
    files[manifest[i].path] = { bytes: img.bytes, compress: false }
  }
  const paths = new Map(manifest.map((m) => [m.id, `../${m.path}`]))
  for (const [name, text] of Object.entries(buildMarkdownFiles(plain.notes, paths))) {
    files[`notes/${name}`] = { bytes: textEncoder.encode(text) }
  }
  return zipFiles(files)
}

// Stage one of reading: the header is needed before the passphrase can be
// asked for, so unpacking and unlocking are separate steps.
export interface ArchiveHandle {
  file: BackupFile
  entries: Record<string, Uint8Array>
}

export function readArchive(bytes: Uint8Array): ArchiveHandle {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipFiles(bytes)
  } catch {
    throw new Error(translate('errors.backupUnreadable'))
  }
  const manifest = entries[MANIFEST]
  if (!manifest) throw new Error(translate('errors.backupNotBpad'))
  return { file: parseBackup(textDecoder.decode(manifest)), entries }
}

export interface OpenedBackup {
  notes: BackupNote[]
  // Keyed by the id the archive was written with — import maps these to fresh ids.
  images: Map<string, ArchiveImage>
}

export async function openArchive(
  handle: ArchiveHandle,
  passphrase?: string,
): Promise<OpenedBackup> {
  // Bound to a const so isEncrypted() narrows it — narrowing a property access
  // does not survive the awaits below.
  const file = handle.file
  let key: Uint8Array | null = null
  let content: BackupContent
  if (isEncrypted(file)) {
    if (!passphrase) throw new Error(translate('errors.backupNeedsPassphrase'))
    key = await deriveBackupKey(passphrase, file.kdf)
    content = await decryptBackupWithKey(file, key)
  } else {
    content = { notes: file.notes, images: file.images }
  }

  const images = new Map<string, ArchiveImage>()
  for (const entry of content.images) {
    const raw = handle.entries[entry.path]
    // A manifest entry with no file behind it means a picture that failed to
    // download when the backup was written, or a hand-edited archive. The note
    // still restores, with one broken image.
    if (!raw) continue
    images.set(entry.id, {
      id: entry.id,
      content_type: entry.content_type,
      bytes: key ? await openBytes(raw, key) : raw,
    })
  }
  return { notes: content.notes, images }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backupArchive`
Expected: PASS, 12 tests. The encrypted blocks take ~30 s each.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/backupArchive.ts src/backupArchive.test.ts
git commit -m "feat(web): build and read version 2 backup archives"
```

---

### Task 8: `images.ts` — download an image, and notice a rate limit

**Files:**
- Modify: `frontend/src/images.ts` (append `downloadImage`, change `uploadImage`)
- Modify: `frontend/src/images.test.ts` (extend)

**Interfaces:**
- Consumes: existing `resolveImageUrl`, `authHeaders`.
- Produces:
  - `class UploadRateLimited extends Error`
  - `downloadImage(id: string): Promise<{ bytes: Uint8Array; contentType: string }>`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/images.test.ts` (add `downloadImage`, `UploadRateLimited`, `clearImageUrlCache` to the import from `./images`):

```ts
describe('downloadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearImageUrlCache()
  })

  it('resolves the read URL and returns the bytes with their content type', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    const bytes = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/url')) {
          return { ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never
        }
        return {
          ok: true,
          headers: new Headers({ 'Content-Type': 'image/webp' }),
          arrayBuffer: async () => bytes.buffer,
        } as never
      }),
    )
    await expect(downloadImage('pic-1')).resolves.toEqual({
      bytes,
      contentType: 'image/webp',
    })
    clearSession()
  })

  it('falls back to image/webp when the blob reports no content type', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/url')
          ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
          : ({
              ok: true,
              headers: new Headers(),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            } as never),
      ),
    )
    await expect(downloadImage('pic-2')).resolves.toMatchObject({ contentType: 'image/webp' })
    clearSession()
  })

  it('throws when the blob cannot be fetched', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/url')
          ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
          : ({ ok: false, status: 404 } as never),
      ),
    )
    await expect(downloadImage('pic-3')).rejects.toThrow(/download/i)
    clearSession()
  })
})

describe('uploadImage rate limiting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('throws UploadRateLimited on a 429', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 }) as never))
    await expect(uploadImage(new Blob([new Uint8Array([1])]))).rejects.toBeInstanceOf(
      UploadRateLimited,
    )
    clearSession()
  })

  it('throws a plain error on any other failure', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as never))
    const err = await uploadImage(new Blob([new Uint8Array([1])])).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UploadRateLimited)
    clearSession()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- images`
Expected: FAIL — `downloadImage` / `UploadRateLimited` are not exported.

- [ ] **Step 3: Implement**

In `frontend/src/images.ts`, add the error class above `uploadImage` and branch on 429:

```ts
// A restore uploads one image per note reference and the API allows 60 per 10
// minutes, so hitting the limit is expected on a large vault — the importer has
// to tell it apart from a genuine failure and stop cleanly.
export class UploadRateLimited extends Error {
  constructor() {
    super('image-upload-rate-limited')
    this.name = 'UploadRateLimited'
  }
}
```

Inside `uploadImage`, replace the init check:

```ts
  if (init.status === 429) throw new UploadRateLimited()
  if (!init.ok) throw new Error('upload-init-failed')
```

Append below `resolveImageUrl`:

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- images`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/images.ts src/images.test.ts
git commit -m "feat(web): download image bytes and detect the upload rate limit"
```

---

### Task 9: `backupExport.ts` — export orchestration

**Files:**
- Create: `frontend/src/backupExport.ts`
- Create: `frontend/src/backupExport.test.ts`

**Interfaces:**
- Consumes: `listNotes` from `./api`; `parseImageIds` from `./imageRefs`; `downloadImage` from `./images`; `buildArchive`, `type ArchiveImage` from `./backupArchive`.
- Produces:
  - `type ExportPhase = 'images' | 'packing'`
  - `interface ExportProgress { phase: ExportPhase; done: number; total: number }`
  - `interface ExportResult { archive: Uint8Array; exportedAt: string; noteCount: number; imageCount: number; missingImages: string[] }`
  - `exportBackup(opts: { username: string; passphrase?: string; onProgress?: (p: ExportProgress) => void }): Promise<ExportResult>`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/backupExport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportBackup } from './backupExport'
import { readArchive, openArchive } from './backupArchive'
import type { Note } from './types'

vi.mock('./api', () => ({ listNotes: vi.fn() }))
vi.mock('./images', () => ({ downloadImage: vi.fn() }))
import { listNotes } from './api'
import { downloadImage } from './images'

const mockList = vi.mocked(listNotes)
const mockDownload = vi.mocked(downloadImage)

const note = (over: Partial<Note> = {}): Note => ({
  id: 'server-id',
  title: 'Recipe',
  content: '# Recipe',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T03:04:05Z',
  tags: [],
  ...over,
})

beforeEach(() => {
  mockList.mockReset()
  mockDownload.mockReset()
  mockDownload.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp' })
})

describe('exportBackup', () => {
  it('packs a vault with no images', async () => {
    mockList.mockResolvedValue([note()])
    const result = await exportBackup({ username: 'jan' })
    expect(result.noteCount).toBe(1)
    expect(result.imageCount).toBe(0)
    expect(mockDownload).not.toHaveBeenCalled()
    const opened = await openArchive(readArchive(result.archive))
    expect(opened.notes[0].title).toBe('Recipe')
  })

  it('downloads every referenced image exactly once', async () => {
    mockList.mockResolvedValue([
      note({ content: '![](bpad-img:a) ![](bpad-img:b)' }),
      note({ id: 'n2', content: '![](bpad-img:a)' }),
    ])
    const result = await exportBackup({ username: 'jan' })
    expect(mockDownload).toHaveBeenCalledTimes(2)
    expect(result.imageCount).toBe(2)
    const opened = await openArchive(readArchive(result.archive))
    expect([...opened.images.keys()].sort()).toEqual(['a', 'b'])
  })

  it('downloads sequentially, not in parallel', async () => {
    let inFlight = 0
    let peak = 0
    mockDownload.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { bytes: new Uint8Array([1]), contentType: 'image/webp' }
    })
    mockList.mockResolvedValue([note({ content: '![](bpad-img:a) ![](bpad-img:b) ![](bpad-img:c)' })])
    await exportBackup({ username: 'jan' })
    expect(peak).toBe(1)
  })

  it('reports an image it could not download and still packs the rest', async () => {
    mockDownload.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('resolve-failed')
      return { bytes: new Uint8Array([1]), contentType: 'image/webp' }
    })
    mockList.mockResolvedValue([note({ content: '![](bpad-img:good) ![](bpad-img:bad)' })])
    const result = await exportBackup({ username: 'jan' })
    expect(result.missingImages).toEqual(['bad'])
    expect(result.imageCount).toBe(1)
    const opened = await openArchive(readArchive(result.archive))
    expect(opened.images.has('good')).toBe(true)
    expect(opened.images.has('bad')).toBe(false)
  })

  it('reports progress for images and then for packing', async () => {
    mockList.mockResolvedValue([note({ content: '![](bpad-img:a)' })])
    const seen: string[] = []
    await exportBackup({
      username: 'jan',
      onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`),
    })
    expect(seen).toEqual(['images:0/1', 'images:1/1', 'packing:1/1'])
  })

  it('produces an encrypted archive when given a passphrase', async () => {
    mockList.mockResolvedValue([note({ content: '![](bpad-img:a)' })])
    const result = await exportBackup({ username: 'jan', passphrase: 'correct horse battery' })
    const handle = readArchive(result.archive)
    expect(handle.file.encrypted).toBe(true)
    const opened = await openArchive(handle, 'correct horse battery')
    expect(opened.images.get('a')?.bytes).toEqual(new Uint8Array([1, 2, 3]))
  }, 60_000)

  it('reports an empty vault without failing', async () => {
    mockList.mockResolvedValue([])
    const result = await exportBackup({ username: 'jan' })
    expect(result.noteCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backupExport`
Expected: FAIL — `Failed to resolve import "./backupExport"`.

- [ ] **Step 3: Write `backupExport.ts`**

```ts
// Export orchestration: collect the notes, pull down every image they
// reference, hand it all to backupArchive. The only module in the backup chain
// that touches the network on the way out.
import { listNotes } from './api'
import { parseImageIds } from './imageRefs'
import { downloadImage } from './images'
import { buildArchive, type ArchiveImage } from './backupArchive'

export type ExportPhase = 'images' | 'packing'

export interface ExportProgress {
  phase: ExportPhase
  done: number
  total: number
}

export interface ExportResult {
  archive: Uint8Array
  exportedAt: string
  noteCount: number
  imageCount: number
  // Ids that could not be fetched. Their notes are still exported, with a
  // reference that will not resolve — an honest gap beats a silent one.
  missingImages: string[]
}

export async function exportBackup(opts: {
  username: string
  passphrase?: string
  onProgress?: (progress: ExportProgress) => void
}): Promise<ExportResult> {
  // listNotes() falls back to the offline cache, so a backup still works
  // without the network — it just backs up what this device knows.
  const notes = await listNotes()
  const ids = [...new Set(notes.flatMap((n) => parseImageIds(n.content)))]

  const images: ArchiveImage[] = []
  const missingImages: string[] = []
  // Sequential on purpose: flat load on the blob account and an honest
  // progress indicator, the same reasoning as the import side.
  for (const [i, id] of ids.entries()) {
    opts.onProgress?.({ phase: 'images', done: i, total: ids.length })
    try {
      const { bytes, contentType } = await downloadImage(id)
      images.push({ id, content_type: contentType, bytes })
    } catch {
      missingImages.push(id)
    }
  }
  opts.onProgress?.({ phase: 'images', done: ids.length, total: ids.length })
  opts.onProgress?.({ phase: 'packing', done: ids.length, total: ids.length })

  const exportedAt = new Date().toISOString()
  const archive = await buildArchive({
    notes,
    images,
    username: opts.username,
    exportedAt,
    passphrase: opts.passphrase,
  })
  return {
    archive,
    exportedAt,
    noteCount: notes.length,
    imageCount: images.length,
    missingImages,
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backupExport`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npm run test && npm run lint && npm run build
git add src/backupExport.ts src/backupExport.test.ts
git commit -m "feat(web): export orchestration with image download and progress"
```

---

### Task 10: `backupFile.ts` — the browser edges

**Files:**
- Modify: `frontend/src/backupFile.ts` (rewrite)
- Modify: `frontend/src/backupFile.test.ts` (rewrite)

**Interfaces:**
- Consumes: `looksLikeZip` from `./backupZip`; `readArchive`, `type ArchiveHandle` from `./backupArchive`; `parseBackup` from `./backup`; `toArrayBuffer` from `./crypto`.
- Produces:
  - `archiveFilename(exportedAt: string, encrypted: boolean): string`
  - `downloadArchive(archive: Uint8Array, filename: string): void`
  - `openBackupFile(file: File): Promise<ArchiveHandle>`
- Removes: `backupFilename`, `downloadBackup`, `readTextFile`.

- [ ] **Step 1: Write the failing test**

Replace the contents of `frontend/src/backupFile.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { archiveFilename, downloadArchive, openBackupFile } from './backupFile'
import { buildArchive } from './backupArchive'
import { serializeBackup, isEncrypted } from './backup'
import type { Note } from './types'

const note: Note = {
  id: 'x',
  title: 'T',
  content: 'c',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T03:04:05Z',
  tags: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('archiveFilename', () => {
  it('names a plain archive by its export date', () => {
    expect(archiveFilename('2026-07-20T10:00:00Z', false)).toBe('bpad-backup-2026-07-20.zip')
  })

  it('marks an encrypted archive', () => {
    expect(archiveFilename('2026-07-20T10:00:00Z', true)).toBe('bpad-backup-2026-07-20-enc.zip')
  })
})

// The suite runs in plain Node, so the handful of DOM calls are stubbed
// rather than pulling in jsdom for one test.
describe('downloadArchive', () => {
  it('clicks an anchor pointing at a blob URL and revokes it', () => {
    const anchor = { click: vi.fn(), href: '', download: '' }
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(anchor) })
    const createObjectURL = vi.fn().mockReturnValue('blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadArchive(new Uint8Array([1, 2, 3]), 'bpad-backup-2026-07-20.zip')

    expect(createObjectURL).toHaveBeenCalled()
    expect(anchor.href).toBe('blob:fake')
    expect(anchor.download).toBe('bpad-backup-2026-07-20.zip')
    expect(anchor.click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('writes the archive bytes as the blob contents', async () => {
    let captured: Blob | null = null
    vi.stubGlobal('document', { createElement: () => ({ click: () => {}, href: '', download: '' }) })
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        captured = b
        return 'blob:fake'
      },
      revokeObjectURL: () => {},
    })

    downloadArchive(new Uint8Array([1, 2, 3]), 'a.zip')

    expect(captured).not.toBeNull()
    expect(new Uint8Array(await captured!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('openBackupFile', () => {
  it('opens a version 2 archive', async () => {
    const archive = await buildArchive({ notes: [note], images: [], username: 'jan' })
    const picked = new File([archive], 'b.zip', { type: 'application/zip' })
    const handle = await openBackupFile(picked)
    expect(handle.file.username).toBe('jan')
    expect(isEncrypted(handle.file)).toBe(false)
  })

  it('opens a legacy version 1 JSON file with no entries', async () => {
    const v1 = JSON.stringify({
      ...serializeBackup([note], { username: 'jan' }),
      version: 1,
      images: undefined,
    })
    const picked = new File([v1], 'b.json', { type: 'application/json' })
    const handle = await openBackupFile(picked)
    expect(handle.file.version).toBe(1)
    expect(handle.entries).toEqual({})
  })

  it('rejects a file that is neither a zip nor JSON', async () => {
    const picked = new File(['definitely not a backup'], 'b.txt', { type: 'text/plain' })
    await expect(openBackupFile(picked)).rejects.toThrow(/couldn’t be read/i)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backupFile`
Expected: FAIL — `archiveFilename` is not exported.

- [ ] **Step 3: Rewrite `backupFile.ts`**

```ts
// The browser side of backups: turning an archive into a download, and a picked
// File into something the format layer can read. Isolated from backup.ts and
// backupArchive.ts so the format logic stays testable without DOM APIs.
import { looksLikeZip } from './backupZip'
import { readArchive, type ArchiveHandle } from './backupArchive'
import { parseBackup } from './backup'
import { toArrayBuffer } from './crypto'

export function archiveFilename(exportedAt: string, encrypted: boolean): string {
  const day = exportedAt.slice(0, 10)
  return `bpad-backup-${day}${encrypted ? '-enc' : ''}.zip`
}

export function downloadArchive(archive: Uint8Array, filename: string): void {
  const blob = new Blob([toArrayBuffer(archive)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Accepts both a version 2 archive and a version 1 JSON/.bpad file. The old
// format has no images, so it opens as an archive with no entries and every
// caller downstream works unchanged.
export async function openBackupFile(file: File): Promise<ArchiveHandle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (looksLikeZip(bytes)) return readArchive(bytes)
  return { file: parseBackup(new TextDecoder().decode(bytes)), entries: {} }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backupFile`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: tests and lint pass; **`npm run build` fails** on `Account.tsx` and `Restore.tsx`, which still import `downloadBackup` / `readTextFile`. That is expected — Tasks 12 and 13 fix them. Commit anyway so the next task starts from a clean tree.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/backupFile.ts src/backupFile.test.ts
git commit -m "feat(web): download and open version 2 backup archives"
```

---

### Task 11: `backupImport.ts` — two-phase import

**Files:**
- Modify: `frontend/src/backupImport.ts` (rewrite)
- Modify: `frontend/src/backupImport.test.ts` (rewrite)

**Interfaces:**
- Consumes: `createNote` from `./api`; `uploadImage`, `UploadRateLimited` from `./images`; `parseImageIds`, `rewriteImageRefs` from `./imageRefs`; `type ArchiveImage` from `./backupArchive`; `type BackupNote` from `./backup`.
- Produces:
  - `type ImportLimit = 'unverified' | 'hard' | 'images'`
  - `interface ImportSummary { imported: number; failed: number; imagesUploaded: number; imagesFailed: number; stoppedByLimit: ImportLimit | null }`
  - `interface ImportProgress { phase: 'images' | 'notes'; done: number; total: number }`
  - `importBackup(notes: BackupNote[], images: Map<string, ArchiveImage>, onProgress?: (p: ImportProgress) => void): Promise<ImportSummary>` *(replaces `importNotes`)*

- [ ] **Step 1: Write the failing test**

Replace `frontend/src/backupImport.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importBackup } from './backupImport'
import { UploadRateLimited } from './images'
import type { BackupNote } from './backup'
import type { ArchiveImage } from './backupArchive'

vi.mock('./api', () => ({ createNote: vi.fn() }))
vi.mock('./images', async () => {
  const actual = await vi.importActual<typeof import('./images')>('./images')
  return { uploadImage: vi.fn(), UploadRateLimited: actual.UploadRateLimited }
})
import { createNote } from './api'
import { uploadImage } from './images'

const mockCreate = vi.mocked(createNote)
const mockUpload = vi.mocked(uploadImage)

function backupNote(i: number, content = `body ${i}`): BackupNote {
  return {
    title: `Note ${i}`,
    content,
    url: null,
    created_at: `2026-01-0${i}T00:00:00Z`,
    updated_at: `2026-01-0${i}T00:00:00Z`,
    tags: ['x'],
  }
}

const picture = (id: string): ArchiveImage => ({
  id,
  content_type: 'image/webp',
  bytes: new Uint8Array([1, 2, 3]),
})

beforeEach(() => {
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({} as never)
  mockUpload.mockReset()
  mockUpload.mockImplementation(async () => `new-${mockUpload.mock.calls.length}`)
})

describe('importBackup', () => {
  it('creates every note with its title, tags and original timestamp', async () => {
    const summary = await importBackup([backupNote(1)], new Map())
    expect(summary).toEqual({
      imported: 1,
      failed: 0,
      imagesUploaded: 0,
      imagesFailed: 0,
      stoppedByLimit: null,
    })
    expect(mockCreate).toHaveBeenCalledWith('body 1', ['x'], {
      title: 'Note 1',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('uploads images before creating any note', async () => {
    const order: string[] = []
    mockUpload.mockImplementation(async () => {
      order.push('upload')
      return 'new-id'
    })
    mockCreate.mockImplementation(async () => {
      order.push('create')
      return {} as never
    })
    await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
    )
    expect(order).toEqual(['upload', 'create'])
  })

  it('rewrites references to the new ids', async () => {
    mockUpload.mockResolvedValue('fresh-id')
    await importBackup(
      [backupNote(1, 'a ![](bpad-img:old) b')],
      new Map([['old', picture('old')]]),
    )
    expect(mockCreate).toHaveBeenCalledWith('a ![](bpad-img:fresh-id) b', ['x'], expect.anything())
  })

  it('uploads an image referenced by two notes only once', async () => {
    await importBackup(
      [backupNote(1, '![](bpad-img:shared)'), backupNote(2, '![](bpad-img:shared)')],
      new Map([['shared', picture('shared')]]),
    )
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('ignores an image the notes do not reference', async () => {
    await importBackup([backupNote(1)], new Map([['orphan', picture('orphan')]]))
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('keeps the original reference when an upload fails, and still imports the note', async () => {
    mockUpload.mockRejectedValue(new Error('upload-failed'))
    const summary = await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
    )
    expect(summary.imagesFailed).toBe(1)
    expect(summary.imported).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith('![](bpad-img:old)', ['x'], expect.anything())
  })

  it('stops the whole import when the image rate limit is hit', async () => {
    mockUpload.mockRejectedValue(new UploadRateLimited())
    const summary = await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
    )
    expect(summary.stoppedByLimit).toBe('images')
    expect(summary.imported).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('imports sequentially, not in parallel', async () => {
    let inFlight = 0
    let peak = 0
    mockCreate.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return {} as never
    })
    await importBackup([backupNote(1), backupNote(2), backupNote(3)], new Map())
    expect(peak).toBe(1)
  })

  it('counts a failed note and carries on', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))
    const summary = await importBackup([backupNote(1), backupNote(2)], new Map())
    expect(summary.imported).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('stops on the unverified-account note limit', async () => {
    mockCreate.mockRejectedValue(new Error('Please verify your e-mail to add more notes'))
    const summary = await importBackup([backupNote(1), backupNote(2)], new Map())
    expect(summary.stoppedByLimit).toBe('unverified')
    expect(summary.imported).toBe(0)
  })

  it('stops on the hard note limit', async () => {
    mockCreate.mockRejectedValue(new Error('Note limit reached'))
    const summary = await importBackup([backupNote(1)], new Map())
    expect(summary.stoppedByLimit).toBe('hard')
  })

  it('reports progress for both phases', async () => {
    const seen: string[] = []
    await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
      (p) => seen.push(`${p.phase}:${p.done}/${p.total}`),
    )
    expect(seen).toEqual(['images:0/1', 'images:1/1', 'notes:0/1', 'notes:1/1'])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm run test -- backupImport`
Expected: FAIL — `importBackup` is not exported.

- [ ] **Step 3: Rewrite `backupImport.ts`**

```ts
// Restores a parsed backup into the logged-in account. Images go first: each
// one is uploaded to this account, and only then are the notes created with
// their references pointed at the new ids. Every note goes through the ordinary
// createNote() path, so it is encrypted with the current data key before it
// leaves the browser, and createNote() parses image_ids out of the rewritten
// content itself — which is what claims the fresh uploads and saves them from
// the server's 24-hour sweep of pending images.
import { createNote } from './api'
import { uploadImage, UploadRateLimited } from './images'
import { parseImageIds, rewriteImageRefs } from './imageRefs'
import { toArrayBuffer } from './crypto'
import type { ArchiveImage } from './backupArchive'
import type { BackupNote } from './backup'

export type ImportLimit = 'unverified' | 'hard' | 'images'

export interface ImportSummary {
  imported: number
  failed: number
  imagesUploaded: number
  imagesFailed: number
  // Which limit cut the import short, or null if it ran to completion.
  stoppedByLimit: ImportLimit | null
}

export interface ImportProgress {
  phase: 'images' | 'notes'
  done: number
  total: number
}

// The API rejects an over-limit create with a 403. Two distinct caps produce two
// messages: an unverified account hitting 10 notes asks the user to verify their
// e-mail; any account hitting the hard per-account ceiling returns "Note limit
// reached" (api/function_app.py). Retrying every remaining note would produce a
// wall of identical failures, so the import stops and says what to do instead.
function noteLimitKind(err: unknown): ImportLimit | null {
  if (!(err instanceof Error)) return null
  if (/verify your e-mail/i.test(err.message)) return 'unverified'
  if (/note limit reached/i.test(err.message)) return 'hard'
  return null
}

export async function importBackup(
  notes: BackupNote[],
  images: Map<string, ArchiveImage>,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportSummary> {
  // Only images the incoming notes actually reference. The caller has already
  // dropped duplicate notes, so images that belong solely to those are never
  // uploaded.
  const ids = [...new Set(notes.flatMap((n) => parseImageIds(n.content)))].filter((id) =>
    images.has(id),
  )

  const remapped = new Map<string, string>()
  let imagesUploaded = 0
  let imagesFailed = 0

  for (const [i, id] of ids.entries()) {
    onProgress?.({ phase: 'images', done: i, total: ids.length })
    const image = images.get(id) as ArchiveImage
    try {
      const blob = new Blob([toArrayBuffer(image.bytes)], { type: image.content_type })
      remapped.set(id, await uploadImage(blob))
      imagesUploaded++
    } catch (err) {
      if (err instanceof UploadRateLimited) {
        // Stop everything, not just the images. Creating the notes now would
        // save them with references that point nowhere, and the next run would
        // recognise them as duplicates and never fill the pictures back in.
        return { imported: 0, failed: 0, imagesUploaded, imagesFailed, stoppedByLimit: 'images' }
      }
      imagesFailed++
    }
  }
  onProgress?.({ phase: 'images', done: ids.length, total: ids.length })

  // Sequential on purpose: it keeps Cosmos RU consumption flat and makes an
  // honest progress indicator possible. A single failure is not fatal — a
  // partial restore beats none, and re-running is safe because the caller
  // deduplicates first.
  let imported = 0
  let failed = 0
  for (const [i, note] of notes.entries()) {
    onProgress?.({ phase: 'notes', done: i, total: notes.length })
    try {
      await createNote(rewriteImageRefs(note.content, remapped), note.tags, {
        title: note.title,
        createdAt: note.created_at,
      })
      imported++
    } catch (err) {
      const limit = noteLimitKind(err)
      if (limit) return { imported, failed, imagesUploaded, imagesFailed, stoppedByLimit: limit }
      failed++
    }
  }
  onProgress?.({ phase: 'notes', done: notes.length, total: notes.length })
  return { imported, failed, imagesUploaded, imagesFailed, stoppedByLimit: null }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npm run test -- backupImport`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && npm run test && npm run lint`
Expected: pass. `npm run build` still fails on the two components — Tasks 12 and 13.

```bash
cd frontend && git add src/backupImport.ts src/backupImport.test.ts
git commit -m "feat(web): two-phase backup import with image re-upload"
```

---

### Task 12: Export UI in `Account.tsx`

**Files:**
- Modify: `frontend/src/Account.tsx:5-7` (imports), `:29-35` (state), `:65-92` (`downloadBackupFile`), `:261-267` (button and result)
- Modify: `frontend/src/i18n/en.ts:143-159` (the `account` backup keys)

**Interfaces:**
- Consumes: `exportBackup`, `type ExportProgress` from `./backupExport`; `archiveFilename`, `downloadArchive` from `./backupFile`.
- Produces: nothing importable.

- [ ] **Step 1: Add the strings**

In `frontend/src/i18n/en.ts`, inside the `account` object, replace `backupDone` and add three keys after `backupWorking`:

```ts
    backupWorking: 'preparing…',
    backupImages: 'downloading images {done}/{total}…',
    backupPacking: 'packing the file…',
    backupEmpty: 'There’s nothing to back up yet.',
    backupDone: 'Backup downloaded: {count} notes, {images} images ✓',
    backupImagesMissing:
      '{count} images couldn’t be downloaded and are missing from the file. The notes were saved anyway.',
```

Also update `backupIntro` to mention images:

```ts
    backupIntro:
      'Download all your notes and the images in them as a single file and keep it somewhere safe — a USB stick, an encrypted drive. If you ever lose both your password and your recovery code, this file is what gets your notes back.',
```

- [ ] **Step 2: Rewire the export handler**

In `frontend/src/Account.tsx`, replace the backup imports (lines 5-7):

```ts
import { getKnownNoteCount } from './api'
import { MIN_PASSPHRASE_LENGTH } from './backup'
import { exportBackup, type ExportProgress } from './backupExport'
import { archiveFilename, downloadArchive } from './backupFile'
```

(`listNotes` is no longer used here — remove it from the `./api` import. `serializeBackup` and `encryptBackup` go too.)

Replace the `bkCount` state with the three values the new summary needs, next to the other `bk*` state:

```ts
  const [bkCount, setBkCount] = useState(0)
  const [bkImages, setBkImages] = useState(0)
  const [bkMissing, setBkMissing] = useState(0)
  const [bkProgress, setBkProgress] = useState<ExportProgress | null>(null)
```

Replace `downloadBackupFile`:

```ts
  async function downloadBackupFile() {
    const invalid = backupValidationError()
    if (invalid) {
      setBkError(invalid)
      setBkState('error')
      return
    }
    setBkState('working')
    setBkProgress(null)
    try {
      const result = await exportBackup({
        username: getUsername() ?? '',
        passphrase: bkMode === 'plain' ? undefined : bkPass,
        onProgress: setBkProgress,
      })
      if (result.noteCount === 0) {
        setBkError(t('account.backupEmpty'))
        setBkState('error')
        return
      }
      downloadArchive(result.archive, archiveFilename(result.exportedAt, bkMode !== 'plain'))
      setBkCount(result.noteCount)
      setBkImages(result.imageCount)
      setBkMissing(result.missingImages.length)
      setBkPass('')
      setBkPass2('')
      setBkState('done')
    } catch (e) {
      setBkError(e instanceof Error ? e.message : t('errors.loadFailed'))
      setBkState('error')
    } finally {
      setBkProgress(null)
    }
  }

  function backupButtonLabel(): string {
    if (bkState !== 'working') return t('account.backupDownload')
    if (bkProgress?.phase === 'images') {
      return t('account.backupImages', { done: bkProgress.done, total: bkProgress.total })
    }
    if (bkProgress?.phase === 'packing') return t('account.backupPacking')
    return t('account.backupWorking')
  }
```

- [ ] **Step 3: Update the button and the result line**

Replace the button label expression (line ~263):

```tsx
            {backupButtonLabel()}
```

and the done line (line ~267):

```tsx
          {bkState === 'done' && (
            <>
              <div className="verify-sent">
                {t('account.backupDone', { count: bkCount, images: bkImages })}
              </div>
              {bkMissing > 0 && (
                <div className="account-note">
                  {t('account.backupImagesMissing', { count: bkMissing })}
                </div>
              )}
            </>
          )}
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run test && npm run lint`
Expected: pass. `npm run build` still fails on `Restore.tsx` only.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/Account.tsx src/i18n/en.ts
git commit -m "feat(web): export backups as archives with images"
```

---

### Task 13: Import UI in `Restore.tsx`

**Files:**
- Modify: `frontend/src/Restore.tsx` (rewrite the file-handling half)
- Modify: `frontend/src/i18n/en.ts` (the `restore` keys)

**Interfaces:**
- Consumes: `openBackupFile` from `./backupFile`; `openArchive`, `type ArchiveHandle`, `type ArchiveImage` from `./backupArchive`; `isEncrypted`, `diffAgainst`, `type BackupNote` from `./backup`; `importBackup`, `type ImportSummary`, `type ImportProgress` from `./backupImport`; `listNotes` from `./api`.
- Produces: nothing importable.

- [ ] **Step 1: Add the strings**

In `frontend/src/i18n/en.ts`, inside `restore`, add after `summary` and after `importProgress`:

```ts
    summaryImages: '{count} images in this file.',
    importImages: 'uploading images {done} of {total}…',
    importLimitedImages:
      '{count} imported, then the image upload limit was reached. Run the import again in a few minutes to finish the rest — nothing gets duplicated.',
```

and update `pick` and `intro` to mention the archive:

```ts
    intro:
      'Open a bpad backup file — a .zip archive, or an older .json/.bpad file. Everything happens in this browser until you choose to import.',
```

- [ ] **Step 2: Rewrite the file handling**

In `frontend/src/Restore.tsx`, replace the imports:

```ts
import { diffAgainst, isEncrypted, type BackupNote } from './backup'
import { openBackupFile } from './backupFile'
import { openArchive, type ArchiveHandle, type ArchiveImage } from './backupArchive'
import { importBackup, type ImportSummary, type ImportProgress } from './backupImport'
import { listNotes } from './api'
import { getDataKey, getToken } from './session'
```

Replace the `file` state with the handle, and add the image map:

```ts
  const [handle, setHandle] = useState<ArchiveHandle | null>(null)
  const [images, setImages] = useState<Map<string, ArchiveImage>>(new Map())
  const [progress, setProgress] = useState<ImportProgress | null>(null)
```

(`progress` replaces the old `[number, number]` tuple.)

Replace `pick` and `open`:

```ts
  async function pick(picked: File | undefined) {
    if (!picked) return
    setError('')
    setNotes(null)
    setSummary(null)
    setDiff(null)
    setImages(new Map())
    try {
      const opened = await openBackupFile(picked)
      setHandle(opened)
      // A plain backup needs no passphrase, so open it straight away.
      if (!isEncrypted(opened.file)) await open(opened, '')
    } catch (e) {
      setHandle(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function open(target: ArchiveHandle, pass: string) {
    setOpening(true)
    setError('')
    try {
      const opened = await openArchive(target, pass || undefined)
      setNotes(opened.notes)
      setImages(opened.images)
      setPassphrase('')
      if (canImport) await prepareImport(opened.notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }
```

Replace `runImport`:

```ts
  async function runImport() {
    setImporting(true)
    setProgress({ phase: 'images', done: 0, total: 0 })
    try {
      setSummary(await importBackup(toImport, images, setProgress))
      // Re-diff so a second run offers only what is genuinely still missing.
      if (notes) await prepareImport(notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }
```

Extend `summaryLine`:

```ts
  function summaryLine(s: ImportSummary): string {
    if (s.stoppedByLimit === 'images') return t('restore.importLimitedImages', { count: s.imported })
    if (s.stoppedByLimit === 'unverified') return t('restore.importLimited', { count: s.imported })
    if (s.stoppedByLimit === 'hard') return t('restore.importLimitedHard', { count: s.imported })
    if (s.failed > 0) return t('restore.importPartial', { count: s.imported, failed: s.failed })
    return t('restore.importDone', { count: s.imported })
  }

  function importButtonLabel(): string {
    if (!importing || !progress) return t('restore.importStart', { count: diff?.fresh ?? 0 })
    return progress.phase === 'images'
      ? t('restore.importImages', { done: progress.done, total: progress.total })
      : t('restore.importProgress', { done: progress.done, total: progress.total })
  }
```

- [ ] **Step 3: Update the JSX**

- File input `accept`: `".zip,.json,.bpad,application/zip,application/json"`.
- Every `file &&` guard becomes `handle &&`, and `isEncrypted(file)` becomes `isEncrypted(handle.file)`; the `open(file, passphrase)` call becomes `open(handle, passphrase)`.
- Below the existing `restore.summary` line, add the image count when the file carries any:

```tsx
            {images.size > 0 && (
              <div className="account-note">
                {t('restore.summaryImages', { count: images.size })}
              </div>
            )}
```

- Replace the import button label expression with `{importButtonLabel()}`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: **all three pass.** This is the task that closes the build.

- [ ] **Step 5: Manual smoke test**

Start the API (`cd api && source .venv/bin/activate && func start`) and the frontend (`cd frontend && npm run dev`), then:

1. Create a note, paste an image into it, save.
2. Account → download a plain backup. Open the `.zip`: it must hold `backup.json`, `images/<id>.webp` and `notes/<date>-<slug>.md`, and the markdown must show the picture when opened in a markdown viewer.
3. Download a passphrase-protected backup. The `.zip` must hold only `backup.json` and `images/<id>.bin`, and neither must contain readable note text.
4. Register a second account, go to `/restore`, open each archive, import. The note must appear **with its image visible**.
5. Run the same import a second time: it must report that everything is already there and upload nothing.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/Restore.tsx src/i18n/en.ts
git commit -m "feat(web): restore backups including their images"
```

---

### Task 14: Update the spec's status and the docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-export-import-s-obrazky-design.md` (status line)
- Modify: `docs/superpowers/specs/2026-07-25-obrazky-vystrizky-design.md:181` (the backup limitation is gone)
- Modify: `CLAUDE.md` (the **Backups** paragraph)

- [ ] **Step 1: Mark the spec implemented**

Change the status line to `**Stav:** implementováno`.

- [ ] **Step 2: Retire the stale limitation in the images spec**

In the "Vědomé hranice fáze 1" table, replace the Backup/restore row:

```
| Backup/restore | ✅ vyřešeno | obrázky jsou součástí zálohy — viz `2026-07-31-export-import-s-obrazky-design.md` |
```

- [ ] **Step 3: Update `CLAUDE.md`**

Replace the **Backups** paragraph's description of the file format with:

> The file is a ZIP (`format: bpad-backup`, `version: 2`) holding `backup.json`, an `images/` folder with the pictures the notes embed, and — in plain mode only — a human-readable `notes/*.md` export. `backup.json` is either `{ …header, encrypted: false, notes: [...], images: [...] }` or the same header with `encrypted: true` plus `kdf`, `iv` and `ct`, where the ciphertext is AES-256-GCM over the JSON `{ notes, images }` and each `images/<id>.bin` is sealed with the same key (IV in the first 12 bytes). Version 1 `.json`/`.bpad` files still open. The key is Argon2id over the backup passphrase used **directly** — no HKDF, unlike the login path — derived once per archive, and the KDF parameters travel in the file so raising them never orphans an old backup. `backup.ts`, `backupArchive.ts`, `backupZip.ts` and `backupMarkdown.ts` stay pure (no UI, no network); `backupFile.ts` does the download/read, `backupExport.ts` the export orchestration, `backupImport.ts` the restore. Import is deliberately best-effort and idempotent: images are uploaded first and the notes' `bpad-img:` references rewritten to the new ids, notes are deduplicated on `created_at` + content with image ids normalised away, sent one at a time, and a single failure does not abort the rest. Hitting the image upload rate limit stops the whole import so a re-run can finish it. Format described in `docs/superpowers/specs/2026-07-31-export-import-s-obrazky-design.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: backup format v2 with images"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| ZIP layout, `backup.json`, `images/`, `notes/` | 3, 7 |
| `version: 2`, `images` manifest | 4 |
| Encrypted mode: images sealed with the same key, `notes/` omitted | 2, 4, 7 |
| One Argon2id run per archive | 4 (`deriveBackupKey` split), 7 |
| Reading version 1 files | 4, 10 |
| Always writing version 2 | 12 |
| Filename `-enc` marker | 10 |
| Export: sequential image download, best-effort, progress | 9 |
| `notes/*.md` slug, front matter, relative paths | 1, 6 |
| Import: images first, reference rewriting, `image_ids` claim via `createNote` | 11 |
| Normalised note identity | 1, 5 |
| Image rate limit stops the whole import | 8, 11 |
| Restore preview stays textual, image count in the summary | 13 |
| Module boundaries incl. `imageRefs.ts`, `crypto.ts` additions | 1, 2 |
| fflate synchronous because of CSP | 3 |
| Tests | every task |

**Known intentional state:** `npm run build` is red from the end of Task 10 until Task 13, because `backupFile.ts` drops `downloadBackup`/`readTextFile` before the two components stop importing them. Task 10's and 11's gates say so explicitly; Task 13 closes it.
