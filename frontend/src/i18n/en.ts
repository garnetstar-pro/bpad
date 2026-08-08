// English translations. Adding a language = a sibling dictionary of the same
// shape (Dictionary), registered in index.tsx LOCALES.
export const en = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    back: '← back',
    logOut: 'log out',
    help: 'help',
    loading: 'loading…',
    untitled: '(untitled)',
  },
  editor: {
    saveHint: 'ctrl+enter or click “{label}”',
    saving: 'saving…',
    title: 'title',
    titlePlaceholder: 'derived from the markdown when left empty',
    write: 'Write',
    preview: 'Preview',
    addImage: 'Add image',
    bodyPlaceholder: 'Write a thought or paste a link…',
    nothingToPreview: 'nothing to preview',
    fileIt: 'File it',
    saveFailed: 'Saving failed. Try again.',
    imageUploading: 'uploading image…',
    imageTooLarge: 'that image is too large (max 10 MB)',
    imageFailed: 'image upload failed, try again',
    imageLimit: 'a note can hold at most {limit} images',
  },
  images: {
    loading: 'loading image…',
    failed: 'image unavailable',
    alt: 'note image',
    zoom: 'view image larger',
    zoomNamed: 'view image larger: {alt}',
    close: 'close image',
  },
  composer: {
    newEntry: '+ New entry…',
  },
  home: {
    connectFailed: 'Couldn’t reach the backend. Is func start running?',
    recentEntries: 'recent entries',
    searchPlaceholder: 'search notes…',
    clearSearch: 'Clear search',
    loading: 'loading…',
    noEntries: 'no entries yet',
    nothingFound: 'nothing found',
    sortLabel: 'Sort entries by',
    sortCreated: 'created',
    sortModified: 'modified',
    hasImage: 'Contains an image',
  },
  notes: {
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    copyWa: 'Copy for WhatsApp',
    copied: 'Copied ✓',
    deleting: 'deleting…',
    deleteConfirm: 'Delete this note?',
    deleteFailed: 'Delete failed. Try again.',
    notFound: 'Note not found',
    back: '← back to list',
    selectPrompt: 'Select a note to read it here.',
    metaCreated: 'Created {date}',
    metaUpdated: 'Updated {date}',
  },
  footer: {
    features: 'What bpad can do',
    tagline: 'End-to-end encrypted.',
    copyright: '© 2026 bpad',
  },
  auth: {
    login: 'Log in',
    loginSub: 'Unlock your encrypted vault.',
    createAccount: 'Create account',
    createSub: 'Create your private encrypted vault.',
    username: 'username',
    password: 'password',
    passwordAgain: 'password again',
    email: 'e-mail',
    emailPlaceholder: 'for verification and alerts',
    strongPassword: 'choose a strong password',
    repeatPassword: 'repeat the password',
    unlocking: 'unlocking…',
    creatingVault: 'creating vault…',
    solvingRobot: 'verifying you’re not a robot…',
    forgotPassword: 'Forgot password?',
    toRegister: 'Create account →',
    backToLogin: '← Back to login',
    loginHint: 'The key is derived in your browser and lives only in memory. Closing the tab logs you out.',
    registerHint: 'The password can’t be recovered from the server. After signup you get a recovery code — save it.',
    recoveryTitle: 'Your recovery code',
    recoveryWarn: '⚠ Write it down now. It’s shown only once. Without your password and this code, the notes are lost for good.',
    recoverySaved: 'I’ve saved the code safely',
    toVault: 'Continue to the vault',
    copy: 'Copy',
    download: 'Download .txt',
    recoverTitle: 'Reset password',
    recoverSub: 'Enter your recovery code and set a new password.',
    recoveryCode: 'recovery code',
    newPassword: 'new password',
    newPasswordPlaceholder: 'new strong password',
    recovering: 'recovering…',
    recoverSubmit: 'Reset and log in',
    recoverHint: 'The code unlocks the vault in your browser and re-wraps it with the new password. Notes are not re-encrypted.',
    errEmail: 'Enter a valid e-mail',
    errPwLen: 'Password must be at least 8 characters',
    errPwMatch: 'Passwords don’t match',
    errRegister: 'Registration failed',
    errLogin: 'Login failed',
    errRecover: 'Recovery failed',
    errNewPwLen: 'New password must be at least 8 characters',
    metaAccess: 'access: you only',
    metaNewVault: 'new vault',
    metaSave: 'save this',
    metaRecover: 'recover',
    brandKicker: 'blank pad · encrypted',
  },
  account: {
    title: 'Account',
    sectionProfile: 'profile',
    sectionPreferences: 'preferences',
    username: 'username',
    email: 'e-mail',
    notes: 'notes',
    ofLimit: 'of {limit}',
    joined: 'joined',
    verified: 'verified ✓',
    unverified: 'unverified',
    emailOffline: 'Your e-mail loads once you’re online.',
    verifyCta: 'Verify your e-mail to write without limits.',
    sendLink: 'Send verification link',
    sending: 'Sending…',
    sent: 'Sent ✓',
    sendFailed: 'Failed, try again',
    language: 'language',
    autoLock: 'Auto-lock',
    autoLockNever: 'Never',
    autoLock1: '1 minute',
    autoLock5: '5 minutes',
    autoLock15: '15 minutes',
    autoLock30: '30 minutes',
    autoLock60: '1 hour',
    feedbackTitle: 'feedback',
    feedbackIntro: 'Found a bug, or missing something? Tell me.',
    feedbackNotEncrypted: 'Unlike your notes, this message isn’t encrypted — I need to be able to read it.',
    feedbackPlaceholder: 'What works, what doesn’t, what’s missing?',
    feedbackSend: 'Send feedback',
    feedbackSending: 'Sending…',
    feedbackThanks: 'Thanks — got it ✓',
    feedbackSendAnother: 'Send another',
    backupTitle: 'backup',
    backupIntro:
      'Download all your notes and the images in them as a single file and keep it somewhere safe — a USB stick, an encrypted drive. If you ever lose both your password and your recovery code, this file is what gets your notes back.',
    backupProtected: 'Protect with a passphrase (recommended)',
    backupPlain: 'Plain, unencrypted file',
    backupPassphrase: 'Backup passphrase',
    backupPassphraseAgain: 'Repeat the passphrase',
    backupPassphraseHint:
      'This is NOT your bpad password. Nobody can recover it — write it down next to your recovery code.',
    backupPassphraseTooShort: 'Use at least {min} characters.',
    backupPassphraseMismatch: 'The two passphrases don’t match.',
    backupPlainWarning: 'I understand anyone who finds this file can read every note in it.',
    backupDownload: 'Download backup',
    backupWorking: 'preparing…',
    backupImages: 'downloading images {done}/{total}…',
    backupPacking: 'packing the file…',
    backupEmpty: 'There’s nothing to back up yet.',
    backupDone: 'Backup downloaded: {count} notes, {images} images ✓',
    backupImagesMissing:
      '{count} images couldn’t be downloaded and are missing from the file. The notes were saved anyway.',
    backupRestoreLink: 'Restore from a backup →',
  },
  restore: {
    title: 'Restore from a backup',
    intro:
      'Open a bpad backup file — a .zip archive, or an older .json/.bpad file. Everything happens in this browser until you choose to import.',
    pick: 'Choose a backup file',
    passphrase: 'Backup passphrase',
    open: 'Open',
    opening: 'opening…',
    summary: '{count} notes, {from} to {to}',
    summaryImages: '{count} images in this file.',
    emptyBackup: 'This backup contains no notes.',
    importTitle: 'import into your account',
    importIntro: '{fresh} new, {dupes} already in your account.',
    importNothing: 'Every note in this backup is already in your account.',
    importStart: 'Import {count} notes',
    importProgress: 'importing {done} of {total}…',
    importImages: 'uploading images {done} of {total}…',
    importDone: '{count} notes imported ✓',
    importPartial: '{count} imported, {failed} failed. Run the import again to retry.',
    importLimited:
      '{count} imported, then your account hit the limit for unverified e-mail. Verify your e-mail and run the import again.',
    importLimitedHard:
      '{count} imported, then your account reached its note limit. Some notes were not imported.',
    importLimitedImages:
      '{count} imported, then the image upload limit was reached. Run the import again in a few minutes to finish the rest — nothing gets duplicated.',
    lockedHint: 'Unlock your vault to import these notes into your account.',
    loggedOutHint: 'Log in to import these notes into your account.',
  },
  features: {
    title: 'What bpad can do',
    intro: 'A full list of everything bpad supports — from writing to security to keeping your data truly yours.',
  },
  tags: {
    placeholder: 'add a tag…',
    remove: 'Remove tag',
    untagged: 'untagged',
    overLimit: '{count} tags on your account — free accounts get {limit}. Premium will lift this.',
  },
  landing: {
    tagline: 'An encrypted notebook only you can read.',
    intro: 'Notes are encrypted in your browser — the server never sees them, and neither do we.',
    getStarted: 'Create account',
    login: 'Log in',
    featuresHeading: 'What you get',
    privacyHeading: 'Private by design',
    privacyBody:
      'Your password and keys never leave the browser. Without your password and recovery code, no one — not even us — can read your notes.',
    footer: 'bpad · encrypted notebook',
  },
  offline: {
    banner: 'Offline · read-only — changes can’t be saved',
  },
  verify: {
    remaining:
      'Unverified account — {remaining} of {limit} notes left. Verify your e-mail to write without limits.',
    atLimit: 'You’ve hit the {limit}-note limit — verify your e-mail to keep writing.',
    sent: 'Sent ✓ — check your inbox',
    sendLink: 'Send verification link',
    sending: 'Sending…',
    sendFailed: 'Failed, try again',
    softGate: 'Verify your e-mail for more than {limit} notes.', // mirror of backend message (see Task 7)
    title: 'Verify e-mail',
    checking: 'Verifying…',
    done: 'Done — e-mail verified. ✅',
    invalid: 'The link is invalid or has expired.',
    backToApp: 'Back to bpad',
  },
  update: {
    available: 'A new version of bpad is available.',
    refresh: 'Update',
    dismiss: 'Close',
  },
  capture: {
    saving: 'saving link…',
    failed: 'Saving the link failed',
    home: '← home',
  },
  lock: {
    title: 'locked',
    sub: 'Idle too long — enter your password to unlock.',
    // Cold load (reload, a pasted note link, a PWA start): the keys only ever
    // lived in the page, so they went with it.
    subReturning: 'Welcome back — enter your password to unlock.',
    password: 'password',
    unlock: 'Unlock',
    unlocking: 'unlocking…',
    notYou: 'Log in as someone else',
    failed: 'Wrong password',
  },
  biometric: {
    enableLink: 'unlock with fingerprint',
    unlockTitle: 'Unlock',
    loggedInAs: 'Logged in as {username}.',
    unlocking: 'unlocking…',
    unlock: 'Unlock with fingerprint',
    usePasswordInstead: 'Enter password instead',
    forgetDevice: 'Forget this device',
    hint: 'The fingerprint unlocks a key stored only on this device. The password is never sent.',
    enrollTitle: 'Unlock with fingerprint?',
    enrollText:
      'Next time you can unlock the vault with your fingerprint or Face ID instead of a password. It’s stored only encrypted on this device — the password is never stored.',
    later: 'Not now',
    enrolling: 'enrolling…',
    enable: 'Enable',
  },
  errors: {
    vaultLocked: 'Vault is locked',
    backupUnreadable: 'That file couldn’t be read — it isn’t valid JSON.',
    backupNotBpad: 'That isn’t a bpad backup file.',
    backupTooNew: 'This backup was written by a newer version of bpad.',
    backupDamaged: 'The backup file looks damaged — the notes are missing.',
    backupUnsupported: 'This backup uses an unsupported encryption scheme.',
    backupWrongPassphrase: 'Wrong backup passphrase — or the file is damaged.',
    backupNeedsPassphrase: 'This backup is password-protected.',
    offlineWrite: 'You’re offline — changes can’t be saved',
    loadFailed: 'Could not load notes',
    offlineNoNotes: 'Offline with no saved notes',
    noteNotFound: 'Note not found',
    noteNotOffline: 'Note isn’t available offline',
    saveFailed: 'Saving failed',
    deleteFailed: 'Delete failed',
    sessionExpired: 'Session expired',
    loginFailed: 'Login failed',
    wrongUserOrPass: 'Wrong username or password',
    registerFailed: 'Registration failed',
    emailTaken: 'Username or e-mail is taken',
    invalidEmail: 'Invalid e-mail or details',
    sendFailed: 'Sending failed',
    linkInvalid: 'The link is invalid or expired',
    userNotFound: 'User not found',
    invalidRecovery: 'Invalid recovery code',
    recoverFailed: 'Recovery failed',
    offlineNoUser: 'You’re offline and I have no saved data for this user.',
    savedLoginInvalid: 'Your saved login is no longer valid',
    accountLoadFailed: 'Could not load the account',
    preferencesSaveFailed: 'Could not save the preference',
    biometricEnrollFailed: 'Biometric enrollment failed',
    biometricUnlockFailed: 'Biometric unlock failed',
    noPrfSupport: 'Device doesn’t support PRF (biometric unlock)',
    noBiometricEnrollment: 'No biometric login enrolled',
    biometricUnwrapFailed: 'Biometric unlock failed',
    biometricUnsupported:
      'Biometrics don’t work in this browser (probably a certificate issue). Log in with your password instead.',
    biometricVerifyFailed: 'Verification failed. Try again or use your password.',
    powTimeout: 'Verification is taking too long — try again.',
    powFailed: 'Robot verification failed',
    keyDerivationFailed: 'Could not unlock — key derivation failed',
    feedbackFailed: 'Could not send feedback',
    feedbackTooMany: 'Too many messages — please wait a few minutes',
  },
  welcome: {
    md: `# 👋 Welcome to bpad

This is your first note — edit or delete it freely. **bpad** is an encrypted notebook: only you see the content; the server never does.
{image}
## Try it out
- **Markdown** — write using standard Markdown syntax. Toggle **Preview** to see it rendered.
- **Auto-title** — the first \`# …\` heading becomes the note title automatically.
- **Quick save** — \`Ctrl+Enter\` (Mac \`Cmd+Enter\`) saves from anywhere in the editor.
- **Tags** — add short tags to notes and filter the list by them with one click.
- **Images** — paste an image from your clipboard or click **Add image**. Click any image to zoom in.
- **Search** — above the note list; ignores diacritics (\`clanek\` finds "Článek").
- **Sort** — switch between sorting by creation date or last modified.

## Markdown quick guide
Write plain text, or sprinkle in Markdown. Toggle **Preview** to see it rendered.

| You type | You get |
| --- | --- |
| \`# Heading\` | a title/heading |
| \`**bold**\` | **bold** |
| \`*italic*\` | *italic* |
| \`- item\` | a bullet list |
| \`1. item\` | a numbered list |
| \`- [ ] task\` | a checklist box |
| \`[label](https://…)\` | a [link](https://bpad.pro) |
| \`\` \`code\` \`\` | inline \`code\` |
| \`> quote\` | a blockquote |

A single Enter breaks the line; a blank line starts a new paragraph.

## Save a link in one move
Type \`{host}/\` in the address bar and a full URL right after it:

\`{host}/https://example.com\`

…and it instantly becomes a new note.

## Security & your data
- Your password and keys **never leave the browser**. Without your password and recovery code, no one — not even us — can read your notes.
- **Biometric unlock** — enable it in Account settings if your device supports it.
- **Auto-lock** — the vault locks itself after inactivity (configurable in Account).
- **Recovery code** — generated at sign-up, shown once. Save it.
- **Backup** — download all notes and images as a ZIP from Account. Keep it on a USB stick.
- **Works offline** and installs as an app (PWA) from your browser menu.

See the full feature list in **Account → What bpad can do**.

## Getting started checklist
- [x] Create an account
- [ ] Save your recovery code
- [ ] Verify your e-mail (removes the note limit)
- [ ] Install bpad as an app
`,
    // Dropped into welcome.md at {image} once the illustration has been
    // uploaded to the new account. Omitted entirely if that upload fails.
    imageBlock: `
## What the server sees

![Your note as you wrote it on the left; the ciphertext the server stores on the right](bpad-img:{id})

Your notes are encrypted before they ever leave this device. Click the picture to open it full-screen — every image you add works the same way.
`,
  },
} as const

export type Dictionary = typeof en
