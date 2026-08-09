import { describe, it, expect, beforeEach } from 'vitest'

// No jsdom (see api.test.ts): a Map-backed localStorage is enough, but this
// one also implements length/key() because pruneDrafts enumerates the store.
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
} as Storage

const {
  saveDraft,
  loadDraft,
  clearDraft,
  pruneDrafts,
  isRestorable,
  draftKey,
  noteSlot,
  DRAFT_MAX_AGE_MS,
} = await import('./draftStore')
const { generateDataKey } = await import('./crypto')

const dataKey = generateDataKey()
const other = generateDataKey()

beforeEach(() => store.clear())

describe('draftKey', () => {
  it('namespaces by user and slot', () => {
    expect(draftKey('ada', 'new')).toBe('bpad.draft.ada.new')
    expect(draftKey('ada', noteSlot('n1'))).toBe('bpad.draft.ada.note:n1')
  })
})

describe('save / load', () => {
  it('round-trips a draft', async () => {
    await saveDraft('ada', dataKey, 'new', { content: '# hi', tags: ['x'] })
    expect(await loadDraft('ada', dataKey, 'new')).toEqual({ content: '# hi', tags: ['x'] })
  })

  it('keeps the plaintext out of localStorage', async () => {
    await saveDraft('ada', dataKey, 'new', { content: 'secret plan', tags: ['work'] })
    const raw = store.get('bpad.draft.ada.new')!
    expect(raw).not.toContain('secret plan')
    expect(raw).not.toContain('work')
  })

  it('returns null for another account’s key', async () => {
    await saveDraft('ada', dataKey, 'new', { content: 'mine', tags: [] })
    expect(await loadDraft('ada', other, 'new')).toBeNull()
  })

  it('returns null when nothing is stored', async () => {
    expect(await loadDraft('ada', dataKey, 'new')).toBeNull()
  })

  it('returns null for a corrupt entry', async () => {
    store.set('bpad.draft.ada.new', 'not json')
    expect(await loadDraft('ada', dataKey, 'new')).toBeNull()
  })

  it('ignores a draft older than the max age', async () => {
    await saveDraft('ada', dataKey, 'new', { content: 'old', tags: [] })
    const stored = JSON.parse(store.get('bpad.draft.ada.new')!)
    stored.savedAt = Date.now() - DRAFT_MAX_AGE_MS - 1
    store.set('bpad.draft.ada.new', JSON.stringify(stored))
    expect(await loadDraft('ada', dataKey, 'new')).toBeNull()
  })

  it('keeps slots apart', async () => {
    await saveDraft('ada', dataKey, 'new', { content: 'composer', tags: [] })
    await saveDraft('ada', dataKey, noteSlot('n1'), { content: 'edit', tags: [] })
    expect((await loadDraft('ada', dataKey, 'new'))?.content).toBe('composer')
    expect((await loadDraft('ada', dataKey, noteSlot('n1')))?.content).toBe('edit')
  })
})

describe('clearDraft', () => {
  it('removes only its own slot', async () => {
    await saveDraft('ada', dataKey, 'new', { content: 'a', tags: [] })
    await saveDraft('ada', dataKey, noteSlot('n1'), { content: 'b', tags: [] })
    clearDraft('ada', 'new')
    expect(await loadDraft('ada', dataKey, 'new')).toBeNull()
    expect(await loadDraft('ada', dataKey, noteSlot('n1'))).not.toBeNull()
  })
})

describe('pruneDrafts', () => {
  it('drops stale drafts and keeps fresh ones, without a key', async () => {
    await saveDraft('ada', dataKey, 'new', { content: 'fresh', tags: [] })
    await saveDraft('bob', dataKey, 'new', { content: 'stale', tags: [] })
    const stale = JSON.parse(store.get('bpad.draft.bob.new')!)
    stale.savedAt = Date.now() - DRAFT_MAX_AGE_MS - 1
    store.set('bpad.draft.bob.new', JSON.stringify(stale))

    pruneDrafts()

    expect(store.has('bpad.draft.ada.new')).toBe(true)
    expect(store.has('bpad.draft.bob.new')).toBe(false)
  })

  it('leaves unrelated keys alone', async () => {
    store.set('bpad.cache.notes.ada', '[]')
    await saveDraft('ada', dataKey, 'new', { content: 'fresh', tags: [] })
    pruneDrafts()
    expect(store.has('bpad.cache.notes.ada')).toBe(true)
  })

  it('removes an unparseable entry under the draft prefix', () => {
    store.set('bpad.draft.ada.new', 'garbage')
    pruneDrafts()
    expect(store.has('bpad.draft.ada.new')).toBe(false)
  })
})

describe('isRestorable', () => {
  const baseline = { content: 'saved', title: 'T', tags: ['a'] }

  it('rejects a missing or blank draft', () => {
    expect(isRestorable(null, baseline)).toBe(false)
    expect(isRestorable({ content: '   ', tags: [] }, baseline)).toBe(false)
  })

  it('rejects a draft identical to what the editor already shows', () => {
    expect(isRestorable({ content: 'saved', title: 'T', tags: ['a'] }, baseline)).toBe(false)
  })

  it('accepts a draft that differs in content, title or tags', () => {
    expect(isRestorable({ content: 'newer', title: 'T', tags: ['a'] }, baseline)).toBe(true)
    expect(isRestorable({ content: 'saved', title: 'other', tags: ['a'] }, baseline)).toBe(true)
    expect(isRestorable({ content: 'saved', title: 'T', tags: ['a', 'b'] }, baseline)).toBe(true)
  })

  it('treats a missing title the same as an empty one', () => {
    expect(isRestorable({ content: 'x', tags: [] }, { content: 'x', title: '', tags: [] })).toBe(
      false,
    )
  })
})
