// English translations. Adding a language = a sibling dictionary of the same
// shape (Dictionary), registered in index.tsx LOCALES.
export const en = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    back: '← back',
    logOut: 'log out',
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
    bodyPlaceholder: 'Write a thought or paste a link…',
    nothingToPreview: 'nothing to preview',
    fileIt: 'File it',
    saveFailed: 'Saving failed. Try again.',
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
    sent: 'Sent ✓',
    sendFailed: 'Failed, try again',
    whatCanDo: 'What bpad can do →',
    language: 'language',
    feedbackTitle: 'feedback',
    feedbackIntro: 'Found a bug, or missing something? Tell me.',
    feedbackNotEncrypted: 'Unlike your notes, this message isn’t encrypted — I need to be able to read it.',
    feedbackPlaceholder: 'What works, what doesn’t, what’s missing?',
    feedbackSend: 'Send feedback',
    feedbackSending: 'Sending…',
    feedbackThanks: 'Thanks — got it ✓',
    feedbackSendAnother: 'Send another',
  },
  features: {
    title: 'What bpad can do',
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

## Try it
- **Markdown** — the first \`# …\` heading becomes the note title. Toggle **Preview** above.
- **Quick save** — \`Ctrl+Enter\` (Mac \`Cmd+Enter\`) saves from anywhere in the editor.
- **Search** — above the list; ignores diacritics (\`clanek\` finds "Článek").
- **Links** open in a new tab: [bpad.pro](https://bpad.pro)
- **Checklist**:
  - [x] Create an account
  - [ ] Save your recovery code
  - [ ] Install bpad as an app

## Save a link in one move
Type \`{host}/\` in the address bar and a full URL right after it:

\`{host}/https://example.com\`

…and it becomes a new note.

## Privacy
- Your password and keys **never leave the browser**. Without your password and recovery code, no one — not even us — can read the content.
- Turn on **biometric unlock** if your device supports it.
- Works **offline** (reading) and installs as an app.

Find the full feature list in **Account → What bpad can do**.
`,
  },
} as const

export type Dictionary = typeof en
