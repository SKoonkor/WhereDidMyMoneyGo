// The Amount field as a mini calculator: several amounts typed in one go,
// e.g. "500 - 75 + 25 - 12 - 5 + 33".
//
// The NET is what gets saved (466 here). The negatives are summed separately (92)
// and handed to the carry note, because a subtracted amount is almost always
// money that still belongs somewhere — a fee, another category, someone else's
// share — and it is the thing people forget to record once the receipt is gone.
//
// 0.8.0 added `×` and `÷`, with the precedence everyone expects:
// "500 - 3 × 45" is 365, not 22,275. Two left-to-right passes do it — collapse
// the multiplications, then sum — which is all textbook precedence needs without
// parentheses. Parentheses are still deliberately absent: an amount box that
// evaluates a general expression is a box you have to double-check, and the
// confirmation dialog only earns its interruption if the arithmetic is simple
// enough to verify at a glance.
//
// The carry note stands down as soon as × or ÷ appears (see `hasMulDiv`): in
// "3 × 45 - 20" there is no honest answer to "what was set aside", so rather than
// invent one the feature says nothing.
//
// Pure and testable; nothing here touches React or the ledger.

/** A number, or one of the four operators, in the order they were typed. */
export type Token = number | Op
export type Op = '+' | '-' | '*' | '/'

export interface AmountExpr {
  // Numbers and operators in typed order: [500, '-', 75, '+', 25]. The first
  // number carries its own sign ("-500" → [-500]); every later one is preceded by
  // its operator. Used to play the sum back in the confirmation dialog.
  terms: Token[]
  net: number // 466 — the transaction amount, and the only authoritative figure
  positive: number // 558
  // 92 — carried as "still to record". Always 0 once × or ÷ is involved, which
  // is what makes the carry note stand down: TxnForm gates it on `negative > 0`.
  negative: number
  hasMulDiv: boolean // × or ÷ was used, so net is NOT positive − negative
  multi: boolean // more than one number typed → worth confirming before saving
  valid: boolean // parsed cleanly (whether net > 0 is the form's business)
}

// A number: "500", "0.5", ".5", and "5." — the last so a preview doesn't blink out
// of existence in the instant between typing the dot and the digit after it.
const NUM = /^(?:\d+(?:\.\d*)?|\.\d+)/

const isOp = (c: string): c is Op => c === '+' || c === '-' || c === '*' || c === '/'

// A fresh object each time — callers hold on to these across renders.
const empty = (): AmountExpr => ({
  terms: [], net: 0, positive: 0, negative: 0, hasMulDiv: false, multi: false, valid: false,
})

// Strip what a phone keyboard or a paste adds but nobody means: spaces, and
// thousands separators. The comma is only removed where it separates exactly
// three digits — so "1,250" is 1250, while "1,5" stays junk rather than quietly
// becoming 15 for someone whose keyboard puts a comma on the decimal key.
//
// Operators arrive in whatever shape the source used: the in-app pad sends × and
// ÷, a physical keyboard sends * and /, and a person typing "3x45" means the same
// thing. All three are folded to one spelling here.
function normalize(raw: string): string {
  return raw
    .replace(/[−‒–—－]/g, '-') // minus / dashes → -
    .replace(/＋/g, '+') // full-width plus
    .replace(/[×xX✕✖]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/\s/g, '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
}

export function parseAmountExpr(raw: string): AmountExpr {
  // Two numbers with only a space between them is a dropped operator, and
  // stripping that space would turn "500 75" into 50075 — a hundredfold error
  // that would sail through every other check. Refuse it outright.
  if (/[\d.]\s+[\d.]/.test(raw)) return empty()

  const s = normalize(raw)
  const terms: Token[] = []
  let i = 0

  // expr := ['+'|'-'] NUM ( OP NUM )* [OP]
  while (i < s.length) {
    if (terms.length === 0) {
      // A leading sign belongs to the first number rather than being an operator
      // with nothing on its left.
      let sign = 1
      if (s[i] === '+' || s[i] === '-') {
        sign = s[i] === '-' ? -1 : 1
        i++
      } else if (isOp(s[i])) {
        return empty() // "×5" has no left-hand side
      }
      const m = NUM.exec(s.slice(i))
      if (!m) return empty()
      terms.push(sign * parseFloat(m[0]))
      i += m[0].length
      continue
    }

    if (!isOp(s[i])) return empty() // two numbers with nothing between them, or junk
    const op = s[i] as Op
    i++
    // A trailing operator is mid-typing, not a mistake: keep the terms so far and
    // let the preview stay put until the next digit arrives.
    if (i >= s.length) break
    const m = NUM.exec(s.slice(i))
    if (!m) return empty()
    terms.push(op, parseFloat(m[0]))
    i += m[0].length
  }

  if (terms.length === 0) return empty()

  const hasMulDiv = terms.some((tk) => tk === '*' || tk === '/')
  const numbers = terms.filter((tk) => typeof tk === 'number').length

  if (!hasMulDiv) {
    // The 0.7.0 path, unchanged: the additive terms ARE the numbers, so the
    // set-aside split is exact and the dialog's "558 − 92 = 466" adds up on
    // screen rather than being right to the satang and wrong to the eye.
    let positive = 0
    let negative = 0
    let sign = 1
    for (const tk of terms) {
      if (tk === '+') sign = 1
      else if (tk === '-') sign = -1
      else if (typeof tk === 'number') {
        const v = sign * tk
        if (v > 0) positive += v
        else negative -= v
      }
    }
    positive = round2(positive)
    negative = round2(negative)
    return {
      terms, net: round2(positive - negative), positive, negative,
      hasMulDiv: false, multi: numbers > 1, valid: true,
    }
  }

  // Pass 1: collapse × and ÷ into their left operand, left to right, leaving a
  // purely additive [num, op, num, …] sequence for pass 2.
  const additive: Token[] = []
  let pendingOp: Op | null = null
  for (const tk of terms) {
    if (typeof tk !== 'number') {
      pendingOp = tk
      continue
    }
    if (pendingOp === '*' || pendingOp === '/') {
      const left = additive.pop()
      if (typeof left !== 'number') return empty()
      // Never let Infinity reach an amount: "100 ÷ 0" is a typo, not a value.
      if (pendingOp === '/' && tk === 0) return empty()
      additive.push(pendingOp === '*' ? left * tk : left / tk)
    } else {
      if (pendingOp) additive.push(pendingOp)
      additive.push(tk)
    }
    pendingOp = null
  }

  // Pass 2: sum what is left, left to right.
  let net = 0
  let sign = 1
  for (const tk of additive) {
    if (tk === '+') sign = 1
    else if (tk === '-') sign = -1
    else if (typeof tk === 'number') net += sign * tk
    else return empty()
  }
  if (!Number.isFinite(net)) return empty()
  net = round2(net)

  // With a product in the mix there is no honest "what was set aside", so the
  // split collapses to the net and the carry note never fires.
  return {
    terms, net, positive: net > 0 ? net : 0, negative: 0,
    hasMulDiv: true, multi: numbers > 1, valid: true,
  }
}

// Money as it reads on a receipt; terms keep their typed shape (500, not 500.00)
// so the breakdown looks like what was actually entered.
const termText = (n: number) => Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

const OP_TEXT: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' }

// The typed sum played back for the confirmation: "500 − 75 + 25 − 12 − 5 + 33".
// Uses the typographic − × ÷ rather than the ASCII the parser accepts, because
// this line is read, not re-typed.
export function exprText(terms: Token[]): string {
  const out: string[] = []
  terms.forEach((tk, i) => {
    if (typeof tk === 'number') out.push(i === 0 && tk < 0 ? `−${termText(tk)}` : termText(tk))
    else out.push(OP_TEXT[tk])
  })
  return out.join(' ')
}

const round2 = (n: number) => Math.round(n * 100) / 100
