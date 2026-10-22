// Provider-agnostic contracts for AI receipt scanning. Today only the Claude
// provider (claude.ts) implements these; the factory in index.ts selects one from
// the stored AiCfg, so adding OpenAI/Gemini later (behind a proxy) is a new file
// plus a switch arm — no call-site changes.

// A single receipt read off an image. Fields are nullable/optional because a
// receipt may be partial or unreadable; the review step (P7) lets the user fix
// anything before it's saved.
export interface ReceiptDraft {
  amount: number | null // grand total, plain number
  date: string | null // YYYY-MM-DD
  merchant?: string // vendor name → becomes the transaction note
  category?: string // best match from the app's expense categories
  currency?: string // ISO-ish code, e.g. THB
  confidence?: number // 0..1 overall confidence
}

export type ExtractResult = { ok: true; draft: ReceiptDraft } | { ok: false; error: string }
export type TestResult = { ok: true } | { ok: false; error: string }

// An image to read: base64 payload (no `data:` prefix) + its MIME type.
export interface ReceiptImage {
  base64: string
  mime: string
}

// Context that steers extraction toward the user's own data.
export interface ExtractContext {
  categories: string[] // expense category names the model should choose from
  defaultCurrency: string // fallback when the receipt shows no currency
  today: string // YYYY-MM-DD, for resolving a missing year
}

// ── Voice entry ──────────────────────────────────────────────────────────────
// A spoken (or dictated) sentence turned into a transaction draft. Everything is
// validated against the user's own accounts/categories before it gets here, so a
// name in the draft is always one that really exists; anything the model made up
// is dropped and left for the user to pick on the review form.
export type VoiceKind = 'Expense' | 'Income' | 'Transfer'

export interface VoiceDraft {
  kind: VoiceKind
  amount: number | null
  date: string // YYYY-MM-DD, local — today when the speaker didn't say
  account?: string // the account paid from / received into; for a Transfer, the source
  toAccount?: string // Transfer destination
  category?: string
  subcategory?: string // only ever an expense sub-category of `category`
  note?: string
}

export interface VoiceContext {
  accounts: string[]
  expense: Record<string, string[]> // expense category → its sub-categories
  income: string[] // income category names
  today: string // YYYY-MM-DD, the user's LOCAL date
  weekday: string // e.g. "Thursday", so "last Friday" can be resolved
  defaultCurrency: string
}

export type VoiceResult = { ok: true; draft: VoiceDraft } | { ok: false; error: string }

export interface AiProvider {
  testConnection(): Promise<TestResult>
  extractReceipt(image: ReceiptImage, ctx: ExtractContext): Promise<ExtractResult>
  extractVoice(text: string, ctx: VoiceContext): Promise<VoiceResult>
}
