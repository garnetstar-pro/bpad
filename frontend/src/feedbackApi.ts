// Sends user feedback to the API. Unlike notes, this message is NOT
// end-to-end encrypted - it is written for the app's owner to read.
import { getToken } from './session'
import { translate } from './i18n'

const FEEDBACK_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/feedback'
  : '/api/feedback'

// Mirrors the server's FeedbackRequest limit (api/models.py).
export const FEEDBACK_MAX_LENGTH = 4000

export async function sendFeedback(message: string): Promise<void> {
  const token = getToken()
  const res = await fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Auth-Token': token } : {}),
    },
    body: JSON.stringify({ message }),
  })
  if (res.status === 429) throw new Error(translate('errors.feedbackTooMany'))
  if (!res.ok) throw new Error(translate('errors.feedbackFailed'))
}
