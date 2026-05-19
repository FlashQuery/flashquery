// Coverage manifest for the macro testing framework.
//
// Source of truth for the MTF-* cell list. Each test YAML's `covers:`
// declaration must reference cell IDs that exist here. The rendering tool
// (`coverage/render.ts`) reads this file plus the test corpus and emits
// `coverage.json` + `MTF_COVERAGE.md` + `MTF_INTERACTIONS.md`.
//
// Authoring rules (per Macro Testing Framework Requirements §9.4 + §6.4):
//
//   - Cells covering shipped Tier 1 features (Macro Language REQ-001..063)
//     land as `status: actionable` with no `requires` block.
//   - Cells covering future / not-yet-implemented features land as
//     `status: planned` with a `requires` block describing the gate
//     (golden_version floor, feature_flag, notes). Generator targets only
//     actionable cells; planned cells appear in MTF_COVERAGE.md as
//     zero-density planning signal.
//   - `source_citations` should point at user-guide sections once those
//     exist (per §11.3); REQ-NNN strings from the Macro Language
//     Requirements doc are an acceptable fallback for now.
//   - `density_target`: 5 for typical cells, 10 for cross-cutting /
//     load-bearing behaviors that warrant deeper coverage.
//   - `added_in`: ISO date the cell entered the manifest.
//
// Tier 2 (Broker REQ-103..112) cells are deliberately EXCLUDED from this
// initial v1 of the manifest. Production broker support is landing today
// in parallel; Tier 2 cells will be added in a follow-up phase once the
// engine's broker surface is stable to test against. The current 13
// pilots exercise only Tier 1 patterns.

export type CellStatus = "actionable" | "planned" | "blocked" | "deprecated";

export type CellRequires = {
  golden_version?: string;
  feature_flag?: string;
  notes?: string;
};

export type Cell = {
  /** Stable cell identifier, e.g. "MTF-G-001". Used by test `covers:` arrays. */
  id: string;
  /** Category prefix, e.g. "MTF-G". One of MTF-G/S/C/D/L/E/I/FW per §5.3. */
  category: string;
  /** One-line human-readable description of what the cell exercises. */
  description: string;
  /** Target test count for this cell; surfaces low-density cells to the generator. */
  density_target: number;
  /** REQ-NNN or guide-section refs (per §9.4 / §11.3). */
  source_citations: string[];
  /** Lifecycle status per §6.4. Tier 1 cells start `actionable`. */
  status: CellStatus;
  /** Gating preconditions for non-actionable cells. Omit when status=actionable. */
  requires?: CellRequires;
  /** ISO date this cell entered the manifest. */
  added_in: string;
};

const TODAY = "2026-05-18";

export const CELLS: Cell[] = [
  // ─── MTF-G — Surface grammar ─────────────────────────────────────────
  // Line-oriented tokens, literals, identifier rules, interpolation.
  // Verifies the "doesn't look like Lisp" surface invariant.
  {
    id: "MTF-G-001",
    category: "MTF-G",
    description: "String literal with $var interpolation",
    density_target: 10,
    source_citations: ["REQ-008", "REQ-018"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-002",
    category: "MTF-G",
    description: "Number literal (integer)",
    density_target: 5,
    source_citations: ["REQ-008"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-003",
    category: "MTF-G",
    description: "List literal",
    density_target: 5,
    source_citations: ["REQ-008", "REQ-019"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-004",
    category: "MTF-G",
    description: "Object literal",
    density_target: 5,
    source_citations: ["REQ-008", "REQ-020"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-005",
    category: "MTF-G",
    description: "exit statement carrying an object value",
    density_target: 5,
    source_citations: ["REQ-022", "REQ-024"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-006",
    category: "MTF-G",
    description: "Line-comment (`#`) tokenization",
    density_target: 5,
    source_citations: ["REQ-007"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-007",
    category: "MTF-G",
    description: "Identifier rules and reserved-keyword rejection",
    density_target: 5,
    source_citations: ["REQ-009", "REQ-010"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-G-008",
    category: "MTF-G",
    description: "Fence-attribute parsing (`fqm name=...`)",
    density_target: 5,
    source_citations: ["REQ-005", "REQ-006"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-S — Evaluator semantics ─────────────────────────────────────
  // Scope, walk-up, truthiness, interpolation, field access, builtins.
  {
    id: "MTF-S-001",
    category: "MTF-S",
    description: "Walk-up scope on outer-declared variable",
    density_target: 10,
    source_citations: ["REQ-021", "REQ-038"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-002",
    category: "MTF-S",
    description: "Iterator variable shadowing in loop body",
    density_target: 5,
    source_citations: ["REQ-013", "REQ-021"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-003",
    category: "MTF-S",
    description: "Arithmetic via add() builtin (binary)",
    density_target: 5,
    source_citations: ["REQ-038"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-004",
    category: "MTF-S",
    description: "Outer-scope counter mutation inside while loop",
    density_target: 5,
    source_citations: ["REQ-012", "REQ-021"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-005",
    category: "MTF-S",
    description: "Multi-positional add() across three values",
    density_target: 5,
    source_citations: ["REQ-038"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-006",
    category: "MTF-S",
    description: "Walk-up scope under nested loops",
    density_target: 10,
    source_citations: ["REQ-013", "REQ-021"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-007",
    category: "MTF-S",
    description: "Field access (`$var.field`) on object values",
    density_target: 5,
    source_citations: ["REQ-020", "REQ-021"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-S-008",
    category: "MTF-S",
    description: "Truthiness rules (null, empty, zero) in if-conditions",
    density_target: 5,
    source_citations: ["REQ-015", "REQ-021"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-C — Control flow ────────────────────────────────────────────
  // for/while/if/fail/exit; fall-off semantics.
  {
    id: "MTF-C-001",
    category: "MTF-C",
    description: "for-loop iteration over numeric range",
    density_target: 10,
    source_citations: ["REQ-013", "REQ-014"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-002",
    category: "MTF-C",
    description: "for-loop with mid-iteration abort via fail()",
    density_target: 5,
    source_citations: ["REQ-013", "REQ-016", "REQ-024"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-003",
    category: "MTF-C",
    description: "if/then/fi conditional (no else branch)",
    density_target: 5,
    source_citations: ["REQ-015"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-004",
    category: "MTF-C",
    description: "fail() builtin raises macro_aborted envelope",
    density_target: 5,
    source_citations: ["REQ-016", "REQ-024"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-005",
    category: "MTF-C",
    description: "while-loop iteration with mutated condition",
    density_target: 5,
    source_citations: ["REQ-012"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-006",
    category: "MTF-C",
    description: "while-loop with fail() termination",
    density_target: 5,
    source_citations: ["REQ-012", "REQ-016"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-007",
    category: "MTF-C",
    description: "Nested for-loop iteration counting",
    density_target: 10,
    source_citations: ["REQ-013"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-008",
    category: "MTF-C",
    description: "if/then/else/fi conditional (both branches)",
    density_target: 5,
    source_citations: ["REQ-015"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-C-009",
    category: "MTF-C",
    description: "exit with structured return_result",
    density_target: 5,
    source_citations: ["REQ-022"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-D — Tool dispatch surface ───────────────────────────────────
  // Native builtins, shell verbs, brokered MCP bindings, coercion paths.
  {
    id: "MTF-D-001",
    category: "MTF-D",
    description: "Brokered-tool dispatch (basic single call)",
    density_target: 10,
    source_citations: ["REQ-027", "REQ-028"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-002",
    category: "MTF-D",
    description: "Multi-server dispatch within one macro",
    density_target: 5,
    source_citations: ["REQ-027", "REQ-029"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-003",
    category: "MTF-D",
    description: "Binding tool-call result into a local variable",
    density_target: 5,
    source_citations: ["REQ-027"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-004",
    category: "MTF-D",
    description: "CallToolResult coercion path 1 (object via JSON text)",
    density_target: 5,
    source_citations: ["REQ-027"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-005",
    category: "MTF-D",
    description: "CallToolResult coercion path 2 (structuredContent)",
    density_target: 5,
    source_citations: ["REQ-027"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-006",
    category: "MTF-D",
    description: "CallToolResult coercion path 3 (JSON-text fallback)",
    density_target: 5,
    source_citations: ["REQ-027"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-007",
    category: "MTF-D",
    description: "CallToolResult coercion path 4 (raw string)",
    density_target: 5,
    source_citations: ["REQ-027"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-008",
    category: "MTF-D",
    description: "ScriptedTool archetype dispatch (per §5.7)",
    density_target: 5,
    source_citations: ["REQ-027"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-009",
    category: "MTF-D",
    description: "Native fq builtin invocation from macro",
    density_target: 5,
    source_citations: ["REQ-030"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-D-010",
    category: "MTF-D",
    description: "Shell-verb dispatch within vault jail",
    density_target: 5,
    source_citations: ["REQ-041", "REQ-042"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-L — Execution lifecycle ─────────────────────────────────────
  // Dry-run vs. real-run, trace structure, progress, cancellation.
  {
    id: "MTF-L-001",
    category: "MTF-L",
    description: "Dry-run envelope shape (input_var + tool inventory)",
    density_target: 10,
    source_citations: ["REQ-053"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-002",
    category: "MTF-L",
    description: "input_var contract collection (required + optional)",
    density_target: 5,
    source_citations: ["REQ-053", "REQ-058"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-003",
    category: "MTF-L",
    description: "Dry-run tool/server reference deduplication",
    density_target: 5,
    source_citations: ["REQ-053"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-004",
    category: "MTF-L",
    description: "Dry-run does not invoke the broker layer",
    density_target: 5,
    source_citations: ["REQ-053"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-005",
    category: "MTF-L",
    description: "trace_mode=summary strips args/result detail",
    density_target: 5,
    source_citations: ["REQ-050", "REQ-051"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-006",
    category: "MTF-L",
    description: "trace_mode passthrough to evaluator",
    density_target: 5,
    source_citations: ["REQ-050"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-007",
    category: "MTF-L",
    description: "Deeply nested for-loops (elaborate trace structure)",
    density_target: 5,
    source_citations: ["REQ-013", "REQ-050"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-008",
    category: "MTF-L",
    description: "Progress emission cadence during long iteration",
    density_target: 5,
    source_citations: ["REQ-052"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-L-009",
    category: "MTF-L",
    description: "Cancellation between iterations propagates cleanly",
    density_target: 5,
    source_citations: ["REQ-049", "REQ-052"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-E — Error taxonomy ──────────────────────────────────────────
  // Every envelope shape and reason code per REQ-054.
  {
    id: "MTF-E-001",
    category: "MTF-E",
    description: "unknown_server error code from prescan",
    density_target: 5,
    source_citations: ["REQ-028", "REQ-054"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-E-002",
    category: "MTF-E",
    description: "Prescan reject path (REQ-028 unknown-server)",
    density_target: 5,
    source_citations: ["REQ-028", "REQ-031"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-E-003",
    category: "MTF-E",
    description: "Intentional mismatch path (comparator divergence self-test)",
    density_target: 5,
    source_citations: ["REQ-054"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-E-004",
    category: "MTF-E",
    description: "macro_aborted envelope from fail()",
    density_target: 5,
    source_citations: ["REQ-016", "REQ-024", "REQ-054"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-E-005",
    category: "MTF-E",
    description: "parse_error envelope shape (REQ-018 details)",
    density_target: 5,
    source_citations: ["REQ-018", "REQ-054"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-E-006",
    category: "MTF-E",
    description: "unknown_tool error from forbidden-tool prescan",
    density_target: 5,
    source_citations: ["REQ-031", "REQ-054"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-E-007",
    category: "MTF-E",
    description: "vault_jail_violation error from shell verb",
    density_target: 5,
    source_citations: ["REQ-042", "REQ-054"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-I — Isolation & caller identity ─────────────────────────────
  // Per-invocation state, input_var contract, _self binding.
  {
    id: "MTF-I-001",
    category: "MTF-I",
    description: "Per-invocation input_var contract enforcement",
    density_target: 10,
    source_citations: ["REQ-058", "REQ-059"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-I-002",
    category: "MTF-I",
    description: "_self surface via input_vars (Tier 1 workaround)",
    density_target: 5,
    source_citations: ["REQ-058"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-I-003",
    category: "MTF-I",
    description: "Repeated invocation independence (no state leak)",
    density_target: 5,
    source_citations: ["REQ-059", "REQ-060"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-I-004",
    category: "MTF-I",
    description: "Session-scoped task visibility (caller identity)",
    density_target: 5,
    source_citations: ["REQ-049", "REQ-060"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── MTF-FW — Framework self-test cells ──────────────────────────────
  // Cells that exercise the framework's own machinery rather than the
  // macro engine. Useful for guarding the harness itself.
  {
    id: "MTF-FW-001",
    category: "MTF-FW",
    description: "Failure-record writer integration (gated to true FAILs)",
    density_target: 5,
    source_citations: ["MTF Framework §9.6"],
    status: "actionable",
    added_in: TODAY,
  },
  {
    id: "MTF-FW-002",
    category: "MTF-FW",
    description: "expect_state_notes load-time integrity check",
    density_target: 5,
    source_citations: ["MTF Framework §5.4", "REQ-051"],
    status: "actionable",
    added_in: TODAY,
  },
];

/** Lookup helper: returns the cell with the given ID, or undefined. */
export function getCell(id: string): Cell | undefined {
  return CELLS.find((c) => c.id === id);
}

/** Lookup helper: returns all cells in the given category, sorted by ID. */
export function getCellsByCategory(category: string): Cell[] {
  return CELLS.filter((c) => c.category === category).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** All known categories present in the manifest, in canonical §5.3 order. */
export const CATEGORIES: string[] = [
  "MTF-G",
  "MTF-S",
  "MTF-C",
  "MTF-D",
  "MTF-L",
  "MTF-E",
  "MTF-I",
  "MTF-FW",
];
