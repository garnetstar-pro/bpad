// Restore page: opens a backup file and shows its notes. Works without an
// account and without the server — that is the point of a backup. When the
// visitor happens to be logged in with an unlocked vault, it also offers to
// import the notes into that account.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from './i18n'
import { diffAgainst, isEncrypted, type BackupNote } from './backup'
import { openBackupFile } from './backupFile'
import { openArchive, type ArchiveHandle, type ArchiveImage } from './backupArchive'
import { importBackup, type ImportSummary, type ImportProgress } from './backupImport'
import { listNotes } from './api'
import { getDataKey, getToken } from './session'

export default function Restore() {
  const { t } = useTranslation()
  const [handle, setHandle] = useState<ArchiveHandle | null>(null)
  const [images, setImages] = useState<Map<string, ArchiveImage>>(new Map())
  const [passphrase, setPassphrase] = useState('')
  const [notes, setNotes] = useState<BackupNote[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [diff, setDiff] = useState<{ fresh: number; dupes: number } | null>(null)
  const [toImport, setToImport] = useState<BackupNote[]>([])

  const canImport = getDataKey() !== null && getToken() !== null

  async function pick(picked: File | undefined) {
    if (!picked) return
    setError('')
    setNotes(null)
    setSummary(null)
    setDiff(null)
    setImages(new Map())
    try {
      const opened = await openBackupFile(picked)
      setHandle(opened)
      // A plain backup needs no passphrase, so open it straight away.
      if (!isEncrypted(opened.file)) await open(opened, '')
    } catch (e) {
      setHandle(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function open(target: ArchiveHandle, pass: string) {
    setOpening(true)
    setError('')
    try {
      const opened = await openArchive(target, pass || undefined)
      setNotes(opened.notes)
      setImages(opened.images)
      setPassphrase('')
      if (canImport) await prepareImport(opened.notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  async function prepareImport(opened: BackupNote[]) {
    try {
      const existing = await listNotes()
      const d = diffAgainst(existing, opened)
      setToImport(d.toImport)
      setDiff({ fresh: d.toImport.length, dupes: d.duplicates.length })
    } catch {
      // The vault is unreachable — the reader still works, only the import
      // offer is withheld.
      setDiff(null)
    }
  }

  async function runImport() {
    setImporting(true)
    setProgress({ phase: 'images', done: 0, total: 0 })
    try {
      setSummary(await importBackup(toImport, images, setProgress))
      // Re-diff so a second run offers only what is genuinely still missing.
      if (notes) await prepareImport(notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  function summaryLine(s: ImportSummary): string {
    if (s.stoppedByLimit === 'images') return t('restore.importLimitedImages', { count: s.imported })
    if (s.stoppedByLimit === 'unverified') return t('restore.importLimited', { count: s.imported })
    if (s.stoppedByLimit === 'hard') return t('restore.importLimitedHard', { count: s.imported })
    if (s.failed > 0) return t('restore.importPartial', { count: s.imported, failed: s.failed })
    return t('restore.importDone', { count: s.imported })
  }

  function importButtonLabel(): string {
    if (!importing || !progress) return t('restore.importStart', { count: diff?.fresh ?? 0 })
    return progress.phase === 'images'
      ? t('restore.importImages', { done: progress.done, total: progress.total })
      : t('restore.importProgress', { done: progress.done, total: progress.total })
  }

  const dates = notes && notes.length > 0 ? notes.map((n) => n.created_at).sort() : null

  return (
    <div className="detail-page">
      <Link to="/" className="back-link">{t('common.back')}</Link>

      <div className="account-card">
        <h2 className="account-title">{t('restore.title')}</h2>
        <div className="account-note">{t('restore.intro')}</div>

        <input
          className="backup-input"
          type="file"
          accept=".zip,.json,.bpad,application/zip,application/json"
          aria-label={t('restore.pick')}
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {handle && isEncrypted(handle.file) && !notes && (
          <>
            <input
              className="backup-input"
              type="password"
              autoComplete="off"
              placeholder={t('restore.passphrase')}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <button
              className="ghost-btn"
              type="button"
              disabled={opening || passphrase === ''}
              onClick={() => open(handle, passphrase)}
            >
              {opening ? t('restore.opening') : t('restore.open')}
            </button>
          </>
        )}

        {error && <div className="account-note">{error}</div>}

        {notes && notes.length === 0 && (
          <div className="account-note">{t('restore.emptyBackup')}</div>
        )}

        {notes && notes.length > 0 && dates && (
          <>
            <div className="account-note">
              {t('restore.summary', {
                count: notes.length,
                from: dates[0].slice(0, 10),
                to: dates[dates.length - 1].slice(0, 10),
              })}
            </div>
            {images.size > 0 && (
              <div className="account-note">
                {t('restore.summaryImages', { count: images.size })}
              </div>
            )}
            <ul className="restore-list">
              {notes.map((n, i) => (
                <li key={i}>
                  <button
                    className="restore-item"
                    type="button"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    {n.title || t('common.untitled')}
                  </button>
                  {expanded === i && <pre className="restore-body">{n.content}</pre>}
                </li>
              ))}
            </ul>
          </>
        )}

        {notes && notes.length > 0 && !canImport && (
          <div className="account-note">
            {getToken() ? t('restore.lockedHint') : t('restore.loggedOutHint')}
          </div>
        )}

        {notes && notes.length > 0 && canImport && diff && (
          <div className="account-backup">
            <span className="account-key">{t('restore.importTitle')}</span>
            <div className="account-note">
              {diff.fresh === 0
                ? t('restore.importNothing')
                : t('restore.importIntro', { fresh: diff.fresh, dupes: diff.dupes })}
            </div>
            {diff.fresh > 0 && (
              <button className="ghost-btn" type="button" disabled={importing} onClick={runImport}>
                {importButtonLabel()}
              </button>
            )}
            {summary && <div className="verify-sent">{summaryLine(summary)}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
