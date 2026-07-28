import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getHomeLayout, getReconcileState, saveHomeLayout } from '../../db'
import { useLiveTxns } from '../useLiveTxns'
import { reconcileReminderDue } from '../../lib/analytics/reconcile'
import { useDragReorder } from '../../lib/useDragReorder'
import {
  addLarge, availableLarge, removeItem, reorderItems, setCollapsed, setSlot,
  type HomeItem, type HomeLayout, type LargeWidgetId, type SmallWidgetId,
} from '../../lib/homeLayout'
import { LARGE } from './registry'
import { useLimits } from './useLimits'
import { useGoalSavings } from './useGoalSavings'
import { compactAmount } from '../../lib/format'
import { WidgetFrame } from './WidgetFrame'
import { WidgetActionSheet } from './WidgetActionSheet'
import { WidgetPicker } from './WidgetPicker'
import { t } from '../../i18n'

type Picking =
  | { kind: 'large' }
  | { kind: 'small'; uid: string; slot: number }

const DRAG_OPTS = {
  handle: '.home-drag',
  ignore: '.home-remove, .small-slot-btn',
  handleOnly: true,
  // Home boxes range from a ~90px hero to a ~320px gauge, so the ghost offset
  // has to be measured rather than derived from one row height.
  variableHeight: true,
}

export function HomePage() {
  const all = useLiveTxns()
  const navigate = useNavigate()
  const layout = useLiveQuery(() => getHomeLayout(), [])
  const [editing, setEditing] = useState(false)
  const [sheet, setSheet] = useState<HomeItem | null>(null)
  const [picking, setPicking] = useState<Picking | null>(null)
  const limits = useLimits()
  const goalSavings = useGoalSavings()

  const items = useMemo(() => layout?.items ?? [], [layout])
  const uids = useMemo(() => items.map((i) => i.uid), [items])
  const byUid = useMemo(() => new Map(items.map((i) => [i.uid, i])), [items])

  // Every mutation goes through the pure ops in homeLayout.ts and straight back
  // to Dexie; useLiveQuery feeds the new layout back in.
  const commit = (next: (l: HomeLayout) => HomeLayout) => {
    if (layout) void saveHomeLayout(next(layout))
  }
  const drag = useDragReorder(uids, (order) => commit((l) => reorderItems(l, order)), DRAG_OPTS)

  // Reconcile nudge (only once the state has loaded, so it doesn't flash).
  const reconState = useLiveQuery(() => getReconcileState(), [])
  const reconcileDue = reconState !== undefined
    && reconcileReminderDue(reconState.lastReconciled ?? null, all.length > 0)

  // The nudge is transient, not a widget the user arranges — so it stays out of
  // the layout and is pinned just below the net-worth hero, exactly where it sat
  // before the editor existed. It isn't draggable; useDragReorder only tracks
  // uids, so an extra sibling in the list is harmless (drop positions feel ~64px
  // off while dragging across it, on the few days a month it appears).
  const reconAfter = items.some((i) => i.widget === 'networth') ? 'networth' : null

  // One frame of nothing beats flashing the default layout over a custom one.
  if (!layout) return null

  const sheetDef = sheet ? LARGE[sheet.widget] : null
  const reminder = reconcileDue && (
    <div className="card recon-reminder" role="status">
      <div className="recon-reminder-text">
        <strong>{t('Time to reconcile')}</strong>
        <span className="recon-reminder-sub">{t('Check your account balances match reality.')}</span>
      </div>
      <button type="button" className="btn recon-reminder-btn" onClick={() => navigate('/reconcile')}>
        {t('Reconcile now')}
      </button>
    </div>
  )

  const nearLimit = limits ? limits.statuses.filter((s) => s.remaining <= limits.warnAt) : []
  // Goals hold more than the savings accounts actually contain — the user has to
  // move some back before the split means anything again.
  const overAllocated = !!goalSavings && goalSavings.unallocated < 0

  return (
    <div className="home">
      {/* Spending-limit nudge. Sits ABOVE the list rather than inside it: an
          extra non-draggable sibling among the widgets throws off the drop
          positions while dragging past it (see the reconcile banner below), and
          unlike that one this banner has no reason to sit at a particular spot. */}
      {nearLimit.length > 0 && (
        <div className="card recon-reminder limit-reminder" role="status">
          <div className="recon-reminder-text">
            <strong>{t('Spending limit almost reached')}</strong>
            <span className="recon-reminder-sub">
              {nearLimit.length === 1
                ? t('{name} — {amount} left.', {
                  name: nearLimit[0].label,
                  amount: compactAmount(Math.max(0, nearLimit[0].remaining)),
                })
                : t('{n} of your limits are near or over.', { n: nearLimit.length })}
            </span>
          </div>
          <button type="button" className="btn recon-reminder-btn" onClick={() => navigate('/limits')}>
            {t('View limits')}
          </button>
        </div>
      )}

      {/* Savings needs rebalancing. Same placement rationale as the limit banner
          above: outside the drag list, because it has no positional meaning. */}
      {overAllocated && (
        <div className="card recon-reminder limit-reminder" role="status">
          <div className="recon-reminder-text">
            <strong>{t('Savings need adjusting')}</strong>
            <span className="recon-reminder-sub">
              {t('Your goals hold {amount} more than your savings accounts contain.', {
                amount: compactAmount(Math.abs(goalSavings.unallocated)),
              })}
            </span>
          </div>
          <button type="button" className="btn recon-reminder-btn" onClick={() => navigate('/goal-savings')}>
            {t('Rebalance')}
          </button>
        </div>
      )}

      <div className="home-list" {...drag.listProps}>
        {reconAfter === null && reminder}
        {drag.order.map((uid) => {
          const item = byUid.get(uid)
          if (!item) return null
          return (
            <Fragment key={uid}>
              <WidgetFrame
                item={item}
                editing={editing}
                collapsed={!!item.collapsed}
                onToggleCollapse={() => commit((l) => setCollapsed(l, uid, !item.collapsed))}
                onHold={() => setSheet(item)}
                onRemove={() => commit((l) => removeItem(l, uid))}
                onPickSlot={(slot) => setPicking({ kind: 'small', uid, slot })}
                dragRef={drag.itemRef(uid)}
                dragStyle={drag.itemStyle(uid)}
                onDragPointerDown={drag.onItemPointerDown(uid)}
                dragging={drag.dragging === uid}
              />
              {reconAfter === uid && reminder}
            </Fragment>
          )
        })}
      </div>

      {editing && (
        <button
          type="button" className="add-widget-tile"
          onClick={() => setPicking({ kind: 'large' })}
        >
          + {t('Add widget')}
        </button>
      )}

      <button
        type="button"
        className={`btn home-edit-btn ${editing ? 'btn-accent' : 'ghost'}`}
        onClick={() => setEditing((v) => !v)}
      >
        {editing ? t('Done') : t('Edit layout')}
      </button>

      <p className="muted">{t('Your data is stored on this device only.')}</p>

      {sheet && sheetDef && (
        <WidgetActionSheet
          title={t(sheetDef.title)}
          canNavigate={!!sheetDef.route}
          onNavigate={() => { const to = sheetDef.route!; setSheet(null); navigate(to) }}
          onRemove={() => { commit((l) => removeItem(l, sheet.uid)); setSheet(null) }}
          onClose={() => setSheet(null)}
        />
      )}

      {picking?.kind === 'large' && (
        <WidgetPicker
          mode={{
            kind: 'large',
            options: availableLarge(layout),
            onPick: (id: LargeWidgetId) => { commit((l) => addLarge(l, id)); setPicking(null) },
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === 'small' && (
        <WidgetPicker
          mode={{
            kind: 'small',
            current: byUid.get(picking.uid)?.slots?.[picking.slot] ?? null,
            onPick: (id: SmallWidgetId | null) => {
              commit((l) => setSlot(l, picking.uid, picking.slot, id))
              setPicking(null)
            },
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
