// Autofocus only on desktop (mouse + hover), not on touch devices — so the
// keyboard doesn't pop up immediately on page load on mobile.
export function canAutofocus(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}
