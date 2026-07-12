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
