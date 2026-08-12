import { t } from '../../i18n'
import type { TradingRuntime } from './runtime'

// The one-time gate.
//
// A personal-finance app that ships leverage and options owes the user one
// unmistakable screen saying what this is and what it is not. It is a full-page
// gate rather than a dismissible banner because a banner is something you scroll
// past, and "I thought it was real" is not a misunderstanding this feature can
// afford anyone having.
//
// Acceptance is stamped into TradingCfg.disclaimerAcceptedAt, so it is shown once
// per device and travels in a backup with everything else.

export function DisclaimerGate({ runtime }: { runtime: TradingRuntime }) {
  return (
    <div className="tr-gate">
      <h1 className="h1">{t('Paper trading')}</h1>
      <p className="muted page-desc">{t('A market simulator. Read this once before you start.')}</p>

      <section className="card tr-gate-card">
        <ul className="tr-gate-list">
          <li>
            <strong>{t('None of this is real money.')}</strong>{' '}
            {t('The prices are generated on your device by a mathematical model. No exchange, no broker, and no connection to your accounts.')}
          </li>
          <li>
            <strong>{t('It cannot touch your tracked money.')}</strong>{' '}
            {t('The simulator keeps its own separate records. Your transactions, budgets and goals are never read or written by it.')}
          </li>
          <li>
            <strong>{t('Leverage and options are here to be learned, not recommended.')}</strong>{' '}
            {t('They can lose more than you put in — which is exactly why it is better to find that out here.')}
          </li>
          <li>
            <strong>{t('This is not financial advice.')}</strong>{' '}
            {t('Results in a simulator say nothing about results in a real market.')}
          </li>
        </ul>

        <div className="modal-actions tr-gate-actions">
          <button
            type="button"
            className="btn"
            onClick={() => runtime.patchCfg({ disclaimerAcceptedAt: new Date().toISOString() })}
          >
            {t('I understand — start the simulator')}
          </button>
        </div>
      </section>
    </div>
  )
}
