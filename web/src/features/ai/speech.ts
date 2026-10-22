// A thin wrapper over the browser's speech recognition. It exists so the rest of
// the app never touches the vendor-prefixed API, and so a missing or flaky
// implementation (iOS home-screen apps are the usual culprit) is a normal,
// handled state rather than an exception: callers check isSpeechSupported() and
// fall back to typing / the keyboard's own dictation.
import { t } from '../../i18n'

interface RecResult { isFinal: boolean; 0: { transcript: string } }
interface RecEvent { resultIndex: number; results: ArrayLike<RecResult> }
interface Rec {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: RecEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecCtor = new () => Rec

function ctor(): RecCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const isSpeechSupported = (): boolean => !!ctor()

export interface SpeechHandle {
  /** Stop listening but let the last words through. */
  stop(): void
  /** Stop now and drop everything; no further callbacks fire. */
  abort(): void
}

export function speechLang(appLang: string): string {
  return appLang === 'th' ? 'th-TH' : 'en-US'
}

// Friendly line for a recognition error code (see the Web Speech API's
// SpeechRecognitionErrorEvent). `aborted` is us stopping it — not an error.
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case 'aborted': return null
    case 'no-speech': return t("Didn't catch anything — tap the mic and try again.")
    case 'not-allowed':
    case 'service-not-allowed':
      return t('Microphone access is blocked. Allow it in your browser settings, or type / dictate with your keyboard instead.')
    case 'audio-capture': return t('No microphone found.')
    case 'network': return t('Speech recognition needs a connection. You can type it instead.')
    default: return t("Voice input isn't working here — type it, or use your keyboard's microphone.")
  }
}

// Start listening. `onText` gets the finished phrases so far and the in-progress
// one separately, so the caller can show both without double-counting. Returns
// null when speech recognition isn't available or refuses to start.
export function startListening(opts: {
  lang: string
  onText: (finalText: string, interim: string) => void
  onError: (code: string) => void
  onEnd: () => void
}): SpeechHandle | null {
  const C = ctor()
  if (!C) return null
  let rec: Rec
  try {
    rec = new C()
  } catch {
    return null
  }
  let live = true
  rec.lang = opts.lang
  rec.interimResults = true
  rec.continuous = false
  rec.onresult = (e) => {
    if (!live) return
    let fin = ''
    let interim = ''
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) fin += r[0].transcript
      else interim += r[0].transcript
    }
    opts.onText(fin, interim)
  }
  rec.onerror = (e) => { if (live) opts.onError(e.error) }
  rec.onend = () => { if (live) opts.onEnd() }
  try {
    rec.start()
  } catch {
    return null
  }
  return {
    stop: () => { try { rec.stop() } catch { /* already stopped */ } },
    abort: () => {
      live = false
      try { rec.abort() } catch { /* already stopped */ }
    },
  }
}
