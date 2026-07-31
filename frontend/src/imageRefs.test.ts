import { describe, it, expect } from 'vitest'
import {
  parseImageIds,
  rewriteImageRefs,
  normalizeImageRefs,
  localizeImageRefs,
} from './imageRefs'

describe('parseImageIds', () => {
  it('finds every reference and dedups', () => {
    const md = 'a ![](bpad-img:aaa) b ![alt](bpad-img:bbb) c ![](bpad-img:aaa)'
    expect(parseImageIds(md).sort()).toEqual(['aaa', 'bbb'])
  })

  it('ignores plain images and links', () => {
    expect(parseImageIds('![p](https://x/y.png) [l](bpad-img:nope)')).toEqual([])
  })
})

describe('rewriteImageRefs', () => {
  it('swaps ids listed in the map', () => {
    const map = new Map([['old', 'new']])
    expect(rewriteImageRefs('![a](bpad-img:old)', map)).toBe('![a](bpad-img:new)')
  })

  it('leaves an id that is not in the map alone', () => {
    expect(rewriteImageRefs('![](bpad-img:gone)', new Map())).toBe('![](bpad-img:gone)')
  })

  it('rewrites every occurrence, including repeats of the same id', () => {
    const map = new Map([['a', 'x']])
    expect(rewriteImageRefs('![](bpad-img:a) ![](bpad-img:a)', map)).toBe(
      '![](bpad-img:x) ![](bpad-img:x)',
    )
  })

  it('does not touch anything outside the scheme', () => {
    const md = 'see [bpad-img:a](http://x) and ![](https://y/z.png)'
    expect(rewriteImageRefs(md, new Map([['a', 'x']]))).toBe(md)
  })
})

describe('normalizeImageRefs', () => {
  it('numbers references by first appearance', () => {
    expect(normalizeImageRefs('![](bpad-img:zzz) ![](bpad-img:aaa)')).toBe(
      '![](bpad-img:#1) ![](bpad-img:#2)',
    )
  })

  it('gives the same id the same number every time', () => {
    expect(normalizeImageRefs('![](bpad-img:a) ![](bpad-img:b) ![](bpad-img:a)')).toBe(
      '![](bpad-img:#1) ![](bpad-img:#2) ![](bpad-img:#1)',
    )
  })

  it('makes two texts that differ only in ids identical', () => {
    const before = '# R\n![](bpad-img:old-1)'
    const after = '# R\n![](bpad-img:new-1)'
    expect(normalizeImageRefs(before)).toBe(normalizeImageRefs(after))
  })

  it('leaves text without images untouched', () => {
    expect(normalizeImageRefs('plain note')).toBe('plain note')
  })
})

describe('localizeImageRefs', () => {
  it('replaces the scheme with a plain path', () => {
    const paths = new Map([['a', '../images/a.webp']])
    expect(localizeImageRefs('![alt](bpad-img:a)', paths)).toBe('![alt](../images/a.webp)')
  })

  it('leaves an id with no path alone', () => {
    expect(localizeImageRefs('![](bpad-img:a)', new Map())).toBe('![](bpad-img:a)')
  })
})
