import { t } from '../../i18n'
import { price as fmtPrice, qty as fmtQty } from './fmt'
import type { TradingView } from './useTrading'

// Resting orders. Nothing here has happened yet — which is exactly why each row
// needs its trigger price spelled out and a cancel button that is a real 44px
// target rather than a small ×.

const TYPE_LABEL: Record<string, string> = {
  market: 'Market', limit: 'Limit', stop: 'Stop', trailing: 'Trailing',
}

export function OrdersList({ view }: { view: TradingView }) {
  const { openOrders, runtime, precision } = view

  if (openOrders.length === 0) return null

  return (
    <section className="card">
      <div className="dash-title">{t('Open orders')}</div>
      <div className="tr-rows">
        {openOrders.map((o) => {
          const trigger = o.limit ?? o.stop
          return (
            <div className="tr-row tr-order-row" key={o.id}>
              <div className="tr-row-main">
                <span className="tr-row-sym">
                  <span className={`tr-side-chip ${o.side === 'buy' ? 'is-long' : 'is-short'}`}>
                    {o.side === 'buy' ? t('Buy') : t('Sell')}
                  </span>
                  {o.symbol}
                </span>
                <button
                  type="button"
                  className="btn sm ghost tr-close-btn"
                  onClick={() => runtime.cancel(o.id)}
                >
                  {t('Cancel')}
                </button>
              </div>
              <div className="tr-row-meta">
                {t(TYPE_LABEL[o.type] ?? 'Market')}
                {' · '}
                <span className="money">{fmtQty(o.qty)}</span>
                {trigger != null && <>{' · '}<span className="money">{fmtPrice(trigger, precision)}</span></>}
                {o.trail != null && <>{' · '}{t('trail {pct}%', { pct: String(o.trail) })}</>}
                {o.reduceOnly && <>{' · '}{t('reduce only')}</>}
                {' · '}
                {t('#{seq}', { seq: String(o.seq) })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
