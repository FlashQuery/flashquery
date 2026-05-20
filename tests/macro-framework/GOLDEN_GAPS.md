---
status: active
fq_title: Macro Golden Model Gaps — Discovered via Macro Testing Framework
fq_status: active
fq_tags:
  - '#pipeline/ready-for-dev'
  - '#type/gap-analysis'
  - '#scope/golden-model'
fq_created: '2026-05-19T00:00:00+00:00'
fq_updated: '2026-05-19T00:00:00+00:00'
fq_id: macro-framework-golden-gaps
---

# Macro Golden Model Gaps — Discovered via Macro Testing Framework

This document tracks **real spec-compliance gaps in the macro golden model** (`tests/macro-framework/macro-golden-model/`) discovered through test runs of the Macro Testing Framework. These are NOT production bugs and NOT AI-prediction errors — they are concrete deviations between the canonical specification and the golden model that's supposed to encode the spec as an independent oracle.

Each gap is filed so it can be fixed in the golden, the framework can re-validate the fix, and our reconciliation gate keeps its signal sharp. When the golden disagrees with both production AND the spec, the golden has the bug — and "the golden is the spec's reference implementation" is only true if we keep it that way.

Source documents this gap log references:

- [`FlashQuery Macro Language Requirements.md`](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md) — REQ-001..063 (archived, canonical for shipped macro engine)
- [`MCP Broker Requirements.md`](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md) — REQ-103..118 macro-engine extensions
- Macro Testing Framework requirements: [`tests/macro-framework/`](.)
- Eval log (discovery context): [`_skill-eval-log.md`](_skill-eval-log.md)
- Sister doc — production gaps: [`PRODUCTION_GAPS.md`](PRODUCTION_GAPS.md)

## How this document works

Each entry uses a `Gap GG-NNN` numbered ID (GG = Golden Gap). The structure mirrors `PRODUCTION_GAPS.md` but the corrective action lands in the golden model, not in production.

The gap title identifies the LLM that authored the analysis, using the form `Gap GG-NNN: <Model/Version> - <short descriptive title>`. If multiple models analyze the same gap, append their findings as additional analyses rather than replacing earlier ones.

Workflow:

1. **Discovery** — the reconciliation gate in the macro testing framework surfaces a divergence where AI + Production agree but Golden dissents. After spec verification, if the golden is the lagging implementation, it lands here.
2. **Fix in the golden model** — edit `macro-golden-model/src/...` to bring the golden into spec compliance. Fill in `Resolution`.
3. **Validation** — re-run `captureSnapshot()` against the discovery pilot(s) and confirm reconciliation goes clean. Mark `Resolution - Complete`.
4. **Post-Implementation Retest** — append a final subsection summarising the retest evidence and CLOSED status.

A gap stays open until both the golden's source AND the discovery pilot's reconciliation block agree the fix has landed.

## Gap Entry Template

```md
## Gap GG-NNN: <Model/Version> - Short Descriptive Title

### Discovered By

Reference to the pilot(s) that surfaced this gap (path, test run date, divergence kind such as `AI+Production ⊥ Golden`).

### Requirement

The REQ(s) / INV(s) / spec section the golden's behavior violates. Quote the relevant acceptance criteria text.

### Implementation Evidence

Concrete evidence from the golden source — file paths, line numbers, the offending rule/conversion/evaluator path. Cite the test pilot's captured envelope (golden) vs. the divergent expected envelope (AI + production).

### Reasoning

Why this is a real golden gap rather than a production bug or framework limitation. Include the spec-text quote that pins the correct behavior and the impact on future pilots.

### Proposed Changes

- Golden source change(s) with file paths and rule/function names
- Affected pilot(s): which reconciliation block(s) flip from divergent to clean
- Any AST / type / evaluator changes
- Documentation: framework README, eval-log entries

### Resolution

(To be filled when the golden fix lands.) Description of the fix, files touched, behavior now in place.

### Resolution - Complete

(To be filled when the framework re-captures and the reconciliation gate is clean.) Verified with the targeted capture command + the full framework suite.

### Post-Implementation Retest

(To be filled when an auditor pass confirms closure.) Per-correction status table, evidence, and final CLOSED stamp.
```

---

## Gap GG-001: Claude/Opus 4.7 - `objectEntry` Value Position Rejects Pipelines; REQ-011 ac4

### Discovered By

- **Pilot:** [`cases/dispatch/920-smoke-items-pipeline.yml`](cases/dispatch/920-smoke-items-pipeline.yml)
- **Test run date:** 2026-05-19
- **Divergence kind:** `AI+Production ⊥ Golden` (AI prediction matched production output; the golden's parser rejected the macro outright with `parse_error`)

The golden's `captureSnapshot()` failed at parse time with `parse_error / unexpected_token` near `count` on the line `completed_count: count $done_items`. Production parses the same macro cleanly, executes it, and returns a structured summary object. After spec verification, the golden is the lagging implementation: production matches REQ-011 ac4, the golden's grammar is too restrictive.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.2.3 REQ-011 — Numeric, string, and value-literal grammar](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> **REQ-011 ac4.** "Object literals MUST accept `{ key: value, ... }`, the empty object `{}`, and trailing commas. Keys are bare identifiers (e.g., `entity_type`) OR string literals (e.g., `\"entity-type\"`). **Values are any expression.**"

The phrase "any expression" is the load-bearing clause. Per the macro language's expression grammar (REQ-012 through REQ-016 and the pipeline form REQ-018), pipelines like `count $list`, `lower $title`, and any builtin-call composition are expressions and are therefore valid in the value position of an object literal entry.

### Implementation Evidence

Golden parser's `objectEntry` rule — [`macro-golden-model/src/parser.ts:340-348`](macro-golden-model/src/parser.ts):

```ts
private objectEntry = this.RULE("objectEntry", () => {
  this.OR([
    { ALT: () => this.CONSUME(Identifier) },
    { ALT: () => this.CONSUME(DoubleQuotedString) },
    { ALT: () => this.CONSUME(SingleQuotedString) },
  ]);
  this.CONSUME(Colon);
  this.SUBRULE(this.primary);   // <-- offending rule: value is `primary`, not `rhsExpr`
});
```

`primary` covers literals, varOrField, listLit, objectLit, parenthesized expressions, and toolCall in primary position — but does NOT include pipelines. Pipelines live one level up in `rhsExpr`:

```ts
private rhsExpr = this.RULE("rhsExpr", () => {
  this.OR([
    { /* toolCall — server.tool(...) */ },
    { GATE: () => this.LA(1).tokenType === Identifier,
      ALT: () => this.SUBRULE(this.pipeline) },     // <-- pipelines live here
    { ALT: () => this.SUBRULE(this.exprWithOps) },
  ]);
});
```

Conversion site at [`macro-golden-model/src/parser.ts:680-696`](macro-golden-model/src/parser.ts) expects the `primary` CstNode and calls `convertPrimary`:

```ts
function convertObjectEntry(node: CstNode): ObjectEntry {
  ...
  const primaryCst = getRule(node, "primary")!;
  return { key, value: convertPrimary(primaryCst) };
}
```

AST type at [`macro-golden-model/src/types.ts:156-159`](macro-golden-model/src/types.ts) is **already** broad enough:

```ts
export type ObjectEntry = {
  key: string;
  value: Expr;
};
```

`Expr` is the broad union that includes `Pipeline`, `ToolCall`, `BinaryOp`, etc. The doc comment above it (line 148-150) even says "Values are arbitrary expressions, so a literal can include $var references, nested objects, lists, or even tool calls." So the type and the spec already agree — only the parser grammar/conversion are too narrow.

Evaluator at [`macro-golden-model/src/evaluator.ts:1291-1297`](macro-golden-model/src/evaluator.ts) delegates each entry's value to `evalExpr`, which handles any `Expr` shape:

```ts
case "ObjectLit": {
  const out: Record<string, Value> = {};
  for (const entry of expr.entries) {
    out[entry.key] = await evalExpr(entry.value, env, builtins, tools, ctx);
  }
  return out;
}
```

So the only gap is at parse time. The runtime already handles the spec-compliant case.

Captured pilot envelopes — production (spec-correct) vs. golden (current):

| Field | Production runtime (spec-correct per REQ-011 ac4) | Golden `captureSnapshot()` (current, rejects valid macro) |
|---|---|---|
| `outcome` | `success` | `parse_error` |
| `return_result` | `{ completed: [...], deferred: [...], completed_count: 2, deferred_count: 1 }` | n/a — parse failed |
| `error.code` | n/a | `parse_error` |
| `error.details.reason` | n/a | `unexpected_token` |

### Reasoning

This is a direct contract violation of REQ-011 ac4 ("Values are any expression"). The golden's grammar narrows the value position to `primary`, excluding the pipeline form that the spec explicitly authorizes.

Three concrete impacts:

1. **The golden rejects spec-correct macros.** Any macro that uses a pipeline (`count $list`, `lower $title`, `concat "..."`) in the value position of an object literal — which is the natural way to build summary objects — fails the golden's parser. Production accepts these, the spec authorizes them, only the golden balks.

2. **It forces an unnatural authoring pattern.** The workaround is to pre-compute pipeline values into named variables: `completed_count = count $done_items` … `exit { completed_count: $completed_count }`. That's a stylistic constraint the framework imposes, not one the language imposes. Macros generated by the author skill in calibration mode produce the natural form; the framework then has to either re-train the skill against a non-spec constraint or post-process every macro.

3. **It weakens the reconciliation gate's signal.** Each "known golden gap we're working around" is a finding we have to mentally subtract from the gate's output. We just put real teeth on the gate by closing PG-001 and aligning pilot 912 with the spec; letting golden gaps accumulate degrades the gate's value as a quality signal. Future smoke tests in summary-object territory (string manipulation, slug building, multi-stat aggregation) will keep tripping over this until it's fixed.

The fix is minimal — one grammar rule, one conversion call site. No AST changes (the type is already `Expr`). No evaluator changes (already delegates to `evalExpr`).

### Proposed Changes

- **Golden parser — grammar rule** ([`macro-golden-model/src/parser.ts:347`](macro-golden-model/src/parser.ts) in `objectEntry`): change `this.SUBRULE(this.primary)` to `this.SUBRULE(this.rhsExpr)`. `rhsExpr` is the broadest expression rule and is what `Binding` (assignment RHS) uses, which matches the spec's "any expression" wording.

- **Golden parser — conversion** ([`macro-golden-model/src/parser.ts:694-695`](macro-golden-model/src/parser.ts) in `convertObjectEntry`): change `getRule(node, "primary")` to `getRule(node, "rhsExpr")` and `convertPrimary(primaryCst)` to `convertRhsExpr(rhsCst)`. The `convertRhsExpr` helper already exists (used by `convertBinding`) and returns an `Expr` — exactly what `ObjectEntry.value` expects.

- **No AST changes required.** `ObjectEntry.value: Expr` already permits any expression.

- **No evaluator changes required.** The `case "ObjectLit"` arm already delegates to `evalExpr`, which handles every `Expr` variant.

- **Affected pilots:** [`cases/dispatch/920-smoke-items-pipeline.yml`](cases/dispatch/920-smoke-items-pipeline.yml) flips from `reconciliation.predicted_matched_captured: false / divergence_kind: golden_parser_gap` to `true / divergence_kind: resolved_golden_gap`. No other pilot in the current corpus is impacted.

- **Eval log** ([`_skill-eval-log.md`](_skill-eval-log.md)): mark the "Golden-parser bug count: pipelines-in-objectEntry — logged" entry as resolved, update the AI⟷golden agreement rate from 5/7 = 71% to 6/7 = 86% (the remaining mismatch is PG-001 itself, which now self-corrects since production is fixed).

### Resolution

Fixed in [`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts). Two changes:

1. **Grammar rule** at the `objectEntry` value position: changed `this.SUBRULE(this.primary)` to `this.SUBRULE(this.rhsExpr)`. `rhsExpr` is the broadest expression rule in the golden's grammar — it's what `Binding` (assignment RHS) uses, and it's the form that matches the spec's "Values are any expression" wording in REQ-011 ac4. Added an inline comment pointing back to GG-001 and REQ-011 ac4 for future readers.

2. **AST conversion** in `convertObjectEntry`: changed `getRule(node, "primary")!` to `getRule(node, "rhsExpr")!` and `convertPrimary(primaryCst)` to `convertRhsExpr(rhsCst)`. The `convertRhsExpr` helper already existed (used by `convertBinding`) and returns the broad `Expr` shape — exactly what `ObjectEntry.value: Expr` accepts. Same inline comment for future readers.

No AST changes were required (`ObjectEntry.value` was already `Expr`, the broad union including `Pipeline`, `ToolCall`, `BinaryOp`, etc.). No evaluator changes were required (`case "ObjectLit"` already delegates each entry's value to `evalExpr`).

### Resolution - Complete

Re-ran `_backfill-smoke-capture.ts` against all 7 smoke pilots. Pilot 920 now captures cleanly:

```
"920-smoke-items-pipeline": {
  ...
  "completed": ["alpha", "gamma"],
  "deferred": ["beta"],
  "completed_count": 2,
  "deferred_count": 1
  ...
}
```

No `parse_error` anywhere in the capture output — the only `error`-bearing line is the spec-correct `unknown_server` from pilot 912 (the resolved PG-001 outcome). The golden now matches production exactly on pilot 920's envelope, including the `tool_call_count: 3` side-effect assertion.

Pilot 920's `reconciliation:` block updated to `predicted_matched_captured: true`, `divergence_kind: resolved_golden_gap`, with `spec_reference: ["FlashQuery Macro Language Requirements REQ-011 ac4"]` and a back-reference to this gap (`golden_gap_id: GG-001`).

Verified with:

```bash
npm run test:macro-framework
# 182/182 passing
npx tsx tests/macro-framework/_backfill-smoke-capture.ts
# Pilot 920 produces the spec-correct success envelope; no parse_error
```

### Post-Implementation Retest

**Retest date:** 2026-05-19
**Retested by:** Claude/Opus 4.7 (same-session author + retest pass)

**Punch-list resolution status:**

| Prescribed correction | Status | Evidence |
|---|---|---|
| Change `objectEntry` grammar rule from `primary` to `rhsExpr` at the value position | **RESOLVED** | Confirmed at [`macro-golden-model/src/parser.ts:340-355`](macro-golden-model/src/parser.ts) — rule now uses `this.SUBRULE(this.rhsExpr)` with an inline comment citing REQ-011 ac4 and GG-001. |
| Update `convertObjectEntry` to read `rhsExpr` CST and call `convertRhsExpr` | **RESOLVED** | Confirmed at [`macro-golden-model/src/parser.ts:682-700`](macro-golden-model/src/parser.ts) — reads `getRule(node, "rhsExpr")!` and calls `convertRhsExpr(rhsCst)`, with inline comment citing GG-001. |
| No AST changes required (type already `Expr`) | **N/A — by design** | `ObjectEntry.value: Expr` already permits any expression. |
| No evaluator changes required (already delegates to `evalExpr`) | **N/A — by design** | `case "ObjectLit"` in the evaluator already handles any `Expr` shape via recursive `evalExpr` calls. |
| Pilot 920 `reconciliation:` flips to `predicted_matched_captured: true` / `resolved_golden_gap` | **RESOLVED** | Confirmed at [`cases/dispatch/920-smoke-items-pipeline.yml`](cases/dispatch/920-smoke-items-pipeline.yml) — reconciliation block updated with `divergence_kind: resolved_golden_gap`, `golden_gap_id: GG-001`, and matching captured envelope. |
| Eval log updated to reflect resolution | **RESOLVED** | Confirmed at [`_skill-eval-log.md`](_skill-eval-log.md) — golden-parser bug count now "2 surfaced, 2 resolved"; AI⟷golden agreement rate climbs from 71% to 100% across the smoke-test corpus. |

**Executable verification (this retest):**

| Check | Command | Result |
|---|---|---|
| Full macro framework suite | `npm run test:macro-framework` | 182/182 passing |
| Re-capture of all 7 smoke pilots via golden | `npx tsx tests/macro-framework/_backfill-smoke-capture.ts` | All pilots capture; zero `parse_error` results; pilot 920 produces spec-correct envelope matching production |
| Golden demo (regression check on existing corpus) | `npx tsx tests/macro-framework/macro-golden-model/src/demo.ts` | Clean run; existing example macros still parse |

**Status:** **CLOSED.** The golden's `objectEntry` rule now accepts any expression in the value position per REQ-011 ac4, matching production. The two-line fix landed cleanly, no AST/evaluator changes were required, the discovery pilot (920) is migrated to assert clean reconciliation, and the smoke-test corpus's AI⟷golden agreement rate is now 7/7 = 100%. Future smoke tests can use natural summary-object patterns (`{ count_a: count $list_a, count_b: count $list_b }`) without the golden tripping on them.

---

## Gap GG-002: Claude/Opus 4.7 - `condition` Rule Rejects Pipelines / Tool Calls in If-Condition Position; Macro Lang §5.2 + spec-ratification

### Discovered By

- **Pilot:** [`cases/semantics/995-input-var-inline-as-if-condition.yml`](cases/semantics/995-input-var-inline-as-if-condition.yml)
- **Test run date:** 2026-05-19
- **Divergence kind:** `AI+Production ⊥ Golden` — AI predicted success, production produced success, golden's parser rejected the macro with `parse_error / missing_fi` at the `input_var` token.

The pilot uses `if input_var "enabled" --default false then` — a pipeline expression directly in if-condition position. Production accepted it and returned `{result: "on"}`. The golden's `captureSnapshot()` failed at parse time because the `condition` rule was rooted at `exprWithOps` (primary-rooted) and did not accept pipelines in that position.

### Requirement

[`FlashQuery Macro Language Requirements.md` §5.2](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md) establishes the general principle:

> "`_exists()` calls work anywhere a value is expected — assignment RHS, **if condition**, `&&` / `||` operands, after `!`, builtin args."

The phrase "anywhere a value is expected" is broad; it explicitly authorizes a non-primary tool-call form (`_exists()`) in if-condition position. By the same logic, any value-producing expression — including pipelines (`input_var "k" --default v`, `count $list`) — is valid in if-condition position. The only carve-out is the §1.2 grammar boundary on pipelines as comparison-operator OPERANDS, which is about composition with `==`/`!=`/`<` operators, not about standalone use as a condition.

### Implementation Evidence

Golden's `condition` rule before this fix — [`macro-golden-model/src/parser.ts:438-441`](macro-golden-model/src/parser.ts):

```ts
private condition = this.RULE("condition", () => {
  this.OPTION(() => this.CONSUME(Bang));
  this.SUBRULE(this.exprWithOps);   // <-- primary-rooted; rejects pipelines
});
```

`exprWithOps` chains over `andExpr → compareExpr → rangeExpr → primary`. Pipelines aren't reachable through that chain. Production's grammar accepts pipelines in this position (pilot 995 captured a successful production envelope); the golden was the lagging implementation.

### Reasoning

Spec-ratification finding parallel to REQ-011 ac4 / GG-001: the spec already covers the broader behavior via §5.2's general principle, but the golden's grammar was unnecessarily restrictive. Three impacts:

1. Macros that naturally express conditions through pipelines (`if input_var "flag" --default false then ...`) fail the golden's parser, even though production accepts them and the spec authorizes them by extension.
2. Forces an authoring workaround (pre-compute the pipeline into a variable, then check the variable in the if). Acceptable for the comparison-operand boundary (§1.2) where the parse-time gate is real; not justifiable here.
3. Reconciliation-gate noise: the golden producing parse_error on a spec-correct macro looks like a real spec violation until you trace it back to the golden's grammar restriction.

### Proposed Changes

- **Golden parser — grammar rule** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts) `condition`): change `this.SUBRULE(this.exprWithOps)` to `this.SUBRULE(this.rhsExpr)`. `rhsExpr` is the broad expression alternation that includes pipelines and tool calls.
- **Golden parser — AST conversion** (`convertCondition`): change `getRule(node, "exprWithOps")` to `getRule(node, "rhsExpr")` and `convertExprWithOps` to `convertRhsExpr`. Same shape as the GG-001 fix to `convertObjectEntry`.
- **No AST type changes:** the `IfStmt.cond` / `WhileLoop.cond` fields are typed as `Expr` (the broad union), which already permits pipelines and tool calls.
- **macro-spec.md** § 1.1 (operational summary): add a one-line clarifier explicitly stating that if/while conditions accept any value-producing expression, citing §5.2 as the underlying principle.
- **Affected pilot:** [`cases/semantics/995-input-var-inline-as-if-condition.yml`](cases/semantics/995-input-var-inline-as-if-condition.yml) flips from `golden_parser_gap` to clean reconciliation.

### Resolution

Fixed in [`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts):

1. **Grammar rule** at `condition`: changed `this.SUBRULE(this.exprWithOps)` to `this.SUBRULE(this.rhsExpr)` with an inline comment citing GG-002, §5.2, and the carve-out for the §1.2 comparison-operand boundary.
2. **AST conversion** in `convertCondition`: changed `getRule(node, "exprWithOps")` to `getRule(node, "rhsExpr")` and `convertExprWithOps` to `convertRhsExpr`.

Companion edit to `macro-spec.md` §1.1: added a sentence clarifying that if/while conditions accept any value-producing expression (pipelines, tool calls, comparisons), with a note that the §1.2 pipelines-in-compareExpr boundary still applies.

### Resolution - Complete

Re-ran `_backfill-smoke-capture.ts` against all input_var pilots. Pilot 995 now captures the spec-correct success envelope `{result: "on"}` matching production. No regressions on any other smoke pilot.

Verified with:

```bash
npm run test:macro-framework
# 210/210 passing
npx tsx tests/macro-framework/_backfill-smoke-capture.ts
# Pilot 995 produces { result: "on" }; reconciliation clean
```

### Post-Implementation Retest

**Retest date:** 2026-05-19
**Retested by:** Claude/Opus 4.7 (same-session author + retest pass)

| Prescribed correction | Status | Evidence |
|---|---|---|
| Change `condition` grammar rule from `exprWithOps` to `rhsExpr` | **RESOLVED** | Confirmed at [`macro-golden-model/src/parser.ts:438-449`](macro-golden-model/src/parser.ts) — rule now uses `this.SUBRULE(this.rhsExpr)` with an inline GG-002 comment. |
| Update `convertCondition` to read `rhsExpr` and call `convertRhsExpr` | **RESOLVED** | Confirmed at the conversion site. |
| macro-spec.md §1.1 clarifier | **RESOLVED** | Sentence added explaining if/while accept any value-producing expression; §1.2 boundary cross-referenced. |
| Pilot 995 reconciliation flips to clean | **RESOLVED** | Golden now captures `{result: "on"}` matching production. |

**Status:** **CLOSED.** Same fix shape as GG-001 — minor grammar broadening that brought the golden into alignment with production and the spec's general principle. Two-line code change, one-sentence spec clarification.

---

## Gap GG-003: Claude/Opus 4.7 - `input_var --default` Accepted Non-Literal Values; REQ-007 ac1

### Discovered By

- **Pilot:** [`cases/semantics/1003-input-var-non-literal-default-rejected.yml`](cases/semantics/1003-input-var-non-literal-default-rejected.yml)
- **Test run date:** 2026-05-19
- **Divergence kind:** `Production ⊥ Golden` — production correctly rejected the macro at pre-flight with `error: invalid_input, details.reason: input_var_default_must_be_literal`; the golden incorrectly accepted the macro and bound `$foo`'s string value as the default.

The pilot uses `result = input_var "result" --default $foo` — a VarRef as the default value. Per REQ-007 ac1 the default MUST be a literal. Production rejected as the spec requires; the golden was permissive.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.1.7 REQ-007 ac1](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "The grammar MUST accept `<name> = input_var \"<key>\"` (required form) and `<name> = input_var \"<key>\" --default <literal>` (optional form)."

And the failure-modes list:

> "Failure modes. `invalid_input` (missing required keys; `input_var` first arg not literal; default value is a boolean literal)."

The reason code `input_var_default_must_be_literal` is the canonical signal (used by production). REQ-007 ac2 also enumerates the allowed default literal kinds (string, number, null, list literal, object literal, and per REQ-112e: boolean).

### Implementation Evidence

Before the fix, the golden's `collectInputVarContract` ([`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts)) checked for `--default` presence but did NOT validate the default's expression kind:

```ts
const hasDefault = call.args.some(
  (a) => a.kind === "NamedArg" && a.name === "default",
);
if (hasDefault) {
  if (!optional.includes(key)) optional.push(key);
} else {
  if (!required.includes(key)) required.push(key);
}
```

The runtime input_var builtin at [`builtins.ts:48-50`](macro-golden-model/src/builtins.ts) returned `named.default` without inspecting its kind. So a `$foo` VarRef would silently flow through as the default value at runtime.

### Reasoning

Real golden gap: the spec is unambiguous (REQ-007 ac1 grammar shape + the explicit failure-mode entry). Production conforms; the golden was permissive. The golden's role is to be the spec's reference implementation — a permissive golden creates false-negative reconciliation findings (it agrees with macros production would correctly reject).

User-visible impact for the framework: a pilot that intended to test the rejection path (like 1003) would pass against production but the golden's capture would show success, which the reconciliation gate would flag as `Production ⊥ Golden` — needing manual analysis to determine the golden is wrong, not production.

### Proposed Changes

- **Golden contract collector** ([`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) `collectInputVarContract`): when `--default` is present, validate the named-arg's `value.kind` against the literal set `{StringLit, NumLit, NullLit, BoolLit, ListLit, ObjectLit}`. If not in the set, throw `MacroPreflightError` with reason `input_var_default_must_be_literal`.
- **Golden snapshot classifier** ([`macro-golden-model/src/snapshot.ts`](macro-golden-model/src/snapshot.ts) `classifyError`): propagate the new `reason`, `key`, and `default_kind` fields from the preflight error's details into the snapshot envelope so the gate can compare them against production's envelope.
- **No spec edit required:** REQ-007 ac1 already covers this. No new clarifier needed.
- **Affected pilot:** pilot 1003 flips from `Production ⊥ Golden` to clean reconciliation.

### Resolution

Implemented in [`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) `collectInputVarContract`:

```ts
const literalKinds = new Set([
  "StringLit", "NumLit", "NullLit", "BoolLit", "ListLit", "ObjectLit",
]);
if (!literalKinds.has(v.kind)) {
  throw new MacroPreflightError(
    `input_var "${key}" --default value must be a literal (got ${v.kind}).`,
    { ..., reason: "input_var_default_must_be_literal", key, default_kind: v.kind },
  );
}
```

And in [`macro-golden-model/src/snapshot.ts`](macro-golden-model/src/snapshot.ts) `classifyError` — the new `reason`, `key`, and `default_kind` fields flow through into the snapshot envelope's `details`.

### Resolution - Complete

Re-ran `_backfill-smoke-capture.ts`. Pilot 1003 now produces:

```
err.code=invalid_input reason=input_var_default_must_be_literal
```

…matching production's envelope. Reconciliation is clean.

Verified with:

```bash
npm run test:macro-framework
# 210/210 passing
npx tsx tests/macro-framework/_backfill-smoke-capture.ts
# Pilot 1003 produces invalid_input with reason input_var_default_must_be_literal
```

### Post-Implementation Retest

**Retest date:** 2026-05-19
**Retested by:** Claude/Opus 4.7 (same-session author + retest pass)

| Prescribed correction | Status | Evidence |
|---|---|---|
| Add default-literal validation in `collectInputVarContract` | **RESOLVED** | Confirmed at [`evaluator.ts`](macro-golden-model/src/evaluator.ts) `visitCall` — throws `MacroPreflightError` when `defaultArg.value.kind` not in literal set. |
| Propagate `reason`/`key`/`default_kind` through `classifyError` | **RESOLVED** | Confirmed at [`snapshot.ts`](macro-golden-model/src/snapshot.ts) — spread operators include the new fields conditionally. |
| Pilot 1003 reconciliation flips to clean | **RESOLVED** | Golden produces invalid_input + reason matching production. |

**Status:** **CLOSED.** Real spec-conformance gap — the golden was missing the literal-kind check that REQ-007 ac1 implies. Added validation + propagation; no new spec edit needed.
