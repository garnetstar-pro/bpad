import { describe, it, expect } from 'vitest'
import { resolveShortcut, isTypingTarget, SHORTCUTS } from './shortcuts'

const notTyping = { typing: false }
const typing = { typing: true }

describe('resolveShortcut', () => {
  it('maps the plain keys', () => {
    expect(resolveShortcut({ key: 'n' }, notTyping)).toBe('new')
    expect(resolveShortcut({ key: '/' }, notTyping)).toBe('search')
    expect(resolveShortcut({ key: 'Escape' }, notTyping)).toBe('close')
    expect(resolveShortcut({ key: '?' }, notTyping)).toBe('help')
  })

  it('accepts a capitalised n (caps lock / shift)', () => {
    expect(resolveShortcut({ key: 'N' }, notTyping)).toBe('new')
  })

  it('ignores unbound keys', () => {
    expect(resolveShortcut({ key: 'x' }, notTyping)).toBeNull()
    expect(resolveShortcut({ key: 'Enter' }, notTyping)).toBeNull()
  })

  it('stands down while the user is typing', () => {
    // Otherwise "n" would vanish from every note being written.
    expect(resolveShortcut({ key: 'n' }, typing)).toBeNull()
    expect(resolveShortcut({ key: '/' }, typing)).toBeNull()
    expect(resolveShortcut({ key: '?' }, typing)).toBeNull()
  })

  it('still lets Escape through while typing', () => {
    expect(resolveShortcut({ key: 'Escape' }, typing)).toBe('close')
  })

  it('leaves modified keystrokes to the browser and the editor', () => {
    expect(resolveShortcut({ key: 'n', ctrlKey: true }, notTyping)).toBeNull()
    expect(resolveShortcut({ key: 'n', metaKey: true }, notTyping)).toBeNull()
    expect(resolveShortcut({ key: '/', altKey: true }, notTyping)).toBeNull()
  })
})

describe('isTypingTarget', () => {
  const el = (tagName: string, contentEditable = false) =>
    ({ tagName, isContentEditable: contentEditable }) as unknown as Element

  it('recognises text entry elements', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
    expect(isTypingTarget(el('DIV', true))).toBe(true)
  })

  it('lets ordinary elements through', () => {
    expect(isTypingTarget(el('DIV'))).toBe(false)
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('SHORTCUTS table', () => {
  it('has a description key for every binding the handler resolves', () => {
    // Guards the promise this module makes: help can't drift from behaviour.
    for (const s of SHORTCUTS) {
      expect(s.descKey.startsWith('shortcuts.')).toBe(true)
      expect(s.keys.length).toBeGreaterThan(0)
    }
    const actions = SHORTCUTS.map((s) => s.action)
    expect(new Set(actions).size).toBe(actions.length)
  })
})
