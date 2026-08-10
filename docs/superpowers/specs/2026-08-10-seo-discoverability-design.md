# SEO and AI Discoverability for bpad.pro – Design Spec

## Overview

bpad.pro is a privacy-focused Markdown note-taking application with zero-knowledge encryption. The current site is completely hidden from search engines (`noindex, nofollow` on every page) and provides no meaningful HTML content before JavaScript executes. This spec describes the changes required to make bpad.pro crawlable, understandable to AI crawlers, and discoverable in organic search — without changing the application's functionality, authentication, encryption, PWA behavior, or security model.

**Primary statement for crawlers:**
> bpad is a privacy-focused Markdown note-taking application with zero-knowledge encryption.

---

## Current State Summary

| Area | Current State |
|---|---|
| Title | `bpad` |
| Meta description | none |
| Canonical | none |
| Robots meta | `noindex, nofollow` (global — blocks all indexing) |
| robots.txt | Allows `/` and `/assets/`; no sitemap declared |
| sitemap.xml | missing |
| Structured data | none |
| Open Graph / Twitter | none |
| H1 | `bpad` (not descriptive) |
| Initial HTML content | empty `<div id="root">` — all copy requires JS |
| Public SEO pages | none |
| Private route protection | client-side auth only; robots.txt supplements |

---

## Rendering Constraint

The application is a Vite/React SPA. All page content is rendered client-side after JS boots. This means:

- Before this change: crawlers receive an empty HTML shell — meaningless for text understanding.
- After this change: the public landing and SEO pages must have meaningful content in the initial HTML **without requiring JavaScript execution**.

The chosen approach is to generate lightweight static HTML files for each public URL from a build script, embedding real product copy. The SPA continues to serve as the authenticated application. This avoids SSR/framework migration while giving crawlers real text.

### What "static HTML" means here

- A small Node.js build script (`scripts/generate-seo-pages.js`) generates static HTML files into `dist/` **after** the normal Vite build.
- Each static file is placed at the route's canonical path: `dist/private-notes/index.html`, etc.
- These files contain the real product copy, semantic HTML (`h1`/`h2`/`h3`), metadata, canonical, OG, JSON-LD.
- They also include the Vite JS entry point so the React app still hydrates — the visitor gets the full SPA immediately on load.
- The Azure SWA fallback (`navigationFallback`) rewrites unknown paths to `/index.html`, but any real file at a path takes precedence, so the static files are served directly.

---

## Public URLs to Index

| URL | Purpose |
|---|---|
| `https://bpad.pro/` | Homepage / landing |
| `https://bpad.pro/private-notes` | Focus page: private notes, privacy model |
| `https://bpad.pro/encrypted-notes` | Focus page: zero-knowledge encryption |
| `https://bpad.pro/markdown-notes` | Focus page: Markdown editor, features |
| `https://bpad.pro/developer-notes` | Focus page: code blocks, Markdown, links, privacy for devs |

### Excluded from sitemap (noindexed or auth-gated)

- `/notes/*` (user note content)
- `/account` (private account management)
- `/restore` (import utility, not a content destination)
- `/verify` (email verification callback)
- `/share` (Android PWA share target)
- Catch-all URL capture paths (e.g. `/https://example.com`)

---

## Changes

### 1. `frontend/index.html` — homepage metadata

Replace the global `noindex, nofollow` with proper homepage metadata.

- Title: `Private Markdown Notes – Secure, Encrypted Online Notebook | bpad`
- Description: A natural description covering private notes, Markdown, zero-knowledge encryption, tags, search, offline access, and backups. ~155 chars.
- Canonical: `https://bpad.pro/`
- Open Graph: `og:title`, `og:description`, `og:url`, `og:type: website`, `og:image`
- Twitter: `twitter:card: summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`
- JSON-LD: `WebApplication` / `SoftwareApplication` describing bpad.
- Remove `<meta name="robots" content="noindex, nofollow" />`.

**JSON-LD (on homepage)**

```json
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
```

No fake ratings, reviews, awards, or testimonials.

### 2. Static public SEO page content

Each public SEO page gets a real React component (`frontend/src/seo/`) that renders server-appropriate HTML. The static HTML generator renders these to `dist/<slug>/index.html`.

Each page:
- Has exactly one `<h1>` describing the primary topic.
- Uses `<h2>` for sections.
- Contains factual product copy drawn from `featuresData.ts` where applicable.
- Has page-specific canonical, title, description, OG, Twitter, JSON-LD (reuses homepage JSON-LD).
- Has a link back to the homepage and links to sibling SEO pages (internal linking).
- Has a clear CTA linking to `/#login` and `/#register` (the landing CTAs).

**Copy must be genuine:** reuse or paraphrase the actual `featuresData.ts` feature descriptions. Do not introduce claims not visible on the site.

#### `/private-notes`
- H1: `Private Notes That Only You Can Read`
- Explains: browser-side encryption, server-zero-knowledge model, recovery code, no server access to content.

#### `/encrypted-notes`
- H1: `Zero-Knowledge Encrypted Notes`
- Explains: Argon2id key derivation, AES-256-GCM, HKDF, keys never leave browser, server stores only ciphertext, recovery code, biometric unlock.

#### `/markdown-notes`
- H1: `Markdown Notes with Images, Tags, and Full-Text Search`
- Explains: Markdown editor, rendered preview, auto-title from heading, tags, images, sorting, full-text search, backup, offline.

#### `/developer-notes`
- H1: `Encrypted Markdown Notes for Developers`
- Explains: code blocks, Markdown tables and lists, links, per-note URLs, zero-knowledge encryption, offline, PWA, backup.

### 3. `frontend/public/robots.txt`

Updated to:
- Allow all public SEO pages and assets.
- Disallow `/notes/`, `/account`, `/verify`, `/restore`, `/share`, and catch-all captured URLs.
- Declare sitemap URL.
- Remove the `Allow: /$` constraint (keep the landing indexable AND allow new public paths).

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

The homepage is implicitly allowed since only `/` with no wildcard disallows it. Avoid `Allow: /$` — the trailing `$` is not standard and varies across crawler implementations.

**Security note:** robots.txt is a hint only. The actual security boundary is the authentication system. Private note content is encrypted at rest and inaccessible server-side regardless.

### 4. `frontend/public/sitemap.xml`

Static sitemap with the five public URLs, `lastmod` set to build date, `changefreq` and `priority` optional.

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

### 5. Social preview image

Use existing `frontend/public/icon-512.png` as the OG/Twitter image for now. No new visual identity required. The `og:image` URL is `https://bpad.pro/icon-512.png`.

The existing icon is the bpad mark (notebook with lock) which represents the brand. It is not ideal for social preview (it will be square and small), but it is real, already deployed, and avoids adding new assets. This is a known limitation.

### 6. Private route noindex protection

Remove the global `noindex, nofollow` and instead protect private/utility routes.

Implementation: in `staticwebapp.config.json`, add route-specific response headers for auth-gated or utility paths:

```json
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
]
```

This uses the HTTP `X-Robots-Tag` header, which is authoritative and not dependent on what the SPA renders. The routes section in `staticwebapp.config.json` can coexist with `navigationFallback`.

### 7. SEO page build script

`frontend/scripts/generate-seo-pages.js` — a Node.js script run after `npm run build`:

- Reads the SEO page definitions.
- Generates `dist/private-notes/index.html`, `dist/encrypted-notes/index.html`, `dist/markdown-notes/index.html`, `dist/developer-notes/index.html`.
- Each file contains: `<!doctype html>`, full `<head>` with metadata, semantic body content (headings, paragraphs, internal links), and the same `<script type="module">` entry point as `dist/index.html` so the SPA hydrates.
- Updates `dist/index.html` with the full homepage metadata (replaces the bare `index.html` head with the SEO-ready version).

The `npm run build` script in `package.json` becomes `tsc -b && vite build && node scripts/generate-seo-pages.js`.

### 8. `frontend/public/icon-512.png` as OG image

No change required to the icon. The URL `https://bpad.pro/icon-512.png` is referenced in OG metadata.

---

## What is not changed

- Authentication system.
- Encryption/key derivation.
- PWA manifest or service worker behavior.
- Offline functionality.
- Any private/note/account routes.
- App layout or CSS.
- i18n system.
- Azure infrastructure outside `staticwebapp.config.json` route headers.

---

## Validation Checklist

After implementation:

1. `npm run build` passes without errors.
2. `npm run test` passes.
3. `npm run lint` passes.
4. `dist/index.html` contains: correct title, description, canonical, og:title, og:description, og:image, twitter tags, JSON-LD, no `noindex`.
5. `dist/private-notes/index.html` exists with h1, h2s, canonical, metadata.
6. `dist/encrypted-notes/index.html` same.
7. `dist/markdown-notes/index.html` same.
8. `dist/developer-notes/index.html` same.
9. `dist/sitemap.xml` contains exactly 5 URLs, all `https://bpad.pro/...`.
10. `dist/robots.txt` declares sitemap, disallows private routes, allows public SEO paths.
11. JSON-LD validates (paste into schema.org validator).
12. No authenticated/private content appears in any static HTML.
13. Internal links between SEO pages are correct (href values point to real pages).

---

## Search Console Readiness

After deployment, submit to Google Search Console:
- Sitemap: `https://bpad.pro/sitemap.xml`
- Inspect URLs: `/`, `/private-notes`, `/encrypted-notes`, `/markdown-notes`, `/developer-notes`
- Monitor: indexed page count, search queries, mobile usability.

---

## Primary Search Intents Targeted

- private notes
- encrypted notes
- Markdown notes
- secure notes
- developer notes
- zero-knowledge notes
- note-taking app with encryption
- privacy-focused note-taking
