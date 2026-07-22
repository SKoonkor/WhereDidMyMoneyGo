// Anthropic Claude provider. Called directly from the browser (no backend) via
// the documented CORS opt-in header `anthropic-dangerous-direct-browser-access`.
// The user's key lives only on this device and is sent only to api.anthropic.com.
import type { AiCfg } from '../../data/defaults'
import type { AiProvider, ExtractContext, ExtractResult, ReceiptImage, TestResult } from './types'
import { buildPrompt, errorMessage, normalizeDraft, parseJsonLoose, stripDataUrl } from './normalize'

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
