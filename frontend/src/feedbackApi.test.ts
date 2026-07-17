import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendFeedback, FEEDBACK_MAX_LENGTH } from './feedbackApi'

function mockFetch(status: number) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendFeedback', () => {
  it('posts the message as JSON', async () => {
    const fetchMock = mockFetch(201)
    await sendFeedback('the editor is great')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ message: 'the editor is great' })
  })

  it('resolves on 201', async () => {
    mockFetch(201)
    await expect(sendFeedback('hello')).resolves.toBeUndefined()
  })

  it('reports rate limiting distinctly from a generic failure', async () => {
    mockFetch(429)
    await expect(sendFeedback('hello')).rejects.toThrow(/wait a few minutes/)
  })

  it('throws on a server error', async () => {
    mockFetch(500)
    await expect(sendFeedback('hello')).rejects.toThrow(/Could not send feedback/)
  })

  it('translates a network failure instead of leaking the raw browser error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = await sendFeedback('hello').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toMatch(/Failed to fetch/)
    expect(err.message).toMatch(/offline/i)
  })

  it('exposes the server’s length limit', () => {
    expect(FEEDBACK_MAX_LENGTH).toBe(4000)
  })
})
