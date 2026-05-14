---
phase: 135-tool-registry-dispatch-permissions
verified: 2026-05-14T19:28:30Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 135: Tool Registry, Dispatch, Permissions Verification Report

**Phase Goal:** Route namespaced macro tool calls through the native/broker registry with static pre-scan, dispatch backstop, caller identity, and hard exclusions.  
**Verified:** 2026-05-14T19:28:30Z  
**Status:** passed  
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `fq.*` references dispatch through the same native catalog/registry path used by agentic tools. | VERIFIED | `src/mcp/tools/macro.ts:143-152` gets `getNativeToolCatalog(server)`, builds the registry, and passes it to evaluation; `src/macro/registry.ts:192-210` builds `fq` handlers from catalog entries. |
| 2 | Permission pre-scan reports unknown/forbidden references before any mutation. | VERIFIED | `src/macro/evaluator.ts:278-296` runs `preScanToolReferences` before `execBlock`; `src/macro/permission-prescan.ts:34-108` classifies template, unknown server, hard-excluded, unknown tool, and forbidden references. T-U-160..164 cover forbidden aggregation, zero side effects, and delegated allowlist derivation through `buildToolRegistry` / `assembleNativeToolRegistry`. |
| 3 | Dispatch refuses forbidden references even if pre-scan is bypassed. | VERIFIED | `src/macro/dispatcher.ts:37-47` checks allowlist immediately before handler invocation; T-U-163 proves `fq.archive_document` handler is not called. |
| 4 | `fq.call_macro`, template-masqueraded tools, and delegated `fq.call_model` are blocked as specified. | VERIFIED | `src/macro/registry.ts:174-181` records delegated hard-exclusion reasons while leaving `call_macro` opaque as `unknown_tool`; `src/mcp/tools/macro.ts` now wires template metadata from `assembleTemplateToolRegistry`; T-U-165..168 cover required error codes/reason. |
| 5 | Tool-dispatch integration tests execute representative POC workflows against real handlers. | VERIFIED | `tests/integration/macro-tool-dispatch.test.ts:81-117` verifies `fq.write_document` persistence; `:119-155` verifies `fq.search` result shape through public `call_macro`. |
| 6 | MACRO-DISP-01: Namespaced macro tool calls dispatch through a `(server, tool)` registry. | VERIFIED | `ToolRegistry`/`ServerEntry`/`ToolFn` are in `src/macro/types.ts`; `dispatchMacroTool` resolves by server then tool in `src/macro/dispatcher.ts:14-35`. |
| 7 | MACRO-DISP-02: Static permission pre-scan rejects denied or unknown tool references before side effects. | VERIFIED | Recursive AST collector covers statement/expression variants in `src/macro/permission-prescan.ts:111-190`; evaluator invokes it before execution. |
| 8 | MACRO-DISP-03: Dispatch-time permission backstop rejects references that bypass pre-scan. | VERIFIED | `src/macro/dispatcher.ts:37-47`; focused unit gate passed. |
| 9 | MACRO-DISP-04: `fq.call_macro` is universally unavailable from inside macros. | VERIFIED | `src/macro/registry.ts:195` removes `call_macro`; T-U-165 expects `unknown_tool`. |
| 10 | MACRO-DISP-05: Template-masqueraded tools are universally unavailable from inside macros. | VERIFIED | `src/macro/registry.ts:188-189` carries template metadata; `src/macro/permission-prescan.ts:36-49` returns `template_masquerade_tools_not_callable_from_macro`. |
| 11 | MACRO-DISP-06: Delegated-emitted macros cannot call `fq.call_model`. | VERIFIED | Delegated path uses `assembleNativeToolRegistry` and maps `fq.call_model` to `recursive_model_excluded_from_delegated_macros` in `src/macro/registry.ts:169-180`. |
| 12 | MACRO-DISP-07: Caller identity is derived from existing FlashQuery call context. | VERIFIED | Public schema has no `callerKind` in `src/mcp/tools/macro.ts:15-23`; inbound public calls default to `{ origin: 'host' }` in `runMacroSource` at `:52-60`; delegated context is internal-only via `RunMacroSourceOptions`. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/macro/types.ts` | Shared registry, reference, and caller-context types | VERIFIED | Exports `ToolFn`, `ServerEntry`, `ToolRegistry`, `ToolReference`, `MacroCallerContext`. |
| `src/macro/registry.ts` | `buildToolRegistry` for native/broker registry construction | VERIFIED | Uses `resolveHostToolExposure`, `assembleNativeToolRegistry`, catalog handlers, Zod validation, broker entries, template metadata, and hard-exclusion reasons. |
| `src/macro/dispatcher.ts` | Lookup errors and allowlist backstop | VERIFIED | Returns `unknown_server`, `unknown_tool`, `forbidden_tools`; invokes handler only after backstop. |
| `src/macro/permission-prescan.ts` | Recursive AST walker and error classification | VERIFIED | Exports `collectToolReferences` and `preScanToolReferences`; walks control flow, expressions, pipelines, field access, and tool args. |
| `src/macro/evaluator.ts` | Pre-execution scan chain and dispatcher wiring | VERIFIED | Pre-scan before `execBlock`; `evalToolCall` routes through `dispatchMacroTool` for registry-backed calls. |
| `src/mcp/tools/macro.ts` | Public `call_macro` schema and registry wiring | VERIFIED | Schema omits caller identity; public handler builds native catalog registry and dispatch context. |
| `tests/unit/macro-*.test.ts` | T-U-156..T-U-171 coverage | VERIFIED | All required unit test IDs are present. |
| `tests/integration/macro-tool-dispatch.test.ts` | T-I-003/T-I-004 real handler coverage | VERIFIED | Integration suite passes locally. |
| `tests/scenarios/directed/testcases/test_macro_dispatch_permissions.py` | Phase 135 directed hard-exclusion coverage | VERIFIED | Covers `ML-11` and `ML-12` for nested `fq.call_macro` and real template-masqueraded tool rejection. |
| `tests/scenarios/directed/testcases/test_macro_permission_prescan.py` | Phase 135 public permission pre-scan coverage | VERIFIED | Covers `ML-13` and `ML-14` for forbidden known tools, aggregated nested forbidden references, and no nested result. |
| `tests/scenarios/directed/testcases/test_macro_delegated_hard_exclusions.py` | Phase 135 delegated hard-exclusion coverage | VERIFIED | Covers `ML-15` and `ML-16` by driving `runMacroSource` programmatically for delegated versus host `fq.call_model`. |
| `tests/scenarios/directed/testcases/test_macro_caller_identity.py` | Phase 135 public caller identity boundary coverage | VERIFIED | Covers `ML-17` by asserting tools/list omits `callerKind`, supplied `callerKind` is ignored, and no caller identity is echoed. |
| `tests/scenarios/integration/tests/macro_dispatch_get_then_write.yml` | Phase 135 YAML macro-to-handler workflow | VERIFIED | Covers `IS-11` with one macro composing `get_document`, `write_document`, and `get_document`. |
| `tests/scenarios/integration/tests/macro_permission_failure_zero_side_effects.yml` | Phase 135 YAML permission failure workflow | VERIFIED | Covers `IS-12` with public `call_macro` rejecting a forbidden write before dispatch and proving the blocked target remains absent. |
| `tests/config/vitest.integration.config.ts` | Explicit include entry | VERIFIED | Include entry exists exactly once at line 16. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/mcp/tools/macro.ts` | `src/mcp/tool-catalog.ts` | `getNativeToolCatalog(server)` | WIRED | Public handler passes catalog into `runMacroSource`. |
| `src/mcp/tools/macro.ts` | `src/macro/registry.ts` | `buildToolRegistry` | WIRED | `runMacroSource` builds registry with caller context, broker, catalog, and native dispatch context. |
| `src/mcp/tools/macro.ts` | `src/macro/evaluator.ts` | `evaluateProgram` registry/allowlist options | WIRED | Registry, allowed names, template names, hard exclusions, and caller context are passed. |
| `src/macro/evaluator.ts` | `src/macro/permission-prescan.ts` | `preScanToolReferences` before `execBlock` | WIRED | Verified at `src/macro/evaluator.ts:283-296`. |
| `src/macro/evaluator.ts` | `src/macro/dispatcher.ts` | `dispatchMacroTool` in `evalToolCall` | WIRED | Verified at `src/macro/evaluator.ts:768-779`. |
| `tests/config/vitest.integration.config.ts` | `tests/integration/macro-tool-dispatch.test.ts` | explicit include entry | WIRED | Manual check: `rg ... | wc -l` returned `1`; helper false-negative was due escaped pattern matching. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `src/mcp/tools/macro.ts` | `result` | `runMacroSource` parses source, builds registry, calls `evaluateProgram` | Yes | FLOWING |
| `src/mcp/tools/macro.ts` | `templateReverseMap` / `templateToolNames` | `assembleTemplateToolRegistry` over the vault template surface | Yes | FLOWING |
| `src/mcp/tools/macro.ts` | `NativeToolDispatchContext.signal` | inbound MCP request `extra.signal` | Yes | FLOWING |
| `src/macro/registry.ts` | `fqTools` / `allowedToolNames` | Native catalog + host/delegated allowlist source | Yes | FLOWING |
| `src/macro/evaluator.ts` | tool-call result | `dispatchMacroTool` result from registry `ToolFn` | Yes | FLOWING |
| `tests/integration/macro-tool-dispatch.test.ts` | document/search assertions | Public MCP `call_macro` -> native handlers -> Supabase/search | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Focused registry, pre-scan, dispatcher unit behavior | `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` | 3 files, 15 tests passed locally | PASS |
| Real native dispatch integration | `npm run test:integration -- --reporter=verbose macro-tool-dispatch` | 1 file, 2 tests passed locally | PASS |
| Public directed hard-exclusion coverage | `python3 tests/scenarios/directed/testcases/test_macro_dispatch_permissions.py --managed` | Passed: 2/2 steps | PASS |
| Public directed permission pre-scan coverage | `python3 tests/scenarios/directed/testcases/test_macro_permission_prescan.py --managed` | Passed: 2/2 steps | PASS |
| Directed delegated hard-exclusion coverage | `python3 tests/scenarios/directed/testcases/test_macro_delegated_hard_exclusions.py --managed` | Passed: 2/2 steps | PASS |
| Public directed caller identity coverage | `python3 tests/scenarios/directed/testcases/test_macro_caller_identity.py --managed` | Passed: 2/2 steps | PASS |
| YAML multi-handler macro dispatch coverage | `python3 tests/scenarios/integration/run_integration.py --managed macro_dispatch_get_then_write` | Passed: 1/1 tests, 2/2 steps | PASS |
| YAML permission failure zero-side-effect coverage | `python3 tests/scenarios/integration/run_integration.py --managed macro_permission_failure_zero_side_effects` | Passed: 1/1 tests, 2/2 steps | PASS |
| Integration include registered exactly once | `rg -n "tests/integration/macro-tool-dispatch\\.test\\.ts" tests/config/vitest.integration.config.ts \| wc -l` | `1` | PASS |
| No public `callerKind` in production schema/options | `rg -n "callerKind" src/mcp/tools/macro.ts src/macro src/llm tests/unit/macro-caller-identity.test.ts` | Matches only schema absence test | PASS |
| No direct macro imports from `src/mcp/tools/*` | `rg -n "from ['\\\"].*(mcp/tools)\|src/mcp/tools\|\\.\\./mcp/tools\|\\.\\./\\.\\./mcp/tools" src/macro src/mcp/tools/macro.ts` | No matches | PASS |
| Latest full gates supplied for verification context | `npm test`; `npm run test:integration`; `npm run test:e2e`; `npm run preflight` | User-reported latest gates: unit 114 files/1692 tests, integration 9 files/20 tests, e2e 7 files/66 tests, preflight lint + 1692 tests + package contents OK + Docker skipped because Docker not found | PASS |

### Requirements Coverage

| Requirement | Source Plan | Product Requirement | Status | Evidence |
|---|---|---|---|---|
| MACRO-DISP-01 | 135-01, 135-02, 135-04 | REQ-027 namespaced dispatch | SATISFIED | Registry types, `buildToolRegistry`, `dispatchMacroTool`, and integration T-I-003/T-I-004. |
| MACRO-DISP-02 | 135-01, 135-03, 135-04 | REQ-028 static permission pre-scan | SATISFIED | Pre-scan runs before `execBlock`; T-U-160..164 present and passing. |
| MACRO-DISP-03 | 135-01, 135-02, 135-03, 135-04 | REQ-029 dispatch-time backstop | SATISFIED | Dispatcher allowlist check before handler; T-U-163 passing. |
| MACRO-DISP-04 | 135-01, 135-02, 135-03, 135-04 | REQ-030 `fq.call_macro` hard exclusion | SATISFIED | Registry omits `call_macro`; T-U-165 passing. |
| MACRO-DISP-05 | 135-01, 135-03, 135-04 | REQ-031 template masquerade hard exclusion | SATISFIED | Template metadata pre-scan path; T-U-166 passing. |
| MACRO-DISP-06 | 135-01, 135-03, 135-04 | REQ-032 delegated `fq.call_model` hard exclusion | SATISFIED | Delegated hard-exclusion reason mapped and scanned; T-U-167/T-U-168 passing. |
| MACRO-DISP-07 | 135-01, 135-04 | REQ-033 caller identity | SATISFIED | Public schema omits `callerKind`; host default and internal delegated helper covered by T-U-169..171. |

No orphaned Phase 135 requirement IDs were found in `.planning/REQUIREMENTS.md`; it maps MACRO-DISP-01 through MACRO-DISP-07 to Phase 135.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `src/mcp/tools/macro.ts` | 138 | `source_ref_not_implemented` | INFO | Deferred to Phase 138 handler/source resolution; not part of Phase 135 dispatch/permissions goal. |
| `src/macro/registry.ts` | 82, 86 | `return null` conversions | INFO | Macro value normalization for `undefined`/unsupported JS values, not a stub. |
| `src/macro/evaluator.ts` | 520, 828 | `return null` / `return {}` | INFO | Normal macro expression/object handling, not a stub. |

### Human Verification Required

None.

### Gaps Summary

No blocking gaps found. The phase goal is achieved in code: public `call_macro` builds an internal host caller context, obtains native catalog handlers, builds a registry/allowlist, pre-scans the AST, dispatches through the shared registry path, blocks hard exclusions, and has a dispatch-time backstop. Focused unit and integration gates pass locally, and the broader latest gates were supplied as passing evidence.

---

_Verified: 2026-05-14T19:28:30Z_  
_Verifier: the agent (gsd-verifier)_
