# Roadmap: FlashQuery Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-25)
- ✅ **v1.5 Full MVP** — Phases 10-16 (shipped 2026-03-27)
- ✅ **v1.6 Prep for Open Source** — Phases 17-21 (shipped 2026-03-30)
- ✅ **v1.7 Issues Resolution & Pre-Release Hardening** — Phases 22-25 (shipped 2026-03-31)
- ✅ **v1.8 Bug Fixes: Plugin Scope & Token Security** — Phases 28-29 (shipped 2026-04-01)
- ✅ **v1.9 MCP Tool Overhaul** — Phases 30-33 (shipped 2026-04-06)
- ✅ **v2.0 Doc Sync Overhaul** — Phases 36-40 (shipped 2026-04-07)
- ✅ **v2.1 Test Suite Recovery** — Phases 41-44 (shipped 2026-04-07)
- ✅ **v2.2 Status Model Refactor & Infrastructure Hardening** — Phases 45-48 (shipped 2026-04-08)
- ✅ **v2.3 HTTP Authentication & Interoperability** — Phases 49-52 (shipped 2026-04-09)
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54-60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- ✅ **v2.9 Filesystem Primitive Tools** — Phases 90-97 (shipped 2026-04-25)
- ✅ **v3.0 Native LLM Access** — Phases 98-106 (shipped 2026-04-30)
- ✅ **v3.1 Call Model With Reference** — Phases 107-111 (shipped 2026-05-05)
- ✅ **v3.2 Agentic LLM Tools** — Phases 112-120 (shipped 2026-05-07)
- ✅ **v3.3 MCP Tools Consolidation** — Phases 121-129 (shipped 2026-05-14)
- ◆ **v3.4 macro-support** — Phases 130-138 (planning started 2026-05-14)

## Current Milestone: v3.4 macro-support

**Goal:** Ship the FlashQuery Macro Language v0 and `call_macro` MCP tool so deterministic multi-step orchestration can run inside FlashQuery as one structured invocation.

**Source materials:**
- Requirements: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- Test plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`
- POC: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/`

## Phases

### Phase 130: Foundation, Metadata, Broker Shim, Archive Lock

**Goal:** Establish the additive response/type surface, register `call_macro` metadata and a scaffold handler, add the broker-ready interface, and fix `archive_document` write locking.

**Requirements:** MACRO-RESP-01, MACRO-RESP-02, MACRO-RESP-03, MACRO-RESP-04, MACRO-OBS-01, MACRO-INT-03, MACRO-INT-05, MACRO-INT-06

**Plans:** 2/2 plans complete

Plans:
- [x] 130-01-PLAN.md — Add macro response contracts, call_macro metadata/scaffold, and NullMcpBroker.
- [x] 130-02-PLAN.md — Add archive_document write locking and focused lock coverage.

**Cross-cutting constraints:**
- Implementation agents read the canonical Macro Language requirements and test plan before editing Phase 130 files per D-01.

**Success criteria:**
1. `response-formats.ts` exports macro result/type helpers without changing existing helpers.
2. `call_macro` appears in tool metadata and the MCP server registrar with safe stub behavior.
3. `NullMcpBroker` exists and returns disconnected/null handler results.
4. `archive_document` acquires and releases the standard document write lock.
5. Focused unit and integration tests cover metadata, response helpers, broker shim, and lock behavior.

### Phase 131: Lexer, Parser, Fence Extraction

**Goal:** Convert macro source and macro-library documents into a typed AST, including all v0 grammar, parse-error envelopes, and `source_ref::name` extraction semantics.

**Requirements:** MACRO-SRC-05, MACRO-SRC-06, MACRO-PARSE-01 through MACRO-PARSE-10

**Plans:** 5/5 plans complete

Plans:
- [x] 131-01-PLAN.md — Add Chevrotain, parser contracts, errors, and v0 lexer coverage.
- [x] 131-02-PLAN.md — Implement fqm fence extraction and source_ref named-block selection.
- [x] 131-03-PLAN.md — Implement parser grammar, AST conversion, and parse-error classification.
- [x] 131-04-PLAN.md — Parse all migrated POC examples as final-v0 fixtures.
- [x] 131-05-PLAN.md — Expose inline parse_error at the call_macro boundary with integration coverage.

**Success criteria:**
1. Chevrotain lexer/parser supports the full v0 two-layer DSL surface.
2. Fence extraction handles unnamed and named `fqm` blocks with the documented error matrix.
3. `source_ref::name` splitting and validation is independent from document resolution.
4. Parse errors use stable structured envelopes with 1-indexed line data.
5. All 17 POC examples parse after migration to the final v0 loop surface.

### Phase 132: Evaluator Core

**Goal:** Implement the async tree-walking evaluator for scope, control flow, expressions, interpolation, field access, termination, and isolated invocation state.

**Requirements:** MACRO-EVAL-01 through MACRO-EVAL-08

**Plans:** 4/4 plans complete

Plans:
- [x] 132-01-PLAN.md - Add evaluator contracts, invocation context, walk-up scope, and iterator-local loop coverage.
- [x] 132-02-PLAN.md - Implement expression semantics for truthiness, interpolation, field access, and RHS evaluation order.
- [x] 132-03-PLAN.md - Implement termination contracts and ToolResult envelope mapping.
- [x] 132-04-PLAN.md - Prove per-invocation isolation and cancellation safe-point hooks.

**Success criteria:**
1. Walk-up assignment and loop-local iterator scoping match the POC and spec.
2. Truthiness, comparisons, boolean short-circuiting, interpolation, and field access are deterministic.
3. Fall-off, `exit`, `fail`, and runtime error termination all produce the right internal results.
4. Sequential invocations cannot leak variables, traces, budgets, task IDs, or progress state.
5. Cancellation safe-point hooks exist for later phases even before external cancellation is wired.

### Phase 133: Standard Library Builtins

**Goal:** Add data, arithmetic, input, termination, range, echo/status, and task-introspection builtins with pre-flight input validation.

**Requirements:** MACRO-SRC-07, MACRO-SRC-08, MACRO-BI-01 through MACRO-BI-07

**Plans:** 3/3 plans complete

Plans:
**Wave 1**
- [x] 133-01-PLAN.md — Add input_var preflight, named builtin args, and evaluator dispatch contract.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 133-02-PLAN.md — Add pure data, arithmetic, range, input_var, sleep, and slow_op builtin registry behavior.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 133-03-PLAN.md — Add termination compatibility, echo/status channels, task introspection, and phase validation.

**Success criteria:**
1. `input_var` contract collection runs before execution and reports all missing inputs at once.
2. Data, arithmetic, range, termination, echo, status, task, sleep, and slow-op builtins are registered.
3. Builtins validate inputs and return canonical runtime errors for invalid usage.
4. Echo and status remain separated for trace vs. progress consumers.
5. POC examples covering builtins execute in the production evaluator harness.

### Phase 134: Shell Verbs, Vault Jail, Introspection

**Goal:** Add the eight read-only shell verbs, vault-jailed path wrapper, forbidden-flag pre-scan, cwd-retirement guarantee, and `_exists()` namespace introspection.

**Requirements:** MACRO-SHELL-01 through MACRO-SHELL-05

**Plans:** 5/5 plans complete

Plans:
**Wave 1**
- [x] 134-01-PLAN.md - Add vault-jailed shell path wrapper and path-wrapper tests.
- [x] 134-02-PLAN.md - Add forbidden shell flag pre-scan and evaluator pre-exec wiring.

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 134-03-PLAN.md - Add read-only shell verb registry, pipeline stdin, and cwd-retirement coverage.

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 134-04-PLAN.md - Add `_exists()` namespace introspection through native and broker layers.

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 134-05-PLAN.md - Run and record full Phase 134 validation gates. (completed 2026-05-14)

**Success criteria:**
1. `grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, and `ls` run against a hermetic vault root.
2. Escaping paths are rejected before host filesystem access.
3. Forbidden mutation flags are rejected before execution, including bundled/variant forms.
4. Production code does not call `shelljs.cd` or mutate process-global cwd.
5. `_exists()` reports native and brokered namespace availability through the correct layer.

### Phase 135: Tool Registry, Dispatch, Permissions

**Goal:** Route namespaced macro tool calls through the native/broker registry with static pre-scan, dispatch backstop, caller identity, and hard exclusions.

**Requirements:** MACRO-DISP-01 through MACRO-DISP-07

**Plans:** 4 plans

Plans:
- [ ] 135-01-PLAN.md — Create Wave 0 dispatch, permission, hard-exclusion, caller-identity, and integration tests.
- [ ] 135-02-PLAN.md — Implement `ToolRegistry`, `buildToolRegistry`, and `dispatchMacroTool`.
- [ ] 135-03-PLAN.md — Implement static permission pre-scan, evaluator preflight wiring, and hard exclusions.
- [ ] 135-04-PLAN.md — Wire public `call_macro` caller context/native catalog dispatch and close validation.

**Success criteria:**
1. `fq.*` references dispatch through the same native catalog/registry path used by agentic tools.
2. Permission pre-scan reports every unknown/forbidden reference before any mutation.
3. Dispatch refuses forbidden references even if pre-scan is bypassed in a white-box test.
4. `fq.call_macro`, template-masqueraded tools, and delegated `fq.call_model` are blocked as specified.
5. Tool-dispatch integration tests execute representative POC workflows against real handlers.

### Phase 136: Task Lifecycle And Cancellation

**Goal:** Implement the in-process task registry, session scoping, and cooperative cancellation at every safe point.

**Requirements:** MACRO-OBS-04, MACRO-OBS-05, MACRO-OBS-06, MACRO-INT-01

**Success criteria:**
1. Task records transition through `working`, `completed`, `failed`, and `cancelled`.
2. Terminal records are removed immediately after terminal-state transition.
3. Cancellation is observed between statements, before tool calls, between loop iterations, between pipeline stages, and inside long-running builtins.
4. Task visibility and cancellation are scoped to the current session.
5. Concurrent invocations prove state isolation under stress, including T-I-002 variable/trace/task/budget isolation across simulated sessions.

### Phase 137: Trace, Progress, Dry-Run, Budgets

**Goal:** Complete response observability and execution controls: trace modes, progress modes, warnings, dry-run, budget enforcement, and progress-token capture.

**Requirements:** MACRO-OBS-02, MACRO-OBS-03, MACRO-RESP-05, MACRO-INT-04, MACRO-INT-07

**Success criteria:**
1. Trace modes `full`, `summary`, and `none` behave exactly as specified, including value truncation.
2. Progress modes `full`, `milestones`, and `silent` honor progress token availability and throttling.
3. Dry-run parses, pre-scans, and reports structure without executing side effects.
4. Token/model/external-tool/time budgets halt with the correct budget envelope.
5. `warnings[]` carries truncation/throttle/broker warnings through the shared response convention.

### Phase 138: Handler, Source Resolution, Scenario Closure

**Goal:** Finish `call_macro` by wiring schema validation, inline/source_ref execution, document resolution, named-block extraction, integration tests, scenario matrices, and POC fixture validation.

**Requirements:** MACRO-SRC-01, MACRO-SRC-02, MACRO-SRC-03, MACRO-SRC-04, MACRO-INT-02

**Success criteria:**
1. Inline `source` and vault `source_ref` requests execute end-to-end through the public MCP handler.
2. Source exclusivity, empty source, invalid selector, not-found, permission, and archived-doc errors match the spec.
3. Macro-executed writes inherit existing tool-layer write locks and response envelopes.
4. Unit, integration, E2E, directed scenario, and YAML scenario coverage is updated and passing.
5. The 17 migrated POC examples execute successfully under the production engine.

## Progress

| Milestone | Phases | Requirements | Status | Shipped |
|-----------|--------|--------------|--------|---------|
| v3.4 macro-support | 130-138 | 0/63 | Planning | — |
| v3.3 MCP Tools Consolidation | 121-129 | 57/57 | Complete | 2026-05-14 |
| v3.2 Agentic LLM Tools | 112-120 | — | Complete | 2026-05-07 |
| v3.1 Call Model With Reference | 107-111 | — | Complete | 2026-05-05 |
| v3.0 Native LLM Access | 98-106 | — | Complete | 2026-04-30 |
| v2.9 Filesystem Primitive Tools | 90-97 | 20/20 | Complete | 2026-04-25 |

## Next Up

**Phase 130: Foundation, Metadata, Broker Shim, Archive Lock** — establish the shared macro response/type surface and MCP scaffold before building the parser.

```bash
$gsd-discuss-phase 130
```

Also available:
- `$gsd-plan-phase 130` — skip discussion and create the implementation plan directly.

---
*Last updated: 2026-05-14 after creating v3.4 macro-support roadmap*
