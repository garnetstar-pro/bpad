import { describe, it, expect } from 'vitest'
import { toWhatsApp } from './whatsapp'

describe('toWhatsApp', () => {
  it('headings become bold lines', () => {
    expect(toWhatsApp('# Title')).toBe('*Title*')
    expect(toWhatsApp('### Sub')).toBe('*Sub*')
  })

  it('bold ** or __ → *', () => {
    expect(toWhatsApp('a **bold** b')).toBe('a *bold* b')
    expect(toWhatsApp('a __bold__ b')).toBe('a *bold* b')
  })

  it('italic * → _ ; _ stays _', () => {
    expect(toWhatsApp('a *it* b')).toBe('a _it_ b')
    expect(toWhatsApp('a _it_ b')).toBe('a _it_ b')
  })

  it('bold + italic together', () => {
    expect(toWhatsApp('**b** and *i*')).toBe('*b* and _i_')
  })

  it('strikethrough ~~ → ~', () => {
    expect(toWhatsApp('~~gone~~')).toBe('~gone~')
  })

  it('links become "text (url)", or just the url when equal', () => {
    expect(toWhatsApp('[bpad](https://bpad.pro)')).toBe('bpad (https://bpad.pro)')
    expect(toWhatsApp('[https://x.io](https://x.io)')).toBe('https://x.io')
  })

  it('bullets → •', () => {
    expect(toWhatsApp('- one\n- two')).toBe('• one\n• two')
  })

  it('inline code loses its backticks', () => {
    expect(toWhatsApp('run `npm test` now')).toBe('run npm test now')
  })

  it('keeps fenced code blocks and does not mangle plain numbers', () => {
    const md = 'step 3 done\n\n```\ncode 5 here\n```'
    expect(toWhatsApp(md)).toBe('step 3 done\n\n```\ncode 5 here\n```')
  })
})
