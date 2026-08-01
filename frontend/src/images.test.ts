import { describe, it, expect, afterEach, vi } from 'vitest'
import { parseImageIds, fitDimensions, uploadImage, resolveImageUrl, processImage, MAX_INPUT_BYTES, downloadImage, UploadRateLimited, clearImageUrlCache, loadImage } from './images'
import { setSession, clearSession } from './session'
import { sealBytes, openBytes, toArrayBuffer } from './crypto'

// Distinguishable from the auth key so a test that accidentally seals/opens
// with the wrong key fails loudly instead of passing by coincidence.
const DATA_KEY = new Uint8Array(32).fill(7)
const AUTH_KEY = new Uint8Array(32).fill(3)

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

// session.ts reads no DOM; only a data key + token are needed. The data key
// and auth key are deliberately different byte patterns (see DATA_KEY /
// AUTH_KEY above) so a regression that seals or opens with the wrong one
// fails a test instead of passing unnoticed.
function withSession() {
  setSession('tok', DATA_KEY, AUTH_KEY, 'alice')
}

describe('uploadImage', () => {
  afterEach(() => { clearSession(); vi.restoreAllMocks() })

  it('inits the upload then PUTs the sealed blob and returns the id', async () => {
    withSession()
    const calls: string[] = []
    let posted: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (String(url).endsWith('/api/images')) {
        posted = JSON.parse(String(init?.body))
        return { ok: true, json: async () => ({ image_id: 'img1', upload_url: 'https://blob/put' }) } as Response
      }
      return { ok: true } as Response // the PUT to blob storage
    })
    vi.stubGlobal('fetch', fetchMock)

    const id = await uploadImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }))

    expect(id).toBe('img1')
    expect(calls[0]).toContain('POST http://localhost:7071/api/images')
    expect(calls[1]).toBe('PUT https://blob/put')
    // The server is told nothing about the picture: 12-byte IV + 3 bytes + 16-byte tag.
    expect(posted).toEqual({ content_type: 'application/octet-stream', size_bytes: 31 })
  })

  it('uploads ciphertext, not the picture', async () => {
    withSession()
    const plaintext = new Uint8Array([10, 20, 30, 40])
    let uploaded = new Uint8Array()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/images')) {
        return { ok: true, json: async () => ({ image_id: 'img1', upload_url: 'https://blob/put' }) } as Response
      }
      uploaded = new Uint8Array(init?.body as ArrayBuffer)
      return { ok: true } as Response
    }))

    await uploadImage(new Blob([plaintext], { type: 'image/webp' }))

    expect(uploaded.length).toBe(plaintext.length + 28)
    // Proves the right key sealed the right bytes, not just that the raw
    // ciphertext happens to differ from the plaintext.
    await expect(openBytes(uploaded, DATA_KEY)).resolves.toEqual(plaintext)
  })

  it('refuses to upload without a data key', async () => {
    clearSession()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response))
    await expect(uploadImage(new Blob([new Uint8Array([1])]))).rejects.toThrow(/locked/i)
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
    clearSession()
  })

  // The same distinguishable data key withSession() installs.
  const key = DATA_KEY

  async function serving(sealed: Uint8Array) {
    return vi.fn(async (input: string) =>
      input.endsWith('/url')
        ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
        : ({ ok: true, arrayBuffer: async () => sealed.buffer } as never),
    )
  }

  it('opens the sealed bytes and reports image/webp', async () => {
    withSession()
    const picture = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal('fetch', await serving(await sealBytes(picture, key)))

    await expect(downloadImage('pic-1')).resolves.toEqual({
      bytes: picture,
      contentType: 'image/webp',
    })
  })

  it('rejects bytes that were not sealed with this key', async () => {
    withSession()
    vi.stubGlobal('fetch', await serving(await sealBytes(new Uint8Array([1]), new Uint8Array(32).fill(9))))
    await expect(downloadImage('pic-2')).rejects.toThrow()
  })

  it('rejects a blob that is not sealed at all', async () => {
    withSession()
    vi.stubGlobal('fetch', await serving(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])))
    await expect(downloadImage('pic-3')).rejects.toThrow()
  })

  it('throws when the blob cannot be fetched', async () => {
    withSession()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/url')
          ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
          : ({ ok: false, status: 404 } as never),
      ),
    )
    await expect(downloadImage('pic-4')).rejects.toThrow(/download/i)
  })

  it('refuses to download without a data key', async () => {
    clearSession()
    await expect(downloadImage('pic-5')).rejects.toThrow(/locked/i)
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

describe('loadImage', () => {
  const key = DATA_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    clearImageUrlCache()
    clearSession()
  })

  async function stubTransport(picture: Uint8Array) {
    const sealed = await sealBytes(picture, key)
    const fetchMock = vi.fn(async (input: string) =>
      input.endsWith('/url')
        ? ({ ok: true, json: async () => ({ url: `https://blob/x?sas=${Math.random()}` }) } as never)
        : ({ ok: true, arrayBuffer: async () => sealed.buffer } as never),
    )
    vi.stubGlobal('fetch', fetchMock)
    let made = 0
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:made-${++made}`),
      revokeObjectURL: vi.fn(),
    })
    return fetchMock
  }

  it('downloads once and serves the second call from the cache', async () => {
    withSession()
    const fetchMock = await stubTransport(new Uint8Array([1, 2, 3]))

    const first = await loadImage('pic-1')
    const second = await loadImage('pic-1')

    expect(first).toBe('blob:made-1')
    expect(second).toBe('blob:made-1')
    // One /url call and one blob GET, not two of each.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent requests for the same id into one download', async () => {
    withSession()
    const fetchMock = await stubTransport(new Uint8Array([4, 5, 6]))

    const [a, b] = await Promise.all([loadImage('pic-2'), loadImage('pic-2')])

    expect(a).toBe(b)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lets a failure be retried rather than caching it', async () => {
    withSession()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as never))
    await expect(loadImage('pic-3')).rejects.toThrow()
    await expect(loadImage('pic-3')).rejects.toThrow()
  })

  it('discards a download that finishes after the session was cleared, without leaking the object URL', async () => {
    withSession()
    const picture = new Uint8Array([7, 8, 9])
    const sealed = await sealBytes(picture, key)
    // Gate the blob GET so we control exactly when the download "lands",
    // after clearSession() has already run.
    let resolveBytes!: (buf: ArrayBuffer) => void
    const bytesPromise = new Promise<ArrayBuffer>((resolve) => {
      resolveBytes = resolve
    })
    const fetchMock = vi.fn(async (input: string) =>
      input.endsWith('/url')
        ? ({ ok: true, json: async () => ({ url: 'https://blob/x?sas' }) } as never)
        : ({ ok: true, arrayBuffer: () => bytesPromise } as never),
    )
    vi.stubGlobal('fetch', fetchMock)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mid-flight'), revokeObjectURL })

    const inFlight = loadImage('pic-cleared')
    clearSession() // logout/idle-lock mid-download: clears the cache via clearImageUrlCache()
    resolveBytes(toArrayBuffer(sealed))

    await expect(inFlight).rejects.toThrow()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mid-flight')

    // The discarded job must not have left a blob-cache entry behind: a fresh
    // request for the same id gets its own freshly created object URL, not
    // the one the discarded job leaked and revoked.
    withSession()
    const fetchMock2 = await stubTransport(picture)
    const url = await loadImage('pic-cleared')
    expect(url).toBe('blob:made-1')
    expect(url).not.toBe('blob:mid-flight')
    // The blob itself was re-fetched — proof there was no stale cache entry to serve from.
    expect(fetchMock2.mock.calls.some(([input]) => !String(input).endsWith('/url'))).toBe(true)
  })
})
