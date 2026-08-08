import { useCallback, useEffect, useRef } from 'react'
import { Keypad } from './Keypad'
import {
  pressKey, keyFromEvent, nextKeypadId, openKeypad, closeKeypad, useKeypadOwner,
  type Key, type KeypadMode,
} from '../lib/keypad'

// A numeric input that opens the in-app pad instead of the OS keyboard.
//
// It renders ONLY the <input> — no label, no wrapper. The app's ~30 numeric
// fields sit inside eight different wrappers (.field, .set-field, .calc-field,
// .budget-field, .budget-pct, .tax-allow, .recon-adjust, and a bare input inside
// .goal-form), so owning the markup would mean rewriting all of them. Owning just
// the input makes each call site a one-line swap and leaves every existing style,
// including the invalid ring and the failed-save shake, exactly where it was.

export function NumberField({
  mode,
  value,
  onChange,
  label,
  allowDecimal = mode === 'calc',
  className,
  placeholder,
  style,
  id,
  onBlur,
  onFocus,
  onKeyDown,
  'aria-invalid': ariaInvalid,
}: {
  mode: KeypadMode
  value: string
  onChange: (next: string) => void
  label: string // shown in the pad's header, so it is clear what is being typed
  allowDecimal?: boolean
  className?: string
  placeholder?: string
  style?: React.CSSProperties
  id?: string
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onFocus?: React.FocusEventHandler<HTMLInputElement>
  // Runs before the pad's own key mapping. Call preventDefault() in it to keep a
  // key for the call site — LimitsPage uses Enter to commit, which would
  // otherwise be swallowed as the pad's `=`.
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  'aria-invalid'?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // One id per instance, stable across renders — it is the token that says which
  // field the single on-screen pad belongs to.
  const idRef = useRef<number | null>(null)
  if (idRef.current === null) idRef.current = nextKeypadId()
  const fieldId = idRef.current

  const open = useKeypadOwner() === fieldId

  // The text as it stands RIGHT NOW, not as of the last render. Two keys tapped
  // in quick succession arrive as two separate events, and the second one would
  // otherwise still be reading the value React rendered before the first — so
  // "50" would come out as "0". Writing the result back here immediately lets the
  // presses compose; the assignment on every render re-syncs it to the truth if
  // the parent ever declines a change.
  const valueRef = useRef(value)
  valueRef.current = value
  // Everything a key press needs, read at press time rather than captured. That
  // is what lets `apply` keep one identity for the life of the field, which in
  // turn lets the pad be memo'd — otherwise every keystroke handed it a new
  // callback and re-rendered the whole grid.
  const latest = useRef({ mode, allowDecimal, onChange })
  latest.current = { mode, allowDecimal, onChange }

  const apply = useCallback((k: Key) => {
    const { mode, allowDecimal, onChange } = latest.current
    const next = pressKey(valueRef.current, k, mode, allowDecimal)
    valueRef.current = next
    onChange(next)
  }, [])

  // Release the pad if this field is unmounted while holding it (a sheet closing
  // mid-edit). closeKeypad is a no-op unless we are still the owner.
  useEffect(() => () => closeKeypad(fieldId), [fieldId])

  // On a page (rather than in a sheet) the pad can cover the field it belongs to.
  // App.css pads .app-main by --keypad-h; this puts the field itself in view.
  useEffect(() => {
    if (!open) return
    const el = inputRef.current
    const timer = window.setTimeout(() => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    return () => clearTimeout(timer)
  }, [open])

  const done = useCallback(() => {
    closeKeypad(fieldId)
    // Blur so that call sites which commit on blur (Budget, Goals, Reconcile)
    // still fire exactly as they did with the OS keyboard.
    inputRef.current?.blur()
  }, [fieldId])

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        className={className}
        style={style}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        value={value}
        // `readOnly` is what actually suppresses the keyboard on iOS;
        // `inputMode="none"` is what does it on Android. Both, or one of the two
        // platforms still pops a keyboard over the pad.
        readOnly
        inputMode="none"
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => { openKeypad(fieldId); onFocus?.(e) }}
        // Focus landing inside the pad is not the field being left — the pad IS
        // the field's keyboard. It should never happen (the panel refuses focus
        // outright), but if a browser ever hands focus to a key anyway, putting
        // the pad away mid-sum is the worst possible response.
        onBlur={(e) => {
          if (e.relatedTarget instanceof Element && e.relatedTarget.closest('.kp-panel')) return
          closeKeypad(fieldId)
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented) return // the call site claimed this key
          const k = keyFromEvent(e.key)
          if (k === null) return // Tab, Escape and the arrows still reach the browser
          e.preventDefault()
          apply(k)
          openKeypad(fieldId)
        }}
      />
      {open && (
        <Keypad
          mode={mode}
          label={label}
          allowDecimal={allowDecimal}
          onKey={apply}
          onDone={done}
        />
      )}
    </>
  )
}
