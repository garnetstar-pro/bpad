import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { parseImageIds, fitDimensions, uploadImage, resolveImageUrl, processImage, MAX_INPUT_BYTES } from './images'
import { setSession, clearSession } from './session'

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

// session.ts reads no DOM; only a data key + token are needed.
function withSession() {
  setSession('tok', new Uint8Array(32), new Uint8Array(32), 'alice')
}

describe('uploadImage', () => {
  afterEach(() => { clearSession(); vi.restoreAllMocks() })

  it('inits the upload then PUTs the blob and returns the id', async () => {
    withSession()
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (String(url).endsWith('/api/images')) {
        return { ok: true, json: async () => ({ image_id: 'img1', upload_url: 'https://blob/put' }) } as Response
      }
      return { ok: true } as Response // the PUT to blob storage
    })
    vi.stubGlobal('fetch', fetchMock)

    const id = await uploadImage(new Blob(['x'], { type: 'image/webp' }))

    expect(id).toBe('img1')
    expect(calls[0]).toContain('POST http://localhost:7071/api/images')
    expect(calls[1]).toBe('PUT https://blob/put')
  })
})

describe('resolveImageUrl', () => {
  afterEach(() => { clearSession(); vi.restoreAllMocks() })

  it('fetches a read url once and caches it', async () => {
    withSession()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://blob/read?sas' }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    const a = await resolveImageUrl('imgX')
    const b = await resolveImageUrl('imgX')

    expect(a).toBe('https://blob/read?sas')
    expect(b).toBe('https://blob/read?sas')
    expect(fetchMock).toHaveBeenCalledTimes(1) // second call served from cache
  })
})

describe('processImage', () => {
  it('rejects input over the hard cap without touching a canvas', async () => {
    const big = { size: MAX_INPUT_BYTES + 1, type: 'image/png' } as Blob
    await expect(processImage(big)).rejects.toThrow('too-large')
  })
})
