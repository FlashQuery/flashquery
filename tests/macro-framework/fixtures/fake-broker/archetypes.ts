// Fake-broker archetype library (per Macro Testing Framework Requirements
// §5.7).
//
// Each archetype is a factory returning an `ArchetypeHandler` — a function
// from `(args, ctx)` to `CallToolResult`. The `FakeBroker` (broker.ts) wires
// these into the `McpBroker` interface so the macro engine sees the same API
// surface it would see in production.
//
// Composability: a single FakeBroker instance hosts many archetypes across
// many fake servers (server -> tool -> handler).
//
// Justification (INV-MTF-06 criterion (a) absent): real third-party MCP
// brokers cannot be steered to produce specific edge-case responses on
// demand, so fakes are the right substrate permanently per §5.7.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ArchetypeContext = {
  server: string;
  tool: string;
  callIndex: number; // 0-based; useful to ScriptedTool
};

export type ArchetypeHandler = (
  args: unknown,
  ctx: ArchetypeContext,
) => CallToolResult | Promise<CallToolResult>;

// ───────────────────────────────────────────────────────────────────────────
// ReadOnlyTool — succeeds with a configured value; declares itself read-only.
// ───────────────────────────────────────────────────────────────────────────
export function ReadOnlyTool(returns: unknown): ArchetypeHandler {
  return () => ({
    content: [{ type: 'text', text: typeof returns === 'string' ? returns : JSON.stringify(returns) }],
  });
}

// ───────────────────────────────────────────────────────────────────────────
// WriteTool — succeeds; records the side-effect on the broker's call log.
// The broker is responsible for capturing this; the archetype only emits
// success.
// ───────────────────────────────────────────────────────────────────────────
export function WriteTool(side_effect: string = 'write'): ArchetypeHandler {
  return (args) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: true, side_effect, args }),
      },
    ],
  });
}

// ───────────────────────────────────────────────────────────────────────────
// ThrowingTool — throws an SDK-shaped error of the requested taxonomy class.
// Use to exercise the broker's error-translation path (REQ-107).
// ───────────────────────────────────────────────────────────────────────────
export function ThrowingTool(
  error_kind: 'transport' | 'timeout' | 'protocol' | 'generic' = 'generic',
): ArchetypeHandler {
  return () => {
    const err = new Error(`ThrowingTool: ${error_kind}`);
    (err as Error & { kind?: string }).kind = error_kind;
    throw err;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// IsErrorTool — returns CallToolResult.isError = true (REQ-106 carve-out).
// Macro engine should fail-fast per REQ-107.
// ───────────────────────────────────────────────────────────────────────────
export function IsErrorTool(message: string): ArchetypeHandler {
  return () => ({
    isError: true,
    content: [{ type: 'text', text: message }],
  });
}

// ───────────────────────────────────────────────────────────────────────────
// LyingTool — claims one capability, behaves as another. The broker reports
// the claimed shape during list_tools; the behavior at call time follows
// the `behaves` factory.
// ───────────────────────────────────────────────────────────────────────────
export function LyingTool(opts: {
  claims: { readOnly: boolean };
  behaves: ArchetypeHandler;
}): ArchetypeHandler & { claims: { readOnly: boolean } } {
  const handler = ((args, ctx) => opts.behaves(args, ctx)) as ArchetypeHandler & {
    claims: { readOnly: boolean };
  };
  handler.claims = opts.claims;
  return handler;
}

// ───────────────────────────────────────────────────────────────────────────
// SlowTool — sleeps before responding. Composes with the fake clock or
// a real setTimeout for timeout assertions.
// ───────────────────────────────────────────────────────────────────────────
export function SlowTool(ms: number, returns: unknown = { ok: true }): ArchetypeHandler {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return {
      content: [{ type: 'text', text: typeof returns === 'string' ? returns : JSON.stringify(returns) }],
    };
  };
}

// ───────────────────────────────────────────────────────────────────────────
// NeedsInputViaTofuDrift — simulates a tool pending TOFU re-approval per
// Broker REQ-041/042. The macro engine's pre-dispatch check at
// `registry.ts:156-174` queries `getPendingSchemaDrift` and throws its
// OWN `MacroNeedsUserInputError` with the drift payload. That class is
// shared between production and test via the same module, so this route
// avoids the cross-module `instanceof` pitfalls of throwing during
// `callTool`.
//
// REQ-060 spec context: brokered tools CANNOT trigger needs_user_input
// directly. Only (a) FQ-native tools and (b) the broker layer (TOFU
// drift) emit the fifth termination. This archetype models route (b).
//
// Pilots register the tool with this archetype. The FakeBroker detects
// the marker and:
//   - EXCLUDES the tool from `listToolsForConsumer` (so production sees
//     it as `visibleTool === undefined` and falls into the pending-drift
//     check).
//   - INCLUDES the drift entry in `getPendingSchemaDrift` (so production
//     finds it and throws `MacroNeedsUserInputError` with the REQ-042
//     payload).
// The handler itself is never invoked (production short-circuits at
// pre-dispatch), so its body returns a sentinel error if accidentally
// reached.
// ───────────────────────────────────────────────────────────────────────────
export interface TofuDriftMarkerPayload {
  event: 'schema_drift_detected';
  server: string;
  tool: string;
  question: string;
  old_schema: { name: string; description: string; inputSchema: unknown };
  new_schema: { name: string; description: string; inputSchema: unknown };
  diff_summary: string;
  options: ['approve', 'reject'];
  answer_shape: string;
}

export type DriftMarkedHandler = ArchetypeHandler & {
  __tofuDriftPayload: TofuDriftMarkerPayload;
};

export function NeedsInputViaTofuDrift(driftPayload: {
  server: string;
  tool: string;
  question?: string;
  old_schema?: { name?: string; description?: string; inputSchema?: unknown };
  new_schema?: { name?: string; description?: string; inputSchema?: unknown };
  diff_summary?: string;
  answer_shape?: string;
}): DriftMarkedHandler {
  const payload: TofuDriftMarkerPayload = {
    event: 'schema_drift_detected',
    server: driftPayload.server,
    tool: driftPayload.tool,
    question:
      driftPayload.question ??
      'The schema for this tool changed since you first approved it. Review the differences and decide whether to accept the new version.',
    old_schema: {
      name: driftPayload.old_schema?.name ?? driftPayload.tool,
      description: driftPayload.old_schema?.description ?? 'previous description',
      inputSchema:
        driftPayload.old_schema?.inputSchema ?? { type: 'object', properties: {} },
    },
    new_schema: {
      name: driftPayload.new_schema?.name ?? driftPayload.tool,
      description: driftPayload.new_schema?.description ?? 'new description',
      inputSchema:
        driftPayload.new_schema?.inputSchema ?? {
          type: 'object',
          properties: { topic: { type: 'string' } },
          required: ['topic'],
        },
    },
    diff_summary:
      driftPayload.diff_summary ??
      '• Added required parameter: topic (string)\n• Description changed.',
    options: ['approve', 'reject'],
    answer_shape:
      driftPayload.answer_shape ??
      `frontmatter.user_decisions.${driftPayload.server}__${driftPayload.tool}.tofu_decision`,
  };
  const handler = (() => {
    // Production should short-circuit at pre-dispatch and never invoke
    // this handler. If it does, surface a loud test failure rather than
    // a silent success.
    throw new Error(
      'NeedsInputViaTofuDrift handler invoked — production should have short-circuited at the pre-dispatch pending-drift check.',
    );
  }) as DriftMarkedHandler;
  handler.__tofuDriftPayload = payload;
  return handler;
}

// ───────────────────────────────────────────────────────────────────────────
// StructuredContentTool — returns `structuredContent` for REQ-106 path 2.
// ───────────────────────────────────────────────────────────────────────────
export function StructuredContentTool(value: unknown): ArchetypeHandler {
  return () => ({
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// JSONTextTool — returns text content that parses as JSON (REQ-106 path 3).
// ───────────────────────────────────────────────────────────────────────────
export function JSONTextTool(value: unknown): ArchetypeHandler {
  return () => ({
    content: [{ type: 'text', text: JSON.stringify(value) }],
  });
}

// ───────────────────────────────────────────────────────────────────────────
// MultimodalTool — returns full CallToolResult shape (REQ-106 path 5).
// ───────────────────────────────────────────────────────────────────────────
export function MultimodalTool(content: CallToolResult['content']): ArchetypeHandler {
  return () => ({ content });
}

// ───────────────────────────────────────────────────────────────────────────
// ScriptedTool — returns different responses on different calls indexed by
// the per-tool call order. Out-of-bounds calls reuse the last response.
// ───────────────────────────────────────────────────────────────────────────
export type ScriptedResponse =
  | CallToolResult
  | ((args: unknown, ctx: ArchetypeContext) => CallToolResult | Promise<CallToolResult>);

export function ScriptedTool(responses: ScriptedResponse[]): ArchetypeHandler {
  if (responses.length === 0) {
    throw new Error('ScriptedTool requires at least one response');
  }
  return async (args, ctx) => {
    const idx = Math.min(ctx.callIndex, responses.length - 1);
    const r = responses[idx];
    if (typeof r === 'function') return r(args, ctx);
    return r;
  };
}
