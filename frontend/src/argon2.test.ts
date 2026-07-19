import { describe, it, expect } from 'vitest'
import { resolveArgon2Response, type PendingArgon2 } from './argon2'

// One worker serves every derivation (re-instantiating the WASM module costs
// ~230 ms), so responses have to be routed back by request id.
describe('argon2 worker response routing', () => {
  const pendingWith = (ids: number[]) => {
    const pending: PendingArgon2 = new Map()
    const promises = ids.map(
      (id) =>
        new Promise<Uint8Array>((resolve, reject) => pending.set(id, { resolve, reject })),
    )
    return { pending, promises }
  }

  it('resolves only the request whose id matches', async () => {
    const { pending, promises } = pendingWith([1, 2])

    resolveArgon2Response(pending, { id: 1, key: new Uint8Array([1, 2, 3]) })

    await expect(promises[0]).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(pending.has(1)).toBe(false)
    expect(pending.has(2)).toBe(true) // the other derivation is still in flight
    void promises[1]
  })

  it('rejects the matching request on an error response', async () => {
    const { pending, promises } = pendingWith([7])

    resolveArgon2Response(pending, { id: 7, error: 'wasm blew up' })

    await expect(promises[0]).rejects.toThrow('wasm blew up')
    expect(pending.has(7)).toBe(false)
  })

  it('ignores a response for an id it no longer knows about', () => {
    const { pending, promises } = pendingWith([1])

    expect(() =>
      resolveArgon2Response(pending, { id: 99, key: new Uint8Array([9]) }),
    ).not.toThrow()
    expect(pending.has(1)).toBe(true)
    void promises[0]
  })
})
