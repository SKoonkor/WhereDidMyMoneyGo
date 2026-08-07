// The Amount field as a mini calculator: several amounts typed in one go,
// e.g. "500 - 75 + 25 - 12 - 5 + 33".
//
// The NET is what gets saved (466 here). The negatives are summed separately (92)
// and handed to the carry note, because a subtracted amount is almost always
// money that still belongs somewhere — a fee, another category, someone else's
// share — and it is the thing people forget to record once the receipt is gone.
//
// Deliberately only `+` and `-`. No multiplication, no parentheses: an amount box
// that silently evaluates a general expression is a box you have to double-check,
// and the confirmation dialog only earns its interruption if the arithmetic is
// simple enough to verify at a glance.
//
// Pure and testable; nothing here touches React or the ledger.

export interface AmountExpr {
  terms: number[] // signed, in typed order: [500, -75, 25, -12, -5, 33]
  net: number // 466 — the transaction amount
  positive: number // 558
  negative: number // 92 — carried as "still to record"
  multi: boolean // more than one number typed → worth confirming before saving
  valid: boolean // parsed cleanly (whether net > 0 is the form's business)
}

// A number: "500", "0.5", ".5", and "5." — the last so a preview doesn't blink out
// of existence in the instant between typing the dot and the digit after it.
const NUM = /^(?:\d+(?:\.\d*)?|\.\d+)/

// A fresh object each time — callers hold on to these across renders.
const empty = (): AmountExpr => ({
  terms: [], net: 0, positive: 0, negative: 0, multi: false, valid: false,
})

// Strip what a phone keyboard or a paste adds but nobody means: spaces, and
// thousands separators. The comma is only removed where it separates exactly
// three digits — so "1,250" is 1250, while "1,5" stays junk rather than quietly
// becoming 15 for someone whose keyboard puts a comma on the decimal key.
function normalize(raw: string): string {
  return raw
    .replace(/[−‒–—－]/g, '-') // minus / dashes → -
    .replace(/＋/g, '+') // full-width plus
    .replace(/\s/g, '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
}

export function parseAmountExpr(raw: string): AmountExpr {
  // Two numbers with only a space between them is a dropped operator, and
  // stripping that space would turn "500 75" into 50075 — a hundredfold error
  // that would sail through every other check. Refuse it outright.
  if (/[\d.]\s+[\d.]/.test(raw)) return empty()

  const s = normalize(raw)
  const terms: number[] = []
  let i = 0

  while (i < s.length) {
    let sign = 1
    if (s[i] === '+' || s[i] === '-') {
      sign = s[i] === '-' ? -1 : 1
      i++
      // A trailing operator is mid-typing, not a mistake: keep the terms so far
      // and let the preview stay put until the next digit arrives.
      if (i >= s.length) break
    } else if (terms.length > 0) {
      return empty() // two numbers with nothing between them, or trailing junk
    }
    const m = NUM.exec(s.slice(i))
    if (!m) return empty()
    terms.push(sign * parseFloat(m[0]))
    i += m[0].length
  }

  if (terms.length === 0) return empty()

  const positive = round2(terms.reduce((sum, n) => (n > 0 ? sum + n : sum), 0))
  const negative = round2(terms.reduce((sum, n) => (n < 0 ? sum - n : sum), 0))
  // From the rounded halves, so the dialog's "558 − 92 = 466" always adds up on
  // screen rather than being right to the satang and wrong to the eye.
  return {
    terms,
    net: round2(positive - negative),
    positive,
    negative,
    multi: terms.length > 1,
    valid: true,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
