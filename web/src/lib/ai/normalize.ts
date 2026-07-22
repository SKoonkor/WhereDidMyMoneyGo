// Provider-agnostic helpers shared by every AI provider: the extraction prompt,
// tolerant JSON parsing, and coercion of a raw model object into a ReceiptDraft.
// Keeping these here means claude.ts / gemini.ts differ only in transport (URL,
// headers, request/response shape) — the "make any provider's output easy to
// handle" contract lives in one place.
import type { ExtractContext, ReceiptDraft } from './types'

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
