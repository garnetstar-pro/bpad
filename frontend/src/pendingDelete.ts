// Deferred note deletion with an undo window.
//
// Deleting used to be a window.confirm followed by an immediate, irreversible
// DELETE — and irreversible here really means it: the server cannot restore a
// note it was never able to read, and cascade_delete_note drops the note's
// images with it. A native confirm is the weakest possible guard, because
// people click through modals without reading them.
//
// So the delete is scheduled instead: the note vanishes from the UI at once,
// the API call fires only after the undo window closes, and undo simply means
// never making the call. Nothing to restore, because nothing was destroyed.
//
// The commit callback is injected rather than imported so this module stays
// free of api.ts (and therefore testable without a session or a network).

export interface PendingDelete {
  id: string
  // Kept for the toast, which outlives the note detail it was triggered from.
  title: string
}

export const PENDING_DELETE_EVENT = 'bpad:pending-delete'

// Long enough to notice the toast and react, short enough that the note is
// really gone by the time the user moves on.
export const UNDO_WINDOW_MS = 5000

type Commit = (id: string) => Promise<void>

let pending: PendingDelete | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let commitFn: Commit | null = null

function announce(): void {
  window.dispatchEvent(new Event(PENDING_DELETE_EVENT))
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

// Runs the deferred DELETE. A failure is deliberately quiet: the note is still
// on the server, and the list refetch that follows brings it back into view,
// which is a better outcome than an error banner about a note the user
// already considers gone.
async function commit(): Promise<void> {
  const target = pending
  const fn = commitFn
  clearTimer()
  pending = null
  commitFn = null
  announce()
  if (!target || !fn) return
  try {
    await fn(target.id)
  } catch {
    /* the note survives; the next list refresh shows it again */
  }
}

// Schedule a deletion. A second delete while one is still pending commits the
// first immediately — one toast, one undo, no hidden queue of doomed notes.
export function schedulePendingDelete(id: string, title: string, fn: Commit): void {
  if (pending && pending.id !== id) void commit()
  pending = { id, title }
  commitFn = fn
  clearTimer()
  timer = setTimeout(() => void commit(), UNDO_WINDOW_MS)
  announce()
}

// Call off a scheduled deletion. The DELETE was never sent, so this restores
// nothing — it just stops something from happening.
export function undoPendingDelete(): void {
  clearTimer()
  pending = null
  commitFn = null
  announce()
}

export function getPendingDelete(): PendingDelete | null {
  return pending
}

// Used by the note list to hide a note that is on its way out.
export function isPendingDelete(id: string): boolean {
  return pending?.id === id
}

// Closing the tab mid-window simply drops the deletion and the note stays.
// That is the safe direction to fail in, and it is why this is never persisted.
export function resetPendingDelete(): void {
  clearTimer()
  pending = null
  commitFn = null
}
