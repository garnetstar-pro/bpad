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

// Horní strop pokusů (~20× průměr pro difficulty 20). Chrání před zaseknutím
// při nešťastné varianci nebo špatně nastavené (příliš vysoké) obtížnosti.
const MAX_ATTEMPTS = 20_000_000

// Tight loop – blokuje vlákno (proto se pouští ve workeru). Testovatelné přímo.
// Po vyčerpání maxAttempts to raději vzdá chybou, než aby se točilo donekonečna.
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
  throw new Error('Ověření trvá moc dlouho — zkus to znovu.')
}

// Zpráva z workeru: buď nalezený nonce, nebo chyba (např. vyčerpaný strop).
export type PowResult = { nonce: string } | { error: string }

// Veřejné API: vyřeší ve Web Workeru.
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
      reject(new Error('Ověření proti robotům selhalo'))
      worker.terminate()
    }
    worker.postMessage({ challenge, difficulty })
  })
}
