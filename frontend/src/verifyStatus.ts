// Copy and limit for the unverified-account notice. The limit mirrors the
// backend's _UNVERIFIED_NOTE_LIMIT constant in function_app.py – keep them
// in sync.
import { translate } from './i18n'

export const UNVERIFIED_NOTE_LIMIT = 10

// How many notes remain before an unverified account hits the limit (>= 0).
export function remainingNotes(count: number | null, limit = UNVERIFIED_NOTE_LIMIT): number {
  return Math.max(0, limit - (count ?? 0))
}

// Message for the verify banner on an unverified account, including the counter.
export function verifyBannerMessage(count: number | null, limit = UNVERIFIED_NOTE_LIMIT): string {
  const remaining = remainingNotes(count, limit)
  if (remaining === 0) {
    return translate('verify.atLimit', { limit })
  }
  return translate('verify.remaining', { remaining, limit })
}
