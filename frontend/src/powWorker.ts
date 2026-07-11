// Web Worker: vyřeší PoW mimo hlavní vlákno a pošle nalezený nonce zpět.
import { findNonce } from './pow'

self.onmessage = async (e: MessageEvent<{ challenge: string; difficulty: number }>) => {
  const { challenge, difficulty } = e.data
  const nonce = await findNonce(challenge, difficulty)
  ;(self as unknown as Worker).postMessage(nonce)
}
