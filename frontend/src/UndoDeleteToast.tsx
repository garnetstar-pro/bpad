import { useEffect, useState } from 'react'
import {
  PENDING_DELETE_EVENT,
  getPendingDelete,
  undoPendingDelete,
  type PendingDelete,
} from './pendingDelete'
import { useTranslation } from './i18n'

// The undo affordance for a deleted note. Mounted next to UpdatePrompt at the
// app root rather than inside a route, because deleting navigates away from
// the note detail that triggered it — a toast inside that route would unmount
// with it, taking the only way back with it.
export default function UndoDeleteToast() {
  const { t } = useTranslation()
  const [pending, setPending] = useState<PendingDelete | null>(getPendingDelete())

  useEffect(() => {
    const sync = () => setPending(getPendingDelete())
    window.addEventListener(PENDING_DELETE_EVENT, sync)
    return () => window.removeEventListener(PENDING_DELETE_EVENT, sync)
  }, [])

  if (!pending) return null

  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-text">
        {t('notes.deletedToast', { title: pending.title })}
      </span>
      <button type="button" className="undo-toast-btn" onClick={undoPendingDelete}>
        {t('notes.undo')}
      </button>
    </div>
  )
}
