import { useMemo, useState } from 'react'
import { getDebts, saveDebts } from '../../db'
import { useCensor, useTheme } from '../../prefs'
import {
  addMonths,
  debtServiceRatio,
  dsrTone,
  installmentPayment,
  newLoanStanding,
  simulatePayoff,
  type PayoffResult,
} from '../../lib/analytics/debt'
import { Plot } from '../../components/Plot'
import { buildDebtFigure } from './debtFigure'
import type { DebtsView } from './useDebts'
import type { PayoffStrategy } from '../../data/defaults'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// "3 years 2 months" — months alone stops meaning anything past about two years.
function duration(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y && m) return t('{y}y {m}m', { y: String(y), m: String(m) })
  if (y) return t('{y} years', { y: String(y) })
  return t('{m} months', { m: String(m) })
}

const other = (s: PayoffStrategy): PayoffStrategy => (s === 'avalanche' ? 'snowball' : 'avalanche')
const nameOf = (s: PayoffStrategy) => (s === 'avalanche' ? t('Avalanche') : t('Snowball'))

// The payoff plan and the what-if, sharing one simulator run each so the chart and
// the numbers above it can never tell different stories.
export function PayoffPlan({ view }: { view: DebtsView }) {
  const [censor] = useCensor()
  const [theme] = useTheme()
  const { standings, cfg, obligation, income, currency } = view

  // Draft of the extra payment. Committed on blur, like the pool settings fields —
  // so the box can be cleared and retyped without the plan jumping to zero.
  const [extra, setExtra] = useState(String(cfg.extraPayment || ''))
  const [borrowing, setBorrowing] = useState(false)
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [term, setTerm] = useState('60')

  const extraNum = Math.max(0, Number(extra) || 0)
  // With nothing extra, the plan IS "pay what the lender asks" — and that has to be
  // simulated as such rather than as a fixed budget frozen at today's minimums. A
  // revolving minimum shrinks every month, so a frozen budget would quietly turn
  // into a surplus and report a payoff the user never agreed to make.
  const monthly = extraNum > 0 ? obligation + extraNum : null
  const today = useMemo(() => new Date(), [])

  const patch = async (p: { strategy?: PayoffStrategy; extraPayment?: number }) => {
    const stored = await getDebts()
    await saveDebts({ ...stored, ...p })
  }

  const plan = useMemo(
    () => simulatePayoff(standings, monthly, cfg.strategy),
    [standings, monthly, cfg.strategy],
  )
  const alt = useMemo(
    () => simulatePayoff(standings, monthly, other(cfg.strategy)),
    [standings, monthly, cfg.strategy],
  )
  // The baseline the whole feature argues against: pay what the lender asks and
  // nothing more. Deliberately not a fixed budget — see simulatePayoff.
  const minimumOnly = useMemo(
    () => simulatePayoff(standings, null, cfg.strategy),
    [standings, cfg.strategy],
  )

  const loan = useMemo(() => {
    const amt = Number(amount)
    const apr = Number(rate)
    const months = Math.round(Number(term))
    if (!borrowing || !(amt > 0) || !Number.isFinite(apr) || apr < 0 || !(months > 0)) return null
    return { name: t('New borrowing'), amount: amt, apr, months }
  }, [borrowing, amount, rate, term])

  const scenario = useMemo(() => {
    if (!loan) return null
    const withLoan = [...standings, newLoanStanding(loan)]
    const added = installmentPayment(loan.amount, loan.apr, loan.months)
    return {
      added,
      result: simulatePayoff(withLoan, monthly === null ? null : monthly + added, cfg.strategy),
      dsr: debtServiceRatio(obligation + added, income),
    }
  }, [loan, standings, monthly, cfg.strategy, obligation, income])

  const fig = useMemo(() => buildDebtFigure({
    baseline: plan.balances,
    scenario: scenario?.result.balances,
    scenarioName: t('After borrowing'),
    currency,
    censor,
    ui: {
      ink: cssVar('--ink', '#e6e9ee'),
      muted: cssVar('--muted', '#8b93a1'),
      grid: cssVar('--border-soft', 'rgba(255,255,255,0.08)'),
      anno: cssVar('--surface-2', '#20242c'),
    },
    labels: {
      month: t('Months from now'),
      owed: (c) => t('Owed ({currency})', { currency: c }),
      baseline: t('Your plan'),
      scenario: t('After borrowing'),
    },
    // theme in the deps so the gridlines rebuild on toggle
  }), [plan, scenario, currency, censor, theme])

  const money = (n: number) => (censor ? '•••' : `${fmt(n)} ${currency}`)
  const when = (r: PayoffResult) =>
    r.months === null
      ? t('never')
      : addMonths(today, r.months).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })

  if (standings.length === 0) return null

  return (
    <>
      <section className="card">
        <div className="dash-title">{t('Payoff plan')}</div>

        <div className="seg" style={{ marginBottom: 12 }}>
          {(['avalanche', 'snowball'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`seg-btn${cfg.strategy === s ? ' active' : ''}`}
              onClick={() => void patch({ strategy: s })}
            >
              {nameOf(s)}
            </button>
          ))}
        </div>
        <p className="muted set-hint" style={{ marginTop: -6 }}>
          {cfg.strategy === 'avalanche'
            ? t('Highest interest rate first — the cheapest way out.')
            : t('Smallest balance first — the fastest way to cross one off.')}
        </p>

        <div className="set-field" style={{ marginTop: 10 }}>
          <label>{t('Extra each month, on top of the minimums')}</label>
          <input
            type="number"
            inputMode="decimal"
            value={extra}
            style={{ maxWidth: 160 }}
            onChange={(e) => setExtra(e.target.value)}
            onBlur={() => { setExtra(extraNum ? String(extraNum) : ''); void patch({ extraPayment: extraNum }) }}
          />
          <span className="set-hint">
            {monthly === null
              ? t('Minimums come to {min} a month. Add anything here and it goes at the top of the list.', { min: money(obligation) })
              : t('Minimums come to {min} a month, so this plan pays {total}.', { min: money(obligation), total: money(monthly) })}
          </span>
        </div>

        {plan.underfunded && (
          <p className="debt-verdict bad">
            {t('That is less than your minimum payments — the balances would grow, not shrink.')}
          </p>
        )}

        <div className="debt-figures">
          <Figure label={t('Debt-free')} value={when(plan)} />
          <Figure label={t('Takes')} value={plan.months === null ? '—' : duration(plan.months)} />
          <Figure label={t('Interest')} value={money(plan.totalInterest)} />
        </div>

        <Comparison plan={plan} alt={alt} strategy={cfg.strategy} money={money} />

        {minimumOnly.months !== plan.months && (
          <p className="debt-verdict warn">
            {minimumOnly.months === null
              ? t('Paying only the minimum, these debts never clear — the interest outruns the payment.')
              : t('Paying only the minimum would take {time} and cost {interest} in interest.', {
                time: duration(minimumOnly.months),
                interest: money(minimumOnly.totalInterest),
              })}
          </p>
        )}
      </section>

      <section className="card plot-card">
        <div className="dash-title">{t('What you still owe')}</div>
        <Plot data={fig.data} layout={fig.layout} ariaLabel={t('Payoff projection')} style={{ width: '100%' }} />
      </section>

      <section className="card">
        <div className="dash-title">{t('What if you borrowed more?')}</div>

        {!borrowing ? (
          <button type="button" className="btn" onClick={() => setBorrowing(true)}>
            {t('Try a new loan')}
          </button>
        ) : (
          <div className="debt-form">
            <div className="set-field">
              <label>{t('Amount')} ({currency})</label>
              <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="set-field">
              <label>{t('Interest rate (% a year)')}</label>
              <input type="number" inputMode="decimal" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div className="set-field">
              <label>{t('Over how many months')}</label>
              <input type="number" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>

            {scenario && (
              <>
                <div className="debt-figures">
                  <Figure label={t('Payment')} value={t('{amount}/mo', { amount: money(scenario.added) })} />
                  <Figure label={t('Debt-free')} value={when(scenario.result)} delta={deltaMonths(plan, scenario.result)} />
                  <Figure label={t('Interest')} value={money(scenario.result.totalInterest)} />
                </div>
                {income > 0 && (
                  <p className={`debt-verdict ${dsrTone(scenario.dsr)}`}>
                    {t('Your debt payments would go from {before}% to {after}% of your income.', {
                      before: view.dsr.toFixed(0), after: scenario.dsr.toFixed(0),
                    })}
                  </p>
                )}
              </>
            )}

            <button type="button" className="btn ghost" onClick={() => setBorrowing(false)}>
              {t('Clear')}
            </button>
          </div>
        )}
      </section>
    </>
  )
}

function Figure({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="debt-figure">
      <span className="debt-figure-label muted">{label}</span>
      <span className="debt-figure-value">{value}</span>
      {delta && <span className="debt-figure-delta">{delta}</span>}
    </div>
  )
}

const deltaMonths = (a: PayoffResult, b: PayoffResult): string | undefined => {
  if (a.months === null || b.months === null) return undefined
  const d = b.months - a.months
  return d === 0 ? undefined : d > 0 ? t('+{n} months', { n: String(d) }) : t('−{n} months', { n: String(-d) })
}

// What the other strategy would cost. Stated as a figure rather than an argument:
// on realistic balances the two are usually close enough that follow-through
// matters more than the arithmetic, and the user can only see that if we show it.
function Comparison({ plan, alt, strategy, money }: {
  plan: PayoffResult
  alt: PayoffResult
  strategy: PayoffStrategy
  money: (n: number) => string
}) {
  if (plan.months === null || alt.months === null) return null
  const dInterest = Math.round(alt.totalInterest - plan.totalInterest)
  const dMonths = alt.months - plan.months
  const label = nameOf(other(strategy))

  if (dInterest === 0 && dMonths === 0) {
    return (
      <p className="muted set-hint">
        {t('{other} finishes the same. Pick whichever you will actually stick to.', { other: label })}
      </p>
    )
  }
  const cost = dInterest > 0
    ? t('costs {amount} more', { amount: money(dInterest) })
    : t('saves {amount}', { amount: money(-dInterest) })
  const time = dMonths === 0
    ? t('and finishes at the same time')
    : dMonths > 0
      ? t('and finishes {n} months later', { n: String(dMonths) })
      : t('and finishes {n} months sooner', { n: String(-dMonths) })
  return <p className="muted set-hint">{`${label} ${cost} ${time}.`}</p>
}
