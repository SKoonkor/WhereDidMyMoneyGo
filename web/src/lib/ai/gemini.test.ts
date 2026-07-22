import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractReceipt, testConnection } from './gemini'
import type { AiCfg } from '../../data/defaults'
import type { ExtractContext, ReceiptImage } from './types'

const CFG: AiCfg = { enabled: true, provider: 'gemini', apiKey: 'AIzaTEST', model: 'gemini-3.5-flash', confirmBeforeSave: true, detailsCollapsed: false }
const CTX: ExtractContext = { categories: ['Food', 'Bills', 'Other'], defaultCurrency: 'THB', today: '2026-07-22' }
const IMG: ReceiptImage = { base64: 'data:image/jpeg;base64,QUJD', mime: 'image/jpeg' }

// Minimal fetch Response stand-in (our code only uses ok / status / json()).
function mkRes(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body }
}
// A Gemini generateContent reply carrying JSON text in the first candidate part.
function geminiText(text: string) {
  return mkRes(true, { candidates: [{ content: { parts: [{ text }] } }] })
}

afterEach(() => vi.unstubAllGlobals())

describe('gemini extractReceipt', () => {
  it('parses a clean structured-output JSON reply into a normalized draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      geminiText('{"amount": 249.5, "date": "2026-07-20", "merchant": "Tesco", "category": "Food", "currency": "thb", "confidence": 0.92}'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft).toEqual({
        amount: 249.5, date: '2026-07-20', merchant: 'Tesco', category: 'Food', currency: 'THB', confidence: 0.92,
      })
    }
  })

  it('coerces a string amount and clamps confidence; drops a bad date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      geminiText('{"amount": "1,234.50", "date": "20/07/2026", "confidence": 5}'),
    ))
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft.amount).toBe(1234.5)
      expect(r.draft.date).toBeNull()
      expect(r.draft.confidence).toBe(1)
    }
  })

  it('returns unreadable when the reply has no JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiText('sorry, no receipt found')))
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r).toEqual({ ok: false, error: 'unreadable' })
  })

  it('surfaces an HTTP error message from Google', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, { error: { message: 'API key not valid' } }, 400)))
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r).toEqual({ ok: false, error: 'API key not valid' })
  })

  it('reports network/CORS failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r).toEqual({ ok: false, error: 'Failed to fetch' })
  })

  it('short-circuits without a key and never calls fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await extractReceipt({ ...CFG, apiKey: '  ' }, IMG, CTX)
    expect(r).toEqual({ ok: false, error: 'missing-key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hits the model endpoint with the key header, inline image, and a JSON response schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiText('{"amount": 1, "date": "2026-07-22"}'))
    vi.stubGlobal('fetch', fetchMock)
    await extractReceipt(CFG, IMG, CTX)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')
    expect(opts.headers['x-goog-api-key']).toBe('AIzaTEST')
    const body = JSON.parse(opts.body)
    const parts = body.contents[0].parts
    const imgPart = parts.find((p: { inlineData?: unknown }) => p.inlineData)
    expect(imgPart.inlineData.mimeType).toBe('image/jpeg')
    expect(imgPart.inlineData.data).toBe('QUJD') // "data:image/jpeg;base64," stripped
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.type).toBe('object')
  })
})

describe('gemini testConnection', () => {
  it('returns ok on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(true, { candidates: [] })))
    expect(await testConnection(CFG)).toEqual({ ok: true })
  })

  it('returns the provider error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, { error: { message: 'API key not valid' } }, 400)))
    expect(await testConnection(CFG)).toEqual({ ok: false, error: 'API key not valid' })
  })

  it('falls back to HTTP status when no error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, null, 500)))
    expect(await testConnection(CFG)).toEqual({ ok: false, error: 'HTTP 500' })
  })
})
