import { useState, useEffect } from 'react'

// Autofocus only on desktop (mouse + hover), not on touch devices — so the
// keyboard doesn't pop up immediately on page load on mobile.
export function canAutofocus(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

// True on phones/tablets (coarse primary pointer). Used to skip the idle lock
// on mobile — locks on any non-touch device rather than requiring hover+fine,
// which some desktops don't report.
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

// Reactive to resize: true at the two-pane breakpoint and above. Used to decide
// desktop-only behavior in React (unlike the one-shot helpers above), such as
// auto-selecting the top note when nothing is open.
export function useWideLayout(): boolean {
  const query = '(min-width: 860px)'
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setWide(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return wide
}
