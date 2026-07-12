// Web Worker: solves the PoW off the main thread and posts the result back.
// We report an error (e.g. attempt cap exhausted) via a message – an async
// throw in the worker doesn't trigger worker.onerror, so solvePow would
// otherwise hang forever.
import { findNonce, type PowResult } from './pow'
import { translate } from './i18n'

self.onmessage = async (e: MessageEvent<{ challenge: string; difficulty: number }>) => {
  const { challenge, difficulty } = e.data
  const post = (r: PowResult) => (self as unknown as Worker).postMessage(r)
  try {
    post({ nonce: await findNonce(challenge, difficulty) })
  } catch (err) {
    post({ error: err instanceof Error ? err.message : translate('errors.powFailed') })
  }
}
