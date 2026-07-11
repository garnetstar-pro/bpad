// Text a limit pro upozornění neověřeného účtu. Limit zrcadlí backendovou
// konstantu _UNVERIFIED_NOTE_LIMIT ve function_app.py – drž je v souladu.
export const UNVERIFIED_NOTE_LIMIT = 10

// Kolik poznámek ještě zbývá, než neověřený účet narazí na limit (>= 0).
export function remainingNotes(count: number | null, limit = UNVERIFIED_NOTE_LIMIT): number {
  return Math.max(0, limit - (count ?? 0))
}

// Hláška do verify banneru pro neověřený účet, včetně počítadla.
export function verifyBannerMessage(count: number | null, limit = UNVERIFIED_NOTE_LIMIT): string {
  const remaining = remainingNotes(count, limit)
  if (remaining === 0) {
    return `Dosáhl jsi limitu ${limit} poznámek — ověř e-mail, ať můžeš psát dál.`
  }
  return `Neověřený účet — zbývá ${remaining} z ${limit} poznámek. Ověř e-mail pro neomezené psaní.`
}
