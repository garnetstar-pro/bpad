// Whether the desktop new-entry composer should open expanded on mount.
// Expanded only when the account is known to hold no notes — there is nothing
// to read yet, so we skip the extra click. A null count (not yet loaded) stays
// collapsed to avoid flashing the editor open and snapping it shut once notes
// arrive.
export function shouldStartExpanded(knownNoteCount: number | null): boolean {
  return knownNoteCount === 0
}
