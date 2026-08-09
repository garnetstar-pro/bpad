import { describe, it, expect } from 'vitest'
import { translate, setActiveLocale } from './index'

describe('translate', () => {
  it('resolves a nested dot-path key', () => {
    expect(translate('common.save')).toBe('Save')
  })

  it('interpolates {params}', () => {
    // editor.saveHint = 'or click “{label}”' — the key combo moved out of the
    // string into a <kbd> chip (KeyHint), the interpolation is what matters here.
    expect(translate('editor.saveHint', { label: 'File it' })).toBe('or click “File it”')
  })

  it('returns the key itself when missing', () => {
    expect(translate('does.not.exist')).toBe('does.not.exist')
  })

  it('follows the active locale set via setActiveLocale', () => {
    setActiveLocale('en')
    expect(translate('common.cancel')).toBe('Cancel')
  })
})
