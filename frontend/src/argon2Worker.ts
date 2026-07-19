// Web Worker: runs the Argon2id KDF off the main thread and posts the derived
// master key back, tagged with the request id. Errors travel as a message
// rather than a throw — an async throw in a worker doesn't trigger onerror,
// which would leave the caller's promise hanging forever.
import { argon2Direct, type Argon2Request, type Argon2Response } from './argon2'
import { translate } from './i18n/translate'

self.onmessage = async (e: MessageEvent<Argon2Request>) => {
  const { id, password, salt } = e.data
  const post = (r: Argon2Response) => (self as unknown as Worker).postMessage(r)
  try {
    post({ id, key: await argon2Direct(password, salt) })
  } catch (err) {
    post({
      id,
      error: err instanceof Error ? err.message : translate('errors.keyDerivationFailed'),
    })
  }
}
