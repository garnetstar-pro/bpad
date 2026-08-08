// Content of the welcome note a new account gets after registration. Teaches
// features by using them. `host` is inserted dynamically so the link-capture
// example fits wherever the app is deployed. The first `#` heading becomes
// the title.
import { translate } from './i18n'

// `imageId` is the illustration uploaded to the new account (see
// welcomeImage.ts). It is optional because that upload is best-effort: without
// it the note simply ships without the picture section rather than not at all.
export function welcomeNoteMarkdown(host: string, imageId?: string): string {
  const image = imageId ? translate('welcome.imageBlock', { id: imageId }) : ''
  const md = translate('welcome.md', { host, image })
  // Dropping the block leaves the blank line it sat on behind.
  return md.replace(/\n{3,}/g, '\n\n')
}
