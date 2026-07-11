// Proof-of-work řešitel (anti-bot brzda registrace). Hledá nonce tak, aby
// SHA-256(challenge+nonce) mělo aspoň `difficulty` úvodních nulových bitů.
// Náročné hledání běží ve Web Workeru, ať neztuhne UI; ověření na serveru
// je jeden hash.
import { createSHA256 } from 'hash-wasm'

export function countLeadingZeroBits(bytes: Uint8Array): number {
  let bits = 0
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += 8 - (32 - Math.clz32(byte)) // 8 - bitová délka bajtu
    break
  }
  return bits
}

// Tight loop – blokuje vlákno (proto se pouští ve workeru). Testovatelné přímo.
export async function findNonce(challenge: string, difficulty: number): Promise<string> {
  if (difficulty <= 0) return '0'
  const hasher = await createSHA256()
  const enc = new TextEncoder()
  for (let nonce = 0; ; nonce++) {
    hasher.init()
    hasher.update(enc.encode(challenge + nonce))
    const digest = hasher.digest('binary')
    if (countLeadingZeroBits(digest) >= difficulty) return String(nonce)
  }
}

// Veřejné API: vyřeší ve Web Workeru.
export function solvePow(challenge: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<string>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = () => {
      reject(new Error('Ověření proti robotům selhalo'))
      worker.terminate()
    }
    worker.postMessage({ challenge, difficulty })
  })
}
