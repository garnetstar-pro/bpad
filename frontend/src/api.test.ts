import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

// No jsdom here, but api.ts dispatches window events on note mutations.
// A no-op event target is enough — nothing in these tests listens.
;(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window = {
  dispatchEvent: () => true,
}

const { listNotesCached, getKnownTags, createNote } = await import('./api')
const { encryptJSON, decryptJSON, generateDataKey } = await import('./crypto')
const { cacheNotes } = await import('./offlineCache')
const { setSession, clearSession } = await import('./session')

const dataKey = generateDataKey()

async function seedCache(username: string, notes: { id: string; title: string; tags?: string[] }[]) {
  const encrypted = await Promise.all(
    notes.map(async (n) => ({
      id: n.id,
      created_at: '2026-07-19T10:00:00Z',
      updated_at: '2026-07-19T10:00:00Z',
      ...(await encryptJSON(
        { title: n.title, content: 'body of ' + n.id, url: null, tags: n.tags ?? [] },
        dataKey,
      )),
    })),
  )
  cacheNotes(username, encrypted)
}

beforeEach(() => {
  store.clear()
  clearSession()
})

// The note list is seeded from the local cache so the first paint doesn't wait
// on the network round trip plus the full ciphertext of every note.
describe('listNotesCached', () => {
  it('decrypts the cached notes without touching the network', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'alice')
    await seedCache('alice', [
      { id: '1', title: 'First' },
      { id: '2', title: 'Second' },
    ])

    const notes = await listNotesCached()

    expect(notes).toMatchObject([
      { id: '1', title: 'First', content: 'body of 1' },
      { id: '2', title: 'Second', content: 'body of 2' },
    ])
  })

  it('populates the known tags so the filter bar renders straight away', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'alice')
    await seedCache('alice', [{ id: '1', title: 'First', tags: ['work', 'ideas'] }])

    await listNotesCached()

    expect(getKnownTags()).toEqual(['ideas', 'work'])
  })

  it('returns null when the user has nothing cached', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'bob')
    expect(await listNotesCached()).toBeNull()
  })

  it('returns null when the vault is locked', async () => {
    await seedCache('alice', [{ id: '1', title: 'First' }])
    expect(await listNotesCached()).toBeNull()
  })
})

// Restoring a backup needs the note's own title and its original creation
// time to survive the round trip; the API accepts both.
describe('createNote with import options', () => {
  function mockCreateOk() {
    const fn = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const sent = JSON.parse(init.body)
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'new-id',
          iv: sent.iv,
          ct: sent.ct,
          created_at: sent.created_at ?? '2026-07-20T00:00:00Z',
          updated_at: sent.created_at ?? '2026-07-20T00:00:00Z',
        }),
      }
    })
    vi.stubGlobal('fetch', fn)
    return fn
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the given created_at and preserves the given title', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'alice')
    const fetchMock = mockCreateOk()

    await createNote('# body', ['work'], {
      title: 'Explicit title',
      createdAt: '2026-01-02T03:04:05Z',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.created_at).toBe('2026-01-02T03:04:05Z')
    const payload = await decryptJSON<{ title: string; tags: string[] }>(
      { iv: body.iv, ct: body.ct },
      dataKey,
    )
    expect(payload.title).toBe('Explicit title')
    expect(payload.tags).toEqual(['work'])
  })

  it('omits created_at when no option is given', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'alice')
    const fetchMock = mockCreateOk()

    await createNote('# body')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('created_at')
  })
})
