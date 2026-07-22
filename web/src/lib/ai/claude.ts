// Anthropic Claude provider. Called directly from the browser (no backend) via
// the documented CORS opt-in header `anthropic-dangerous-direct-browser-access`.
// The user's key lives only on this device and is sent only to api.anthropic.com.
// P4 ships the connection test; P5 adds receipt extraction on top of these helpers.
import type { AiCfg } from '../../data/defaults'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export type TestResult = { ok: true } | { ok: false; error: string }

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
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` }
  } catch (e) {
    // A CORS/network failure lands here (opaque to JS by design).
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
