// Feature list shown on the public landing page and the in-app Features page.
// English-only display copy (a shared source of truth so the two stay in sync).
export interface Feature {
  name: string
  desc: string
}

export interface FeatureCategory {
  title: string
  features: Feature[]
}

// The domain the app is actually served from, so the link-capture example is
// accurate wherever it's deployed (mirrors the welcome note's {host}).
const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'bpad.pro'

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    title: 'Writing',
    features: [
      {
        name: 'Markdown editor',
        desc: 'Write in plain Markdown. Bold, italic, headings, lists, tables, code blocks, links — all supported.',
      },
      {
        name: 'Rendered preview',
        desc: 'Toggle between Write and Preview with one click to see your note fully rendered.',
      },
      {
        name: 'Auto-title from heading',
        desc: 'The first "# …" heading in your note automatically becomes its title. Override it manually if you need something different.',
      },
      {
        name: 'Quick save',
        desc: 'Ctrl+Enter (⌘+Enter on Mac) saves from anywhere in the editor — no reaching for the mouse.',
      },
      {
        name: 'Tags',
        desc: 'Add short tags to any note and filter the list by them with one click. Tags are shared across all your notes for quick navigation.',
      },
      {
        name: 'Images in notes',
        desc: 'Insert images from the toolbar or paste them from the clipboard. Each image is downscaled to 1600 px WebP so it doesn\'t take up too much space. Click any image to view it full-screen.',
      },
      {
        name: 'Sort notes',
        desc: 'Sort your note list by creation date or last modification — the choice is remembered per account.',
      },
    ],
  },
  {
    title: 'Navigation',
    features: [
      {
        name: 'Smart search',
        desc: 'Full-text search that ignores diacritics — type "clanek" and it finds "Článek".',
      },
      {
        name: 'Per-note URLs',
        desc: 'Every note has its own address (/notes/…) so you can bookmark it or share a direct link.',
      },
      {
        name: 'Two-column layout',
        desc: 'On desktop, the note list stays pinned on the left while the open note fills the right. Each column scrolls independently.',
      },
      {
        name: 'Save a link in one move',
        desc: `Type "${host}/" in the address bar followed by any full URL and it instantly becomes a new note.`,
      },
    ],
  },
  {
    title: 'Security',
    features: [
      {
        name: 'Zero-knowledge encryption',
        desc: 'Everything — notes and images — is encrypted in your browser before it reaches the server. Neither the server nor anyone who runs it can read your content.',
      },
      {
        name: 'Biometric unlock',
        desc: 'On devices with biometrics, unlock the vault with a fingerprint or Face ID — no password typing needed.',
      },
      {
        name: 'Configurable auto-lock',
        desc: 'The vault locks itself after a period of inactivity you choose — 1, 5, 15, 30, or 60 minutes — or set it to never. Desktop defaults to 5 minutes; mobile defaults to never.',
      },
      {
        name: 'Recovery code',
        desc: 'At sign-up you receive a one-time recovery code. If you forget your password, this code is the only way back in — save it somewhere safe.',
      },
      {
        name: 'Change password',
        desc: 'Change your password at any time. Your notes are re-wrapped with the new key automatically — nothing is lost.',
      },
    ],
  },
  {
    title: 'Your data',
    features: [
      {
        name: 'Encrypted backup',
        desc: 'Download all your notes and images as a single ZIP file protected with a passphrase. Keep it on a USB stick or an encrypted drive.',
      },
      {
        name: 'Plain backup with readable files',
        desc: 'Export without encryption and the ZIP contains your notes as readable Markdown files — openable in any text editor, forever.',
      },
      {
        name: 'Account-free restore',
        desc: 'Open any bpad backup at /restore — even without an account. Your safety net if you lose both your password and your recovery code.',
      },
      {
        name: 'Idempotent import',
        desc: 'Restoring a backup is safe to run more than once. Duplicates are detected and skipped, so a failed import can always be retried.',
      },
    ],
  },
  {
    title: 'Anywhere',
    features: [
      {
        name: 'Works offline',
        desc: 'Your notes are cached locally so you can read them with no internet connection.',
      },
      {
        name: 'Installable app (PWA)',
        desc: 'Install bpad to your home screen or desktop as a standalone app — it gets its own icon and launches without a browser toolbar.',
      },
      {
        name: 'Prompted updates',
        desc: 'When a new version is available you get a notification and choose when to update — nothing installs silently.',
      },
      {
        name: 'E-mail verification',
        desc: 'Unverified accounts have a note cap. Verify your e-mail and write without limits.',
      },
      {
        name: 'In-app feedback',
        desc: 'Send ideas or bug reports straight from your account — without leaving the app.',
      },
    ],
  },
]

// Flat list for the landing page grid (preserves original behaviour).
export const FEATURES: Feature[] = FEATURE_CATEGORIES.flatMap((c) => c.features)
