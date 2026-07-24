// Desktop keeps a note open in the detail pane. This decides when the list
// should auto-open the top note: at the root URL, or when the selected id has
// gone (e.g. a stale link). It deliberately stays put while a refetch is in
// flight — a just-created note is not yet in `noteIds`, and redirecting then
// would clobber the composer's navigation to it with the previous top note.
export function shouldAutoOpenTop(params: {
  wide: boolean
  loading: boolean
  refetching: boolean
  topId: string | undefined
  activeId: string | null | undefined
  noteIds: string[]
}): boolean {
  const { wide, loading, refetching, topId, activeId, noteIds } = params
  if (!wide || loading || refetching || !topId) return false
  const selectionValid = activeId != null && noteIds.includes(activeId)
  return !selectionValid
}
