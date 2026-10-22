// Provider-agnostic helpers shared by every AI provider: the extraction prompt,
// tolerant JSON parsing, and coercion of a raw model object into a ReceiptDraft.
// Keeping these here means claude.ts / gemini.ts differ only in transport (URL,
// headers, request/response shape) — the "make any provider's output easy to
// handle" contract lives in one place.
import type { ExtractContext, ReceiptDraft, VoiceContext, VoiceDraft, VoiceKind } from './types'

// The extraction instructions. Provider-neutral: it names the exact fields and
// steers the model toward the user's own expense categories + default currency.
// Gemini also gets a JSON schema (structured output); Claude relies on this text.
export function buildPrompt(ctx: ExtractContext): string {
  return [
    'You are a receipt-scanning assistant for a personal finance app.',
    'Read the receipt image and reply with ONLY a JSON object (no prose, no code fences) with exactly these keys:',
    '- amount: number — the grand TOTAL paid, as a plain number with no currency symbol or thousands separators. null if unreadable.',
    `- date: string — the purchase date as "YYYY-MM-DD". If the year is missing, assume ${ctx.today.slice(0, 4)}. null if absent.`,
    '- merchant: string — the store/vendor name. Omit if unknown.',
    `- category: string — the single best match from this list: [${ctx.categories.join(', ')}]. If none fit, use "Other".`,
    `- currency: string — the currency code on the receipt (e.g. THB, USD). Default to ${ctx.defaultCurrency} if not shown.`,
    '- confidence: number from 0 to 1 — your overall confidence.',
    'Return only the JSON object.',
  ].join('\n')
}

// Read a human-readable error out of a failed response. Anthropic and Google both
// use `{ error: { message } }`, so one helper covers both.
export async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return body?.error?.message ?? `HTTP ${res.status}`
}

// Drop a leading `data:<mime>;base64,` prefix if present — APIs want the raw b64.
export function stripDataUrl(b64: string): string {
  const comma = b64.indexOf(',')
  return b64.startsWith('data:') && comma >= 0 ? b64.slice(comma + 1) : b64
}

// Pull the first balanced-looking JSON object out of a model reply, tolerating
// ```json fences or stray prose around it. (Structured-output providers already
// return clean JSON; this keeps the loosely-prompted ones working too.)
export function parseJsonLoose(text: string): Record<string, unknown> | null {
  if (!text) return null
  const fenced = text.replace(/```(?:json)?/gi, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function toAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, '')) // strip symbols/commas
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
}

function toStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

// Coerce a raw model object (any provider) into a validated ReceiptDraft: amounts
// as plain numbers, dates as YYYY-MM-DD, currency upper-cased with a fallback,
// confidence clamped to 0..1.
export function normalizeDraft(raw: Record<string, unknown>, ctx: ExtractContext): ReceiptDraft {
  const confidence = typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : undefined
  return {
    amount: toAmount(raw.amount),
    date: toDate(raw.date),
    merchant: toStr(raw.merchant),
    category: toStr(raw.category),
    currency: (toStr(raw.currency) ?? ctx.defaultCurrency).toUpperCase(),
    confidence,
  }
}

// ── Voice entry ──────────────────────────────────────────────────────────────

// Longest transcript we send. A spoken transaction is a sentence; this only stops
// a runaway paste from becoming a runaway bill.
export const MAX_VOICE_CHARS = 1000

export function buildVoicePrompt(ctx: VoiceContext): string {
  // JSON, so a name containing a comma, semicolon or bracket can't be misread.
  const accounts = JSON.stringify(ctx.accounts)
  const income = JSON.stringify(ctx.income)
  const expense = JSON.stringify(ctx.expense)
  return [
    'You turn one spoken sentence (English, Thai, or a mix) into a transaction for a personal finance app.',
    'Reply with ONLY a JSON object (no prose, no code fences) with exactly these keys:',
    '- kind: "Expense", "Income" or "Transfer". Money moved between the speaker\'s own accounts is a Transfer; money received (salary, gift, refund) is Income; otherwise Expense.',
    '- amount: number — the amount as a plain positive number, no currency symbol or separators. null if none was said.',
    `- date: string "YYYY-MM-DD". Today is ${ctx.today} (${ctx.weekday}). Resolve words like yesterday / last Friday / เมื่อวาน / วันนี้ against it. If no date was said, use ${ctx.today}.`,
    `- account: string — which account the money came from (for Income: went into). Exactly one of this JSON list: ${accounts}. Omit if not said.`,
    '- toAccount: string — Transfer only: the destination account, from the same list. Omit otherwise.',
    `- category: string — Expense: exactly one KEY of this JSON object (its values are that category's sub-categories): ${expense}. Income: exactly one of this JSON list: ${income}. Omit for a Transfer, or if nothing fits.`,
    '- subcategory: string — Expense only: exactly one sub-category from the chosen category\'s list. Omit if none fits.',
    '- note: string — a short description of what it was for, without the amount or date. Omit if nothing to say.',
    `The default currency is ${ctx.defaultCurrency}; ignore currency words, never convert.`,
    'Never invent account or category names; use the exact spelling from the lists, or omit the key.',
    'Return only the JSON object.',
  ].join('\n')
}

// Exact name from `options` that matches `v` ignoring case and surrounding space.
// Compared in NFC with runs of whitespace (incl. NBSP) collapsed: Thai
// vowel/tone marks and speech-to-text output don't always agree on codepoint order.
const fold = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
function matchName(v: unknown, options: string[]): string | undefined {
  const s = toStr(v)
  if (!s) return undefined
  const f = fold(s)
  return options.find((o) => fold(o) === f)
}

// A spoken amount must be a plain number. Unlike a receipt (where "฿1,234.50" is
// normal), "1.5k" or "12-5" must not be quietly read as 1.5 or 12 — leave it
// empty and let the user type it.
function voiceAmount(v: unknown): number | null {
  let n: number | null = null
  if (typeof v === 'number') n = Number.isFinite(v) ? v : null
  else if (typeof v === 'string') {
    const s = v.trim().replace(/,/g, '')
    n = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
  }
  if (n === null) return null
  const abs = Math.round(Math.abs(n) * 100) / 100
  return abs === 0 ? null : abs
}

// A real calendar date, not just the right shape ("2026-02-30" is not one).
function realDate(v: unknown): string | null {
  const d = toDate(v)
  if (!d) return null
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day ? d : null
}

// Coerce a raw model object into a VoiceDraft validated against the user's own
// data. Unknown names are dropped (never invented), a missing/invalid date is
// today, a missing type is Expense, and the rules that make a transaction
// well-formed are enforced here rather than trusted to the model.
export function normalizeVoiceDraft(raw: Record<string, unknown>, ctx: VoiceContext): VoiceDraft {
  const kindRaw = toStr(raw.kind)?.toLowerCase()
  const kind: VoiceKind =
    kindRaw === 'income' ? 'Income' : kindRaw === 'transfer' ? 'Transfer' : 'Expense'

  const draft: VoiceDraft = { kind, amount: voiceAmount(raw.amount), date: realDate(raw.date) ?? ctx.today }

  const account = matchName(raw.account, ctx.accounts)
  if (account) draft.account = account

  if (kind === 'Transfer') {
    const to = matchName(raw.toAccount, ctx.accounts)
    if (to && to !== account) draft.toAccount = to
  } else {
    let category = matchName(raw.category, kind === 'Income' ? ctx.income : Object.keys(ctx.expense))
    // A sub-category named without its category: take the parent when it is unambiguous.
    if (!category && kind === 'Expense') {
      const parents = Object.keys(ctx.expense).filter((c) => matchName(raw.subcategory, ctx.expense[c]))
      if (parents.length === 1) category = parents[0]
    }
    if (category) {
      draft.category = category
      if (kind === 'Expense') {
        const subcategory = matchName(raw.subcategory, ctx.expense[category] ?? [])
        if (subcategory) draft.subcategory = subcategory
      }
    }
  }

  const note = toStr(raw.note)
  if (note) draft.note = note
  return draft
}
