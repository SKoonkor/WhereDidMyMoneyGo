// Every machine code the broker can hand back, turned into a sentence.
//
// The broker deals only in codes (`TradeErrorCode`, `CancelReason`) because the
// app ships EN and TH and prose cannot cross that boundary. This file is the one
// place the codes become words.
//
// Both maps are `Record<Code, …>` on purpose rather than a lookup with a default:
// TypeScript then fails the BUILD the day someone adds a code to the union without
// a message here, instead of the user meeting a raw `insufficient-collateral` in
// a toast. That is the entire reason this file is separate from the components.
import { t } from '../../i18n'
import type { CancelReason, TradeError, TradeErrorCode } from '../../lib/trading/broker/types'
// Type-only, so it is erased at build time and adds no import edge to the
// runtime module this file is deliberately lighter than.
import type { LiveNotice } from './runtime'

/** Numbers inside a message. Two decimals, grouped — these are money and
 *  leverage, never a price that needs the instrument's own precision. */
function num(v: number | string | undefined): string {
  if (v === undefined) return '—'
  if (typeof v === 'string') return v
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * The message for each refusal.
 *
 * Written as templates rather than as finished strings so the numbers the engine
 * attached (`need`, `have`, `cap`) reach the user — "not enough buying power" on
 * its own leaves them guessing by how much.
 */
const MESSAGES: Record<TradeErrorCode, (v: Record<string, number | string>) => string> = {
  'no-symbol': () => t('Pick a symbol first.'),
  'unknown-instrument': (v) => t('{symbol} is not a symbol this sandbox trades.', { symbol: String(v.symbol ?? '') }),
  'no-quote': () => t('No price yet — give the market a moment.'),
  'bad-qty': () => t('Enter a quantity greater than zero.'),
  'bad-amount': () => t('Enter an amount greater than zero.'),
  'insufficient-funds': (v) => t('Not enough cash: this needs {need} and you have {have}.', { need: num(v.need), have: num(v.have) }),
  'insufficient-collateral': (v) => t('Not enough free collateral: this needs {need} and you have {have}.', { need: num(v.need), have: num(v.have) }),
  'exceeds-leverage': (v) => t('Leverage is capped at {cap}× here.', { cap: num(v.cap) }),
  'reduce-only-would-open': () => t('Reduce-only, but this order would open a new position.'),
  'missing-limit': () => t('A limit order needs a limit price.'),
  'missing-stop': () => t('A stop order needs a stop price.'),
  'missing-trail': () => t('A trailing order needs a trail percentage.'),
  'option-expired': () => t('That contract has already expired.'),
  'margin-deficit': (v) => t('Your account owes {deficit}. Deposit first — you can close positions, but not open new ones.', { deficit: num(v.deficit) }),
  'market-closed': () => t('The market is closed. This will fill when it opens.'),
}

export function tradeErrorMessage(e: TradeError): string {
  return MESSAGES[e.code](e.vars ?? {})
}

/**
 * Why an order stopped resting.
 *
 * A wider union than TradeErrorCode: `ioc` and `day-expired` are not refusals at
 * all, they are an order reaching the end of the lifetime the user asked for, so
 * they read as statements rather than as complaints.
 */
const CANCEL_LABELS: Record<CancelReason, string> = {
  user: 'Cancelled',
  ioc: 'Expired — immediate-or-cancel',
  'day-expired': 'Expired — end of day',
  'no-symbol': 'Cancelled — no symbol',
  'unknown-instrument': 'Cancelled — unknown symbol',
  'no-quote': 'Cancelled — no price',
  'bad-qty': 'Cancelled — bad quantity',
  'bad-amount': 'Cancelled — bad amount',
  'insufficient-funds': 'Cancelled — not enough cash at fill',
  'insufficient-collateral': 'Cancelled — not enough collateral at fill',
  'exceeds-leverage': 'Cancelled — over the leverage cap',
  'reduce-only-would-open': 'Cancelled — reduce-only',
  'missing-limit': 'Cancelled — no limit price',
  'missing-stop': 'Cancelled — no stop price',
  'missing-trail': 'Cancelled — no trail',
  'option-expired': 'Cancelled — contract expired',
  'margin-deficit': 'Cancelled — account in deficit',
  'market-closed': 'Cancelled — market closed',
}

/** The stored `note` on a cancelled order is a raw code; anything unrecognised
 *  (a hand-edited row, a future engine) falls back to the plain word rather than
 *  printing machine text at the user. */
export function cancelReasonLabel(note: string | undefined): string {
  const key = note as CancelReason | undefined
  return t(key && key in CANCEL_LABELS ? CANCEL_LABELS[key] : 'Cancelled')
}

/** Advisory codes shown on the confirm sheet — the same messages, but they do
 *  not block the order. */
export function warningMessage(code: TradeErrorCode): string {
  return MESSAGES[code]({})
}

/**
 * Why live mode is not on. A `LiveNotice` code in, a sentence out — the same
 * split this file makes for `TradeErrorCode`, so the runtime never holds a word
 * a translator cannot reach.
 *
 * It sits here rather than in either of its two callers (the page shows it as an
 * inline alert, the settings sheet as a note under the Live chip) because a
 * component file exporting a non-component costs a fast-refresh warning, and
 * duplicating the two strings would cost a translator.
 */
export function liveNoticeMessage(n: LiveNotice): string | null {
  if (n === 'offline') return t('No connection, so the simulated market stayed on.')
  if (n === 'unreachable') return t('Could not reach the exchange, so the simulated market stayed on.')
  return null
}
