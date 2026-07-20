import { t } from '../i18n'

// Stand-in for features arriving in later phases (Budget, Goals, Settings, …).
export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="h1">{t(title)}</h1>
      <p className="muted">Coming in a later phase.</p>
    </div>
  )
}
