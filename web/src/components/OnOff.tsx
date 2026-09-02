import { t } from '../i18n'

// A small Off/On segmented control bound to a boolean — the app's idiomatic
// boolean control (there is no checkbox/switch anywhere; `.seg` is the pattern).
// Lived in SettingsPage until the Reconcile page needed one too.
export function OnOff({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const opts: Array<{ value: boolean; label: string }> = [
    { value: false, label: t('Off') },
    { value: true, label: t('On') },
  ]
  return (
    <div className="seg" style={{ maxWidth: 240, marginBottom: 0 }}>
      {opts.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          className={o.value === value ? 'seg-btn active' : 'seg-btn'}
          onClick={() => { if (o.value !== value) onChange(o.value) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
