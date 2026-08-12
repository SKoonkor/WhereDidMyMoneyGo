import { Modal } from '../../components/Modal'
import { t } from '../../i18n'
import type { OrderPreview } from '../../lib/trading/broker/engine'
import { warningMessage } from './errors'
import { lev, money, price as fmtPrice, qty as fmtQty } from './fmt'

// The confirmation sheet mirrors `previewOrder()` field for field.
//
// Deliberately a mirror rather than a summary: the preview is the only thing that
// has already run the same funds check, the same leverage clamp and the same
// liquidation formula the fill will run. Anything recomputed here for display
// could disagree with it, and a confirmation screen that disagrees with the order
// it is confirming is worse than no confirmation at all.
//
// The short warning is the reason this screen exists. `isShort` / `held` /
// `shortQty` are the three numbers that turn "sell 50" into "this opens a 50-share
// short" — the single most common way a paper trader surprises themselves.

export function ConfirmSheet({
  preview,
  currency,
  precision,
  onConfirm,
  onClose,
}: {
  preview: OrderPreview
  currency: string
  precision: number
  onConfirm: () => void
  onClose: () => void
}) {
  const p = preview
  const buy = p.side === 'buy'

  return (
    <Modal title={buy ? t('Confirm buy') : t('Confirm sell')} onClose={onClose}>
      <div className="tr-confirm">
        <div className="tr-confirm-head">
          <span className={`tr-confirm-side ${buy ? 'is-buy' : 'is-sell'}`}>
            {buy ? t('Buy') : t('Sell')}
          </span>
          <span className="tr-confirm-sym">{p.label}</span>
        </div>

        <Row label={t('Quantity')} value={fmtQty(p.qty)} />
        {p.mult !== 1 && <Row label={t('Contract size')} value={fmtQty(p.mult)} />}
        <Row
          label={p.approx ? t('Estimated price') : t('Price')}
          value={p.price != null ? fmtPrice(p.price, precision) : t('At market')}
          mono
        />
        <Row
          label={t('Order value')}
          value={p.est != null ? `${money(p.est)} ${currency}` : '—'}
          mono
        />
        <Row label={t('Fee')} value={`${money(p.fee)} ${currency}`} mono />

        {p.leverage != null && p.leverage > 1 && (
          <>
            <Row label={t('Leverage')} value={lev(p.leverage)} />
            {p.initialMargin != null && (
              <Row label={t('Margin required')} value={`${money(p.initialMargin)} ${currency}`} mono />
            )}
            {p.liqPrice != null && p.liqPrice > 0 && (
              <Row label={t('Liquidation price')} value={fmtPrice(p.liqPrice, precision)} mono danger />
            )}
            {p.afterMarginLevel != null && Number.isFinite(p.afterMarginLevel) && (
              <Row label={t('Margin level after')} value={`${p.afterMarginLevel.toFixed(0)}%`} mono />
            )}
          </>
        )}

        {p.isShort && (
          <p className="tr-confirm-warn">
            {p.held === 0
              ? t('This opens a short: you will owe {qty} that you do not hold.', { qty: fmtQty(p.shortQty) })
              : t('This sells more than you hold, leaving you short {qty}.', { qty: fmtQty(p.shortQty) })}
          </p>
        )}

        {p.warnings.map((w) => (
          <p key={w} className="tr-confirm-note">{warningMessage(w)}</p>
        ))}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button
            type="button"
            className={`btn ${buy ? 'tr-btn-buy' : 'tr-btn-sell'}`}
            onClick={onConfirm}
          >
            {buy ? t('Buy') : t('Sell')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Row({ label, value, mono, danger }: { label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div className="tr-confirm-row">
      <span className="tr-label">{label}</span>
      <span className={`${mono ? 'tr-num money' : ''}${danger ? ' is-danger' : ''}`}>{value}</span>
    </div>
  )
}
