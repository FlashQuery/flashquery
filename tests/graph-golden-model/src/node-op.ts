// Node-analysis operation: build the (editable) prompt, call the model, then run
// the result through the REAL parser/schema imported from src/graph. Mirrors
// analyzeGraphNode() minus the Supabase write.

// Parse with the REAL corrector (parseLlmJson = jsonrepair + zod) and the REAL production node schema.
// The schema deltas (optional reasoning, analyzed_content_hash default '') were pushed to production
// (PORT_BACK §1.4), so the local override is gone and we import src/graph directly again.
import { parseLlmJson } from '../../../src/llm/json-repair.js';
import { GraphNodeAnalysisPayloadSchema, type GraphNodeAnalysisPayload } from '../../../src/graph/schemas.js';
import type { Settings } from './config.ts';
import type { ChatMessage, LlmTransport } from './llm-client.ts';
import { buildNodeMessages, type NodeInput } from './prompts.ts';

export interface ParseInfo {
  ok: boolean;
  /** 'syntax' = unparseable JSON; 'schema' = parsed but failed strict Zod. */
  failure?: 'syntax' | 'schema';
  repaired: boolean;
  summary?: string;
}

export interface NodeOpResult {
  messages: ChatMessage[];
  raw: string;
  model: string;
  mocked: boolean;
  latencyMs: number;
  parse: ParseInfo;
  payload?: GraphNodeAnalysisPayload;
}

export async function runNodeOp(
  input: NodeInput,
  transport: LlmTransport,
  settings: Settings
): Promise<NodeOpResult> {
  const messages = buildNodeMessages(input, settings);
  const completion = await transport.complete(messages);
  const parsed = parseLlmJson(completion.text, GraphNodeAnalysisPayloadSchema);
  const base = {
    messages,
    raw: completion.text,
    model: completion.model,
    mocked: completion.mocked,
    latencyMs: completion.latencyMs,
  };
  if (parsed.ok) {
    return { ...base, parse: { ok: true, repaired: parsed.repaired }, payload: parsed.data };
  }
  return {
    ...base,
    parse: { ok: false, failure: parsed.failure, repaired: parsed.repaired, summary: parsed.summary },
  };
}
