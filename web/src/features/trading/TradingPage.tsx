import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'
import type { Timeframe } from '../../lib/trading/types'
import { TIMEFRAMES } from './runtime'
import { useTrading } from './useTrading'
import type { TradingView } from './useTrading'
import { ChartPanel } from './ChartPanel'
import { INDICATOR_DEFS, INDICATOR_IDS } from './overlays'
import { DisclaimerGate } from './DisclaimerGate'
import { SimBadge } from './SimBadge'
import { OrderTicket } from './OrderTicket'
import { OrdersList } from './OrdersList'
import { PositionsList } from './PositionsList'
import { DepthPanel } from './DepthPanel'
import { Watchlist } from './Watchlist'
import { SpeedControl } from './SpeedControl'
import { Blotter } from './Blotter'
import { money, pct, price as fmtPrice, signedMoney } from './fmt'
import './trading.css'

// The main screen. Its order is not arbitrary — §E fixes it:
//
//   chart (≥ 360px) → a 44px timeframe row → the ticket
//
// Everything below that is reference material the user scrolls to. Anything above
// the ticket is what they came for, and on a 390×844 phone the chart plus the
// timeframe row plus the top of the ticket is the whole first screen.

/**
 * Why live mode is not on. A `LiveNotice` code in, a sentence out — the same
 * split `errors.ts` makes for `TradeErrorCode`, so the runtime never holds a word
 * a translator cannot reach.
 */
function liveNoticeMessage(n: TradingView['runtime']['liveNotice']): string | null {
  if (n === 'offline') return t('No connection, so the simulated market stayed on.')
  if (n === 'unreachable') return t('Could not reach the exchange, so the simulated market stayed on.')
  return null
}

const CHART_TYPES: { id: TradingView['cfg']['chartType']; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'hollow', label: 'Hollow' },
  { id: 'heikin', label: 'Heikin-Ashi' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
]

export function TradingPage() {
  const view = useTrading()
  const [settings, setSettings] = useState(false)

  // §E: never a spinner over an empty box. The skeleton below is the real page's
  // chrome — the chart's own grid and both axis strips — drawn in CSS at the
  // exact sizes the live chart will use, so the layout does not move when the
  // world finishes loading.
  if (!view) return <TradingSkeleton />

  if (!view.cfg.disclaimerAcceptedAt) return <DisclaimerGate runtime={view.runtime} />

  const { runtime, cfg, summary, quote, precision, currency, account } = view
  const change24 = quote && quote.open24h > 0 ? ((quote.last - quote.open24h) / quote.open24h) * 100 : 0
  const level = summary.margin.marginLevel
  const liveNote = liveNoticeMessage(runtime.liveNotice)

  return (
    <div className="tr-page">
      <div className="tr-topline">
        <div>
          <h1 className="h1 tr-h1">
            {t('Paper trading')}
            <SimBadge />
          </h1>
          <p className="muted page-desc tr-desc">{t('A market simulator. No real money, ever.')}</p>
        </div>
        <Link to="/trading/accounts" className="tr-equity-pill">
          <span className="tr-label">{t('Equity')}</span>
          <span className="tr-num money">{money(summary.equity)}</span>
          <span className={`tr-pill-chg ${summary.dayChange >= 0 ? 'is-up' : 'is-down'}`}>
            {signedMoney(summary.dayChange)}
          </span>
        </Link>
      </div>

      {/* A margin call is the one thing on this page that must interrupt. Inline
          rather than modal — a modal over a falling position stops the user
          closing it. */}
      {Number.isFinite(level) && level < 150 && (
        <p className="tr-alert" role="alert">
          {t('Margin level {pct}%. Positions are closed automatically below 100%.', { pct: level.toFixed(0) })}
        </p>
      )}

      {/* Live mode asked for and not delivered. On the page rather than in the
          settings sheet, because the fall-back can happen fifteen seconds after
          the sheet was closed and a message nobody is looking at is no message. */}
      {liveNote && <p className="tr-alert" role="status">{liveNote}</p>}

      <Watchlist view={view} />

      <div className="tr-quote">
        <span className="tr-quote-px money">{quote ? fmtPrice(quote.last, precision) : '—'}</span>
        <span className={`tr-quote-chg ${change24 >= 0 ? 'is-up' : 'is-down'}`}>{pct(change24)}</span>
        <span className="muted tr-quote-24h">
          {quote
            ? t('24h {low} – {high}', { low: fmtPrice(quote.low24h, precision), high: fmtPrice(quote.high24h, precision) })
            : t('Warming up…')}
        </span>
      </div>

      <ChartPanel view={view} />

      {/* 44px tall, every chip a full tap target. §E singles the timeframe chips
          out because they are the control people hit most and miss most. */}
      <div className="tr-tf-row">
        <div className="seg tr-tf-seg" role="tablist" aria-label={t('Timeframe')}>
          {TIMEFRAMES.map((tf: Timeframe) => (
            <button
              key={tf}
              type="button"
              role="tab"
              aria-selected={cfg.timeframe === tf}
              className={`seg-btn tr-tf-btn${cfg.timeframe === tf ? ' active' : ''}`}
              onClick={() => runtime.setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <button type="button" className="tr-chip tr-gear" onClick={() => setSettings(true)} aria-label={t('Chart settings')}>
          ⚙
        </button>
      </div>

      <OrderTicket view={view} />

      <PositionsList view={view} />
      <OrdersList view={view} />
      <DepthPanel view={view} />

      <SpeedControl view={view} />

      <Blotter view={view} limit={12} />

      <div className="tr-links">
        <Link to="/trading/accounts" className="tr-link-card">
          <span className="tr-link-title">{t('Accounts')}</span>
          <span className="muted">{t('{n} accounts · deposits, history and reset', { n: String(view.accounts.length) })}</span>
        </Link>
        <Link to="/trading/options" className="tr-link-card">
          <span className="tr-link-title">{t('Options')}</span>
          <span className="muted">{t('Calls and puts on {symbol}', { symbol: cfg.symbol })}</span>
        </Link>
      </div>

      {settings && (
        <Modal title={t('Chart settings')} onClose={() => setSettings(false)}>
          <div className="tr-settings">
            <div className="tr-set-group">
              <span className="tr-label">{t('Chart type')}</span>
              <div className="tr-chips">
                {CHART_TYPES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`tr-chip${cfg.chartType === c.id ? ' is-on' : ''}`}
                    onClick={() => runtime.patchCfg({ chartType: c.id })}
                  >
                    {t(c.label)}
                  </button>
                ))}
              </div>
            </div>

            <div className="tr-set-group">
              <span className="tr-label">{t('Indicators')}</span>
              <div className="tr-chips">
                {INDICATOR_IDS.map((id) => {
                  const on = cfg.indicators.includes(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`tr-chip${on ? ' is-on' : ''}`}
                      onClick={() => runtime.patchCfg({
                        indicators: on ? cfg.indicators.filter((x) => x !== id) : [...cfg.indicators, id],
                      })}
                    >
                      {INDICATOR_DEFS[id].label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Market data. Plain chips, same as every other group here — the
                switch disposes one feed and builds the other, and the page
                re-points itself; nothing about that needs its own screen. */}
            <div className="tr-set-group">
              <span className="tr-label">{t('Market data')}</span>
              <div className="tr-chips">
                <button
                  type="button"
                  className={`tr-chip${cfg.mode === 'sim' ? ' is-on' : ''}`}
                  onClick={() => { void runtime.switchMode('sim') }}
                >
                  {t('Simulated')}
                </button>
                <button
                  type="button"
                  className={`tr-chip${cfg.mode === 'live' ? ' is-on' : ''}`}
                  onClick={() => { void runtime.switchMode('live') }}
                >
                  {t('Live crypto')}
                </button>
              </div>
              <p className="muted tr-set-note">
                {t('Live streams real prices from a public crypto exchange, and needs a connection. Your money, orders and positions stay simulated either way.')}
              </p>
              {liveNote && <p className="muted tr-set-note">{liveNote}</p>}
            </div>

            <label className="tr-check">
              <input type="checkbox" checked={cfg.showDepth} onChange={(e) => runtime.patchCfg({ showDepth: e.target.checked })} />
              <span>{t('Show order book depth')}</span>
            </label>
            <label className="tr-check">
              <input type="checkbox" checked={cfg.colorBlind} onChange={(e) => runtime.patchCfg({ colorBlind: e.target.checked })} />
              <span>{t('Colour-blind palette (blue / orange)')}</span>
            </label>

            <p className="muted tr-set-note">
              {t('Account {name} · {cash} {currency} cash', {
                name: account.name, cash: money(summary.cash), currency,
              })}
            </p>

            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setSettings(false)}>{t('Done')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * The loading state.
 *
 * §E is explicit: never a spinner over an empty box — draw the grid and both axes
 * immediately, because they need no data. Real chrome from frame 1 is the entire
 * trick, and it is the state a critic screenshots first.
 */
function TradingSkeleton() {
  return (
    <div className="tr-page">
      <div className="tr-topline">
        <div>
          <h1 className="h1 tr-h1">
            {t('Paper trading')}
            <SimBadge />
          </h1>
          <p className="muted page-desc tr-desc">{t('A market simulator. No real money, ever.')}</p>
        </div>
      </div>
      <div className="tr-skel-strip" aria-hidden="true" />
      <div className="tr-chart-wrap tr-skel-chart" style={{ height: 360 }} role="status" aria-label={t('Loading…')}>
        <div className="tr-skel-plot" aria-hidden="true" />
        <div className="tr-skel-price" aria-hidden="true" />
        <div className="tr-skel-time" aria-hidden="true" />
      </div>
      <div className="tr-tf-row">
        <div className="seg tr-tf-seg">
          {TIMEFRAMES.map((tf) => (
            <span key={tf} className="seg-btn tr-tf-btn is-skel">{tf}</span>
          ))}
        </div>
      </div>
      <section className="card tr-ticket tr-skel-ticket" aria-hidden="true">
        <div className="seg tr-side-seg">
          <span className="seg-btn tr-side-btn" />
          <span className="seg-btn tr-side-btn" />
        </div>
        <div className="tr-skel-line" />
        <div className="tr-skel-line" />
      </section>
    </div>
  )
}
