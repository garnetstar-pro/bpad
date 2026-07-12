// Feature list shown on the public landing page and the in-app Features page.
// English-only display copy (a shared source of truth so the two stay in sync).
export interface Feature {
  name: string
  desc: string
}

// The domain the app is actually served from, so the link-capture example is
// accurate wherever it's deployed (mirrors the welcome note's {host}).
const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'bpad.pro'

export const FEATURES: Feature[] = [
  {
    name: 'Encrypted vault',
    desc: 'Everything is encrypted in your browser (zero-knowledge). The server never sees your notes — neither do we.',
  },
  {
    name: 'Markdown with auto-title',
    desc: 'Write in Markdown; the first "# …" heading becomes the note title. You can also override it.',
  },
  {
    name: 'Preview',
    desc: 'Toggle between writing and a rendered Markdown preview right in the editor.',
  },
  {
    name: 'Quick save',
    desc: 'Ctrl+Enter (Cmd+Enter on Mac) saves from anywhere in the editor.',
  },
  {
    name: 'Smart search',
    desc: 'Full-text over the list that ignores diacritics — "clanek" finds "Článek".',
  },
  {
    name: 'Per-note URLs',
    desc: 'Every note has its own address (/notes/…), so you can link and return to it.',
  },
  {
    name: 'Save a link in one move',
    desc: `Type "${host}/" then a full URL and it becomes a new note.`,
  },
  {
    name: 'Biometric unlock',
    desc: 'On devices with biometrics, unlock the vault with a fingerprint or face — no password typing.',
  },
  {
    name: 'Offline & installable',
    desc: 'Read your notes with no signal, and install bpad to your home screen as a standalone app (PWA).',
  },
  {
    name: 'Recovery code',
    desc: 'At signup you get a one-time code to regain access if you forget your password. Save it.',
  },
  {
    name: 'E-mail verification',
    desc: 'Unverified accounts have a note cap; after verifying your e-mail you write without limits.',
  },
]
