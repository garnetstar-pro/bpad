// Proof-of-work solver (anti-bot brake on registration). Looks for a nonce
// such that SHA-256(challenge+nonce) has at least `difficulty` leading zero
// bits. The heavy search runs in a Web Worker so the UI doesn't stall;
// verification on the server is a single hash.
import { createSHA256 } from 'hash-wasm'
import { translate } from './i18n'

export function countLeadingZeroBits(bytes: Uint8Array): number {
  let bits = 0
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += 8 - (32 - Math.clz32(byte)) // 8 - bit length of the byte
    break
  }
  return bits
}

// Upper cap on attempts (~20x the average for difficulty 20). Guards against
// getting stuck on unlucky variance or a misconfigured (too high) difficulty.
const MAX_ATTEMPTS = 20_000_000

// Tight loop – blocks the thread (hence run in a worker). Directly testable.
// Once maxAttempts is exhausted it gives up with an error rather than
// spinning forever.
export async function findNonce(
  challenge: string,
  difficulty: number,
  maxAttempts = MAX_ATTEMPTS,
): Promise<string> {
  if (difficulty <= 0) return '0'
  const hasher = await createSHA256()
  const enc = new TextEncoder()
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    hasher.init()
    hasher.update(enc.encode(challenge + nonce))
    const digest = hasher.digest('binary')
    if (countLeadingZeroBits(digest) >= difficulty) return String(nonce)
  }
  throw new Error(translate('errors.powTimeout'))
}

// Message from the worker: either the found nonce, or an error (e.g. the cap was exhausted).
export type PowResult = { nonce: string } | { error: string }

// Public API: solves it in a Web Worker.
export function solvePow(challenge: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<PowResult>) => {
      const data = e.data
      if ('error' in data) reject(new Error(data.error))
      else resolve(data.nonce)
      worker.terminate()
    }
    worker.onerror = () => {
      reject(new Error(translate('errors.powFailed')))
      worker.terminate()
    }
    worker.postMessage({ challenge, difficulty })
  })
}
