import { t } from '../../i18n'
import { lev, price as fmtPrice } from './fmt'

// Leverage, with the liquidation price living directly underneath it.
//
// §E calls this the single most "real trading app" element on the screen, and it
// is: the number that moves as you drag is not a label, it is the price at which
// the position is closed for you. `liquidationPrice()` is closed-form, so it costs
// one function call per drag frame and no state at all.
//
// The liquidation figure is in --expense on purpose. It is the only number in the
// ticket that describes a loss you have not chosen, and colouring it like every
// other readout would bury it.

export function LeverageSlider({
  value,
  max,
  onChange,
  liqPrice,
  precision,
  disabled,
}: {
  value: number
  max: number
  onChange: (v: number) => void
  /** From `previewOrder`, so the slider and the confirm sheet can never disagree
   *  about where the position dies. `null` when the order would not open one. */
  liqPrice: number | null | undefined
  precision: number
  disabled?: boolean
}) {
  const marks = [1, 2, 3, 5, 10, 20].filter((m) => m <= max)

  return (
    <div className={`tr-lev${disabled ? ' is-off' : ''}`}>
      <div className="tr-lev-head">
        <span className="tr-label">{t('Leverage')}</span>
        <span className="tr-lev-value money">{lev(value)}</span>
      </div>
      <input
        type="range"
        className="tr-lev-range"
        min={1}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={t('Leverage')}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="tr-lev-marks" aria-hidden="true">
        {marks.map((m) => (
          <button
            key={m}
            type="button"
            className={`tr-lev-mark${value === m ? ' is-on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(m)}
          >
            {m}×
          </button>
        ))}
      </div>
      <div className="tr-lev-liq">
        {liqPrice != null && liqPrice > 0 ? (
          <>
            <span className="tr-label">{t('Liquidation')}</span>
            <span className="tr-liq-price money">{fmtPrice(liqPrice, precision)}</span>
          </>
        ) : (
          // Held rather than hidden: a row that appears and disappears as you drag
          // makes everything under it jump.
          <span className="tr-label">{t('No liquidation at this size')}</span>
        )}
      </div>
    </div>
  )
}
