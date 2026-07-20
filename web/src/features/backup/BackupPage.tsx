import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listTxns } from '../../db'
import { toExportRecords, toCsv, toXlsxBlob, download } from '../../lib/backup/exporter'
import { makeBackup, parseBackup, restoreBackup } from '../../lib/backup/backup'
import { t } from '../../i18n'

const todayStr = () => new Date().toISOString().slice(0, 10)

export function BackupPage() {
  const count = useLiveQuery(async () => (await listTxns()).length, [], 0) ?? 0
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function exportCsv() {
    const recs = toExportRecords(await listTxns())
    download('transactions_all.csv', toCsv(recs), 'text/csv')
  }

  async function exportXlsx() {
    setBusy(true)
    try {
      const recs = toExportRecords(await listTxns())
      download('transactions_all.xlsx', await toXlsxBlob(recs))
    } finally {
      setBusy(false)
    }
  }

  async function downloadBackup() {
    const data = await makeBackup()
    download(`money-tracker-backup-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json')
  }

  async function onRestore(file: File) {
    setStatus(null)
    try {
      const backup = parseBackup(await file.text())
      if (!confirm(t('Restore replaces ALL data on this device with the backup. Continue?'))) return
      const res = await restoreBackup(backup)
      setStatus({ text: t('Restored {n} transactions.', { n: res.transactions }), ok: true })
    } catch (e) {
      setStatus({ text: (e as Error).message, ok: false })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <h1 className="h1">{t('Export & backup')}</h1>
      <p className="muted">{t('{n} transactions on this device.', { n: count })}</p>

      <section className="manage-section">
        <h2 className="manage-h2">{t('Export')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('A spreadsheet copy you can open elsewhere. It re-imports into this app too.')}
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={exportCsv} disabled={count === 0}>{t('Export CSV')}</button>
          <button className="btn" onClick={exportXlsx} disabled={busy || count === 0}>
            {busy ? t('Preparing…') : t('Export Excel')}
          </button>
        </div>
      </section>

      <section className="manage-section">
        <h2 className="manage-h2">{t('Backup & restore')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('A full backup (transactions, accounts, categories, settings) as one file. Keep it somewhere safe — it is the only copy of your data.')}
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-accent" onClick={downloadBackup}>{t('Download backup')}</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>{t('Restore from backup…')}</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])}
          />
        </div>
        {status && (
          <p className={status.ok ? 'backup-ok' : 'manage-err'} style={{ flexBasis: 'auto', marginTop: 10 }}>
            {status.ok ? '✅ ' : ''}{status.text}
          </p>
        )}
      </section>
    </div>
  )
}
