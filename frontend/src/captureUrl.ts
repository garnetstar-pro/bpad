// Vytáhne cílovou URL z adresy typu dev.bpad.pro/https://test.cz.
// Cíl může mít vlastní query a hash – ty prohlížeč naparsuje jako search/hash
// naší stránky, takže je sem přidáme zpět. Vrací null, když to není URL
// (běžné routy appky).
export function extractUrl(loc: {
  pathname: string
  search: string
  hash: string
}): string | null {
  let raw = loc.pathname.replace(/^\/+/, '') + loc.search + loc.hash
  // Některé prohlížeče/proxy sloučí "https://" v cestě na "https:/" – doplň zpět.
  raw = raw.replace(/^(https?):\/(?!\/)/i, '$1://')
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // rozbité percent-enkódování – ponech, jak přišlo
  }
  return /^https?:\/\//i.test(raw) ? raw : null
}
