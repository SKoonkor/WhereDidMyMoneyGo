import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { getAccounts, getAi, getCategories, getSettings } from '../../db'
import { makeProvider, type VoiceContext, type VoiceDraft } from '../../lib/ai'
import { todayISO } from '../../lib/analytics/reconcile'
import { getLang, t } from '../../i18n'
import {
  isSpeechSupported, speechErrorMessage, speechLang, startListening, type SpeechHandle,
} from './speech'

function friendlyError(err: string): string {
  if (err === 'missing-key') return t('Add your API key in Settings first.')
  if (err === 'unreadable') return t("Couldn't understand that — try saying it again.")
  if (err === 'empty') return t('Say or type a transaction first.')
  return t('Voice entry failed: {error}', { error: err })
}

// Say (or type, or dictate with the keyboard) one transaction. The sentence is
// sent to the AI provider as text and comes back as a draft; the parent then
// opens the normal form for the user to check — nothing is saved from here.
export function VoiceCapture({
  onExtracted,
  onClose,
}: {
  onExtracted: (draft: VoiceDraft, heard: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'error'>('idle')
  const [error, setError] = useState('')
  const handle = useRef<SpeechHandle | null>(null)
  // What was in the box when the mic was tapped; the live transcript is appended
  // to it so dictating never wipes out something typed.
  const base = useRef('')
  const alive = useRef(true)
  const supported = isSpeechSupported()

  // Release the mic and drop late callbacks if the sheet closes mid-sentence.
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; handle.current?.abort() }
  }, [])

  const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ')

  function toggleMic() {
    if (listening) { handle.current?.stop(); return }
    setError('')
    setPhase('idle')
    base.current = text
    const h = startListening({
      lang: speechLang(getLang()),
      onText: (fin, interim) => setText(join(base.current, join(fin, interim))),
      onError: (code) => {
        const msg = speechErrorMessage(code)
        if (msg) { setPhase('error'); setError(msg) }
        // Some engines never fire `end` after an error; don't leave the mic stuck on.
        // Abort first so the dead session's late `end` can't switch off a NEW one
        // started in the meantime.
        if (code !== 'aborted') { handle.current?.abort(); handle.current = null; setListening(false) }
      },
      onEnd: () => { handle.current = null; setListening(false) },
    })
    if (!h) {
      setPhase('error')
      setError(speechErrorMessage('unsupported') ?? '')
      return
    }
    handle.current = h
    setListening(true)
  }

  async function read() {
    if (phase === 'reading') return
    handle.current?.abort()
    handle.current = null
    setListening(false)
    const said = text.trim()
    if (!said) { setPhase('error'); setError(friendlyError('empty')); return }
    setPhase('reading')
    setError('')
    let r: Awaited<ReturnType<ReturnType<typeof makeProvider>['extractVoice']>>
    try {
      const [cfg, cats, accounts, settings] = await Promise.all([getAi(), getCategories(), getAccounts(), getSettings()])
      const now = new Date()
      const ctx: VoiceContext = {
        accounts,
        expense: cats.expense,
        income: Object.keys(cats.income),
        today: todayISO(now),
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        defaultCurrency: settings.baseCurrency,
      }
      r = await makeProvider(cfg).extractVoice(said, ctx)
    } catch {
      // A thrown DB/network error: a fixed, translated line rather than raw exception text.
      setPhase('error')
      setError(t("Couldn't reach your AI provider — check your connection and try again."))
      return
    }
    if (!alive.current) return
    if (r.ok) onExtracted(r.draft, said)
    else { setPhase('error'); setError(friendlyError(r.error)) }
  }

  return (
    <Modal title={t('Say a transaction')} onClose={onClose}>
      {supported && (
        <button
          type="button"
          className={listening ? 'voice-mic listening' : 'voice-mic'}
          onClick={toggleMic}
          disabled={phase === 'reading'}
          aria-pressed={listening}
          aria-label={listening ? t('Stop listening') : t('Start listening')}
        >
          <span aria-hidden="true">🎤</span>
          <span>{listening ? t('Listening… tap to stop') : t('Tap and speak')}</span>
        </button>
      )}

      <textarea
        className="voice-text"
        rows={3}
        value={text}
        onChange={(e) => {
          // Typing (or keyboard dictation) takes over from the mic: the live
          // transcript is rebuilt from a snapshot, so a speech result arriving
          // after an edit would wipe it. Stop listening instead.
          if (handle.current) { handle.current.abort(); handle.current = null; setListening(false) }
          setText(e.target.value)
        }}
        disabled={phase === 'reading'}
        placeholder={t('e.g. Lunch 120 from Cash yesterday')}
        aria-label={t('What you said')}
      />
      <p className="set-hint" style={{ marginTop: 6 }}>
        {supported
          ? t('Mention the amount, what it was for, and the account. Say the date if it was not today.')
          : t("Voice input isn't available here — type it, or tap 🎤 on your keyboard to dictate.")}
      </p>

      {phase === 'error' && <p className="amt-expense" style={{ marginTop: 8 }} role="alert">{error}</p>}

      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-accent"
          disabled={phase === 'reading' || !text.trim()}
          onClick={() => { void read() }}
        >
          {phase === 'reading' ? t('Reading…') : t('Read it')}
        </button>
      </div>
      <p className="set-hint" style={{ marginTop: 10 }}>
        {t('What you say is sent as text to your AI provider to read it. You check everything before it’s saved.')}
      </p>
      {supported && (
        <p className="set-hint" style={{ marginTop: 6 }}>
          {t('The mic uses your browser’s own speech service (Apple or Google), which may process the audio. Typing the sentence avoids that.')}
        </p>
      )}

    </Modal>
  )
}
