import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Key, KeypadMode } from '../lib/keypad'
import { t } from '../i18n'

// The in-app number pad — the thing that replaces the OS keyboard on a numeric
// field. It behaves like the keyboard it stands in for: pinned to the bottom of
// the viewport, floating over whatever is on screen, and taking its own height
// out of the room available to everything else (see the --keypad-h note below).
//
// Why it exists: 0.7.0 made the Amount box a calculator, and then the phone
// keyboard buried `-` and `+` behind a symbols page — a two-tap detour in front
// of every sum. Here they are four of the first five keys.

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" strokeLinejoin="round" />
    <path d="M13 10l4 4M17 10l-4 4" strokeLinecap="round" />
  </svg>
)

const KeyboardIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" strokeLinecap="round" />
  </svg>
)

export function Keypad({
  mode,
  label,
  allowDecimal = true,
  onKey,
  onDone,
  onUseKeyboard,
}: {
  mode: KeypadMode
  label: string // the field's own label, echoed in the pad's header
  allowDecimal?: boolean
  // Deliberately NOT (value, onChange): the pad reports which key was pressed and
  // NumberField applies it. Holding `value` here meant every key press composed
  // against whatever this render had captured, so two taps landing before React
  // re-rendered would both act on the older text and one of them would be lost.
  onKey: (key: Key) => void
  onDone: () => void
  onUseKeyboard?: () => void // the escape hatch back to the OS keyboard
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const holdTimer = useRef<number | null>(null)

  const press = onKey

  // Publish the pad's height so the page and any open sheet can make room for it,
  // via <html data-keypad> — the same scheme as data-theme / data-censor /
  // data-carry, so App.css does the work and React never reaches into a sheet.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const html = document.documentElement
    const publish = () => html.style.setProperty('--keypad-h', `${Math.round(el.offsetHeight)}px`)
    publish()
    html.setAttribute('data-keypad', 'on')
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      html.removeAttribute('data-keypad')
      html.style.removeProperty('--keypad-h')
    }
  }, [])

  // Escape closes the pad, not the sheet behind it. Captured on the way DOWN and
  // stopped there: Modal listens on `document` too, and it mounted first, so a
  // plain bubble-phase listener here would run second — after the sheet had
  // already closed out from under the field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onDone()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onDone])

  useEffect(() => () => { if (holdTimer.current !== null) clearTimeout(holdTimer.current) }, [])

  // Every key acts on pointerdown, and every key preventDefaults it. That is what
  // stops the press from blurring the field (which would close the pad under the
  // finger) and from scrolling the page — and it makes the pad feel immediate.
  const keyProps = (k: Key) => ({
    type: 'button' as const,
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); press(k) },
  })

  const digit = (d: Key) => (
    <button key={d} className="kp-key" {...keyProps(d)}>{d}</button>
  )

  const op = (k: Key, glyph: string, aria: string) => (
    <button key={k} className="kp-key kp-op" aria-label={aria} {...keyProps(k)}>{glyph}</button>
  )

  // Backspace deletes on press; hold it and it clears the lot. The reference
  // layout has no room for a Clear key, and holding delete is where everyone
  // already looks for one.
  const backspace = (
    <button
      type="button"
      className="kp-key kp-back"
      aria-label={t('Backspace')}
      onPointerDown={(e) => {
        e.preventDefault()
        press('back')
        holdTimer.current = window.setTimeout(() => press('clear'), 350)
      }}
      onPointerUp={() => { if (holdTimer.current !== null) clearTimeout(holdTimer.current) }}
      onPointerLeave={() => { if (holdTimer.current !== null) clearTimeout(holdTimer.current) }}
      onPointerCancel={() => { if (holdTimer.current !== null) clearTimeout(holdTimer.current) }}
    >
      <BackspaceIcon />
    </button>
  )

  // OK closes the pad and does NOTHING else — in particular it does not evaluate.
  // Collapsing "500 - 75 + 25" to "450" here would throw away the 75 that the
  // carry note exists to hang on to, and the running total under the field
  // already shows what will be saved. `=` is there for anyone who does want the
  // expression replaced by its result, and giving up the breakdown is then their
  // deliberate choice rather than a side effect of finishing.
  const ok = (
    <button
      type="button"
      className="kp-key kp-ok"
      onPointerDown={(e) => { e.preventDefault(); onDone() }}
    >
      {t('OK')}
    </button>
  )

  const dot = allowDecimal
    ? <button className="kp-key" aria-label={t('Decimal point')} {...keyProps('.')}>.</button>
    : <span className="kp-blank" />

  return createPortal(
    <div className={`kp-panel kp-${mode}`} ref={panelRef} role="group" aria-label={t('Number pad')}>
      <div className="kp-head">
        <span className="kp-label">{label}</span>
        {onUseKeyboard && (
          <button
            type="button"
            className="kp-head-btn"
            aria-label={t('Use keyboard')}
            title={t('Use keyboard')}
            onPointerDown={(e) => { e.preventDefault(); onUseKeyboard() }}
          >
            <KeyboardIcon />
          </button>
        )}
        <button
          type="button"
          className="kp-head-btn kp-close"
          aria-label={t('Done')}
          onPointerDown={(e) => { e.preventDefault(); onDone() }}
        >
          ✕
        </button>
      </div>

      {mode === 'calc' ? (
        <div className="kp-grid">
          {op('+', '+', t('Plus'))}
          {op('-', '−', t('Minus'))}
          {op('*', '×', t('Times'))}
          {op('/', '÷', t('Divide'))}

          {digit('7')}{digit('8')}{digit('9')}
          <button className="kp-key kp-op" aria-label={t('Equals')} {...keyProps('equals')}>=</button>

          {digit('4')}{digit('5')}{digit('6')}
          {dot}

          {digit('1')}{digit('2')}{digit('3')}
          {backspace}

          <span className="kp-blank" />
          {digit('0')}
          <span className="kp-blank" />
          {ok}
        </div>
      ) : (
        // No operators and no `=`: a count or a percentage is one number, and
        // offering arithmetic there would only be something else to mis-tap.
        <div className="kp-grid">
          {digit('7')}{digit('8')}{digit('9')}
          {backspace}

          {digit('4')}{digit('5')}{digit('6')}
          {ok}

          {digit('1')}{digit('2')}{digit('3')}

          {dot}
          {digit('0')}
          <span className="kp-blank" />
        </div>
      )}
    </div>,
    document.body,
  )
}
