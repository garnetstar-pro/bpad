// Extracts the target URL from an address like dev.bpad.pro/https://test.cz.
// The target can have its own query and hash – the browser parses those as
// our page's search/hash, so we add them back here. Returns null when it's
// not a URL (a normal app route).
export function extractUrl(loc: {
  pathname: string
  search: string
  hash: string
}): string | null {
  let raw = loc.pathname.replace(/^\/+/, '') + loc.search + loc.hash
  // Some browsers/proxies collapse "https://" in the path to "https:/" – restore it.
  raw = raw.replace(/^(https?):\/(?!\/)/i, '$1://')
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // broken percent-encoding – leave it as it came in
  }
  return /^https?:\/\//i.test(raw) ? raw : null
}
