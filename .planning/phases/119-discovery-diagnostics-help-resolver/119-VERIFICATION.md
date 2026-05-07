---
phase: 119-discovery-diagnostics-help-resolver
verified: 2026-05-07T00:27:57Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 119: Discovery Diagnostics & Help Resolver Verification Report

**Phase Goal:** MCP clients can discover which purposes, models, templates, and tools are available before invoking an agentic `call_model` request.
**Verified:** 2026-05-07T00:27:57Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `list_purposes` reports native tool and template-tool diagnostics, including collisions and dangling bindings. | VERIFIED | `buildListPurposesContent()` calls `assembleNativeToolRegistry()`, `assembleTemplateToolRegistry()`, and `mergeModelVisibleToolRegistries()` in `src/llm/discovery-content.ts:110-139`, then emits `native_tools`, `native_tool_diagnostics`, `template_tools`, `template_tool_warnings`, `template_tool_conflicts`, and `dangling_template_paths`. Unit tests assert empty and populated diagnostics in `tests/unit/llm-tool.test.ts:2092-2151`. Directed scenario passed Step 6. |
| 2 | `list_models` reports structured tool capability diagnostics with distinct unknown-vs-false messages. | VERIFIED | `buildModelCapabilityDiagnostics()` emits `supported`, `unknown_declaration`, and `declared_unsupported` states in `src/llm/capabilities.ts:68-102`; `modelToResponse()` includes `capability_diagnostics` in `src/llm/discovery-content.ts:91-96`. Unit tests assert unknown remediation and explicit false handling in `tests/unit/llm-tool.test.ts:1952-2020`. Directed scenario passed Step 4. |
| 3 | `search` remains usable without messages and covers relevant model/purpose discovery metadata. | VERIFIED | `buildSearchContent()` always returns `{ query, results: { purposes, models } }` in `src/llm/discovery-content.ts:203-217`, indexing capability states, diagnostic keys, resolver names, and help keys in `src/llm/discovery-content.ts:160-200`. Unit tests assert message-free raw search metadata hits in `tests/unit/llm-tool.test.ts:2367-2391`. Directed scenario passed Step 7. |
| 4 | `help` explains Mode 1, Mode 2, references, templates, tools, guardrails, and discovery usage in a machine-readable shape. | VERIFIED | `buildCallModelHelpContent()` returns ordered sections `summary`, `reference_syntax`, `template_bindings`, `modes`, `envelope`, `errors`, `discovery`, `examples` in `src/llm/help-content.ts:5-168`, including refs, templates, tools, loop controls, resolver values, and examples. Unit and directed tests assert the shape in `tests/unit/llm-tool.test.ts:2331-2365` and `tests/scenarios/directed/testcases/test_call_model_help_resolver.py:56-118`. |
| 5 | Discovery calls remain outside the `CallModelEnvelope` and ignore `return_messages`. | VERIFIED | `registerLlmTools()` returns raw JSON for `help`, `list_models`, `list_purposes`, and `search` before model/purpose validation and provider dispatch in `src/mcp/tools/llm.ts:345-427`. Unit tests assert no `metadata`, `usage`, or `messages` keys and no LLM dispatch in `tests/unit/llm-tool.test.ts:1074-1139` and `tests/unit/llm-tool.test.ts:2268-2329`. |
| 6 | Phase-specific runnable tests exist and pass for `list_purposes`, `list_models`, discovery `search`, `help`, and public diagnostics. | VERIFIED | Focused unit gate passed: 3 files, 117 tests. Managed directed scenarios passed: `test_call_model_help_resolver` 1/1 steps and `test_discovery_resolvers` 7/7 steps. Build and lint passed. Coverage rows L-96 through L-100 map DISC-01 through DISC-04 and VAL-119 in `tests/scenarios/directed/DIRECTED_COVERAGE.md:695-699`. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/llm/help-content.ts` | Stable ordered call_model help response builder | VERIFIED | Exists, substantive, exports `buildCallModelHelpContent`, and is imported by `src/mcp/tools/llm.ts`. |
| `src/llm/discovery-content.ts` | Discovery builders for `list_models`, `list_purposes`, and `search` | VERIFIED | Exists, substantive, exports all three builders, reuses native/template registry assembly, and avoids document/template body indexing. |
| `src/llm/capabilities.ts` | Public structured capability diagnostic helper | VERIFIED | Exports `buildModelCapabilityDiagnostics`; unit spot check confirmed false and unknown states. |
| `src/mcp/tools/llm.ts` | Resolver enum and raw discovery/help dispatch | VERIFIED | Imports helper modules; `help` dispatch precedes the unconfigured LLM guard; discovery branches return raw JSON. |
| `tests/unit/llm-tool.test.ts` | Unit coverage for help, raw discovery, capability diagnostics, search metadata | VERIFIED | Focused unit gate passed. |
| `tests/unit/llm-template-tools.test.ts` | Template diagnostics contract coverage | VERIFIED | Focused unit gate passed; asserts stable empty diagnostics and conflict diagnostics. |
| `tests/unit/llm-tool-registry.test.ts` | Native registry diagnostics contract coverage | VERIFIED | Focused unit gate passed; asserts stable empty native diagnostics. |
| `tests/scenarios/directed/testcases/test_discovery_resolvers.py` | Public scenario assertions for diagnostics/search | VERIFIED | Managed scenario passed 7/7 steps. |
| `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` | Public scenario assertions for `resolver="help"` | VERIFIED | Managed scenario passed 1/1 steps. |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | Coverage rows for Phase 119 behaviors | VERIFIED | Rows L-96 through L-100 exist with passing dates. |
| `.planning/phases/119-discovery-diagnostics-help-resolver/119-VALIDATION.md` | Green validation evidence | VERIFIED | Validation ledger rows are green and matched by verifier-run commands. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/mcp/tools/llm.ts` | `src/llm/help-content.ts` | `resolver='help'` branch | WIRED | `buildCallModelHelpContent` imported and called. |
| `src/mcp/tools/llm.ts` | `src/llm/discovery-content.ts` | `list_models`/`list_purposes`/`search` branches | WIRED | `buildListModelsContent`, `buildListPurposesContent`, and `buildSearchContent` imported and called. |
| `src/llm/discovery-content.ts` | `src/llm/tool-registry.ts` | native registry assembly | WIRED | `assembleNativeToolRegistry` and merge helper are imported and used. |
| `src/llm/discovery-content.ts` | `src/llm/template-tools.ts` | template registry assembly | WIRED | `assembleTemplateToolRegistry` is imported and used. |
| Directed scenarios | `call_model` MCP public surface | managed MCP client calls | WIRED | Scenarios call `client.call_tool("call_model", ...)` and parse returned MCP text JSON. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/mcp/tools/llm.ts` | help payload | `buildCallModelHelpContent()` | Static protocol metadata by design; not hollow because public help is the required content | VERIFIED |
| `src/mcp/tools/llm.ts` | models payload | `buildListModelsContent(config)` | Reads configured `config.llm.models` and provider metadata | VERIFIED |
| `src/mcp/tools/llm.ts` | purposes payload | `buildListPurposesContent({ config, nativeToolCatalog, runtimeTemplateBindings })` | Reads configured purposes plus live native catalog and runtime/template diagnostics | VERIFIED |
| `src/mcp/tools/llm.ts` | search results | `buildSearchContent(...)` | Builds from the same model/purpose discovery builders; arrays present even on no matches | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Focused unit diagnostics/help contract | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` | 3 files passed, 117 tests passed | PASS |
| Production TypeScript build | `npm run build` | tsup ESM and DTS build succeeded | PASS |
| Lint | `npm run lint` | ESLint exited 0 | PASS |
| Help content key order | `npx tsx -e "...buildCallModelHelpContent..."` | `help keys ok` | PASS |
| Capability diagnostic states | `npx tsx -e "...buildModelCapabilityDiagnostics..."` | `capability diagnostics ok` | PASS |
| Public help directed scenario | `python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed` | 1/1 steps passed | PASS |
| Public discovery directed scenario | `python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed` | 7/7 steps passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DISC-01 | 119-01, 119-02, 119-03 | `list_purposes` exposes native tool and template-tool diagnostics, including usable tools and template collision details. | SATISFIED | Implementation emits native/template diagnostics; unit and directed scenarios passed; coverage row L-96 exists. |
| DISC-02 | 119-01, 119-02, 119-03 | `list_models` exposes structured capability diagnostics with clear unknown-vs-false explanations. | SATISFIED | Capability diagnostic helper and list_models builder verified; unit and directed scenarios passed; coverage row L-97 exists. |
| DISC-03 | 119-01, 119-02, 119-03 | `search` continues to provide discovery over model and purpose metadata without requiring messages. | SATISFIED | Search builder returns raw `{ query, results }`; unit and directed scenarios passed; coverage row L-98 exists. |
| DISC-04 | 119-01, 119-02, 119-03 | A v1 `help` resolver describes supported `call_model` modes, references, templates, tools, loop controls, and discovery usage. | SATISFIED | Help builder and dispatch verified; unit and directed scenarios passed; coverage row L-99 exists. |
| VAL-119 | 119-01, 119-02, 119-03 | Phase 119 ships runnable unit and directed scenario tests validating discovery diagnostics, structured capability reporting, discovery search behavior, and the `help` resolver. | SATISFIED | Unit gate, directed scenarios, lint, and build passed; coverage row L-100 exists. |

No orphaned Phase 119 requirements were found in `.planning/REQUIREMENTS.md`; DISC-01 through DISC-04 and VAL-119 are all mapped to Phase 119 and marked Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/llm/discovery-content.ts` | 95 | `capability_diagnostics = []` fallback | INFO | Not a stub; applies only when provider metadata is absent. |
| `tests/scenarios/directed/testcases/test_discovery_resolvers.py` | 279 | `sk-test-placeholder` fallback | INFO | Test harness placeholder API key for managed discovery tests; no provider call is made. |
| `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` | 126 | `sk-test-placeholder` fallback | INFO | Test harness placeholder API key for managed help test; no provider call is made. |

### Human Verification Required

None.

### Gaps Summary

No gaps found. The phase goal is achieved: raw `call_model` discovery/help responses expose the completed ATL behavior through model diagnostics, purpose native/template diagnostics, search metadata, and `resolver="help"`, with unit and managed public scenario validation passing.

---

_Verified: 2026-05-07T00:27:57Z_
_Verifier: the agent (gsd-verifier)_
