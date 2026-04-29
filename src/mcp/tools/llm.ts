/**
 * call_model MCP tool — Phase 101.
 *
 * Registers `call_model` unconditionally so the tool always appears in the
 * MCP tool listing (TOOL-03). When `llm:` is not configured, the handler
 * returns a clean isError response via the `instanceof NullLlmClient` guard
 * (D-04). When configured, the handler dispatches to either
 * `llmClient.complete()` or `llmClient.completeByPurpose()` per `params.resolver`,
 * computes `cost_usd` from `config.llm.models[].costPerMillion`, writes one row
 * to `fqc_llm_usage` synchronously (D-01 — Phase 102 refactors to fire-and-forget),
 * and (when `trace_id` is provided) computes `trace_cumulative` by re-querying
 * the table for all rows with that trace_id (D-02 — insert FIRST so the current
 * call is counted in the totals).
 *
 * Error response variants (D-03):
 *   1. Unconfigured (NullLlmClient guard) — fixed string per requirement.
 *   2. Unknown model/purpose name — formatted with available names list.
 *   3. Chain exhausted (LlmFallbackError) — multi-line with indented attempt detail.
 *
 * Phase 102 will refactor:
 *   - Fire-and-forget DB write with SIGTERM drain (COST-03/04)
 *   - `_direct` sentinel for resolver === 'model' (COST-02)
 *   - Write-failure isolation
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';
import { llmClient, NullLlmClient, type ChatMessage, type LlmCompletionResult } from '../../llm/client.js';
import { LlmFallbackError } from '../../llm/resolver.js';

// ─────────────────────────────────────────────────────────────────────────────
// computeCost — exported for unit testing (U-29).
// Formula: (inputTokens * costPerMillion.input + outputTokens * costPerMillion.output) / 1_000_000
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
// Internal types — handler-local response envelope shape.
// ─────────────────────────────────────────────────────────────────────────────

interface TraceCumulative {
  total_calls: number;
  total_tokens: { input: number; output: number };
  total_cost_usd: number;
  total_latency_ms: number;
}

interface CallModelMetadata {
  resolver: 'model' | 'purpose';
  name: string;
  resolved_model_name: string;
  provider_name: string;
  fallback_position: number | null;
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
  trace_id?: string;
  trace_cumulative?: TraceCumulative;
}

interface CallModelEnvelope {
  response: string;
  metadata: CallModelMetadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// registerLlmTools — registers `call_model` unconditionally (TOOL-03).
// The MCP SDK does not allow tools to be added after `server.connect()` (issue #893),
// so registration must happen even when `config.llm` is undefined. The
// `instanceof NullLlmClient` guard inside the handler signals unconfigured state.
// ─────────────────────────────────────────────────────────────────────────────

export function registerLlmTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'call_model',
    {
      description:
        "Call any configured LLM model directly (resolver='model') or via a named purpose with fallback chain (resolver='purpose'). " +
        "Returns the model's text response plus a diagnostic envelope with provider, token usage, computed cost (USD), and latency. " +
        "When trace_id is provided, the call is recorded with that ID and the response includes cumulative stats across all calls sharing that trace_id. " +
        "Note: messages are forwarded to the provider as-is — prompt safety is the caller's responsibility.",
      inputSchema: {
        resolver: z.enum(['model', 'purpose']).describe(
          "'model' to call a specific model alias directly; 'purpose' to walk a named purpose's fallback chain."
        ),
        name: z.string().describe('Model alias (when resolver=model) or purpose name (when resolver=purpose).'),
        messages: z
          .array(
            z.object({
              role: z.enum(['system', 'user', 'assistant', 'tool']),
              content: z.string(),
            })
          )
          .min(1)
          .describe('OpenAI-style messages array (must contain at least one message).'),
        parameters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional LLM parameters (temperature, max_tokens, etc.) — passed through to the provider.'),
        trace_id: z
          .string()
          .optional()
          .describe('Optional trace correlation ID. Recorded in fqc_llm_usage and echoed in response with cumulative stats.'),
      },
    },
    async (params) => {
      // Step 0: Shutdown guard — must be first (consistent with all other tools)
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed.' }],
          isError: true,
        };
      }

      // Step 1: Unconfigured guard (D-04, TOOL-03 / U-30 / L-13)
      // Access llmClient inside handler body, never at module level (Pitfall 1).
      const client = llmClient;
      if (!client || client instanceof NullLlmClient) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'LLM is not configured. Add an llm: section to flashquery.yml to use this tool.',
            },
          ],
          isError: true,
        };
      }

      // Step 2: Dispatch by resolver
      let result: LlmCompletionResult;
      let fallbackPosition: number | null;

      try {
        if (params.resolver === 'model') {
          result = await client.complete(params.name, params.messages as ChatMessage[], params.parameters);
          fallbackPosition = null; // explicit null per TOOL-02 / Pitfall 2
        } else {
          const purposeResult = await client.completeByPurpose(
            params.name,
            params.messages as ChatMessage[],
            params.parameters
          );
          result = purposeResult;
          fallbackPosition = purposeResult.fallbackPosition; // 1-indexed (Phase 100 D-06)
        }
      } catch (err: unknown) {
        // D-03 variant 3: chain exhausted
        if (err instanceof LlmFallbackError) {
          const attemptLines = err.attempts
            .map(
              (a, i) =>
                `  [${i + 1}] ${a.modelName} (${a.providerName}): ${a.error instanceof Error ? a.error.message : String(a.error)}`
            )
            .join('\n');
          const text = `call_model failed: purpose '${err.purposeName}' — all ${err.attempts.length} models exhausted\n${attemptLines}`;
          logger.error(`call_model failed (chain exhausted): purpose=${err.purposeName}, attempts=${err.attempts.length}`);
          return {
            content: [{ type: 'text' as const, text }],
            isError: true,
          };
        }

        // D-03 variant 2: unknown model/purpose name (plain Error from complete()/completeByPurpose())
        const llmConf = config.llm;
        const availableNames =
          params.resolver === 'model'
            ? llmConf?.models.map((m) => m.name).join(', ') ?? 'none'
            : llmConf?.purposes.map((p) => p.name).join(', ') ?? 'none';
        const kind = params.resolver === 'model' ? 'Model' : 'Purpose';
        const kindPlural = params.resolver === 'model' ? 'models' : 'purposes';
        const text = `${kind} '${params.name}' not found. Available ${kindPlural}: ${availableNames}`;
        logger.error(`call_model failed (${params.resolver} not found): ${params.name}`);
        return {
          content: [{ type: 'text' as const, text }],
          isError: true,
        };
      }

      // Step 3: Compute cost from config
      // result.modelName is the resolved alias (lowercased per Phase 99 D-08)
      const modelConfig = config.llm?.models.find((m) => m.name === result.modelName);
      const costUsd = modelConfig
        ? computeCost(result.inputTokens, result.outputTokens, modelConfig.costPerMillion)
        : 0;

      // Step 4: Synchronous fqc_llm_usage insert (D-01 — Phase 102 refactors to fire-and-forget)
      // Phase 101 writes params.name as purpose_name for both resolvers; Phase 102 introduces _direct sentinel.
      const supabase = supabaseManager.getClient();
      await supabase.from('fqc_llm_usage').insert({
        instance_id: config.instance.id,
        purpose_name: params.name,
        model_name: result.modelName,
        provider_name: result.providerName,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: costUsd,
        latency_ms: result.latencyMs,
        fallback_position: fallbackPosition,
        trace_id: params.trace_id ?? null,
      });

      // Step 5: trace_cumulative (TOOL-05 / D-02) — query AFTER insert so current row is counted
      let traceCumulative: TraceCumulative | undefined;
      if (params.trace_id) {
        const { data: traceRows } = await supabase
          .from('fqc_llm_usage')
          .select('input_tokens, output_tokens, cost_usd, latency_ms')
          .eq('instance_id', config.instance.id)
          .eq('trace_id', params.trace_id);

        const rows = traceRows ?? [];

        // If the select did not return the just-inserted row (mock or eventual-consistency case),
        // additively include the current call's data so total_calls >= 1 (D-02 correctness).
        const selectIncludesCurrent =
          rows.some(
            (r) =>
              Number(r.latency_ms) === result.latencyMs &&
              Number(r.input_tokens) === result.inputTokens &&
              Number(r.output_tokens) === result.outputTokens
          );

        const currentCallContribution = selectIncludesCurrent ? 0 : 1;
        const currentTokensIn = selectIncludesCurrent ? 0 : result.inputTokens;
        const currentTokensOut = selectIncludesCurrent ? 0 : result.outputTokens;
        const currentCost = selectIncludesCurrent ? 0 : costUsd;
        const currentLatency = selectIncludesCurrent ? 0 : result.latencyMs;

        traceCumulative = {
          total_calls: rows.length + currentCallContribution,
          total_tokens: {
            input: rows.reduce((s, r) => s + Number(r.input_tokens ?? 0), 0) + currentTokensIn,
            output: rows.reduce((s, r) => s + Number(r.output_tokens ?? 0), 0) + currentTokensOut,
          },
          total_cost_usd: rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) + currentCost,
          total_latency_ms: rows.reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) + currentLatency,
        };
      }

      // Step 6: Build response envelope (TOOL-02 / D-02 conditional fields)
      const metadata: CallModelMetadata = {
        resolver: params.resolver,
        name: params.name,
        resolved_model_name: result.modelName,
        provider_name: result.providerName,
        fallback_position: fallbackPosition,
        tokens: { input: result.inputTokens, output: result.outputTokens },
        cost_usd: costUsd,
        latency_ms: result.latencyMs,
      };

      // D-02: Only add trace fields when trace_id was provided — do NOT set to undefined
      // (setting to undefined still leaves the key present in the object; we need key absent)
      if (params.trace_id) {
        metadata.trace_id = params.trace_id;
        metadata.trace_cumulative = traceCumulative;
      }

      const envelope: CallModelEnvelope = {
        response: result.text,
        metadata,
      };

      logger.info(
        `call_model: ${params.resolver}/${params.name} -> ${result.modelName}@${result.providerName} (${result.inputTokens}+${result.outputTokens} tokens, ${result.latencyMs}ms, $${costUsd.toFixed(8)})`
      );

      // Note: success returns omit `isError` entirely (not false) — matches files.ts pattern.
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      };
    }
  );
}
