// Entry point for AI receipt scanning. Callers use makeProvider(cfg) and the
// AiProvider interface; they never import a specific provider directly, so adding
// OpenAI/Gemini later is a new module + a switch arm here.
import type { AiCfg } from '../../data/defaults'
import { createClaudeProvider } from './claude'
import type { AiProvider } from './types'

export type { AiProvider, ExtractContext, ExtractResult, ReceiptDraft, ReceiptImage, TestResult } from './types'

export function makeProvider(cfg: AiCfg): AiProvider {
  switch (cfg.provider) {
    case 'claude':
      return createClaudeProvider(cfg)
    // 'openai' / 'gemini' can't be reached from the browser without a proxy and
    // aren't selectable in Settings yet; fall back to Claude defensively.
    default:
      return createClaudeProvider(cfg)
  }
}
