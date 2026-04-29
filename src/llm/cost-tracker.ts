/**
 * LLM cost tracking — fire-and-forget Supabase writes with SIGTERM drain.
 *
 * Phase 102 architectural home for cost recording. Replaces the synchronous
 * llm_usage insert from Phase 101's src/mcp/tools/llm.ts (D-06). All future
 * internal LLM callers (Projections, Auto-Tags, plugins, embedding migration)
 * get cost tracking automatically by going through src/llm/client.ts.
 *
 * Locked design decisions (CONTEXT.md):
 * - D-01: LlmUsageRecord interface; recordLlmUsage inserts via supabaseManager
 * - D-02: computeCost lives here (relocated from src/mcp/tools/llm.ts)
 * - D-07: purposeName='_direct' is supplied by the call site (complete()), not synthesized here
 * - D-08: All errors caught internally with WARN log; never throws; never propagates
 * - D-09: Module-level Set<Promise<void>> tracks in-flight writes for drain
 */

import { logger } from '../logging/logger.js';
import { supabaseManager } from '../storage/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// LlmUsageRecord — D-01
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmUsageRecord {
  instanceId: string;
  purposeName: string;       // "_direct" for model-resolved calls (D-07)
  modelName: string;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  fallbackPosition: number | null;  // 1-indexed; null for direct calls and resolver wave-1
  traceId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeCost — relocated from src/mcp/tools/llm.ts (D-02)
// Formula: (inputTokens * cpm.input + outputTokens * cpm.output) / 1_000_000
// Returns 0 when both rates are 0 (free/local models — MOD-02).
// ─────────────────────────────────────────────────────────────────────────────

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  costPerMillion: { input: number; output: number }
): number {
  return (inputTokens * costPerMillion.input + outputTokens * costPerMillion.output) / 1_000_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-flight write tracking — D-09
// Module-level Set; entries added on fire, deleted on settle.
// ─────────────────────────────────────────────────────────────────────────────

const _pendingWrites = new Set<Promise<void>>();

/**
 * Fire-and-forget Supabase insert into the LLM usage tracking table.
 *
 * Returns void (NOT Promise<void>) so callers cannot accidentally `await` and
 * block the LLM response on Supabase latency. The internal Promise is tracked
 * in _pendingWrites and drained on SIGTERM via drainCostWrites().
 *
 * All errors are caught internally (D-08) — this function NEVER throws.
 */
export function recordLlmUsage(record: LlmUsageRecord): void {
  const p = (async () => {
    const supabase = supabaseManager.getClient();
    const { error } = await supabase.from('fqc_llm_usage').insert({
      instance_id: record.instanceId,
      purpose_name: record.purposeName,
      model_name: record.modelName,
      provider_name: record.providerName,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cost_usd: record.costUsd,
      latency_ms: record.latencyMs,
      fallback_position: record.fallbackPosition,
      trace_id: record.traceId,
    });
    if (error) {
      throw new Error((error as { message?: string }).message ?? String(error));
    }
  })().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Cost tracking failed: ${message}`);
  });
  _pendingWrites.add(p);
  void p.finally(() => {
    _pendingWrites.delete(p);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// drainCostWrites — D-09 / D-10
// Resolve when all currently in-flight writes settle, or after timeoutMs,
// whichever comes first. Does not cancel in-flight writes.
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function drainCostWrites(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Loop until all in-flight writes settle or deadline is reached.
  // Re-snapshotting on each iteration ensures writes added after the initial
  // snapshot (e.g. by an in-flight handler that fires after the first pass) are
  // also observed before the process exits.
  while (_pendingWrites.size > 0 && Date.now() < deadline) {
    await Promise.race([
      Promise.allSettled([..._pendingWrites]),
      sleep(Math.min(200, deadline - Date.now())),
    ]);
  }
}
