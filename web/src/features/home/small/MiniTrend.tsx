import { useMemo } from 'react'
import { useLiveTxns } from '../../useLiveTxns'
import { netWorthTrend } from '../../../lib/analytics/networth'
import { sparklinePath } from '../../../lib/sparkline'
import { t } from '../../../i18n'

// Roughly three months of daily points — enough to read a shape at ~108px wide.
const DAYS = 92
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

// The last three months of net worth as a filled sparkline. Drawn as plain SVG
// rather than Plotly: at this size axes and hover are noise, and taking the
// stroke colour from `var(--accent)` means it re-themes with no JS at all.
export function MiniTrend() {
  const all = useLiveTxns()
  const { paths, last } = useMemo(() => {
    const pts = netWorthTrend(all, DAYS)
    return { paths: sparklinePath(pts.map((p) => p.value), 100, 40), last: pts.at(-1)?.value ?? 0 }
  }, [all])

  return (
    <>
      <div className="small-slot-title">{t('3-Month flow')}</div>
      <div className="small-slot-body">
        {paths ? (
          <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img"
            aria-label={t('Net worth trend')}>
            <path className="spark-fill" d={paths.area} />
            {/* Only drawn when the balance actually reaches zero — otherwise the
                trend keeps the full height of the tile. */}
            {paths.zeroY != null && (
              <line className="spark-zero" x1="0" x2="100" y1={paths.zeroY} y2={paths.zeroY} />
            )}
            <path className="spark-line" d={paths.line} />
          </svg>
        ) : (
          <div className="small-slot-empty-note">{t('No data yet')}</div>
        )}
      </div>
      <div className="small-slot-value money">{fmt(last)}</div>
    </>
  )
}
