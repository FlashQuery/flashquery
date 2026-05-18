// CallToolResult coercion for the macro engine (REQ-106 + REQ-107).
//
// Adopted from `mcp-sdk-poc/src/broker/coerce.ts` (the POC reference
// implementation). Per the PROD-NOTE in that file, this module belongs in
// the macro engine, NOT the broker — the broker returns a raw
// `CallToolResult` and the macro engine applies the five-step coercion rule.
//
// The five-step rule (REQ-106):
//
//   1. If CallToolResult.isError === true
//      → raise `fail` via formatToolError(result) — do NOT bind a value
//   2. Else if structuredContent !== undefined
//      → bind structuredContent as the macro value
//   3. Else if content[0].type === 'text' and text parses as JSON
//      → bind the parsed JSON value
//   4. Else if content[0].type === 'text'
//      → bind the raw string
//   5. Else
//      → bind the full CallToolResult (rare; multimodal content)
//
// CRITICAL: the `isError` check must come BEFORE any coercion. Without it,
// an error message string becomes the macro's bound value silently and the
// macro continues with garbage (Probe 7 + 10 — see POC note).
//
// REQ-107 fail-fast: callers route `isError: true` results and thrown
// errors through `formatToolError()` before raising the macro frame's
// `fail`. The `coerce()` function below returns one of the four
// "non-error" coercion paths (steps 2–5); the isError path is handled by
// the caller (see `wrapBrokerCallResult` in evaluator.ts) so we don't
// need to thread the "raise fail" signal through here.

import type { CallToolResult } from "./broker.ts";
import type { Value } from "./types.ts";

// The five coercion paths the macro engine can take. Emitted as a
// `state_notes` event (kind: "coerce") on every brokered tool call so
// snapshot tests can verify which branch was taken.
export type CoercePath =
  | "is_error"
  | "structured_content"
  | "json_text"
  | "raw_string"
  | "passthrough";

// Result of a non-error coercion: which step was taken plus the bound value.
export type CoerceOk = {
  path: Exclude<CoercePath, "is_error">;
  value: Value;
};

// Apply steps 2–5 to a CallToolResult (caller has already handled step 1).
// Returns the path taken and the bound value. The non-error case is the
// expected one; callers gate step 1 explicitly.
export function coerceNonError(result: CallToolResult): CoerceOk {
  if (result.structuredContent !== undefined) {
    return { path: "structured_content", value: result.structuredContent as Value };
  }
  const text = firstText(result);
  if (text !== null) {
    // Step 3: try JSON-parse; step 4: fall back to raw string.
    try {
      const parsed = JSON.parse(text) as Value;
      return { path: "json_text", value: parsed };
    } catch {
      return { path: "raw_string", value: text };
    }
  }
  // Step 5: multimodal / nothing-text-shaped — bind full envelope.
  return {
    path: "passthrough",
    value: serializeResult(result) as Value,
  };
}

function firstText(result: CallToolResult): string | null {
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") {
      return item.text;
    }
  }
  return null;
}

// Serialize a CallToolResult into a JSON-shaped Value the macro engine can
// bind. The full SDK shape may include richer items; the golden keeps it
// minimal and JSON-roundtrippable.
function serializeResult(result: CallToolResult): Record<string, Value> {
  const out: Record<string, Value> = {};
  if (result.content !== undefined) {
    out.content = result.content.map((item) => {
      const obj: Record<string, Value> = { type: item.type };
      if (item.text !== undefined) obj.text = item.text;
      return obj;
    });
  }
  if (result.structuredContent !== undefined) {
    out.structuredContent = result.structuredContent as Value;
  }
  if (result.isError !== undefined) {
    out.isError = result.isError;
  }
  return out;
}

// ----- formatToolError adapted from mcp-sdk-poc/src/broker/errors.ts -----
//
// Normalizes the different error shapes that can flow back from a brokered
// tool call (isError CallToolResult, transport-thrown Error, etc.) into a
// single discriminated union the macro engine raises `fail` from
// (REQ-107).
//
// Kinds correspond to the production NormalizedToolError union. The golden
// uses a flat string list since we don't have the SDK's McpError class
// available in this prototype.

export type NormalizedToolError = {
  kind:
    | "is_error_result"
    | "bad_args"
    | "server_timeout"
    | "transport_closed"
    | "server_crashed"
    | "unsupported_method"
    | "malformed_response"
    | "unknown";
  message: string;
};

export function formatToolError(input: unknown): NormalizedToolError {
  // 1. CallToolResult with isError:true — server returned cleanly but signaled failure.
  if (isCallToolResultError(input)) {
    const text = firstText(input as CallToolResult);
    return {
      kind: "is_error_result",
      message: text ?? "Tool returned isError:true with no message.",
    };
  }

  // 2. Plain Error — usually transport / timeout / spawn failure.
  if (input instanceof Error) {
    const msg = input.message ?? String(input);
    let kind: NormalizedToolError["kind"] = "unknown";
    if (/not connected|closed|disconnect|EPIPE|ECONNRESET|transport/i.test(msg)) {
      kind = "transport_closed";
    } else if (/timeout|timed out/i.test(msg)) {
      kind = "server_timeout";
    } else if (/spawn|ENOENT/i.test(msg)) {
      kind = "server_crashed";
    } else if (/method not found|unsupported/i.test(msg)) {
      kind = "unsupported_method";
    } else if (/invalid (params|args)|bad arguments/i.test(msg)) {
      kind = "bad_args";
    }
    return { kind, message: msg };
  }

  return {
    kind: "unknown",
    message: typeof input === "string" ? input : JSON.stringify(input),
  };
}

function isCallToolResultError(input: unknown): input is CallToolResult {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { isError?: unknown }).isError === true
  );
}
