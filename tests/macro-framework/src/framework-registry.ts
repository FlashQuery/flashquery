// Lightweight tool-registry construction for the macro testing framework.
//
// The production engine's `buildToolRegistry()` couples to FlashQuery's
// native catalog, the broker SDK, native dispatch context, consumer
// context, and more. For framework tests we only need a thin slice:
//
//   - A `ToolRegistry` shape the engine recognizes so its prescan and
//     dispatch paths fire (per `src/macro/permission-prescan.ts` and
//     `src/macro/dispatcher.ts`).
//   - An `allowedToolNames` set so prescan considers the allowed surface.
//   - Brokered tools wired straight to a `FakeBroker` instance, with the
//     same coercion semantics the production wrapper applies (REQ-106 /
//     REQ-107 — see `src/macro/coerce.ts`).
//
// Native FQ tools are deliberately NOT wired here in Phase 3. None of the
// twelve pilots exercise real FQ handlers (real `fq.write_document` etc.
// would pull in real Supabase plumbing that the brief explicitly defers
// to integration tests). When a future pilot needs native FQ dispatch,
// the right approach is to land a small adapter that wraps the existing
// `assembleNativeToolRegistry()` — out of scope here.
//
// All four code paths the §5.4 schema's `tools:` block can request are
// supported:
//   - `tools: {}` or absent: no registry; engine's no-registry guard
//     applies (tool calls throw `tool_dispatcher_missing`).
//   - `tools: { fq: 'real' }`: registers an empty `fq` server entry so
//     the prescan recognizes `fq` as a known server (otherwise prescan
//     emits `unknown_server` even when the macro never calls fq). When
//     a pilot wants to provoke `unknown_server` for some OTHER server
//     reference, this is the path it takes.
//   - `tools: { <server>: { archetype: ... } }`: brokered tools, wired
//     through the FakeBroker per §5.7.
//   - Mixed: `fq: real` + brokered servers can coexist (no pilot needs
//     this yet but the surface supports it).

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  coerceBrokerToolArguments,
  coerceCallToolResult,
  isCallToolErrorResult,
} from '../../../src/macro/coerce.js';
import { MacroExpectedError, MacroNeedsUserInputError } from '../../../src/macro/evaluator.js';
import type {
  MacroInvocationContext,
  MacroValue,
} from '../../../src/macro/evaluator.js';
import type { ServerEntry, ToolFn, ToolRegistry } from '../../../src/macro/types.js';

import type { FakeBroker } from '../fixtures/fake-broker/index.ts';
import type { ToolsBlock, ArchetypeConfig } from './runner.ts';

export interface BuiltRegistry {
  registry: ToolRegistry;
  allowedToolNames: string[];
}

export function buildFrameworkRegistry(
  tools: ToolsBlock | undefined,
  broker: FakeBroker | null,
): BuiltRegistry | null {
  if (!tools || Object.keys(tools).length === 0) return null;

  const registry: ToolRegistry = {};
  const allowedToolNames: string[] = [];

  for (const [server, cfg] of Object.entries(tools)) {
    if (server === 'fq') {
      // Pilot needs only the engine's "fq is known" recognition. Empty
      // server entry suffices — when a pilot actually needs to call an
      // fq native tool, we'd need to wire it through here.
      registry[server] = { label: 'FlashQuery (framework stub)', tools: {} };
      continue;
    }
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;
    if (!broker) {
      throw new Error(
        `framework-registry: server "${server}" declares an archetype but no FakeBroker was constructed`,
      );
    }

    // Multi-tool shape — `{ tools: { <name>: { archetype, ... } } }`.
    if (c.tools && typeof c.tools === 'object' && !Array.isArray(c.tools)) {
      const toolEntries: Record<string, ToolFn> = {};
      for (const name of Object.keys(c.tools as Record<string, unknown>)) {
        toolEntries[name] = wrapBrokerToolForFramework(server, name, broker);
        allowedToolNames.push(`${server}.${name}`);
      }
      registry[server] = {
        label: `Fake-broker server "${server}"`,
        tools: toolEntries,
      } satisfies ServerEntry;
      continue;
    }

    // Single-archetype shape.
    const single = c as ArchetypeConfig;
    const toolName = single.tool_name ?? single.archetype.replace(/Tool$/, '').toLowerCase();
    const fn = wrapBrokerToolForFramework(server, toolName, broker);
    registry[server] = {
      label: `Fake-broker server "${server}"`,
      tools: { [toolName]: fn },
    } satisfies ServerEntry;
    allowedToolNames.push(`${server}.${toolName}`);
  }

  return { registry, allowedToolNames };
}

/**
 * Mirror of `src/macro/registry.ts wrapBrokerTool`. Replicates the pieces
 * of production behavior the framework needs to exercise:
 *
 *   - Pre-dispatch visibility check via `listToolsForConsumer` — when the
 *     tool isn't visible AND `getPendingSchemaDrift` reports a pending
 *     drift, throw `MacroNeedsUserInputError` with the REQ-042 payload
 *     so the macro engine surfaces the fifth termination
 *     (Broker REQ-105 nested propagation, REQ-060 spec-valid route b).
 *   - Pass-through `callTool` for visible tools.
 *   - REQ-106 coercion + REQ-107 fail-fast on `isError`.
 *
 * We throw production's MacroNeedsUserInputError directly (not the
 * broker-layer SchemaDriftNeedsUserInputError), which avoids the
 * cross-module `instanceof` problem that bites the broker's catch path
 * under Vitest's resolver.
 */
function wrapBrokerToolForFramework(server: string, tool: string, broker: FakeBroker): ToolFn {
  return async (
    arg: Record<string, MacroValue>,
    _ctx: MacroInvocationContext,
  ): Promise<MacroValue> => {
    void _ctx;
    const consumerContext = {
      kind: 'host' as const,
      traceId: 'framework-test',
      interactive: true,
    };

    // Pre-dispatch visibility + pending-drift check (mirrors production
    // `registry.ts:154-179`).
    const visibleTools = await broker.listToolsForConsumer(consumerContext);
    const visibleTool = visibleTools.find(
      (t) => t.serverId === server && t.toolName === tool,
    );
    if (visibleTool === undefined) {
      const pendingDrifts = broker
        .getPendingSchemaDrift({})
        .filter((d) => d.server === server);
      const pendingDrift = pendingDrifts.find((d) => d.tool === tool);
      if (pendingDrift !== undefined) {
        throw new MacroNeedsUserInputError(
          pendingDrifts.length > 1
            ? { event: 'schema_drift_detected', server, changes: pendingDrifts }
            : pendingDrift,
        );
      }
      throw new MacroExpectedError(
        'unknown_tool',
        `Brokered tool '${server}.${tool}' is not available.`,
        { server, tool },
      );
    }

    let result: CallToolResult;
    try {
      result = await broker.callTool(
        { serverId: server, toolName: tool },
        coerceBrokerToolArguments(arg),
        consumerContext,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new MacroExpectedError('tool_call_failed', message, {
        server,
        tool,
        reason: 'transport_error',
      });
    }
    if (isCallToolErrorResult(result)) {
      const message = textOfFirstContent(result) ?? 'Brokered tool returned isError=true.';
      // REQ-107 fail-fast: produce a structured tool_call_failed envelope.
      throw new MacroExpectedError('tool_call_failed', message, {
        server,
        tool,
        reason: 'is_error_result',
      });
    }
    return coerceCallToolResult(result);
  };
}

function textOfFirstContent(result: CallToolResult): string | undefined {
  const c = result.content?.[0];
  if (c && typeof (c as { type?: unknown }).type === 'string' && (c as { type: string }).type === 'text') {
    return (c as { text: string }).text;
  }
  return undefined;
}
