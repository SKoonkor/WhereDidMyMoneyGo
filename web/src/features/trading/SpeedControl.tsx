import { t } from '../../i18n'
import type { FeedStatus } from '../../lib/trading/market/feed'
import type { TradingView } from './useTrading'

// Sim speed and pause — and, in live mode, the feed's state instead.
//
// CPU cost is linear in speed (§D.6), so the warning above 100× is not decoration:
// at 1000× the market generates roughly a thousand times as many ticks per second
// of wall time, and on a phone that is the difference between a warm device and a
// hot one. The clock clamps to [1, 1000] itself, so nothing here has to.
//
// On live data both controls are gone rather than disabled. `LiveClock` accepts
// `speed` and `paused` and ignores them both — you cannot fast-forward or pause an
// exchange — so a control that stayed on screen would be one the user could press
// and watch do nothing, which is worse than one that is not there. The row is not
// left empty either: it is the one place on the page with room to say what the
// connection is doing when the chart's pill has nothing to complain about.

const STEPS = [1, 5, 20, 60, 300, 1000]

/** Above this, warn (§D.6). */
const HOT = 100

/** The same four words the chart's feed pill uses, plus the healthy case it never
 *  has to draw. `catching-up` cannot occur live — `LiveFeed.catchUp` returns at
 *  once — so it falls through to the connecting text. */
function statusLabel(s: FeedStatus): string {
  if (s === 'live') return t('Streaming')
  if (s === 'stalled') return t('Feed stalled')
  if (s === 'error') return t('Reconnecting…')
  return t('Connecting…')
}

export function SpeedControl({ view }: { view: TradingView }) {
  const { runtime, cfg, status } = view
  const paused = runtime.feed.clock.paused

  if (runtime.mode === 'live') {
    return (
      <div className="tr-speed">
        <span className="tr-label">{t('Live market data')}</span>
        <span className="tr-num">{statusLabel(status)}</span>
        <p className="tr-speed-warn">{t('Live data runs at 1× and cannot be paused.')}</p>
      </div>
    )
  }

  return (
    <div className="tr-speed">
      <button
        type="button"
        className={`tr-chip tr-play${paused ? ' is-on' : ''}`}
        onClick={() => runtime.setPaused(!paused)}
        aria-pressed={paused}
      >
        {paused ? t('Resume') : t('Pause')}
      </button>
      <div className="seg tr-seg-sm tr-speed-seg">
        {STEPS.map((s) => (
          <button
            key={s}
            type="button"
            className={`seg-btn${cfg.speed === s ? ' active' : ''}`}
            onClick={() => runtime.setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      {cfg.speed > HOT && (
        <p className="tr-speed-warn">{t('Above {n}× the simulation works your device hard.', { n: String(HOT) })}</p>
      )}
    </div>
  )
}
