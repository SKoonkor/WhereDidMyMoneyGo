import { t } from '../../i18n'

// The permanent "this is not real" marker.
//
// It lives in the PAGE HEADER, not on the plot, and that placement was arrived at
// the hard way. §E puts it at the chart's top-left, but the plot has no free
// corner: the OHLC legend owns the top strip — it is the readout that makes the
// screenshot look like a trading app — and the volume histogram owns the bottom
// 16%. A badge in either place is painted over live data, and a blind comparison
// against a real exchange's chart flagged exactly that: bars showing through the
// badge's rounded border, and a number cut in half by the pill.
//
// A header slot satisfies the requirement better anyway. What the badge is FOR is
// that a screenshot taken out of context still says the money is simulated, and a
// header survives someone cropping the top of the page — which is the crop people
// actually take — whereas a watermark inside the plot only survives a crop of the
// chart, at the cost of competing with the data in every single one.
//
// Rendered on all three trading routes, since any of them can be linked to
// directly.

export function SimBadge() {
  return (
    <span className="tr-sim-badge" title={t('Simulated market — no real money')}>
      {t('SIM')}
    </span>
  )
}
