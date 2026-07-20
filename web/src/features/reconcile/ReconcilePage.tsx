import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { applyReconciliation, getReconcileState } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useAccounts, useBaseCurrency } from '../transactions/useConfig'
import { useCensor } from '../../prefs'
import {
  trackedBalances, computeAdjustments, hiddenCostTotal, isReminderDue,
} from '../../lib/analytics/reconcile'
import { t } from '../../i18n'

const money2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed2 = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + money2(Math.abs(n))
const toneClass = (n: number) => (n > 0 ? 'amt-income' : n < 0 ? 'amt-expense' : '')

export function ReconcilePage() {
  const all = useLiveTxns()
  const accounts = useAccounts()
  const currency = useBaseCurrency()
  const [censor] = useCensor()
  const reconState = useLiveQuery(() => getReconcileState(), [])

  const tracked = useMemo(() => trackedBalances(all, accounts), [all, accounts])
  const [actuals, setActuals] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')

  // Seed any account not yet entered from its tracked balance (keeps user edits).
  useEffect(() => {
    setActuals((prev) => {
      let changed = false
      const next = { ...prev }
      for (const a of Object.keys(tracked)) {
        if (!(a in next)) { next[a] = tracked[a].toFixed(2); changed = true }
      }
      return changed ? next : prev
    })
  }, [tracked])

  const order = Object.keys(tracked)
  const diffs = order.map((a) => {
    const raw = actuals[a]
    const val = raw === '' || raw == null ? tracked[a] : Number(raw)
    return Number.isFinite(val) ? val - tracked[a] : 0
  })
  const totalDiff = diffs.reduce((s, d) => s + d, 0)

  const hidden = useMemo(() => hiddenCostTotal(all), [all])
  const lastReconciled = reconState?.lastReconciled ?? null
  const due = isReminderDue(lastReconciled)

  async function apply() {
    const actualNums: Record<string, number | null> = {}
    for (const a of order) {
      const raw = actuals[a]
      actualNums[a] = raw === '' || raw == null ? null : Number(raw)
    }
    const n = await applyReconciliation(computeAdjustments(tracked, actualNums))
    setMsg(n === 0 ? t('No discrepancies — nothing to record.') : t('Recorded {n} balance adjustment(s).', { n }))
  }

  return (
    <div>
      <h1 className="h1">{t('Reconcile')}</h1>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
        {t("Register each account's real balance. The gap is recorded as a hidden cost (untracked amount).")}
      </p>

      <section className="card">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {t('Enter balances as the app shows them — liabilities like Credit Card are negative. Accounts you leave unchanged record nothing.')}
        </p>

        <div className="recon-head">
          <span className="recon-acct">{t('Account')}</span>
          <span className="recon-num">{t('Tracked')}</span>
          <span className="recon-num">{t('Actual')}</span>
          <span className="recon-num">{t('Discrepancy')}</span>
        </div>

        {order.map((a, i) => (
          <div key={a} className="recon-row">
            <span className="recon-acct">{a}</span>
            <span className="recon-num muted"><span className="money">{money2(tracked[a])}</span></span>
            <span className="recon-num">
              <input
                className="recon-input"
                type="number"
                inputMode="decimal"
                value={actuals[a] ?? ''}
                onChange={(e) => setActuals((p) => ({ ...p, [a]: e.target.value }))}
              />
            </span>
            <span className={`recon-num ${toneClass(diffs[i])}`}>
              <span className="money">{signed2(diffs[i])}</span>
            </span>
          </div>
        ))}

        <div className="recon-total">
          <span>{t('Total discrepancy to record')}</span>
          <span className={toneClass(totalDiff)}><span className="money">{signed2(totalDiff)}</span></span>
        </div>

        <div className="recon-actions">
          <button type="button" className="btn" onClick={apply}>{t('Apply reconciliation')}</button>
          {msg && <span className="muted" style={{ alignSelf: 'center', fontSize: 14 }}>{msg}</span>}
        </div>
      </section>

      <section className="card">
        <div className="recon-summary-row">
          <span className="muted">{t('Recorded hidden cost (untracked)')}</span>
          <span className={toneClass(hidden)} style={{ fontWeight: 600 }}>
            <span className="money">{signed2(hidden)}</span> {censor ? '' : currency}
          </span>
        </div>
        <div className="recon-summary-row" style={{ borderBottom: 'none' }}>
          <span className="muted">{t('Last reconciled')}</span>
          <span style={{ fontWeight: 600 }}>
            {lastReconciled ? lastReconciled : t('never')}
            {due && <span className="recon-due"> · {t('due')}</span>}
          </span>
        </div>
      </section>
    </div>
  )
}
