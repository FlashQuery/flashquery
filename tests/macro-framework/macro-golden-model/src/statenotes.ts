// StateNote schema for the golden model (per Macro Testing Framework
// Requirements §5.6.1). Verbatim discriminated union; the production engine
// does NOT emit state_notes — only the golden does (asymmetric instrumentation,
// embedded snapshot at testgen time).
//
// The seven event kinds — `binding`, `loop`, `budget`, `permission`,
// `coerce`, `task`, `ast` — cover meaningful state changes during macro
// evaluation. The evaluator and dispatcher emit notes via `emitStateNote()`
// (see evaluator.ts).

import type { Value } from "./types.ts";

// JSON-serializable subset of Value. Same shape; renamed for clarity in the
// state_notes schema where the values must always be JSON-round-trippable.
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export type StateNote =
  // ─── Variable binding events ───
  | {
      kind: "binding";
      op: "set" | "update" | "shadow";  // set=new local; update=walk-up write; shadow=loop/block carve-out
      name: string;                      // variable name (without $ prefix)
      value: SerializableValue;          // bound value, JSON-serializable
      scope: "local" | "outer" | "global";
    }

  // ─── Loop iteration progress ───
  | {
      kind: "loop";
      loop_kind: "for" | "while";
      loop_id: string;                   // unique within macro execution (e.g., "for_loop_42")
      iter: number;                      // 0-based iteration count
      var?: string;                      // for-loop iterator variable name, if any
      value?: SerializableValue;         // current iterator value
      // Tier 2 (REQ-104): marker emitted when the iteration was unwound
      // by `continue` (skip to next) or `break` (exit loop). Absent on
      // normal iteration-start events.
      control?: "continue" | "break";
    }

  // ─── Budget consumption snapshot ───
  | {
      kind: "budget";
      tokens: number;
      model_calls: number;
      external_tool_calls: number;
      elapsed_ms: number;
    }

  // ─── Permission pre-scan decision (one per tool reference at prescan time) ───
  | {
      kind: "permission";
      tool: string;                      // "server.tool" format (e.g., "fq.write_document")
      decision: "allowed" | "denied";
      reason?: string;                   // populated for denials
    }

  // ─── Tool-call coercion path (Tier 2; per MCP Broker REQ-106) ───
  | {
      kind: "coerce";
      path: "structured_content" | "json_text" | "raw_string" | "is_error" | "passthrough";
      raw_summary?: string;              // human-readable summary of the raw CallToolResult
    }

  // ─── Task registry transition ───
  | {
      kind: "task";
      task_id: string;
      status: "running" | "completed" | "failed" | "cancelled";
      parent_id?: string;
      elapsed_ms: number;
    }

  // ─── AST position marker (sparse — only at conditionals, calls, fails) ───
  | {
      kind: "ast";
      node_kind: string;                 // "if" | "for_iter" | "tool_call" | "assignment" | "fail" | "exit"
      line: number;
      column: number;
    };

// Coerce a runtime Value to a SerializableValue. Drops `undefined` (not part
// of the Value union but defensive). Recursively normalizes nested objects
// and arrays. Booleans, strings, numbers, null pass through unchanged.
export function toSerializable(v: Value): SerializableValue {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(toSerializable);
  const out: { [key: string]: SerializableValue } = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = toSerializable(val as Value);
  }
  return out;
}
