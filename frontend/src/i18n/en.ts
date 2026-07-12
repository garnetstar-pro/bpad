// English translations. Adding a language = a sibling dictionary of the same
// shape (Dictionary), registered in index.tsx LOCALES.
export const en = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    back: '← back',
    logOut: 'log out',
    loading: 'loading…',
  },
  editor: {
    saveHint: 'ctrl+enter or click “{label}”',
  },
} as const

export type Dictionary = typeof en
