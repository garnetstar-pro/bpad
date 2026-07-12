import { describe, it, expect } from 'vitest'
import { translate, setActiveLocale } from './index'

describe('translate', () => {
  it('resolves a nested dot-path key', () => {
    expect(translate('common.save')).toBe('Save')
  })

  it('interpolates {params}', () => {
    // editor.saveHint = 'ctrl+enter or click “{label}”'
    expect(translate('editor.saveHint', { label: 'File it' })).toBe(
      'ctrl+enter or click “File it”',
    )
  })

  it('returns the key itself when missing', () => {
    expect(translate('does.not.exist')).toBe('does.not.exist')
  })

  it('follows the active locale set via setActiveLocale', () => {
    setActiveLocale('en')
    expect(translate('common.cancel')).toBe('Cancel')
  })
})
