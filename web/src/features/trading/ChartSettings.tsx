import { Modal } from '../../components/Modal'
import { t } from '../../i18n'
import { INDICATOR_DEFS, INDICATOR_IDS } from './overlays'
import { liveNoticeMessage } from './errors'
import { money } from './fmt'
import type { TradingView } from './useTrading'

// Chart settings, as its own sheet.
//
// It left TradingPage when the bottom bar grew a settings slot: the page no
// longer owns the gear, so it no longer owns the panel behind it. That the move
// also took ~90 of TradingPage's 293 lines is the smaller half of the reason.
//
// Everything here is a chip or a checkbox writing straight through
// `runtime.patchCfg`, which persists and notifies — so there is no local state
// to keep in step and no Save button to forget to press. `Done` just closes.

const CHART_TYPES: { id: TradingView['cfg']['chartType']; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'hollow', label: 'Hollow' },
  { id: 'heikin', label: 'Heikin-Ashi' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
]

export function ChartSettings({ view, onClose }: { view: TradingView; onClose: () => void }) {
  const { runtime, cfg, summary, currency, account } = view
  const liveNote = liveNoticeMessage(runtime.liveNotice)

  return (
    <Modal title={t('Chart settings')} onClose={onClose}>
      <div className="tr-settings">
        <div className="tr-set-group">
          <span className="tr-label">{t('Chart type')}</span>
          <div className="tr-chips">
            {CHART_TYPES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`tr-chip${cfg.chartType === c.id ? ' is-on' : ''}`}
                onClick={() => runtime.patchCfg({ chartType: c.id })}
              >
                {t(c.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="tr-set-group">
          <span className="tr-label">{t('Indicators')}</span>
          <div className="tr-chips">
            {INDICATOR_IDS.map((id) => {
              const on = cfg.indicators.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`tr-chip${on ? ' is-on' : ''}`}
                  onClick={() => runtime.patchCfg({
                    indicators: on ? cfg.indicators.filter((x) => x !== id) : [...cfg.indicators, id],
                  })}
                >
                  {INDICATOR_DEFS[id].label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Market data. Plain chips, same as every other group here — the
            switch disposes one feed and builds the other, and the page
            re-points itself; nothing about that needs its own screen. */}
        <div className="tr-set-group">
          <span className="tr-label">{t('Market data')}</span>
          <div className="tr-chips">
            <button
              type="button"
              className={`tr-chip${cfg.mode === 'sim' ? ' is-on' : ''}`}
              onClick={() => { void runtime.switchMode('sim') }}
            >
              {t('Simulated')}
            </button>
            <button
              type="button"
              className={`tr-chip${cfg.mode === 'live' ? ' is-on' : ''}`}
              onClick={() => { void runtime.switchMode('live') }}
            >
              {t('Live crypto')}
            </button>
          </div>
          <p className="muted tr-set-note">
            {t('Live streams real prices from a public crypto exchange, and needs a connection. Your money, orders and positions stay simulated either way.')}
          </p>
          {liveNote && <p className="muted tr-set-note">{liveNote}</p>}
        </div>

        <label className="tr-check">
          <input type="checkbox" checked={cfg.showDepth} onChange={(e) => runtime.patchCfg({ showDepth: e.target.checked })} />
          <span>{t('Show order book depth')}</span>
        </label>
        <label className="tr-check">
          <input type="checkbox" checked={cfg.colorBlind} onChange={(e) => runtime.patchCfg({ colorBlind: e.target.checked })} />
          <span>{t('Colour-blind palette (blue / orange)')}</span>
        </label>

        <p className="muted tr-set-note">
          {t('Account {name} · {cash} {currency} cash', {
            name: account.name, cash: money(summary.cash), currency,
          })}
        </p>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t('Done')}</button>
        </div>
      </div>
    </Modal>
  )
}
