---
phase: 122-host-tool-exposure-config
verified: 2026-05-11T22:57:09Z
status: passed
score: 18/18 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 16/18
  gaps_closed:
    - "Host tier selector expansion now uses host-eligible metadata and is covered by unit and directed scenario assertions."
    - "Directed tier coverage now exercises tier:read-only with list_vault present and write tools denied."
    - "YAML scenario coverage no longer overclaims startup-only behaviors without executable steps; startup_success and startup_error steps are interpreted by the runner."
    - "Warning-only suspicious host category behavior has source/unit coverage for warning creation and YAML startup_success coverage for non-blocking startup."
    - "Legacy purpose startup failure evidence now exists in the runnable YAML scenario and directed startup failure path."
    - "TRACEABILITY CFG-05 integration mapping no longer points to llm-config-sync.test.ts as unsupported legacy-name evidence; it maps to foundation_host_tool_exposure.yml."
  gaps_remaining: []
  regressions: []
---

# Phase 122: Host Tool Exposure Config Verification Report

**Phase Goal:** Host MCP tool exposure and delegated model tool exposure resolve from the same selector grammar and metadata registry.
**Verified:** 2026-05-11T22:57:09Z
**Status:** passed
**Re-verification:** Yes - after gap closure

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `host_mcp_tools.tools` and `host_mcp_tools.excluded_tools` parse, validate, and default to today's all-tools-enabled host behavior. | VERIFIED | `src/config/loader.ts` defines/loads `host_mcp_tools`; `src/mcp/tool-exposure.ts` defaults to all current host-eligible non-dead metadata. Focused unit tests passed. |
| 2 | Tier, category, explicit-name, additive `doc-write` -> `doc-read`, and final exclusion semantics are implemented for host registration. | VERIFIED | `src/mcp/tool-exposure.ts:117-123` expands tiers from host-eligible metadata; `tests/unit/tool-exposure.test.ts:52-61` asserts `tier:read-only` includes `list_vault` and excludes writes. |
| 3 | Delegated native tool assembly starts from the host-enabled set and still applies purpose/model eligibility and hard exclusions. | VERIFIED | `src/mcp/tools/llm.ts` captures the gated native catalog; `tests/unit/llm-tool-registry.test.ts:232-261` proves host-disabled tools cannot be regained and `call_model` remains hard-excluded. |
| 4 | Legacy removed tool names in purpose config fail startup with actionable replacement suggestions. | VERIFIED | `src/config/loader.ts` validates purpose `tools`/`excluded_tools` through legacy suggestions; `tests/unit/llm-config.test.ts:253-284`, directed `_legacy_startup_fails`, and YAML `startup_error` assert replacement guidance. |
| 5 | Suspicious category combinations warn without blocking startup. | VERIFIED | `src/mcp/tool-exposure.ts:85-94` builds stable warnings; `tests/unit/tool-exposure.test.ts:73-80` asserts warning prefixes; YAML `startup_success` proves `category:llm` starts and exposes `call_model`. |
| 6 | Host-disabled tools are skipped before MCP SDK registration and native catalog capture. | VERIFIED | `src/mcp/tool-catalog.ts` returns before catalog push/original registration for filtered names; Plan 02 key links pass. |
| 7 | MCP `listTools` exposes only selected host-eligible tools and default config remains compatible. | VERIFIED | `tests/e2e/protocol.test.ts` and `tests/scenarios/integration/tests/foundation_host_tool_exposure.yml` assert present/absent tools for default and host-filtered configs. |
| 8 | Delegated purpose config cannot regain a host-disabled tool through explicit names or tiers. | VERIFIED | `tests/unit/llm-tool-registry.test.ts:232-241` and `:255-261` pass host-filtered catalogs and assert excluded delegated names remain absent/unknown. |
| 9 | Delegated hard exclusions still win over explicit delegated tool names. | VERIFIED | `tests/unit/llm-tool-registry.test.ts:244-252` asserts explicit `call_model` is excluded with the hard-exclusion diagnostic. |
| 10 | Directed scenario coverage records host/delegated filtering behaviors. | VERIFIED | `test_foundation_host_tool_exposure.py` covers default host surface, `tier:read-only`/category/explicit selector filtering, final deny, doc-write additive behavior, and legacy startup failure. Delegated catalog parity is backed by the verified product key link plus unit assembly tests. |
| 11 | YAML integration scenario coverage records config-to-host-to-delegated workflows. | VERIFIED | `foundation_host_tool_exposure.yml` now has three `mcp.list_tools` assertions plus executable `startup_success` and `startup_error` steps; `run_integration.py:840-944` implements those step types. |
| 12 | Phase validation records exact commands for unit, integration, E2E, directed, YAML integration, and build checks. | VERIFIED | `122-VALIDATION.md` records focused unit, integration, E2E, directed, YAML, and build commands/results. |
| 13 | Traceability is updated from planned targets to implemented files and scenario rows. | VERIFIED | `TRACEABILITY.md` maps CFG-01..CFG-06 to concrete unit/E2E/scenario files. CFG-05 now maps integration evidence to `foundation_host_tool_exposure.yml`, not the stale `llm-config-sync.test.ts` claim. |
| 14 | CFG-01 is accounted for. | VERIFIED | Requirements, resolver, loader schema, default behavior tests, directed row D-foundation-tools-2, and INT-foundation-tools-2 are present. |
| 15 | CFG-02 is accounted for. | VERIFIED | Host selector grammar covers tier/category/name and final deny in source, unit tests, directed test, E2E, and traceability. |
| 16 | CFG-03 is accounted for. | VERIFIED | `doc-write` additive behavior is implemented and covered by unit, directed, and YAML listTools evidence. |
| 17 | CFG-04 is accounted for. | VERIFIED | Host listTools filtering and delegated catalog intersection are implemented, wired, unit-tested, scenario-traced, and mapped in TRACEABILITY. |
| 18 | CFG-05 and CFG-06 are accounted for. | VERIFIED | CFG-05 has unit, directed, and YAML startup-failure evidence; CFG-06 has warning generation tests plus warning-only startup success coverage. |

**Score:** 18/18 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/mcp/tool-exposure.ts` | Pure host exposure resolver and warning helpers | VERIFIED | Substantive resolver; host tier expansion no longer delegates to delegated-only tier policy. |
| `src/config/loader.ts` | `host_mcp_tools` schema, resolution, warning accessors, legacy purpose validation | VERIFIED | Schema, runtime resolved exposure, warning attachment, and legacy validation are wired. |
| `src/mcp/tool-catalog.ts` | Registration wrapper gate using `hostEnabledToolNames` | VERIFIED | Filter occurs before catalog push and SDK registration. |
| `src/mcp/server.ts` | Server creation passes resolved host exposure to catalog wrapper | VERIFIED | Plan key-link verification passed. |
| `src/llm/tool-registry.ts` | Delegated assembly from host-filtered catalog | VERIFIED | Assembly intersects requested tools with supplied catalog names and applies hard exclusions. |
| `tests/scenarios/directed/testcases/test_foundation_host_tool_exposure.py` | Runnable directed scenario coverage | VERIFIED | Covers default, tier/category/name selectors, final deny, doc-write additive behavior, and legacy startup failure. |
| `tests/scenarios/integration/tests/foundation_host_tool_exposure.yml` | Runnable YAML integration workflow | VERIFIED | Contains `mcp.list_tools`, `startup_success`, and `startup_error` steps; YAML parses. |
| `.planning/phases/122-host-tool-exposure-config/TRACEABILITY.md` | CFG-01..CFG-06 evidence map | VERIFIED | CFG-05/CFG-06 mappings point at scenario evidence that now exists. |
| `.planning/phases/122-host-tool-exposure-config/122-VALIDATION.md` | Phase validation evidence | VERIFIED | Exact commands and result statuses present. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/config/loader.ts` | `src/mcp/tool-exposure.ts` | `resolveHostToolExposure` | VERIFIED | `gsd-sdk query verify.key-links` passed for Plan 01. |
| `src/mcp/tool-exposure.ts` | `src/mcp/tool-metadata.ts` | Metadata-backed expansion | VERIFIED | Host tiers/categories read metadata, not duplicated allowlists. |
| `src/config/loader.ts` | `src/mcp/server.ts` | `getResolvedHostToolExposure(config)` | VERIFIED | `gsd-sdk query verify.key-links` passed for Plan 02. |
| `src/mcp/tool-catalog.ts` | MCP SDK `registerTool` | Skip filtered names before original register | VERIFIED | `gsd-sdk query verify.key-links` passed for Plan 02. |
| `src/mcp/tool-catalog.ts` | `src/llm/tool-registry.ts` | Host-filtered native catalog | VERIFIED | `gsd-sdk query verify.key-links` passed for Plan 03. |
| `src/config/loader.ts` | `src/mcp/tool-metadata.ts` | `getLegacyToolSuggestion` for purpose tools | VERIFIED | `gsd-sdk query verify.key-links` passed for Plan 03. |
| `DIRECTED_COVERAGE.md` | directed testcase | Covered By row names | VERIFIED | Rows D-foundation-tools-2..7 map to `test_foundation_host_tool_exposure`. |
| `INTEGRATION_COVERAGE.md` | YAML workflow | Covered By workflow name | VERIFIED | Rows INT-foundation-tools-2..5 map to `foundation_host_tool_exposure`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/config/loader.ts` | `_resolvedHostToolExposure` | `resolveHostToolExposure(config.hostMcpTools)` | Yes | FLOWING |
| `src/mcp/server.ts` | `hostEnabledToolNames` | `getResolvedHostToolExposure(config).hostEnabledToolNames` | Yes | FLOWING |
| `src/mcp/tool-catalog.ts` | native catalog | gated `server.registerTool` calls | Yes | FLOWING |
| `src/mcp/tools/llm.ts` | `nativeToolCatalog` | `getNativeToolCatalog(server)` after gated registration | Yes | FLOWING |
| `src/llm/tool-registry.ts` | `nativeToolNames` | supplied host-filtered catalog plus purpose selectors | Yes | FLOWING |
| `foundation_host_tool_exposure.yml` | startup/listTools assertions | YAML runner step interpreter | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Host tier expansion, legacy startup validation, delegated host intersection | `npm test -- tests/unit/tool-exposure.test.ts tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` | 3 files, 69 tests passed | PASS |
| YAML scenario remains parseable after startup step additions | `python3 -c "import yaml; yaml.safe_load(open('tests/scenarios/integration/tests/foundation_host_tool_exposure.yml')); print('yaml ok')"` | `yaml ok` | PASS |
| Artifact and key-link checks | `gsd-sdk query verify.artifacts ...` and `gsd-sdk query verify.key-links ...` for Plans 01-04 | All artifacts and key links passed | PASS |
| Managed directed/YAML/E2E/integration/build commands | Not rerun in this verification pass | Recorded as green in `122-VALIDATION.md`; verifier did not start managed servers beyond unit/parser checks | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CFG-01 | Plans 01, 04 | Configure `host_mcp_tools.tools` and `excluded_tools` with shared selector grammar | SATISFIED | Loader schema/accessor, resolver, default tests, directed/YAML rows. |
| CFG-02 | Plans 01, 02, 04 | Select by tier/category/name with final deny layer | SATISFIED | Host tier source/unit fix, directed tier coverage, E2E/listTools evidence. |
| CFG-03 | Plans 01, 04 | `doc-write` includes `doc-read`; `doc-read` remains read-only | SATISFIED | Metadata-backed expansion and unit/directed coverage. |
| CFG-04 | Plans 02, 03, 04 | `listTools` host filtering and delegated host-start set | SATISFIED | Registration gate, E2E/YAML listTools, unit delegated catalog intersection, traceability rows. |
| CFG-05 | Plans 03, 04 | Legacy removed purpose names fail with suggestions | SATISFIED | Unit legacy tests, directed startup failure helper, YAML `startup_error`, TRACEABILITY CFG-05 mapping. |
| CFG-06 | Plans 01, 03, 04 | Suspicious combinations warn without refusing startup | SATISFIED | Warning builder tests and YAML `startup_success` for `category:llm`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/mcp/tool-catalog.ts` | 19 | `return []` | Info | Intentional default empty catalog before tools register; not a stub. |
| `src/mcp/server.ts` | 162, 172, 177 | `return null` | Info | Intentional config parsing fallbacks; not related to Phase 122 gaps. |
| `src/mcp/tool-exposure.ts` | 101 | `return []` | Info | Empty selector expansion path for no selectors; not user-visible stub behavior. |

### Human Verification Required

None. Prior human-only concern was warning wording clarity; source strings are explicit diagnostics and do not describe `host_mcp_tools` as an authorization/security boundary.

### Gaps Summary

No blocking gaps remain. The previous blockers were closed by real executable evidence: host tier expansion is source/unit/directed covered, YAML startup steps are implemented by the runner, legacy startup failures have runnable scenario evidence, and CFG-05 traceability no longer relies on an unsupported integration-test claim.

---

_Verified: 2026-05-11T22:57:09Z_
_Verifier: the agent (gsd-verifier)_
