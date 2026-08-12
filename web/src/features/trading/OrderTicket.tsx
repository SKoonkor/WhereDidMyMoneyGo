import { useMemo, useState } from 'react'
import { NumberField } from '../../components/NumberField'
import { parseAmountExpr } from '../transactions/amountExpr'
import { t } from '../../i18n'
import type { OrderRequest, OrderPreview } from '../../lib/trading/broker/engine'
import type { OrderType, Side } from '../../lib/trading/types'
import { tradeErrorMessage } from './errors'
import { money, price as fmtPrice, qty as fmtQty } from './fmt'
import { perpOf, spotOf } from './marketView'
import { LeverageSlider } from './LeverageSlider'
import { ConfirmSheet } from './ConfirmSheet'
import type { TradingView } from './useTrading'

// The order ticket — half the screenshot, and the half a critic reads first.
//
// Non-negotiables, all of them from §E and the repo's own conventions:
//
//   • Every numeric input is `NumberField` with `mode='calc'`. Never a raw
//     <input type=number>. It is what suppresses the OS keyboard (readOnly +
//     inputMode="none"), it is what gives the field the app's calculator, and all
//     ~30 numeric fields in this app already work that way. A raw input here would
//     pop a keyboard over the ticket on iOS and read as a different app.
//   • Buy/Sell is a two-up segmented control tinted --income / --expense, active
//     side filled.
//   • A 25/50/75/100% quick-size row bound to buying power.
//   • The leverage slider carries the live liquidation price underneath it.
//
// The preview is recomputed on every keystroke. `previewOrder` is non-mutating and
// runs the same funds check, leverage clamp and liquidation formula the fill will,
// so the ticket can show the real reason an order would be refused BEFORE the user
// commits to it — and the confirm sheet is then a mirror of an object that already
// exists rather than a second opinion.

const QUICK = [0.25, 0.5, 0.75, 1]
const TYPES: OrderType[] = ['market', 'limit', 'stop', 'trailing']

const TYPE_LABEL: Record<OrderType, string> = {
  market: 'Market', limit: 'Limit', stop: 'Stop', trailing: 'Trailing',
}

/**
 * A `calc` NumberField hands back an EXPRESSION, not a number — "500 + 200", or a
 * half-typed "500 +". The app already has one parser for that shape and using it
 * is what makes an order ticket add up the same way the Add-transaction sheet
 * does; `Number()` on the raw string would return NaN for a perfectly good sum.
 *
 * An unparseable string becomes NaN rather than 0, so the ticket says "enter an
 * amount" instead of "quantity must be above zero".
 */
function parse(s: string): number {
  if (!s.trim()) return NaN
  const e = parseAmountExpr(s)
  return e.valid ? e.net : NaN
}

export function OrderTicket({ view }: { view: TradingView }) {
  const { runtime, cfg, account, buyingPower, precision, currency, quote } = view

  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<OrderType>('market')
  const [margin, setMargin] = useState(false)
  const [mode, setMode] = useState<'shares' | 'dollars'>('dollars')
  const [amount, setAmount] = useState('')
  const [limit, setLimit] = useState('')
  const [stop, setStop] = useState('')
  const [trail, setTrail] = useState('')
  const [leverage, setLeverage] = useState(2)
  const [reduceOnly, setReduceOnly] = useState(false)
  const [confirming, setConfirming] = useState<OrderPreview | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  // Spot and its perpetual twin are the same market at two different symbols, so
  // the ticket switches which one it addresses rather than switching screens.
  const symbol = margin ? perpOf(spotOf(cfg.symbol)) : spotOf(cfg.symbol)
  const maxLev = useMemo(() => {
    const inst = runtime.market.instrument(symbol)
    return inst && inst.kind === 'perp' ? Math.min(inst.maxLeverage, account.settings.maxLeverage) : 1
  }, [runtime, symbol, account.settings.maxLeverage])

  const request = useMemo((): OrderRequest => ({
    symbol,
    side,
    type,
    mode,
    qty: parse(amount),
    limit: type === 'limit' ? parse(limit) : undefined,
    stop: type === 'stop' ? parse(stop) : undefined,
    // A PERCENT, exactly as paper.py stored it — `fills.ts` divides by 100 at the
    // point of use. Sending a fraction here would place a 0.05% trail where the
    // user asked for 5%, and it would trigger on the first tick.
    trail: type === 'trailing' ? parse(trail) : undefined,
    leverage: margin ? leverage : undefined,
    reduceOnly,
    tif: 'gtc',
  }), [symbol, side, type, mode, amount, limit, stop, trail, margin, leverage, reduceOnly])

  // Recomputed every render, which is every keystroke and every 8 Hz notify.
  // `previewOrder` clones the account and touches nothing.
  const preview = useMemo(
    () => (Number.isFinite(request.qty) && request.qty > 0 ? runtime.preview(request) : null),
    // The account mutates in place, so `view` is the honest dependency: it is a
    // fresh object on every notify and nothing else here changes when a fill lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runtime, request, view],
  )
  const ok = preview && !('error' in preview) ? preview : null
  const err = preview && 'error' in preview ? preview.error : null

  const ref = quote?.markPrice ?? 0
  /** What 100% means. With leverage, buying power buys `leverage` times as much
   *  notional — quoting the collateral instead would make the 100% chip buy a
   *  twentieth of the account at 20×. */
  const capacity = buyingPower * (margin ? leverage : 1)

  const setQuick = (frac: number) => {
    if (mode === 'dollars') {
      setAmount(String(Math.max(0, Math.floor(capacity * frac * 100) / 100)))
    } else if (ref > 0) {
      setAmount(String(Math.max(0, (capacity * frac) / ref)))
    }
  }

  const submit = () => {
    if (!ok) return
    setConfirming(ok)
  }

  const commit = () => {
    setConfirming(null)
    const res = runtime.place(request)
    if (!res.ok) {
      setFlash(tradeErrorMessage(res.error))
      return
    }
    setAmount('')
    setFlash(res.outcome === 'filled' ? t('Filled.') : t('Order placed.'))
    window.setTimeout(() => setFlash(null), 2600)
  }

  const held = account.positions[symbol]?.qty ?? 0

  return (
    <section className="card tr-ticket">
      {/* Buy / Sell. Two-up, active side filled with the app's own income /
          expense colours so the ticket belongs to this app and not to a
          screenshot of another one. */}
      <div className="seg tr-side-seg">
        <button
          type="button"
          className={`seg-btn tr-side-btn${side === 'buy' ? ' active is-income' : ''}`}
          onClick={() => setSide('buy')}
        >
          {t('Buy')}
        </button>
        <button
          type="button"
          className={`seg-btn tr-side-btn${side === 'sell' ? ' active is-expense' : ''}`}
          onClick={() => setSide('sell')}
        >
          {t('Sell')}
        </button>
      </div>

      <div className="tr-ticket-modes">
        <div className="seg tr-seg-sm">
          {TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              className={`seg-btn${type === ty ? ' active' : ''}`}
              onClick={() => setType(ty)}
            >
              {t(TYPE_LABEL[ty])}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`tr-chip${margin ? ' is-on' : ''}`}
          onClick={() => setMargin((m) => !m)}
          aria-pressed={margin}
        >
          {t('Margin')}
        </button>
      </div>

      <div className="tr-field">
        <div className="tr-field-head">
          <label className="tr-label" htmlFor="tr-amount">
            {mode === 'dollars' ? t('Amount ({currency})', { currency }) : t('Quantity')}
          </label>
          <button type="button" className="tr-swap" onClick={() => { setMode(mode === 'dollars' ? 'shares' : 'dollars'); setAmount('') }}>
            {mode === 'dollars' ? t('Switch to quantity') : t('Switch to amount')}
          </button>
        </div>
        {/* Mandatory repo convention: the in-app pad, never the OS keyboard. */}
        <NumberField
          id="tr-amount"
          mode="calc"
          allowDecimal
          className="tr-input"
          label={mode === 'dollars' ? t('Amount') : t('Quantity')}
          value={amount}
          onChange={setAmount}
          placeholder="0"
        />
      </div>

      <div className="tr-quick">
        {QUICK.map((f) => (
          <button key={f} type="button" className="tr-quick-btn" onClick={() => setQuick(f)}>
            {f === 1 ? t('Max') : `${f * 100}%`}
          </button>
        ))}
      </div>

      <div className="tr-power">
        <span className="tr-label">{t('Buying power')}</span>
        <span className="tr-num money">{money(capacity)} {currency}</span>
      </div>

      {type === 'limit' && (
        <div className="tr-field">
          <label className="tr-label" htmlFor="tr-limit">{t('Limit price')}</label>
          <NumberField
            id="tr-limit" mode="calc" allowDecimal className="tr-input"
            label={t('Limit price')} value={limit} onChange={setLimit}
            placeholder={ref > 0 ? fmtPrice(ref, precision) : '0'}
          />
        </div>
      )}
      {type === 'stop' && (
        <div className="tr-field">
          <label className="tr-label" htmlFor="tr-stop">{t('Stop price')}</label>
          <NumberField
            id="tr-stop" mode="calc" allowDecimal className="tr-input"
            label={t('Stop price')} value={stop} onChange={setStop}
            placeholder={ref > 0 ? fmtPrice(ref, precision) : '0'}
          />
        </div>
      )}

      {/* A percentage, not a price — which is why it is `digits` rather than
          `calc` and why the placeholder is a plain number. The broker ratchets
          `o.peak` and triggers at `peak × (1 ∓ trail/100)`. */}
      {type === 'trailing' && (
        <div className="tr-field">
          <label className="tr-label" htmlFor="tr-trail">{t('Trail (%)')}</label>
          <NumberField
            id="tr-trail" mode="digits" allowDecimal className="tr-input"
            label={t('Trail (%)')} value={trail} onChange={setTrail}
            placeholder="5"
          />
        </div>
      )}

      {margin && (
        <LeverageSlider
          value={leverage}
          max={Math.max(1, maxLev)}
          onChange={setLeverage}
          liqPrice={ok?.liqPrice}
          precision={precision}
        />
      )}

      {held !== 0 && (
        <label className="tr-check">
          <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
          <span>{t('Reduce only')}</span>
        </label>
      )}

      {/* The estimate sits directly above the button, so the last thing read
          before committing is what committing costs. */}
      <div className="tr-estimate">
        {ok ? (
          <>
            <span className="tr-label">{t('You get')}</span>
            <span className="tr-num money">
              {mode === 'dollars'
                ? t('{qty} at {price}', { qty: fmtQty(ok.qty), price: ok.price != null ? fmtPrice(ok.price, precision) : t('market') })
                : t('{value} {currency}', { value: money(ok.est ?? 0), currency })}
            </span>
          </>
        ) : (
          <span className="tr-label">{err ? tradeErrorMessage(err) : t('Enter an amount to see the estimate.')}</span>
        )}
      </div>

      <button
        type="button"
        className={`btn tr-submit ${side === 'buy' ? 'tr-btn-buy' : 'tr-btn-sell'}`}
        disabled={!ok}
        onClick={submit}
      >
        {side === 'buy' ? t('Buy {symbol}', { symbol }) : t('Sell {symbol}', { symbol })}
      </button>

      {flash && <p className="tr-flash" role="status">{flash}</p>}

      {confirming && (
        <ConfirmSheet
          preview={confirming}
          currency={currency}
          precision={precision}
          onConfirm={commit}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  )
}
