// Restore page: opens a backup file and shows its notes. Works without an
// account and without the server — that is the point of a backup. When the
// visitor happens to be logged in with an unlocked vault, it also offers to
// import the notes into that account.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from './i18n'
import {
  parseBackup,
  notesOf,
  isEncrypted,
  diffAgainst,
  type BackupFile,
  type BackupNote,
} from './backup'
import { readTextFile } from './backupFile'
import { importNotes, type ImportSummary } from './backupImport'
import { listNotes } from './api'
import { getDataKey, getToken } from './session'

export default function Restore() {
  const { t } = useTranslation()
  const [file, setFile] = useState<BackupFile | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [notes, setNotes] = useState<BackupNote[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
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
    try {
      const parsed = parseBackup(await readTextFile(picked))
      setFile(parsed)
      // A plain backup needs no passphrase, so open it straight away.
      if (!isEncrypted(parsed)) await open(parsed, '')
    } catch (e) {
      setFile(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function open(target: BackupFile, pass: string) {
    setOpening(true)
    setError('')
    try {
      const opened = await notesOf(target, pass)
      setNotes(opened)
      setPassphrase('')
      if (canImport) await prepareImport(opened)
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
    setProgress([0, toImport.length])
    try {
      setSummary(await importNotes(toImport, (done, total) => setProgress([done, total])))
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
    if (s.stoppedByLimit) return t('restore.importLimited', { count: s.imported })
    if (s.failed > 0) return t('restore.importPartial', { count: s.imported, failed: s.failed })
    return t('restore.importDone', { count: s.imported })
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
          accept=".json,.bpad,application/json"
          aria-label={t('restore.pick')}
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {file && isEncrypted(file) && !notes && (
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
              onClick={() => open(file, passphrase)}
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
                {importing && progress
                  ? t('restore.importProgress', { done: progress[0], total: progress[1] })
                  : t('restore.importStart', { count: diff.fresh })}
              </button>
            )}
            {summary && <div className="verify-sent">{summaryLine(summary)}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
