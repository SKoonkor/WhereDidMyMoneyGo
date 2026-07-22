import { useEffect, useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import {
  IntroMock, RecordMock, TabBarMock, AppsMock, SettingsMock, ImportMock, BackupMock,
} from './TourMockups'

// The six-step (plus a step-0 intro) first-run tour. Each step pairs a built-in
// SVG mockup with a short EN/TH explanation. Skippable at any time; re-openable
// from Settings. Purely presentational — it never touches the user's data.
interface Step {
  mock: ReactNode
  title: string
  body: string
}

function steps(): Step[] {
  return [
    {
      mock: <IntroMock />,
      title: t('Welcome to Money Tracker'),
      body: t('Track what you earn and spend, all on your own device — nothing leaves your phone. Here’s a quick tour of what’s inside.'),
    },
    {
      mock: <RecordMock />,
      title: t('Record a transaction'),
      body: t('Tap the big ＋ in the middle of the bar to add an expense or income. Fill in the amount, pick a category and account, and save. That’s the core loop.'),
    },
    {
      mock: <TabBarMock />,
      title: t('Find your way around'),
      body: t('The bar has five spots: Home (your overview), Transactions (the full list), the ＋ to add, Apps (charts & calculators), and Settings.'),
    },
    {
      mock: <AppsMock />,
      title: t('Apps: charts & calculators'),
      body: t('The Apps tab holds your insights — Income & Expense breakdowns, Money Flow, Budget and Goals — plus planners like Retirement, Compound Interest and Income Tax.'),
    },
    {
      mock: <SettingsMock />,
      title: t('Make it yours in Settings'),
      body: t('Settings is where you switch language (EN/TH), light or dark theme, hide amounts for privacy, set your currency, and turn on AI receipt scanning.'),
    },
    {
      mock: <ImportMock />,
      title: t('Already use another app?'),
      body: t('Bring your history with you: Settings → Import reads a CSV or Excel export from another money app, with ready-made templates for popular ones.'),
    },
    {
      mock: <BackupMock />,
      title: t('Keep your data safe'),
      body: t('Since everything lives on this device, back it up: Settings → Export & backup saves a file you can restore later or move to a new phone.'),
    },
  ]
}

export function TourOverlay({ onClose }: { onClose: () => void }) {
  const all = steps()
  const [i, setI] = useState(0)
  const last = all.length - 1
  const step = all[i]

  const next = () => (i < last ? setI(i + 1) : onClose())
  const back = () => setI((n) => Math.max(0, n - 1))

  // Arrow keys + Esc for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label={t('App tour')}>
      <div className="tour-card">
        <button className="tour-skip" onClick={onClose}>{i === last ? t('Close') : t('Skip')}</button>

        <div className="tour-mock" key={i}>{step.mock}</div>

        <div className="tour-text">
          <h2 className="tour-title">{step.title}</h2>
          <p className="tour-body">{step.body}</p>
        </div>

        <div className="tour-dots" aria-hidden="true">
          {all.map((_, n) => (
            <span key={n} className={n === i ? 'tour-dot active' : 'tour-dot'} />
          ))}
        </div>

        <div className="tour-nav">
          <button className="btn ghost" onClick={back} disabled={i === 0}>{t('Back')}</button>
          <span className="tour-count">{t('{cur} of {total}', { cur: i + 1, total: all.length })}</span>
          <button className="btn btn-accent" onClick={next}>{i === last ? t('Get started') : t('Next')}</button>
        </div>
      </div>
    </div>
  )
}
