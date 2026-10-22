import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildVoicePrompt, normalizeVoiceDraft } from './normalize'
import { extractVoice as claudeVoice } from './claude'
import { extractVoice as geminiVoice } from './gemini'
import type { AiCfg } from '../../data/defaults'
import type { VoiceContext } from './types'

const CTX: VoiceContext = {
  accounts: ['Cash', 'KBank', 'Savings'],
  expense: { Food: ['Lunch', 'Coffee'], Bills: ['Phone'], Other: [] },
  income: ['Salary', 'Gift'],
  today: '2026-10-22',
  weekday: 'Thursday',
  defaultCurrency: 'THB',
}

describe('normalizeVoiceDraft', () => {
  it('maps a clean expense, matching names case-insensitively to the stored spelling', () => {
    const d = normalizeVoiceDraft(
      { kind: 'expense', amount: 120, date: '2026-10-21', account: 'cash', category: 'FOOD', subcategory: 'lunch', note: 'Pad thai' },
      CTX,
    )
    expect(d).toEqual({
      kind: 'Expense', amount: 120, date: '2026-10-21', account: 'Cash', category: 'Food', subcategory: 'Lunch', note: 'Pad thai',
    })
  })

  it('defaults a missing or impossible date to today (the local date passed in), and the type to Expense', () => {
    expect(normalizeVoiceDraft({ amount: 5 }, CTX)).toMatchObject({ kind: 'Expense', date: '2026-10-22' })
    expect(normalizeVoiceDraft({ amount: 5, date: '2026-02-30' }, CTX).date).toBe('2026-10-22')
    expect(normalizeVoiceDraft({ amount: 5, date: 'yesterday' }, CTX).date).toBe('2026-10-22')
    expect(normalizeVoiceDraft({ amount: 5, kind: 'refund?' }, CTX).kind).toBe('Expense')
  })

  it('drops names that are not the user’s own, never inventing them', () => {
    const d = normalizeVoiceDraft({ amount: 9, account: 'Wallet', category: 'Pets', subcategory: 'Food' }, CTX)
    expect(d.account).toBeUndefined()
    expect(d.category).toBeUndefined()
    expect(d.subcategory).toBeUndefined()
  })

  it('keeps a sub-category only when it belongs to the chosen category', () => {
    expect(normalizeVoiceDraft({ amount: 9, category: 'Food', subcategory: 'Phone' }, CTX).subcategory).toBeUndefined()
    // No category given: the parent is inferred from a sub-category that is unique to it.
    expect(normalizeVoiceDraft({ amount: 9, subcategory: 'Lunch' }, CTX)).toMatchObject({ category: 'Food', subcategory: 'Lunch' })
  })

  it('income uses the income category list and never carries a sub-category', () => {
    const d = normalizeVoiceDraft({ kind: 'Income', amount: 30000, category: 'salary', subcategory: 'Lunch', account: 'KBank' }, CTX)
    expect(d).toMatchObject({ kind: 'Income', category: 'Salary', account: 'KBank' })
    expect(d.subcategory).toBeUndefined()
    // An expense category is not valid for income.
    expect(normalizeVoiceDraft({ kind: 'Income', amount: 1, category: 'Food' }, CTX).category).toBeUndefined()
  })

  it('transfer: from/to accounts, no category, and to must differ from from', () => {
    const d = normalizeVoiceDraft({ kind: 'Transfer', amount: 500, account: 'Cash', toAccount: 'savings', category: 'Food' }, CTX)
    expect(d).toMatchObject({ kind: 'Transfer', account: 'Cash', toAccount: 'Savings' })
    expect(d.category).toBeUndefined()
    expect(normalizeVoiceDraft({ kind: 'Transfer', amount: 5, account: 'Cash', toAccount: 'Cash' }, CTX).toAccount).toBeUndefined()
  })

  it('amount: strings are parsed, negatives become positive, zero/garbage become null', () => {
    expect(normalizeVoiceDraft({ amount: '1,250.50' }, CTX).amount).toBe(1250.5)
    expect(normalizeVoiceDraft({ amount: -80 }, CTX).amount).toBe(80)
    expect(normalizeVoiceDraft({ amount: 0 }, CTX).amount).toBeNull()
    expect(normalizeVoiceDraft({ amount: 'lots' }, CTX).amount).toBeNull()
    expect(normalizeVoiceDraft({}, CTX).amount).toBeNull()
  })

  it('amount: only plain numbers — "1.5k" or "12-5" are left empty, not misread', () => {
    expect(normalizeVoiceDraft({ amount: '1.5k' }, CTX).amount).toBeNull()
    expect(normalizeVoiceDraft({ amount: '12-5' }, CTX).amount).toBeNull()
    expect(normalizeVoiceDraft({ amount: '1.2.3' }, CTX).amount).toBeNull()
    expect(normalizeVoiceDraft({ amount: 99.999 }, CTX).amount).toBe(100)
  })

  it('names match across Unicode forms and odd whitespace (Thai, NBSP)', () => {
    const th: VoiceContext = { ...CTX, accounts: ['เงิน\u0e33สด', 'Main  Account'], expense: { 'ค่า\u0e33ข้าว': [] }, income: [] }
    // sara am as U+0E4D + U+0E32 is how some speech engines emit it
    expect(normalizeVoiceDraft({ amount: 1, account: 'เงิน\u0e4d\u0e32สด' }, th).account).toBeUndefined() // NFC does not merge these two
    expect(normalizeVoiceDraft({ amount: 1, account: 'main\u00a0account' }, th).account).toBe('Main  Account')
    expect(normalizeVoiceDraft({ amount: 1, category: 'ค่า\u0e33ข้าว' }, th).category).toBe('ค่า\u0e33ข้าว')
  })

  it('a sub-category named without its category infers the parent only when unambiguous', () => {
    expect(normalizeVoiceDraft({ amount: 1, subcategory: 'phone' }, CTX)).toMatchObject({ category: 'Bills', subcategory: 'Phone' })
    const dup: VoiceContext = { ...CTX, expense: { Food: ['Other'], Bills: ['Other'] } }
    expect(normalizeVoiceDraft({ amount: 1, subcategory: 'Other' }, dup).category).toBeUndefined()
  })

  it('a blank note is omitted', () => {
    expect('note' in normalizeVoiceDraft({ amount: 1, note: '   ' }, CTX)).toBe(false)
  })
})

describe('buildVoicePrompt', () => {
  it('carries today + weekday and the user’s own names', () => {
    const p = buildVoicePrompt(CTX)
    expect(p).toContain('2026-10-22 (Thursday)')
    expect(p).toContain('["Cash","KBank","Savings"]')
    expect(p).toContain('"Food":["Lunch","Coffee"]')
    expect(p).toContain('["Salary","Gift"]')
  })
})

const CLAUDE: AiCfg = { enabled: true, provider: 'claude', apiKey: 'sk-ant-test', model: 'claude-sonnet-5', confirmBeforeSave: true, detailsCollapsed: false }
const GEMINI: AiCfg = { ...CLAUDE, provider: 'gemini', model: 'gemini-3.5-flash' }
const mkRes = (ok: boolean, body: unknown, status = ok ? 200 : 400) => ({ ok, status, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

describe('claude extractVoice', () => {
  it('sends text only (no image), with the prompt as system, and normalizes the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mkRes(true, { content: [{ type: 'text', text: '{"kind":"Expense","amount":120,"account":"cash","category":"food"}' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await claudeVoice(CLAUDE, 'lunch 120 from cash', CTX)
    expect(r).toEqual({ ok: true, draft: { kind: 'Expense', amount: 120, date: '2026-10-22', account: 'Cash', category: 'Food' } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([{ role: 'user', content: 'lunch 120 from cash' }])
    expect(body.system).toContain('2026-10-22')
    expect(JSON.stringify(body)).not.toContain('"image"')
  })

  it('missing key, empty text, unreadable reply, HTTP error, network error', async () => {
    expect(await claudeVoice({ ...CLAUDE, apiKey: ' ' }, 'x', CTX)).toEqual({ ok: false, error: 'missing-key' })
    expect(await claudeVoice(CLAUDE, '   ', CTX)).toEqual({ ok: false, error: 'empty' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(true, { content: [{ type: 'text', text: 'sorry' }] })))
    expect(await claudeVoice(CLAUDE, 'x', CTX)).toEqual({ ok: false, error: 'unreadable' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mkRes(false, { error: { message: 'bad key' } }, 401)))
    expect(await claudeVoice(CLAUDE, 'x', CTX)).toEqual({ ok: false, error: 'bad key' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await claudeVoice(CLAUDE, 'x', CTX)).toEqual({ ok: false, error: 'offline' })
  })

  it('caps the transcript length sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mkRes(true, { content: [{ type: 'text', text: '{"amount":1}' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await claudeVoice(CLAUDE, 'a'.repeat(5000), CTX)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toHaveLength(1000)
  })
})

describe('gemini extractVoice', () => {
  it('uses systemInstruction + structured output and normalizes the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mkRes(true, { candidates: [{ content: { parts: [{ text: '{"kind":"Transfer","amount":500,"account":"Cash","toAccount":"Savings"}' }] } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await geminiVoice(GEMINI, 'move 500 to savings', CTX)
    expect(r).toEqual({ ok: true, draft: { kind: 'Transfer', amount: 500, date: '2026-10-22', account: 'Cash', toAccount: 'Savings' } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.contents[0].parts).toEqual([{ text: 'move 500 to savings' }])
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })
})
