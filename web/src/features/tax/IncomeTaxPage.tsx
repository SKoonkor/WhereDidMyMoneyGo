import { useMemo, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTax, getCategories, patchTax, updateTaxSelections } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { useSettings } from '../transactions/useConfig'
import {
  specFor, allowanceDefs, incomeTaxStatus, grossIncomeForYear, taxPaidForYear,
  ledgerYears, toggleTaxSelection, selectionState, selKey, type TaxCfg, type AllowanceDef, type AllowanceValues,
} from '../../lib/analytics/income_tax'
import { t } from '../../i18n'
import { NumberField } from '../../components/NumberField'

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
  // Read-modify-write in one transaction, so a tap right after another can't write a stale snapshot back.
  const save = (patch: Partial<TaxCfg>) => { void patchTax(() => patch) }

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
  const toggleIncome = (name: string) => void patchTax((c) => {
    const next = new Set(c.incomeSelections ?? [])
    if (next.has(name)) next.delete(name); else next.add(name)
    return { incomeSelections: [...next] }
  })

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
          <NumberField mode="calc" label={t('Gross income ({currency})', { currency })} value={grossStr} onChange={setGrossStr} />
        </label>
        <button type="button" className="inline-link tax-refill" onClick={() => setGrossStr(String(Math.round(ledgerGross)))}>
          {t('↻ From ledger ({year}): {amount} {currency}', { year, amount: fmt(ledgerGross), currency })}
        </button>
        {incomeCats.length > 0 && (
          <>
            <div className="set-hint" style={{ marginTop: 10 }}>{t('Count only these income categories (none = all):')}</div>
            <div className="chip-choices">
              {incomeCats.map((c) => (
                <button key={c} type="button" className={incomeSel.has(c) ? 'choice-chip on' : 'choice-chip'} onClick={() => toggleIncome(c)}>{c}</button>
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
          <TaxPaidPicker
            expense={cats?.expense ?? {}}
            selections={cfg.taxSelections ?? []}
            onChange={(fn) => void updateTaxSelections(fn)}
          />
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
      <NumberField
        mode={isCount ? 'digits' : 'calc'}
        label={t(def.label)}
        value={v == null || v === 0 ? '' : String(v)}
        onChange={(s) => onChange(num(s))}
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

// Expense categories as tappable chips. A category with sub-categories opens an
// inline strip (the Spending limits pattern): "All <category>" picks the whole
// thing, the other chips pick single sub-categories. Plain taps only.
function TaxPaidPicker({ expense, selections, onChange }: {
  expense: Record<string, string[]>
  selections: string[]
  onChange: (update: (cur: string[]) => string[]) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  // `mounted`/`shown` keep the strip in the DOM through the collapse transition.
  const [mounted, setMounted] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (expanded) {
      setMounted(expanded)
      const r = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(r)
    }
    setShown(false)
    const tm = setTimeout(() => setMounted(null), 260)
    return () => clearTimeout(tm)
  }, [expanded])

  const pick = (cat: string, sub: string | null) =>
    onChange((cur) => toggleTaxSelection(cur, cat, sub, expense[cat] ?? []))

  const chosen = Object.keys(expense).flatMap((cat) => {
    const { whole, picked } = selectionState(selections, cat, expense[cat] ?? [])
    return whole ? [cat] : picked.map((s) => selKey(cat, s))
  })

  return (
    <>
      <div className="budget-chip-list">
        {Object.keys(expense).map((cat) => {
          const subs = expense[cat] ?? []
          const { whole, picked } = selectionState(selections, cat, subs)
          const hasSubs = subs.length > 0
          const cls = `budget-chip tax-chip${whole ? ' on' : picked.length ? ' partial' : ''}`
          return (
            <button
              key={cat} type="button" className={cls}
              {...(hasSubs ? { 'aria-expanded': expanded === cat } : { 'aria-pressed': whole })}
              onClick={() => (hasSubs ? setExpanded((cur) => (cur === cat ? null : cat)) : pick(cat, null))}
            >
              {cat}
              {!whole && picked.length > 0 && <span className="budget-chip-amt">{picked.length}</span>}
              {hasSubs && <span className="cat-caret">{expanded === cat ? '▴' : '▾'}</span>}
            </button>
          )
        })}
      </div>

      <div className={shown ? 'budget-subwrap tax-subwrap open' : 'budget-subwrap tax-subwrap'}>
        <div className="budget-subgrid">
          {mounted && (
            <>
              <div className="budget-substrip-head muted">
                {mounted} · {t('Tap to include in tax already paid')}
              </div>
              <div className="budget-chip-list">
                {(() => {
                  const subs = expense[mounted] ?? []
                  const { whole, picked } = selectionState(selections, mounted, subs)
                  return (
                    <>
                      <button type="button" className={`budget-chip tax-chip${whole ? ' on' : ''}`} aria-pressed={whole} onClick={() => pick(mounted, null)}>
                        {t('All {category}', { category: mounted })}
                      </button>
                      {subs.map((sub) => {
                        const on = whole || picked.includes(sub)
                        return (
                          <button key={sub} type="button" className={`budget-chip sub tax-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => pick(mounted, sub)}>
                            {sub}
                          </button>
                        )
                      })}
                    </>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      </div>

      {chosen.length > 0 && (
        <p className="set-hint" style={{ marginTop: 8 }}>
          {t('Counting')}: {chosen.map((c) => c.replace(' / ', ' › ')).join(', ')}
        </p>
      )}
    </>
  )
}
