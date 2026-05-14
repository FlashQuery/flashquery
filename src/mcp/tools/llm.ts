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
import { LLM_PARTICIPANT_NAMES } from '../../constants/llm.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';
import { llmClient, NullLlmClient, LlmHttpError, LlmNetworkError, type LlmCompletionResult } from '../../llm/client.js';
import { LlmFallbackError } from '../../llm/resolver.js';
import { computeCost, getRecordedTraceUsageSnapshot } from '../../llm/cost-tracker.js';
import { executeAgentLoop } from '../../llm/agent-loop.js';
import { assertResponseFormatAllowedWithTools, modelCapabilitiesWithDefaults } from '../../llm/capabilities.js';
import { buildListModelsContent, buildListPurposesContent, buildSearchContent } from '../../llm/discovery-content.js';
import { buildCallModelHelpContent, CALL_MODEL_RESOLVERS } from '../../llm/help-content.js';
import type { CallModelEnvelope, CallModelMessage, CallModelMetadata, LlmChatResult } from '../../llm/types.js';
import {
  assembleNativeToolRegistry,
  mergeModelVisibleToolRegistries,
  type ToolRegistryAssembly,
  type ToolRegistryDiagnostics,
} from '../../llm/tool-registry.js';
import { assembleTemplateToolRegistry, type TemplateToolDiagnostics } from '../../llm/template-tools.js';
import { loadPurposeTemplateRuntimeBindings } from '../../llm/purpose-template-bindings.js';
import { getNativeToolCatalog } from '../tool-catalog.js';
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

type TraceCumulative = NonNullable<CallModelMetadata['trace_cumulative']>;
type PurposeChatResult = LlmChatResult & { purposeName: string; fallbackPosition: number };
type RuntimeTemplateBinding = Awaited<ReturnType<typeof loadPurposeTemplateRuntimeBindings>>[number];
type RuntimeTemplateBindingLoadResult =
  | { ok: true; bindings: RuntimeTemplateBinding[] }
  | { ok: false; message: string };

type PublicToolDiagnostics = Record<string, unknown> & {
  expanded_tiers?: ToolRegistryDiagnostics['expandedTiers'];
  explicit_tools?: ToolRegistryDiagnostics['explicitTools'];
  excluded?: ToolRegistryDiagnostics['excluded'];
  hard_excluded?: ToolRegistryDiagnostics['hardExcluded'];
  unknown?: ToolRegistryDiagnostics['unknown'];
  template_tool_warnings?: TemplateToolDiagnostics['template_tool_warnings'];
};

async function safeLoadPurposeTemplateRuntimeBindings(instanceId: string): Promise<RuntimeTemplateBindingLoadResult> {
  try {
    return {
      ok: true,
      bindings: await loadPurposeTemplateRuntimeBindings(instanceId),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`call_model failed to load runtime template bindings: ${message}`);
    return { ok: false, message };
  }
}

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
});

export const callModelMessageSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('system'),
    content: z.string().optional(),
    name: z.string().optional(),
  }),
  z.object({
    role: z.literal('user'),
    content: z.string().optional(),
    name: z.string().optional(),
  }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().nullable().optional(),
    name: z.string().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
  }),
  z.object({
    role: z.literal('tool'),
    content: z.string().optional(),
    tool_call_id: z.string(),
    name: z.never().optional(),
    tool_calls: z.never().optional(),
  }),
]);

function findToolMessageWithName(messages: CallModelMessage[]): number | null {
  const index = messages.findIndex((message) => message.role === 'tool' && message.name !== undefined);
  return index === -1 ? null : index;
}

function buildReturnedMessages(messages: CallModelMessage[], assistantName?: string): CallModelMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      const { name: _name, ...withoutName } = message;
      return withoutName;
    }
    if (message.role === 'assistant' && message.name === undefined && assistantName !== undefined) {
      return { ...message, name: assistantName };
    }
    if ((message.role === 'user' || message.role === 'system') && message.name === undefined) {
      return { ...message, name: LLM_PARTICIPANT_NAMES.host };
    }
    return message;
  });
}

function toPublicToolDiagnostics(diagnostics: ToolRegistryAssembly['diagnostics']): PublicToolDiagnostics {
  const publicDiagnostics: PublicToolDiagnostics = {};
  if (diagnostics.expandedTiers.length > 0) {
    publicDiagnostics.expanded_tiers = diagnostics.expandedTiers;
  }
  if (diagnostics.explicitTools.length > 0) {
    publicDiagnostics.explicit_tools = diagnostics.explicitTools;
  }
  if (diagnostics.excluded.length > 0) {
    publicDiagnostics.excluded = diagnostics.excluded;
  }
  if (diagnostics.hardExcluded.length > 0) {
    publicDiagnostics.hard_excluded = diagnostics.hardExcluded;
  }
  if (diagnostics.unknown.length > 0) {
    publicDiagnostics.unknown = diagnostics.unknown;
  }
  if ((diagnostics.template_tool_warnings?.length ?? 0) > 0) {
    publicDiagnostics.template_tool_warnings = diagnostics.template_tool_warnings;
  }
  return publicDiagnostics;
}

function hasPublicToolDiagnostics(diagnostics: PublicToolDiagnostics): boolean {
  return Object.keys(diagnostics).length > 0;
}

function hasProviderToolArray(parameters: Record<string, unknown> | undefined): boolean {
  return Array.isArray(parameters?.['tools']) && parameters['tools'].length > 0;
}

export function hasModelVisibleTools(toolRegistry: ToolRegistryAssembly | undefined): boolean {
  return (toolRegistry?.providerTools?.length ?? 0) > 0;
}

function mergeProviderTools(
  baseParameters: Record<string, unknown>,
  providerTools: NonNullable<ToolRegistryAssembly['providerTools']>
): Record<string, unknown> {
  const callerTools = Array.isArray(baseParameters['tools'])
    ? baseParameters['tools'] as Array<Record<string, unknown>>
    : [];
  return {
    ...baseParameters,
    tools: [...callerTools, ...providerTools],
  };
}

function messagesStartWithHydrated(
  loopMessages: CallModelMessage[],
  hydratedMessages: CallModelMessage[]
): boolean {
  if (loopMessages.length < hydratedMessages.length) return false;
  return hydratedMessages.every((message, index) => JSON.stringify(loopMessages[index]) === JSON.stringify(message));
}

function buildTraceCumulative(
  tracePreSnapshot: Array<{ input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; latency_ms: number | null }> | null,
  current: { tokens: { input: number; output: number }; cost_usd: number; latency_ms: number }
): TraceCumulative | undefined {
  if (tracePreSnapshot === null) {
    return {
      total_calls: 1,
      total_tokens: { input: current.tokens.input, output: current.tokens.output },
      total_cost_usd: current.cost_usd,
      total_latency_ms: current.latency_ms,
    };
  }

  return {
    total_calls: tracePreSnapshot.length + 1,
    total_tokens: {
      input: tracePreSnapshot.reduce((sum, row) => sum + Number(row.input_tokens ?? 0), 0) + current.tokens.input,
      output: tracePreSnapshot.reduce((sum, row) => sum + Number(row.output_tokens ?? 0), 0) + current.tokens.output,
    },
    total_cost_usd: tracePreSnapshot.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0) + current.cost_usd,
    total_latency_ms: tracePreSnapshot.reduce((sum, row) => sum + Number(row.latency_ms ?? 0), 0) + current.latency_ms,
  };
}

function buildMode2Envelope(
  loopEnvelope: CallModelEnvelope,
  hydratedMessages: CallModelMessage[],
  toolRegistry: ToolRegistryAssembly,
  params: { return_messages?: boolean; trace_id?: string },
  tracePreSnapshot: Array<{ input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; latency_ms: number | null }> | null,
  injectionMetadata?: InjectionMetadata
): CallModelEnvelope {
  const loopTools = loopEnvelope.metadata.tools;
  const publicDiagnostics = toPublicToolDiagnostics(toolRegistry.diagnostics);
  const loopHistory = messagesStartWithHydrated(loopEnvelope.messages, hydratedMessages)
    ? loopEnvelope.messages.slice(hydratedMessages.length)
    : loopEnvelope.messages;
  const metadata: CallModelMetadata = {
    resolver: loopEnvelope.metadata.resolver,
    name: loopEnvelope.metadata.name,
    resolved_model_name: loopEnvelope.metadata.resolved_model_name,
    provider_name: loopEnvelope.metadata.provider_name,
    fallback_position: loopEnvelope.metadata.fallback_position,
    tokens: loopEnvelope.metadata.tokens,
    cost_usd: loopEnvelope.metadata.cost_usd,
    latency_ms: loopEnvelope.metadata.latency_ms,
    tools: {
      native_tool_names: toolRegistry.nativeToolNames,
      ...(toolRegistry.templateToolNames && toolRegistry.templateToolNames.length > 0
        ? { template_tool_names: toolRegistry.templateToolNames }
        : {}),
      diagnostics: publicDiagnostics,
      stop_reason: loopTools?.stop_reason ?? 'error',
      iterations: loopTools?.iterations ?? 0,
      calls_log: loopTools?.calls_log ?? [],
      aggregate_usage: loopTools?.aggregate_usage ?? {
        tokens: loopEnvelope.metadata.tokens,
        cost_usd: loopEnvelope.metadata.cost_usd,
        latency_ms: loopEnvelope.metadata.latency_ms,
      },
    },
  };

  if (params.trace_id) {
    metadata.trace_id = params.trace_id;
    metadata.trace_cumulative = buildTraceCumulative(tracePreSnapshot, {
      tokens: loopEnvelope.metadata.tokens,
      cost_usd: loopEnvelope.metadata.cost_usd,
      latency_ms: loopEnvelope.metadata.latency_ms,
    });
  }
  if (injectionMetadata) {
    metadata.injected_references = injectionMetadata.injectedReferences;
    metadata.prompt_chars = injectionMetadata.promptChars;
  }

  return {
    response: loopEnvelope.response,
    messages: params.return_messages === true
      ? [...buildReturnedMessages(hydratedMessages), ...buildReturnedMessages(loopHistory, loopEnvelope.metadata.name)]
      : [],
    metadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerLlmTools — registers `call_model` unconditionally (TOOL-03).
// The MCP SDK does not allow tools to be added after `server.connect()` (issue #893),
// so registration must happen even when `config.llm` is undefined. The
// `instanceof NullLlmClient` guard inside the handler signals unconfigured state.
// ─────────────────────────────────────────────────────────────────────────────

export function registerLlmTools(server: McpServer, config: FlashQueryConfig): void {
  const nativeToolCatalog = getNativeToolCatalog(server);

  server.registerTool(
    'call_model',
    {
      description:
        "Call any configured LLM model directly (resolver='model') or via a named purpose with fallback chain (resolver='purpose'). " +
        "Discovery resolvers (resolver='list_models'/'list_purposes'/'search'/'help') return configuration data with no LLM call — name and messages are not required for these. " +
        "For 'search', supply parameters.query as the search string (case-insensitive substring match on name and description). " +
        "Returns the model's text response plus a diagnostic envelope with provider, token usage, computed cost (USD), and latency. " +
        "When trace_id is provided, the call is recorded with that ID and the response includes cumulative stats across all calls sharing that trace_id. " +
        "When trace_id is omitted, the trace_id and trace_cumulative fields are absent from the metadata object entirely — the keys are not present, not null. " +
        "Note: messages are forwarded to the provider as-is — prompt safety is the caller's responsibility.",
      inputSchema: {
        resolver: z.enum(CALL_MODEL_RESOLVERS).describe(
          "'model' to call a specific model alias directly; 'purpose' to walk a named purpose's fallback chain. " +
          "'list_models' / 'list_purposes' / 'search' / 'help' return configuration data without making an LLM call (no messages required)."
        ),
        name: z.string().optional().describe(
          'Model alias (when resolver=model) or purpose name (when resolver=purpose). ' +
          'Ignored for discovery resolvers (list_models/list_purposes/search/help).'
        ),
        messages: z
          .array(callModelMessageSchema)
          .optional()
          .describe('OpenAI-style messages array. Required for resolver=model/purpose. Ignored for discovery resolvers.'),
        return_messages: z.boolean().optional().describe(
          'When true, successful model/purpose calls include post-hydration input messages plus the final assistant message.'
        ),
        parameters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional LLM parameters (temperature, max_tokens, etc.) — passed through to the provider.'),
        template_params: z.record(z.string(), z.record(z.string(), z.unknown()))
          .optional()
          .describe('Template parameters keyed by template path or alias for host-authored reference hydration. Ignored by discovery resolvers.'),
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

      const client = llmClient;

      if (params.resolver === 'help') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(buildCallModelHelpContent({ configured: !!client && !(client instanceof NullLlmClient) })) }],
        };
      }

      // Step 1: Unconfigured guard (D-04, TOOL-03 / U-30 / L-13)
      // Access llmClient inside handler body, never at module level (Pitfall 1).
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
        if (params.resolver === 'list_models') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(buildListModelsContent(config)) }] };
        }

        const queryRaw = params.parameters?.['query'];
        if (params.resolver === 'search' && (typeof queryRaw !== 'string' || queryRaw === '')) {
          return {
            content: [{ type: 'text' as const, text: 'search requires parameters.query (non-empty string)' }],
            isError: true,
          };
        }

        if (params.resolver === 'list_purposes') {
          const runtimeTemplateBindingsResult = await safeLoadPurposeTemplateRuntimeBindings(config.instance.id);
          if (!runtimeTemplateBindingsResult.ok) {
            return {
              content: [{ type: 'text' as const, text: `call_model failed: ${runtimeTemplateBindingsResult.message}` }],
              isError: true,
            };
          }
          const payload = await buildListPurposesContent({
            config,
            nativeToolCatalog,
            runtimeTemplateBindings: runtimeTemplateBindingsResult.bindings,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
        }

        // params.resolver === 'search'
        const runtimeTemplateBindingsResult = await safeLoadPurposeTemplateRuntimeBindings(config.instance.id);
        if (!runtimeTemplateBindingsResult.ok) {
          return {
            content: [{ type: 'text' as const, text: `call_model failed: ${runtimeTemplateBindingsResult.message}` }],
            isError: true,
          };
        }
        const payload = await buildSearchContent({
          config,
          nativeToolCatalog,
          runtimeTemplateBindings: runtimeTemplateBindingsResult.bindings,
          query: queryRaw as string,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(payload),
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
      const messagesForRefs = params.messages ?? [];
      if (hasProviderToolArray(params.parameters) || Array.isArray((params as { tools?: unknown }).tools)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Mode 3 caller-provided tools are deferred; remove caller-provided tools for FlashQuery-managed Mode 2.',
            },
          ],
          isError: true,
        };
      }
      const toolMessageWithName = findToolMessageWithName(messagesForRefs);
      if (toolMessageWithName !== null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `role=tool messages cannot include name; use tool_call_id for tool identity (message index ${toolMessageWithName})`,
            },
          ],
          isError: true,
        };
      }

      // Step 1.5: Reference resolution (REFS-01 through REFS-07)
      // Scans host-authored system/user message content for {{ref:...}} placeholders, resolves each
      // via resolveAndBuildDocument (reused from get_document), and replaces inline before
      // dispatching to the LLM. Fail-fast: if any reference fails, no LLM call is made.
      // No-op when no patterns present (REFS-07 backward compat).
      // Type narrowing: Step 1.2 guarantees messages is defined for model/purpose path.
      const hostReferenceTargets = messagesForRefs
        .map((message, originalIndex) => ({ message, originalIndex }))
        .filter(({ message }) =>
          (message.role === 'system' || message.role === 'user') &&
          typeof message.content === 'string'
        );
      const parsed = parseReferences(hostReferenceTargets.map(({ message }) => ({
        role: message.role,
        content: message.content as string,
      })));
      if ('error' in parsed) {
        // REFS-02: # and -> mutually exclusive — parse error → immediate fail (no LLM call)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'reference_resolution_failed',
            failed_references: [{
              ref: parsed.ref,
              reason: 'invalid_reference_syntax',
              detail: parsed.detail ?? parsed.reason,
            }],
          }) }],
          isError: true,
        };
      }
      let hydratedMessages: typeof messagesForRefs = messagesForRefs;
      let injectionMetadata: InjectionMetadata | undefined;
      if (parsed.length > 0) {
        const parsedWithOriginalIndexes = parsed.map((ref) => ({
          ...ref,
          messageIndex: hostReferenceTargets[ref.messageIndex]?.originalIndex ?? ref.messageIndex,
        }));
        const resolved = await resolveReferences(
          parsedWithOriginalIndexes,
          config,
          supabaseManager,
          embeddingProvider,
          logger,
          params.template_params
        );
        const failures = resolved.filter((r): r is FailedRef => r.kind === 'failed');
        if (failures.length > 0) {
          // REFS-06: any failure → return reference_resolution_failed; NO LLM call made
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'reference_resolution_failed',
              failed_references: failures.map((f) => ({
                ref: f.ref,
                reason: f.reason,
                detail: f.detail,
              })),
            }) }],
            isError: true,
          };
        }
        const resolvedRefs = resolved as ResolvedRef[];
        hydratedMessages = hydrateMessages(messagesForRefs, resolvedRefs);
        injectionMetadata = {
          injectedReferences: buildInjectedReferences(resolvedRefs),
          promptChars: computePromptChars(hydratedMessages),
        };
      }

      let toolRegistry: ToolRegistryAssembly | undefined;
      let purposeProviderParameters = params.parameters;
      let purposeDefaults: Record<string, unknown> = {};

      if (resolvedResolver === 'purpose') {
        const normalizedPurposeName = resolvedName.toLowerCase();
        const purpose = config.llm?.purposes.find((p) => p.name.toLowerCase() === normalizedPurposeName);
        if (purpose === undefined) {
          const availableNames = config.llm?.purposes.map((p) => p.name).join(', ') ?? 'none';
          return {
            content: [{ type: 'text' as const, text: `Purpose '${resolvedName}' not found. Available purposes: ${availableNames}` }],
            isError: true,
          };
        }
        purposeDefaults = purpose?.defaults ?? {};
        const runtimeTemplateBindingsResult = await safeLoadPurposeTemplateRuntimeBindings(config.instance.id);
        if (!runtimeTemplateBindingsResult.ok) {
          return {
            content: [{ type: 'text' as const, text: `call_model failed: ${runtimeTemplateBindingsResult.message}` }],
            isError: true,
          };
        }
        for (const modelName of purpose?.models ?? []) {
          const capabilityCheck = assertResponseFormatAllowedWithTools(
            config,
            normalizedPurposeName,
            modelName,
            params.parameters
          );
          if (!capabilityCheck.ok) {
            return {
              content: [{ type: 'text' as const, text: capabilityCheck.message }],
              isError: true,
            };
          }
        }
        if (purpose !== undefined) {
          const selectedModel = client.getModelForPurpose(resolvedName);
          const selectedProvider = selectedModel
            ? config.llm?.providers.find((provider) => provider.name === selectedModel.config.providerName)
            : undefined;
          const capabilities = selectedModel && selectedProvider
            ? modelCapabilitiesWithDefaults(selectedModel.config, selectedProvider)
            : {};
          const nativeRegistry = assembleNativeToolRegistry(
            config,
            normalizedPurposeName,
            nativeToolCatalog,
            { strictTools: capabilities.strict_tools === true }
          );
          const templateRegistry = await assembleTemplateToolRegistry({
            config,
            purposeName: normalizedPurposeName,
            runtimeBindings: runtimeTemplateBindingsResult.bindings,
            nativeToolNames: nativeRegistry.nativeToolNames,
            strictTools: capabilities.strict_tools === true,
          });
          toolRegistry = mergeModelVisibleToolRegistries({
            native: nativeRegistry,
            template: templateRegistry,
          });
          if ((toolRegistry.collisions?.length ?? 0) > 0) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'tool_registry_collision',
                collisions: toolRegistry.collisions,
                template_tool_conflicts: toolRegistry.collisions,
              }) }],
              isError: true,
            };
          }
          const hasConfiguredToolSurface =
            purpose.tools !== undefined ||
            purpose.excludedTools !== undefined ||
            purpose.templates !== undefined ||
            config.templates !== undefined;
          const baseParameters = params.parameters ?? (hasConfiguredToolSurface ? {} : undefined);
          purposeProviderParameters = toolRegistry.providerTools && toolRegistry.providerTools.length > 0
            ? mergeProviderTools(baseParameters ?? {}, toolRegistry.providerTools)
            : baseParameters;
        }
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
        const inMemoryTraceRows = getRecordedTraceUsageSnapshot(config.instance.id, params.trace_id).map((record) => ({
          input_tokens: record.inputTokens,
          output_tokens: record.outputTokens,
          cost_usd: record.costUsd,
          latency_ms: record.latencyMs,
        }));
        let supabase: ReturnType<typeof supabaseManager.getClient> | null = null;
        try {
          supabase = supabaseManager.getClient();
        } catch {
          tracePreSnapshot = inMemoryTraceRows;
          logger.warn('trace pre-snapshot skipped: Supabase not configured; using in-memory trace snapshot');
        }
        if (supabase) {
          try {
            const { data } = await supabase
              .from('fqc_llm_usage')
              .select('input_tokens, output_tokens, cost_usd, latency_ms')
              .eq('instance_id', config.instance.id)
              .eq('trace_id', params.trace_id);
            const dbRows = data ?? [];
            tracePreSnapshot = dbRows.length >= inMemoryTraceRows.length ? dbRows : inMemoryTraceRows;
          } catch (err: unknown) {
            tracePreSnapshot = inMemoryTraceRows;
            logger.warn(
              `trace pre-snapshot query failed; using in-memory trace snapshot: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }

      // Step 2: Dispatch by resolver
      if (resolvedResolver === 'purpose' && hasModelVisibleTools(toolRegistry)) {
        try {
          const loopEnvelope = await executeAgentLoop({
            instanceId: config.instance.id,
            purposeName: resolvedName,
            initialMessages: hydratedMessages,
            providerParameters: purposeProviderParameters,
            purposeDefaults,
            nativeToolCatalog,
            // toolRegistry carries the templateReverseMap used for generated template tool dispatch.
            toolRegistry,
            templateDispatchContext: { config, logger },
            traceId: params.trace_id ?? null,
            chatByPurpose: client.chatByPurposeUnrecorded.bind(client),
            modelCostLookup: (modelName) => config.llm?.models.find((model) => model.name === modelName),
            initialModelName: client.getModelForPurpose(resolvedName)?.modelName ?? null,
            logger,
            getIsShuttingDown,
          });
          const envelope = buildMode2Envelope(
            loopEnvelope,
            hydratedMessages,
            toolRegistry,
            { return_messages: params.return_messages, trace_id: params.trace_id },
            tracePreSnapshot,
            injectionMetadata
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`call_model failed (agent loop): ${resolvedResolver}/${resolvedName} — ${message}`);
          return {
            content: [{ type: 'text' as const, text: `call_model failed: ${message}` }],
            isError: true,
          };
        }
      }

      let result: LlmCompletionResult | PurposeChatResult;
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
            purposeProviderParameters,
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
      const assistantMessage: LlmChatResult['message'] | undefined = 'message' in result ? result.message : undefined;
      const hasAssistantToolCalls = (assistantMessage?.tool_calls?.length ?? 0) > 0;
      const responseText: string = 'text' in result
        ? result.text
        : typeof assistantMessage?.content === 'string'
          ? assistantMessage.content
          : hasAssistantToolCalls
            ? ''
            : undefined;
      if (responseText === undefined) {
        return {
          content: [{
            type: 'text' as const,
            text:
              `call_model failed: LLM error: ${result.providerName} returned a 200 response with no completion choices.`,
          }],
          isError: true,
        };
      }

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

      if (toolRegistry) {
        const publicDiagnostics = toPublicToolDiagnostics(toolRegistry.diagnostics);
        if (hasModelVisibleTools(toolRegistry) && hasPublicToolDiagnostics(publicDiagnostics)) {
          metadata.tools = {
            native_tool_names: toolRegistry.nativeToolNames,
            diagnostics: publicDiagnostics,
          };
        }
      }

      const envelope: CallModelEnvelope = {
        response: responseText,
        messages: params.return_messages === true || hasAssistantToolCalls
          ? [
              ...buildReturnedMessages(hydratedMessages),
              assistantMessage
                ? {
                    ...assistantMessage,
                    name: fallbackPosition === null ? result.modelName : resolvedName,
                  }
                : {
                    role: 'assistant' as const,
                    content: responseText,
                    name: fallbackPosition === null ? result.modelName : resolvedName,
                  },
            ]
          : [],
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
