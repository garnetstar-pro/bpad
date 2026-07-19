// Argon2id key derivation, kept off the main thread.
//
// The derivation is deliberately expensive (~275 ms on a desktop, over a second
// on a phone). On the main thread that froze the whole UI for the duration —
// the spinner did not even animate while the user waited to be let in — so it
// runs in a Web Worker instead. That does not make it faster; it makes the app
// stay responsive while it happens.
import { argon2id } from 'hash-wasm'
import { translate } from './i18n/translate'

// Argon2id parameters. NOT tunable after the fact: the same password and salt
// with different parameters derive a different key, so lowering these would
// lock every existing account out. Changing them needs versioned parameters
// stored per user.
const ARGON2 = { parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32 } as const

export interface Argon2Request {
  id: number
  password: string
  salt: Uint8Array
}

export type Argon2Response = { id: number; key: Uint8Array } | { id: number; error: string }

export type PendingArgon2 = Map<
  number,
  { resolve: (key: Uint8Array) => void; reject: (err: Error) => void }
>

// Runs the KDF on whatever thread calls it. The worker calls this; the main
// thread only falls back to it where Worker is unavailable (tests, and any
// browser without module workers).
export function argon2Direct(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    parallelism: ARGON2.parallelism,
    iterations: ARGON2.iterations,
    memorySize: ARGON2.memorySize,
    hashLength: ARGON2.hashLength,
    outputType: 'binary',
  })
}

// Routes a worker message back to the caller that is waiting on it. Split out
// as a pure function so the routing is testable without a Worker.
export function resolveArgon2Response(pending: PendingArgon2, msg: Argon2Response): void {
  const entry = pending.get(msg.id)
  if (!entry) return // already settled, or left over from a worker we discarded
  pending.delete(msg.id)
  if ('error' in msg) entry.reject(new Error(msg.error))
  else entry.resolve(msg.key)
}

// One worker for the whole session, created lazily. Instantiating the WASM
// module costs ~230 ms, and register()/recover() derive twice in a row — a
// worker per call (the way solvePow does it) would pay that twice.
const pending: PendingArgon2 = new Map()
let worker: Worker | null = null
let nextId = 1

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker

  worker = new Worker(new URL('./argon2Worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<Argon2Response>) => resolveArgon2Response(pending, e.data)
  worker.onerror = () => {
    // The worker itself died, so nothing will ever answer the in-flight
    // requests. Fail them and drop the worker so the next call builds a new one.
    const orphaned = [...pending.values()]
    pending.clear()
    worker?.terminate()
    worker = null
    for (const p of orphaned) p.reject(new Error(translate('errors.keyDerivationFailed')))
  }
  return worker
}

export function deriveMasterKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const w = getWorker()
  if (!w) return argon2Direct(password, salt)

  return new Promise<Uint8Array>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    w.postMessage({ id, password, salt } satisfies Argon2Request)
  })
}
