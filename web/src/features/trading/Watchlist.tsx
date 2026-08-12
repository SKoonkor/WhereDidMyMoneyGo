import { t } from '../../i18n'
import { pct, price as fmtPrice } from './fmt'
import { spotOf } from './marketView'
import type { TradingView } from './useTrading'

// The symbol strip above the chart.
//
// A horizontal scroller rather than a dropdown: switching instrument is the most
// frequent thing a user does on this screen, and a picker that costs two taps and
// hides the price is a picker they stop using. Each chip carries its own 24h
// change, so the strip doubles as the market overview every real client puts here.

export function Watchlist({ view }: { view: TradingView }) {
  const { runtime, cfg } = view
  const symbols = runtime.feed.symbols()
  const active = spotOf(cfg.symbol)

  return (
    <div className="tr-watchlist" role="tablist" aria-label={t('Symbols')}>
      {symbols.map((sym) => {
        const q = runtime.quote(sym)
        const change = q && q.open24h > 0 ? ((q.last - q.open24h) / q.open24h) * 100 : 0
        const inst = runtime.market.instrument(sym)
        const precision = inst && 'pricePrecision' in inst ? inst.pricePrecision : 2
        const on = sym === active
        return (
          <button
            key={sym}
            type="button"
            role="tab"
            aria-selected={on}
            className={`tr-wl-chip${on ? ' is-on' : ''}`}
            onClick={() => runtime.setSymbol(sym)}
          >
            <span className="tr-wl-sym">{sym}</span>
            <span className="tr-wl-px money">{q ? fmtPrice(q.last, precision) : '—'}</span>
            <span className={`tr-wl-chg ${change >= 0 ? 'is-up' : 'is-down'}`}>{pct(change)}</span>
          </button>
        )
      })}
    </div>
  )
}
