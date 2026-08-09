// Turns an Android share into the markdown of a new note.
//
// The manifest registers /share as a GET share_target (vite.config.ts), so the
// payload arrives as query parameters. Android has no convention for which one
// carries the link: Chrome fills `url`, while plenty of apps (Reddit, X,
// YouTube) put everything in `text` — sometimes as "Some title https://link".
// Trusting `url` alone loses the link on half the shares, so `text` is mined
// for one too.
//
// Pure on purpose (no network, no UI), like captureUrl.ts next door.

export interface SharePayload {
  title?: string | null
  text?: string | null
  url?: string | null
}

// Trailing punctuation is far more likely to be the sentence's than the URL's.
const URL_RE = /https?:\/\/[^\s<>"']+/i
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/

function firstUrl(text: string): string | null {
  const match = text.match(URL_RE)
  if (!match) return null
  return match[0].replace(TRAILING_PUNCT, '')
}

const clean = (v: string | null | undefined) => (v ?? '').trim()

export interface SharedNote {
  content: string
  url: string | null
}

// Returns null when the share carried nothing usable — an empty payload means
// the route should just fall back to the home page rather than file a blank note.
export function buildSharedNote(payload: SharePayload): SharedNote | null {
  const title = clean(payload.title)
  let body = clean(payload.text)

  // An explicit `url` wins; otherwise mine the text for one.
  let url = clean(payload.url)
  if (!URL_RE.test(url)) url = ''
  const fromText = url ? null : firstUrl(body)
  if (fromText) url = fromText

  // Whichever field the link came from, it shouldn't appear twice in the note.
  if (url && body.includes(url)) body = body.replace(url, '').trim()

  // Some apps send the page title in both `title` and `text`; keep it as the
  // heading and drop the echo. Others put the bare link in `title`, where it
  // would just repeat the url line below.
  let heading = title
  if (heading && heading === body) body = ''
  if (heading && heading === url) heading = ''

  const parts: string[] = []
  // The first ATX heading becomes the note's title (titles.ts), so a shared
  // page arrives already named instead of showing a raw URL as its title.
  if (heading) parts.push(`# ${heading}`)
  if (url) parts.push(url)
  if (body) parts.push(body)

  if (!parts.length) return null
  return { content: parts.join('\n\n'), url: url || null }
}
