import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { VoiceCapture } from './VoiceCapture'
import { db, ensureSeeded, saveAi } from '../../db'
import { DEFAULT_AI } from '../../data/defaults'
import type { VoiceDraft } from '../../lib/ai'

const extractVoice = vi.fn()
vi.mock('../../lib/ai', async (orig) => ({
  ...(await orig<typeof import('../../lib/ai')>()),
  makeProvider: () => ({ extractVoice }),
}))

const DRAFT: VoiceDraft = { kind: 'Expense', amount: 120, date: '2026-10-22', account: 'Cash', category: 'Food' }

beforeEach(async () => {
  extractVoice.mockReset()
  localStorage.removeItem('pref-lang')
  await db.transactions.clear()
  await db.config.clear()
  await ensureSeeded()
  await saveAi({ ...DEFAULT_AI, enabled: true, apiKey: 'sk-test' })
})
afterEach(() => { delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition })

// A controllable stand-in for the browser's recognizer.
class FakeRec {
  static last: FakeRec | null = null
  lang = ''
  interimResults = false
  continuous = false
  aborted = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() { FakeRec.last = this }
  start() {}
  stop() { this.onend?.() }
  abort() { this.aborted = true }
  say(final: string, interim = '') {
    const res = [{ isFinal: true, 0: { transcript: final } }]
    if (interim) res.push({ isFinal: false, 0: { transcript: interim } })
    this.onresult?.({ resultIndex: 0, results: res })
  }
}
const install = () => { (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRec }

describe('VoiceCapture without speech recognition (iPhone home-screen case)', () => {
  it('hides the mic, says to dictate, and still reads typed text', async () => {
    extractVoice.mockResolvedValue({ ok: true, draft: DRAFT })
    const onExtracted = vi.fn()
    render(<VoiceCapture onExtracted={onExtracted} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /start listening/i })).toBeNull()
    expect(screen.getByText(/tap 🎤 on your keyboard/i)).toBeInTheDocument()
    const read = screen.getByRole('button', { name: 'Read it' })
    expect(read).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What you said'), { target: { value: 'lunch 120 from cash' } })
    fireEvent.click(read)
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(DRAFT, 'lunch 120 from cash'))
    // The provider got the user's own accounts and categories.
    const ctx = extractVoice.mock.calls[0][1]
    expect(ctx.accounts.length).toBeGreaterThan(0)
    expect(Object.keys(ctx.expense).length).toBeGreaterThan(0)
    expect(ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('shows the provider error and stays open', async () => {
    extractVoice.mockResolvedValue({ ok: false, error: 'unreadable' })
    const onExtracted = vi.fn()
    render(<VoiceCapture onExtracted={onExtracted} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('What you said'), { target: { value: 'mumble' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/try saying it again/i)
    expect(onExtracted).not.toHaveBeenCalled()
  })
})

describe('VoiceCapture with speech recognition', () => {
  it('listens in the app language, appends to typed text, and releases the mic on close', async () => {
    install()
    const { unmount } = render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('What you said'), { target: { value: 'coffee' } })
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    const rec = FakeRec.last!
    expect(rec.lang).toBe('en-US')
    expect(rec.interimResults).toBe(true)
    act(() => rec.say('80 baht', 'from KB'))
    expect((screen.getByLabelText('What you said') as HTMLTextAreaElement).value).toBe('coffee 80 baht from KB')
    unmount()
    expect(rec.aborted).toBe(true)
  })

  it('typing while listening stops the mic so a late speech result cannot wipe it', () => {
    install()
    render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    const rec = FakeRec.last!
    act(() => rec.say('lunch'))
    fireEvent.change(screen.getByLabelText('What you said'), { target: { value: 'lunch 120' } })
    expect(rec.aborted).toBe(true)
    act(() => rec.say('lunch', 'again')) // a straggler after the abort is ignored
    expect((screen.getByLabelText('What you said') as HTMLTextAreaElement).value).toBe('lunch 120')
    expect(screen.getByRole('button', { name: /start listening/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('uses Thai when the app is Thai', () => {
    localStorage.setItem('pref-lang', 'th')
    install()
    render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /เริ่มฟัง/ }))
    expect(FakeRec.last!.lang).toBe('th-TH')
  })

  it('maps a blocked-microphone error to a friendly line, and ignores our own abort', () => {
    install()
    render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    act(() => FakeRec.last!.onerror?.({ error: 'aborted' }))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => FakeRec.last!.onerror?.({ error: 'not-allowed' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/microphone access is blocked/i)
  })

  it('a failing read (provider throws) shows an error instead of sticking on Reading…', async () => {
    extractVoice.mockRejectedValue(new Error('boom'))
    render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('What you said'), { target: { value: 'x 5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t reach your ai provider/i)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/boom/)
    expect(screen.getByRole('button', { name: 'Read it' })).not.toBeDisabled()
  })

  it('an engine error that never fires end still turns the mic off', () => {
    install()
    render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    act(() => FakeRec.last!.onerror?.({ error: 'network' }))
    expect(screen.getByRole('button', { name: /start listening/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('after an engine error, a quick re-tap is not switched off by the dead session\'s late end', () => {
    install()
    render(<VoiceCapture onExtracted={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    const first = FakeRec.last!
    act(() => first.onerror?.({ error: 'no-speech' }))
    expect(first.aborted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    const second = FakeRec.last!
    expect(second).not.toBe(first)
    act(() => first.onend?.()) // late end from the first session
    expect(screen.getByRole('button', { name: /stop listening/i })).toHaveAttribute('aria-pressed', 'true')
    act(() => second.say('still listening'))
    expect((screen.getByLabelText('What you said') as HTMLTextAreaElement).value).toBe('still listening')
  })

  it('does not call back after the sheet closed mid-read', async () => {
    let resolve!: (v: unknown) => void
    extractVoice.mockReturnValue(new Promise((r) => { resolve = r }))
    const onExtracted = vi.fn()
    const { unmount } = render(<VoiceCapture onExtracted={onExtracted} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('What you said'), { target: { value: 'x 5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }))
    await waitFor(() => expect(extractVoice).toHaveBeenCalled())
    unmount()
    resolve({ ok: true, draft: DRAFT })
    await Promise.resolve()
    expect(onExtracted).not.toHaveBeenCalled()
  })
})
