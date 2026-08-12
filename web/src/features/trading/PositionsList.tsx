import { t } from '../../i18n'
import type { PositionRow } from '../../lib/trading/broker/analytics'
import { lev, money, pct, price as fmtPrice, qty as fmtQty, signedMoney } from './fmt'
import type { TradingView } from './useTrading'

// Open positions. One row each, and a one-tap close on every one of them.
//
// The close button is a market order for the whole position at the opposite side,
// which is the only exit a paper trader reaches for often enough to deserve a
// control. It goes through `runtime.place` like every other order, so it pays the
// same fees and the same slippage — a "close" that settled at the mark would
// quietly flatter every result on this page.

export function PositionsList({ view }: { view: TradingView }) {
  const { positions, currency, runtime } = view

  if (positions.length === 0) {
    return (
      <section className="card">
        <div className="dash-title">{t('Positions')}</div>
        <p className="muted tr-empty">{t('Nothing open. Your first order will show up here.')}</p>
      </section>
    )
  }

  const close = (row: PositionRow) => {
    runtime.place({
      symbol: row.symbol,
      side: row.qty > 0 ? 'sell' : 'buy',
      type: 'market',
      mode: 'shares',
      qty: Math.abs(row.qty),
      reduceOnly: true,
      leverage: row.leverage,
      tif: 'gtc',
    })
  }

  return (
    <section className="card">
      <div className="dash-title">{t('Positions')}</div>
      <div className="tr-rows">
        {positions.map((row) => (
          <PositionRowView key={row.symbol} row={row} currency={currency} onClose={() => close(row)} />
        ))}
      </div>
    </section>
  )
}

function PositionRowView({ row, currency, onClose }: { row: PositionRow; currency: string; onClose: () => void }) {
  const up = row.unreal >= 0
  // Precision from the position's own price, not from a global: a DOGE position
  // and a BTC position on the same screen need different decimals.
  const precision = row.price >= 1000 ? 1 : row.price >= 1 ? 2 : 6

  return (
    <div className="tr-row">
      <div className="tr-row-main">
        <span className="tr-row-sym">
          {row.label}
          <span className={`tr-side-chip ${row.qty > 0 ? 'is-long' : 'is-short'}`}>
            {row.qty > 0 ? t('Long') : t('Short')}
          </span>
          {row.leverage != null && row.leverage > 1 && <span className="tr-lev-chip">{lev(row.leverage)}</span>}
        </span>
        <span className={`tr-row-pnl money ${up ? 'is-up' : 'is-down'}`}>
          {signedMoney(row.unreal)}
          <span className="tr-row-pnl-pct">{pct(row.unrealPct)}</span>
        </span>
      </div>

      <div className="tr-row-meta">
        <span className="money">{fmtQty(Math.abs(row.qty))}</span>
        {' · '}
        {t('avg {price}', { price: fmtPrice(row.avgCost, precision) })}
        {' · '}
        {t('mark {price}', { price: fmtPrice(row.price, precision) })}
        {row.liqPrice != null && row.liqPrice > 0 && (
          <>
            {' · '}
            <span className="tr-liq-inline">{t('liq {price}', { price: fmtPrice(row.liqPrice, precision) })}</span>
          </>
        )}
        {row.fundingPaid != null && row.fundingPaid !== 0 && (
          <>{' · '}{t('funding {amount}', { amount: signedMoney(-row.fundingPaid) })}</>
        )}
      </div>

      {row.greeks && (
        <div className="tr-row-meta tr-greeks">
          {t('Δ {delta} · Γ {gamma} · ν {vega} · Θ {theta}', {
            delta: row.greeks.delta.toFixed(3),
            gamma: row.greeks.gamma.toFixed(5),
            vega: row.greeks.vega.toFixed(3),
            theta: row.greeks.theta.toFixed(3),
          })}
        </div>
      )}

      <div className="tr-row-foot">
        <span className="muted tr-row-value money">{money(row.value)} {currency}</span>
        <button type="button" className="btn sm ghost tr-close-btn" onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  )
}
