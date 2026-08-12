import { useLang } from '../../prefs'
import { t } from '../../i18n'
import type { Trade } from '../../lib/trading/broker/types'
import { money, price as fmtPrice, qty as fmtQty, signedMoney, stamp } from './fmt'
import type { TradingView } from './useTrading'

// Every change to cash, in one list.
//
// Deposits, funding, liquidations and settlements share the blotter with ordinary
// fills on purpose: it is the only view in which the account's cash balance
// explains itself. A blotter that showed fills alone would have unexplained gaps
// exactly where the interesting things happened.

const SIDE_LABEL: Record<Trade['side'], string> = {
  buy: 'Buy',
  sell: 'Sell',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  funding: 'Funding',
  liquidation: 'Liquidated',
  settlement: 'Settled',
}

export function Blotter({ view, limit = 40 }: { view: TradingView; limit?: number }) {
  const [lang] = useLang()
  const { trades, currency } = view
  const rows = trades.slice(0, limit)

  return (
    <section className="card">
      <div className="dash-title">{t('Activity')}</div>
      {rows.length === 0 ? (
        <p className="muted tr-empty">{t('No activity yet.')}</p>
      ) : (
        <div className="tr-rows">
          {rows.map((tr) => {
            const cash = tr.side === 'buy' || tr.side === 'withdraw' ? -tr.value : tr.value
            const notable = tr.side === 'liquidation' || tr.side === 'settlement'
            return (
              <div className={`tr-row tr-trade-row${notable ? ' is-notable' : ''}`} key={tr.id}>
                <div className="tr-row-main">
                  <span className="tr-row-sym">
                    <span className={`tr-side-chip ${sideTone(tr.side)}`}>{t(SIDE_LABEL[tr.side])}</span>
                    {tr.label || tr.symbol || currency}
                  </span>
                  <span className={`tr-row-pnl money ${cash >= 0 ? 'is-up' : 'is-down'}`}>
                    {signedMoney(cash)}
                  </span>
                </div>
                <div className="tr-row-meta">
                  {stamp(tr.t, lang)}
                  {tr.qty != null && <>{' · '}<span className="money">{fmtQty(Math.abs(tr.qty))}</span></>}
                  {tr.price != null && <>{' · '}<span className="money">{fmtPrice(tr.price, tr.price >= 1000 ? 1 : 2)}</span></>}
                  {tr.fee > 0 && <>{' · '}{t('fee {amount}', { amount: money(tr.fee) })}</>}
                  {tr.realized !== 0 && <>{' · '}{t('realised {amount}', { amount: signedMoney(tr.realized) })}</>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function sideTone(side: Trade['side']): string {
  if (side === 'buy' || side === 'deposit') return 'is-long'
  if (side === 'sell' || side === 'withdraw') return 'is-short'
  if (side === 'liquidation') return 'is-danger'
  return 'is-neutral'
}
