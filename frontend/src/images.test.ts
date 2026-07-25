import { describe, it, expect } from 'vitest'
import { parseImageIds, fitDimensions } from './images'

describe('parseImageIds', () => {
  it('finds every bpad-img reference and dedups', () => {
    const md = 'a ![](bpad-img:aaa) b ![alt](bpad-img:bbb) c ![](bpad-img:aaa)'
    expect(parseImageIds(md).sort()).toEqual(['aaa', 'bbb'])
  })

  it('ignores normal images and links', () => {
    const md = '![pic](https://x/y.png) [link](bpad-img:not-an-image)'
    expect(parseImageIds(md)).toEqual([])
  })

  it('returns empty for content without images', () => {
    expect(parseImageIds('just text')).toEqual([])
  })
})

describe('fitDimensions', () => {
  it('never upscales a small image', () => {
    expect(fitDimensions(800, 600, 1600)).toEqual({ w: 800, h: 600 })
  })

  it('scales the longest edge down to max, keeping aspect', () => {
    expect(fitDimensions(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 })
  })

  it('handles a tall image', () => {
    expect(fitDimensions(1000, 4000, 1600)).toEqual({ w: 400, h: 1600 })
  })
})
