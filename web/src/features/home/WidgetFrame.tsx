import type { PointerEvent } from 'react'
import { CollapsibleCard } from '../../components/CollapsibleCard'
import type { HomeItem } from '../../lib/homeLayout'
import { LARGE } from './registry'
import { t } from '../../i18n'

// One Home box: the drag wrapper, the edit chrome, and the card itself.
//
// The ⠿ / ✕ strip sits ABOVE the header rather than overlaid on the card's
// corners — the top-right is already taken by the collapse caret when a box is
// folded.
export function WidgetFrame({
  item, editing, collapsed,
  onToggleCollapse, onHold, onRemove, onPickSlot,
  dragRef, dragStyle, onDragPointerDown, dragging,
}: {
  item: HomeItem
  editing: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onHold: () => void
  onRemove: () => void
  onPickSlot: (index: number) => void
  dragRef: (el: HTMLDivElement | null) => void
  dragStyle: React.CSSProperties | undefined
  onDragPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  dragging: boolean
}) {
  const def = LARGE[item.widget]
  const title = t(def.title)

  return (
    <div
      className={`home-item ${editing ? 'is-editing' : ''}`}
      ref={dragRef}
      style={dragStyle}
      onPointerDown={onDragPointerDown}
      data-dragging={dragging || undefined}
    >
      <CollapsibleCard
        title={title}
        className={def.className}
        // In edit mode the ⠿ strip already names the box, so drop the card's own
        // header rather than showing the title twice.
        header={def.header && !editing}
        collapsed={collapsed}
        collapsible={def.header}
        onToggleCollapse={onToggleCollapse}
        onHold={onHold}
        gesturesOff={editing}
        editChrome={editing && (
          <div className="home-item-bar">
            <span className="home-drag" aria-hidden="true">⠿</span>
            <span className="home-item-name">{title}</span>
            <button
              type="button" className="home-remove"
              onClick={onRemove} aria-label={t('Remove from home')}
            >
              ✕
            </button>
          </div>
        )}
      >
        <def.Render item={item} editing={editing} onPickSlot={onPickSlot} />
      </CollapsibleCard>
    </div>
  )
}
