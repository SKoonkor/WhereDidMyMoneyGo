import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractReceipt, testConnection } from './claude'
import type { AiCfg } from '../../data/defaults'
import type { ExtractContext, ReceiptImage } from './types'

const CFG: AiCfg = { enabled: true, provider: 'claude', apiKey: 'sk-ant-test', model: 'claude-sonnet-5', confirmBeforeSave: true, detailsCollapsed: false }
const CTX: ExtractContext = { categories: ['Food', 'Bills', 'Other'], defaultCurrency: 'THB', today: '2026-07-22' }
const IMG: ReceiptImage = { base64: 'data:image/jpeg;base64,QUJD', mime: 'image/jpeg' }

// Minimal fetch Response stand-in (our code only uses ok / status / json()).
function mkRes(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body }
}
// A Claude messages reply carrying `text` in the first content block.
function claudeText(text: string) {
  return mkRes(true, { content: [{ type: 'text', text }] })
}

afterEach(() => vi.unstubAllGlobals())

describe('extractReceipt', () => {
  it('parses a clean JSON reply into a normalized draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      claudeText('{"amount": 249.5, "date": "2026-07-20", "merchant": "Tesco", "category": "Food", "currency": "thb", "confidence": 0.92}'),
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

  it('tolerates code fences and surrounding prose', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      claudeText('Here you go:\n```json\n{"amount": 80, "date": "2026-01-02", "category": "Bills"}\n```\n'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft.amount).toBe(80)
      expect(r.draft.date).toBe('2026-01-02')
      expect(r.draft.currency).toBe('THB') // defaulted from ctx
    }
  })

  it('coerces a string amount and clamps confidence; drops a bad date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      claudeText('{"amount": "1,234.50", "date": "20/07/2026", "confidence": 5}'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft.amount).toBe(1234.5)
      expect(r.draft.date).toBeNull() // not YYYY-MM-DD
      expect(r.draft.confidence).toBe(1) // clamped
    }
  })

  it('returns unreadable when the reply has no JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(claudeText('I could not read this receipt.')))
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r).toEqual({ ok: false, error: 'unreadable' })
  })

  it('surfaces an HTTP error message from Anthropic', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, { error: { message: 'invalid x-api-key' } }, 401)))
    const r = await extractReceipt(CFG, IMG, CTX)
    expect(r).toEqual({ ok: false, error: 'invalid x-api-key' })
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

  it('sends the browser-access header, key, model, and a base64 image with the data: prefix stripped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(claudeText('{"amount": 1, "date": "2026-07-22"}'))
    vi.stubGlobal('fetch', fetchMock)
    await extractReceipt(CFG, IMG, CTX)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(opts.headers['x-api-key']).toBe('sk-ant-test')
    expect(opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = JSON.parse(opts.body)
    expect(body.model).toBe('claude-sonnet-5')
    const parts = body.messages[0].content
    const imgPart = parts.find((p: { type: string }) => p.type === 'image')
    expect(imgPart.source.media_type).toBe('image/jpeg')
    expect(imgPart.source.data).toBe('QUJD') // "data:image/jpeg;base64," stripped
  })
})

describe('testConnection', () => {
  it('returns ok on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(true, { content: [] })))
    expect(await testConnection(CFG)).toEqual({ ok: true })
  })

  it('returns the provider error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, { error: { message: 'model not found' } }, 404)))
    expect(await testConnection(CFG)).toEqual({ ok: false, error: 'model not found' })
  })

  it('falls back to HTTP status when no error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, null, 500)))
    expect(await testConnection(CFG)).toEqual({ ok: false, error: 'HTTP 500' })
  })
})
