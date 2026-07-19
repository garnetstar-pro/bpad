import { describe, it, expect, beforeEach } from 'vitest'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

const { listNotesCached, getKnownTags } = await import('./api')
const { encryptJSON, generateDataKey } = await import('./crypto')
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
