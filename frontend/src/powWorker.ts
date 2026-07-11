// Web Worker: vyřeší PoW mimo hlavní vlákno a pošle výsledek zpět.
// Chybu (např. vyčerpaný strop pokusů) hlásíme zprávou – async throw ve
// workeru nespustí worker.onerror, tak by solvePow jinak zůstal viset.
import { findNonce, type PowResult } from './pow'

self.onmessage = async (e: MessageEvent<{ challenge: string; difficulty: number }>) => {
  const { challenge, difficulty } = e.data
  const post = (r: PowResult) => (self as unknown as Worker).postMessage(r)
  try {
    post({ nonce: await findNonce(challenge, difficulty) })
  } catch (err) {
    post({ error: err instanceof Error ? err.message : 'Ověření proti robotům selhalo' })
  }
}
