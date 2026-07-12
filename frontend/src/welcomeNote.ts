// Content of the welcome note a new account gets after registration. Teaches
// features by using them. `host` is inserted dynamically so the link-capture
// example fits wherever the app is deployed. The first `#` heading becomes
// the title.
import { translate } from './i18n'

export function welcomeNoteMarkdown(host: string): string {
  return translate('welcome.md', { host })
}
