import { useEffect, useMemo, useRef, useState } from 'react'
import { useMoneyFlow, FLOW_PLOT_CONFIG } from './useMoneyFlow'
import { Plot } from '../../components/Plot'
import { ChipPicker } from '../transactions/ChipPicker'
import { useTheme } from '../../prefs'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// The page gives the chart 2.5x the Home widget's 184px box — this is the main
// view of the data, not a tile, so it gets the room to read the balance line.
const PAGE_PLOT_H = 460

const HORIZONS: Array<{ label: string; days: number }> = [
  { label: '30 d', days: 30 },
  { label: '90 d', days: 90 },
  { label: '180 d', days: 180 },
  { label: '1 y', days: 365 },
]

export function FlowPage() {
  const [horizon, setHorizon] = useState(30)
  const [sliderIdx, setSliderIdx] = useState(0)
  const [theme] = useTheme()
  // '' = the whole ledger (the default view).
  const [account, setAccount] = useState('')

  const { fig, fc, flow, flowAll, currency, censor } = useMoneyFlow(horizon, 60, account || null, PAGE_PLOT_H)

  // Slider stops: day-offsets from today (0) out to the horizon — daily for the
  // 30-day view, weekly for the longer horizons (> 45 d).
  const stops = useMemo(() => {
    if (!fc) return [] as number[]
    const step = horizon <= 45 ? 1 : 7
    const s: number[] = []
    for (let d = 0; d <= horizon; d += step) s.push(d)
    if (s[s.length - 1] !== horizon) s.push(horizon)
    return s
  }, [fc, horizon])

  // Default the slider to day 0 (today) when the horizon changes — and when the
  // account changes, since that forecast has its own dates.
  useEffect(() => { setSliderIdx(0) }, [stops.length, account])

  const idx = Math.min(sliderIdx, Math.max(stops.length - 1, 0))
  const dayOffset = stops[idx] ?? 0
  const sliderDate = fc ? fc.dates[dayOffset] : ''
  const sliderAmount = fc ? fc.median[dayOffset] : 0
  const finalDate = fc ? fc.dates[fc.dates.length - 1] : ''

  // A blue dot on the forecast line at the slider's date/amount — it moves with
  // the slider to show where the projected net worth lands. Ringed in the card
  // colour so it reads cleanly on the dashed forecast line in either theme. Built
  // here (not in the memoized figure) so only this light marker updates on scrub.
  const ringColor = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#273140',
    [theme],
  )
  const plotData = useMemo(() => {
    if (!fc || stops.length <= 1 || !sliderDate) return fig.data
    const dot = {
      type: 'scatter',
      mode: 'markers',
      x: [sliderDate],
      y: [sliderAmount],
      marker: { color: '#3498db', size: 12, line: { color: ringColor, width: 2.5 } },
      hoverinfo: 'skip',
      showlegend: false,
      cliponaxis: false,
    }
    return [...fig.data, dot]
  }, [fig.data, fc, stops.length, sliderDate, sliderAmount, ringColor])

  // Let the user tap anywhere on the track and drag from there — native range
  // inputs on touch only drag from the thumb, so drive the value from the
  // pointer position directly (with pointer capture for a continuous drag).
  const dragging = useRef(false)
  const idxFromPointer = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const frac = r.width ? (clientX - r.left) / r.width : 0
    return Math.max(0, Math.min(stops.length - 1, Math.round(frac * (stops.length - 1))))
  }

  return (
    <div>
      <h1 className="h1">{t('Money Flow')}</h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 14 }}>
        {t('Running balance across your accounts, with a forward forecast.')}
      </p>

      {/* Plot first, then the forecast controls below it. */}
      <div className="card" style={{ padding: 8 }}>
        <Plot data={plotData} layout={fig.layout} config={FLOW_PLOT_CONFIG} ariaLabel={t('Money Flow')} style={{ width: '100%' }} />
      </div>

      {/* Latest balances live in their own box below the plot. Always the whole
          ledger — the point of the list is the comparison, so filtering the plot
          bolds the picked account rather than hiding the others. */}
      {flowAll.bars.length > 0 && (
        <div className="card flow-balances">
          <div className="flow-bal-title">{t('Latest balances')}</div>
          <ul className="flow-bal-list">
            {flowAll.accounts.map((a) => (
              <li key={a} className={a === account ? 'is-selected' : undefined}>
                <span className="flow-bal-name">{a}</span>
                <span className="flow-bal-amt">{censor ? '*****' : fmt(flowAll.latestBalances[a] ?? 0)} {currency}</span>
              </li>
            ))}
            {flowAll.hidden !== 0 && (
              <li className="muted">
                <span className="flow-bal-name">{t('Hidden cost (untracked)')}</span>
                <span className="flow-bal-amt">
                  <span className="money">{censor ? '*****' : (flowAll.hidden >= 0 ? '+' : '') + fmt(flowAll.hidden)}</span> {currency}
                </span>
              </li>
            )}
          </ul>
          <div className="flow-bal-net">
            <span>{t('Net worth')}</span>
            <span><span className="money">{censor ? '*****' : fmt(flowAll.netWorth)}</span> {currency}</span>
          </div>
        </div>
      )}

      {/* Scope the plot to one account. Sits under the balances list so that
          list stays adjacent to the plot it annotates. Options come from the
          accounts that actually have transactions, not the configured list, so
          picking one can never produce an empty chart. */}
      {flowAll.accounts.length > 1 && (
        <div className="card flow-account-card">
          <div className="flow-bal-title">{t('Show one account')}</div>
          <ChipPicker
            value={account || t('All accounts')}
            options={[t('All accounts'), ...flowAll.accounts]}
            onChange={(v) => setAccount(v === t('All accounts') ? '' : v)}
            title={t('Account')}
          />
          {account && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              {t('Plot and forecast show {account} only.', { account })}
            </p>
          )}
        </div>
      )}

      <div className="flow-controls">
        <span className="muted" style={{ fontSize: 13 }}>{t('Forecast')}:</span>
        <div className="seg">
          {HORIZONS.map((h) => (
            <button
              key={h.days}
              type="button"
              className={h.days === horizon ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setHorizon(h.days)}
            >
              {t(h.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Forecast slider: scrub from today to the horizon to read the projection. */}
      {fc && stops.length > 1 && (
        <div className="card flow-slider">
          <div className="flow-slider-read">
            {t('Forecast amount')}:{' '}
            <b><span className="money">{censor ? '*****' : fmt(sliderAmount)}</span> {currency}</b>{' '}
            {t('on')} {fmtDay(sliderDate)}
          </div>
          <input
            className="flow-range"
            type="range"
            min={0}
            max={stops.length - 1}
            step={1}
            value={idx}
            onChange={(e) => setSliderIdx(Number(e.target.value))}
            onPointerDown={(e) => {
              dragging.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              setSliderIdx(idxFromPointer(e.clientX, e.currentTarget))
            }}
            onPointerMove={(e) => {
              if (dragging.current) setSliderIdx(idxFromPointer(e.clientX, e.currentTarget))
            }}
            onPointerUp={(e) => {
              dragging.current = false
              try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
            }}
            aria-label={t('Forecast amount')}
          />
          <div className="flow-range-ends muted">
            <span>{t('Today')}</span>
            <span>{fmtDay(finalDate)}</span>
          </div>
        </div>
      )}

      {!fc && flow.bars.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {account
            ? t('Add a few more weeks of history for this account to see a forecast.')
            : t('Add a few more weeks of history to see a forecast.')}
        </p>
      )}
      {/* A picked account with no transactions at all in the window. */}
      {flow.bars.length === 0 && flowAll.bars.length > 0 && account && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {t('No transactions for {account} yet.', { account })}
        </p>
      )}

      {fc && (
        <p className="flow-disclaimer">
          {t('The forecast is not a guarantee of future wealth. It only shows what your balance could look like if your past spending and income habits continued.')}
        </p>
      )}
    </div>
  )
}
