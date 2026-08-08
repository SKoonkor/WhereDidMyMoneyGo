// The on-screen number pad, minus the pixels.
//
// Two separate things live here, both small:
//
//  1. `pressKey` — what a key press does to the field's text. Keypress handling is
//     where the bugs are (double operators, a second decimal point, a backspace
//     that eats one space at a time), so it is a pure function with no DOM
//     anywhere near it and a test per rule.
//
//  2. A module-level record of WHICH field currently owns the pad. Only one pad
//     may be on screen, and the field that opened it is not the component that
//     renders it — so the same `useSyncExternalStore` pattern carryNote.ts and
//     prefs.ts already use does the job.
//
// The text the pad writes uses ASCII `+` and `-` on purpose, but the typographic
// `×` and `÷`. The minus has to stay ASCII because other code reads these strings
// (ReconcilePage's sanitiser, and anything that parses a plain amount); `×` and
// `÷` are new characters nothing else has an opinion about, and they are what the
// key caps show. parseAmountExpr normalises all four either way.

import { useSyncExternalStore } from 'react'
import { parseAmountExpr } from '../features/transactions/amountExpr'

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
export type OpKey = '+' | '-' | '*' | '/'
export type Key = Digit | '.' | OpKey | 'back' | 'clear' | 'equals'

/** `calc` is money — operators and `=`. `digits` is a count or a percentage. */
export type KeypadMode = 'calc' | 'digits'

// What each operator key writes. Spaced, because "500 - 75" is readable in a
// field a person is checking and "500-75" is not.
const OP_TEXT: Record<OpKey, string> = { '+': ' + ', '-': ' - ', '*': ' × ', '/': ' ÷ ' }

/** The operator characters as they appear in the field. */
const OP_CHARS = '+-×÷'
const endsWithOp = (s: string) => s.length > 0 && OP_CHARS.includes(s[s.length - 1])

/** The digits of the number currently being typed — everything after the last operator. */
const tailNumber = (s: string) => /[\d.]*$/.exec(s)?.[0] ?? ''

export function pressKey(
  current: string,
  key: Key,
  mode: KeypadMode,
  allowDecimal = true,
): string {
  const s = current

  if (key === 'clear') return ''

  if (key === 'back') {
    // One press removes one thing you can see: a digit, or a whole " - " group.
    const trimmed = s.replace(/\s+$/, '')
    if (!trimmed) return ''
    const next = trimmed.slice(0, -1).replace(/\s+$/, '')
    // Leave the field in the same shape an operator key produces, so deleting a
    // digit and re-typing it doesn't quietly change "500 - 7" into "500 -7".
    return endsWithOp(next) ? `${next} ` : next
  }

  if (key === 'equals') {
    if (mode !== 'calc') return s
    const e = parseAmountExpr(s)
    // A no-op when it doesn't parse: collapsing to 0 would silently destroy what
    // was typed, and the field already shows nothing is adding up.
    if (!e.valid) return s
    // Plain, not grouped or padded — this is a value still being edited, and the
    // hint line below the field is where the formatted total belongs.
    return String(e.net)
  }

  if (key === '.') {
    if (!allowDecimal) return s
    const tail = tailNumber(s)
    if (tail.includes('.')) return s // one decimal point per number
    return tail === '' ? `${s}0.` : `${s}.` // a leading dot becomes "0."
  }

  if (key === '+' || key === '-' || key === '*' || key === '/') {
    if (mode !== 'calc') return s // no operators on a count or a percentage
    const trimmed = s.replace(/\s+$/, '')
    // Replace a trailing operator rather than stacking it: pressing + then − is
    // someone changing their mind, not "500 + -".
    const base = endsWithOp(trimmed) ? trimmed.slice(0, -1).replace(/\s+$/, '') : trimmed
    // Nothing on the left: only a sign makes sense there. "× 5" is not an amount.
    if (base === '') return key === '-' ? '-' : ''
    // A lone leading minus is the first number's sign, so another operator
    // replaces it rather than appending to nothing.
    if (base === '-') return key === '-' ? '-' : ''
    return base + OP_TEXT[key]
  }

  // A digit. Replace a lone leading zero rather than growing "007".
  return tailNumber(s) === '0' ? `${s.slice(0, -1)}${key}` : `${s}${key}`
}

// Map a physical keyboard event onto a pad key, so a desktop user can just type.
// `readOnly` still delivers keydown, which is what makes this work at all.
export function keyFromEvent(k: string): Key | null {
  if (/^[0-9]$/.test(k)) return k as Digit
  if (k === '.' || k === ',') return '.'
  if (k === '+') return '+'
  if (k === '-') return '-'
  if (k === '*' || k === 'x' || k === 'X') return '*'
  if (k === '/') return '/'
  if (k === 'Backspace') return 'back'
  if (k === 'Delete') return 'clear'
  if (k === '=' || k === 'Enter') return 'equals'
  return null
}

// ── Which field owns the pad ────────────────────────────────────────────────
// An id rather than a component: NumberField keeps its own props and simply
// renders the pad when it holds the token, so nothing has to be plumbed through
// this module.

let owner: number | null = null
let nextId = 1

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emit() {
  listeners.forEach((cb) => cb())
}

/** A stable id for one NumberField instance. */
export function nextKeypadId(): number {
  return nextId++
}

export function openKeypad(id: number): void {
  if (owner === id) return
  owner = id
  emit()
}

/** Close, but only if `id` is still the one holding it — see carryNote.ts for why. */
export function closeKeypad(id: number): void {
  if (owner !== id) return
  owner = null
  emit()
}

export function keypadOwner(): number | null {
  return owner
}

export function useKeypadOwner(): number | null {
  return useSyncExternalStore(subscribe, keypadOwner)
}

/** Test seam: drop the shared state between cases. */
export function resetKeypad(): void {
  owner = null
  emit()
}
