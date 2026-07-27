import { SLOTS_PER_ROW } from '../../lib/homeLayout'
import { SMALL } from './registry'
import type { WidgetProps } from './registry'
import { t } from '../../i18n'

// A row of up to three small preview tiles, centred.
//
// On the live Home only filled slots are drawn, so a half-full row still looks
// deliberate. In edit mode all three appear and every one is a button: an empty
// slot offers "+", a filled one reopens the picker to swap or clear it.
export function SmallRow({ item, editing, onPickSlot }: WidgetProps) {
  const slots = item.slots ?? (Array(SLOTS_PER_ROW).fill(null) as null[])

  if (!editing) {
    const filled = slots.map((w, i) => [w, i] as const).filter(([w]) => w)
    if (!filled.length) {
      return <div className="small-row-hint">{t('Tap Edit layout to fill this row.')}</div>
    }
    return (
      <div className="small-row">
        {filled.map(([widget, i]) => {
          const { Render } = SMALL[widget!]
          return <div key={i} className="small-slot"><Render /></div>
        })}
      </div>
    )
  }

  return (
    <div className="small-row">
      {slots.map((widget, i) => {
        const def = widget ? SMALL[widget] : null
        return (
          <button
            key={i}
            type="button"
            className={`small-slot small-slot-btn ${def ? '' : 'small-slot-empty'}`}
            onClick={() => onPickSlot(i)}
            aria-label={def ? t('Change this widget') : t('Add a small widget')}
          >
            {def ? <def.Render /> : '+'}
          </button>
        )
      })}
    </div>
  )
}
