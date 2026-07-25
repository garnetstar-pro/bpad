import { describe, it, expect } from 'vitest'
import { bpadUrlTransform } from './markdown'

describe('bpadUrlTransform', () => {
  it('preserves bpad-img references untouched', () => {
    expect(bpadUrlTransform('bpad-img:abc-123')).toBe('bpad-img:abc-123')
  })
  it('passes http(s) urls through', () => {
    expect(bpadUrlTransform('https://example.com/x.png')).toBe('https://example.com/x.png')
  })
  it('sanitizes disallowed protocols like the default (javascript:)', () => {
    expect(bpadUrlTransform('javascript:alert(1)')).toBe('')
  })
})
