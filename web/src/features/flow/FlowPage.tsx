import { useEffect, useMemo, useRef, useState } from 'react'
import { useMoneyFlow, FLOW_PLOT_CONFIG } from './useMoneyFlow'
import { Plot } from '../../components/Plot'
import { t } from '../../i18n'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const HORIZONS: Array<{ label: string; days: number }> = [
  { label: '30 d', days: 30 },
  { label: '90 d', days: 90 },
  { label: '180 d', days: 180 },
  { label: '1 y', days: 365 },
]

export function FlowPage() {
  const [horizon, setHorizon] = useState(30)
  const [sliderIdx, setSliderIdx] = useState(0)

  const { fig, fc, flow, currency, censor } = useMoneyFlow(horizon, 60)

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

  // Default the slider to day 0 (today) when the horizon changes.
  useEffect(() => { setSliderIdx(0) }, [stops.length])

  const idx = Math.min(sliderIdx, Math.max(stops.length - 1, 0))
  const dayOffset = stops[idx] ?? 0
  const sliderDate = fc ? fc.dates[dayOffset] : ''
  const sliderAmount = fc ? fc.median[dayOffset] : 0
  const finalDate = fc ? fc.dates[fc.dates.length - 1] : ''

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
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>
        {t('Running balance across your accounts, with a forward forecast.')}
      </p>

      {/* Plot first, then the forecast controls below it. */}
      <div className="card" style={{ padding: 8 }}>
        <Plot data={fig.data} layout={fig.layout} config={FLOW_PLOT_CONFIG} ariaLabel={t('Money Flow')} style={{ width: '100%' }} />
      </div>

      {/* Latest balances live in their own box below the plot. */}
      {flow.bars.length > 0 && (
        <div className="card flow-balances">
          <div className="flow-bal-title">{t('Latest balances')}</div>
          <ul className="flow-bal-list">
            {flow.accounts.map((a) => (
              <li key={a}>
                <span className="flow-bal-name">{a}</span>
                <span className="flow-bal-amt">{censor ? '*****' : fmt(flow.latestBalances[a] ?? 0)} {currency}</span>
              </li>
            ))}
            {flow.hidden !== 0 && (
              <li className="muted">
                <span className="flow-bal-name">{t('Hidden cost (untracked)')}</span>
                <span className="flow-bal-amt">
                  {censor ? '*****' : (flow.hidden >= 0 ? '+' : '') + fmt(flow.hidden)} {currency}
                </span>
              </li>
            )}
          </ul>
          <div className="flow-bal-net">
            <span>{t('Net worth')}</span>
            <span>{censor ? '*****' : fmt(flow.netWorth)} {currency}</span>
          </div>
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
            <b>{censor ? '*****' : fmt(sliderAmount)} {currency}</b>{' '}
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
          {t('Add a few more weeks of history to see a forecast.')}
        </p>
      )}
    </div>
  )
}
