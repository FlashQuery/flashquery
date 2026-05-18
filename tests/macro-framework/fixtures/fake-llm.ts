// Fake LLM — canned responses for tests not opting into a real LLM via
// `deps: [llm]`.
//
// Justification (INV-MTF-06 (b) non-determinism): real LLM outputs vary
// across runs; tests assert on exact outputs.
//
// Simplest form for Phase 2: a map of prompt-hash -> response, with a
// default fallback. The macro engine's `fq.call_model` handler can be
// injected with a delegate that consults this fake.

import { createHash } from 'node:crypto';

export interface FakeLlmResponse {
  text: string;
  /** Cost / token accounting hints for downstream assertions. */
  tokens?: number;
  model?: string;
}

export interface FakeLlmConfig {
  /** Prompt string (verbatim) -> canned response. */
  byPrompt?: Record<string, FakeLlmResponse>;
  /** Prompt-hash (sha256 hex) -> canned response. Higher priority key. */
  byHash?: Record<string, FakeLlmResponse>;
  /** Returned when no map entry matches. */
  default?: FakeLlmResponse;
}

export class FakeLlm {
  public readonly callLog: Array<{ prompt: string; response: FakeLlmResponse }> = [];

  constructor(private readonly config: FakeLlmConfig = {}) {}

  call(prompt: string): FakeLlmResponse {
    const hash = createHash('sha256').update(prompt).digest('hex');
    const r =
      this.config.byHash?.[hash] ??
      this.config.byPrompt?.[prompt] ??
      this.config.default ??
      { text: '' };
    this.callLog.push({ prompt, response: r });
    return r;
  }

  reset(): void {
    this.callLog.length = 0;
  }
}
