import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'
import { useTradingSheet, closeSheet } from '../../tradingMode'
import type { Timeframe } from '../../lib/trading/types'
import { TIMEFRAMES } from './runtime'
import { useTrading } from './useTrading'
import { ChartPanel } from './ChartPanel'
import { ChartSettings } from './ChartSettings'
import { liveNoticeMessage } from './errors'
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
//   chart (≥ 360px) → a 44px timeframe row → what you hold
//
// Everything below that is reference material the user scrolls to. The ticket
// used to sit under the timeframe row and eat the rest of the first screen; it
// now comes up from the bar's ＋ as a sheet, so the space it held goes to the
// positions the user came back to check.
//
// Both of the mode's sheets are rendered HERE rather than in the shell, and that
// is deliberate: the ticket needs a TradingView, which means `acquireRuntime()`.
// Rendering it from App would drag a chart engine, a market model, a broker and
// an options pricer into the eager bundle and defeat the lazy trading chunk. The
// bar only sets a flag; this page, which already holds the runtime, does the
// rendering.

export function TradingPage() {
  const view = useTrading()
  const sheet = useTradingSheet()

  // A sheet flagged on a screen that cannot render it is dropped, not queued.
  //
  // The bar raises the flag from any route and the shell then navigates here, so
  // the tap can land while the runtime is still loading or on an account that has
  // not accepted the disclaimer — neither of the two branches below renders a
  // sheet. Left set, the flag would survive until the real page mounted and pop
  // an order ticket seconds after the tap, possibly over the disclaimer the user
  // was reading. In an effect rather than during render: clearing a store mid-
  // render is a setState-in-render in disguise.
  const blocked = !view || !view.cfg.disclaimerAcceptedAt
  useEffect(() => {
    if (blocked && sheet !== null) closeSheet()
  }, [blocked, sheet])

  // §E: never a spinner over an empty box. The skeleton below is the real page's
  // chrome — the chart's own grid and both axis strips — drawn in CSS at the
  // exact sizes the live chart will use, so the layout does not move when the
  // world finishes loading.
  if (!view) return <TradingSkeleton />

  if (!view.cfg.disclaimerAcceptedAt) return <DisclaimerGate runtime={view.runtime} />

  const { runtime, cfg, summary, quote, precision } = view
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
      </div>

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

      {/* Both sheets, driven by the bar. Mutually exclusive by construction —
          `sheet` is one nullable field, so Settings while the ticket is open
          swaps rather than stacks. */}
      {sheet === 'ticket' && (
        <Modal title={t('Buy or sell')} onClose={closeSheet}>
          <OrderTicket view={view} onClose={closeSheet} />
        </Modal>
      )}

      {sheet === 'settings' && <ChartSettings view={view} onClose={closeSheet} />}
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
      {/* Positions-shaped, not ticket-shaped: the ticket is a sheet now, so a
          ticket here would promise a card that never arrives and the page would
          jump the moment the world loaded. Mirrors PositionsList's empty state. */}
      <section className="card tr-skel-positions" aria-hidden="true">
        <div className="dash-title">{t('Positions')}</div>
        <p className="muted tr-empty">{t('Nothing open. Your first order will show up here.')}</p>
      </section>
    </div>
  )
}
