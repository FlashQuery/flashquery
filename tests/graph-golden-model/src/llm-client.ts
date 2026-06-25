// Transport to an OpenAI-compatible chat-completions endpoint (Ollama).
//
// This intentionally mirrors the request shape of the production client
// (OpenAICompatibleLlmClient.chatHttpOnly in src/llm/client.ts): POST to
// `${baseUrl}/chat/completions` with `{ ...params, model, messages }` and an
// optional Bearer token. We keep our own thin copy rather than constructing the
// full production client so the workbench has zero coupling to Supabase / cost
// tracking. The graph *logic* (schemas, vocabulary, validation) is imported
// real; only this network pipe is local.

import type { Settings } from './config.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  latencyMs: number;
  /** true when served by the offline mock rather than a real model. */
  mocked: boolean;
}

export interface LlmTransport {
  complete(messages: ChatMessage[]): Promise<CompletionResult>;
}

class HttpTransport implements LlmTransport {
  constructor(
    private readonly settings: Settings,
    private readonly model: string
  ) {}

  async complete(messages: ChatMessage[]): Promise<CompletionResult> {
    const { baseUrl, apiKey, temperature } = this.settings;
    const model = this.model;
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const start = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          ...(this.settings.reasoningEffort ? { reasoning_effort: this.settings.reasoningEffort } : {}),
          ...this.settings.extraBody,
          model,
          messages,
          temperature,
          stream: false,
        }),
      });
    } catch (err) {
      throw new Error(
        `Could not reach model server at ${url}. Is the host reachable from here? ` +
          `Underlying: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Model server ${url} returned ${response.status}: ${body.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    return { text, model, latencyMs: performance.now() - start, mocked: false };
  }
}

/**
 * Offline transport. Returns canned, schema-valid JSON so the parse/score/report
 * pipeline can be exercised without a model server (npm run selftest). It sniffs
 * node vs. edge from the user message shape, matching how the real ops differ.
 */
class MockTransport implements LlmTransport {
  constructor(private readonly model: string) {}

  async complete(messages: ChatMessage[]): Promise<CompletionResult> {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const isEdge = user.includes('Classified relation types') || user.includes('"edges"');
    const text = isEdge ? mockEdgeResponse(user) : MOCK_NODE_JSON;
    return { text, model: this.model, latencyMs: 0, mocked: true };
  }
}

/**
 * Tiny heuristic so positive and negative edge fixtures both behave under --mock:
 * emit a `contradicts` edge only when the source revokes something the target
 * still recommends; otherwise emit no edges. This is just enough to exercise the
 * scorer/confusion-matrix path offline — it is NOT a model.
 */
function mockEdgeResponse(userText: string): string {
  // Operate on the whole rendered prompt (which embeds the source/target claims).
  const t = userText.toLowerCase();
  const revoked = /\b(removed|deprecat|no longer|discontinued)\b/.test(t);
  const recommended = /\b(recommended|must migrate|entry point)\b/.test(t);
  if (revoked && recommended) return MOCK_EDGE_JSON;
  return JSON.stringify({ edges: [] });
}

const MOCK_NODE_JSON = JSON.stringify({
  key_claims: [
    'The v2 API deprecates the legacy /search endpoint',
    'Migration must complete before the Q3 2026 cutoff',
  ],
  chunk_summary: 'Announces deprecation of the legacy search endpoint with a migration deadline.',
  provenance_basis: 'Internal engineering decision record',
  question_status: 'open',
  question_resolution: null,
  certainty_level: 'high',
  staleness_risk: 'high',
  external_refs: ['RFC-0042'],
  temporal_markers: ['Q3 2026'],
  analyzed_content_hash: 'mockhash',
});

const MOCK_EDGE_JSON = JSON.stringify({
  edges: [
    {
      relation: 'contradicts',
      reasoning: 'Source says the endpoint is removed; target still instructs callers to use it.',
      source_claims_referenced: [0],
      target_claims_referenced: [0],
      confidence_score: 0.8,
      metadata: { llm_assessment: 'strong' },
    },
  ],
});

export function makeTransport(settings: Settings, model: string): LlmTransport {
  return settings.mock ? new MockTransport(model) : new HttpTransport(settings, model);
}
