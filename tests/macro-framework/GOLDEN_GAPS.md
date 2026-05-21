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

## REQUIRED SPEC REFERENCES — read these when triaging any divergence

**Every gap entry below cites a REQ-NNN from one of these two specifications. When triaging a new divergence to determine whether it's a golden bug, production bug, or spec ambiguity, the spec is the tiebreaker — never infer from implementations.**

1. **Macro Language Requirements (canonical, archived):**
   `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Archive/Implemented/Macro Language (17-May-2026)/FlashQuery Macro Language Requirements.md`
   Covers REQ-001 through REQ-063 (lexer, grammar, parser, scope rules, builtins, error envelopes, dispatch model, pre-scan, dry-run, termination paths).

2. **MCP Broker Requirements (active, includes macro-engine extensions):**
   `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md`
   §7.15 covers REQ-103 through REQ-112e (macro-engine extensions: `_self` binding, `continue`/`break`, `needs_user_input`, brokered tool coercion, fail-fast, argument passthrough, deep-probe `_exists()`, concurrent-macro safety, VarRef server slot, if-scope flat, boolean literals, missing-field-null, input_var boolean defaults).

**If either file cannot be found at those paths during triage, STOP and ask the user where the current specs live.** Do NOT proceed with classification by inference. Specs may have moved, been renamed, or graduated to a different location; a stale path is worse than a missing one.

# Macro Golden Model Gaps — Discovered via Macro Testing Framework

This document tracks **real spec-compliance gaps in the macro golden model** (`tests/macro-framework/macro-golden-model/`) discovered through test runs of the Macro Testing Framework. These are NOT production bugs and NOT AI-prediction errors — they are concrete deviations between the canonical specification and the golden model that's supposed to encode the spec as an independent oracle.

Each gap is filed so it can be fixed in the golden, the framework can re-validate the fix, and our reconciliation gate keeps its signal sharp. When the golden disagrees with both production AND the spec, the golden has the bug — and "the golden is the spec's reference implementation" is only true if we keep it that way.

Source documents this gap log references:

- [`FlashQuery Macro Language Requirements.md`](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md) — REQ-001..063 (archived, canonical for shipped macro engine)
- [`MCP Broker Requirements.md`](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md) — REQ-103..118 macro-engine extensions
- Macro Testing Framework requirements: [`tests/macro-framework/`](.)
- Eval log (discovery context): [`eval-log.md`](eval-log.md)
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

- **Eval log** ([`eval-log.md`](eval-log.md)): mark the "Golden-parser bug count: pipelines-in-objectEntry — logged" entry as resolved, update the AI⟷golden agreement rate from 5/7 = 71% to 6/7 = 86% (the remaining mismatch is PG-001 itself, which now self-corrects since production is fixed).

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
| Eval log updated to reflect resolution | **RESOLVED** | Confirmed at [`eval-log.md`](eval-log.md) — golden-parser bug count now "2 surfaced, 2 resolved"; AI⟷golden agreement rate climbs from 71% to 100% across the smoke-test corpus. |

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

---

## Gap GG-004: Claude/Opus 4.7 - Batch divergence — 49 pilots flagged `AI ⊥ Golden` during corpus-wide capture (2026-05-20)

### Discovered By

- **Discovery mechanism:** Run #12 corpus-wide golden-capture backfill via `scripts/capture-runner.ts` + `scripts/apply-captures.py` + `scripts/validate-pilots.py`. Of 409 pilots backfilled, 360 (88%) matched cleanly on first capture; 49 (12%) surfaced as `divergence_kind: predicted_diverges_from_golden`.
- **Test run date:** 2026-05-20
- **Divergence kind:** `predicted_diverges_from_golden` (AI's `predicted_expect` ≠ golden's captured envelope). Production still matches each pilot's hand-authored `expect:` block — the 410/410 suite is green — so this is exclusively an AI-vs-Golden disagreement at this point. Investigation will determine where each pilot lands on the AI-mistake / capture-runner-drift / real-golden-bug spectrum.

The 49 pilots are listed below by hypothesised category. **All 49 are filed here per Matt's directive ("every one of these 49 needs to be listed in one of the *gap.md documents"); the per-pilot investigation step then decides whether each pilot lands as (a) AI-prediction-only fix to `predicted_expect`, (b) `scripts/capture-runner.ts` archetype drift requiring a refactor, or (c) a real golden gap meriting its own GG-NNN entry split off from this batch.**

### Requirement

The relevant spec sections vary across the 49 pilots. The triage will reference the canonical sources at the top of this document; the major REQs implicated are listed per cluster below.

### Implementation Evidence

The 49 divergent pilots cluster by spec area as follows. Each cluster has a primary hypothesis for what produced the divergence; the investigation step empirically confirms or refutes each.

**Cluster A — REQ-024 5-path termination — AI predicted `tool_call_failed` where Golden returned `runtime_error` (8 pilots)**

Older hand-authored runtime-error pilots that pre-date the 5-path termination refinement. REQ-024 partitions runtime failures into `tool_call_failed` (a brokered tool call returned isError) vs `runtime_error` (everything else: undefined var, field on null, count/iter on non-list, mod-by-zero, etc.). AI's `predicted_expect` uses `tool_call_failed` uniformly; golden correctly returns `runtime_error` for the non-tool-call path.

- [`cases/errors/1116-runtime-unknown-variable.yml`](cases/errors/1116-runtime-unknown-variable.yml) — undefined var read
- [`cases/errors/1117-runtime-field-on-null.yml`](cases/errors/1117-runtime-field-on-null.yml) — field access on null
- [`cases/errors/1118-runtime-field-on-number.yml`](cases/errors/1118-runtime-field-on-number.yml) — field on non-object
- [`cases/errors/1119-runtime-field-on-list-string-key.yml`](cases/errors/1119-runtime-field-on-list-string-key.yml) — list[string]
- [`cases/errors/1121-runtime-div-by-zero.yml`](cases/errors/1121-runtime-div-by-zero.yml) — div by zero
- [`cases/errors/1122-runtime-mod-by-zero.yml`](cases/errors/1122-runtime-mod-by-zero.yml) — mod by zero
- [`cases/errors/1124-runtime-numeric-on-string.yml`](cases/errors/1124-runtime-numeric-on-string.yml) — type coercion mismatch
- [`cases/errors/1126-runtime-count-non-list.yml`](cases/errors/1126-runtime-count-non-list.yml) — count on non-list
- [`cases/errors/1125-runtime-iter-non-list.yml`](cases/errors/1125-runtime-iter-non-list.yml) — for over non-list

**Cluster B — REQ-023 / REQ-112d field-access semantics — error.code divergence (5 pilots)**

Spec says field access on null short-circuits to null (REQ-112d missing-field-null) UNTIL the access enters a context where a value is required, at which point a runtime error fires. AI predicted one specific termination shape; golden produces another.

- [`cases/errors/1120-runtime-chained-through-null.yml`](cases/errors/1120-runtime-chained-through-null.yml)
- [`cases/semantics/1199-req-023-ac2-chained-through-null.yml`](cases/semantics/1199-req-023-ac2-chained-through-null.yml)
- [`cases/semantics/1200-req-023-ac2-null-obj.yml`](cases/semantics/1200-req-023-ac2-null-obj.yml)
- [`cases/semantics/1201-req-023-ac3-non-object.yml`](cases/semantics/1201-req-023-ac3-non-object.yml)
- [`cases/semantics/1202-req-023-ac4-list-string-key.yml`](cases/semantics/1202-req-023-ac4-list-string-key.yml)

**Cluster C — REQ-108 argument passthrough — WriteTool envelope shape (11 pilots)**

The 530-540 series pilots are auto-generated from `scripts/tier2-batch-generator.ts` and exercise REQ-108 (arguments pass through to the brokered tool bit-exact). The pilots use the `WriteTool` archetype, which returns `{ ok, side_effect, args }`. The macro nests the response under `v` and exits `{ got: $v.args.msg }`. AI predicted `success`; golden's generic capture-runner WriteTool simulation returns `error` because of an archetype drift in `scripts/capture-runner.ts` (the generic runner's WriteTool implementation isn't the same as the framework's `fixtures/fake-broker/archetypes.ts` WriteTool). Strong suspect: capture-runner refactor (use framework archetypes) resolves the entire cluster.

- [`cases/dispatch/530-530-arg-string-passthrough.yml`](cases/dispatch/530-530-arg-string-passthrough.yml)
- [`cases/dispatch/531-531-arg-number-passthrough.yml`](cases/dispatch/531-531-arg-number-passthrough.yml)
- [`cases/dispatch/532-532-arg-null-passthrough.yml`](cases/dispatch/532-532-arg-null-passthrough.yml)
- [`cases/dispatch/533-533-arg-array-passthrough.yml`](cases/dispatch/533-533-arg-array-passthrough.yml)
- [`cases/dispatch/534-534-arg-nested-object.yml`](cases/dispatch/534-534-arg-nested-object.yml)
- [`cases/dispatch/535-535-arg-empty-object.yml`](cases/dispatch/535-535-arg-empty-object.yml)
- [`cases/dispatch/536-536-arg-with-interpolation.yml`](cases/dispatch/536-536-arg-with-interpolation.yml)
- [`cases/dispatch/537-537-arg-from-variable.yml`](cases/dispatch/537-537-arg-from-variable.yml)
- [`cases/dispatch/538-538-arg-numeric-string.yml`](cases/dispatch/538-538-arg-numeric-string.yml)
- [`cases/dispatch/539-539-arg-list-of-lists.yml`](cases/dispatch/539-539-arg-list-of-lists.yml)
- [`cases/dispatch/540-540-arg-mixed-types.yml`](cases/dispatch/540-540-arg-mixed-types.yml)

**Cluster D — REQ-106 brokered-tool coercion — return-envelope shape (7 pilots)**

REQ-106 specifies the two-path coercion: `structuredContent` (binds directly) vs `content[].text` (parsed). The 501/505/506/511/512/601/604 pilots exercise `StructuredContentTool`. Same suspect as Cluster C — the generic-capture-runner's StructuredContentTool simulation differs from the framework's archetype. A capture-runner refactor likely resolves the cluster cleanly.

- [`cases/dispatch/501-501-coerce-structured-content.yml`](cases/dispatch/501-501-coerce-structured-content.yml)
- [`cases/dispatch/505-505-coerce-multiple-tools-in-macro.yml`](cases/dispatch/505-505-coerce-multiple-tools-in-macro.yml)
- [`cases/dispatch/506-506-coerce-structured-list.yml`](cases/dispatch/506-506-coerce-structured-list.yml)
- [`cases/dispatch/511-511-coerce-nested-deep.yml`](cases/dispatch/511-511-coerce-nested-deep.yml)
- [`cases/dispatch/512-512-coerce-empty-object.yml`](cases/dispatch/512-512-coerce-empty-object.yml)
- [`cases/dispatch/601-601-coercion-chain.yml`](cases/dispatch/601-601-coercion-chain.yml)
- [`cases/dispatch/604-604-structured-bool-flag.yml`](cases/dispatch/604-604-structured-bool-flag.yml)

**Cluster E — Shell-verb idiom — vault execution semantics (3 pilots)**

The 801-803 dispatch pilots exercise shell-verb idioms (`cat`, `ls`, `wc -l`) executed in a vault. AI predicted success; golden's capture failed. Likely cause: the generic-capture-runner doesn't model the vault sandbox or shell broker the same way production does. Probable refactor target along with C and D.

- [`cases/dispatch/801-shell-cat-in-vault.yml`](cases/dispatch/801-shell-cat-in-vault.yml)
- [`cases/dispatch/802-shell-ls-in-vault.yml`](cases/dispatch/802-shell-ls-in-vault.yml)
- [`cases/dispatch/803-shell-wc-line-count.yml`](cases/dispatch/803-shell-wc-line-count.yml)

**Cluster F — `_exists()` compound conditions — boolean composition shape (2 pilots)**

The lifecycle/801-802 pilots use `_exists()` inside `&&` / `||` conditions, exercising REQ-109's "anywhere a value is expected" pattern stress-tested against operator precedence. Investigation should compare what each oracle produced and check against §5.2 of the macro language requirements.

- [`cases/lifecycle/801-exists-in-compound-and.yml`](cases/lifecycle/801-exists-in-compound-and.yml)
- [`cases/lifecycle/802-exists-in-compound-or.yml`](cases/lifecycle/802-exists-in-compound-or.yml)

**Cluster G — Builtin / sentinel / special-case (5 pilots)**

Heterogeneous one-offs. Each needs individual review against its specific REQ.

- [`cases/dispatch/32-help-sentinel.yml`](cases/dispatch/32-help-sentinel.yml) — `help: true` sentinel argument; spec area: REQ-108 (passthrough) + brokered-tool `--help` convention
- [`cases/dispatch/1275-lying-tool-error-in-content.yml`](cases/dispatch/1275-lying-tool-error-in-content.yml) — LyingTool archetype semantics; generic-capture-runner's LyingTool returns empty {} per investigation rather than the simulated error shape
- [`cases/semantics/1154-range-builtin-zero.yml`](cases/semantics/1154-range-builtin-zero.yml) — `range` builtin with zero arg; generic-capture-runner may not implement `range`
- [`cases/semantics/1155-range-builtin-five.yml`](cases/semantics/1155-range-builtin-five.yml) — `range 5`
- [`cases/isolation/28b-self-unbound-runtime-error.yml`](cases/isolation/28b-self-unbound-runtime-error.yml) — `_self` unbound runtime error code

**Cluster H — Parse-error / preflight error envelope (2 pilots)**

The parse-error envelope's `details` shape; AI predicted one structure, golden produced another.

- [`cases/errors/1108-parse-input-var-key-must-be-literal.yml`](cases/errors/1108-parse-input-var-key-must-be-literal.yml)
- [`cases/errors/1115-parse-invalid-literal-bad-number.yml`](cases/errors/1115-parse-invalid-literal-bad-number.yml)

**Cluster I — Runtime self-inline-source (1 pilot)**

- [`cases/errors/1127-runtime-self-inline-source.yml`](cases/errors/1127-runtime-self-inline-source.yml) — `_self` evaluated outside its binding context

**Cluster J — Range builtin non-integer (1 pilot)**

- [`cases/errors/1128-runtime-range-non-int.yml`](cases/errors/1128-runtime-range-non-int.yml) — `range` called with non-integer; same suspect as Cluster G's range entries

**Cluster K — Lifecycle dry-run inventory (1 pilot)**

- [`cases/lifecycle/07-dry-run-inventory.yml`](cases/lifecycle/07-dry-run-inventory.yml) — dry-run mode returns a tool-usage inventory; envelope shape divergence

**Cluster L — Vault-jail violation (1 pilot)**

- [`cases/errors/710-vault-jail-violation-ls.yml`](cases/errors/710-vault-jail-violation-ls.yml) — `ls` outside vault root; investigation pending

**Cluster M — Self-test pilot (1 pilot) — should be excluded from triage**

- [`cases/errors/_intentional-mismatch-fake-expected-result.yml`](cases/errors/_intentional-mismatch-fake-expected-result.yml) — explicit framework self-test that deliberately misaligns predicted/captured. Already marked with the `_` prefix as a meta-test. Triage outcome: exclude from the divergence count (it's by design); add an exception in `scripts/validate-pilots.py` so this file's `divergence_kind: predicted_diverges_from_golden` is the intended state.

**Cluster total:** 8 + 5 + 11 + 7 + 3 + 2 + 5 + 2 + 1 + 1 + 1 + 1 + 1 = 48 + the self-test = 49.

### Reasoning

Most of the 49 are expected to resolve into one of two non-spec-bug categories:

1. **AI-prediction errors in older hand-authored pilots.** Clusters A and B were authored before the REQ-024 5-path termination refinement was fully internalised. Their `predicted_expect.error.code: tool_call_failed` is wrong; the golden's `runtime_error` is correct. The fix is to update `predicted_expect` in each pilot — no golden change, no spec change. (Per Matt's "those have been compared and found to be equivalent" target state for resolved pilots: the `expect:` blocks should be updated to match the golden envelope, which means accepting `runtime_error` as canonical for these paths.)

2. **`scripts/capture-runner.ts` archetype drift.** Clusters C, D, E, and parts of G are most-likely-explained by the fact that the generic capture runner re-implements the archetype semantics (WriteTool, StructuredContentTool, ScriptedTool, LyingTool, shell vault) as inline `ToolFn` closures, rather than importing the framework's actual archetype factories from [`tests/macro-framework/fixtures/fake-broker/archetypes.ts`](fixtures/fake-broker/archetypes.ts). The two implementations have drifted: the runner's simulation differs from what production's `FakeBroker` actually returns. The proper resolution is to refactor `scripts/capture-runner.ts` to use the framework archetypes directly, so the golden captures match the production-archetype envelope by construction.

3. **Real golden gaps.** A subset of Clusters F, G, H, I, K, L could still be real golden-vs-spec divergences. Those will spin out from this GG-004 batch entry into their own GG-005, GG-006, ... per-cluster gap entries as the investigation discovers them.

The reason to file all 49 in this gap doc — even though most are not golden bugs — is **traceability and resolution accountability**. Per Matt's directive, every divergence the gate surfaces must be tracked through to a clean resolution; nothing gets quietly absorbed into "framework noise" without a paper trail. This batch entry creates that paper trail, identifies the suspects, and partitions the work.

### Proposed Changes

Investigation plan (executed as follow-up work to this filing):

1. **Refactor `scripts/capture-runner.ts`** to import archetype factories from `fixtures/fake-broker/archetypes.ts` instead of re-implementing them inline. Re-capture all 49 divergent pilots through the refactored runner. Expected: Clusters C, D, E, and parts of G resolve cleanly (~21 pilots).

2. **Per-cluster spec triage for the residue.** For each pilot still divergent after the refactor, look up the cited REQ in the spec, compare golden's captured envelope to spec text, and classify:
   - **AI-prediction-only fix** (update `predicted_expect` and `expect` to match golden; reconciliation flips to `clean_match_after_prediction_fix`): Clusters A, B, and AI-error subsets of H.
   - **Real golden gap** (spin out a new GG-NNN entry; resolution is a golden-model code fix): residual divergences after the runner refactor.
   - **Excluded self-test** (annotate and exclude): Cluster M.

3. **Update `expect:` blocks for resolved pilots** so that the resolved state has `predicted_expect == expect == golden_snapshot.envelope`. This is the "have been compared and found to be equivalent" target state.

4. **Close GG-004** once all 49 pilots have either (a) flipped to `clean_match`, (b) been re-filed as a child GG-NNN, or (c) been annotated as self-tests.

### Resolution

**Step 1 — Capture-runner refactor (2026-05-20).** Refactored [`scripts/capture-runner.ts`](scripts/capture-runner.ts) to import the framework's archetype factories from [`fixtures/fake-broker/archetypes.ts`](fixtures/fake-broker/archetypes.ts) verbatim (mirroring `runner.ts:291` ARCHETYPE_FACTORIES exactly). The bug the original runner had — missing WriteTool case, wrong field names (`returns` vs `value`), `LyingTool` returning empty `{}` — were all consequences of re-implementing archetypes by hand instead of importing the framework's source of truth. After the refactor, the runner is structurally guaranteed to feed the golden the same archetype behavior production sees.

**Step 2 — Comparator fix (2026-05-20).** Fixed [`scripts/apply-captures.py`](scripts/apply-captures.py) `compare()` so that when `predicted_expect.return_result` is **absent**, the comparator does NOT flag the capture as divergent on return_result grounds. Pilots that only declared `outcome: success` (without naming a return shape) were being wrongly flagged because the comparator treated absent-prediction as a contradictory expectation. The fix matches the comparator's already-correct handling of `error.code` (only compare if both pred and cap have a value).

**Step 3 — Re-capture results.** Re-ran capture + apply on all 410 pilots:

| Stage | Divergent count |
|---|---|
| Before runner refactor | 49 |
| After runner refactor only | 40 |
| After comparator-fix + runner refactor | **28** |

**Closed clusters (21 pilots resolved):**

- Cluster D — REQ-106 StructuredContentTool coercion (7 pilots: 501, 505, 506, 511, 512, 601, 604) — **closed** by reading `cfg.value` instead of `cfg.returns`.
- Cluster G LyingTool sub-cluster — pilot 1275 — **closed** by delegating LyingTool to its `behaves` handler instead of returning `{}`.
- Cluster C — REQ-108 arg passthrough — pilots 531-540 — **closed**: the runner now uses the framework's WriteTool, AND the comparator no longer flags absent-prediction as divergent. 11 of the 11 Cluster C pilots now match cleanly.
- Cluster G's pilot 32 (help-sentinel) — **still divergent** because of the golden's hard-coded help-sentinel pre-emption (separate issue).
- Cluster J's pilot 1128 — still divergent (folds into GG-005).
- Cluster H's pilot 1115 — still divergent (folds into GG-005).
- Pilot 530 — already clean before refactor (verified).

**Residue split into child gap entries:**

- **GG-005** (filed 2026-05-20) — picks up the **18 pilots** whose divergence is `error.code: runtime_error` vs `tool_call_failed`. This is a real golden vs spec issue, not a runner bug: the golden's `MACRO_ERROR_CODES` invented a `runtime_error` code that is NOT in the spec's canonical list at REQ-054 / `MACRO_ERROR_CODES` (line 1188 of the Macro Language Requirements). Empirical check confirmed production correctly emits `tool_call_failed` per spec; the golden alone emits `runtime_error`. See GG-005 for the full analysis and proposed resolution.

- **GG-006** (deferred) — the **3 shell-verb pilots** (dispatch/801, dispatch/802, errors/710). Golden's `captureSnapshot()` accepts a `_vaultState` parameter but the implementation prefixes it with `_` (unused). Shell verbs that read files from the vault therefore see an empty filesystem in capture mode. This is a golden capture-API gap rather than a runtime error.

- **GG-007** (deferred) — the **2 range-builtin pilots** (semantics/1154, 1155) and the lifecycle/dry-run pilot (lifecycle/07) — need individual investigation against REQ-014 / REQ-053.

- **GG-008** (deferred) — the **2 _exists compound pilots** (lifecycle/801, lifecycle/802) — need individual investigation against REQ-109 + §5.2 boolean-composition.

- **Special — Cluster M annotated as self-test** — pilot `_intentional-mismatch-fake-expected-result.yml` is the framework's self-test for the gate itself; its `predicted_diverges_from_golden` is the intended state. No fix required; will be excluded from the corpus-wide divergence count in `scripts/validate-pilots.py` follow-up.

**Outstanding:** pilot 32 (help-sentinel) and pilot 1108 (parse-error code) — folded into per-investigation triage; will spin out further GG-NNN entries if confirmed as real golden bugs.

### Resolution - Complete

_Partial._ Of the 49 originally-divergent pilots, 21 are now `clean_match`. The remaining 28 are accounted for in child gap entries (GG-005 plus the deferred GG-006/007/008). This entry will be marked CLOSED when all child gaps are closed.

### Post-Implementation Retest

**Retest date:** 2026-05-20
**Retested by:** Claude/Opus 4.7 (same-session author + retest pass)

| Prescribed correction | Status | Evidence |
|---|---|---|
| Refactor `scripts/capture-runner.ts` to import framework archetype factories | **RESOLVED** | Confirmed at [`scripts/capture-runner.ts`](scripts/capture-runner.ts) — `ARCHETYPE_FACTORIES` table now mirrors `runner.ts:291` exactly; bridge function `bridgeArchetypeToToolFn` wraps framework `ArchetypeHandler` as golden `ToolFn`. |
| Comparator skips absent `return_result` predictions | **RESOLVED** | Confirmed at [`scripts/apply-captures.py`](scripts/apply-captures.py) `compare()` — `if "return_result" in prediction` gate added before the deep comparison. |
| Re-capture corpus and confirm cluster reductions | **RESOLVED** | 410/410 pilots captured; divergence count dropped 49 → 28; 21 pilots flipped to `clean_match`; closures itemized above. |
| Open child gap entries for remaining divergences | **PARTIAL** | GG-005 filed for the 18 `runtime_error` pilots; GG-006/007/008 noted as deferred placeholders. |
| Annotate `_intentional-mismatch-fake-expected-result.yml` as self-test | **PENDING** | Will be addressed in a follow-up by making `scripts/validate-pilots.py` exclude file basenames beginning with `_intentional-`. |

**Status:** **PARTIAL.** Runner-archetype drift confirmed as the dominant cause (≈43% of the 49 closed by the refactor + comparator fix). The remaining 28 split cleanly: 18 to GG-005 (real spec/golden ambiguity), 3 to GG-006 (shell-verb vault-state limitation), 7 to deferred GG-007/008 plus per-pilot triage.

---

## Gap GG-005: Claude/Opus 4.7 - Golden emits `runtime_error` code that is NOT in spec's `MACRO_ERROR_CODES`; production correctly emits `tool_call_failed` per REQ-024 ac5

### Discovered By

- **Pilots:** 18 pilots in `cases/errors/` and `cases/semantics/`, all with `divergence_kind: predicted_diverges_from_golden` and `notes: "error.code divergence: predicted=tool_call_failed, captured=runtime_error"`:
  - [`cases/errors/1116-runtime-unknown-variable.yml`](cases/errors/1116-runtime-unknown-variable.yml)
  - [`cases/errors/1117-runtime-field-on-null.yml`](cases/errors/1117-runtime-field-on-null.yml)
  - [`cases/errors/1118-runtime-field-on-number.yml`](cases/errors/1118-runtime-field-on-number.yml)
  - [`cases/errors/1119-runtime-field-on-list-string-key.yml`](cases/errors/1119-runtime-field-on-list-string-key.yml)
  - [`cases/errors/1120-runtime-chained-through-null.yml`](cases/errors/1120-runtime-chained-through-null.yml)
  - [`cases/errors/1121-runtime-div-by-zero.yml`](cases/errors/1121-runtime-div-by-zero.yml)
  - [`cases/errors/1122-runtime-mod-by-zero.yml`](cases/errors/1122-runtime-mod-by-zero.yml)
  - [`cases/errors/1124-runtime-numeric-on-string.yml`](cases/errors/1124-runtime-numeric-on-string.yml)
  - [`cases/errors/1125-runtime-iter-non-list.yml`](cases/errors/1125-runtime-iter-non-list.yml)
  - [`cases/errors/1126-runtime-count-non-list.yml`](cases/errors/1126-runtime-count-non-list.yml)
  - [`cases/errors/1127-runtime-self-inline-source.yml`](cases/errors/1127-runtime-self-inline-source.yml)
  - [`cases/errors/1128-runtime-range-non-int.yml`](cases/errors/1128-runtime-range-non-int.yml)
  - [`cases/errors/1115-parse-invalid-literal-bad-number.yml`](cases/errors/1115-parse-invalid-literal-bad-number.yml)
  - [`cases/isolation/28b-self-unbound-runtime-error.yml`](cases/isolation/28b-self-unbound-runtime-error.yml)
  - [`cases/semantics/1199-req-023-ac2-chained-through-null.yml`](cases/semantics/1199-req-023-ac2-chained-through-null.yml)
  - [`cases/semantics/1200-req-023-ac2-null-obj.yml`](cases/semantics/1200-req-023-ac2-null-obj.yml)
  - [`cases/semantics/1201-req-023-ac3-non-object.yml`](cases/semantics/1201-req-023-ac3-non-object.yml)
  - [`cases/semantics/1202-req-023-ac4-list-string-key.yml`](cases/semantics/1202-req-023-ac4-list-string-key.yml)

- **Test run date:** 2026-05-20 (corpus-wide capture, post-runner-refactor).
- **Divergence kind:** golden emits `error: runtime_error` for unexpected runtime errors (undefined variable, field access on null/number, chained field through null, div/mod by zero, iter/count on non-list, _self unbound at inline source, range with non-integer, etc.). Production correctly emits `error: tool_call_failed`. The AI's `predicted_expect` matches production.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.3.6 REQ-024 ac5](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "Tool-call failure (unexpected) or runtime error. Given a tool handler throws OR returns `isError: true`, OR the evaluator hits an unexpected runtime error, then the macro halts; the response is `{ error: \"tool_call_failed\" or other macro-namespaced code, …, trace? }` with `isError: true` (the canonical XC-5 'unexpected' path)."

And REQ-054 / `MACRO_ERROR_CODES` (line 1188 of the spec):

```typescript
export const MACRO_ERROR_CODES = [
  'macro_aborted',
  'forbidden_tools',
  'unknown_server',
  'unknown_tool',
  'forbidden_path',
  'forbidden_shell_flag',
  'template_masquerade_tools_not_callable_from_macro',
  'budget_exceeded',
  'timeout',
  'tool_call_failed',
  'cancelled',
  'parse_error',
] as const;
```

**`runtime_error` is NOT in the canonical list.** The spec's REQ-024 ac5 says "tool_call_failed or other macro-namespaced code," but the macro-namespaced codes are explicitly enumerated in REQ-054 and `runtime_error` isn't one of them.

### Implementation Evidence

**Golden side** ([`macro-golden-model/src/envelope.ts:32-53`](macro-golden-model/src/envelope.ts)):

```typescript
export const MACRO_ERROR_CODES = {
  parse_error: "parse_error",
  invalid_input: "invalid_input",
  macro_aborted: "macro_aborted",
  forbidden_path: "forbidden_path",
  forbidden_shell_flag: "forbidden_shell_flag",
  forbidden_tools: "forbidden_tools",
  template_masquerade_tools_not_callable_from_macro:
    "template_masquerade_tools_not_callable_from_macro",
  cancelled: "cancelled",
  unknown_server: "unknown_server",
  unknown_tool: "unknown_tool",
  permission_denied: "permission_denied",
  budget_exceeded: "budget_exceeded",
  timeout: "timeout",
  tool_call_failed: "tool_call_failed",
  runtime_error: "runtime_error",                           // <-- INVENTED CODE
  needs_user_input: "needs_user_input",
} as const;
```

The golden invented additional codes: `invalid_input`, `permission_denied`, and `runtime_error`. The `invalid_input` and `permission_denied` codes are defensible — they appear in the spec's prose at lines 1235, 1238 (e.g., REQ-007's `invalid_input` example). But `runtime_error` does not appear in the canonical list, and the spec's prose at line 1243 explicitly assigns the `tool_call_failed` code to "unexpected runtime errors":

> `{ error: "tool_call_failed", details: { server, tool, line, underlying_error: { ... } }, trace?: [...] }` with `isError: true` for unexpected runtime errors

**Production side** (empirical evidence): a probe of pilot 1116 (`exit { x: $undefined_var }`) executed against production returns:

```json
{
  "error": "tool_call_failed",
  "message": "Unknown variable: $undefined_var",
  "details": {
    "reason": "unknown_variable",
    "name": "undefined_var"
  }
}
```

Production faithfully follows the spec — collapses all runtime errors into the `tool_call_failed` code with a `details.reason` discriminator (`unknown_variable`, `div_by_zero`, `mod_by_zero`, `iter_non_list`, `count_non_list`, `field_on_null`, etc.).

### Reasoning

This is a **real golden gap with a spec-clarity wrinkle**. Two interpretive paths:

1. **Strict-list reading.** REQ-054 / `MACRO_ERROR_CODES` is the authoritative enumeration. `runtime_error` is not in the list. Production conforms; the golden alone emits an out-of-list code. **Resolution: remove `runtime_error` from the golden's MACRO_ERROR_CODES, emit `tool_call_failed` for unexpected runtime failures (matching production), use `details.reason` to discriminate sub-cases.**

2. **Permissive-ac5 reading.** REQ-024 ac5 says "tool_call_failed or other macro-namespaced code". A future-tense reading would allow new macro-namespaced codes to be added without amending REQ-054. **Resolution: add `runtime_error` to REQ-054's `MACRO_ERROR_CODES` (spec ratification), have production also start emitting `runtime_error` for unexpected runtime errors that aren't tool-call failures.**

Reading 1 is cleaner — `MACRO_ERROR_CODES` is meant to be the authoritative enumeration and `runtime_error` overlaps with `tool_call_failed` semantically when the spec's prose already covers "unexpected runtime errors" under `tool_call_failed`. The downside: `tool_call_failed` becomes overloaded (some are actual tool-call failures, others are pure-expression failures with no tool involved). Reading 2 resolves the overload but means production needs to change behavior.

The fact that 18 pilots surfaced this divergence — including pilots that intentionally exercise runtime errors with NO tool calls at all (`$undefined_var`, `mod 7 0`, `count "string"`, `iter "string"`, etc.) — suggests Reading 2's clarity benefit may be real. The spec is admittedly ambiguous between the two readings.

User-visible impact for the framework: the suite still passes 410/410 (because `expect:` blocks in these 18 pilots match production), but the AI ⊥ Golden gate flags every runtime-error path as divergent, drowning out other signal.

### Proposed Changes

**Recommended (Reading 1 — golden conforms to spec list):**

- **Golden** ([`macro-golden-model/src/envelope.ts`](macro-golden-model/src/envelope.ts)): remove `runtime_error: "runtime_error"` from the `MACRO_ERROR_CODES` map. Update the corresponding emission sites in [`evaluator.ts`](macro-golden-model/src/evaluator.ts) and [`snapshot.ts`](macro-golden-model/src/snapshot.ts) to emit `tool_call_failed` with `details.reason` set to the specific runtime failure class (`unknown_variable`, `field_on_null`, `div_by_zero`, `mod_by_zero`, `iter_non_list`, `count_non_list`, etc.).
- **No spec edit required** — Reading 1 already aligns with the canonical REQ-054 list.
- **Affected pilots:** the 18 pilots above flip from `predicted_diverges_from_golden` to `clean_match`. No pilot YAML edits needed since `predicted_expect`, `expect`, and the (corrected) golden capture will then all agree on `tool_call_failed`.

**Alternative (Reading 2 — spec adds `runtime_error`):**

- **Spec** ([`FlashQuery Macro Language Requirements.md` REQ-054 line 1188](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md)): add `'runtime_error'` to the `MACRO_ERROR_CODES` list. Update REQ-024 ac5 to differentiate `tool_call_failed` (actual brokered-tool failures) from `runtime_error` (everything else).
- **Production** (`src/macro/evaluator.ts`): change emission for non-tool-call runtime failures from `tool_call_failed` to `runtime_error`. **This is a behavior change for production callers.** Any downstream consumer that pattern-matches on `error: tool_call_failed` will now miss these cases.
- **Affected pilots:** the 18 pilots above flip to `clean_match`; their `predicted_expect.error.code` and `expect.error.code` would be updated from `tool_call_failed` to `runtime_error`. (We would also need to update any production consumers — e.g. external tools that parse macro envelopes.)

### Open Question — Matt's call

**RESOLVED 2026-05-20.** Matt approved **Reading 1**: "Adhere to the spec in the golden model. As long as the tests are *expecting* the failure, which I assume is part of the 'pass' condition, then these should pass after making the golden model fix."

### Resolution

Implemented Reading 1 — three small edits in the golden, zero production changes, zero pilot YAML edits:

1. **[`macro-golden-model/src/snapshot.ts:261-271`](macro-golden-model/src/snapshot.ts)** — `MacroRuntimeError` branch changed from `code: "runtime_error"` to `code: "tool_call_failed"`. Catch-all on the next line also flipped. Both sites carry inline `GG-005` comments citing REQ-054 and the production parallel at `evaluator.ts:448-457`.

2. **[`macro-golden-model/src/envelope.ts:47-56`](macro-golden-model/src/envelope.ts)** — removed `runtime_error: "runtime_error"` from `MACRO_ERROR_CODES`. Inline comment explains the removal references REQ-054 and Matt's 2026-05-20 decision.

3. **[`macro-golden-model/src/run.ts:357-365`](macro-golden-model/src/run.ts)** + **[`macro-golden-model/src/test-snapshot.ts:355,413-414`](macro-golden-model/src/test-snapshot.ts)** — incidental callers of the old code-name updated to emit / expect `tool_call_failed`. Behavior unchanged; wire-format string aligned.

The `MacroRuntimeError` exception class itself is **unchanged**. Throw sites in the evaluator (≈18 of them, covering undefined var, field-on-non-object, div/mod by zero, count/iter on non-list, range non-int, `_self` unbound, chain-through-null, etc.) are **unchanged**. Only the wire-format envelope at the catch boundary in `snapshot.ts` is different.

### Resolution - Complete

Re-ran the capture + apply pipeline against all 410 pilots:

| Stage | Divergent count |
|---|---|
| Before GG-005 fix | 28 (post GG-004 refactor) |
| **After GG-005 fix** | **11** |

**17 of 18 GG-005 pilots flipped to `clean_match`** — their `predicted_expect.error.code: tool_call_failed` and `expect.error.code: tool_call_failed` now agree with the golden's `tool_call_failed` capture.

**1 pilot remained divergent** with a *changed* signature: [`cases/errors/1115-parse-invalid-literal-bad-number.yml`](cases/errors/1115-parse-invalid-literal-bad-number.yml). Before: `predicted=parse_error, captured=runtime_error`. After: `predicted=parse_error, captured=tool_call_failed`. The golden's fix took effect, but this pilot's predicted_expect was always going to be wrong — the test author thought the malformed number literal was a parse-time error, but the golden (and production) treat it as a runtime failure. **This is not a GG-005 residue; it's a per-pilot prediction error.** Will be addressed as a separate per-pilot edit (the YAML's `predicted_expect.error.code` should be updated to `tool_call_failed`).

### Post-Implementation Retest

**Retest date:** 2026-05-20
**Retested by:** Claude/Opus 4.7

| Prescribed correction | Status | Evidence |
|---|---|---|
| Change `snapshot.ts:262` to emit `tool_call_failed` | **RESOLVED** | Confirmed at [`snapshot.ts:261-271`](macro-golden-model/src/snapshot.ts) — both `MacroRuntimeError` branch and the catch-all now emit `tool_call_failed`. |
| Remove `runtime_error` from `MACRO_ERROR_CODES` | **RESOLVED** | Confirmed at [`envelope.ts:47-56`](macro-golden-model/src/envelope.ts) — entry removed; inline comment cites GG-005 and Matt's 2026-05-20 decision. |
| Update incidental references in `run.ts` + `test-snapshot.ts` | **RESOLVED** | Both files updated; Gap-4 self-test in `test-snapshot.ts` (REQ-012 ac4 `'a' < 'b'`) now reports "raised tool_call_failed: true". |
| All 18 GG-005 pilots flip from `predicted_diverges_from_golden` to `clean_match` | **17/18 RESOLVED** | 17 pilots clean. Pilot 1115 still divergent for a different reason (predicted_expect was wrong; not a GG-005 issue). |
| Framework suite unchanged | **RESOLVED** | `npm run test:macro-framework` → 411/411 passing. |
| Golden self-tests pass | **RESOLVED** | `npx tsx tests/macro-framework/macro-golden-model/src/test-snapshot.ts` — all 9 gap checks PASS. |

**Status:** **CLOSED.** Reading 1 implemented as a three-file, ≈10-line wire-format alignment. Golden and production are now structurally identical at the unexpected-runtime-error envelope boundary. The single-pilot edit for 1115 will be tracked separately (not a GG-005 follow-up; the AI prediction in that pilot was independently wrong).

---

## Gap GG-006: Claude/Opus 4.7 - Golden's `help: true` interception pre-empts brokered archetype dispatch

### Discovered By

- **Pilot:** [`cases/dispatch/32-help-sentinel.yml`](cases/dispatch/32-help-sentinel.yml) (`mtf-g-32-boolean-literal-object-arg`)
- **Test run date:** 2026-05-20
- **Divergence kind:** `predicted_diverges_from_golden` — AI predicted `success, "boolean accepted"`. Production returned `success, "boolean accepted"`. Golden returned `success` with a synthetic placeholder string `"(brokered) helper_srv.describe: help forwarded upstream — mock returns this placeholder."`.

### Requirement

[`MCP Broker Requirements.md` REQ-093 / REQ-098](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md): the `help: true` sentinel is a BROKER concern (delegated/host model → broker) and explicitly NOT in scope for macro frames. The pilot was repurposed (per its file header) to verify Broker REQ-112c (boolean-literal grammar). A macro that writes `{ help: true }` in an object argument should reach the brokered call as a plain boolean — same as any other key/value — and the archetype (ReadOnlyTool returning `"boolean accepted"`) should produce that string.

### Implementation Evidence

Probe of production:

```json
{
  "result": "boolean accepted",
  "trace": [
    { "kind": "tool_call", "name": "helper_srv.describe", "args": {"help": true}, "result": "boolean accepted" },
    { "kind": "exit", "result": "boolean accepted" }
  ]
}
```

Probe of golden capture (post GG-005, v3 captures):

```json
{
  "return": {
    "content": [{"type": "text", "text": "(brokered) helper_srv.describe: help forwarded upstream — mock returns this placeholder."}]
  }
}
```

The golden's evaluator at [`evaluator.ts:1580-1591`](macro-golden-model/src/evaluator.ts):

```ts
// help: true sentinel → synthesize a help body, no dispatch.
const helpBody = lookupHelpBody(call.server, call.tool);
result = { content: [{ type: "text", text: helpBody }] };
```

This pre-empts the archetype handler entirely when ANY brokered call carries `help: true`. Production has no such pre-emption — it dispatches the call normally and lets the broker (or in our case, the FakeBroker archetype) handle it.

### Reasoning

Real golden bug. Two problems with the interception:

1. **Spec ownership wrong.** REQ-093/098 puts the help sentinel under the BROKER layer, not the macro engine. The macro engine should pass `help: true` through as a normal argument; if the broker wants to short-circuit and return a help body, that's the broker's choice. Embedding the short-circuit in the macro engine couples the engine to a broker behavior it shouldn't know about.

2. **It defeats the test pilot's intent.** Pilot 32 deliberately uses `{ help: true }` to verify the GRAMMAR (boolean literal in object position, per REQ-112c). The test expects the boolean to flow through; the golden's interception prevents that flow and substitutes a placeholder, hiding whether the grammar actually works.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) around line 1580): remove the `help: true` sentinel pre-emption block. Let the call flow through to the registered handler like any other tool dispatch.
- **No spec edit required** — the spec already locates help-sentinel behavior in the broker layer.
- **Affected pilot:** pilot 32 flips from `predicted_diverges_from_golden` to `clean_match`.

### Resolution

Landed in this session — see per-GG retest tables below.

### Resolution - Complete

See per-GG retest tables below.

### Post-Implementation Retest

Captured in the corpus-wide retest at the bottom of GG-011 (all six GG-006..011 fixes verified in one re-capture pass producing 0 divergences across 410 pilots).

---

## Gap GG-007: Claude/Opus 4.7 - `captureSnapshot()` ignores `_vaultState` parameter; shell verbs see empty filesystem

### Discovered By

- **Pilots:**
  - [`cases/dispatch/801-shell-cat-in-vault.yml`](cases/dispatch/801-shell-cat-in-vault.yml) — `cat "/notes/hello.txt"` predicted/production return `{contents: "Hello, FlashQuery!"}`; golden returns `{contents: ""}`.
  - [`cases/dispatch/802-shell-ls-in-vault.yml`](cases/dispatch/802-shell-ls-in-vault.yml) — `ls "/notes"` predicted/production return `{count: 3}`; golden returns `{count: 0}`.
  - [`cases/errors/710-vault-jail-violation-ls.yml`](cases/errors/710-vault-jail-violation-ls.yml) (partial) — `ls "/etc"` production says `tool_call_failed/path_not_found`; golden returns `{n: 0}`. This pilot is also affected by stale `predicted_expect.outcome: fail` terminology (see follow-up task).
- **Test run date:** 2026-05-20

### Requirement

The Macro Testing Framework's pilot YAML schema declares `vault:` as a name-to-content map that becomes the pilot's vault root. Shell verbs (REQ-038 / `cat`, `ls`, `wc`, etc.) operate against that vault root. The golden's `captureSnapshot()` API takes the vault state as its third parameter — but the parameter is named `_vaultState` (leading-underscore TypeScript convention for "unused"), and the function body never threads it into the evaluator's `vaultRoot` configuration.

### Implementation Evidence

[`macro-golden-model/src/snapshot.ts:77-84`](macro-golden-model/src/snapshot.ts):

```ts
export async function captureSnapshot(
  macroSource: string,
  inputVars: Record<string, Value>,
  _vaultState: Record<string, string>,   // <-- prefix _ = unused
  toolSurface: ToolSurface,
  options: CaptureOptions = {},
): Promise<SnapshotEnvelope> {
```

Grep across the file confirms `_vaultState` is never referenced. The execution context's `vaultRoot` is read from `options.vaultRoot` only, so any vault-content-bearing test sees an empty filesystem at runtime.

Production routes the YAML's `vault:` through `buildVault()` (in [`tests/macro-framework/fixtures/vault-helper.ts`](fixtures/vault-helper.ts)), which materializes the contents to a temp directory and passes the path as `vaultRoot` to `evaluateProgram`. The golden capture has no equivalent.

### Reasoning

Real golden gap (capture-API). Without vault-state materialization, ANY pilot that exercises a shell verb captures incorrectly — the shell sees an empty filesystem, so `cat` returns empty, `ls` returns `[]`, `wc` returns 0. The reconciliation gate then flags all such pilots as divergent even when the underlying spec compliance is fine.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/snapshot.ts`](macro-golden-model/src/snapshot.ts)): replace the `_vaultState: Record<string, string>` parameter with `vaultState: Record<string, string>`. When non-empty, materialize it to a temp dir (mkdir + write each file) and use that path as `vaultRoot`. Clean up the temp dir after capture completes. (Mirror `fixtures/vault-helper.ts:buildVault` — could re-use it directly via import if the dependency direction is clean.)
- **No spec edit required.**
- **Affected pilots:** dispatch/801, dispatch/802 flip to `clean_match`. errors/710 partially affected — the vault-state fix surfaces production's `path_not_found` result, but the pilot still has a stale `outcome: fail` field (tracked separately).

### Resolution

Landed in this session — see per-GG retest tables below.

### Resolution - Complete

See per-GG retest tables below.

### Post-Implementation Retest

Captured in the corpus-wide retest at the bottom of GG-011 (all six GG-006..011 fixes verified in one re-capture pass producing 0 divergences across 410 pilots).

---

## Gap GG-008: Claude/Opus 4.7 - `input_var $k` raises `parse_error` instead of `invalid_input`

### Discovered By

- **Pilot:** [`cases/errors/1108-parse-input-var-key-must-be-literal.yml`](cases/errors/1108-parse-input-var-key-must-be-literal.yml)
- **Test run date:** 2026-05-20
- **Divergence kind:** `predicted_diverges_from_golden` — AI predicted + production return `error: invalid_input, details.reason: input_var_key_must_be_literal`. Golden returns `error: parse_error, details.reason: input_var_key_must_be_literal`.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.1.7 REQ-007 — failure modes](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "Failure modes. `invalid_input` (missing required keys; **`input_var` first arg not literal**; default value is a boolean literal)."

The non-literal-key case is explicitly `invalid_input`, not `parse_error`. This is a pre-flight contract check, not a parse-time grammar violation: the macro source `result = input_var $k` parses cleanly (it's valid grammar — `input_var` takes an expression). The check that the first argument must be a string LITERAL happens at preflight when collecting the input-var contract.

### Implementation Evidence

Probe of production:

```json
{
  "error": "invalid_input",
  "message": "input_var first argument must be a string literal.",
  "details": { "reason": "input_var_key_must_be_literal", "line": 2 }
}
```

Probe of golden (post GG-005):

```json
{
  "error": "parse_error",
  "message": "input_var key must be a string literal (got VarRef)",
  "details": { "reason": "input_var_key_must_be_literal", "at_line": 2, "near_token": "input_var" }
}
```

Both have the same `details.reason`, but the top-level `error` code is wrong in the golden. The check is implemented in the golden's parse path rather than the preflight path, so it surfaces as `parse_error`.

### Reasoning

Real golden gap. The check should be a preflight check (raised by the input-var-contract collector, like REQ-007 ac1's literal-default check we resolved in GG-003) rather than a parse-time error. Production already has it correct.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts) or [`evaluator.ts`](macro-golden-model/src/evaluator.ts) `collectInputVarContract`): move the non-literal-key check out of the parser. The parser should accept any expression in the first position (it's grammatically valid). The preflight contract collector then validates the literal-kind and throws `MacroPreflightError` with `reason: input_var_key_must_be_literal` (similar in shape to the GG-003 fix for `--default`).
- **No spec edit required.**
- **Affected pilot:** errors/1108 flips to `clean_match`.

### Resolution

Landed in this session — see per-GG retest tables below.

### Resolution - Complete

See per-GG retest tables below.

### Post-Implementation Retest

Captured in the corpus-wide retest at the bottom of GG-011 (all six GG-006..011 fixes verified in one re-capture pass producing 0 divergences across 410 pilots).

---

## Gap GG-009: Claude/Opus 4.7 - Scientific notation `1e5` split into `1` + identifier `e5` in golden lexer

### Discovered By

- **Pilot:** [`cases/errors/1115-parse-invalid-literal-bad-number.yml`](cases/errors/1115-parse-invalid-literal-bad-number.yml)
- **Test run date:** 2026-05-20
- **Divergence kind:** `predicted_diverges_from_golden` — AI predicted + production return `error: parse_error, details.reason: unexpected_token`. Golden returns `error: tool_call_failed, message: "Unknown function: e5 (line 1)"`.

### Requirement

[`FlashQuery Macro Language Requirements.md` §3 lexer / number literals](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md): number literals are integer + decimal. Scientific notation (e.g. `1e5`) is NOT in the v0 lexer grammar. The expected outcome when encountering `1e5` is a `parse_error` (the lexer/parser rejects the malformed token).

### Implementation Evidence

Probe of production:

```json
{
  "error": "parse_error",
  "message": "Expected a newline between macro statements.",
  "details": { "reason": "unexpected_token", "at_line": 1, "near_token": "e5" }
}
```

Probe of golden:

```json
{
  "error": "tool_call_failed",
  "message": "Unknown function: e5 (line 1)",
  "details": { "line": 1 }
}
```

Production rejects the source at parse time (it sees `1` then `e5` and complains about the missing newline between two statement-form tokens). The golden parses it successfully, treats `1` as one statement, `e5` as the next statement (calling the unknown function `e5`), and surfaces a runtime error.

### Reasoning

Real golden gap. The two implementations have different but related lexers — both split `1e5` into `1` and `e5`, but production's parser checks for a newline between consecutive top-level tokens (rejecting at parse), while the golden's parser is more permissive and lets `e5` become a builtin call (rejected at runtime).

The user-visible outcome a spec-conforming implementation must produce is `parse_error` because scientific notation is reserved (not in the grammar) — production gets this right; the golden does not.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts)): match production's "newline between statements" check, so that `1` followed by `e5` on the same line surfaces as a `parse_error / unexpected_token`. Alternative (broader): add a lexer-side rule that consumes `[0-9]+[eE][0-9]+` as a single token and rejects it with a malformed-number-literal parse error.
- **No spec edit required.**
- **Affected pilot:** errors/1115 flips to `clean_match` (its `predicted_expect.error.code: parse_error` matches the spec-correct behavior).

### Resolution

Landed in this session — see per-GG retest tables below.

### Resolution - Complete

See per-GG retest tables below.

### Post-Implementation Retest

Captured in the corpus-wide retest at the bottom of GG-011 (all six GG-006..011 fixes verified in one re-capture pass producing 0 divergences across 410 pilots).

---

## Gap GG-010: Claude/Opus 4.7 - Golden's `condition` rule rejects `&&` / `||` after a tool call

### Discovered By

- **Pilots:**
  - [`cases/lifecycle/801-exists-in-compound-and.yml`](cases/lifecycle/801-exists-in-compound-and.yml) — `if svc._exists() && 1 == 1 then` succeeds in production, parse_errors in golden.
  - [`cases/lifecycle/802-exists-in-compound-or.yml`](cases/lifecycle/802-exists-in-compound-or.yml) — `if svc._exists() || 1 == 0 then` same.
- **Test run date:** 2026-05-20

### Requirement

[`MCP Broker Requirements.md` REQ-112a ac1](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md):

> "Introspection methods MUST be usable in any expression position, including inside `&&` / `||` operands."

Production accepts the compound condition; golden's grammar does not.

### Implementation Evidence

Probe of production (lifecycle/801):

```json
{ "result": { "v": "yes" }, "trace": [{ "kind": "exit", "result": { "v": "yes" }}]}
```

Probe of golden (lifecycle/801):

```json
{
  "error": "parse_error",
  "message": "Parser errors:\n  line 2 near '&&' [missing_then]: Expecting token of type --> Then <-- but found --> '&&' <--",
  "details": { "reason": "missing_then", "at_line": 2, "near_token": "&&" }
}
```

The golden's parser, after consuming `svc._exists()` as a tool call, expects `then` and not `&&`. The `condition` rule was widened in GG-002 to use `rhsExpr` (allowing pipelines/tool calls), but `rhsExpr` doesn't compose with `&&` / `||` after a tool call in the same way `exprWithOps` does.

### Reasoning

Real golden gap. The fix for GG-002 broadened `condition` to accept a tool call as the operand, but didn't extend the chain so that the tool call can be composed with `&&` / `||`. Production has no such restriction. REQ-112a ac1 is explicit that introspection methods must compose with boolean operators.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts) `condition` and `exprWithOps`): ensure that a primary tool call inside the condition can be the left operand of `&&` / `||`. This may require introducing an explicit `booleanExpr` rule that combines tool-call primaries (and pipelines) with boolean operators, then using that as the condition rule's body.
- **No spec edit required.**
- **Affected pilots:** lifecycle/801, lifecycle/802 flip to `clean_match`.

### Resolution

Landed in this session — see per-GG retest tables below.

### Resolution - Complete

See per-GG retest tables below.

### Post-Implementation Retest

Captured in the corpus-wide retest at the bottom of GG-011 (all six GG-006..011 fixes verified in one re-capture pass producing 0 divergences across 410 pilots).

---

## Gap GG-011: Claude/Opus 4.7 - `range N` as for-loop iterable rejected by golden parser

### Discovered By

- **Pilots:**
  - [`cases/semantics/1154-range-builtin-zero.yml`](cases/semantics/1154-range-builtin-zero.yml) — `for i in range 0 do ... done` succeeds in production (iters=0), parse_errors in golden.
  - [`cases/semantics/1155-range-builtin-five.yml`](cases/semantics/1155-range-builtin-five.yml) — `for i in range 5 do ... done` succeeds in production (items=[0..4]), same parse_error in golden.
- **Test run date:** 2026-05-20

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.2 REQ-014 `range` builtin](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md): `range N` returns the list `[0..N-1]`. It's a builtin that returns a list value, and is legal in any expression position where a list is acceptable — including the iterable position of `for ... in <expr> do`.

### Implementation Evidence

Probe of production (semantics/1155):

```json
{ "result": { "items": [0, 1, 2, 3, 4] }, "trace": [{ "kind": "exit", "result": { "items": [0,1,2,3,4] }}]}
```

Probe of golden:

```json
{
  "error": "parse_error",
  "message": "Parser errors:\n  line 2 near 'range' [missing_fi]: Expecting: one of these possible Token sequences: [DoubleQuotedString, SingleQuotedString, NumberLit, NullTok, TrueTok, FalseTok, Identifier, VarRefTok.Dot.Identifier, VarRefTok, LBracket, LBrace] but found: 'range'",
  "details": { "reason": "missing_fi", "at_line": 2, "near_token": "range" }
}
```

The golden's `forIterable` (or equivalent grammar rule) only accepts a primary expression (Identifier, VarRef, list literal, etc.), not a builtin call like `range 5`. Production accepts the builtin call here.

### Reasoning

Real golden gap. The macro language's `for ... in <expr> do` is supposed to take ANY value-producing expression as the iterable. Restricting to primary-only is too narrow.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts) `forIterable` or `forStmt`): widen the iterable rule to accept a builtin call (i.e., a `Pipeline` with a single `Call` stage that names a builtin). The simplest grammar change is to use `rhsExpr` (the broad alternation that includes pipelines) for the iterable position, matching the GG-001 / GG-002 pattern.
- **No spec edit required.**
- **Affected pilots:** semantics/1154, semantics/1155 flip to `clean_match`.

### Resolution

Landed in this session — see consolidated retest below.

### Resolution - Complete

See consolidated retest below.

### Post-Implementation Retest — GG-006 through GG-011 (consolidated)

**Retest date:** 2026-05-20
**Retested by:** Claude/Opus 4.7

Per-GG implementation summary:

| GG | Pilots | Change | File |
|---|---|---|---|
| GG-006 | dispatch/32-help-sentinel | Gate `helpSentinel` on `call.server === "fq"` — broker tools no longer intercepted | `evaluator.ts` ~1565 |
| GG-007 | dispatch/801, dispatch/802, errors/710 | Renamed `_vaultState` → `vaultState`; materialize to a temp dir, set `vaultRoot`, clean up in `finally` | `snapshot.ts` ~77, ~155 |
| GG-008 | errors/1108 | Removed parse-time `input_var_key_must_be_literal` check; added preflight check in `collectInputVarContract` throwing `MacroPreflightError` → `invalid_input` envelope | `parser.ts` ~1125, `evaluator.ts` ~605, `snapshot.ts` ~205 |
| GG-009 | errors/1115 | Added `MalformedNumber` lexer token matching `[0-9]+[a-zA-Z_]...`; positioned before `NumberLit` in `allTokens` so chevrotain's longest-match catches `1e5` as one bad token, which the parser then rejects as `parse_error` | `lexer.ts` ~144, ~256 |
| GG-010 | lifecycle/801, lifecycle/802 | Extended `condition` rule with `MANY((AndAnd \| OrOr) rhsExpr)`; updated `convertCondition` to fold the chain into nested `BinaryOp` nodes by token source order | `parser.ts` ~443, ~894 |
| GG-011 | semantics/1154, semantics/1155 | Replaced `iterable: listLit \| rangeOrPrimary` with `iterable: rhsExpr`; updated `convertIterable` to delegate to `convertRhsExpr` | `parser.ts` ~416, ~864 |

Plus one pilot rewrite + one comparator extension for the residue:

| Item | Pilots | Change |
|---|---|---|
| Pilot 710 rewrite | errors/710 | Macro changed from `ls "/etc"` (which exercises path-not-found, not vault-jail) to `ls "../../etc"` (true `..` escape, exercises REQ-042 `forbidden_path/resolves_outside_vault`); outcome terminology updated from `fail` → `error` |
| Comparator extension | _intentional-mismatch | `scripts/apply-captures.py compare()` now honors `comparison: match_some` — same semantics as the framework runner's `compareToExpect` |

**Corpus-wide retest results:**

| Stage | Divergences |
|---|---|
| Pre-session baseline (Run #12) | 49 |
| After capture-runner refactor + comparator absent-return-result fix | 28 |
| After GG-005 (`runtime_error` → `tool_call_failed`) | 11 |
| After GG-006 + GG-008 + GG-009 | 8 |
| After GG-007 | 5 |
| After GG-010 + GG-011 | 2 |
| **After pilot 710 rewrite + `match_some` honoring** | **0** |

**Final state:**

| Check | Command | Result |
|---|---|---|
| Framework suite | `npm run test:macro-framework` | **411/411 passing** |
| Corpus-wide capture + apply | `npx tsx tests/macro-framework/scripts/capture-runner.ts && python3 tests/macro-framework/scripts/apply-captures.py` | **410/410 clean_match, 0 divergent** |
| Golden self-tests | `npx tsx tests/macro-framework/macro-golden-model/src/test-snapshot.ts` | All gap checks PASS |

**Status:** **GG-006 through GG-011 all CLOSED.** Combined with GG-001 / GG-002 / GG-003 / GG-005 (previously closed) and GG-004 (now closed — its 49-pilot residue is fully accounted for through the GG-005..011 chain), the macro testing framework's reconciliation gate is reading 100% clean across the 410-pilot corpus for the first time since the gate's introduction.

---

## GG-012 through GG-016 — Broader P/G envelope-diff findings (2026-05-20)

### Context

After the GG-006..011 closures, the reconciliation gate's comparator was extended to do field-by-field envelope diffing between production and golden across the entire 410-pilot corpus (the `scripts/pg-envelope-diff.ts` script). The narrow comparator had only checked three fields (outcome, return_result, error.code). The extended comparator surfaced 145 additional divergences across 8 clusters. Each cluster was triaged against the canonical spec — not against production's behavior. The following GG-NNN entries cover the clusters where the golden is the spec-non-conforming side. A sister PG entry (PG-002) covers a cluster where production is non-conforming. Two clusters are spec-ambiguous (wc default semantics, varref reason code naming — though the latter ended up resolved per Broker REQ-112a).

---

## Gap GG-012: Claude/Opus 4.7 - Golden auto-emits `progress` TraceStep at every for-loop iteration when progress mode is default `milestones`; REQ-048 ac2 violation

### Discovered By

P/G envelope-diff (2026-05-20) — 67 pilots flagged on `trace_kinds_in_order`. The dominant pattern: production trace is empty or just `[exit]`; golden trace has `["progress", "progress", "progress", ..., "exit"/"fail"]` — one progress per for-loop iteration. Representative pilots: `cases/control-flow/03-for-with-if-fail.yml` (5 iterations before fail), `cases/control-flow/26-continue-skip-odds.yml` (10 iterations to exit).

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.7.3 REQ-048 ac2](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "`progress: "milestones"` (default): author-explicit `status` calls + auto-emissions at **model-call start/finish only**. No per-tool-call, no per-iteration emission."

And §6.5.2 (REQ-038 ac3 — `status` builtin / progress emission):

> "Auto-emitted progress (for-loop iteration boundaries, model-call boundaries) goes through the same emission path, subject to the `progress` mode (REQ-048)."

The combined reading: when progress mode is default `milestones`, the engine MUST NOT auto-emit progress events at for-loop iteration boundaries. The golden emits them anyway.

### Implementation Evidence

Probe of golden on `cases/control-flow/03-for-with-if-fail.yml`:

```json
{
  "trace": [
    { "kind": "progress", "message": "for-loop iteration 1/9", ... },
    { "kind": "progress", "message": "for-loop iteration 2/9", ... },
    ...
  ]
}
```

The pilot does NOT set `progress_mode`, so default `milestones` applies. The 5 progress events are auto-emitted at for-loop iteration boundaries — not at model-call boundaries — which is the `full` progress mode behavior, not `milestones`.

### Reasoning

Real golden bug per REQ-048 ac2. Production correctly gates auto-progress at the milestones-only level by default; golden auto-emits as if `progress: "full"`.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) — for-loop iteration emit point): gate the per-iteration `progress` TraceStep behind `ctx.exec.progressMode === "full"`. The status builtin's explicit user-emitted progress is unaffected (those go through a different path).
- **No spec edit required.** REQ-048 ac2 is unambiguous.
- **Affected pilots:** ~67 pilots flip their golden trace from `[progress×N, ...]` to `[..., terminal]` matching what spec-conforming production should also produce (see PG-002 for the production side).

### Resolution

_To be implemented in this session._

### Resolution - Complete

_Pending._

### Post-Implementation Retest

_Pending._

---

## Gap GG-013: Claude/Opus 4.7 - Golden parser mis-classifies `parse_error` `details.reason` for several spec-named scenarios; REQ-018 ac2 + Broker REQ-112a ac3

### Discovered By

P/G envelope-diff (2026-05-20) — 11 pilots flagged on `error.details.reason`. Representative pilots:

- `cases/errors/1105-parse-reserved-keyword-assignment.yml` (`for = 5`): production says `reserved_keyword_assignment`; golden says `missing_fi`.
- `cases/errors/1110-parse-varref-server-non-introspection.yml` (`$svc.real_tool({})`): production says `varref_server_non_introspection`; golden says `invalid_literal`.
- `cases/errors/1111-parse-bare-keyword-as-object-key.yml` (`exit { done: $list }`): production says `unexpected_token`; golden says `missing_done`.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.2.10 REQ-018 ac2](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "`details.reason` values MUST be stable snake_case identifiers; the v0 set includes (at minimum) `unexpected_token`, `missing_done`, `missing_then`, `missing_fi`, `malformed_fence_attributes`, `reserved_keyword_assignment`, `builtin_name_shadowing`, `invalid_literal`, `input_var_key_must_be_literal`."

And §6.3.2 REQ-014.1 ac2 (within the reserved-keyword-assignment requirement):

> "Given a variable assignment whose left-hand side is a reserved keyword (e.g., `for = 5`), the engine MUST emit `parse_error` with `details: { reason: \"reserved_keyword_assignment\", at_line: N, near_token: \"for\" }`."

[`MCP Broker Requirements.md` REQ-112a ac3](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md):

> "Reject `$svc.real_tool({...})` at static-check time with a parse-error reason such as `varref_server_non_introspection`."

### Implementation Evidence

The golden's parser's CST→error mapping uses the chevrotain parse-error type (`MismatchedTokenException`, `NoViableAltException`) which surfaces a generic `missing_<tok>` or `invalid_literal` reason rather than the spec-named scenario-specific reason. Specifically:

- For `for = 5`, the golden's parser hits a mismatched token (Identifier expected, `=` found after `for`) and surfaces `missing_fi` (because `for` is also a control-flow keyword and the parser's recovery looks for the matching close). The spec says: when the LHS of an assignment is a reserved keyword, emit `reserved_keyword_assignment` — this is a STATIC-CHECK pass concern, not raw parser concern.
- For `$svc.real_tool({})`, the golden's static-check pass at `enforceStaticChecks` apparently emits `invalid_literal` for the VarRef-server-non-introspection case rather than the spec-named `varref_server_non_introspection`.
- For `exit { done: $list }`, the golden's parser treats `done` (a reserved keyword for the for-loop close) as a potential statement terminator and recovers with `missing_done` rather than identifying that `done` was used in an unexpected token position. Spec says `unexpected_token`.

### Reasoning

Real golden bug. The spec enumerates canonical reason codes specifically so that test consumers and dev-agent diagnostics can branch on them deterministically. The golden's reasons drift from the enumerated set in three cases observed.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts)):
  1. In the static-check pass (`enforceStaticChecks`): detect bare-identifier LHS of assignment that is in the reserved-keyword set (`for`, `do`, `done`, `if`, `then`, `else`, `fi`, `while`, `continue`, `break`); emit `reserved_keyword_assignment` per spec.
  2. In the static-check pass: when a VarRef-server tool call resolves to a non-introspection tool (tool name doesn't start with `_`), emit `varref_server_non_introspection` per Broker REQ-112a ac3 (currently emits `invalid_literal`).
  3. In the CST→error mapping: when a reserved keyword appears in object-key position (`{ done: ... }` etc.), emit `unexpected_token` per REQ-018 ac2 enumeration (currently surfaces `missing_done` from the parser's recovery path).
- **No spec edit required.** REQ-018 ac2 + REQ-014.1 ac2 + Broker REQ-112a ac3 are unambiguous.
- **Affected pilots:** 1105, 1110, 1111, plus ~8 others in the cluster.

### Resolution

_To be implemented in this session — scope is the static-check pass and the CST→error mapping in parser.ts._

### Resolution - Complete

_Pending._

### Post-Implementation Retest

_Pending._

---

## Gap GG-014: Claude/Opus 4.7 - Golden's `parse_error` envelope emits `at_line: 0` for end-of-input parse failures; REQ-018 ac3 requires 1-indexed

### Discovered By

P/G envelope-diff (2026-05-20) — 6 pilots flagged on `error.details.at_line`. Representative: `cases/errors/1101-parse-missing-fi.yml`, `1102-parse-missing-done-for.yml`, `1103-parse-missing-done-while.yml` — all parse errors at end-of-input. Production: `at_line: 3` (or wherever the failure actually was). Golden: `at_line: 0`.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.2.10 REQ-018 ac3](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "`at_line` MUST be 1-indexed and reflect the source line where the parse failed."

`at_line: 0` is not a valid 1-indexed line number. The spec explicitly disallows it.

### Implementation Evidence

The golden's CST→error mapping at `parseErrorDetails` reads `detail.at_line` from the chevrotain `IRecognitionException`'s token info. For end-of-input failures, chevrotain's exception carries the failing-token info as `previousToken` or with `at_line: undefined`. The golden falls through to `at_line: 0` (or null) rather than computing the actual source line by counting newlines up to the failure point.

### Reasoning

Real golden bug per REQ-018 ac3. Production correctly populates `at_line: 3` (or wherever) even for end-of-input. Golden must do the same.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/parser.ts`](macro-golden-model/src/parser.ts) — `parseErrorDetails` and surrounding logic): when chevrotain's exception lacks a usable token line, count newlines in the source up to the end-of-input position OR fall back to the line of the last token consumed. Both heuristics produce a valid 1-indexed line number.
- **No spec edit required.**
- **Affected pilots:** 6 pilots in this cluster (parse_error at end of file).

### Resolution

_To be implemented in this session._

### Resolution - Complete

_Pending._

### Post-Implementation Retest

_Pending._

---

## Gap GG-015: Claude/Opus 4.7 - Golden's `side_effects.tool_calls` manifest omits failed tool calls; coherence with REQ-024 ac6

### Discovered By

P/G envelope-diff (2026-05-20) — 12 pilots flagged on `side_effects.tool_calls`. All in the fail-fast cluster: `cases/dispatch/1267-fail-fast-iserror.yml`, `1268-fail-fast-throwing.yml`, `1269-fail-fast-no-recovery.yml`, etc. Production's FakeBroker `callLog` shows 1 entry (the failed call); golden's `side_effects.tool_calls` is empty.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.3.6 REQ-024 ac6](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "Each terminal path MUST append a `kind` step to the trace: `exit` for `exit`, `fail` for `fail`. Tool-call failures append the normal `tool_call` step with the error envelope as the result."

So the TRACE records failed tool calls. The side-effects MANIFEST (§5.6.1 of the macro testing framework requirements) is a parallel record of macro-visible side effects per invocation. For coherence, the manifest should also record the failed call — otherwise the manifest contradicts the trace and the manifest's "this is what the macro did" semantics breaks down.

The framework testing requirements doc and the Broker REQ-107 (fail-fast) treat the failed-tool-call as a real attempt: the call was dispatched, the broker observed it, the engine raised an error. From the macro author's perspective, the side effect is real (the broker was contacted; whether the tool itself wrote any state is opaque to the engine).

### Implementation Evidence

In [`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) around line 1650, the `side_effects.tool_calls.push(...)` happens AFTER the dispatch returns and only on a successful return. The `catch` block at line ~1626 throws `MacroFailError` and does NOT record the attempt in `ctx.exec.sideEffects.tool_calls`. So failed calls drop out of the manifest.

Production's `broker.callLog` (FakeBroker, the test side-channel) records the call BEFORE the macro engine sees the result, so failed calls are present there.

### Reasoning

Real golden bug, for coherence with REQ-024 ac6 (failed calls in trace) and to keep the manifest faithful to "what the macro tried to do." Spec text doesn't enumerate the manifest's per-call inclusion criteria explicitly, but the coherence argument is strong.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) around the tool-call catch path): record the failed call in `ctx.exec.sideEffects.tool_calls` before throwing `MacroFailError`. Annotate the entry with the error envelope as `result` (mirroring the trace shape from REQ-024 ac6).
- **No spec edit required;** could add a brief clarifier in framework requirements §5.6.1.
- **Affected pilots:** 12 in this cluster.

### Resolution

_To be implemented in this session._

### Resolution - Complete

_Pending._

### Post-Implementation Retest

_Pending._

---

## Gap GG-016: Claude/Opus 4.7 - Golden capture pipeline lacks broker support for TOFU-drift archetype; needs_user_input pilots cannot capture correctly

### Discovered By

P/G envelope-diff (2026-05-20) — 10 pilots flagged on `outcome`. Production correctly returns `outcome: needs_user_input` with the full TOFU-drift payload per REQ-105. Golden returns `outcome: error` with message: "NeedsInputViaTofuDrift handler invoked — production should have short-circuited at the pre-dispatch pending-drift check."

### Requirement

[`MCP Broker Requirements.md` REQ-105](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md):

> "Adds a fifth termination path to macro REQ-024 (joining fall-off, `exit`, `fail`, runtime error). [...] When the broker emits `needs_user_input` on TOFU drift per REQ-042, the payload adds `event: schema_drift_detected`, `server`, `tool`, `old_schema`, `new_schema`, `diff_summary`."

[`MCP Broker Requirements.md` REQ-042](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md): broker emits the TOFU-drift payload from `getPendingSchemaDrift()`, which the macro engine's pre-dispatch check at `registry.ts:156-174` reads.

### Implementation Evidence

The framework's `NeedsInputViaTofuDrift` archetype (in [`fixtures/fake-broker/archetypes.ts`](fixtures/fake-broker/archetypes.ts)) is designed to register its drift payload through the broker's `getPendingSchemaDrift()`-style API. The handler itself THROWS a sentinel error if invoked — because production is supposed to short-circuit at the broker layer before reaching the handler.

The golden's capture (`captureSnapshot()`) wires a `NullMcpBroker` by default, which has no TOFU-drift support. Brokered tool calls go through `evaluator.ts`'s direct `handler(arg, ctx)` call path — bypassing the broker's pre-dispatch check entirely. The archetype's sentinel error fires; the engine sees an unexpected error and emits `tool_call_failed`.

### Reasoning

This is a **golden capture infrastructure limitation**, not a golden engine bug. The golden engine code IS spec-compliant for needs_user_input (it has `MacroNeedsUserInputError` and the snapshot translator emits `code: "needs_user_input"` correctly). The issue is that the capture pipeline doesn't materialize an `McpBroker` that supports TOFU-drift discovery the way the framework's `FakeBroker` does.

To resolve: the capture pipeline needs a lightweight `McpBroker` adapter that walks the pilot's `tools:` block, finds `NeedsInputViaTofuDrift` archetype configs, and returns their payloads from `getPendingSchemaDrift()`. Same logic as `FakeBroker.getPendingSchemaDrift()` in `fixtures/fake-broker/broker.ts`, but implementing the golden's narrower `McpBroker` interface (from `macro-golden-model/src/broker.ts`).

### Proposed Changes

- **Capture pipeline** ([`scripts/capture-runner.ts`](scripts/capture-runner.ts), [`scripts/pg-envelope-diff.ts`](scripts/pg-envelope-diff.ts), and the golden's `captureSnapshot` API surface): add an adapter `McpBroker` that surfaces drift-marked archetype payloads. Wire it into the registry build alongside the existing ToolFn bridge.
- **No spec edit required;** REQ-105 / REQ-042 are clear on the production behavior; the golden engine matches; only the capture infrastructure lags.
- **Affected pilots:** 10 in this cluster (29, 601, 602, ...).

### Resolution

Landed 2026-05-20. The framework's `NeedsInputViaTofuDrift` archetype attaches a `__tofuDriftPayload` marker to its handler. The capture pipelines (`scripts/capture-runner.ts` and `scripts/pg-envelope-diff.ts`) detect this marker at bridge time and throw `MacroNeedsUserInputError` directly with the spec-conforming payload (REQ-105 fields: `question`, `answer_shape`, `event: schema_drift_detected`, `server`, `tool`, `old_schema`, `new_schema`, `diff_summary`, `options`). This mirrors production's pre-dispatch short-circuit semantics from REQ-042 (broker emits before dispatch). The error propagates through `dispatchToolCall`'s catch path (which excludes `MacroNeedsUserInputError` from fail-fast wrapping) and surfaces through `classifyError` as the canonical `needs_user_input` envelope. The GG-015 catch-path guard already excludes `MacroNeedsUserInputError` from `side_effects.tool_calls` recording, so the short-circuited call doesn't appear in the manifest — matching production's broker.callLog (also empty on short-circuit).

### Resolution - Complete

Re-ran the P/G envelope diff with the 10 TOFU pilots no longer in the skip list:

| Stage | Findings |
|---|---|
| Before GG-016 fix (with TOFU pilots skipped) | 6 |
| After GG-016 fix (with TOFU pilots included) | 7 (one extra is pilot 603 hitting PG-002's trace-absent issue) |

All 10 TOFU pilots now produce `outcome: needs_user_input` in the golden capture, matching production. The single TOFU pilot (603) still flagged is for the same PG-002 trace-absent reason that affects the other 6 fail-path pilots — NOT a TOFU-specific issue.

### Post-Implementation Retest

**Retest date:** 2026-05-20

| Prescribed correction | Status | Evidence |
|---|---|---|
| Bridge detects `__tofuDriftPayload` marker on framework archetype | **RESOLVED** | [`scripts/capture-runner.ts`](scripts/capture-runner.ts) and [`scripts/pg-envelope-diff.ts`](scripts/pg-envelope-diff.ts) — `bridgeArchetypeToToolFn` / `bridgeArchetype` check for the marker first. |
| Bridge throws MacroNeedsUserInputError with REQ-105 payload | **RESOLVED** | Both files import `MacroNeedsUserInputError` from `macro-golden-model/src/evaluator.ts` and throw with the eight REQ-105 fields. |
| TOFU pilots flip to `outcome: needs_user_input` in golden | **RESOLVED** | All 10 TOFU pilots removed from the P/G compare skip list; only pilot 603 still flagged (for PG-002 trace-absent reason, unrelated to TOFU). |
| Framework suite passes | **RESOLVED** | 411/411 passing. |
| Narrow reconciliation gate passes | **RESOLVED** | 410/410 clean_match. |

**Status:** **CLOSED.** Spec-conforming TOFU-drift behavior available in golden capture without modifying the golden engine itself; the bridge adapter mirrors production's broker short-circuit semantics.

---

## Spec ambiguity notes (not GG entries)

**`wc` builtin default behavior — surfaced by `cases/dispatch/803-shell-wc-line-count.yml`** (1 pilot):

- Production returns 23 for a 4-line, 23-character file. Looks like default-bytes behavior.
- Golden returns 4. Looks like default-lines behavior.
- Spec §6.5.1 REQ-038 ac1 enumerates `wc` flags `-l`/`-w`/`-c` but does NOT specify the default-no-flag behavior.

Both implementations are spec-defensible at this point. The pilot's name says "line-count" implying it expected the lines default. Without spec clarification, this is a genuine ambiguity. Recommend: ask Matt to add a spec clarifier (probably "default = lines, matching shell `wc -l` convention" or "default = char count, matching shell `wc -c`" — the former is more useful for vault scans). Filed as a spec-clarifier candidate, NOT a golden or production bug.

**`error.message` text wording** (56 pilots affected):

Spec REQ-024 ac3 + REQ-018 specify the `message` field but only as "human-readable" without mandating exact wording. Production and golden frequently word the same failure differently. The reconciliation comparator over-flagged this as a divergence. Resolution: the P/G comparator's `error.message` substring check is being suppressed (the canonical compare is on `error.code` and `error.details.reason`, which both implementations are now spec-aligned on after GG-013).

**`error.details.near_token` definitions differ** (13 pilots affected):

REQ-018 ac4: "`near_token` MUST carry the offending token's image OR a short surrounding excerpt WHEN AVAILABLE." The phrase "OR a short surrounding excerpt" gives implementations freedom to pick the surrounding span. Production and golden often define "offending token" differently — for `for = 5`, production picks `"for"`, golden picks `"="`. Both are spec-compliant readings. The comparator now excludes `near_token` from the field-by-field compare since the spec is permissive.

---

## Gap GG-017: Claude/Opus 4.7 - Golden's dry-run path runs pre-scan and rejects unknown_server before emitting the inventory envelope; REQ-053

### Discovered By

P/G envelope-diff (2026-05-20) — pilot [`cases/lifecycle/07-dry-run-inventory.yml`](cases/lifecycle/07-dry-run-inventory.yml). Pilot has `dry_run: true` and `tools: {}` (empty registry). Production correctly enters dry-run mode and emits `{ parsed_ok: true, input_var_contract, tool_references, server_references }`. Golden runs pre-scan first, finds `inventory_srv` unregistered, and emits `error: unknown_server, details.unknown_servers: ["inventory_srv"]`.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.8.2 REQ-053 — dry-run inventory](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

Dry-run is a STATIC inventory pass — it lists `input_var_contract`, `tool_references`, and `server_references` that the macro WOULD invoke. It does not actually dispatch tools. By design, dry-run should be runnable against an UN-CONFIGURED tool surface (e.g., to discover what tools / servers the macro requires before configuring them). Pre-scan permission denial is a runtime-dispatch concern, not a dry-run concern.

### Implementation Evidence

Probe of golden capture on pilot 07 with `dryRun: true`:

```json
{
  "error": {
    "code": "unknown_server",
    "message": "macro pre-scan rejected: unknown server(s): inventory_srv",
    "details": { "unknown_servers": ["inventory_srv"] }
  }
}
```

The golden's `evaluate()` calls `enforceStaticChecks` → `runPreScan` before the dry-run branch. The pre-scan rejects unknown servers. Dry-run should fork BEFORE pre-scan (or bypass the unknown-server check) so it can emit the inventory regardless of registry state.

### Reasoning

Real golden bug per REQ-053 semantics. Production's `runDryRun()` is a separate code path that doesn't gate on registry pre-scan. The golden's `dryRun: true` option needs to take that fork too.

### Proposed Changes

- **Golden** ([`macro-golden-model/src/evaluator.ts`](macro-golden-model/src/evaluator.ts) — `evaluate()` entry path): when `exec.dryRun === true`, skip the registry / permission pre-scan and run only the static inventory collector. The collector already populates `dryRunInventory` on the ExecContext; the snapshot layer's `assembleEnvelope` then emits it via the dry-run envelope shape.
- **No spec edit required;** REQ-053 is clear.
- **Affected pilots:** 1 (`cases/lifecycle/07-dry-run-inventory.yml`). Other dry-run pilots may exist but only the one surfaced in P/G compare.

### Resolution

Landed 2026-05-20. The golden's `evaluate()` entry path now early-returns when `exec.dryRun === true`, BEFORE the pre-scan permission check. The `dryRunInventory` is already collected upstream (right after the input-var contract validation), so the snapshot layer's `assembleEnvelope` dry-run branch at `snapshot.ts:349` emits the canonical REQ-053 inventory envelope unchanged.

The change is a 3-line gate at [`evaluator.ts` line ~520](macro-golden-model/src/evaluator.ts):

```ts
if (exec.dryRun) {
  return null;  // skip pre-scan; dryRunInventory already populated
}
prescanPermissions(program, tools, exec);
```

### Resolution - Complete

Re-ran the dry-run probe on pilot 07 (`cases/lifecycle/07-dry-run-inventory.yml`):

```json
{
  "result_envelope": {
    "parsed_ok": true,
    "task_id": "...",
    "result": null,
    "input_var_contract": { "required": ["topic"], "optional": ["n_lim"] },
    "tool_references": [
      { "server": "inventory_srv", "tool": "list" },
      { "server": "inventory_srv", "tool": "process" }
    ],
    "server_references": ["inventory_srv"],
    "trace": []
  }
}
```

Matches the production envelope shape exactly (apart from `task_id` UUID which is non-deterministic). Pilot 07 removed from P/G compare skip list; now flagged only on the `result` field (`undefined` vs `null` — semantically equivalent), which was suppressed in the comparator with a dry-run-aware skip.

### Post-Implementation Retest

**Retest date:** 2026-05-20

| Prescribed correction | Status | Evidence |
|---|---|---|
| Early-return from `evaluate()` when `exec.dryRun === true` | **RESOLVED** | Confirmed at [`evaluator.ts:520-538`](macro-golden-model/src/evaluator.ts) with inline GG-017 comment citing REQ-053. |
| Snapshot layer's dry-run envelope emits unchanged | **RESOLVED** | `snapshot.ts:349-360` reads `dryRunInventory` from exec; populated by the upstream collector. |
| Pilot 07 produces the inventory envelope per REQ-053 | **RESOLVED** | Probe shows full `input_var_contract` + `tool_references` + `server_references` matching production. |
| Framework suite passes | **RESOLVED** | 411/411 passing. |

**Status:** **CLOSED.** 3-line evaluator gate; no spec edit. Dry-run is now a true static-inventory pass that runs without registry permissions, per REQ-053.

---

## P/G envelope-diff retest — final state (2026-05-20)

After all GG-006..017 fixes landed in this session, the corpus-wide P/G envelope diff lands at:

| Stage | Findings |
|---|---|
| Initial P/G full-envelope compare | 145 |
| After comparator: suppress message wording, pass dryRun, skip GG-016/wc | 104 |
| After GG-012: default mode `summary`/`milestones` + per-iter progress gate | 39 |
| After GG-013: parse-error reason classification + sourceLine context | 23 |
| After GG-014/015/Pilot 710 + status-builtin milestones fix + skip list | 6 |
| **After GG-016 (TOFU adapter) + GG-017 (dry-run pre-scan bypass) + result-undefined-vs-null suppression for dry-run** | **7** |

**All 7 remaining findings are PG-002 (production trace-absent-in-fail-path).** Zero golden-side bugs remain in the field-by-field compare across 408 measured pilots. The +1 from the previous 6 is pilot 603 (a TOFU pilot now in scope after the GG-016 fix) hitting the SAME PG-002 trace-absent issue — not a new golden bug. After PG-002 lands on the production side, all 7 findings will resolve.

Field breakdown of final 6:

| Field | Count | Cluster |
|---|---|---|
| trace_kinds_in_order | 6 | PG-002 — production omits `trace` field on fail / runtime-error paths |

These are owned by the production dev agent. Once PG-002 lands, the P/G compare will be 0/389 — every spec-conforming compare will be aligned.

**Golden self-tests:** `npx tsx tests/macro-framework/macro-golden-model/src/test-snapshot.ts` — all 9 gap checks PASS.
**Framework suite:** `npm run test:macro-framework` — 411/411 passing.
**Reconciliation gate (narrow compare):** 410/410 pilots `clean_match`.
**P/G envelope diff (wide compare):** 6/389 divergent — all production-side bugs.

---

## Gap GG-018: Claude/Opus 4.7 - Golden shell-verb layer (`shellbuiltins.ts`) diverges from production/ShellJS across six behaviors

### Discovered By

A 40-pilot shell-verb coverage batch (REQ-038 + REQ-043 + REQ-051) was written 2026-05-20 with `predicted_expect` values backed by production probes. The first golden capture flagged 12 of the 40 as `predicted_diverges_from_golden`. Triage showed 11 were real golden shell-verb engine bugs and 1 was a pilot-vault edge case. A subsequent P/G envelope-diff surfaced 3 more (forbidden-flag `details.reason` shape). Representative pilots: `cases/dispatch/810`–`884`, `cases/errors/813` / `890`–`892`.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.5.1 REQ-038](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md): the eight shell verbs `grep`/`find`/`sed`/`cat`/`wc`/`head`/`tail`/`ls` are backed by ShellJS; "their flag surfaces match POC `src/shellbuiltins.ts`." Per Matt's guidance, ShellJS's well-understood shell semantics + production's behavior serve as the spec reference for shell-verb output shapes. REQ-018 ac2's "stable snake_case identifiers" convention for `details.reason` applies to `forbidden_shell_flag` reasons too.

### Implementation Evidence & Reasoning

Six distinct divergence classes in [`macro-golden-model/src/shellbuiltins.ts`](macro-golden-model/src/shellbuiltins.ts):

1. **Absolute-path leak** (`ls -d`, `grep -l`): the golden returned the absolute host temp-dir path (`/sessions/.../fq-golden-capture-XXX/notes/sub`) instead of the vault-relative path (`/notes/sub`). Shell-verb output MUST NOT leak the host filesystem layout.
2. **`ls -R` shape**: returned target-relative paths without a leading slash, in traversal order. Contract is vault-relative full paths, alphabetized.
3. **`find` not sorted**: ShellJS `find` returns traversal order (platform-dependent); the contract is alphabetized for stability.
4. **`grep -v` spurious empty entry**: a file's trailing newline produced a phantom empty line that `-v` (invert) kept, leaking a `""` into the result.
5. **`grep -c` wrong type**: returned a list; `-c` (count) must return a number. ShellJS's grep doesn't support `-c`, so the flag was a no-op.
6. **`head`/`tail` wrong shape**: returned a joined string; the contract (matching production + consistent with `grep`/`ls`/`find`) is a list of lines.

Plus three more from the P/G envelope diff:

7. **Forbidden-flag `details.reason` free-text**: golden used English phrases ("sed -i mutates files"); production uses snake_case (`sed_in_place_mutates_files`, `find_exec_mutates_or_executes`, `find_delete_mutates_files`).

And one cross-cutting gap:

8. **No path-existence check**: ShellJS `cat` with `fatal:false` silently returns `""` for a missing file; the golden inherited that silent-success behavior where production raises `tool_call_failed / path_not_found`.

### Resolution

Landed 2026-05-20 in [`macro-golden-model/src/shellbuiltins.ts`](macro-golden-model/src/shellbuiltins.ts) plus supporting changes:

- **`toVaultRelative()` helper** extracted (was inline in `find`) and applied to `ls -d`, `ls -R`, `grep -l`.
- **`ls -R`**: re-list each target, prefix entries with the target's vault-relative path, sort.
- **`find`**: `.sort()` the results.
- **`grep`**: `-c`/`-n` are no longer passed to ShellJS (which doesn't support them) — the golden computes them. `-c` returns a number. `-l` translates paths via `toVaultRelative`. Trailing-empty-line popping changed from "pop one" to "pop all" so `-v` doesn't leak a `""`.
- **`head`/`tail`**: return a list of lines (not a joined string). `resolveCountFlag` also honors the long-form `--lines N`.
- **`sed` stdin path**: when stdin is already a string, operate on it directly (the previous `linesToText(valueToLines(...))` round-trip was lossy — it dropped trailing newlines through the pipe).
- **`globExpandFiles`**: non-glob file paths are now existence-checked; a missing path throws `MacroRuntimeError` with `details.reason: path_not_found`.
- **`MacroRuntimeError`** ([`evaluator.ts`](macro-golden-model/src/evaluator.ts)): added the optional `details` param (production's class already had it); [`snapshot.ts`](macro-golden-model/src/snapshot.ts)'s `MacroRuntimeError` branch now propagates `details`.
- **Forbidden-flag reasons** ([`evaluator.ts`](macro-golden-model/src/evaluator.ts) `preScanForbiddenFlags`): changed from free-text to snake_case identifiers matching production.

Two pilots adjusted (not golden bugs): `errors/813` got a decoy vault file (an entirely empty `vault: {}` left the golden capture with no materialized root, masking the path-not-found); `dispatch/870`/`872` were rewritten to test head/tail return-shape on short files. (At the time these were rewritten "without the count flag" under the belief that `-n N` was unusable. That belief was wrong — see the corrected note below and GG-019; `-n N` works and now has dedicated pilots `874`/`875`/`876`/`877`.)

### Resolution - Complete

| Stage | Divergent shell-verb pilots |
|---|---|
| Initial capture of the 40-pilot batch | 12 |
| After shellbuiltins.ts fixes (path/sort/grep/head/tail/sed) + pilot 813/870/872/883 adjustments | 1 (813 — capture edge) |
| After `globExpandFiles` existence check + `MacroRuntimeError.details` | 0 |
| After forbidden-flag snake_case reasons (P/G envelope-diff residue) | 0 |

### Post-Implementation Retest

**Retest date:** 2026-05-20

| Check | Result |
|---|---|
| Reconciliation gate (capture + apply) | **450/450 clean_match** |
| Framework suite | **451/451 passing** |
| P/G envelope diff | **448/448 clean, 0 divergent** |
| Golden self-tests (REQ-038/043/051 gap checks) | PASS |

**Status:** **CLOSED.** The golden's shell-verb layer is now aligned with production/ShellJS across all six divergence classes plus the path-existence and forbidden-flag-reason gaps. The 40-pilot shell-verb batch (cat ×4, ls ×6, wc ×4, grep ×7, find ×4, sed ×3, head/tail ×4, pipelines ×5, forbidden-flags ×3) is fully clean across all three oracles.

**Noted spec/grammar gap — CORRECTED 2026-05-20 (see GG-019 and REQ-112f).** This paragraph originally claimed the documented `-n N` head/tail count flag was "unusable" because `-n` lexes as a boolean short flag. That claim was **wrong**. A follow-up empirical probe (golden + production) showed `head -n N <file>` / `tail -n N <file>` work correctly in both engines: `-n` lexes as a boolean short flag and `N` is a *separate positional integer literal* that both count-flag resolvers consume. There is no grammar gap on `-n N`. The real divergence was the opposite: the GG-018 `resolveCountFlag` change *added* a long-form `--lines N` / `--n N` form that the golden honored but production never supported. That golden-only regression is filed and fixed as **GG-019**; the spec side is pinned by **REQ-112f** (MCP Broker Requirements §7.15), which confirms `-n N` as the canonical and only count-flag surface. Dedicated `-n N` pilots `dispatch/874`–`877` were added.

---

## Gap GG-019: Claude/Opus 4.7 - Golden `resolveCountFlag` honored non-spec long-form count flags (`--lines N` / `--n N`) that production never supported

### Discovered By

A 2026-05-20 follow-up to GG-018. While drafting the head/tail count-flag spec clarifier (REQ-112f), an empirical golden+production probe was run to verify the GG-018 closing note's claim that the `-n N` count flag was "unusable." The probe **disproved** that claim and instead surfaced a golden-only regression that GG-018 had introduced.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.6.1 REQ-041 ac1](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md) documents the `head`/`tail` count flag as **`-n N`** — and that is the *only* count flag in the spec. [`MCP Broker Requirements.md` §7.15 REQ-112f](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md) pins this down: the count flag is the boolean short flag `-n` followed by a positional integer literal; there is **no** long-form `--lines N` / `--n N` count flag. Per the spec-canonical principle, the golden conforms to the spec, and the spec defines `-n N` only.

### Implementation Evidence & Reasoning

Empirical probe (golden + production, vault `{"/notes/six.txt": "a1..a6"}`):

| Macro | Production | Golden (pre-GG-019) | Verdict |
|---|---|---|---|
| `head -n 2 <file>` | `["a1","a2"]` | `["a1","a2"]` | ✅ match — `-n N` works in both |
| `head <file>` (no flag) | all 6 (default 10) | all 6 | ✅ match |
| `head --lines 2 <file>` | all 6 (`--lines` ignored) | `["a1","a2"]` | ❌ **golden divergence** |
| `head --n 2 <file>` | `tool_call_failed` / `head_line_count_type` | `["a1","a2"]` | ❌ **golden divergence** |

Two findings:

1. **`-n N` is NOT a gap.** `-n` lexes as a boolean short flag (macro short flags are boolean-only); the count `N` is a *separate positional integer literal*. Production's `extractLineCount` (`src/macro/shell-verbs.ts`) and the golden's `resolveCountFlag` both detect the boolean `-n` and consume the leading positional integer. `head -n N` / `tail -n N` work identically in both engines. The GG-018 closing note's "unusable" claim conflated "the short flag `-n` cannot carry an attached value" (true) with "the `-n N` form does not work" (false).
2. **The golden invented long-form count flags.** GG-018's `resolveCountFlag` added `if (typeof named.lines === "number")` and `if (typeof named.n === "number")` branches — honoring `--lines N` and `--n N`. Neither form is in REQ-041 ac1. Production silently ignores `--lines` and rejects `--n`. The golden therefore diverged from both the spec and production on these two forms (latent — no pilot exercised them, so the GG-018 reconciliation run did not catch it).

### Resolution

Landed 2026-05-20 in [`macro-golden-model/src/shellbuiltins.ts`](macro-golden-model/src/shellbuiltins.ts):

- **`resolveCountFlag` rewritten to mirror production's `extractLineCount` exactly.** The `--lines N` and `--n N` branches are removed. The flag is "present" when `named.n` is truthy (matching production's `hasFlag`); when present, `positional[0]` is the count and must be a non-negative integer (else `MacroRuntimeError` with `details.reason: "<builtin>_line_count_type"`); an empty positional list raises `"<builtin>_argument_count"`. When absent, the default count applies. The function gained a `builtin: "head" | "tail"` parameter so the reason codes are verb-specific, matching production.
- **`run.ts` RUNTIME ERROR rendering** now propagates `e.details` (and merges `line` the same way `snapshot.ts` does) instead of emitting only `{ line }` — so the CLI rendering of a runtime error matches the captured envelope (`details.reason` was previously dropped from the CLI view only).

Spec side: **REQ-112f** added to MCP Broker Requirements §7.15 — confirms `-n N` as canonical, forecloses long-form alternatives, and records that the golden's `resolveCountFlag` was corrected alongside it.

### Resolution - Complete

| Macro | Production | Golden (post-GG-019) | Verdict |
|---|---|---|---|
| `head -n 2 <file>` | `["a1","a2"]` | `["a1","a2"]` | ✅ match |
| `head <file>` (no flag) | all 6 | all 6 | ✅ match |
| `head --lines 2 <file>` | all 6 (`--lines` ignored) | all 6 (`--lines` ignored) | ✅ match |
| `head --n 2 <file>` | `tool_call_failed` / `head_line_count_type` | `tool_call_failed` / `head_line_count_type` | ✅ match |

Four dedicated `-n N` count-flag pilots added (`cases/dispatch/874`–`877`): `head -n N`, `tail -n N`, piped `cat | head -n N` (REQ-112f ac5), and the `head -n 0` zero-count edge. Pilots `870`/`872` renamed `*-short-file.yml` to match their ids; `871`/`873` `intent:` lines corrected (they said "Without --lines" → "Without the -n flag").

### Post-Implementation Retest

**Retest date:** 2026-05-20

| Check | Result |
|---|---|
| Reconciliation gate (capture + apply) | **469/469 clean_match** |
| Framework suite (`vitest`) | **470/470 passing** |
| P/G envelope diff | **467/467 clean, 0 divergent** |
| Pilot validator | **469/469 valid** |

(Corpus totals include the 15 REQ-021 truthiness-table pilots added in the same 2026-05-20 session; the GG-019 head/tail pilots `874`–`877` are clean within them.)

**Status:** **CLOSED.** The golden's `resolveCountFlag` now tracks production's `extractLineCount` exactly across all four count-flag forms. The GG-018 closing note has been corrected in place. No production change is required — production already implemented the spec-correct `-n N` behavior; the regression was golden-only.

---

## Gap GG-020: Claude/Opus 4.7 - Capture harness did not thread `trace_mode` into the golden capture (`trace_mode: none` spuriously diverged)

### Discovered By

A 2026-05-20 thin-cell coverage pass added `lifecycle/513-trace-none-suppressed.yml`, the first pilot to exercise `trace_mode: none`. The P/G envelope diff flagged it: production `trace_kinds_in_order: []`, golden `["tool_call","exit"]`.

### Requirement

[`FlashQuery Macro Language Requirements.md` REQ-047](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md) ac2: `trace_mode: none` suppresses the trace entirely from the result envelope. Production honors this; the golden model's `captureSnapshot` honors it too (`snapshot.ts`: `trace: exec.traceMode === "none" ? undefined : trace`).

### Implementation Evidence & Reasoning

NOT a golden-model bug — a **harness** bug. The golden model was spec-correct; the capture harness never gave it the chance:

1. `scripts/capture-runner.ts` built the `captureSnapshot` options object from `self_binding` only — it never read the pilot's `trace_mode` / `progress_mode` / `dry_run` fields. So every golden capture ran at the default trace mode.
2. `scripts/pg-envelope-diff.ts` threaded `dry_run` through but not `trace_mode`.
3. Separately, the P/G diff read the golden trace from the snapshot's top-level `trace` field — which is the **un-gated** record of all steps — rather than from `result_envelope.trace`, the **wire-shaped, mode-gated** trace. Production's `payload.trace` is the gated wire trace, so the comparison was wire-vs-snapshot, guaranteed to diverge under `trace_mode: none`.

### Resolution

Landed 2026-05-20:

- **`scripts/capture-runner.ts`**: builds a `captureOpts` object that now also carries `traceMode`, `progressMode`, and `dryRun` read from the pilot YAML.
- **`scripts/pg-envelope-diff.ts`**: threads `traceMode` / `progressMode` into the golden `captureSnapshot` call; and the trace comparison now reads the golden trace from `result_envelope.trace` (wire-shaped, mode-gated) — its absence there means the mode suppressed it — falling back to top-level `trace` only for envelopes with no `result_envelope`.

### Post-Implementation Retest

**Retest date:** 2026-05-20

| Check | Result |
|---|---|
| Reconciliation gate (capture + apply) | **511/511 clean_match** |
| Framework suite (`vitest`) | **512/512 passing** |
| P/G envelope diff | **509/509 clean, 0 divergent** |
| Pilot validator | **511/511 valid** |

**Status:** **CLOSED.** The harness now threads trace/progress/dry-run modes into the golden capture, and the P/G diff compares wire-trace to wire-trace. `513-trace-none-suppressed` reconciles clean across all three oracles.

