import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { useLang } from '../../prefs'
import { t } from '../../i18n'
import type { ChainQuote } from '../../lib/trading/options/chain'
import { shortOptionMargin } from '../../lib/trading/options/chain'
import { DisclaimerGate } from './DisclaimerGate'
import { SimBadge } from './SimBadge'
import { tradeErrorMessage } from './errors'
import { money, price as fmtPrice, qty as fmtQty, stamp } from './fmt'
import { spotOf } from './marketView'
import { useChain, useExpiries, useTrading } from './useTrading'
import './trading.css'

// The chain, and a ticket for one contract at a time.
//
// A full two-sided grid (calls | strike | puts) is what every desktop platform
// shows and what no phone can show legibly: eighteen columns at 10px is a
// screenshot of a spreadsheet. So the chain is a strike ladder with ONE side
// selected at a time, which fits 390px at a readable size and is how the mobile
// apps that people actually use lay it out.
//
// Marks come from `buildChain`, which is deterministic in (params, spot, now,
// expiry). The ticket then places against the same synthetic symbol the chain
// names, and the market view prices it with the identical surface — so what is
// quoted is what fills.

export function OptionsPage() {
  const view = useTrading()
  const [lang] = useLang()
  const [right, setRight] = useState<'call' | 'put'>('call')
  const [expiryIdx, setExpiryIdx] = useState(0)
  const [ticket, setTicket] = useState<ChainQuote | null>(null)

  const rt = view?.runtime
  const expiries = useExpiries(rt)
  const underlying = view ? spotOf(view.cfg.symbol) : ''
  const expiry = expiries.length ? expiries[Math.min(expiryIdx, expiries.length - 1)] : null
  const chain = useChain(underlying, expiry)

  if (!view) return <p className="muted">{t('Loading…')}</p>
  // Same gate as the chart: this route is deep-linkable, and options are the last
  // thing that should be reachable without it.
  if (!view.cfg.disclaimerAcceptedAt) return <DisclaimerGate runtime={view.runtime} />

  const { precision, currency, quote } = view

  return (
    <div className="tr-page">
      <h1 className="h1 tr-h1">
        {t('Options')}
        <SimBadge />
      </h1>
      <p className="muted page-desc" style={{ marginTop: -4, marginBottom: 12 }}>
        {t('Simulated calls and puts on {symbol}. Cash-settled at expiry against a 30-minute average.', { symbol: underlying })}
      </p>

      <div className="tr-quote">
        <span className="tr-quote-px money">{quote ? fmtPrice(quote.markPrice, precision) : '—'}</span>
        <span className="muted tr-quote-24h">{t('spot')}</span>
      </div>

      <div className="tr-chips tr-expiries" role="tablist" aria-label={t('Expiry')}>
        {expiries.map((e, i) => (
          <button
            key={e}
            type="button"
            role="tab"
            aria-selected={i === expiryIdx}
            className={`tr-chip${i === expiryIdx ? ' is-on' : ''}`}
            onClick={() => setExpiryIdx(i)}
          >
            {stamp(e, lang)}
          </button>
        ))}
      </div>

      <div className="seg tr-seg-sm">
        <button type="button" className={`seg-btn${right === 'call' ? ' active is-income' : ''}`} onClick={() => setRight('call')}>
          {t('Calls')}
        </button>
        <button type="button" className={`seg-btn${right === 'put' ? ' active is-expense' : ''}`} onClick={() => setRight('put')}>
          {t('Puts')}
        </button>
      </div>

      <section className="card tr-chain">
        {!chain ? (
          <p className="muted tr-empty">{t('Building the chain…')}</p>
        ) : (
          <>
            <div className="tr-chain-head">
              <span>{t('Strike')}</span>
              <span>{t('Bid')}</span>
              <span>{t('Ask')}</span>
              <span>{t('IV')}</span>
              <span>{t('Δ')}</span>
            </div>
            {chain.rows.map((row) => {
              const q = right === 'call' ? row.call : row.put
              return (
                <button
                  key={row.strike}
                  type="button"
                  className={`tr-chain-row${q.itm ? ' is-itm' : ''}`}
                  onClick={() => setTicket(q)}
                >
                  <span className="tr-chain-strike money">{fmtPrice(row.strike, precision)}</span>
                  <span className="tr-num money is-up">{fmtPrice(q.bid, 2)}</span>
                  <span className="tr-num money is-down">{fmtPrice(q.ask, 2)}</span>
                  <span className="tr-num muted">{(q.iv * 100).toFixed(0)}%</span>
                  <span className="tr-num muted">{q.g.delta.toFixed(2)}</span>
                </button>
              )
            })}
          </>
        )}
      </section>

      <p className="tr-back">
        <Link to="/trading" className="inline-link">{t('Back to the chart')}</Link>
      </p>

      {ticket && (
        <ContractTicket
          quote={ticket}
          spot={quote?.markPrice ?? 0}
          currency={currency}
          onClose={() => setTicket(null)}
          place={(side, qty) => view.runtime.place({
            symbol: ticket.inst.symbol,
            side,
            type: 'market',
            mode: 'shares',
            qty,
            tif: 'gtc',
          })}
        />
      )}
    </div>
  )
}

/** One contract, bought or sold. Selling shows the CBOE-rule margin it reserves —
 *  a short option that looked free would teach exactly the wrong lesson, and it is
 *  the number that explains why the account cannot sell a thousand of them. */
function ContractTicket({ quote, spot, currency, onClose, place }: {
  quote: ChainQuote
  spot: number
  currency: string
  onClose: () => void
  place: (side: 'buy' | 'sell', qty: number) => { ok: boolean; error?: { code: string } }
}) {
  const [qty, setQty] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const inst = quote.inst
  const n = Math.max(0, Number(qty.replace(/[, ]/g, '')) || 0)
  const mult = inst.multiplier
  const cost = quote.ask * n * mult
  const credit = quote.bid * n * mult
  const shortMargin = shortOptionMargin(spot, inst.strike, inst.right, credit, mult)

  const go = (side: 'buy' | 'sell') => {
    const res = place(side, n)
    if (!res.ok && res.error) {
      // The engine's error is a machine code; the union is narrowed inside
      // errors.ts, which is also what makes an unhandled new code a build failure.
      setError(tradeErrorMessage(res.error as never))
      return
    }
    onClose()
  }

  return (
    <Modal title={`${inst.underlying} ${inst.right === 'call' ? t('Call') : t('Put')}`} onClose={onClose}>
      <div className="tr-confirm">
        <div className="tr-confirm-row">
          <span className="tr-label">{t('Strike')}</span>
          <span className="tr-num money">{fmtQty(inst.strike)}</span>
        </div>
        <div className="tr-confirm-row">
          <span className="tr-label">{t('Contract size')}</span>
          <span className="tr-num money">{fmtQty(mult)}</span>
        </div>
        <div className="tr-confirm-row">
          <span className="tr-label">{t('Implied volatility')}</span>
          <span className="tr-num">{(quote.iv * 100).toFixed(1)}%</span>
        </div>

        <div className="tr-field">
          <label className="tr-label" htmlFor="tr-contracts">{t('Contracts')}</label>
          <NumberField
            id="tr-contracts" mode="digits" className="tr-input"
            label={t('Contracts')} value={qty} onChange={setQty}
          />
        </div>

        <div className="tr-confirm-row">
          <span className="tr-label">{t('Cost to buy')}</span>
          <span className="tr-num money">{money(cost)} {currency}</span>
        </div>
        <div className="tr-confirm-row">
          <span className="tr-label">{t('Credit to sell')}</span>
          <span className="tr-num money">{money(credit)} {currency}</span>
        </div>
        <div className="tr-confirm-row">
          <span className="tr-label">{t('Margin if sold')}</span>
          <span className="tr-num money is-danger">{money(shortMargin)} {currency}</span>
        </div>

        <p className="tr-confirm-warn">
          {t('Selling an option can lose far more than the credit you receive. At expiry it settles in cash against the last 30 minutes of the underlying.')}
        </p>

        {error && <p className="tr-flash is-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn tr-btn-buy" disabled={n <= 0} onClick={() => go('buy')}>{t('Buy')}</button>
          <button type="button" className="btn tr-btn-sell" disabled={n <= 0} onClick={() => go('sell')}>{t('Sell')}</button>
        </div>
      </div>
    </Modal>
  )
}
