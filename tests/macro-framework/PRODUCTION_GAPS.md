---
status: active
fq_title: FlashQuery Production Gaps — Discovered via Macro Testing Framework
fq_status: active
fq_tags:
  - '#pipeline/ready-for-dev'
  - '#type/gap-analysis'
  - '#scope/production'
fq_created: '2026-05-19T00:00:00+00:00'
fq_updated: '2026-05-19T00:00:00+00:00'
fq_id: macro-framework-production-gaps
---

# FlashQuery Production Gaps — Discovered via Macro Testing Framework

## REQUIRED SPEC REFERENCES — read these when triaging any divergence

**Every gap entry below cites a REQ-NNN from one of these two specifications. When triaging a new divergence to determine whether it's a production bug, golden bug, or spec ambiguity, the spec is the tiebreaker — never infer from implementations.**

1. **Macro Language Requirements (canonical, archived):**
   `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Archive/Implemented/Macro Language (17-May-2026)/FlashQuery Macro Language Requirements.md`
   Covers REQ-001 through REQ-063 (lexer, grammar, parser, scope rules, builtins, error envelopes, dispatch model, pre-scan, dry-run, termination paths).

2. **MCP Broker Requirements (active, includes macro-engine extensions):**
   `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md`
   §7.15 covers REQ-103 through REQ-112e (macro-engine extensions: `_self` binding, `continue`/`break`, `needs_user_input`, brokered tool coercion, fail-fast, argument passthrough, deep-probe `_exists()`, concurrent-macro safety, VarRef server slot, if-scope flat, boolean literals, missing-field-null, input_var boolean defaults).

**If either file cannot be found at those paths during triage, STOP and ask the user where the current specs live.** Do NOT proceed with classification by inference. Specs may have moved, been renamed, or graduated to a different location; a stale path is worse than a missing one.

# FlashQuery Production Gaps — Discovered via Macro Testing Framework

This document tracks **real production gaps in FlashQuery** discovered through test runs of the Macro Testing Framework (`tests/macro-framework/`). These are NOT golden-model issues, NOT AI-prediction errors, and NOT framework affordance gaps — they are concrete deviations between the production macro engine and the canonical specification.

Each gap is filed so an AI development agent can pick it up, fix the production code, and the framework can re-validate the fix against the same pilot that surfaced it.

Source documents this gap log references:

- [`FlashQuery Macro Language Requirements.md`](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md) — REQ-001..063 (archived, canonical for shipped macro engine)
- [`MCP Broker Requirements.md`](../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Requirements.md) — REQ-103..118 macro-engine extensions
- Macro Testing Framework requirements: [`tests/macro-framework/`](.)
- Eval log (discovery context): [`_skill-eval-log.md`](_skill-eval-log.md)

## How this document works

Each entry uses a `Gap PG-NNN` numbered ID (PG = Production Gap). The structure mirrors `MCP Broker Gap Analysis.md` but the trigger is a **test run** that surfaced a divergence via the reconciliation gate (AI prediction ⊥ Golden ⊥ Production), not a development phase review.

The gap title identifies the LLM that authored the analysis, using the form `Gap PG-NNN: <Model/Version> - <short descriptive title>`. If multiple models analyze the same gap, append their findings as additional analyses rather than replacing earlier ones.

Workflow:

1. **Discovery** — the reconciliation gate in the macro testing framework surfaces a divergence. After spec verification, if production deviates from spec it lands here.
2. **AI Dev Agent picks up the gap** — implements the fix in production, fills in the `AI Dev Agent Resolution` section.
3. **Validation** — the framework re-runs the pilot(s) that surfaced the gap. If they pass cleanly (reconciliation gate clean, all three oracles agree), the gap is marked `Resolution - Complete`.

A gap stays open until both the implementation evidence AND the test pilot agree the fix has shipped.

## Gap Entry Template

```md
## Gap PG-NNN: <Model/Version> - Short Descriptive Title

### Discovered By

Reference to the pilot(s) that surfaced this gap (e.g., `cases/dispatch/912-smoke-failover-both-unreachable.yml`), the test run date, and the divergence kind (`AI ⊥ Production`, `Golden ⊥ Production`, `AI+Golden ⊥ Production`, etc.).

### Requirement

The REQ(s) / INV(s) / spec section the production behavior violates. Quote the relevant acceptance criteria text.

### Implementation Evidence

Concrete evidence from production source code — file paths, line numbers, and the offending code path. Cite the test pilot's captured envelope and the divergent expected envelope.

### Reasoning

Why this is a real production gap rather than a framework affordance or golden bug. Include the spec-text quote that pins the correct behavior, the user-visible impact, and any related invariants (INV-NN) that are also affected.

### Proposed Changes

- Implementation change (file paths, function/symbol names)
- Test plan: which pilot(s) flip from divergent to clean reconciliation, and any additional coverage needed
- Documentation: REQ clarifications, framework README notes, or eval-log entries

### AI Dev Agent Resolution

(To be filled by the dev agent when the fix lands.) Description of the fix that was applied, the files touched, and the behavior now in place. Cite specific file paths and tests added or updated.

### Resolution - Complete

(To be filled when the framework re-runs the pilot and the reconciliation gate is clean.) Verified with `npm run test:macro-framework -- <pilot ID>`, `npm test`, `npm run build`. Reconciliation gate now reports `predicted_matched_captured: true` AND `captured_matches_production: true`.
```

---

## Gap PG-001: Claude/Opus 4.7 - Permission Pre-Scan Bypassed When Engine Invoked Without Registry; REQ-028 ac1+ac5, INV-07

### Discovered By

- **Pilot:** [`cases/dispatch/912-smoke-failover-both-unreachable.yml`](cases/dispatch/912-smoke-failover-both-unreachable.yml)
- **Test run date:** 2026-05-19
- **Divergence kind:** `AI ⊥ Golden` (AI prediction matched production runtime behavior; golden capture matched the spec-strict behavior)
- **Related pilots that exhibit the same path:** any pilot with an empty or absent `tools:` block that references brokered server names in its macro source.

The reconciliation gate flagged that AI-predicted `expect` (and production's actual envelope) reported `outcome: fail, error.code: macro_aborted` (the runtime `fail` builtin firing inside the macro), whereas the golden's `captureSnapshot()` reported `outcome: error, error.code: unknown_server` from the permission pre-scan refusing to dispatch to unregistered servers. After spec verification, the golden is spec-correct and production is the deviating implementation.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.4.2 REQ-028 — Static permission pre-scan](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> **REQ-028 ac1.** "The pre-scan MUST walk the entire AST (statements, expression-position pipelines, for/while body, if/else branches) collecting every `(server, tool)` tuple referenced via the namespaced-call form."
>
> **REQ-028 ac5.** "The pre-scan MUST run after parse but before any statement executes. No partial side effects on permission failure."

And the load-bearing invariant from §4:

> **INV-07.** "The macro engine MUST NOT execute any tool call when the permission pre-scan finds a denied or unknown tool reference; partial mutation is not permitted."

REQ-027 ac4-ac5 also define the relevant failure envelopes:

> **REQ-027 ac4.** "When `<server>` does not resolve in the registry, the response is `{ error: \"unknown_server\", details: { server: \"<name>\" } }`."
>
> **REQ-027 ac5.** "When `<server>` resolves but `<tool>` is not in its `tools` map, the response is `{ error: \"unknown_tool\", details: { server, tool, available: [...] } }`."

Spec posture: pre-scan is **mandatory**, **unconditional**, **runs before any statement executes**, and `unknown_server` is one of the canonical refusal envelopes it can produce. There is no exception in the spec for "no registry was provided"; an empty/absent registry should fail pre-scan against every unknown server reference.

### Implementation Evidence

Production code path that bypasses pre-scan when no registry is supplied — [`src/macro/evaluator.ts:369-380`](../../src/macro/evaluator.ts):

```ts
preScanForbiddenShellFlags(program);
preflightProgram(program);
const inputVarContract = collectInputVarContract(program);
validateInputVars(inputVarContract, context.inputVars);
if (context.toolRegistry && context.allowedToolNames) {
  const permissionError = preScanToolReferences({
    program,
    registry: context.toolRegistry,
    allowlist: context.allowedToolNames,
    ...
  });
  if (permissionError) {
    throwExpectedToolResult(permissionError);
  }
}
```

The `if (context.toolRegistry && context.allowedToolNames)` guard silently **skips** the permission pre-scan when either is undefined. Both shell-flag pre-scan (`preScanForbiddenShellFlags`, line 365) and AST preflight (`preflightProgram`, line 366) run unconditionally; only the tool-permission pre-scan is gated. This is the offending divergence: per REQ-028 ac5, pre-scan must run before any statement executes — without exception for missing registry.

Framework call site that exposes the bypass — [`tests/macro-framework/runner.ts:321-380`](runner.ts):

```ts
// Build a tool registry from `tools:` for prescan + dispatch.
const reg = buildFrameworkRegistry(tc.tools, broker);
...
const result = await evaluateProgram(parsed.program, {
  ...(reg ? { toolRegistry: reg.registry, allowedToolNames: reg.allowedToolNames } : {}),
  ...
});
```

And [`tests/macro-framework/framework-registry.ts:57-61`](framework-registry.ts):

```ts
export function buildFrameworkRegistry(
  tools: ToolsBlock | undefined,
  broker: FakeBroker | null,
): BuiltRegistry | null {
  if (!tools || Object.keys(tools).length === 0) return null;
  ...
}
```

When a pilot has no `tools:` block, the framework passes neither `toolRegistry` nor `allowedToolNames`, so production's `if` guard silently skips pre-scan and lets the macro run — reaching `primary_srv._exists()` at runtime, where the FakeBroker (or any introspection probe) returns `false`, and the inner `fail "Neither ..."` builtin fires.

Captured pilot envelopes — production (current) vs. golden (spec-correct):

| Field | Production runtime (current) | Golden `captureSnapshot()` (spec-correct per REQ-028) |
|---|---|---|
| `outcome` | `fail` | `error` |
| `error.code` | `macro_aborted` | `unknown_server` |
| `error.message` | `"Neither primary_srv nor backup_srv is reachable."` | `"macro pre-scan rejected: unknown server(s): primary_srv, backup_srv"` |
| pre-scan ran | NO | YES |
| reaches `_exists()` | YES | NO |

### Reasoning

This is a direct contract violation of REQ-028 ac5 ("MUST run after parse but before any statement executes") and INV-07 ("MUST NOT execute any tool call when the permission pre-scan finds a denied or unknown tool reference"). The current guard's "no registry → skip pre-scan" semantic isn't authorized by the spec.

Three concrete impacts:

1. **Macros can dispatch to (or introspect) servers the host hasn't authorized when the caller forgets to pass a registry.** This subverts the layered defense in REQ-028 (pre-scan) + REQ-029 (dispatch backstop). A buggy caller that constructs `evaluateProgram` without the registry plumbing gets silent permission bypass, not a loud failure. INV-07 expressly forbids "any tool call" from running in this case; today, the engine reaches runtime tool dispatch.

2. **The `unknown_server` error envelope is never emitted for the empty-registry case.** Per REQ-027 ac4 the envelope `{ error: "unknown_server", details: { server: ... } }` should be the surface signal for "you referenced a server we don't know about." Today, the surface signal is whatever the macro's runtime fallback path happens to produce — for the failover-style macro in pilot 912 it's `macro_aborted`, but the spec calls for `unknown_server`. Different consumers (host UI, scenario tests, the broker's audit log) see misleading outcomes.

3. **The test framework's reconciliation gate caught this silently for months.** Pilot 912 was passing because the framework's test-runtime `expect` matched what production produces today, and AI prediction (which models production behavior, not spec) agreed. The gate's three-oracle structure (AI ⊥ Golden ⊥ Production) is what finally surfaced it: the golden, which is spec-derived, dissented. This is exactly the failure mode the reconciliation gate was designed to catch — AI + Production conspire to look right when the spec says otherwise.

This is a contained change in production. The fix is to make the guard run pre-scan unconditionally, treating a missing/empty registry as an empty allowlist (every brokered server reference becomes `unknown_server`).

### Proposed Changes

- **Implementation — evaluator guard** ([`src/macro/evaluator.ts:369-380`](../../src/macro/evaluator.ts)): replace the `if (context.toolRegistry && context.allowedToolNames)` guard with unconditional pre-scan invocation. When `toolRegistry` is undefined, build a fresh empty `ToolRegistry`. When `allowedToolNames` is undefined, build a fresh empty allowlist. Pre-scan against the empty surfaces produces `unknown_server` for every brokered reference, which is the correct spec-prescribed envelope.

  The dispatch-time backstop (REQ-029) at line 847-850 has the same shape and may need parallel treatment, but it's defense-in-depth: pre-scan running unconditionally means the backstop never fires in practice.

- **Implementation — option-defaulting** ([`src/macro/evaluator.ts:329-332`](../../src/macro/evaluator.ts) inside `createInvocationContext`): defaulting `allowedToolNames` to `undefined` is the source of the optionality. After the fix, the pre-scan call site should explicitly default to `new Set()` (empty allowlist) when not supplied, ensuring REQ-028 ac5 is unconditional rather than conditional on a caller flag.

- **Test pilot** — [`cases/dispatch/912-smoke-failover-both-unreachable.yml`](cases/dispatch/912-smoke-failover-both-unreachable.yml): flip `expect.outcome` from `fail` (with `error.code: macro_aborted`) to `error` (with `error.code: unknown_server` and a message matching the pre-scan rejection format). The pilot's `intent:` description should also be updated to reflect that the spec-strict path is being exercised (not the framework-bypass path). The reconciliation block should then report `predicted_matched_captured: true` once the AI prediction is updated to match.

- **Test plan / coverage** — add an explicit pilot variant that constructs `evaluateProgram` with an empty `toolRegistry: {}` and `allowedToolNames: new Set()` to confirm the pre-scan envelope is emitted as `unknown_server` exactly per REQ-027 ac4 — verifying the fix isn't sensitive to whether the caller passes empty collections vs. omits the option entirely.

- **Documentation** — add a note in the framework README that pilots which previously relied on "no tools: block → no pre-scan" semantics will see their behavior change once PG-001 lands; the recommended migration is to explicitly declare brokered servers in `tools:` (even with a no-op archetype like `JSONTextTool`) or to assert against the pre-scan envelope.

### AI Dev Agent Resolution

Verified PG-001 as accurate against `FlashQuery Macro Language Requirements.md` REQ-027 ac4-ac5, REQ-028 ac1/ac5, and INV-07. The production evaluator only ran `preScanToolReferences` when both `toolRegistry` and `allowedToolNames` were present in the invocation context. When callers invoked the engine without those registry options, the macro skipped the mandatory static tool pre-scan and could reach runtime dispatch or runtime failover logic instead of returning the canonical `unknown_server` envelope.

Fixed the evaluator in [`src/macro/evaluator.ts`](../../src/macro/evaluator.ts): `createInvocationContext` now defaults missing registry and allowlist inputs to empty collections, and `evaluateProgram` runs `preScanToolReferences` unconditionally after parse/preflight/input-var validation and before `execBlock`. Missing registry plumbing is therefore treated as an empty registry, so any brokered namespaced call resolves to the spec-correct `unknown_server` refusal before side effects. The runtime dispatch path also re-validates server existence, tool existence, and allowlist membership before using an injected `dispatchTool`, preserving the REQ-029 backstop for lower-level test and host integration callers.

Added regression coverage in [`tests/unit/macro-permission-prescan.test.ts`](../unit/macro-permission-prescan.test.ts) proving a macro invoked with no registry options but with an injected dispatcher returns `unknown_server` and never calls the dispatcher. Added `dispatchRegistry(...)` to [`tests/unit/macro-test-helpers.ts`](../unit/macro-test-helpers.ts) and updated unit tests that intentionally inject `dispatchTool` to provide explicit registry/allowlist surfaces. Updated [`cases/dispatch/912-smoke-failover-both-unreachable.yml`](cases/dispatch/912-smoke-failover-both-unreachable.yml) so the pilot now asserts the golden/spec-correct `unknown_server` result instead of the old runtime `macro_aborted` behavior.

Validation completed:

```bash
npm test -- tests/unit/macro-permission-prescan.test.ts
npm run test:macro-framework -- -t "mtf-d-912"
npm run test:macro-framework
npm test
npm run build
```

All commands passed. Full unit coverage reported 134 test files and 1926 tests passing; the macro framework reported 182/182 passing. The pilot-specific run passed with `mtf-d-912` selected. Note: Vitest rejects the previously documented `--grep` form for this suite, so the verified pilot command uses `-t "mtf-d-912"`.

### Resolution - Complete

Resolution complete. Pilot 912 now expects `outcome: error` with `error.code: unknown_server`, and its reconciliation metadata records `predicted_matched_captured: true`. Full macro framework, full unit test suite, and production build all pass after the fix. No regressions were found in pilots that declare `tools:`; they continue to pre-scan and dispatch through the registered tool surface as before.

### Post-Implementation Retest

**Retest date:** 2026-05-19
**Retested by:** Claude/Opus 4.7 (auditor re-verification pass)

**Punch-list resolution status:**

| Prescribed correction | Status | Evidence |
|---|---|---|
| Drop the `if (context.toolRegistry && context.allowedToolNames)` guard at `evaluator.ts:367-377` so pre-scan runs unconditionally | **RESOLVED** | Confirmed at [`src/macro/evaluator.ts:367-377`](../../src/macro/evaluator.ts) — `preScanToolReferences` now runs unconditionally before `execBlock`. |
| Default `toolRegistry` / `allowedToolNames` to empty collections in `createInvocationContext` | **RESOLVED** | Confirmed at [`src/macro/evaluator.ts:329-330`](../../src/macro/evaluator.ts) — `toolRegistry: options.toolRegistry ?? {}` and `allowedToolNames: new Set(options.allowedToolNames ?? options.allowlist ?? [])`. |
| Flip pilot 912's `expect:` to `error` / `unknown_server` and update its reconciliation block | **RESOLVED** | [`cases/dispatch/912-smoke-failover-both-unreachable.yml`](cases/dispatch/912-smoke-failover-both-unreachable.yml) `expect.outcome: error`, `expect.error.code: unknown_server`, `reconciliation.predicted_matched_captured: true`, `divergence_kind: resolved_production_gap`. |
| Explicit coverage that `evaluateProgram` with no registry options + injected dispatcher emits `unknown_server` | **RESOLVED DIFFERENTLY** | Prescription asked for a pilot variant in `cases/`; the dev agent landed it as a unit test at [`tests/unit/macro-permission-prescan.test.ts:255-271`](../unit/macro-permission-prescan.test.ts) ("`PG-001 runs pre-scan against an empty registry when evaluateProgram is invoked without registry options`"). The test invokes the engine with no registry, injects a spy dispatcher, asserts the `unknown_server` envelope, and asserts `dispatchTool` was never called — exactly the spec-coverage intent. Accepted as equivalent. |
| Framework README note about pilots that previously relied on "no `tools:` → no pre-scan" semantics | **NOT RESOLVED** | No update found in [`tests/macro-framework/README.md`](README.md). Impact is minimal — the only pilot that depended on the old semantics (912) has already been migrated to declare the spec-correct envelope, and the unit test fixture migration noted in the dev agent's resolution proves the new defaults are stable. Treating this as a low-priority follow-up rather than a blocker. |

**Executable verification (this retest):**

| Check | Command | Result |
|---|---|---|
| Macro pre-scan unit tests | `npm test -- tests/unit/macro-permission-prescan.test.ts` | 8/8 passing (includes the PG-001 regression case) |
| Macro engine unit suite | `npm test -- tests/unit/macro-permission-prescan.test.ts tests/unit/macro-evaluator.test.ts tests/unit/macro-parser.test.ts` | 77/77 passing |
| Full macro framework suite | `npm run test:macro-framework` | 182/182 passing |
| TypeScript noEmit | `npx tsc --noEmit` | Pre-existing errors outside the PG-001 surface; no new errors introduced at `evaluator.ts:329-330` or `367-377` |

**Status:** **CLOSED.** The two core production changes (unconditional pre-scan + empty-collection defaults) shipped exactly as prescribed, are covered by a dedicated regression unit test, and the discovery pilot (912) has been migrated to assert the spec-correct envelope. One minor documentation item is outstanding (framework README note) but does not affect correctness or coverage; it can be addressed separately or as part of the next framework doc pass.

---

## Gap PG-002: Claude/Opus 4.7 - Production envelope omits `trace` field for fail-path / runtime-error pilots; REQ-024 ac6 + REQ-047 ac2

### Discovered By

P/G envelope-diff (2026-05-20) — surfaced via 67 pilots flagged on `trace_kinds_in_order`. Representative pilots:
- [`cases/control-flow/03-for-with-if-fail.yml`](../../flashquery/tests/macro-framework/cases/control-flow/03-for-with-if-fail.yml) — production envelope: `{ "error": "macro_aborted", "message": "halt at 5", "details": { "line": 3 } }`. No `trace` field at all.
- [`cases/control-flow/04-while-with-fail.yml`](../../flashquery/tests/macro-framework/cases/control-flow/04-while-with-fail.yml) — same shape: error envelope, no trace.

Test run date: 2026-05-20.

Divergence kind: `Production ⊥ Spec`. Golden correctly emits `trace: [{ kind: "fail", ... }]`; production omits trace entirely on the fail path.

### Requirement

[`FlashQuery Macro Language Requirements.md` §6.3.6 REQ-024 ac6](../../../flashquery-product/Archive/Implemented/Macro%20Language%20%2817-May-2026%29/FlashQuery%20Macro%20Language%20Requirements.md):

> "Each terminal path MUST append a `kind` step to the trace: `exit` for `exit`, `fail` for `fail`. Tool-call failures append the normal `tool_call` step with the error envelope as the result."

And §6.7.2 REQ-047 ac2 (trace verbosity default):

> "`trace: "summary"` (default): every step is emitted but `args` and `result` are omitted from tool/model calls. Other fields (`kind`, `name`, `elapsed_ms`, `at`, `message`) remain."

And ac3 (the only mode where `trace` field is absent):

> "`trace: "none"`: the `trace` field MUST be **absent** from the response envelope (not an empty array — absent, signaling deliberate omission)."

Conclusion: when `trace_mode` is `summary` (default), the `trace` field MUST be present and MUST contain at least the terminal `fail` (or `exit` or `tool_call`) step. Production is emitting the envelope as if `trace_mode === "none"` were active, but the pilots don't set that mode.

### Implementation Evidence

Probe of production on `cases/control-flow/03-for-with-if-fail.yml`:

```json
{
  "error": "macro_aborted",
  "message": "halt at 5",
  "details": { "line": 3 }
}
```

No `trace` field. The macro is:

```
for n in 1..10 do
  if $n == 5 then
    fail "halt at 5"
  fi
done
echo "should not reach here"
```

Five for-loop iterations execute, then `fail` halts. The terminal `fail` step MUST appear in the trace per REQ-024 ac6. It does not.

Probe of golden on the same pilot:

```json
{
  "trace": [
    { "kind": "progress", ... },
    { "kind": "progress", ... },
    ...
    { "kind": "fail", "message": "halt at 5", ... }
  ]
}
```

(Golden also has its own bug here per GG-012 — emitting per-iteration progress when default mode is `milestones`. After GG-012 lands, golden's trace will be `[{kind: "fail", message: "halt at 5"}]`, which is what production should be emitting per spec.)

### Reasoning

Real production gap. The spec's REQ-047 ac2 explicitly makes `summary` the default mode and "every step is emitted" — that includes the terminal fail step per REQ-024 ac6. Production's envelope-shaping path is stripping the trace entirely on error paths, equivalent to forcing `trace_mode: "none"` for failures.

This breaks: (a) post-mortem debugging of fail paths (the trace was supposed to be the post-mortem record); (b) AI-agent self-correction loops that read the trace for failure attribution; (c) the test framework's `trace_kinds_in_order` assertions on fail pilots.

### Proposed Changes

- **Production** (likely [`src/macro/evaluator.ts`](../../../flashquery/src/macro/evaluator.ts) or the envelope-assembly path): on the fail / runtime-error path, preserve the trace built up to the failure point, append the terminal step (`fail` for `fail` builtin, `tool_call` with error result for tool failures), and include the trace in the error envelope. The `trace_mode === "none"` carve-out is the ONLY case where the trace field should be absent.
- **No spec edit required.** REQ-024 ac6 + REQ-047 ac2 are unambiguous.
- **Affected pilots:** 67 pilots in the `trace_kinds_in_order` cluster. Once both PG-002 (this entry, production fix) and GG-012 (golden fix) land, the P/G compare on this field will pass for nearly all of them.

### Resolution

Landed 2026-05-20 in this session.

Two changes in production:

1. **[`src/mcp/utils/response-formats.ts`](../../../flashquery/src/mcp/utils/response-formats.ts) — widen `ErrorEnvelope` type** to allow optional `trace?: unknown[]` and `warnings?: string[]`. This lets the existing `jsonExpectedError` / `jsonRuntimeError` helpers serialize these fields when callers populate them. `jsonRuntimeError`'s overload also updated to propagate the new fields (previously only `identifier` and `details` were relayed).

2. **[`src/macro/evaluator.ts`](../../../flashquery/src/macro/evaluator.ts) — `attachContextToError()` helper + apply to every error catch arm.** Mirrors the existing `buildSuccessPayload` pattern: when `context.traceMode !== 'none'` and trace has entries, attach the accumulated trace to the error envelope. Also attaches warnings if any. Applied to all 7 error catch arms (`MacroFailError`, `MacroNeedsUserInputError`, `MacroContinueSignal`/`MacroBreakSignal`, `MacroExpectedError`, `MacroCancellationError`, `MacroPreflightError`, `MacroRuntimeError`, plus the catch-all). The `MacroNeedsUserInputError` envelope is hand-built (REQ-105 shape with `task_id`/`reason`/`payload`); trace and warnings are now merged in the same way.

### Resolution - Complete

The terminal step appending was already correct in the catch arms (`pushTrace(context, { kind: 'fail', message })` for fail; `pushTrace(context, { kind: 'exit', result })` for exit; tool_call steps with error result are pushed by the dispatch code before `MacroRuntimeError` propagates). The only thing missing was carrying the accumulated trace into the response envelope. The fix is a 1-helper + 7-call-site change in `evaluator.ts` plus a 2-field type widening in `response-formats.ts`.

### Post-Implementation Retest

**Retest date:** 2026-05-20
**Retested by:** Claude/Opus 4.7

| Prescribed correction | Status | Evidence |
|---|---|---|
| Widen `ErrorEnvelope` to allow `trace?` and `warnings?` | **RESOLVED** | [`response-formats.ts:51-69`](../../../flashquery/src/mcp/utils/response-formats.ts) — `ErrorEnvelope` type updated with inline PG-002 comment citing REQ-024 ac6 + REQ-047 ac2/ac3. |
| `jsonRuntimeError` propagates `trace` / `warnings` | **RESOLVED** | [`response-formats.ts:185-195`](../../../flashquery/src/mcp/utils/response-formats.ts) — overload's spread now includes `trace` and `warnings`. |
| `attachContextToError` helper in evaluator.ts mirrors `buildSuccessPayload`'s trace gate | **RESOLVED** | [`evaluator.ts:1049-1078`](../../../flashquery/src/macro/evaluator.ts) — helper added with inline PG-002 comment citing the three REQs. |
| All 7 error catch arms route envelopes through `attachContextToError` | **RESOLVED** | [`evaluator.ts:385-484`](../../../flashquery/src/macro/evaluator.ts) — every catch arm updated. |
| Framework suite passes | **RESOLVED** | 411/411 passing post-fix. |
| Narrow reconciliation gate (AI ⊥ Golden) | **RESOLVED** | 410/410 clean_match. |
| Wide P/G envelope diff | **RESOLVED** | **0/408 divergent.** All 7 PG-002 pilots flipped clean. |
| Golden self-tests | **RESOLVED** | All 9 gap checks PASS. |

**Status:** **CLOSED.** Production now includes the accumulated trace (with the terminal step) in error envelopes per REQ-024 ac6 + REQ-047 ac2. The trace field is absent only when `trace: "none"` was explicitly requested per REQ-047 ac3. All 7 PG-002 pilots — covering `macro_aborted` (5), `tool_call_failed` (1), and `needs_user_input` (1) terminations — flipped to clean reconciliation against the spec-conforming golden.
