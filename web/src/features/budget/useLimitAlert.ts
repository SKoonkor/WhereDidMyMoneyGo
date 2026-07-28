import { useEffect, useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBudget } from '../../db'
import { useLiveTxnsMaybe } from '../useLiveTxns'
import { currentMonthKey } from '../transactions/month'
import { limitAlerts, limitStatuses, monthWindow, type LimitStatus } from '../../lib/analytics/budget'
import { t } from '../../i18n'

// Nudge the user the moment a saved transaction pushes a spending limit into its
// warning band or past it.
//
// Watching the ledger rather than hooking the save call is deliberate: rows are
// written from the global Add sheet, from editing on the Transactions page, from
// the AI receipt capture and from Import, and a sixth path will show up
// eventually. A diff against the previous standing catches all of them without
// threading a callback through TxnForm.
export function useLimitAlert(onAlert: (message: string) => void): LimitStatus[] {
  const txns = useLiveTxnsMaybe()
  const cfg = useLiveQuery(() => getBudget(), [])

  const alerts = useMemo(() => {
    if (!txns || !cfg) return null
    const [start, end] = monthWindow(currentMonthKey())
    return limitAlerts(limitStatuses(txns, cfg.limits, start, end), cfg.limits.warnAt)
  }, [txns, cfg])

  // Which limits were already in the warning band last time we looked. `null`
  // means we haven't established a baseline yet.
  const prev = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!alerts) return // still loading — no baseline, so nothing can be "new"
    const now = new Set(alerts.map((a) => a.key))

    // First pass just records the baseline. Without this, simply opening the app
    // would announce every limit that was already over.
    if (prev.current === null) {
      prev.current = now
      return
    }

    const fresh = alerts.filter((a) => !prev.current!.has(a.key))
    prev.current = now
    if (fresh.length === 0) return

    // One message per pass, not one per limit: `setToast` holds a single slot, so
    // an import that crosses several limits at once would otherwise leave one
    // arbitrary name behind and restart the timer on each call.
    onAlert(
      fresh.length === 1
        ? t(fresh[0].remaining < 0 ? '{name} is over its spending limit.' : '{name} is close to its spending limit.',
          { name: fresh[0].label })
        : t('{n} spending limits need attention', { n: fresh.length }),
    )
    // `onAlert` is a fresh closure each render; depending on it would re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts])

  return alerts ?? []
}
