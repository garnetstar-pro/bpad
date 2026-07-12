import { describe, it, expect } from 'vitest'
import { extractUrl } from './captureUrl'

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

describe('extractUrl', () => {
  it('pulls a plain https URL out of the path', () => {
    expect(extractUrl(loc('/https://test.cz'))).toBe('https://test.cz')
  })

  it('supports http too', () => {
    expect(extractUrl(loc('/http://example.com'))).toBe('http://example.com')
  })

  it('keeps the target query and hash (they land in search/hash)', () => {
    expect(extractUrl(loc('/https://test.cz/', '?q=a&b=c', '#sec'))).toBe(
      'https://test.cz/?q=a&b=c#sec',
    )
  })

  it('repairs a collapsed scheme slash (https:/ → https://)', () => {
    expect(extractUrl(loc('/https:/test.cz'))).toBe('https://test.cz')
  })

  it('decodes percent-encoding', () => {
    expect(extractUrl(loc('/https://test.cz/a%20b'))).toBe('https://test.cz/a b')
  })

  it('returns null for the app’s own routes', () => {
    expect(extractUrl(loc('/'))).toBeNull()
    expect(extractUrl(loc('/notes/123'))).toBeNull()
    expect(extractUrl(loc('/account'))).toBeNull()
  })
})
