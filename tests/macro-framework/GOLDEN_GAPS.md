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

_(Pending — to be filled when the golden fix lands in this pass.)_

### Resolution - Complete

_(Pending — verification will re-run `captureSnapshot()` against pilot 920 and confirm the golden produces the spec-correct success envelope.)_

### Post-Implementation Retest

_(Pending — auditor pass will populate this with the per-correction status table and final CLOSED stamp.)_
