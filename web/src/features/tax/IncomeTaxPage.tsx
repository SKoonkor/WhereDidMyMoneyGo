import { useMemo, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTax, saveTax, getCategories } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import {
  specFor, allowanceDefs, incomeTaxStatus, grossIncomeForYear, taxPaidForYear,
  ledgerYears, type TaxCfg, type AllowanceDef, type AllowanceValues,
} from '../../lib/analytics/income_tax'
import { t } from '../../i18n'

const fmt = (n: number) => Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0)

export function IncomeTaxPage() {
  const all = useLiveTxns()
  const settings = useSettings()
  const cfg = useLiveQuery(() => getTax(), []) // undefined until loaded
  const cats = useLiveQuery(() => getCategories(), [])
  const currency = settings.baseCurrency

  const years = useMemo(() => ledgerYears(all), [all])
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  useEffect(() => { if (years.length && !years.includes(year)) setYear(years[0]) }, [years, year])

  const spec = specFor(cfg?.country)
  const save = (patch: Partial<TaxCfg>) => { if (cfg) void saveTax({ ...cfg, ...patch }) }

  // Ledger-derived gross for the year, filtered by the chosen income categories.
  const ledgerGross = useMemo(
    () => grossIncomeForYear(all, year, cfg?.incomeSelections),
    [all, year, cfg?.incomeSelections],
  )
  // Editable gross: seeded from the ledger, re-seeded when year/filter changes.
  const [grossStr, setGrossStr] = useState('')
  useEffect(() => { setGrossStr(String(Math.round(ledgerGross))) }, [ledgerGross])

  const ledgerPaid = useMemo(
    () => taxPaidForYear(all, cfg?.taxSelections ?? [], year),
    [all, year, cfg?.taxSelections],
  )

  const status = useMemo(() => {
    if (!cfg) return null
    const values: AllowanceValues = { ...cfg.allowances }
    return incomeTaxStatus(num(grossStr), values, spec, ledgerPaid)
  }, [cfg, grossStr, spec, ledgerPaid])

  if (!cfg || !status) return <p className="muted">{t('Loading…')}</p>

  const incomeCats = cats ? Object.keys(cats.income) : []
  const expenseCats = cats ? Object.keys(cats.expense) : []
  const incomeSel = new Set(cfg.incomeSelections ?? [])
  const taxSel = new Set(cfg.taxSelections ?? [])
  const toggle = (set: Set<string>, name: string, key: 'incomeSelections' | 'taxSelections') => {
    const next = new Set(set)
    if (next.has(name)) next.delete(name); else next.add(name)
    save({ [key]: [...next] })
  }

  const refund = status.remaining < 0

  return (
    <div>
      <h1 className="h1">{t('Income Tax')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('Estimate your personal income tax for a year. Model: {country}.', { country: t(spec.country) })}
      </p>

      <section className="card">
        <label className="calc-field" style={{ maxWidth: 200 }}>
          <span>{t('Tax year')}</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </section>

      {/* Income */}
      <section className="card">
        <div className="dash-title">{t('Assessable income')}</div>
        <label className="calc-field" style={{ marginTop: 8 }}>
          <span>{t('Gross income ({currency})', { currency })}</span>
          <input value={grossStr} onChange={(e) => setGrossStr(e.target.value)} type="number" inputMode="decimal" />
        </label>
        <button type="button" className="inline-link tax-refill" onClick={() => setGrossStr(String(Math.round(ledgerGross)))}>
          {t('↻ From ledger ({year}): {amount} {currency}', { year, amount: fmt(ledgerGross), currency })}
        </button>
        {incomeCats.length > 0 && (
          <>
            <div className="set-hint" style={{ marginTop: 10 }}>{t('Count only these income categories (none = all):')}</div>
            <div className="chip-choices">
              {incomeCats.map((c) => (
                <button key={c} type="button" className={incomeSel.has(c) ? 'choice-chip on' : 'choice-chip'} onClick={() => toggle(incomeSel, c, 'incomeSelections')}>{c}</button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Allowances */}
      <section className="card">
        <div className="dash-title">{t('Deductions & allowances')}</div>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          {t('Automatic expense deduction')}: <span className="money">{fmt(status.expense_deduction)} {currency}</span>
        </p>
        <div className="tax-allowances">
          {allowanceDefs(spec).map((a) => (
            <AllowanceInput key={a.key} def={a} values={cfg.allowances} currency={currency} onChange={(v) => save({ allowances: { ...cfg.allowances, [a.key]: v } })} />
          ))}
        </div>
      </section>

      {/* Tax already paid */}
      <section className="card">
        <div className="dash-title">{t('Tax already paid')}</div>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          {t('Withholding / prepayments from these expense categories:')}
        </p>
        {expenseCats.length > 0 ? (
          <div className="chip-choices">
            {expenseCats.map((c) => (
              <button key={c} type="button" className={taxSel.has(c) ? 'choice-chip on' : 'choice-chip'} onClick={() => toggle(taxSel, c, 'taxSelections')}>{c}</button>
            ))}
          </div>
        ) : <p className="muted" style={{ fontSize: 13 }}>{t('No expense categories yet.')}</p>}
        <p style={{ marginTop: 10 }}>
          {t('Paid in {year}', { year })}: <span className="money" style={{ fontWeight: 600 }}>{fmt(status.tax_paid)} {currency}</span>
        </p>
      </section>

      {/* Results */}
      <section className="card">
        <div className="calc-totals">
          <Total label={t('Net taxable income')} value={<span className="money">{fmt(status.net_taxable)} {currency}</span>} />
          <Total label={t('Tax due')} value={<span className="money">{fmt(status.tax_due)} {currency}</span>} accent />
          <Total label={t('Effective rate')} value={`${(status.effective_rate * 100).toFixed(2)}%`} />
          <Total label={t('Marginal rate')} value={`${(status.marginal_rate * 100).toFixed(0)}%`} />
        </div>
        <div className={`tax-balance ${refund ? 'refund' : 'owe'}`}>
          {refund
            ? t('Refund: {amount} {currency}', { amount: fmt(-status.remaining), currency })
            : t('Still owed: {amount} {currency}', { amount: fmt(status.remaining), currency })}
        </div>
      </section>

      {/* Bracket breakdown */}
      {status.bracket_rows.length > 0 && (
        <section className="card">
          <div className="dash-title">{t('By tax bracket')}</div>
          <div className="tax-brackets">
            {status.bracket_rows.map((r, i) => (
              <div className="tax-bracket-row" key={i}>
                <span>{(r.rate * 100).toFixed(0)}%</span>
                <span className="muted">{fmt(r.income_in_band)} {currency}</span>
                <span className="money">{fmt(r.tax)} {currency}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// Generic allowance control: fixed (read-only), flag (checkbox), count (integer),
// amount (THB), rendered from the spec so new allowances need no bespoke UI.
function AllowanceInput({ def, values, currency, onChange }: { def: AllowanceDef; values: AllowanceValues; currency: string; onChange: (v: number | boolean) => void }) {
  const v = values[def.key]
  if (def.type === 'fixed') {
    return (
      <div className="tax-allow fixed">
        <span className="tax-allow-label">{t(def.label)}</span>
        <span className="money tax-allow-fixed">{fmt(def.amount ?? 0)} {currency}</span>
      </div>
    )
  }
  if (def.type === 'flag') {
    return (
      <label className="tax-allow flag">
        <input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} />
        <span className="tax-allow-label">{t(def.label)}</span>
        <span className="set-hint">{t(def.hint)}</span>
      </label>
    )
  }
  const isCount = def.type === 'count'
  return (
    <label className="tax-allow amount">
      <span className="tax-allow-label">{t(def.label)}{isCount && def.unit ? ` (${t(def.unit)})` : ''}</span>
      <input
        value={v == null || v === 0 ? '' : String(v)}
        onChange={(e) => onChange(num(e.target.value))}
        type="number"
        inputMode={isCount ? 'numeric' : 'decimal'}
        placeholder={isCount ? '0' : `0 ${currency}`}
      />
      <span className="set-hint">{t(def.hint)}</span>
    </label>
  )
}

function Total({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="calc-total">
      <span className="calc-total-label">{label}</span>
      <span className={`calc-total-value${accent ? ' accent' : ''}`}>{value}</span>
    </div>
  )
}
