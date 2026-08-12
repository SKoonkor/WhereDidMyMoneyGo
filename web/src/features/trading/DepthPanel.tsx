import { t } from '../../i18n'
import { price as fmtPrice, qty as fmtQty } from './fmt'
import { spotOf } from './marketView'
import { useOrderBook } from './useTrading'
import type { TradingView } from './useTrading'

// The book, as a ladder with a depth bar behind each level.
//
// Read at 10 Hz, not 60: the book is rebuilt at most every BOOK_REBUILD_MS and the
// eye cannot follow a twenty-row table faster than that anyway. The hook copies
// every level, because the market engine reuses the level arrays in place and a
// held reference would show whatever the next rebuild happened to leave behind.

const ROWS = 8

export function DepthPanel({ view }: { view: TradingView }) {
  const { runtime, cfg, precision } = view
  const symbol = spotOf(cfg.symbol)
  const book = useOrderBook(runtime, symbol, cfg.showDepth)

  if (!cfg.showDepth) return null

  const bids = book?.bids.slice(0, ROWS) ?? []
  const asks = book?.asks.slice(0, ROWS) ?? []
  const peak = Math.max(1e-9, ...bids.map((l) => l.q), ...asks.map((l) => l.q))
  const spread = asks[0] && bids[0] ? asks[0].p - bids[0].p : 0

  return (
    <section className="card tr-depth">
      <div className="dash-title">{t('Order book')}</div>
      {!book ? (
        <p className="muted tr-empty">{t('Waiting for the book…')}</p>
      ) : (
        <>
          {/* Asks descend to the spread, bids fall away from it — the standard
              arrangement, so the best prices meet in the middle where the eye
              already is. */}
          <div className="tr-book">
            {[...asks].reverse().map((l, i) => (
              <Level key={`a${i}`} p={l.p} q={l.q} peak={peak} precision={precision} side="ask" />
            ))}
            <div className="tr-book-spread">
              <span className="tr-label">{t('Spread')}</span>
              <span className="tr-num money">{fmtPrice(spread, precision)}</span>
            </div>
            {bids.map((l, i) => (
              <Level key={`b${i}`} p={l.p} q={l.q} peak={peak} precision={precision} side="bid" />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Level({ p, q, peak, precision, side }: {
  p: number; q: number; peak: number; precision: number; side: 'bid' | 'ask'
}) {
  return (
    <div className={`tr-book-row is-${side}`}>
      <span className="tr-book-fill" style={{ width: `${Math.min(100, (q / peak) * 100)}%` }} aria-hidden="true" />
      <span className="tr-book-px money">{fmtPrice(p, precision)}</span>
      <span className="tr-book-qty money">{fmtQty(q, 4)}</span>
    </div>
  )
}
