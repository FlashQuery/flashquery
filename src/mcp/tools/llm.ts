/**
 * call_model MCP tool — Phase 101 (refactored in Phase 102).
 *
 * Registers `call_model` unconditionally so the tool always appears in the
 * MCP tool listing (TOOL-03). When `llm:` is not configured, the handler
 * returns a clean isError response via the `instanceof NullLlmClient` guard
 * (D-04). When configured, the handler dispatches to either
 * `llmClient.complete()` or `llmClient.completeByPurpose()` per `params.resolver`.
 * Cost recording is now fire-and-forget in client.ts (D-03/D-06).
 * trace_cumulative uses query-then-add-in-memory pattern (D-11).
 *
 * Error response variants (D-03):
 *   1. Unconfigured (NullLlmClient guard) — fixed string per requirement.
 *   2. Unknown model/purpose name — formatted with available names list.
 *   3. Chain exhausted (LlmFallbackError) — multi-line with indented attempt detail.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';
import { llmClient, NullLlmClient, LlmHttpError, LlmNetworkError, type LlmCompletionResult } from '../../llm/client.js';
import { LlmFallbackError } from '../../llm/resolver.js';
import { computeCost } from '../../llm/cost-tracker.js';

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
        "When trace_id is omitted, the trace_id and trace_cumulative fields are absent from the metadata object entirely — the keys are not present, not null. " +
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
          .describe('Optional trace correlation ID. Recorded in the LLM usage table and echoed in response with cumulative stats.'),
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
          result = await client.complete(
            params.name,
            params.messages,
            params.parameters,
            params.trace_id ?? null
          );
          fallbackPosition = null; // explicit null per TOOL-02 / Pitfall 2
        } else {
          const purposeResult = await client.completeByPurpose(
            params.name,
            params.messages,
            params.parameters,
            params.trace_id ?? null
          );
          result = purposeResult;
          fallbackPosition = purposeResult.fallbackPosition; // 1-indexed (Phase 100 D-06)
        }
      } catch (err: unknown) {
        // D-03 variant 3: chain exhausted (purpose path only)
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

        // WR-01 fix: typed HTTP/network errors (401, 429, 5xx, timeout, etc.) propagate
        // verbatim so callers see the real provider error — NOT a misleading
        // "Model not found" message. Applies to both resolver=model and resolver=purpose
        // paths (purpose path only sees these on a single-model purpose where the
        // first attempt fails permanently — no fallback sibling to wrap into LlmFallbackError).
        if (err instanceof LlmHttpError || err instanceof LlmNetworkError) {
          const text = `call_model failed: ${err.message}`;
          logger.error(
            `call_model failed (${err instanceof LlmHttpError ? `http ${err.status}` : 'network'}): ${params.resolver}/${params.name} — ${err.message}`
          );
          return {
            content: [{ type: 'text' as const, text }],
            isError: true,
          };
        }

        // D-03 variant 2: unknown model/purpose name (plain Error from
        // complete()/completeByPurpose() — message starts with
        // "LLM error: Model '...' not found in configuration." per client.ts:216,
        // or matches the Phase 100 resolver's "Purpose '...' not found" pattern).
        if (err instanceof Error && /not found(?: in configuration)?\.?$/.test(err.message)) {
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

        // Anything else (unexpected, non-typed error): surface the message rather
        // than masking it.
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`call_model failed (unexpected): ${params.resolver}/${params.name} — ${message}`);
        return {
          content: [{ type: 'text' as const, text: `call_model failed: ${message}` }],
          isError: true,
        };
      }

      // Step 3: Compute cost from config
      // result.modelName is the resolved alias (lowercased per Phase 99 D-08)
      const modelConfig = config.llm?.models.find((m) => m.name === result.modelName);
      const costUsd = modelConfig
        ? computeCost(result.inputTokens, result.outputTokens, modelConfig.costPerMillion)
        : 0;

      // Step 4: trace_cumulative (TOOL-05) — D-11 query-then-add-in-memory pattern.
      // The fire-and-forget recordLlmUsage in client.ts may not have committed yet,
      // so query existing rows and ALWAYS add the current call's data in-memory.
      let traceCumulative: TraceCumulative | undefined;
      if (params.trace_id) {
        let supabase: ReturnType<typeof supabaseManager.getClient> | null = null;
        try {
          supabase = supabaseManager.getClient();
        } catch {
          // Supabase not configured — trace_cumulative silently omitted
        }
        if (supabase) {
          try {
            const { data: traceRows } = await supabase
              .from('fqc_llm_usage')
              .select('input_tokens, output_tokens, cost_usd, latency_ms')
              .eq('instance_id', config.instance.id)
              .eq('trace_id', params.trace_id);

            const rows = traceRows ?? [];
            traceCumulative = {
              total_calls: rows.length + 1,
              total_tokens: {
                input:
                  rows.reduce((s, r) => s + Number(r.input_tokens ?? 0), 0) + result.inputTokens,
                output:
                  rows.reduce((s, r) => s + Number(r.output_tokens ?? 0), 0) + result.outputTokens,
              },
              total_cost_usd:
                rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) + costUsd,
              total_latency_ms:
                rows.reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) + result.latencyMs,
            };
          } catch (err: unknown) {
            logger.warn(
              `trace_cumulative query failed; omitting from envelope: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      // Step 5: Build response envelope (TOOL-02 / D-02 conditional fields)
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
