# Backup Export / Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user download all their notes as a file (encrypted with a backup passphrase, or plaintext) and restore that file later — reading it without an account, or importing it into a logged-in account.

**Architecture:** All work happens in the browser. `backup.ts` is a pure module (serialize / encrypt / parse / decrypt / dedup) with no UI and no network; `backupFile.ts` wraps the browser download and file-read APIs; `backupImport.ts` drives a sequential import through the existing `createNote()`. Two UI surfaces: an export section on `Account`, and a new `/restore` page that doubles as an offline reader. The Python API is untouched except that `createNote()` starts sending fields the API already accepts.

**Tech Stack:** React + TypeScript + Vite, vitest, `hash-wasm` (Argon2id, already a dependency), Web Crypto (AES-256-GCM).

Spec: `docs/superpowers/specs/2026-07-20-backup-export-import-design.md`

## Global Constraints

- User-facing copy goes through the `t()` / `translate()` i18n layer. **Never hardcode a user-facing string in a component.** New keys go in `frontend/src/i18n/en.ts`.
- Code comments and logs are English.
- The server must never see plaintext. Backups are built from already-decrypted notes in memory and encrypted (if at all) before they touch disk.
- No changes to `api/` in this plan.
- Backup file format version: `1`. Format identifier: `"bpad-backup"`.
- Argon2id parameters written into every encrypted backup: `iterations: 3`, `memory_size: 65536`, `parallelism: 1`, `hash_length: 32`, salt 16 random bytes. AES-256-GCM with a 12-byte IV.
- The backup key is `Argon2id(passphrase, salt, params)` used **directly** as the AES key — no HKDF (see spec).
- Minimum backup passphrase length: 12 characters.
- Run `cd frontend && npm run test` and `npm run lint` before each commit.

---

### Task 1: Let `createNote()` carry a title and an original timestamp

The API already accepts an optional `created_at` on note creation (`api/models.py:27-28`, used at `api/function_app.py:379`), but the client never sends it, and `createNote()` also drops the title. Import needs both.

**Files:**
- Modify: `frontend/src/api.ts:151-174` (`createNote`)
- Test: `frontend/src/api.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createNote(content: string, tags?: string[], opts?: { title?: string; createdAt?: string }): Promise<Note>` — used by Task 5.

- [ ] **Step 1: Read the existing test file**

Run: `cat frontend/src/api.test.ts`

Match its mocking style (it stubs `fetch` and the session) for the new test.

- [ ] **Step 2: Write the failing test**

Append to `frontend/src/api.test.ts`, inside the existing `describe` for `createNote` if there is one, otherwise as a new `describe`:

```ts
describe('createNote with import options', () => {
  it('sends the given created_at and preserves the given title', async () => {
    const fetchMock = mockCreateOk()
    await createNote('# body', ['work'], {
      title: 'Explicit title',
      createdAt: '2026-01-02T03:04:05Z',
    })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.created_at).toBe('2026-01-02T03:04:05Z')
    const payload = await decryptJSON<{ title: string }>(
      { iv: body.iv, ct: body.ct },
      TEST_KEY,
    )
    expect(payload.title).toBe('Explicit title')
  })

  it('omits created_at when no option is given', async () => {
    const fetchMock = mockCreateOk()
    await createNote('# body')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('created_at')
  })
})
```

`mockCreateOk()` and `TEST_KEY` are helpers you add or reuse from the existing file — the mock must resolve to a 201 with a JSON body shaped like `{ id, iv, ct, created_at, updated_at }`, re-using whatever the file already does for `createNote`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm run test -- api.test.ts`
Expected: FAIL — `created_at` is `undefined` and the title is derived from the markdown, not `'Explicit title'`.

- [ ] **Step 4: Implement**

In `frontend/src/api.ts`, replace `createNote`:

```ts
export interface CreateOptions {
  // Preserve the note's own title instead of deriving it from the markdown.
  title?: string
  // Preserve the original creation time (backup import). The server accepts
  // this and falls back to its own clock when it is absent.
  createdAt?: string
}

export async function createNote(
  content: string,
  tags: string[] = [],
  opts: CreateOptions = {},
): Promise<Note> {
  let res: Response
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        ...(await encryptPayload(content, opts.title, tags)),
        ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
      }),
    })
  } catch {
    throw new Error(translate('errors.offlineWrite'))
  }
  checkAuth(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || translate('errors.saveFailed'))
  }
  const enc: EncryptedNote = await res.json()
  const username = getUsername()
  if (username) upsertCachedNote(username, enc)
  if (knownNoteCount !== null) setKnownNoteCount(knownNoteCount + 1)
  const note = await decrypt(enc)
  note.tags.forEach((tag) => knownTags.add(tag))
  return note
}
```

Note `encryptPayload` already takes an optional title and falls back to `resolveTitle(title, content)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- api.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(api): let createNote carry an explicit title and created_at"
```

---

### Task 2: Backup types, serialization and parsing

The pure core. No crypto yet — this task covers the plaintext variant and the validation that both variants share.

**Files:**
- Create: `frontend/src/backup.ts`
- Test: `frontend/src/backup.test.ts`

**Interfaces:**
- Consumes: `Note` from `frontend/src/types.ts`.
- Produces:
  - `BACKUP_FORMAT = 'bpad-backup'`, `BACKUP_VERSION = 1`, `MIN_PASSPHRASE_LENGTH = 12`
  - `interface BackupNote { title, content, url, created_at, updated_at, tags }`
  - `type BackupFile = PlainBackup | EncryptedBackup`
  - `serializeBackup(notes: Note[], meta: { username: string; exportedAt?: string }): PlainBackup`
  - `parseBackup(text: string): BackupFile`
  - `isEncrypted(file: BackupFile): file is EncryptedBackup`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/backup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serializeBackup, parseBackup, isEncrypted, BACKUP_VERSION } from './backup'
import type { Note } from './types'

const note: Note = {
  id: 'server-side-id',
  title: 'Groceries',
  content: '# Groceries\n\nmilk',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-03T03:04:05Z',
  tags: ['home'],
}

describe('serializeBackup', () => {
  it('writes the header and the notes', () => {
    const b = serializeBackup([note], { username: 'jan', exportedAt: '2026-07-20T10:00:00Z' })
    expect(b.format).toBe('bpad-backup')
    expect(b.version).toBe(BACKUP_VERSION)
    expect(b.username).toBe('jan')
    expect(b.exported_at).toBe('2026-07-20T10:00:00Z')
    expect(b.encrypted).toBe(false)
    expect(b.notes).toHaveLength(1)
  })

  it('drops the server-side id', () => {
    const b = serializeBackup([note], { username: 'jan' })
    expect(b.notes[0]).not.toHaveProperty('id')
  })

  it('keeps every user-visible field', () => {
    const b = serializeBackup([note], { username: 'jan' })
    expect(b.notes[0]).toEqual({
      title: 'Groceries',
      content: '# Groceries\n\nmilk',
      url: null,
      created_at: '2026-01-02T03:04:05Z',
      updated_at: '2026-01-03T03:04:05Z',
      tags: ['home'],
    })
  })

  it('handles an empty vault', () => {
    expect(serializeBackup([], { username: 'jan' }).notes).toEqual([])
  })
})

describe('parseBackup', () => {
  it('round-trips a plain backup', () => {
    const text = JSON.stringify(serializeBackup([note], { username: 'jan' }))
    const parsed = parseBackup(text)
    expect(isEncrypted(parsed)).toBe(false)
    if (!isEncrypted(parsed)) expect(parsed.notes[0].title).toBe('Groceries')
  })

  it('rejects text that is not JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(/couldn’t be read/i)
  })

  it('rejects JSON that is not a bpad backup', () => {
    expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow(/not a bpad backup/i)
  })

  it('rejects a version from the future', () => {
    const b = { ...serializeBackup([note], { username: 'jan' }), version: 99 }
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/newer version/i)
  })

  it('rejects a plain backup whose notes are missing', () => {
    const b = { ...serializeBackup([note], { username: 'jan' }), notes: undefined }
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/damaged/i)
  })

  it('recognises an encrypted backup by its flag, not its extension', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: 'bpad-backup',
        version: 1,
        exported_at: '2026-07-20T10:00:00Z',
        username: 'jan',
        encrypted: true,
        kdf: {
          algorithm: 'argon2id',
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
          iterations: 3,
          memory_size: 65536,
          parallelism: 1,
          hash_length: 32,
        },
        cipher: 'AES-256-GCM',
        iv: 'AAAAAAAAAAAAAAAA',
        ct: 'AAAA',
      }),
    )
    expect(isEncrypted(parsed)).toBe(true)
  })

  it('rejects an encrypted backup with an unknown KDF', () => {
    const bad = {
      format: 'bpad-backup',
      version: 1,
      exported_at: '2026-07-20T10:00:00Z',
      username: 'jan',
      encrypted: true,
      kdf: { algorithm: 'scrypt', salt: 'AA==', iterations: 3, memory_size: 1, parallelism: 1, hash_length: 32 },
      cipher: 'AES-256-GCM',
      iv: 'AA==',
      ct: 'AA==',
    }
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/unsupported/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- backup.test.ts`
Expected: FAIL — `Failed to resolve import "./backup"`.

- [ ] **Step 3: Implement**

Create `frontend/src/backup.ts`:

```ts
// Backup file format: serialize the user's decrypted notes into a file they
// can store outside the app, and read such a file back. Pure logic — no UI,
// no network, no browser storage. See
// docs/superpowers/specs/2026-07-20-backup-export-import-design.md
import type { Note } from './types'
import { translate } from './i18n/translate'

export const BACKUP_FORMAT = 'bpad-backup'
export const BACKUP_VERSION = 1
export const MIN_PASSPHRASE_LENGTH = 12

// A note as it is written to the file. The server-side id is deliberately
// absent: it is meaningless once the notes are restored into another account.
export interface BackupNote {
  title: string
  content: string
  url: string | null
  created_at: string
  updated_at: string
  tags: string[]
}

interface BackupHeader {
  format: typeof BACKUP_FORMAT
  version: number
  exported_at: string
  username: string
}

export interface PlainBackup extends BackupHeader {
  encrypted: false
  notes: BackupNote[]
}

// Argon2id parameters travel inside the file so that raising them in the app
// never makes an old backup unreadable.
export interface BackupKdf {
  algorithm: 'argon2id'
  salt: string // base64
  iterations: number
  memory_size: number
  parallelism: number
  hash_length: number
}

export interface EncryptedBackup extends BackupHeader {
  encrypted: true
  kdf: BackupKdf
  cipher: 'AES-256-GCM'
  iv: string // base64
  ct: string // base64 — the encrypted JSON of { notes: BackupNote[] }
}

export type BackupFile = PlainBackup | EncryptedBackup

export function isEncrypted(file: BackupFile): file is EncryptedBackup {
  return file.encrypted
}

export function serializeBackup(
  notes: Note[],
  meta: { username: string; exportedAt?: string },
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
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(translate('errors.backupUnreadable'))
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new Error(translate('errors.backupNotBpad'))
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new Error(translate('errors.backupTooNew'))
  }
  if (raw.encrypted === true) {
    const kdf = raw.kdf
    if (
      !isRecord(kdf) ||
      kdf.algorithm !== 'argon2id' ||
      raw.cipher !== 'AES-256-GCM' ||
      typeof kdf.salt !== 'string' ||
      typeof raw.iv !== 'string' ||
      typeof raw.ct !== 'string'
    ) {
      throw new Error(translate('errors.backupUnsupported'))
    }
    return raw as unknown as EncryptedBackup
  }
  if (!Array.isArray(raw.notes)) {
    throw new Error(translate('errors.backupDamaged'))
  }
  return raw as unknown as PlainBackup
}
```

- [ ] **Step 4: Add the error keys**

In `frontend/src/i18n/en.ts`, inside the existing `errors: { … }` block (starts at line 192), add:

```ts
    backupUnreadable: 'That file couldn’t be read — it isn’t valid JSON.',
    backupNotBpad: 'That isn’t a bpad backup file.',
    backupTooNew: 'This backup was written by a newer version of bpad.',
    backupDamaged: 'The backup file looks damaged — the notes are missing.',
    backupUnsupported: 'This backup uses an unsupported encryption scheme.',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- backup.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Lint and commit**

```bash
cd frontend && npm run lint
git add frontend/src/backup.ts frontend/src/backup.test.ts frontend/src/i18n/en.ts
git commit -m "feat(backup): add the backup file format, serialization and parsing"
```

---

### Task 3: Encrypt and decrypt a backup

**Files:**
- Modify: `frontend/src/backup.ts`
- Test: `frontend/src/backup.test.ts`

**Interfaces:**
- Consumes: `PlainBackup`, `EncryptedBackup`, `BackupKdf` from Task 2; `toBase64`, `fromBase64`, `randomBytes`, `encryptBytes`, `decryptBytes` from `frontend/src/crypto.ts`; `argon2id` from `hash-wasm`.
- Produces:
  - `encryptBackup(backup: PlainBackup, passphrase: string): Promise<EncryptedBackup>`
  - `decryptBackup(file: EncryptedBackup, passphrase: string): Promise<BackupNote[]>`
  - `notesOf(file: BackupFile, passphrase?: string): Promise<BackupNote[]>`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/backup.test.ts`:

```ts
import { encryptBackup, decryptBackup, notesOf } from './backup'

describe('encryptBackup / decryptBackup', () => {
  it('round-trips the notes', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    expect(enc.encrypted).toBe(true)
    expect(JSON.stringify(enc)).not.toContain('Groceries')
    const back = await decryptBackup(enc, 'correct horse battery staple')
    expect(back).toEqual(plain.notes)
  }, 30_000)

  it('keeps the header readable in the clear', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    expect(enc.username).toBe('jan')
    expect(enc.exported_at).toBe(plain.exported_at)
    expect(enc.kdf.iterations).toBe(3)
    expect(enc.kdf.memory_size).toBe(65536)
  }, 30_000)

  it('uses a fresh salt and IV every time', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const a = await encryptBackup(plain, 'correct horse battery staple')
    const b = await encryptBackup(plain, 'correct horse battery staple')
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.iv).not.toBe(b.iv)
  }, 60_000)

  it('rejects a wrong passphrase', async () => {
    const enc = await encryptBackup(serializeBackup([note], { username: 'jan' }), 'right passphrase')
    await expect(decryptBackup(enc, 'wrong passphrase')).rejects.toThrow(/passphrase/i)
  }, 60_000)

  it('rejects a corrupted ciphertext', async () => {
    const enc = await encryptBackup(serializeBackup([note], { username: 'jan' }), 'right passphrase')
    const corrupted = { ...enc, ct: enc.ct.slice(0, -8) + 'AAAAAAAA' }
    await expect(decryptBackup(corrupted, 'right passphrase')).rejects.toThrow(/passphrase/i)
  }, 60_000)
})

describe('notesOf', () => {
  it('returns the notes of a plain backup without a passphrase', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    await expect(notesOf(plain)).resolves.toEqual(plain.notes)
  })

  it('decrypts an encrypted backup with the passphrase', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    await expect(notesOf(enc, 'correct horse battery staple')).resolves.toEqual(plain.notes)
  }, 30_000)
})
```

The generous timeouts are deliberate: Argon2id with 64 MiB takes hundreds of milliseconds per call and several of these tests derive twice.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- backup.test.ts`
Expected: FAIL — `encryptBackup is not a function`.

- [ ] **Step 3: Implement**

Add to the imports at the top of `frontend/src/backup.ts`:

```ts
import { argon2id } from 'hash-wasm'
import { toBase64, fromBase64, randomBytes, encryptBytes, decryptBytes } from './crypto'
```

Append to `frontend/src/backup.ts`:

```ts
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Defaults for a newly written backup. Reading uses whatever the file says,
// so raising these later leaves old backups readable.
const BACKUP_KDF: Omit<BackupKdf, 'salt'> = {
  algorithm: 'argon2id',
  iterations: 3,
  memory_size: 65536,
  parallelism: 1,
  hash_length: 32,
}

// Derives the AES key from the backup passphrase. Unlike the login path in
// crypto.ts there is no HKDF step: a backup needs one key, not an enc/auth
// pair, and fewer moving parts means the format can be reimplemented from the
// spec years from now. Runs on the calling thread — a backup is a one-off
// action, not something the user waits on repeatedly.
async function deriveBackupKey(passphrase: string, kdf: BackupKdf): Promise<Uint8Array> {
  return argon2id({
    password: passphrase,
    salt: fromBase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memory_size,
    hashLength: kdf.hash_length,
    outputType: 'binary',
  })
}

export async function encryptBackup(
  backup: PlainBackup,
  passphrase: string,
): Promise<EncryptedBackup> {
  const kdf: BackupKdf = { ...BACKUP_KDF, salt: toBase64(randomBytes(16)) }
  const key = await deriveBackupKey(passphrase, kdf)
  const body = textEncoder.encode(JSON.stringify({ notes: backup.notes }))
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

export async function decryptBackup(
  file: EncryptedBackup,
  passphrase: string,
): Promise<BackupNote[]> {
  const key = await deriveBackupKey(passphrase, file.kdf)
  let bytes: Uint8Array
  try {
    bytes = await decryptBytes({ iv: file.iv, ct: file.ct }, key)
  } catch {
    // AES-GCM cannot tell a wrong key from a damaged file: both fail the tag
    // check. The passphrase is by far the likelier cause, so lead with it.
    throw new Error(translate('errors.backupWrongPassphrase'))
  }
  const body = JSON.parse(textDecoder.decode(bytes)) as { notes?: BackupNote[] }
  if (!Array.isArray(body.notes)) throw new Error(translate('errors.backupDamaged'))
  return body.notes
}

export async function notesOf(file: BackupFile, passphrase?: string): Promise<BackupNote[]> {
  if (!isEncrypted(file)) return file.notes
  if (!passphrase) throw new Error(translate('errors.backupNeedsPassphrase'))
  return decryptBackup(file, passphrase)
}
```

- [ ] **Step 4: Add the error keys**

In the `errors` block of `frontend/src/i18n/en.ts`:

```ts
    backupWrongPassphrase:
      'Wrong backup passphrase — or the file is damaged.',
    backupNeedsPassphrase: 'This backup is password-protected.',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- backup.test.ts`
Expected: PASS, 18 tests. This run takes tens of seconds because of Argon2id.

- [ ] **Step 6: Lint and commit**

```bash
cd frontend && npm run lint
git add frontend/src/backup.ts frontend/src/backup.test.ts frontend/src/i18n/en.ts
git commit -m "feat(backup): encrypt and decrypt backups with a passphrase"
```

---

### Task 4: Deduplicate an incoming backup against the vault

**Files:**
- Modify: `frontend/src/backup.ts`
- Test: `frontend/src/backup.test.ts`

**Interfaces:**
- Consumes: `BackupNote` from Task 2, `Note` from `types.ts`.
- Produces: `diffAgainst(existing: Note[], incoming: BackupNote[]): BackupDiff` where `interface BackupDiff { toImport: BackupNote[]; duplicates: BackupNote[] }` — used by Tasks 5 and 7.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/backup.test.ts`:

```ts
import { diffAgainst } from './backup'

const incoming = (over: Partial<BackupNote> = {}): BackupNote => ({
  title: 'Groceries',
  content: '# Groceries\n\nmilk',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-03T03:04:05Z',
  tags: ['home'],
  ...over,
})

describe('diffAgainst', () => {
  it('imports everything into an empty vault', () => {
    const d = diffAgainst([], [incoming()])
    expect(d.toImport).toHaveLength(1)
    expect(d.duplicates).toHaveLength(0)
  })

  it('treats a note with the same created_at and content as a duplicate', () => {
    const d = diffAgainst([note], [incoming()])
    expect(d.toImport).toHaveLength(0)
    expect(d.duplicates).toHaveLength(1)
  })

  it('splits a partial overlap', () => {
    const d = diffAgainst([note], [incoming(), incoming({ created_at: '2026-05-05T00:00:00Z' })])
    expect(d.toImport).toHaveLength(1)
    expect(d.duplicates).toHaveLength(1)
  })

  it('does not treat the same content at a different time as a duplicate', () => {
    const d = diffAgainst([note], [incoming({ created_at: '2026-05-05T00:00:00Z' })])
    expect(d.toImport).toHaveLength(1)
  })

  it('does not treat different content at the same time as a duplicate', () => {
    const d = diffAgainst([note], [incoming({ content: 'something else' })])
    expect(d.toImport).toHaveLength(1)
  })

  it('keeps only the first of two identical incoming notes', () => {
    const d = diffAgainst([], [incoming(), incoming()])
    expect(d.toImport).toHaveLength(1)
    expect(d.duplicates).toHaveLength(1)
  })

  it('handles an empty backup', () => {
    expect(diffAgainst([note], [])).toEqual({ toImport: [], duplicates: [] })
  })
})
```

Add `import type { BackupNote } from './backup'` to the test file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- backup.test.ts`
Expected: FAIL — `diffAgainst is not a function`.

- [ ] **Step 3: Implement**

Append to `frontend/src/backup.ts`:

```ts
export interface BackupDiff {
  toImport: BackupNote[]
  duplicates: BackupNote[]
}

// Identity of a note for import purposes. The server-side id is not in the
// file, so a note is "the same note" when it was created at the same instant
// and still says the same thing.
function identity(n: { created_at: string; content: string }): string {
  return `${n.created_at} ${n.content}`
}

// Splits an incoming backup into what is genuinely new and what the vault
// already holds, so that importing the same file twice is a no-op. Identical
// notes within one file collapse too.
export function diffAgainst(existing: Note[], incoming: BackupNote[]): BackupDiff {
  const seen = new Set(existing.map(identity))
  const toImport: BackupNote[] = []
  const duplicates: BackupNote[] = []
  for (const n of incoming) {
    const id = identity(n)
    if (seen.has(id)) {
      duplicates.push(n)
    } else {
      seen.add(id)
      toImport.push(n)
    }
  }
  return { toImport, duplicates }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- backup.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd frontend && npm run lint
git add frontend/src/backup.ts frontend/src/backup.test.ts
git commit -m "feat(backup): deduplicate an incoming backup against the vault"
```

---

### Task 5: Sequential import into the account

Kept out of `backup.ts` so that module stays pure — this one talks to the API.

**Files:**
- Create: `frontend/src/backupImport.ts`
- Test: `frontend/src/backupImport.test.ts`

**Interfaces:**
- Consumes: `BackupNote` (Task 2), `createNote(content, tags, opts)` (Task 1).
- Produces: `importNotes(notes: BackupNote[], onProgress?: (done: number, total: number) => void): Promise<ImportSummary>` where `interface ImportSummary { imported: number; failed: number; stoppedByLimit: boolean }` — used by Task 7.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/backupImport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importNotes } from './backupImport'
import type { BackupNote } from './backup'

vi.mock('./api', () => ({ createNote: vi.fn() }))
import { createNote } from './api'

const mockCreate = vi.mocked(createNote)

function backupNote(i: number): BackupNote {
  return {
    title: `Note ${i}`,
    content: `body ${i}`,
    url: null,
    created_at: `2026-01-0${i}T00:00:00Z`,
    updated_at: `2026-01-0${i}T00:00:00Z`,
    tags: ['x'],
  }
}

beforeEach(() => {
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({} as never)
})

describe('importNotes', () => {
  it('creates every note with its title, tags and original timestamp', async () => {
    const summary = await importNotes([backupNote(1)])
    expect(summary).toEqual({ imported: 1, failed: 0, stoppedByLimit: false })
    expect(mockCreate).toHaveBeenCalledWith('body 1', ['x'], {
      title: 'Note 1',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('imports sequentially, not in parallel', async () => {
    let inFlight = 0
    let maxInFlight = 0
    mockCreate.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return {} as never
    })
    await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(maxInFlight).toBe(1)
  })

  it('reports progress after each note', async () => {
    const seen: Array<[number, number]> = []
    await importNotes([backupNote(1), backupNote(2)], (done, total) => seen.push([done, total]))
    expect(seen).toEqual([[1, 2], [2, 2]])
  })

  it('keeps going when one note fails and counts it', async () => {
    mockCreate
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('Saving failed'))
      .mockResolvedValueOnce({} as never)
    const summary = await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(summary).toEqual({ imported: 2, failed: 1, stoppedByLimit: false })
    expect(mockCreate).toHaveBeenCalledTimes(3)
  })

  it('stops at the unverified-account note limit instead of failing every note', async () => {
    mockCreate
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('Verify your e-mail for more than 10 notes.'))
    const summary = await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(summary).toEqual({ imported: 1, failed: 0, stoppedByLimit: true })
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('handles an empty import', async () => {
    await expect(importNotes([])).resolves.toEqual({
      imported: 0,
      failed: 0,
      stoppedByLimit: false,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- backupImport.test.ts`
Expected: FAIL — `Failed to resolve import "./backupImport"`.

- [ ] **Step 3: Implement**

Create `frontend/src/backupImport.ts`:

```ts
// Restores the notes of a parsed backup into the logged-in account. Each note
// goes through the ordinary createNote() path, so it is encrypted with the
// current data key before it leaves the browser.
import { createNote } from './api'
import type { BackupNote } from './backup'

export interface ImportSummary {
  imported: number
  failed: number
  // True when the API's unverified-account note cap cut the import short.
  stoppedByLimit: boolean
}

// The API rejects the 11th note of an unverified account with a 403 whose
// message asks the user to verify their e-mail (api/function_app.py:371).
// Retrying every remaining note would produce a wall of identical failures,
// so the import stops and says what to do instead.
function isNoteLimit(err: unknown): boolean {
  return err instanceof Error && /verify your e-mail/i.test(err.message)
}

// Sequential on purpose: it keeps Cosmos RU consumption flat and makes an
// honest progress indicator possible. A single failure is not fatal — a
// partial restore beats none, and re-running is safe because the caller
// deduplicates first.
export async function importNotes(
  notes: BackupNote[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  let imported = 0
  let failed = 0
  for (const [i, note] of notes.entries()) {
    try {
      await createNote(note.content, note.tags, {
        title: note.title,
        createdAt: note.created_at,
      })
      imported++
    } catch (err) {
      if (isNoteLimit(err)) return { imported, failed, stoppedByLimit: true }
      failed++
    }
    onProgress?.(i + 1, notes.length)
  }
  return { imported, failed, stoppedByLimit: false }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- backupImport.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd frontend && npm run lint
git add frontend/src/backupImport.ts frontend/src/backupImport.test.ts
git commit -m "feat(backup): import a backup's notes sequentially into the account"
```

---

### Task 6: Browser file download and read

**Files:**
- Create: `frontend/src/backupFile.ts`
- Test: `frontend/src/backupFile.test.ts`

**Interfaces:**
- Consumes: `BackupFile` (Task 2).
- Produces:
  - `backupFilename(file: BackupFile): string`
  - `downloadBackup(file: BackupFile): void`
  - `readTextFile(file: File): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/backupFile.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { backupFilename, downloadBackup, readTextFile } from './backupFile'
import { serializeBackup } from './backup'
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
  vi.restoreAllMocks()
})

describe('backupFilename', () => {
  it('uses the .json extension for a plain backup', () => {
    const b = serializeBackup([note], { username: 'jan', exportedAt: '2026-07-20T10:00:00Z' })
    expect(backupFilename(b)).toBe('bpad-backup-2026-07-20.json')
  })

  it('uses the .bpad extension for an encrypted backup', () => {
    const b = serializeBackup([note], { username: 'jan', exportedAt: '2026-07-20T10:00:00Z' })
    const enc = { ...b, encrypted: true as const, kdf: {} as never, cipher: 'AES-256-GCM' as const, iv: '', ct: '' }
    expect(backupFilename(enc)).toBe('bpad-backup-2026-07-20.bpad')
  })
})

describe('downloadBackup', () => {
  it('clicks an anchor pointing at a blob URL and revokes it', () => {
    const click = vi.fn()
    const anchor = { click, href: '', download: '' } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const create = vi.fn().mockReturnValue('blob:fake')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: revoke })

    downloadBackup(serializeBackup([note], { username: 'jan', exportedAt: '2026-07-20T10:00:00Z' }))

    expect(create).toHaveBeenCalled()
    expect(anchor.download).toBe('bpad-backup-2026-07-20.json')
    expect(click).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:fake')
    vi.unstubAllGlobals()
  })
})

describe('readTextFile', () => {
  it('resolves with the file contents', async () => {
    const f = new File(['{"hello":1}'], 'b.json', { type: 'application/json' })
    await expect(readTextFile(f)).resolves.toBe('{"hello":1}')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- backupFile.test.ts`
Expected: FAIL — `Failed to resolve import "./backupFile"`.

- [ ] **Step 3: Implement**

Create `frontend/src/backupFile.ts`:

```ts
// The browser side of backups: turning a BackupFile into a download, and a
// picked File back into text. Isolated from backup.ts so that the format
// logic stays testable without touching browser APIs.
import { isEncrypted, type BackupFile } from './backup'

export function backupFilename(file: BackupFile): string {
  const day = file.exported_at.slice(0, 10)
  return `bpad-backup-${day}.${isEncrypted(file) ? 'bpad' : 'json'}`
}

export function downloadBackup(file: BackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename(file)
  a.click()
  URL.revokeObjectURL(url)
}

export function readTextFile(file: File): Promise<string> {
  return file.text()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- backupFile.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd frontend && npm run lint
git add frontend/src/backupFile.ts frontend/src/backupFile.test.ts
git commit -m "feat(backup): download a backup and read one back from disk"
```

---

### Task 7: Export section on the Account page

**Files:**
- Modify: `frontend/src/Account.tsx`
- Modify: `frontend/src/i18n/en.ts`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `serializeBackup`, `encryptBackup`, `MIN_PASSPHRASE_LENGTH` (Tasks 2-3), `downloadBackup` (Task 6), `listNotes` from `api.ts`, `getUsername`, `getDataKey` from `session.ts`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the translation keys**

In `frontend/src/i18n/en.ts`, inside the existing `account: { … }` block:

```ts
    backupTitle: 'Backup',
    backupIntro:
      'Download all your notes as a file and keep it somewhere safe — a USB stick, an encrypted drive. If you ever lose your password and your recovery code, this file is what gets your notes back.',
    backupProtected: 'Protect with a passphrase (recommended)',
    backupPlain: 'Plain, unencrypted file',
    backupPassphrase: 'Backup passphrase',
    backupPassphraseAgain: 'Repeat the passphrase',
    backupPassphraseHint:
      'This is NOT your bpad password. Nobody can recover it — write it down next to your recovery code.',
    backupPassphraseTooShort: 'Use at least {min} characters.',
    backupPassphraseMismatch: 'The two passphrases don’t match.',
    backupPlainWarning:
      'I understand anyone who finds this file can read every note in it.',
    backupDownload: 'Download backup',
    backupWorking: 'preparing…',
    backupOffline: 'Backing up the offline copy — {count} notes.',
    backupEmpty: 'There’s nothing to back up yet.',
    backupDone: 'Backup downloaded: {count} notes.',
    backupRestoreLink: 'Restore from a backup',
```

- [ ] **Step 2: Add the export section to Account.tsx**

Add to the imports:

```ts
import { listNotes } from './api'
import { serializeBackup, encryptBackup, MIN_PASSPHRASE_LENGTH } from './backup'
import { downloadBackup } from './backupFile'
```

(`getKnownNoteCount` and `getUsername` are already imported.)

Add this state next to the existing `useState` calls in the component:

```ts
  const [bkMode, setBkMode] = useState<'protected' | 'plain'>('protected')
  const [bkPass, setBkPass] = useState('')
  const [bkPass2, setBkPass2] = useState('')
  const [bkAck, setBkAck] = useState(false)
  const [bkState, setBkState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [bkError, setBkError] = useState('')
  const [bkCount, setBkCount] = useState(0)
```

Add this handler next to `submitFeedback`:

```ts
  function backupValidationError(): string {
    if (bkMode === 'plain') return ''
    if (bkPass.length < MIN_PASSPHRASE_LENGTH) {
      return t('account.backupPassphraseTooShort', { min: MIN_PASSPHRASE_LENGTH })
    }
    if (bkPass !== bkPass2) return t('account.backupPassphraseMismatch')
    return ''
  }

  async function downloadBackupFile() {
    const invalid = backupValidationError()
    if (invalid) {
      setBkError(invalid)
      setBkState('error')
      return
    }
    setBkState('working')
    try {
      const notes = await listNotes()
      if (notes.length === 0) {
        setBkError(t('account.backupEmpty'))
        setBkState('error')
        return
      }
      const plain = serializeBackup(notes, { username: getUsername() ?? '' })
      downloadBackup(bkMode === 'plain' ? plain : await encryptBackup(plain, bkPass))
      setBkCount(notes.length)
      setBkPass('')
      setBkPass2('')
      setBkState('done')
    } catch (e) {
      setBkError(e instanceof Error ? e.message : t('errors.loadFailed'))
      setBkState('error')
    }
  }
```

Render the section immediately before the existing `<div className="account-feedback">` block:

```tsx
        <div className="account-backup">
          <span className="account-key">{t('account.backupTitle')}</span>
          <div className="account-note">{t('account.backupIntro')}</div>

          <label className="backup-choice">
            <input
              type="radio"
              name="backup-mode"
              checked={bkMode === 'protected'}
              onChange={() => setBkMode('protected')}
            />
            {t('account.backupProtected')}
          </label>
          <label className="backup-choice">
            <input
              type="radio"
              name="backup-mode"
              checked={bkMode === 'plain'}
              onChange={() => setBkMode('plain')}
            />
            {t('account.backupPlain')}
          </label>

          {bkMode === 'protected' ? (
            <>
              <input
                className="backup-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('account.backupPassphrase')}
                value={bkPass}
                onChange={(e) => setBkPass(e.target.value)}
              />
              <input
                className="backup-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('account.backupPassphraseAgain')}
                value={bkPass2}
                onChange={(e) => setBkPass2(e.target.value)}
              />
              <div className="account-note">{t('account.backupPassphraseHint')}</div>
            </>
          ) : (
            <label className="backup-choice">
              <input
                type="checkbox"
                checked={bkAck}
                onChange={(e) => setBkAck(e.target.checked)}
              />
              {t('account.backupPlainWarning')}
            </label>
          )}

          <button
            className="ghost-btn"
            type="button"
            disabled={bkState === 'working' || (bkMode === 'plain' && !bkAck)}
            onClick={downloadBackupFile}
          >
            {bkState === 'working' ? t('account.backupWorking') : t('account.backupDownload')}
          </button>

          {bkState === 'done' && (
            <div className="verify-sent">{t('account.backupDone', { count: bkCount })}</div>
          )}
          {bkState === 'error' && <div className="account-note">{bkError}</div>}

          <div>
            <Link to="/restore" className="account-link">{t('account.backupRestoreLink')}</Link>
          </div>
        </div>
```

- [ ] **Step 3: Add the styles**

Append to `frontend/src/App.css`, following the conventions of the neighbouring `.account-*` rules:

```css
.account-backup {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.backup-choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.backup-input {
  padding: 0.5rem;
  font: inherit;
}
```

- [ ] **Step 4: Verify the build and the suite**

Run: `cd frontend && npm run build && npm run test && npm run lint`
Expected: type-check and build succeed, all tests pass, lint is clean.

- [ ] **Step 5: Exercise it by hand**

In one terminal: `cd api && source .venv/bin/activate && func start`
In another: `cd frontend && npm run dev`

Log in, open `/account`, download a protected backup and a plain one. Confirm the plain `.json` opens in an editor and contains the note text; confirm the `.bpad` file does not contain any note text.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Account.tsx frontend/src/i18n/en.ts frontend/src/App.css
git commit -m "feat(account): download an encrypted or plain backup of all notes"
```

---

### Task 8: The `/restore` page — reader and importer

**Files:**
- Create: `frontend/src/Restore.tsx`
- Modify: `frontend/src/App.tsx:48-49` (early route, next to `/verify`)
- Modify: `frontend/src/i18n/en.ts`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `parseBackup`, `notesOf`, `isEncrypted`, `diffAgainst`, `BackupFile`, `BackupNote` (Tasks 2-4); `importNotes` (Task 5); `readTextFile` (Task 6); `listNotes` from `api.ts`; `getDataKey` from `session.ts`.
- Produces: the `/restore` route.

- [ ] **Step 1: Add the translation keys**

Add a new top-level block to `frontend/src/i18n/en.ts`, after the `account` block:

```ts
  restore: {
    title: 'Restore from a backup',
    intro:
      'Open a bpad backup file. Everything happens in this browser — the file is never uploaded.',
    pick: 'Choose a backup file',
    passphrase: 'Backup passphrase',
    open: 'Open',
    opening: 'opening…',
    summary: '{count} notes, {from} to {to}',
    emptyBackup: 'This backup contains no notes.',
    importTitle: 'Import into your account',
    importIntro: '{fresh} new, {dupes} already in your account.',
    importNothing: 'Every note in this backup is already in your account.',
    importStart: 'Import {count} notes',
    importProgress: 'importing {done} of {total}…',
    importDone: '{count} notes imported.',
    importPartial: '{count} imported, {failed} failed. Run the import again to retry.',
    importLimited:
      '{count} imported, then your account hit the limit for unverified e-mail. Verify your e-mail and run the import again.',
    lockedHint: 'Unlock your vault to import these notes into your account.',
    loggedOutHint: 'Log in to import these notes into your account.',
    another: 'Open another file',
  },
```

- [ ] **Step 2: Write the component**

Create `frontend/src/Restore.tsx`:

```tsx
// Restore page: opens a backup file and shows its notes. Works without an
// account and without the server — that is the point of a backup. When the
// visitor happens to be logged in with an unlocked vault, it also offers to
// import the notes into that account.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from './i18n'
import { parseBackup, notesOf, isEncrypted, diffAgainst, type BackupFile, type BackupNote } from './backup'
import { readTextFile } from './backupFile'
import { importNotes, type ImportSummary } from './backupImport'
import { listNotes } from './api'
import { getDataKey, getToken } from './session'

export default function Restore() {
  const { t } = useTranslation()
  const [file, setFile] = useState<BackupFile | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [notes, setNotes] = useState<BackupNote[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [diff, setDiff] = useState<{ fresh: number; dupes: number } | null>(null)
  const [toImport, setToImport] = useState<BackupNote[]>([])

  const canImport = getDataKey() !== null && getToken() !== null

  async function pick(picked: File | undefined) {
    if (!picked) return
    setError('')
    setNotes(null)
    setSummary(null)
    try {
      const parsed = parseBackup(await readTextFile(picked))
      setFile(parsed)
      if (!isEncrypted(parsed)) await open(parsed, '')
    } catch (e) {
      setFile(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function open(target: BackupFile, pass: string) {
    setOpening(true)
    setError('')
    try {
      const opened = await notesOf(target, pass)
      setNotes(opened)
      setPassphrase('')
      if (canImport) await prepareImport(opened)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  async function prepareImport(opened: BackupNote[]) {
    try {
      const existing = await listNotes()
      const d = diffAgainst(existing, opened)
      setToImport(d.toImport)
      setDiff({ fresh: d.toImport.length, dupes: d.duplicates.length })
    } catch {
      // The vault is unreachable — the reader still works, only the import
      // offer is withheld.
      setDiff(null)
    }
  }

  async function runImport() {
    setImporting(true)
    setProgress([0, toImport.length])
    try {
      setSummary(await importNotes(toImport, (done, total) => setProgress([done, total])))
      if (notes) await prepareImport(notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  function summaryLine(s: ImportSummary): string {
    if (s.stoppedByLimit) return t('restore.importLimited', { count: s.imported })
    if (s.failed > 0) return t('restore.importPartial', { count: s.imported, failed: s.failed })
    return t('restore.importDone', { count: s.imported })
  }

  const dates = notes && notes.length > 0
    ? notes.map((n) => n.created_at).sort()
    : null

  return (
    <div className="detail-page">
      <Link to="/" className="back-link">{t('common.back')}</Link>

      <div className="account-card">
        <h2 className="account-title">{t('restore.title')}</h2>
        <div className="account-note">{t('restore.intro')}</div>

        <input
          className="backup-input"
          type="file"
          accept=".json,.bpad,application/json"
          aria-label={t('restore.pick')}
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {file && isEncrypted(file) && !notes && (
          <>
            <input
              className="backup-input"
              type="password"
              autoComplete="off"
              placeholder={t('restore.passphrase')}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <button
              className="ghost-btn"
              type="button"
              disabled={opening || passphrase === ''}
              onClick={() => open(file, passphrase)}
            >
              {opening ? t('restore.opening') : t('restore.open')}
            </button>
          </>
        )}

        {error && <div className="account-note">{error}</div>}

        {notes && notes.length === 0 && (
          <div className="account-note">{t('restore.emptyBackup')}</div>
        )}

        {notes && notes.length > 0 && dates && (
          <>
            <div className="account-note">
              {t('restore.summary', {
                count: notes.length,
                from: dates[0].slice(0, 10),
                to: dates[dates.length - 1].slice(0, 10),
              })}
            </div>
            <ul className="restore-list">
              {notes.map((n, i) => (
                <li key={i}>
                  <button
                    className="restore-item"
                    type="button"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    {n.title || t('common.untitled')}
                  </button>
                  {expanded === i && <pre className="restore-body">{n.content}</pre>}
                </li>
              ))}
            </ul>
          </>
        )}

        {notes && notes.length > 0 && !canImport && (
          <div className="account-note">
            {getToken() ? t('restore.lockedHint') : t('restore.loggedOutHint')}
          </div>
        )}

        {notes && notes.length > 0 && canImport && diff && (
          <div className="account-backup">
            <span className="account-key">{t('restore.importTitle')}</span>
            <div className="account-note">
              {diff.fresh === 0
                ? t('restore.importNothing')
                : t('restore.importIntro', { fresh: diff.fresh, dupes: diff.dupes })}
            </div>
            {diff.fresh > 0 && (
              <button
                className="ghost-btn"
                type="button"
                disabled={importing}
                onClick={runImport}
              >
                {importing && progress
                  ? t('restore.importProgress', { done: progress[0], total: progress[1] })
                  : t('restore.importStart', { count: diff.fresh })}
              </button>
            )}
            {summary && <div className="verify-sent">{summaryLine(summary)}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Route it before the auth check**

In `frontend/src/App.tsx`, add the import next to the others:

```ts
import Restore from './Restore'
```

and extend the early-return block at line 48-49 (currently only `/verify`):

```tsx
  // Verification link from the e-mail – works without being logged in too.
  if (location.pathname === '/verify') return <VerifyEmail />

  // Restoring a backup must work for a locked-out visitor — that is the whole
  // point — so it is handled before the authentication check, and before the
  // catch-all Capture route would swallow the path.
  if (location.pathname === '/restore') return <Restore />
```

- [ ] **Step 4: Add the styles**

Append to `frontend/src/App.css`:

```css
.restore-list {
  list-style: none;
  margin: 0.5rem 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.restore-item {
  background: none;
  border: none;
  padding: 0.25rem 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
}

.restore-body {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0.25rem 0 0.75rem;
  font-size: 0.85rem;
  opacity: 0.85;
}
```

- [ ] **Step 5: Verify the build and the suite**

Run: `cd frontend && npm run build && npm run test && npm run lint`
Expected: all green.

- [ ] **Step 6: Exercise it by hand**

With `func start` and `npm run dev` running:

1. Log out. Open `http://localhost:5173/restore`. Load the plain backup from Task 7 — the notes list without any login. Load the `.bpad` file, enter the passphrase, confirm it opens; enter a wrong one and confirm the message names the passphrase.
2. Log in, go to `/restore`, load the same backup. It should report every note as already present and offer nothing to import.
3. Delete a note, reload the backup, and confirm exactly one note is offered and imports.
4. Register a fresh account with `POW_DIFFICULTY=0`, and import a backup of more than 10 notes into it without verifying the e-mail. Confirm the import stops with the "verify your e-mail" message rather than a wall of failures.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Restore.tsx frontend/src/App.tsx frontend/src/i18n/en.ts frontend/src/App.css
git commit -m "feat(restore): add the /restore page for reading and importing backups"
```

---

### Task 9: Document the backup format for outside readers

The spec promises that an encrypted backup can be decrypted by an independent implementation years from now. That promise needs to live somewhere a user can find.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `frontend/src/Features.tsx` and `frontend/src/featuresData.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Read the features data to match its shape**

Run: `cat frontend/src/featuresData.ts`

- [ ] **Step 2: Add a backup entry to the features list**

Following the existing entries' shape exactly, add an entry describing the backup: that notes can be downloaded encrypted or plain, and restored on `/restore` without an account. Copy goes through `t()` like every other entry — add the keys to `frontend/src/i18n/en.ts` in whatever block `featuresData.ts` already reads from.

- [ ] **Step 3: Document the format in CLAUDE.md**

In the "Architecture" section, after the paragraph on storage, add:

```markdown
**Backups** (`frontend/src/backup.ts`) let the user export every note to a file
and read it back on `/restore` without an account — the cover for losing both
the password and the recovery code. The file is JSON: either
`{ format, version, exported_at, username, encrypted: false, notes: [...] }`,
or the same header with `encrypted: true` plus `kdf` (Argon2id parameters and
salt), `iv` and `ct`, where the ciphertext is AES-256-GCM over the JSON
`{ "notes": [...] }`. The key is Argon2id over the backup passphrase used
directly — no HKDF, unlike the login path — and the KDF parameters travel in
the file so raising them never orphans an old backup. Format described in
`docs/superpowers/specs/2026-07-20-backup-export-import-design.md`.
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build && npm run test && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md frontend/src/featuresData.ts frontend/src/Features.tsx frontend/src/i18n/en.ts
git commit -m "docs: document the backup file format and list it in features"
```

---

## Self-review notes

Spec coverage check:

| Spec section | Task |
|---|---|
| Plain file format | 2 |
| Encrypted envelope, Argon2id params in-file, no HKDF | 3 |
| `id` dropped, `created_at` preserved | 1, 2 |
| `backup.ts` pure | 2, 3, 4 |
| `backupFile.ts` | 6 |
| Export flow, two variants, passphrase rules, plain warning | 7 |
| `/restore` reader without an account | 8 |
| Import with dedup, progress, partial failure, 403 limit | 4, 5, 8 |
| Error states | 2, 3, 8 |
| Tests | 1-6 |
| Format documented for outside readers | 9 |

The spec lists `encryptBackup(backup, passphrase)` returning `BackupFile`; the plan narrows it to `PlainBackup → EncryptedBackup`, which is the same operation with tighter types.
