import { memo, useEffect, useLayoutEffect, useRef } from 'react'
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

// Giving the room back is deferred, and this is the timer that does it.
//
// Over a sheet the pad reserves no room at all, so nothing there can move. On a
// PAGE it does pad the scroll area, and the pad closes the instant the field
// loses focus — which is the very tap trying to reach whatever is underneath.
// Releasing the padding right then can shift a scrolled-to-bottom page out from
// under the finger, and the click that follows the press is then swallowed.
// Holding it for a beat lets the press it belongs to finish first.
let releaseRoom: number | undefined

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" strokeLinejoin="round" />
    <path d="M13 10l4 4M17 10l-4 4" strokeLinecap="round" />
  </svg>
)

// memo, and NumberField keeps `onKey`/`onDone` identity-stable: nothing here
// depends on the field's text, so re-rendering twenty buttons and re-binding the
// Escape listener on every key press was pure waste on the one code path that has
// to feel instant.
export const Keypad = memo(function Keypad({
  mode,
  label,
  allowDecimal = true,
  fieldRef,
  onKey,
  onDone,
}: {
  mode: KeypadMode
  label: string // the field's own label, echoed in the pad's header
  allowDecimal?: boolean
  // The input this pad belongs to. Only used to tell "pressed the field again"
  // apart from "pressed something else", which is what dismisses the pad.
  fieldRef?: React.RefObject<HTMLElement | null>
  // Deliberately NOT (value, onChange): the pad reports which key was pressed and
  // NumberField applies it. Holding `value` here meant every key press composed
  // against whatever this render had captured, so two taps landing before React
  // re-rendered would both act on the older text and one of them would be lost.
  onKey: (key: Key) => void
  onDone: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const repeatTimer = useRef<number | null>(null)

  const press = onKey

  // Publish the pad's height so the page and any open sheet can make room for it,
  // via <html data-keypad> — the same scheme as data-theme / data-censor /
  // data-carry, so App.css does the work and React never reaches into a sheet.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const html = document.documentElement
    const publish = () => html.style.setProperty('--keypad-h', `${Math.round(el.offsetHeight)}px`)
    // Moving between two numeric fields must not flash the room away and back.
    clearTimeout(releaseRoom)
    publish()
    html.setAttribute('data-keypad', 'on')
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      releaseRoom = window.setTimeout(() => {
        html.removeAttribute('data-keypad')
        html.style.removeProperty('--keypad-h')
      }, 260)
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

  // Cancel the touch outright, at the source. `preventDefault()` on a React
  // pointerdown is enough on a desktop browser, but on iOS a canceled pointerdown
  // does NOT reliably suppress the compatibility mouse events that follow, and it
  // is `mousedown` that moves focus. Cancelling `touchstart` does suppress them —
  // and it also removes the double-tap gesture entirely, which is what made a
  // quick second tap on the same key behave differently from the first.
  //
  // Native and non-passive on purpose: React registers touchstart as a passive
  // listener at the root, and preventDefault does nothing in a passive listener.
  // Nothing inside the pad scrolls or selects, so there is no default worth
  // keeping here.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const swallow = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    el.addEventListener('touchstart', swallow, { passive: false })
    return () => el.removeEventListener('touchstart', swallow)
  }, [])

  // What actually dismisses the pad: a press that lands somewhere else. NOT the
  // field losing focus.
  //
  // Tying dismissal to `blur` made the pad's life depend on the browser keeping
  // focus on a readOnly input through a touch sequence, and every browser has its
  // own opinion about that — one stray focus change anywhere in a fast sequence of
  // taps and the pad vanished mid-sum. A pointerdown outside the panel and outside
  // the field is unambiguous, fires before any focus change, and means the same
  // thing everywhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (panelRef.current?.contains(t)) return
      if (fieldRef?.current?.contains(t)) return
      onDone()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onDone, fieldRef])

  useEffect(() => () => { if (repeatTimer.current !== null) clearTimeout(repeatTimer.current) }, [])

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

  // Backspace deletes one thing per press, and holding it repeats — the way a
  // key repeats on every keyboard there has ever been. An earlier version wiped
  // the whole field on a hold instead; that is a different action wearing the
  // same key, and it is unrecoverable when it fires by accident. Repeating gets
  // to an empty field just as fast and stops wherever the finger lifts.
  //
  // 400ms before the first repeat is long enough that a deliberate single tap
  // never repeats; 70ms is a comfortable rate, dropping to 35ms once it is clear
  // this is a hold and not a hesitation.
  const stopRepeat = () => {
    if (repeatTimer.current === null) return
    clearTimeout(repeatTimer.current)
    repeatTimer.current = null
  }
  const startRepeat = () => {
    const tick = (n: number) => {
      press('back')
      repeatTimer.current = window.setTimeout(() => tick(n + 1), n < 8 ? 70 : 35)
    }
    repeatTimer.current = window.setTimeout(() => tick(0), 400)
  }

  const backspace = (
    <button
      type="button"
      className="kp-key kp-back"
      aria-label={t('Backspace')}
      onPointerDown={(e) => {
        e.preventDefault()
        press('back')
        stopRepeat()
        startRepeat()
      }}
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onPointerCancel={stopRepeat}
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
    <div
      className={`kp-panel kp-${mode}`}
      ref={panelRef}
      role="group"
      aria-label={t('Number pad')}
      // The whole panel refuses to take focus, not just the keys. A pad is a
      // grid of buttons separated by 1px hairlines, with two unused cells, a
      // header strip and — on a notched phone — a safe-area band right under the
      // bottom row. Every one of those is a surface a finger can land on while
      // tapping quickly, and a press on any of them used to blur the field,
      // which closed the pad. Tapping again re-ran the 200ms slide-up, so the
      // whole thing felt slow as well as fragile. The keys preventDefault too;
      // this catches everything between them.
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className="kp-head">
        <span className="kp-label">{label}</span>
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
})
