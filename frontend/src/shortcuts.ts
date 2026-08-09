// Global keyboard shortcuts.
//
// This module is the single source of truth: the handler dispatches from the
// same table the help page and the inline hints render from, so a binding can
// never drift from what the UI claims it is.
//
// Pure (no DOM listeners, no React) — the wiring lives in KeyboardShortcuts.tsx.

export type ShortcutAction = 'new' | 'search' | 'close' | 'help'

export interface Shortcut {
  action: ShortcutAction
  // What to print in the UI. Rendered as a <kbd> chip.
  keys: string
  // i18n key for the one-line description shown in help.
  descKey: string
}

export const SHORTCUTS: Shortcut[] = [
  { action: 'new', keys: 'n', descKey: 'shortcuts.new' },
  { action: 'search', keys: '/', descKey: 'shortcuts.search' },
  { action: 'close', keys: 'Esc', descKey: 'shortcuts.close' },
  { action: 'help', keys: '?', descKey: 'shortcuts.help' },
]

// Ctrl+Enter is handled inside the editor rather than globally (it must work
// while typing, which is exactly when the global handler stands down), but it
// belongs in the help list all the same.
export const EDITOR_SHORTCUTS: Shortcut[] = [
  { action: 'new', keys: 'Ctrl/⌘ + Enter', descKey: 'shortcuts.save' },
]

interface KeyEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

// Anything that takes text input. A shortcut must never eat a character the
// user meant to type — "n" in the middle of a note is a letter, not a command.
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (el as HTMLElement).isContentEditable === true
}

// Escape is deliberately exempt from the typing guard below: backing out of a
// field you are typing in is the one thing Escape is for.
const WORKS_WHILE_TYPING: ShortcutAction[] = ['close']

export function resolveShortcut(
  e: KeyEventLike,
  opts: { typing: boolean },
): ShortcutAction | null {
  // Modified keystrokes belong to the browser or the editor, not here.
  if (e.ctrlKey || e.metaKey || e.altKey) return null

  let action: ShortcutAction | null = null
  if (e.key === 'Escape') action = 'close'
  else if (e.key === 'n' || e.key === 'N') action = 'new'
  else if (e.key === '/') action = 'search'
  else if (e.key === '?') action = 'help'

  if (action === null) return null
  if (opts.typing && !WORKS_WHILE_TYPING.includes(action)) return null
  return action
}
