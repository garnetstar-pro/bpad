// Generates static SEO landing pages after `vite build`.
// Usage: node scripts/generate-seo-pages.js
// Run automatically via the `build` npm script.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')

// Read the Vite-generated index.html to extract asset tags
let distHtml
try {
  distHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
} catch {
  console.error('generate-seo-pages: dist/index.html not found — run `npm run build` first.')
  process.exit(1)
}

// Extract all <link rel="stylesheet" ...> tags
const cssLinks = [...distHtml.matchAll(/<link rel="stylesheet"[^>]*>/g)]
  .map(m => m[0])
  .join('\n    ')

// Extract the <script type="module" ...></script> tag
const scriptMatch = distHtml.match(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/)
if (!scriptMatch) {
  console.error('generate-seo-pages: could not find the Vite module script tag in dist/index.html.')
  process.exit(1)
}
const scriptTag = scriptMatch[0]

/**
 * Build a full HTML page from the given parameters.
 */
function buildPage(title, description, canonical, bodyHtml) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonical}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="https://bpad.pro/icon-512.png" />

    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="https://bpad.pro/icon-512.png" />

    <!-- Structured data -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "bpad",
      "url": "https://bpad.pro/",
      "description": "A privacy-focused Markdown note-taking app with zero-knowledge encryption. Notes are encrypted in your browser — the server never reads them.",
      "applicationCategory": "ProductivityApplication",
      "operatingSystem": "Web",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      },
      "brand": {
        "@type": "Brand",
        "name": "bpad"
      }
    }
    </script>

    ${cssLinks}
  </head>
  <body>
    <main>
      ${bodyHtml}
    </main>
    <div id="root"></div>
    ${scriptTag}
  </body>
</html>
`
}

const pages = [
  {
    slug: 'private-notes',
    title: 'Private Notes That Only You Can Read | bpad',
    description:
      'bpad keeps your notes private with zero-knowledge encryption. Notes are encrypted in your browser before reaching the server. Nobody — not even us — can read them.',
    canonical: 'https://bpad.pro/private-notes',
    bodyHtml: `<h1>Private Notes That Only You Can Read</h1>

<h2>Your notes are encrypted before they leave your device</h2>
<p>bpad uses zero-knowledge encryption: your notes and images are encrypted in your browser using AES-256-GCM before they reach the server. The server stores only ciphertext — neither bpad's servers nor anyone operating them can read your content.</p>

<h2>Everything you write stays private</h2>
<ul>
  <li><strong>Zero-knowledge encryption</strong> — everything is encrypted in your browser before reaching the server.</li>
  <li><strong>Biometric unlock</strong> — unlock with a fingerprint or Face ID on supported devices.</li>
  <li><strong>Configurable auto-lock</strong> — the vault locks after inactivity (1, 5, 15, 30, or 60 minutes).</li>
  <li><strong>Recovery code</strong> — a one-time recovery code lets you recover access if you forget your password.</li>
  <li><strong>Encrypted backup</strong> — download all notes and images as a passphrase-protected ZIP.</li>
</ul>

<h2>Private Markdown notes, available everywhere</h2>
<p>bpad works offline and installs as a PWA on your home screen. Your notes are cached locally so you can read them without an internet connection.</p>

<nav aria-label="Related pages">
  <ul>
    <li><a href="/encrypted-notes">Encrypted notes: how it works technically</a></li>
    <li><a href="/markdown-notes">Markdown note-taking features</a></li>
    <li><a href="/">← Back to bpad.pro</a></li>
  </ul>
</nav>`,
  },
  {
    slug: 'encrypted-notes',
    title: 'Zero-Knowledge Encrypted Notes | bpad',
    description:
      'bpad uses zero-knowledge encryption — Argon2id key derivation, AES-256-GCM, and HKDF. Your encryption keys never leave your browser. The server stores only ciphertext.',
    canonical: 'https://bpad.pro/encrypted-notes',
    bodyHtml: `<h1>Zero-Knowledge Encrypted Notes</h1>

<h2>How zero-knowledge encryption works</h2>
<p>When you create a bpad account, your password is used to derive an encryption key using Argon2id and HKDF directly in your browser. This key never leaves your device. Your notes and images are encrypted with AES-256-GCM before being sent to the server. The server stores only the initialization vector (IV) and ciphertext — never the plaintext or the key.</p>

<h2>What the server can and cannot see</h2>
<ul>
  <li><strong>Can see:</strong> your username, an authentication verifier (PBKDF2-hashed, not the password), and encrypted ciphertext.</li>
  <li><strong>Cannot see:</strong> note content, note titles, image content, tags, or any plaintext you write.</li>
</ul>

<h2>Recovery without compromising privacy</h2>
<p>At account creation, bpad generates a one-time recovery code. If you forget your password, this code allows your browser to re-derive access to your notes and set a new password. Notes are never decrypted on the server during this process.</p>

<h2>Biometric unlock</h2>
<p>On devices with biometric support (Face ID, Touch ID), bpad uses WebAuthn PRF to unlock your vault with a fingerprint. The biometric never transmits your password — it unwraps a device-stored key that unlocks the vault locally.</p>

<nav aria-label="Related pages">
  <ul>
    <li><a href="/private-notes">Private notes overview</a></li>
    <li><a href="/markdown-notes">Markdown editor and features</a></li>
    <li><a href="/">← Back to bpad.pro</a></li>
  </ul>
</nav>`,
  },
  {
    slug: 'markdown-notes',
    title: 'Markdown Notes with Images, Tags, and Search | bpad',
    description:
      'bpad is a full-featured Markdown note-taking app: write in Markdown, add images, use tags, search across all your notes, and export encrypted backups. Zero-knowledge encrypted.',
    canonical: 'https://bpad.pro/markdown-notes',
    bodyHtml: `<h1>Markdown Notes with Images, Tags, and Full-Text Search</h1>

<h2>Write in Markdown</h2>
<p>bpad's editor supports the full Markdown syntax: bold, italic, headings, lists, tables, code blocks, and links. Toggle between Write and Preview mode with one click.</p>
<ul>
  <li><strong>Markdown editor</strong> — write in plain Markdown with full syntax support.</li>
  <li><strong>Rendered preview</strong> — toggle between Write and Preview with one click.</li>
  <li><strong>Auto-title from heading</strong> — the first # heading becomes the note title automatically.</li>
  <li><strong>Quick save</strong> — Ctrl+Enter (⌘+Enter on Mac) saves from anywhere in the editor.</li>
</ul>

<h2>Organise with tags and search</h2>
<ul>
  <li><strong>Tags</strong> — add short tags to any note and filter the list with one click.</li>
  <li><strong>Smart search</strong> — full-text search that ignores diacritics: type "clanek" and it finds "Článek".</li>
  <li><strong>Sort notes</strong> — sort by creation date or last modification.</li>
</ul>

<h2>Images in notes</h2>
<p>Insert images from the toolbar or paste them from the clipboard. Each image is downscaled to 1600 px WebP. Click any image to view it full-screen.</p>
<p>Images are encrypted with the same zero-knowledge key as your text. The server stores only ciphertext.</p>

<h2>Access your notes anywhere</h2>
<ul>
  <li><strong>Works offline</strong> — notes are cached locally so you can read them without internet.</li>
  <li><strong>Installable app (PWA)</strong> — install to your home screen or desktop as a standalone app.</li>
  <li><strong>Per-note URLs</strong> — every note has its own address so you can bookmark it.</li>
</ul>

<h2>Keep your notes safe</h2>
<ul>
  <li><strong>Encrypted backup</strong> — download all notes and images as a passphrase-protected ZIP.</li>
  <li><strong>Plain backup with readable files</strong> — export without encryption; notes become readable Markdown files.</li>
  <li><strong>Account-free restore</strong> — open any bpad backup without an account.</li>
  <li><strong>Idempotent import</strong> — restoring a backup is safe to run more than once; duplicates are skipped.</li>
</ul>

<nav aria-label="Related pages">
  <ul>
    <li><a href="/encrypted-notes">How encryption works</a></li>
    <li><a href="/developer-notes">Notes for developers</a></li>
    <li><a href="/">← Back to bpad.pro</a></li>
  </ul>
</nav>`,
  },
  {
    slug: 'developer-notes',
    title: 'Encrypted Markdown Notes for Developers | bpad',
    description:
      'bpad is a privacy-first Markdown notebook for developers: code blocks, tables, links, per-note URLs, zero-knowledge encryption, offline support, and encrypted ZIP backups.',
    canonical: 'https://bpad.pro/developer-notes',
    bodyHtml: `<h1>Encrypted Markdown Notes for Developers</h1>

<h2>Markdown with code blocks</h2>
<p>Write technical notes with fenced code blocks, inline code, tables, checklists, and links. bpad renders full GitHub-Flavoured Markdown.</p>
<ul>
  <li>Fenced code blocks (syntax-highlighted in preview)</li>
  <li>Tables</li>
  <li>Checklists (<code>- [ ] task</code>)</li>
  <li>Links</li>
  <li>Blockquotes</li>
</ul>

<h2>A note for every task</h2>
<ul>
  <li><strong>Per-note URLs</strong> — every note has its own address (/notes/…); bookmark or share it.</li>
  <li><strong>Save a link in one move</strong> — type bpad.pro/ followed by any URL in the address bar to instantly create a note.</li>
  <li><strong>Tags</strong> — filter by project or topic with one click.</li>
  <li><strong>Smart search</strong> — full-text, ignores diacritics.</li>
</ul>

<h2>Private by design</h2>
<p>Your notes are encrypted with AES-256-GCM in your browser before reaching the server. Neither bpad nor its infrastructure can read your notes. The encryption key is derived locally from your password using Argon2id.</p>

<h2>Works wherever you work</h2>
<ul>
  <li><strong>Works offline</strong> — notes cached locally; read them without internet.</li>
  <li><strong>Installable app (PWA)</strong> — install as a standalone app on desktop or mobile.</li>
  <li><strong>Prompted updates</strong> — no silent installs; you choose when to update.</li>
</ul>

<h2>Export and backup</h2>
<ul>
  <li><strong>Encrypted backup</strong> — all notes and images as a passphrase-protected ZIP.</li>
  <li><strong>Plain backup</strong> — notes exported as readable Markdown files.</li>
  <li><strong>Account-free restore</strong> — open any backup without an account.</li>
</ul>

<nav aria-label="Related pages">
  <ul>
    <li><a href="/encrypted-notes">How zero-knowledge encryption works</a></li>
    <li><a href="/markdown-notes">All Markdown features</a></li>
    <li><a href="/">← Back to bpad.pro</a></li>
  </ul>
</nav>`,
  },
]

// -----------------------------------------------------------------------
// Homepage: inject a visible <main> into dist/index.html so crawlers see
// real product copy instead of an empty body. Without this the page looks
// like a phishing template to Safe Browsing heuristics: "blank page that
// shows a login form after JS".
// -----------------------------------------------------------------------
const homepageMain = `<main>
  <h1>Private Markdown Notes</h1>
  <p>bpad is a privacy-focused Markdown note-taking app. Notes are encrypted in your browser — the server never reads them.</p>

  <h2>Zero-knowledge encryption</h2>
  <p>Your password and encryption keys never leave your device. bpad uses Argon2id key derivation and AES-256-GCM encryption entirely in the browser. The server stores only ciphertext and cannot read your notes.</p>

  <h2>What you get</h2>
  <ul>
    <li>Markdown editor with rendered preview</li>
    <li>Tags, full-text search, and per-note URLs</li>
    <li>Images encrypted with the same zero-knowledge key</li>
    <li>Offline access and PWA installation</li>
    <li>Encrypted and plain ZIP backups</li>
    <li>Biometric unlock and configurable auto-lock</li>
  </ul>

  <p><a href="/#create-account">Create a free account</a> or <a href="/#login">log in to bpad</a>.</p>

  <nav aria-label="Learn more">
    <ul>
      <li><a href="/private-notes">Private notes — how bpad keeps your data private</a></li>
      <li><a href="/encrypted-notes">Zero-knowledge encryption — technical details</a></li>
      <li><a href="/markdown-notes">Markdown features — editor, images, tags, search</a></li>
      <li><a href="/developer-notes">For developers — code blocks, links, privacy</a></li>
    </ul>
  </nav>
</main>`

// Also add WebSite + Organization JSON-LD to the homepage for entity identity.
// This helps Google understand that bpad.pro is a known legitimate service
// and that the login form belongs to this entity — reducing phishing false positives.
const websiteJsonLd = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "bpad",
    "url": "https://bpad.pro/",
    "description": "Privacy-focused Markdown note-taking with zero-knowledge encryption.",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://bpad.pro/"
    }
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "bpad",
    "url": "https://bpad.pro/",
    "logo": "https://bpad.pro/icon-512.png"
  }
  </script>`

// Inject <main> before <div id="root"> and add WebSite/Organization JSON-LD before </head>
let updatedIndex = distHtml
  .replace('<div id="root"></div>', `${homepageMain}\n    <div id="root"></div>`)
  .replace('</head>', `  ${websiteJsonLd}\n  </head>`)

fs.writeFileSync(path.join(distDir, 'index.html'), updatedIndex)
console.log(`updated dist/index.html with homepage <main> and entity JSON-LD`)

// -----------------------------------------------------------------------
// SEO subpages
// -----------------------------------------------------------------------
for (const page of pages) {
  const dir = path.join(distDir, page.slug)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'index.html')
  fs.writeFileSync(filePath, buildPage(page.title, page.description, page.canonical, page.bodyHtml))
  console.log(`wrote ${filePath}`)
}
