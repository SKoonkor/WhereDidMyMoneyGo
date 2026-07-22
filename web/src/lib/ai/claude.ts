// Anthropic Claude provider. Called directly from the browser (no backend) via
// the documented CORS opt-in header `anthropic-dangerous-direct-browser-access`.
// The user's key lives only on this device and is sent only to api.anthropic.com.
import type { AiCfg } from '../../data/defaults'
import type { AiProvider, ExtractContext, ExtractResult, ReceiptDraft, ReceiptImage, TestResult } from './types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

// A tiny round-trip to confirm the key + model are valid and reachable from the
// browser. Returns a human-readable error (from Anthropic where available).
export async function testConnection(cfg: AiCfg): Promise<TestResult> {
  if (!cfg.apiKey.trim()) return { ok: false, error: 'missing-key' }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: headers(cfg.apiKey.trim()),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: await errorMessage(res) }
  } catch (e) {
    // A CORS/network failure lands here (opaque to JS by design).
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

// Extract a transaction from a receipt image. Returns a best-effort draft; the
// caller reviews it before saving.
export async function extractReceipt(
  cfg: AiCfg,
  image: ReceiptImage,
  ctx: ExtractContext,
): Promise<ExtractResult> {
  if (!cfg.apiKey.trim()) return { ok: false, error: 'missing-key' }
  const prompt = buildPrompt(ctx)
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: headers(cfg.apiKey.trim()),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mime, data: stripDataUrl(image.base64) } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })
    if (!res.ok) return { ok: false, error: await errorMessage(res) }
    const data = (await res.json().catch(() => null)) as { content?: Array<{ type?: string; text?: string }> } | null
    const text = data?.content?.find((b) => b.type === 'text')?.text ?? ''
    const raw = parseJsonLoose(text)
    if (!raw) return { ok: false, error: 'unreadable' }
    return { ok: true, draft: normalizeDraft(raw, ctx) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

// The Claude provider bound to a config.
export function createClaudeProvider(cfg: AiCfg): AiProvider {
  return {
    testConnection: () => testConnection(cfg),
    extractReceipt: (image, ctx) => extractReceipt(cfg, image, ctx),
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return body?.error?.message ?? `HTTP ${res.status}`
}

function buildPrompt(ctx: ExtractContext): string {
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

function stripDataUrl(b64: string): string {
  const comma = b64.indexOf(',')
  return b64.startsWith('data:') && comma >= 0 ? b64.slice(comma + 1) : b64
}

// Pull the first balanced-looking JSON object out of a model reply, tolerating
// ```json fences or stray prose around it.
function parseJsonLoose(text: string): Record<string, unknown> | null {
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

function normalizeDraft(raw: Record<string, unknown>, ctx: ExtractContext): ReceiptDraft {
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
