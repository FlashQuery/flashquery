/**
 * call_model MCP tool — Phase 101 (refactored in Phase 102).
 *
 * Registers `call_model` unconditionally so the tool always appears in the
 * MCP tool listing (TOOL-03). When `llm:` is not configured, the handler
 * returns a clean isError response via the `instanceof NullLlmClient` guard
 * (D-04). When configured, the handler dispatches to either
 * `llmClient.complete()` or `llmClient.completeByPurpose()` per `params.resolver`.
 * Cost recording is now fire-and-forget in client.ts (D-03/D-06).
 * trace_cumulative uses pre-snapshot pattern (D-11): existing rows are queried
 * BEFORE the LLM call so the current call's fire-and-forget row cannot appear
 * in the snapshot, eliminating the double-count race.
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
import { embeddingProvider } from '../../embedding/provider.js';
import {
  parseReferences,
  resolveReferences,
  hydrateMessages,
  buildInjectedReferences,
  computePromptChars,
  type InjectionMetadata,
  type FailedRef,
  type ResolvedRef,
} from '../../llm/reference-resolver.js';

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
  injected_references?: Array<{ ref: string; chars: number; resolved_to?: string }>;
  prompt_chars?: number;
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
        "Discovery resolvers (resolver='list_models'/'list_purposes'/'search') return configuration data with no LLM call — name and messages are not required for these. " +
        "For 'search', supply parameters.query as the search string (case-insensitive substring match on name and description). " +
        "Returns the model's text response plus a diagnostic envelope with provider, token usage, computed cost (USD), and latency. " +
        "When trace_id is provided, the call is recorded with that ID and the response includes cumulative stats across all calls sharing that trace_id. " +
        "When trace_id is omitted, the trace_id and trace_cumulative fields are absent from the metadata object entirely — the keys are not present, not null. " +
        "Note: messages are forwarded to the provider as-is — prompt safety is the caller's responsibility.",
      inputSchema: {
        resolver: z.enum(['model', 'purpose', 'list_models', 'list_purposes', 'search']).describe(
          "'model' to call a specific model alias directly; 'purpose' to walk a named purpose's fallback chain. " +
          "'list_models' / 'list_purposes' / 'search' return configuration data without making an LLM call (no messages required)."
        ),
        name: z.string().optional().describe(
          'Model alias (when resolver=model) or purpose name (when resolver=purpose). ' +
          'Ignored for discovery resolvers (list_models/list_purposes/search).'
        ),
        messages: z
          .array(
            z.object({
              role: z.enum(['system', 'user', 'assistant', 'tool']),
              content: z.string(),
            })
          )
          .optional()
          .describe('OpenAI-style messages array. Required for resolver=model/purpose. Ignored for discovery resolvers.'),
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

      // Step 1.1: Discovery resolver dispatch (DISC-01, DISC-02, DISC-03, DISC-05)
      // Must run BEFORE Step 1.5 (reference resolution) — discovery has no messages
      // and parseReferences(undefined) would crash. These resolvers read config only,
      // make no LLM call, and return JSON directly (NOT CallModelEnvelope).
      // DISC-06: missing llm: → already returned by Step 1 NullLlmClient guard above.
      // configured-but-empty → these branches naturally return empty arrays.
      if (
        params.resolver === 'list_models' ||
        params.resolver === 'list_purposes' ||
        params.resolver === 'search'
      ) {
        const llmConf = config.llm;
        const cfgModels = llmConf?.models ?? [];
        const cfgPurposes = llmConf?.purposes ?? [];

        // Build a provider lookup map ONCE so modelToResponse can derive the `local` flag
        // (Verification Correction 3 — Option A: auto-derive). Map key = provider name.
        const providersByName = new Map((llmConf?.providers ?? []).map((p) => [p.name, p]));

        // Project a model config entry to the discovery response shape.
        // Field mapping: providerName -> provider, model -> model_id, costPerMillion.* -> input/output_cost_per_million.
        // Optional fields use !== undefined (NOT truthiness) so capabilities: [] is preserved.
        // `local` is auto-derived: explicit provider.local: true overrides; otherwise type === 'ollama'
        // implies local: true; non-Ollama providers without explicit declaration OMIT the key.
        const modelToResponse = (m: typeof cfgModels[number]): Record<string, unknown> => {
          const entry: Record<string, unknown> = {
            name: m.name,
            type: m.type,
            provider: m.providerName,
            model_id: m.model,
            input_cost_per_million: m.costPerMillion.input,
            output_cost_per_million: m.costPerMillion.output,
          };
          if (m.description !== undefined) entry['description'] = m.description;
          if (m.contextWindow !== undefined) entry['context_window'] = m.contextWindow;
          if (m.capabilities !== undefined) entry['capabilities'] = m.capabilities;
          // Auto-derive `local` per spec §8.3 example + dev plan §6.4.1.
          const prov = providersByName.get(m.providerName);
          if (prov?.local === true) {
            entry['local'] = true;
          } else if (prov?.type === 'ollama') {
            entry['local'] = true;
          }
          return entry;
        };

        // Build a name->model lookup once for purpose primary-model cost lookup.
        const modelsByName = new Map<string, typeof cfgModels[number]>();
        for (const m of cfgModels) modelsByName.set(m.name, m);

        // Project a purpose config entry to the discovery response shape.
        // Cost rates come from the primary model (models[0]); 0/0 if missing or empty list.
        const purposeToResponse = (p: typeof cfgPurposes[number]): Record<string, unknown> => {
          const primaryName = p.models[0];
          const primary = primaryName ? modelsByName.get(primaryName) : undefined;
          const entry: Record<string, unknown> = {
            name: p.name,
            description: p.description,
            models: p.models,
            input_cost_per_million: primary?.costPerMillion.input ?? 0,
            output_cost_per_million: primary?.costPerMillion.output ?? 0,
          };
          if (p.defaults !== undefined) entry['defaults'] = p.defaults;
          return entry;
        };

        if (params.resolver === 'list_models') {
          const models = cfgModels.map(modelToResponse);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ models }) }] };
        }

        if (params.resolver === 'list_purposes') {
          const purposes = cfgPurposes.map(purposeToResponse);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ purposes }) }] };
        }

        // params.resolver === 'search'
        const queryRaw = params.parameters?.['query'];
        if (typeof queryRaw !== 'string' || queryRaw === '') {
          return {
            content: [{ type: 'text' as const, text: 'search requires parameters.query (non-empty string)' }],
            isError: true,
          };
        }
        const q = queryRaw.toLowerCase();
        const matchedModels = cfgModels
          .filter((m) =>
            m.name.toLowerCase().includes(q) ||
            (m.description ?? '').toLowerCase().includes(q)
          )
          .map(modelToResponse);
        const matchedPurposes = cfgPurposes
          .filter((p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q)
          )
          .map(purposeToResponse);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                query: queryRaw,
                results: { purposes: matchedPurposes, models: matchedModels },
              }),
            },
          ],
        };
      }

      // Step 1.2: Body-level guard for model/purpose resolvers (DISC-04)
      // After making name/messages optional in the schema, we must enforce their
      // presence here for the LLM-dispatch path. Reference resolution (Step 1.5)
      // and Step 2 dispatch both assume messages is a non-empty array.
      if (params.resolver === 'model' || params.resolver === 'purpose') {
        if (typeof params.name !== 'string' || params.name.length === 0) {
          return {
            content: [{ type: 'text' as const, text: "name is required for resolver='model' or resolver='purpose'" }],
            isError: true,
          };
        }
        if (!params.messages || params.messages.length === 0) {
          return {
            content: [{ type: 'text' as const, text: "messages is required (non-empty array) for resolver='model' or resolver='purpose'" }],
            isError: true,
          };
        }
      }
      // After Step 1.2, we know name and resolver are defined for model/purpose paths.
      // TypeScript's control flow analysis cannot narrow across the guard block, so we
      // alias here for the LLM-dispatch path. Discovery paths already returned above.
      const resolvedName = params.name ?? '';
      // WR-06: TypeScript narrows params.resolver to 'model' | 'purpose' here via
      // control-flow analysis after Step 1.1's exhaustive early returns for all
      // discovery resolver values. No cast needed.
      const resolvedResolver = params.resolver;

      // Step 1.5: Reference resolution (REFS-01 through REFS-07)
      // Scans message content for {{ref:...}} and {{id:...}} placeholders, resolves each
      // via resolveAndBuildDocument (reused from get_document), and replaces inline before
      // dispatching to the LLM. Fail-fast: if any reference fails, no LLM call is made.
      // No-op when no patterns present (REFS-07 backward compat).
      // Type narrowing: Step 1.2 guarantees messages is defined for model/purpose path.
      const messagesForRefs = params.messages ?? [];
      const parsed = parseReferences(messagesForRefs);
      if ('error' in parsed) {
        // REFS-02: # and -> mutually exclusive — parse error → immediate fail (no LLM call)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'reference_resolution_failed',
            failed_references: [{ ref: parsed.ref, reason: parsed.reason }],
          }) }],
          isError: true,
        };
      }
      let hydratedMessages: typeof messagesForRefs = messagesForRefs;
      let injectionMetadata: InjectionMetadata | undefined;
      if (parsed.length > 0) {
        const resolved = await resolveReferences(parsed, config, supabaseManager, embeddingProvider, logger);
        const failures = resolved.filter((r): r is FailedRef => r.kind === 'failed');
        if (failures.length > 0) {
          // REFS-06: any failure → return reference_resolution_failed; NO LLM call made
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'reference_resolution_failed',
              failed_references: failures.map((f) => ({ ref: f.ref, reason: f.reason })),
            }) }],
            isError: true,
          };
        }
        const resolvedRefs = resolved as ResolvedRef[];
        hydratedMessages = hydrateMessages(messagesForRefs, resolvedRefs) as typeof messagesForRefs;
        injectionMetadata = {
          injectedReferences: buildInjectedReferences(resolvedRefs),
          promptChars: computePromptChars(hydratedMessages),
        };
      }

      // Step 1b: trace pre-snapshot (D-11 fix) — query existing trace rows BEFORE
      // dispatching to the LLM. This ensures the current call's fire-and-forget
      // recordLlmUsage row (written by client.ts after the HTTP call returns) cannot
      // appear in this snapshot. Querying after the LLM call races with the
      // fire-and-forget insert and causes double-counting (total_calls=3 after 2 calls).
      // The pre-snapshot is null when trace_id is absent or Supabase is unavailable.
      type TraceRow = { input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; latency_ms: number | null };
      let tracePreSnapshot: TraceRow[] | null = null;
      if (params.trace_id) {
        let supabase: ReturnType<typeof supabaseManager.getClient> | null = null;
        try {
          supabase = supabaseManager.getClient();
        } catch {
          logger.warn('trace pre-snapshot skipped: Supabase not configured; trace_cumulative will be omitted');
        }
        if (supabase) {
          try {
            const { data } = await supabase
              .from('fqc_llm_usage')
              .select('input_tokens, output_tokens, cost_usd, latency_ms')
              .eq('instance_id', config.instance.id)
              .eq('trace_id', params.trace_id);
            tracePreSnapshot = data ?? [];
          } catch (err: unknown) {
            logger.warn(
              `trace pre-snapshot query failed; trace_cumulative will be omitted: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      // Step 2: Dispatch by resolver
      let result: LlmCompletionResult;
      let fallbackPosition: number | null;

      try {
        if (resolvedResolver === 'model') {
          result = await client.complete(
            resolvedName,
            hydratedMessages,
            params.parameters,
            params.trace_id ?? null
          );
          fallbackPosition = null; // explicit null per TOOL-02 / Pitfall 2
        } else {
          const purposeResult = await client.completeByPurpose(
            resolvedName,
            hydratedMessages,
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
            `call_model failed (${err instanceof LlmHttpError ? `http ${err.status}` : 'network'}): ${resolvedResolver}/${resolvedName} — ${err.message}`
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
            resolvedResolver === 'model'
              ? llmConf?.models.map((m) => m.name).join(', ') ?? 'none'
              : llmConf?.purposes.map((p) => p.name).join(', ') ?? 'none';
          const kind = resolvedResolver === 'model' ? 'Model' : 'Purpose';
          const kindPlural = resolvedResolver === 'model' ? 'models' : 'purposes';
          const text = `${kind} '${resolvedName}' not found. Available ${kindPlural}: ${availableNames}`;
          logger.error(`call_model failed (${resolvedResolver} not found): ${resolvedName}`);
          return {
            content: [{ type: 'text' as const, text }],
            isError: true,
          };
        }

        // Anything else (unexpected, non-typed error): surface the message rather
        // than masking it.
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`call_model failed (unexpected): ${resolvedResolver}/${resolvedName} — ${message}`);
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

      // Step 4: trace_cumulative (TOOL-05) — build from the pre-snapshot taken before
      // the LLM call (Step 1b). The pre-snapshot contains only rows from prior calls,
      // so we always add the current call's data in-memory to get the correct totals.
      // This avoids the race where client.ts's fire-and-forget write commits between
      // the LLM call and a post-call query, causing the current call to be counted twice.
      let traceCumulative: TraceCumulative | undefined;
      if (params.trace_id && tracePreSnapshot !== null) {
        const rows = tracePreSnapshot;
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
      }

      // Step 5: Build response envelope (TOOL-02 / D-02 conditional fields)
      const metadata: CallModelMetadata = {
        resolver: resolvedResolver,
        name: resolvedName,
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
        if (traceCumulative !== undefined) {
          // Normal path: Supabase pre-snapshot succeeded; traceCumulative includes prior calls.
          metadata.trace_cumulative = traceCumulative;
        } else {
          // Fallback: Supabase unavailable (tracePreSnapshot was null) — populate from
          // current-call data only (CR-02). This ensures trace_cumulative is always present
          // when trace_id is supplied, maintaining the documented behavior contract.
          metadata.trace_cumulative = {
            total_calls: 1,
            total_tokens: { input: result.inputTokens, output: result.outputTokens },
            total_cost_usd: costUsd,
            total_latency_ms: result.latencyMs,
          };
        }
      }

      // Phase 109 REFS-04, REFS-05: only add when references were resolved (D-02-style conditional pattern)
      if (injectionMetadata) {
        metadata.injected_references = injectionMetadata.injectedReferences;
        metadata.prompt_chars = injectionMetadata.promptChars;
      }

      const envelope: CallModelEnvelope = {
        response: result.text,
        metadata,
      };

      logger.info(
        `call_model: ${resolvedResolver}/${resolvedName} -> ${result.modelName}@${result.providerName} (${result.inputTokens}+${result.outputTokens} tokens, ${result.latencyMs}ms, $${costUsd.toFixed(8)})`
      );

      // Note: success returns omit `isError` entirely (not false) — matches files.ts pattern.
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      };
    }
  );
}
