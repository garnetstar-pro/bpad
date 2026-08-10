# SEO and AI Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bpad.pro discoverable by search engines and AI crawlers by adding real metadata, static public HTML, sitemap, robots, structured data, and Open Graph tags — without changing the application's functionality, encryption, PWA, or security model.

**Architecture:** Vite builds the SPA as normal. A post-build Node.js script (`frontend/scripts/generate-seo-pages.js`) then generates static HTML for the 5 public URLs (`/`, `/private-notes`, `/encrypted-notes`, `/markdown-notes`, `/developer-notes`), embedding product copy, semantic headings, canonical tags, OG, Twitter, and JSON-LD. The SPA JS entry point is included in every static file so React hydrates normally on page load. Azure SWA's `staticwebapp.config.json` is updated to add `X-Robots-Tag: noindex, nofollow` headers on private/utility routes. The global `noindex` in `index.html` is removed.

**Tech Stack:** Node.js (built-in `fs`, no extra deps), Vite build pipeline (`npm run build` extended), Azure Static Web Apps config (JSON), React unchanged for app routes.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/index.html` | Modify | Remove global `noindex`; add homepage metadata (title, description, canonical, OG, Twitter, JSON-LD) |
| `frontend/public/robots.txt` | Modify | Allow public SEO paths; add sitemap declaration; keep private routes disallowed |
| `frontend/public/sitemap.xml` | Create | Canonical public URL list (5 URLs) |
| `frontend/public/staticwebapp.config.json` | Modify | Add route-level `X-Robots-Tag: noindex, nofollow` for private/utility routes |
| `frontend/scripts/generate-seo-pages.js` | Create | Post-build script that writes static HTML for the 4 secondary SEO pages |
| `frontend/package.json` | Modify | Extend `build` script to call `node scripts/generate-seo-pages.js` after Vite build |

No new React components. All public SEO page content is generated as static HTML by the build script; the SPA hydrates on top.

---

### Task 1: Remove global noindex and add homepage SEO metadata

**Files:**
- Modify: `frontend/index.html`

This task removes the `<meta name="robots" content="noindex, nofollow" />` that currently blocks all crawling, and adds a complete set of SEO metadata to the homepage HTML entry point. The React SPA hydrates on top of this — the metadata benefits crawlers even though the rest of the page is JS-rendered.

There are no testable units here (pure HTML). Validate by inspecting the file contents.

- [ ] **Step 1: Read the current file**

Read `frontend/index.html` to see current content before editing.

- [ ] **Step 2: Replace the head section**

Replace the entire `<head>` block in `frontend/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>Private Markdown Notes – Secure, Encrypted Online Notebook | bpad</title>
    <meta name="description" content="bpad is a privacy-focused Markdown note-taking app with zero-knowledge encryption. Your notes are encrypted in your browser — the server never reads them. Tags, search, images, offline access, and encrypted backups included." />
    <link rel="canonical" href="https://bpad.pro/" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://bpad.pro/" />
    <meta property="og:title" content="Private Markdown Notes – Secure, Encrypted Online Notebook | bpad" />
    <meta property="og:description" content="bpad is a privacy-focused Markdown note-taking app with zero-knowledge encryption. Your notes are encrypted in your browser — the server never reads them." />
    <meta property="og:image" content="https://bpad.pro/icon-512.png" />

    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Private Markdown Notes – bpad" />
    <meta name="twitter:description" content="Zero-knowledge encrypted Markdown notes. Encrypted in your browser, never on our servers. Tags, search, images, PWA." />
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
      "operatingSystem": "Web, iOS, Android",
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
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify the noindex line is gone**

Check that the file no longer contains `noindex`.

Run: `grep -c "noindex" frontend/index.html`
Expected: `0`

- [ ] **Step 4: Verify title is present**

Run: `grep "Private Markdown Notes" frontend/index.html`
Expected: line with the new title.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html
git commit -m "seo: add homepage metadata and remove global noindex"
```

---

### Task 2: Update robots.txt and add sitemap.xml

**Files:**
- Modify: `frontend/public/robots.txt`
- Create: `frontend/public/sitemap.xml`

Robots.txt currently has no sitemap declaration and uses `Allow: /$` (non-standard). This task updates it to the correct form and creates the sitemap.

- [ ] **Step 1: Write new robots.txt**

Replace `frontend/public/robots.txt` with:

```
User-agent: *
Allow: /private-notes
Allow: /encrypted-notes
Allow: /markdown-notes
Allow: /developer-notes
Allow: /assets/
Disallow: /notes/
Disallow: /account
Disallow: /verify
Disallow: /restore
Disallow: /share

Sitemap: https://bpad.pro/sitemap.xml
```

No `Allow: /$` — the homepage is allowed by default (the disallow list does not include it).

- [ ] **Step 2: Create frontend/public/sitemap.xml**

Create `frontend/public/sitemap.xml` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://bpad.pro/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://bpad.pro/private-notes</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://bpad.pro/encrypted-notes</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://bpad.pro/markdown-notes</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://bpad.pro/developer-notes</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
```

- [ ] **Step 3: Verify sitemap URL count**

Run: `grep -c "<loc>" frontend/public/sitemap.xml`
Expected: `5`

- [ ] **Step 4: Verify no private URLs in sitemap**

Run: `grep "notes/" frontend/public/sitemap.xml`
Expected: no output (empty).

- [ ] **Step 5: Verify sitemap declared in robots**

Run: `grep "Sitemap" frontend/public/robots.txt`
Expected: `Sitemap: https://bpad.pro/sitemap.xml`

- [ ] **Step 6: Commit**

```bash
git add frontend/public/robots.txt frontend/public/sitemap.xml
git commit -m "seo: update robots.txt and add sitemap.xml"
```

---

### Task 3: Add route-level noindex headers for private routes in staticwebapp.config.json

**Files:**
- Modify: `frontend/public/staticwebapp.config.json`

Azure SWA supports a `routes` array in `staticwebapp.config.json` alongside `navigationFallback` and `globalHeaders`. This task adds `X-Robots-Tag: noindex, nofollow` to private/utility routes so that even if a crawler lands on them, the HTTP header instructs it not to index.

The existing `globalHeaders`, `navigationFallback`, and `mimeTypes` keys must be preserved unchanged.

- [ ] **Step 1: Read current staticwebapp.config.json**

Read `frontend/public/staticwebapp.config.json` to confirm current structure.

- [ ] **Step 2: Add routes array**

Add a `routes` key to `frontend/public/staticwebapp.config.json`. The full file should become:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/api/*", "*.{svg,png,jpg,ico,css,js,json,txt,webmanifest,woff,woff2}"]
  },
  "mimeTypes": {
    ".webmanifest": "application/manifest+json"
  },
  "routes": [
    {
      "route": "/notes/*",
      "headers": { "X-Robots-Tag": "noindex, nofollow" }
    },
    {
      "route": "/account",
      "headers": { "X-Robots-Tag": "noindex, nofollow" }
    },
    {
      "route": "/verify",
      "headers": { "X-Robots-Tag": "noindex, nofollow" }
    },
    {
      "route": "/restore",
      "headers": { "X-Robots-Tag": "noindex, nofollow" }
    },
    {
      "route": "/share",
      "headers": { "X-Robots-Tag": "noindex, nofollow" }
    }
  ],
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self'; connect-src 'self' https://bpadimages.blob.core.windows.net; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), interest-cohort=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains"
  }
}
```

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('frontend/public/staticwebapp.config.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 4: Verify routes array exists and has 5 entries**

Run: `node -e "const c=JSON.parse(require('fs').readFileSync('frontend/public/staticwebapp.config.json','utf8')); console.log(c.routes.length)"`
Expected: `5`

- [ ] **Step 5: Verify globalHeaders preserved**

Run: `node -e "const c=JSON.parse(require('fs').readFileSync('frontend/public/staticwebapp.config.json','utf8')); console.log(Object.keys(c.globalHeaders).length)"`
Expected: `5`

- [ ] **Step 6: Commit**

```bash
git add frontend/public/staticwebapp.config.json
git commit -m "seo: add X-Robots-Tag noindex headers for private routes in SWA config"
```

---

### Task 4: Create the SEO page build script

**Files:**
- Create: `frontend/scripts/generate-seo-pages.js`
- Modify: `frontend/package.json`

This is the core SEO implementation task. The script runs after `npm run build` (Vite) and:
1. Reads `dist/index.html` to get the Vite-generated script/asset fingerprints.
2. Generates `dist/private-notes/index.html`, `dist/encrypted-notes/index.html`, `dist/markdown-notes/index.html`, `dist/developer-notes/index.html`.
3. Each static file has: `<!doctype html>`, `<html lang="en">`, full `<head>` with page-specific title/description/canonical/OG/Twitter/JSON-LD, semantic body with real product copy (h1, h2, p, ul, internal links), and the same Vite JS entry so the SPA hydrates.

The body content must be real copy — factual claims about bpad visible on the site. It is not hidden SEO text; it is the actual page. Include navigation links to the homepage and sibling pages.

The script must not require any npm packages beyond Node.js built-ins (`fs`, `path`).

#### SEO page copy

**`/private-notes`**

Title: `Private Notes That Only You Can Read | bpad`
Description: `bpad keeps your notes private with zero-knowledge encryption. Notes are encrypted in your browser before reaching the server. Nobody — not even us — can read them.`
H1: `Private Notes That Only You Can Read`

Body sections:
- H2: `Your notes are encrypted before they leave your device`
  - p: "bpad uses zero-knowledge encryption: your notes and images are encrypted in your browser using AES-256-GCM before they reach the server. The server stores only ciphertext — neither bpad's servers nor anyone operating them can read your content."
- H2: `Everything you write stays private`
  - ul items from featuresData.ts:
    - "Zero-knowledge encryption — everything is encrypted in your browser before reaching the server."
    - "Biometric unlock — unlock with a fingerprint or Face ID on supported devices."
    - "Configurable auto-lock — the vault locks after inactivity (1, 5, 15, 30, or 60 minutes)."
    - "Recovery code — a one-time recovery code lets you recover access if you forget your password."
    - "Encrypted backup — download all notes and images as a passphrase-protected ZIP."
- H2: `Private Markdown notes, available everywhere`
  - p: "bpad works offline and installs as a PWA on your home screen. Your notes are cached locally so you can read them without an internet connection."
- Internal links section:
  - "Encrypted notes: how it works technically" → /encrypted-notes
  - "Markdown note-taking features" → /markdown-notes
  - "← Back to bpad.pro" → /

**`/encrypted-notes`**

Title: `Zero-Knowledge Encrypted Notes | bpad`
Description: `bpad uses zero-knowledge encryption — Argon2id key derivation, AES-256-GCM, and HKDF. Your encryption keys never leave your browser. The server stores only ciphertext.`
H1: `Zero-Knowledge Encrypted Notes`

Body sections:
- H2: `How zero-knowledge encryption works`
  - p: "When you create a bpad account, your password is used to derive an encryption key using Argon2id and HKDF directly in your browser. This key never leaves your device. Your notes and images are encrypted with AES-256-GCM before being sent to the server. The server stores only the initialization vector (IV) and ciphertext — never the plaintext or the key."
- H2: `What the server can and cannot see`
  - ul:
    - "Can see: your username, an authentication verifier (PBKDF2-hashed, not the password), and encrypted ciphertext."
    - "Cannot see: note content, note titles, image content, tags, or any plaintext you write."
- H2: `Recovery without compromising privacy`
  - p: "At account creation, bpad generates a one-time recovery code. If you forget your password, this code allows your browser to re-derive access to your notes and set a new password. Notes are never decrypted on the server during this process."
- H2: `Biometric unlock`
  - p: "On devices with biometric support (Face ID, Touch ID), bpad uses WebAuthn PRF to unlock your vault with a fingerprint. The biometric never transmits your password — it unwraps a device-stored key that unlocks the vault locally."
- Internal links:
  - "Private notes overview" → /private-notes
  - "Markdown editor and features" → /markdown-notes
  - "← Back to bpad.pro" → /

**`/markdown-notes`**

Title: `Markdown Notes with Images, Tags, and Search | bpad`
Description: `bpad is a full-featured Markdown note-taking app: write in Markdown, add images, use tags, search across all your notes, and export encrypted backups. Zero-knowledge encrypted.`
H1: `Markdown Notes with Images, Tags, and Full-Text Search`

Body sections:
- H2: `Write in Markdown`
  - p: "bpad's editor supports the full Markdown syntax: bold, italic, headings, lists, tables, code blocks, and links. Toggle between Write and Preview mode with one click."
  - ul from featuresData: Markdown editor, Rendered preview, Auto-title from heading, Quick save (Ctrl+Enter / ⌘+Enter).
- H2: `Organise with tags and search`
  - ul from featuresData: Tags, Smart search (full-text, diacritics-insensitive), Sort notes (by created or modified).
- H2: `Images in notes`
  - p from featuresData: "Insert images from the toolbar or paste them from the clipboard. Each image is downscaled to 1600 px WebP. Click any image to view it full-screen."
  - p: "Images are encrypted with the same zero-knowledge key as your text. The server stores only ciphertext."
- H2: `Access your notes anywhere`
  - ul from featuresData: Works offline, Installable app (PWA), Per-note URLs.
- H2: `Keep your notes safe`
  - ul from featuresData: Encrypted backup, Plain backup with readable files, Account-free restore, Idempotent import.
- Internal links:
  - "How encryption works" → /encrypted-notes
  - "Notes for developers" → /developer-notes
  - "← Back to bpad.pro" → /

**`/developer-notes`**

Title: `Encrypted Markdown Notes for Developers | bpad`
Description: `bpad is a privacy-first Markdown notebook for developers: code blocks, tables, links, per-note URLs, zero-knowledge encryption, offline support, and encrypted ZIP backups.`
H1: `Encrypted Markdown Notes for Developers`

Body sections:
- H2: `Markdown with code blocks`
  - p: "Write technical notes with fenced code blocks, inline code, tables, checklists, and links. bpad renders full GitHub-Flavoured Markdown."
  - ul: Code blocks (fenced, syntax-highlighted in preview), Tables, Checklists (`- [ ] task`), Links, Blockquotes.
- H2: `A note for every task`
  - ul from featuresData: Per-note URLs (bookmark or share), Save a link in one move (address-bar URL capture), Tags (filter by project/topic), Smart search.
- H2: `Private by design`
  - p: "Your notes are encrypted with AES-256-GCM in your browser before reaching the server. Neither bpad nor its infrastructure can read your notes. The encryption key is derived locally from your password using Argon2id."
- H2: `Works wherever you work`
  - ul from featuresData: Works offline, Installable app (PWA), Prompted updates (no silent installs).
- H2: `Export and backup`
  - ul from featuresData: Encrypted backup (ZIP), Plain backup with readable Markdown files, Account-free restore.
- Internal links:
  - "How zero-knowledge encryption works" → /encrypted-notes
  - "All Markdown features" → /markdown-notes
  - "← Back to bpad.pro" → /

#### Script structure

The script:
1. Reads `dist/index.html`.
2. Extracts the `<script type="module" src="...">` entry tag from it (the Vite-fingerprinted entry).
3. Extracts the CSS `<link rel="stylesheet">` tags from it.
4. For each SEO page definition, creates the target directory and writes the HTML file.
5. Logs the pages it generated.

Template for each generated file:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>{TITLE}</title>
    <meta name="description" content="{DESCRIPTION}" />
    <link rel="canonical" href="{CANONICAL}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{CANONICAL}" />
    <meta property="og:title" content="{TITLE}" />
    <meta property="og:description" content="{DESCRIPTION}" />
    <meta property="og:image" content="https://bpad.pro/icon-512.png" />

    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{TITLE}" />
    <meta name="twitter:description" content="{DESCRIPTION}" />
    <meta name="twitter:image" content="https://bpad.pro/icon-512.png" />

    <!-- Structured data (same as homepage) -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "bpad",
      "url": "https://bpad.pro/",
      "description": "A privacy-focused Markdown note-taking app with zero-knowledge encryption. Notes are encrypted in your browser — the server never reads them.",
      "applicationCategory": "ProductivityApplication",
      "operatingSystem": "Web, iOS, Android",
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

    {CSS_LINKS}
  </head>
  <body>
    <main>
      {BODY_HTML}
    </main>
    <div id="root"></div>
    {SCRIPT_TAG}
  </body>
</html>
```

The `<main>` block contains the semantic HTML (h1, h2, p, ul, nav). The `<div id="root"></div>` and `{SCRIPT_TAG}` let the SPA hydrate on top. On load the user sees the React app; crawlers that don't execute JS see the static content.

- [ ] **Step 1: Create frontend/scripts/ directory if it doesn't exist**

Run: `mkdir -p frontend/scripts`

- [ ] **Step 2: Create frontend/scripts/generate-seo-pages.js**

Write the complete script. Use Node.js `fs` and `path` only. No external dependencies.

The script must:
- Read `dist/index.html`
- Extract the script module tag: match `/<script type="module" [^>]*src="[^"]*"[^>]*><\/script>/` and capture the full tag
- Extract CSS link tags: match all `/<link rel="stylesheet"[^>]*>/g` tags
- Define the 4 SEO page objects (slug, title, description, canonical, bodyHtml)
- For each page: `fs.mkdirSync(`dist/${slug}`, { recursive: true })`, write the HTML
- Log each written path

The body HTML for each page is a plain string of HTML with h1, h2, p, ul/li elements plus a nav section with internal links. Use the copy defined above in "SEO page copy".

Nav links should be rendered as:
```html
<nav aria-label="Related pages">
  <ul>
    <li><a href="/encrypted-notes">Encrypted notes: how it works technically</a></li>
    <li><a href="/markdown-notes">Markdown note-taking features</a></li>
    <li><a href="/">← Back to bpad.pro</a></li>
  </ul>
</nav>
```

- [ ] **Step 3: Update frontend/package.json build script**

Change the `build` script from:
```json
"build": "tsc -b && vite build"
```
to:
```json
"build": "tsc -b && vite build && node scripts/generate-seo-pages.js"
```

- [ ] **Step 4: Run the full build**

```bash
cd frontend && npm run build
```

Expected: No errors. Last lines should include messages from the SEO script like:
```
Generated dist/private-notes/index.html
Generated dist/encrypted-notes/index.html
Generated dist/markdown-notes/index.html
Generated dist/developer-notes/index.html
```

- [ ] **Step 5: Verify each SEO page exists**

Run from `frontend/`:
```bash
ls dist/private-notes/index.html dist/encrypted-notes/index.html dist/markdown-notes/index.html dist/developer-notes/index.html
```
Expected: all 4 files listed without error.

- [ ] **Step 6: Verify each page has correct h1**

```bash
grep -h "Private Notes That Only You Can Read" dist/private-notes/index.html
grep -h "Zero-Knowledge Encrypted Notes" dist/encrypted-notes/index.html
grep -h "Markdown Notes with Images" dist/markdown-notes/index.html
grep -h "Encrypted Markdown Notes for Developers" dist/developer-notes/index.html
```
Expected: each grep returns a matching line.

- [ ] **Step 7: Verify noindex is absent from SEO pages**

```bash
grep -l "noindex" dist/private-notes/index.html dist/encrypted-notes/index.html dist/markdown-notes/index.html dist/developer-notes/index.html
```
Expected: no output (no files contain noindex).

- [ ] **Step 8: Verify canonical in private-notes page**

```bash
grep "canonical" dist/private-notes/index.html
```
Expected: `<link rel="canonical" href="https://bpad.pro/private-notes" />`

- [ ] **Step 9: Verify script tag present for SPA hydration**

```bash
grep 'type="module"' dist/private-notes/index.html
```
Expected: a `<script type="module" src="/assets/...">` tag.

- [ ] **Step 10: Verify JSON-LD present**

```bash
grep "application/ld+json" dist/private-notes/index.html
```
Expected: matching line.

- [ ] **Step 11: Run existing tests to confirm nothing is broken**

```bash
cd frontend && npm run test
```
Expected: all tests pass.

- [ ] **Step 12: Run lint**

```bash
cd frontend && npm run lint
```
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add frontend/scripts/generate-seo-pages.js frontend/package.json
git commit -m "seo: add SEO page build script and wire into npm run build"
```

---

## Validation Checklist (run after all tasks)

- [ ] `dist/index.html` has correct title, description, canonical, OG, Twitter, JSON-LD, no `noindex`
- [ ] `dist/private-notes/index.html`, `dist/encrypted-notes/index.html`, `dist/markdown-notes/index.html`, `dist/developer-notes/index.html` all exist with h1, h2s, canonical, metadata, and script tag
- [ ] `dist/robots.txt` disallows `/notes/`, `/account`, `/verify`, `/restore`, `/share`; has Sitemap line
- [ ] `dist/sitemap.xml` has exactly 5 URLs, all `https://bpad.pro/...`, none private
- [ ] JSON-LD in `dist/index.html` is valid JSON (parse with `node -e "JSON.parse(...)"`)
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] No authenticated/private content in any static HTML file

---

## Search Console Readiness

After deploying, submit:
- Sitemap: `https://bpad.pro/sitemap.xml`
- Inspect URLs: `/`, `/private-notes`, `/encrypted-notes`, `/markdown-notes`, `/developer-notes`
- Monitor: indexed page count, search queries, mobile usability
