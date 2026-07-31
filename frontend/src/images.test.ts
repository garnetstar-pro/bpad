import { describe, it, expect, afterEach, vi } from 'vitest'
import { parseImageIds, fitDimensions, uploadImage, resolveImageUrl, processImage, MAX_INPUT_BYTES, downloadImage, UploadRateLimited, clearImageUrlCache } from './images'
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

describe('downloadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearImageUrlCache()
  })

  it('resolves the read URL and returns the bytes with their content type', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    const bytes = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/url')) {
          return { ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never
        }
        return {
          ok: true,
          headers: new Headers({ 'Content-Type': 'image/webp' }),
          arrayBuffer: async () => bytes.buffer,
        } as never
      }),
    )
    await expect(downloadImage('pic-1')).resolves.toEqual({
      bytes,
      contentType: 'image/webp',
    })
    clearSession()
  })

  it('falls back to image/webp when the blob reports no content type', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/url')
          ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
          : ({
              ok: true,
              headers: new Headers(),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            } as never),
      ),
    )
    await expect(downloadImage('pic-2')).resolves.toMatchObject({ contentType: 'image/webp' })
    clearSession()
  })

  it('throws when the blob cannot be fetched', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/url')
          ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
          : ({ ok: false, status: 404 } as never),
      ),
    )
    await expect(downloadImage('pic-3')).rejects.toThrow(/download/i)
    clearSession()
  })
})

describe('uploadImage rate limiting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('throws UploadRateLimited on a 429', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 }) as never))
    await expect(uploadImage(new Blob([new Uint8Array([1])]))).rejects.toBeInstanceOf(
      UploadRateLimited,
    )
    clearSession()
  })

  it('throws a plain error on any other failure', async () => {
    setSession('token', new Uint8Array(32), new Uint8Array(32), 'jan')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as never))
    const err = await uploadImage(new Blob([new Uint8Array([1])])).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UploadRateLimited)
    clearSession()
  })
})
