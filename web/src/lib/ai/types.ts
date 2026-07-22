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

export interface AiProvider {
  testConnection(): Promise<TestResult>
  extractReceipt(image: ReceiptImage, ctx: ExtractContext): Promise<ExtractResult>
}
