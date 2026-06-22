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
// Tier 2 (Broker REQ-103..112) cells were deliberately EXCLUDED from the
// initial v1 of this manifest. Production broker support landed in
// parallel on 2026-05-19 (continue/break, _self, deep-probe _exists,
// CallToolResult coercion, brokered fail-fast, _exists, fq.search_tools,
// MacroNeedsUserInputError envelope). Tier 2 cells (MTF-*-1XX) were added
// on 2026-05-19 per §6.4 extension lifecycle steps 3 + 7. The Tier 2 cell
// numbers start at 100 to clearly distinguish them from Tier 1 cells
// (which use 0XX numbering).

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
  /**
   * Curated behavioral framing for this cell — the goal / preconditions /
   * tool surface / triggering condition / expected observable outcome that
   * the `flashquery-macro-testgen` wrapper instantiates into the behavioral
   * brief it hands `flashquery-macro-author`. OPTIONAL: when absent, the
   * wrapper synthesizes a brief from `description` + `source_citations` per
   * the few-shot examples in that skill's "Constructing the behavioral
   * brief" section. Prefer a curated `behavior` — instantiation beats
   * invention. Distinct from `description`, which stays a terse mechanical
   * label for the coverage matrix.
   */
  behavior?: string;
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
const TIER2_DATE = "2026-05-19";

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
    status: "planned",
    requires: {
      notes:
        "Fence parsing fires only when a macro is loaded via `source_ref` from a vault doc. The in-process macro framework loads from the YAML test's `macro:` field directly, so this surface isn't reachable here. Coverage belongs in directed/integration scenarios (e.g., T-Y-015's source_ref load path) and a small unit test against the fence-extractor module.",
    },
    added_in: TODAY,
  },
  {
    id: "MTF-G-009",
    category: "MTF-G",
    description:
      "DEPRECATED 2026-05-19 — replaced by MTF-G-010 (REQ-112c). The deferral lifted; production should now accept `true` / `false` as boolean literal keywords. See MTF-G-010 for the new positive coverage.",
    density_target: 0,
    source_citations: ["Macro-Lang-§3.3", "Broker-REQ-112c"],
    status: "deprecated",
    requires: {
      notes: "Cell retired when REQ-112c lifted the deferral. Coverage rolled into MTF-G-010.",
    },
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-G-010",
    category: "MTF-G",
    description:
      "REQ-112c: `true` / `false` boolean literals are first-class tokens. Parse in any position null parses (primary, object-literal value, comparison operand, if-condition, etc.). Internal boolean value identical to comparison-operator output. Lowercase only — matches null, JSON, Bash.",
    density_target: 10,
    source_citations: ["Broker-REQ-112c"],
    status: "actionable",
    added_in: "2026-05-19",
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
  {
    id: "MTF-S-009",
    category: "MTF-S",
    description:
      "Arithmetic builtins beyond add() — sub / mul / div / mod. Covers negative operands, integer-truncating division, float operands, and nested composition (e.g. mul (add 2 3) 4).",
    density_target: 10,
    source_citations: ["REQ-038"],
    status: "actionable",
    added_in: "2026-05-21",
  },
  {
    id: "MTF-S-010",
    category: "MTF-S",
    description:
      "Numeric comparison operators (`<`, `>`, `>=`, `<=`, etc.) on integer and float operands, including the pre-computed-operand grammar idiom and use in if-conditions.",
    density_target: 5,
    source_citations: ["REQ-015", "REQ-021"],
    status: "actionable",
    added_in: "2026-05-21",
  },
  {
    id: "MTF-S-011",
    category: "MTF-S",
    description:
      "`range` builtin and `..` range operator — basic, empty, and zero-length ranges. End-exclusive semantics (`0..5` → [0,1,2,3,4]; `range 5` → [0..4]).",
    density_target: 5,
    source_citations: ["REQ-014", "REQ-038"],
    status: "actionable",
    added_in: "2026-05-21",
  },
  {
    id: "MTF-S-101",
    category: "MTF-S",
    description:
      "REQ-112b: `if`/`else` branches do NOT introduce a new variable scope. Variables newly-assigned inside a body that runs persist after `fi`. Untaken-branch assignments leave the name undefined (no phantom default). Overrides archived Macro Lang REQ-019 ac3.",
    density_target: 10,
    source_citations: ["Broker-REQ-112b"],
    status: "actionable",
    added_in: "2026-05-19",
  },
  {
    id: "MTF-S-102",
    category: "MTF-S",
    description:
      "REQ-112d: leaf-access on a missing key of a present object returns null (lenient). Chained access through the resulting null still throws per REQ-023 ac2. Composes with truthiness so authors can write `if $obj.maybe == null then ...` guards.",
    density_target: 10,
    source_citations: ["Broker-REQ-112d"],
    status: "actionable",
    added_in: "2026-05-19",
  },

  // ─── MTF-S §14 data builtins ─────────────────────────────────────────
  // The ten general-purpose collection builtins (Graph-EDI §14.3): filter,
  // sort, first, last, keys, contains, join, map, any, all. One cell per
  // builtin family; each exercises positive paths and negatives at BOTH
  // validation tiers (preflight → invalid_input; runtime → tool_call_failed).
  {
    id: "MTF-S-200",
    category: "MTF-S",
    description:
      "§14.3.1 `filter $list $field $op $value` — subset a list of objects. Positive: all six operators (==/!=/</>/<=/>=), nested dotted-field resolution, missing-field-null comparison, empty-input → [], dynamic (variable) operator runtime path. Negative — preflight tier (invalid_input): wrong arity, named arg, literal bad operator. Negative — runtime tier (tool_call_failed): dynamic bad operator, non-list operand (filter_type_mismatch), ordering on non-numeric (comparison_type_mismatch), non-object row (invalid_field_target).",
    density_target: 15,
    source_citations: ["Graph-EDI-§14.3.0", "Graph-EDI-§14.3.1"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-201",
    category: "MTF-S",
    description:
      "§14.3.2 `sort $list $field $direction` — stable, non-mutating. asc/desc numeric, lexicographic string, NULLS LAST (null/missing field sorts to end both directions). Negatives — preflight: arity, named, literal bad direction, literal non-string field. Runtime: dynamic bad direction (sort_direction_invalid), non-list (sort_type_mismatch), mixed/non-scalar field values (sort_field_type_mismatch).",
    density_target: 12,
    source_citations: ["Graph-EDI-§14.3.0", "Graph-EDI-§14.3.2"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-202",
    category: "MTF-S",
    description:
      "§14.3.3 `first $list` → item|null. Positive, empty→null. Negatives: arity (preflight first_argument_count), non-list (runtime first_type_mismatch).",
    density_target: 4,
    source_citations: ["Graph-EDI-§14.3.3"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-203",
    category: "MTF-S",
    description:
      "§14.3.4 `last $list` → item|null. Positive, empty→null. Negatives: arity (preflight last_argument_count), non-list (runtime last_type_mismatch).",
    density_target: 4,
    source_citations: ["Graph-EDI-§14.3.4"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-204",
    category: "MTF-S",
    description:
      "§14.3.5 `keys $object` → list of strings (insertion order). Positive, empty {}→[]. Negatives: arity (preflight keys_argument_count), non-record (runtime keys_type_mismatch).",
    density_target: 4,
    source_citations: ["Graph-EDI-§14.3.5"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-205",
    category: "MTF-S",
    description:
      "§14.3.6 `contains $list $value` → boolean. Recursive deepEqual membership (incl. objects). Positive true/false, empty→false. Negatives: arity (preflight contains_argument_count), non-list (runtime contains_type_mismatch).",
    density_target: 6,
    source_citations: ["Graph-EDI-§14.3.6"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-206",
    category: "MTF-S",
    description:
      "§14.3.7 `join $list $separator` → string. No implicit stringification. Positive, empty→\"\". Negatives — preflight: arity, literal non-string separator (join_separator_type). Runtime: dynamic non-string separator, non-list (join_type_mismatch), non-string element (join_element_type).",
    density_target: 8,
    source_citations: ["Graph-EDI-§14.3.0", "Graph-EDI-§14.3.7"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-207",
    category: "MTF-S",
    description:
      "§14.3.8 `map $list $field` → list. Length-preserving projection; missing field→null; dotted nested paths. Positive, empty→[]. Negatives: arity (preflight map_argument_count), non-list (runtime map_type_mismatch), non-object row (runtime invalid_field_target).",
    density_target: 8,
    source_citations: ["Graph-EDI-§14.3.8"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-208",
    category: "MTF-S",
    description:
      "§14.3.9 `any $list $field $op $value` → boolean. Short-circuits; empty→false. Same field/op/comparison rules as filter. Negatives — preflight: arity, literal bad op (any_operator_invalid). Runtime: dynamic bad op, non-list (any_type_mismatch), comparison_type_mismatch.",
    density_target: 8,
    source_citations: ["Graph-EDI-§14.3.0", "Graph-EDI-§14.3.9"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-209",
    category: "MTF-S",
    description:
      "§14.3.10 `all $list $field $op $value` → boolean. Short-circuits; empty→true (vacuous). Same field/op/comparison rules as filter. Negatives — preflight: arity, literal bad op (all_operator_invalid). Runtime: non-list (all_type_mismatch).",
    density_target: 7,
    source_citations: ["Graph-EDI-§14.3.0", "Graph-EDI-§14.3.10"],
    status: "actionable",
    added_in: "2026-06-22",
  },
  {
    id: "MTF-S-210",
    category: "MTF-S",
    description:
      "§14.3.0 reason-code renames — the four pre-existing outliers normalized: sub arity→sub_argument_count, unique non-list→unique_type_mismatch, append non-list→append_type_mismatch, range non-integer→range_type_mismatch. All surface as runtime tool_call_failed with the new reason.",
    density_target: 4,
    source_citations: ["Graph-EDI-§14.3.0"],
    status: "actionable",
    added_in: "2026-06-22",
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
    status: "planned",
    requires: {
      notes:
        "Native fq dispatch (fq.write_document, fq.get_document, fq.search_tools etc.) needs real Supabase + handler wiring per the framework's §5.7 design. The framework currently stubs `fq` as an empty server. Coverage belongs in integration scenarios; MTF-D-104 already covers the search_tools shape via a brokered emulation.",
    },
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
    status: "planned",
    requires: {
      notes:
        "Cancellation requires an external signal (e.g., a `cancel_task` call from a sibling MCP request) to interrupt the running macro. The framework runs macros to completion in-process; no cross-invocation cancellation harness exists. Coverage belongs in directed scenarios that wire two concurrent invocations + the cancel path, or a unit test against the cancellation-token plumbing.",
    },
    added_in: TODAY,
  },
  {
    id: "MTF-L-010",
    category: "MTF-L",
    description:
      "input_var `--default` value fires when the caller omits the input — the macro runs with the declared default rather than failing the contract.",
    density_target: 5,
    source_citations: ["REQ-053", "REQ-058"],
    status: "actionable",
    added_in: "2026-05-21",
  },
  {
    id: "MTF-L-011",
    category: "MTF-L",
    description:
      "input_var `--default` is overridden when the caller supplies a value — the supplied value wins over the declared default.",
    density_target: 5,
    source_citations: ["REQ-053", "REQ-058"],
    status: "actionable",
    added_in: "2026-05-21",
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
  {
    id: "MTF-E-008",
    category: "MTF-E",
    description:
      "input_var contract violations — a required input the caller never supplied, multiple missing required inputs at once, and a non-literal `--default` expression being rejected.",
    density_target: 5,
    source_citations: ["REQ-058", "REQ-054"],
    status: "actionable",
    added_in: "2026-05-21",
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
    status: "planned",
    requires: {
      notes:
        "Session-scoped task visibility requires two distinct MCP sessions invoking `list_tasks` and verifying cross-session task records don't leak. The framework runs single-invocation in-process tests; multi-session isolation is a directed/integration scenario concern.",
    },
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
    description: "assert_golden_state_notes load-time integrity check",
    density_target: 5,
    source_citations: ["MTF Framework §5.4", "REQ-051"],
    status: "actionable",
    added_in: TODAY,
  },

  // ─── Tier 2 cells (MTF-*-1XX) — Broker REQ-103..112 + adjacent ───────
  //
  // Added 2026-05-19 per §6.4 lifecycle steps 3 + 7 when the production
  // MCP Broker macro-engine extensions shipped. The golden has supported
  // these since v0.3.0; production is catching up. Each cell carries
  // Broker-REQ-NNN provenance.

  // ─── MTF-C-1XX — Control-flow Tier 2 (continue / break) ─────────────
  {
    id: "MTF-C-101",
    category: "MTF-C",
    description: "for-loop with `continue` skipping selected iterations",
    density_target: 10,
    source_citations: ["Broker-REQ-104"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-C-102",
    category: "MTF-C",
    description: "while-loop with `break` on threshold condition",
    density_target: 10,
    source_citations: ["Broker-REQ-104"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-C-103",
    category: "MTF-C",
    description: "Nested loops with continue affecting only the inner loop",
    density_target: 5,
    source_citations: ["Broker-REQ-104"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-C-104",
    category: "MTF-C",
    description: "`continue` / `break` outside any loop raises loop_control_outside_loop",
    density_target: 5,
    source_citations: ["Broker-REQ-104"],
    status: "actionable",
    added_in: TIER2_DATE,
  },

  // ─── MTF-D-1XX — Dispatch Tier 2 (broker coercion, fail-fast,
  //                                  search_tools, help sentinel) ───────
  {
    id: "MTF-D-101",
    category: "MTF-D",
    description: "Brokered isError=true triggers fail-fast (REQ-107) — bound value never set",
    density_target: 10,
    source_citations: ["Broker-REQ-106", "Broker-REQ-107"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-D-102",
    category: "MTF-D",
    description: "Brokered fail-fast surfaces as tool_call_failed envelope (not macro_aborted)",
    density_target: 5,
    source_citations: ["Broker-REQ-107"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-D-103",
    category: "MTF-D",
    description: "Argument-passthrough invariant — primitive args bit-exact (REQ-108)",
    density_target: 5,
    source_citations: ["Broker-REQ-108"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-D-104",
    category: "MTF-D",
    description: "fq.search_tools invocation returns SearchResult envelopes (REQ-082..087)",
    density_target: 10,
    source_citations: ["Broker-REQ-082", "Broker-REQ-083", "Broker-REQ-085"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-D-105",
    category: "MTF-D",
    description:
      "DEPRECATED — `help: true` sentinel forwarding (REQ-093/098) is scoped to delegated/host MCP callers, not macros. Verification belongs at the broker layer (unit + delegated-call scenario), not the macro test surface.",
    density_target: 0,
    source_citations: ["Broker-REQ-093", "Broker-REQ-098", "Broker-REQ-060"],
    status: "deprecated",
    requires: {
      notes:
        "Retired 2026-05-19. REQ-098 reads: 'When a delegated or host model calls a brokered tool with help: true ...' — the macro frame is not in scope. Replacement coverage lives at tests/unit/broker/ + an integration scenario.",
    },
    added_in: TIER2_DATE,
  },

  // ─── MTF-E-1XX — Error taxonomy Tier 2 (needs_user_input fifth) ─────
  // Per REQ-060 there are EXACTLY two spec-valid emitters of
  // needs_user_input: (a) FQ-native tools, (b) the broker layer itself
  // on TOFU drift. Brokered tools returning event:needs_user_input in
  // their CallToolResult are explicitly forbidden. These cells cover
  // route (b) — TOFU-drift detection during a brokered dispatch
  // propagating through the macro engine as the fifth termination.
  {
    id: "MTF-E-101",
    category: "MTF-E",
    description:
      "Broker-emitted needs_user_input from TOFU drift during brokered dispatch propagates as macro-level fifth termination (REQ-105 nested propagation; REQ-041/042 + REQ-060)",
    density_target: 10,
    source_citations: ["Broker-REQ-105", "Broker-REQ-041", "Broker-REQ-042", "Broker-REQ-060"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-E-102",
    category: "MTF-E",
    description:
      "TOFU-drift envelope carries spec-shape payload (event: schema_drift_detected, server, tool, old_schema, new_schema, diff_summary) per REQ-042",
    density_target: 5,
    source_citations: ["Broker-REQ-105", "Broker-REQ-042"],
    status: "actionable",
    added_in: TIER2_DATE,
  },

  // ─── MTF-I-1XX — Isolation Tier 2 (_self binding via source_ref) ─────
  {
    id: "MTF-I-101",
    category: "MTF-I",
    description: "_self.path / .frontmatter / .title / .tags / .fq_id accessible when bound",
    density_target: 10,
    source_citations: ["Broker-REQ-103"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-I-102",
    category: "MTF-I",
    description: "_self access without binding raises spec-mandated runtime error",
    density_target: 5,
    source_citations: ["Broker-REQ-103"],
    status: "actionable",
    added_in: TIER2_DATE,
  },

  // ─── MTF-L-1XX — Lifecycle Tier 2 (_exists() deep-probe + 250ms) ─────
  {
    id: "MTF-L-101",
    category: "MTF-L",
    description: "_exists() deep-probe with 250ms timeout returns boolean (REQ-110/112)",
    density_target: 5,
    source_citations: ["Broker-REQ-110", "Broker-REQ-112"],
    status: "actionable",
    added_in: TIER2_DATE,
  },
  {
    id: "MTF-L-102",
    category: "MTF-L",
    description:
      "REQ-112a ac1: `_exists()` (introspection methods) MUST be usable in any expression position — inside `&&` / `||` operands, after `!`, as object-literal value, etc. — without requiring an intermediate assignment.",
    density_target: 5,
    source_citations: ["Broker-REQ-112a"],
    status: "actionable",
    added_in: "2026-05-19",
  },
  {
    id: "MTF-L-103",
    category: "MTF-L",
    description:
      "REQ-112a ac2: VarRef-prefixed server slot (`$svc_name._exists()`) resolves the variable to a server-name string at call time and probes that server. Allowed for introspection methods only per ac3.",
    density_target: 5,
    source_citations: ["Broker-REQ-112a"],
    status: "actionable",
    added_in: "2026-05-19",
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
