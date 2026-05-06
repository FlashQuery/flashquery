---
phase: 116-model-visible-tool-registry
verified: 2026-05-06T12:41:34Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
---

# Phase 116: Model-Visible Tool Registry Verification Report

**Phase Goal:** FlashQuery can assemble a purpose-specific model-visible tool list from safe native tools and translate those tools into provider-compatible definitions.
**Verified:** 2026-05-06T12:41:34Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Purpose `tools` expands tiers and named tools into a final native allowlist. | ✓ VERIFIED | `TOOL_TIERS` defines `tier:read-only` and `tier:read-write`; `assembleNativeToolRegistry()` expands tiers and explicit names with deterministic de-duplication in `src/llm/tool-registry.ts`. Unit tests assert exact arrays. |
| 2 | `excluded_tools` removes tools from the final set and fails config validation when used without `tools`. | ✓ VERIFIED | `assembleNativeToolRegistry()` applies `purpose.excludedTools` after expansion; `validateLlmConfig()` rejects `excluded_tools` without `tools`. Unit tests cover both paths. |
| 3 | Hard-excluded tools are never exposed and produce clear warnings rather than silent omission. | ✓ VERIFIED | `HARD_EXCLUDED_NATIVE_TOOLS` includes `call_model`, `register_plugin`, `unregister_plugin`, and `get_plugin_info`; registry removes them and returns diagnostics. `call_model` maps diagnostics to public `metadata.tools.diagnostics.hard_excluded`. |
| 4 | MCP/Zod input schemas translate to OpenAI-compatible tool definitions with strict schemas when supported. | ✓ VERIFIED | `toOpenAiToolDefinition()` wraps raw MCP shapes or accepts `z.object`, calls `z.toJSONSchema`, and normalizes strict schemas with `strict: true`, `required`, and `additionalProperties: false`. `call_model` determines strict mode from selected model capabilities. |
| 5 | If no model-visible tools remain, provider requests omit `tools` entirely. | ✓ VERIFIED | `assembleNativeToolRegistry()` omits `providerTools` when empty; `src/mcp/tools/llm.ts` only merges provider tools when non-empty; `src/llm/client.ts` also strips empty `tools` arrays. Unit and directed scenario tests assert no `tools` key. |
| 6 | Registered native MCP tool definitions are captured without changing handler behavior. | ✓ VERIFIED | `wrapServerWithToolCatalog(server)` records name/description/inputSchema before delegating to the original `registerTool`; it is wired after correlation IDs and before all native tool registration in `src/mcp/server.ts`. |
| 7 | Config validation rejects unknown purpose tool tier names and unknown named native tools. | ✓ VERIFIED | `validateLlmConfig()` accepts known `TOOL_TIERS`, tier member names, and hard-excluded names; it rejects unknown `tier:*` and unknown native names with `[purpose]` errors. |
| 8 | Config validation permits hard-excluded names so the registry can warn/remove them. | ✓ VERIFIED | Loader validation includes `HARD_EXCLUDED_NATIVE_TOOLS` in the accepted native-name set; tests load `tools: [call_model, register_plugin]` successfully. |
| 9 | Purpose `call_model` requests pass non-empty assembled native tools to provider calls. | ✓ VERIFIED | `src/mcp/tools/llm.ts` assembles the registry for purpose calls and dispatches provider-tool requests via `chatByPurpose`; tests assert `get_document` is sent as an OpenAI function tool. |
| 10 | Hard-excluded native tools are visible in public-surface diagnostics without provider exposure. | ✓ VERIFIED | Unit tests and the directed scenario assert `metadata.tools.native_tool_names == ["get_document"]`, provider tools exclude `call_model`, and diagnostics name `call_model`. |
| 11 | Phase-specific runnable tests exist and pass for registry behavior, config validation, schema translation, call_model wiring, and a public-surface scenario. | ✓ VERIFIED | Local verification passed: 145 focused unit tests, directed scenario 2/2 steps, and `npm run build`. `DIRECTED_COVERAGE.md` records L-85 / VAL-116 last passing on 2026-05-06. |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/llm/tool-registry.ts` | Native tiers, exclusions, hard-exclusion diagnostics, OpenAI tool translation | ✓ VERIFIED | Exports `TOOL_TIERS`, `HARD_EXCLUDED_NATIVE_TOOLS`, `assembleNativeToolRegistry`, `normalizeToolJsonSchema`, and `toOpenAiToolDefinition`. |
| `src/mcp/tool-catalog.ts` | Catalog wrapper around MCP registration | ✓ VERIFIED | Captures metadata in a `WeakMap` and delegates to original `registerTool`. |
| `src/mcp/server.ts` | Catalog wrapper wired before native tool registration | ✓ VERIFIED | `wrapServerWithToolCatalog(server)` appears before every `register*Tools(server, config)` call. |
| `src/config/loader.ts` | Semantic validation for `tools` and `excluded_tools` | ✓ VERIFIED | Imports registry constants and validates excluded-without-tools plus unknown tier/tool names. |
| `src/mcp/tools/llm.ts` | Purpose-path registry assembly, provider parameter wiring, public diagnostics | ✓ VERIFIED | Assembles registry, merges non-empty provider tools, omits empty tools, and returns snake_case metadata diagnostics. |
| `src/llm/types.ts` | `CallModelMetadata.tools` shape | ✓ VERIFIED | Optional `tools` metadata includes `native_tool_names` and diagnostics. |
| Focused unit tests | Phase 116 behavior coverage | ✓ VERIFIED | `tests/unit/llm-tool-registry.test.ts`, `tests/unit/llm-config.test.ts`, `tests/unit/llm-client.test.ts`, and `tests/unit/llm-tool.test.ts` pass. |
| Directed scenario | Public-surface VAL-116 coverage | ✓ VERIFIED | `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py` passes 2/2 managed steps. |
| Traceability docs | Validation and coverage closure | ✓ VERIFIED | `116-VALIDATION.md`, `DIRECTED_COVERAGE.md`, `REQUIREMENTS.md`, and `ROADMAP.md` name VAL-116 and the runnable commands. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/llm/tool-registry.ts` | Purpose config `tools` / `excludedTools` | Purpose lookup by normalized name | ✓ WIRED | Reads `purpose?.tools ?? []` and `purpose?.excludedTools ?? []`. |
| `src/llm/tool-registry.ts` | Hard-exclusion diagnostics | Post-expansion hard-exclusion filter | ✓ WIRED | Removes hard-excluded names after exclusions and appends diagnostic entries. |
| `src/mcp/server.ts` | `src/mcp/tool-catalog.ts` | `wrapServerWithToolCatalog(server)` before native registrations | ✓ WIRED | Manual source check confirms ordering at server setup. |
| `src/llm/tool-registry.ts` | Zod JSON Schema conversion | `z.toJSONSchema(zodSchema)` | ✓ WIRED | Translation helper normalizes output for strict/non-strict provider definitions. |
| `src/config/loader.ts` | Registry constants | `TOOL_TIERS` and `HARD_EXCLUDED_NATIVE_TOOLS` imports | ✓ WIRED | Config validation uses these constants for semantic checks. |
| `src/mcp/tools/llm.ts` | Registry assembly | `assembleNativeToolRegistry()` in purpose path | ✓ WIRED | Called before provider dispatch after selected model capability lookup. |
| `src/mcp/tools/llm.ts` | Provider request dispatch | `chatByPurpose` / `completeByPurpose` with merged parameters | ✓ WIRED | Non-empty tools go through `chatByPurpose`; empty registry calls use `completeByPurpose` without `tools`. |
| Directed scenario | Public MCP `call_model` | `FQCClient.call_tool("call_model", resolver="purpose", ...)` | ✓ WIRED | Scenario asserts public metadata and actual mock provider request body. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `src/mcp/server.ts` / `src/mcp/tool-catalog.ts` | Native tool catalog | MCP `server.registerTool()` calls across registered native tools | Yes | ✓ FLOWING |
| `src/llm/tool-registry.ts` | `nativeToolNames`, `providerTools`, `diagnostics` | Purpose `tools` / `excludedTools` plus captured catalog entries | Yes | ✓ FLOWING |
| `src/mcp/tools/llm.ts` | `purposeProviderParameters`, `metadata.tools` | Registry output plus selected model capabilities | Yes | ✓ FLOWING |
| Directed scenario mock provider | Provider request `tools` body | Real managed server call through public MCP surface | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Focused unit coverage passes | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts` | 4 files / 145 tests passed | ✓ PASS |
| Public-surface scenario passes | `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed` | 2/2 steps passed | ✓ PASS |
| TypeScript build passes | `npm run build` | ESM and DTS build succeeded | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| TOOL-01 | 116-01, 116-03, 116-04 | Purpose-level `tools` expands tiers and named tools into a final model-visible native allowlist. | ✓ SATISFIED | Registry tier expansion, config validation, call_model wiring, and unit tests. |
| TOOL-02 | 116-01, 116-03, 116-04 | `excluded_tools` removes tools from the final set and is invalid without `tools`. | ✓ SATISFIED | Registry exclusion order, loader rejection, empty-provider omission tests. |
| TOOL-03 | 116-01, 116-03, 116-04 | Hard-excluded tools are removed with warnings. | ✓ SATISFIED | Hard-exclusion constants, diagnostics, public metadata, scenario assertion. |
| TOOL-04 | 116-02, 116-04 | MCP/Zod schemas translate into OpenAI-compatible tool definitions with strict support. | ✓ SATISFIED | `toOpenAiToolDefinition()`, strict schema normalization, selected-model capability wiring. |
| VAL-116 | 116-02, 116-03, 116-04 | Runnable unit tests and public scenario validate native tool exposure behavior. | ✓ SATISFIED | 145 unit tests passed; managed directed scenario passed 2/2; build passed. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| None | - | - | - | No blocker or warning anti-patterns found. Grep matches were benign type guards, empty initial collections, existing test fixtures, or unrelated placeholder syntax tests. |

### Human Verification Required

None.

### Gaps Summary

No gaps found. Phase 116 achieves the stated goal: safe purpose-specific native tool lists are assembled from config and the captured MCP catalog, translated to provider-compatible OpenAI function tools, wired into real purpose `call_model` provider requests, and exposed through public diagnostics without delegated dispatch. Delegated execution of model tool calls remains Phase 117 scope and is not a residual Phase 116 risk.

Residual risks: none identified for the Phase 116 contract.

---

_Verified: 2026-05-06T12:41:34Z_
_Verifier: the agent (gsd-verifier)_
