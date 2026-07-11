// Autofocus jen na počítači (myš + hover), ne na dotykových zařízeních —
// aby na mobilu při načtení hned nevyskočila klávesnice.
export function canAutofocus(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}
