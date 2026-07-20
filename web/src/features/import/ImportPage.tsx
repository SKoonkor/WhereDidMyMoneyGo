import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readTable, type Table } from '../../lib/import/readTable'
import {
  detectPreset, guessMapping, TARGET_FIELDS,
  type Profile, type TargetField, type DateOrder, type Decimal,
} from '../../lib/import/presets'
import { parseRows, unknownNames, type ParseResult } from '../../lib/import/parse'
import { commitImport, type CommitResult } from '../../lib/import/commit'
import { useAccounts, useCategories } from '../transactions/useConfig'
import { t } from '../../i18n'

const NONE = '__none__'

export function ImportPage() {
  const accounts = useAccounts()
  const categories = useCategories()
  const [table, setTable] = useState<Table | null>(null)
  const [presetName, setPresetName] = useState<string>('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [accountMap, setAccountMap] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [done, setDone] = useState<CommitResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File) {
    setError(''); setDone(null); setAccountMap({})
    try {
      const tbl = await readTable(file)
      if (!tbl.headers.length) { setError(t('Could not read any columns from this file.')); return }
      const detected = detectPreset(tbl.headers)
      setTable(tbl)
      setPresetName(detected ? detected.name : '')
      setProfile(detected ?? guessMapping(tbl.headers))
    } catch {
      setError(t('Could not read this file. Use a .csv or .xlsx export.'))
    }
  }

  // Live parse as the mapping changes.
  const parsed = useMemo<{ result: ParseResult | null; err: string }>(() => {
    if (!table || !profile) return { result: null, err: '' }
    try {
      return { result: parseRows(table.records, profile), err: '' }
    } catch (e) {
      return { result: null, err: (e as Error).message }
    }
  }, [table, profile])

  const knownCats = useMemo(
    () => new Set([...Object.keys(categories.income), ...Object.keys(categories.expense)]),
    [categories],
  )
  const unknown = useMemo(
    () => (parsed.result ? unknownNames(parsed.result.rows, accounts, knownCats) : null),
    [parsed.result, accounts, knownCats],
  )

  function setColumn(field: TargetField, header: string) {
    if (!profile) return
    setProfile({ ...profile, columns: { ...profile.columns, [field]: header === NONE ? null : header } })
  }
  function setOption<K extends keyof Profile['options']>(key: K, value: Profile['options'][K]) {
    if (!profile) return
    setProfile({ ...profile, options: { ...profile.options, [key]: value } })
  }

  async function doImport() {
    if (!parsed.result) return
    setBusy(true)
    try {
      const res = await commitImport(parsed.result.rows, accountMap)
      setDone(res)
      setTable(null); setProfile(null)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div>
        <h1 className="h1">{t('Import')}</h1>
        <div className="import-done">
          <p>✅ {t('Imported {n} transactions.', { n: done.inserted })}</p>
          {done.newAccounts.length > 0 && (
            <p className="muted">{t('New accounts added: {list}', { list: done.newAccounts.join(', ') })}</p>
          )}
          {done.newCategories.length > 0 && (
            <p className="muted">{t('New categories added: {list}', { list: done.newCategories.join(', ') })}</p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Link className="btn btn-accent" to="/transactions">{t('View transactions')}</Link>
            <button className="btn" onClick={() => setDone(null)}>{t('Import another file')}</button>
          </div>
        </div>
      </div>
    )
  }

  const result = parsed.result
  const ready = result?.rows.length ?? 0

  return (
    <div>
      <h1 className="h1">{t('Import')}</h1>
      <p className="muted">{t('Import a CSV or Excel export from another money app. Your file is read on this device only.')}</p>

      <label className="file-drop">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <span>{table ? t('Choose a different file') : t('Choose a .csv or .xlsx file')}</span>
      </label>
      {error && <p className="manage-err" style={{ flexBasis: 'auto' }}>{error}</p>}

      {table && profile && (
        <>
          <div className="import-preset">
            {presetName
              ? t('Detected format: {name}', { name: presetName })
              : t('No preset matched — check the column mapping below.')}
          </div>

          <section className="manage-section">
            <h2 className="manage-h2">{t('Column mapping')}</h2>
            <div className="map-grid">
              {TARGET_FIELDS.map((field) => (
                <div className="field" key={field}>
                  <label>{t(field)}</label>
                  <select value={profile.columns[field] ?? NONE} onChange={(e) => setColumn(field, e.target.value)}>
                    <option value={NONE}>— {t('none')} —</option>
                    {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="field">
                <label>{t('Date order')}</label>
                <select value={profile.options.date_order} onChange={(e) => setOption('date_order', e.target.value as DateOrder)}>
                  <option value="auto">{t('Auto')}</option>
                  <option value="dmy">DD/MM/YYYY</option>
                  <option value="mdy">MM/DD/YYYY</option>
                  <option value="ymd">YYYY-MM-DD</option>
                  <option value="ydm">YYYY/DD/MM</option>
                </select>
              </div>
              <div className="field">
                <label>{t('Decimal')}</label>
                <select value={profile.options.decimal} onChange={(e) => setOption('decimal', e.target.value as Decimal)}>
                  <option value="dot">1,234.56</option>
                  <option value="comma">1.234,56</option>
                </select>
              </div>
            </div>
          </section>

          {parsed.err && <p className="manage-err" style={{ flexBasis: 'auto' }}>{parsed.err}</p>}

          {result && (
            <section className="manage-section">
              <h2 className="manage-h2">{t('Preview')}</h2>
              <p>
                <strong>{t('{n} ready', { n: ready })}</strong>
                {result.skipped > 0 && (
                  <span className="muted"> · {t('{n} skipped', { n: result.skipped })}</span>
                )}
              </p>
              {result.skipped > 0 && (
                <ul className="import-issues">
                  {Object.entries(result.issues).map(([reason, n]) => (
                    <li key={reason} className="muted">{reason}: {n}</li>
                  ))}
                </ul>
              )}

              {unknown && unknown.accounts.length > 0 && (
                <div className="import-unknown">
                  <div className="manage-h2">{t('New accounts in this file')}</div>
                  {unknown.accounts.map((a) => (
                    <div className="row" key={a} style={{ alignItems: 'center' }}>
                      <span className="manage-name">{a}</span>
                      <select
                        value={accountMap[a] ?? ''}
                        onChange={(e) => setAccountMap({ ...accountMap, [a]: e.target.value })}
                      >
                        <option value="">➕ {t('Create new')}</option>
                        {accounts.map((ex) => <option key={ex} value={ex}>{t('Map to {name}', { name: ex })}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {unknown && unknown.categories.length > 0 && (
                <p className="muted">{t('New categories to be created: {list}', { list: unknown.categories.join(', ') })}</p>
              )}

              {ready > 0 && (
                <div className="import-table-wrap">
                  <table className="import-table">
                    <thead>
                      <tr>
                        <th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Account')}</th>
                        <th>{t('Category')}</th><th style={{ textAlign: 'right' }}>{t('Amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 15).map((r, i) => (
                        <tr key={i}>
                          <td>{r.period}</td><td>{r.type}</td><td>{r.account}</td>
                          <td>{r.category}</td>
                          <td style={{ textAlign: 'right' }}>{r.amount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ready > 15 && <p className="muted">{t('…and {n} more', { n: ready - 15 })}</p>}
                </div>
              )}

              <button
                className="btn btn-accent"
                style={{ marginTop: 14 }}
                disabled={busy || ready === 0}
                onClick={doImport}
              >
                {busy ? t('Importing…') : t('Import {n} transactions', { n: ready })}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  )
}
