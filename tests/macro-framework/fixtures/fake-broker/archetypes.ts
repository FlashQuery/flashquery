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
// NeedsInputTool — emits a CallToolResult that surfaces as
// needs_user_input (Tier 2, MCP Broker REQ-105).
// ───────────────────────────────────────────────────────────────────────────
export function NeedsInputTool(payload: {
  question: string;
  answer_shape?: string;
  context?: unknown;
  options?: unknown[];
  resume_hint?: string;
}): ArchetypeHandler {
  return () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ needs_user_input: payload }),
      },
    ],
  });
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
