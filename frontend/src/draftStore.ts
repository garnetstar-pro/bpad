// Crash-safe storage for a note that is still being written. The idle lock
// (AuthContext) unmounts the whole app behind the lock screen, and a plain
// navigation unmounts the Editor — both used to drop whatever was typed but
// not saved. The draft is encrypted with the account's dataKey before it
// reaches localStorage, so an unsaved note is exactly as readable at rest as a
// saved one is in offlineCache.ts: not at all.
//
// Session-free on purpose (same split as offlineCache.ts): the caller passes
// the username and the key, which keeps this testable without a session.
import { encryptJSON, decryptJSON } from './crypto'

export interface Draft {
  content: string
  // Only the note-editing path has an editable title; the composer derives it.
  title?: string
  tags: string[]
}

// `savedAt` stays outside the ciphertext because pruning has to work for an
// account nobody is logged into — there is no key to read it with. It leaks
// "this account had a draft at time T", the same class of metadata the
// offline note cache already stores in the clear.
interface StoredDraft {
  savedAt: number
  iv: string
  ct: string
}

const PREFIX = 'bpad.draft.'

// Drafts are a safety net for an interruption, not an archive. A week is long
// enough to cover a forgotten tab over a holiday and short enough that stale
// text never resurfaces as a surprise.
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Slot = which editor the draft belongs to. The two new-note composers
// (mobile inline, desktop pinned) deliberately share one slot: they never
// coexist, so starting on the phone and finishing on the desktop just works.
export const NEW_NOTE_SLOT = 'new'
export const noteSlot = (id: string) => `note:${id}`

export function draftKey(username: string, slot: string): string {
  return `${PREFIX}${username}.${slot}`
}

export async function saveDraft(
  username: string,
  dataKey: Uint8Array,
  slot: string,
  draft: Draft,
): Promise<void> {
  const enc = await encryptJSON(draft, dataKey)
  const stored: StoredDraft = { savedAt: Date.now(), ...enc }
  try {
    localStorage.setItem(draftKey(username, slot), JSON.stringify(stored))
  } catch {
    /* quota / private mode — the draft is best-effort, like the note cache */
  }
}

export async function loadDraft(
  username: string,
  dataKey: Uint8Array,
  slot: string,
): Promise<Draft | null> {
  let stored: StoredDraft
  try {
    const raw = localStorage.getItem(draftKey(username, slot))
    if (!raw) return null
    stored = JSON.parse(raw) as StoredDraft
  } catch {
    return null
  }
  if (Date.now() - stored.savedAt > DRAFT_MAX_AGE_MS) return null
  try {
    return await decryptJSON<Draft>({ iv: stored.iv, ct: stored.ct }, dataKey)
  } catch {
    // Wrong key (a different account unlocked in this browser) or a corrupt
    // entry. Either way there is nothing to restore.
    return null
  }
}

export function clearDraft(username: string, slot: string): void {
  try {
    localStorage.removeItem(draftKey(username, slot))
  } catch {
    /* ignore */
  }
}

// Drop drafts nobody came back for. Runs without a key, so it can also clean
// up after accounts that are no longer used in this browser.
export function pruneDrafts(now: number = Date.now()): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      const raw = localStorage.getItem(key)
      let savedAt = 0
      try {
        savedAt = (JSON.parse(raw ?? '') as StoredDraft).savedAt ?? 0
      } catch {
        // Unparseable entry under our prefix — it can never be restored.
      }
      if (now - savedAt > DRAFT_MAX_AGE_MS) stale.push(key)
    }
    stale.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((tag, i) => tag === b[i])

// Whether a stored draft is worth putting back in front of the user. An empty
// draft is noise, and one that matches what is already in the editor (the
// saved note, or an untouched composer) would restore nothing while still
// showing the "restored" banner.
export function isRestorable(draft: Draft | null, baseline: Draft): boolean {
  if (!draft || !draft.content.trim()) return false
  return (
    draft.content !== baseline.content ||
    (draft.title ?? '') !== (baseline.title ?? '') ||
    !sameTags(draft.tags, baseline.tags)
  )
}
