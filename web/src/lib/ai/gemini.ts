// Google Gemini provider. Called directly from the browser (no backend) — the
// Generative Language API sends CORS headers and accepts the key via the
// `x-goog-api-key` header (kept out of the URL/logs). The key lives only on this
// device and is sent only to generativelanguage.googleapis.com.
//
// Gemini supports *structured output*: we pass a JSON schema and set the response
// MIME type to application/json, so the model returns exactly our fields rather
// than prose we have to fish JSON out of. normalizeDraft still validates/coerces
// the values (schema-valid ≠ semantically correct).
import type { AiCfg } from '../../data/defaults'
import type { AiProvider, ExtractContext, ExtractResult, ReceiptImage, TestResult } from './types'
import { buildPrompt, errorMessage, normalizeDraft, parseJsonLoose, stripDataUrl } from './normalize'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function endpoint(model: string): string {
  return `${BASE}/${encodeURIComponent(model)}:generateContent`
}

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey }
}

// OpenAPI-subset schema that pins the receipt fields. `nullable` lets the model
// return null for anything it can't read (partial receipts).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: 'number', nullable: true },
    date: { type: 'string', nullable: true },
    merchant: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
    currency: { type: 'string', nullable: true },
    confidence: { type: 'number', nullable: true },
  },
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

function textOf(data: GeminiResponse | null): string {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
}

// Tiny round-trip to confirm the key + model are valid and reachable. A 200 is
// enough (we don't care about the reply); errors surface Google's message.
export async function testConnection(cfg: AiCfg): Promise<TestResult> {
  if (!cfg.apiKey.trim()) return { ok: false, error: 'missing-key' }
  try {
    const res = await fetch(endpoint(cfg.model), {
      method: 'POST',
      headers: headers(cfg.apiKey.trim()),
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: await errorMessage(res) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

// Extract a transaction from a receipt image via structured output.
export async function extractReceipt(
  cfg: AiCfg,
  image: ReceiptImage,
  ctx: ExtractContext,
): Promise<ExtractResult> {
  if (!cfg.apiKey.trim()) return { ok: false, error: 'missing-key' }
  const prompt = buildPrompt(ctx)
  try {
    const res = await fetch(endpoint(cfg.model), {
      method: 'POST',
      headers: headers(cfg.apiKey.trim()),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: image.mime, data: stripDataUrl(image.base64) } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // Generous cap so a thinking model still has room to emit the JSON.
          maxOutputTokens: 2048,
        },
      }),
    })
    if (!res.ok) return { ok: false, error: await errorMessage(res) }
    const data = (await res.json().catch(() => null)) as GeminiResponse | null
    const raw = parseJsonLoose(textOf(data))
    if (!raw) return { ok: false, error: 'unreadable' }
    return { ok: true, draft: normalizeDraft(raw, ctx) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

// The Gemini provider bound to a config.
export function createGeminiProvider(cfg: AiCfg): AiProvider {
  return {
    testConnection: () => testConnection(cfg),
    extractReceipt: (image, ctx) => extractReceipt(cfg, image, ctx),
  }
}
