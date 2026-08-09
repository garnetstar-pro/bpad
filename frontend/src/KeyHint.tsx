import { hasKeyboard } from './device'

// A key rendered as a keycap, e.g. the "/" sitting in the search box. Used
// everywhere a shortcut is available so the bindings are discoverable in
// place, not only on the help page. Multi-key hints are written as
// "Ctrl/⌘ + Enter" and split on "+".
export function KeyHint({ keys, className = '' }: { keys: string; className?: string }) {
  // Hidden where there is no keyboard to press.
  if (!hasKeyboard()) return null
  const parts = keys.split('+').map((k) => k.trim())
  return (
    <span className={`key-hint ${className}`.trim()} aria-hidden="true">
      {parts.map((part, i) => (
        <span key={part}>
          {i > 0 && <span className="key-hint-plus">+</span>}
          <kbd className="key-cap">{part}</kbd>
        </span>
      ))}
    </span>
  )
}
