---
phase: 121-foundation-metadata-response-helpers-test-harness
verified: 2026-05-11T21:36:36Z
status: passed
score: 18/18 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Full FND-02 host MCP registration/config validation legacy-name enforcement consumes central metadata"
    addressed_in: "Phase 122"
    evidence: "Phase 122 goal: Host MCP tool exposure and delegated model tool exposure resolve from the same selector grammar and metadata registry; success criteria include host registration selector semantics and legacy removed tool names in purpose config failing startup with actionable replacement suggestions."
---

# Phase 121: Foundation: Metadata, Response Helpers, Test Harness Verification Report

**Phase Goal:** FlashQuery has the shared metadata, response, frontmatter, and coverage scaffolding needed to migrate tools consistently.  
**Verified:** 2026-05-11T21:36:36Z  
**Status:** passed  
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Tool metadata has one canonical source for names, categories, host eligibility, delegated eligibility, tiers, and hard exclusions. | VERIFIED | `src/mcp/tool-metadata.ts` defines `TOOL_METADATA`, `ToolCategory`, `ToolTier`, `ToolStatus`, `hostEligible`, `delegatedEligible`, and `delegatedHardExcludedReason`; tests assert uniqueness, current/final/transitional/dead entries, tier expansion, and hard exclusions. |
| 2 | Shared JSON response helpers can emit success payloads, error envelopes, warnings, batch envelopes, and all required entity identification blocks. | VERIFIED | `src/mcp/utils/response-formats.ts` exports `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `withWarnings`, `batchResult`, and all five identification builders; unit tests parse helper output with `JSON.parse`. |
| 3 | Canonical expected-error handling and `isError` semantics are covered by focused unit tests and at least one representative handler integration test. | VERIFIED | Unit tests assert expected errors have `isError === false` and runtime errors have `isError === true`; `get_document` validation and not-found branches return parseable JSON expected errors; integration and E2E tests pass. |
| 4 | Frontmatter field usage in new/migrated foundation code goes through `FM.*` constants. | VERIFIED | `FM.ARCHIVED_AT` exists in `src/constants/frontmatter-fields.ts`; `documents.ts` migrated touched frontmatter access to `FM.*`; `tests/unit/no-hardcoded-extensions.test.ts` scans for new managed `fq_*` literals outside explicit legacy/fixture allowlists. |
| 5 | Phase-local traceability format exists and points to concrete unit, integration, E2E, directed scenario, and integration scenario coverage targets. | VERIFIED | All three plan files contain traceability tables mapping requirements to unit, integration, E2E, directed, and YAML integration coverage. Coverage ledgers contain `D-foundation-*` and `INT-foundation-*` rows tied to runnable files. |
| 6 | Phase validation runs the new foundation unit/integration/E2E/scenario checks that prove later phases have a stable test pattern. | VERIFIED | Re-ran focused unit suite, integration Vitest test, E2E protocol test, directed managed scenario, YAML managed integration scenario, and build; all passed. |
| 7 | Every current, final, transitional, removed, and dead MCP tool name has one metadata entry. | VERIFIED | `TOOL_METADATA` includes current registered tools, future final names such as `write_document`/`search`/`maintain_vault`, genuine transitional tools, hard-cutover removed tools, and dead `list_projects`/`get_project_info`; registration tests assert all current catalog tools have metadata. |
| 8 | Delegated tier expansion reads metadata-derived tiers instead of local arrays. | VERIFIED | `src/llm/tool-registry.ts` imports `getToolNamesByTier`/`getDelegatedHardExcludedTools`; `READ_ONLY_TOOL_NAMES` and `READ_WRITE_EXTRA_TOOL_NAMES` are absent; tier tests pass. |
| 9 | Tool descriptions are stored in metadata and satisfy XC-8 four-block template. | VERIFIED | `TOOL_METADATA` descriptions are generated with `Summary:`, `Use when:`, `Do not use when:`, and `Example:`; `tool-catalog.ts` uses metadata descriptions for SDK registration/catalog capture; unit and directed coverage assert registered descriptions. |
| 10 | Legacy name suggestions are represented in metadata for removed/merged tools. | VERIFIED | `getLegacyToolSuggestion()` returns replacement/message only for `status: "removed"` metadata entries; unit tests cover `create_document -> write_document`, `search_documents -> search`, and no suggestions for transitional `get_briefing`/`insert_doc_link`. Startup enforcement is deferred to Phase 122. |
| 11 | Shared JSON helpers produce MCP text content whose text parses as JSON. | VERIFIED | `jsonToolResult` stringifies payloads into `content[0].text`; helper, integration, E2E, directed, and YAML scenario tests parse JSON content. |
| 12 | Expected errors return canonical error envelopes with `isError: false`. | VERIFIED | `jsonExpectedError` returns `isError: false`; `get_document` invalid input and not-found paths return JSON expected errors; E2E asserts nonexistent document has `isError === false`. |
| 13 | Runtime failures can still return `isError: true`. | VERIFIED | `jsonRuntimeError` returns `isError: true`; helper unit test covers runtime failure semantics. |
| 14 | Document, memory, record, plugin, and LLM identification builders emit all required fields. | VERIFIED | `response-formats.ts` implements all five builders; `response-formats.test.ts` asserts every required field. |
| 15 | Frontmatter constants include consolidation-managed fields before migrated code uses them. | VERIFIED | `FM.ARCHIVED_AT === 'fq_archived_at'` is defined and tested. `ORIGINAL_PATH` was intentionally deferred because there is no current consumer. |
| 16 | A guard test prevents new hardcoded managed `fq_*` literals in source/test code outside allowlisted contexts. | VERIFIED | `tests/unit/no-hardcoded-extensions.test.ts` scans `src` and `tests` for managed `fq_*` string literals and fails outside explicit allowlists. |
| 17 | Directed and YAML integration scenario runners can assert JSON paths in MCP response payloads. | VERIFIED | `fqc_client.py` adds `parse_mcp_json`, `get_json_path`, and `expect_json_*`; `run_integration.py` supports `expect_json_path`, `expect_json_equals`, `expect_json_contains`, and `expect_json_array_length`. |
| 18 | Coverage ledgers include Phase 121 foundation rows and at least one runnable foundation scenario each. | VERIFIED | `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` contain Phase 121 rows; `test_foundation_json_response.py` and `foundation_json_response.yml` both passed under managed runs. |

**Score:** 18/18 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | Full FND-02 host registration and config startup legacy-name suggestion enforcement | Phase 122 | Phase 122 roadmap specifically covers host/delegated selector grammar, host registration filtering, and legacy removed tool names in purpose config failing startup with actionable replacement suggestions. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/mcp/tool-metadata.ts` | Canonical tool metadata registry and selector primitives | VERIFIED | Exists, substantive, exports registry/helper APIs, and is imported by delegated tool registry/tests. SDK pattern check falsely flagged comma-separated contains text, but manual symbol verification passed. |
| `tests/unit/tool-metadata.test.ts` | Registry completeness, tier/category, description, legacy suggestion coverage | VERIFIED | Tests uniqueness, status coverage, XC-8 descriptions, delegated tier expansion, category expansion, hard exclusions, and legacy suggestion behavior. |
| `tests/unit/llm-tool-registry.test.ts` | Delegated assembly derives from metadata | VERIFIED | Asserts tier output, hard exclusions, diagnostics, and strict schema behavior. |
| `src/mcp/utils/response-formats.ts` | JSON response helpers and identification builders | VERIFIED | Exports all required helpers/builders while preserving legacy helpers. SDK pattern check falsely flagged comma-separated contains text; manual symbol verification passed. |
| `tests/unit/response-formats.test.ts` | Helper-level response contract coverage | VERIFIED | Covers JSON parseability, expected/runtime error semantics, warnings, batch order, canonical codes, and identification builders. |
| `tests/integration/tools-response-format.test.ts` | Representative handler response smoke | VERIFIED | Captures `get_document` handler and asserts parseable expected-error JSON with `isError: false`; integration run passed. |
| `src/constants/frontmatter-fields.ts` | Central frontmatter constants including consolidation fields | VERIFIED | Defines `FM.ARCHIVED_AT`; unit tests assert constant and type inclusion. |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | Directed foundation coverage rows | VERIFIED | Contains `D-foundation-json-1`, `D-foundation-json-2`, `D-foundation-tools-1`, `D-foundation-frontmatter-1`, and `D-foundation-description-1`. |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | Integration foundation coverage rows | VERIFIED | Contains `INT-foundation-json-1`, `INT-foundation-json-2`, `INT-foundation-tools-1`, and `INT-foundation-frontmatter-1`. |
| `tests/scenarios/integration/tests/foundation_json_response.yml` | YAML JSON-path assertion fixture | VERIFIED | Exists and passed managed run with success, expected-error, and array JSON path assertions. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/mcp/tool-metadata.ts` | `src/llm/tool-registry.ts` | Metadata-derived tier and delegated eligibility helpers | WIRED | `tool-registry.ts` imports `getToolNamesByTier` and `getDelegatedHardExcludedTools`; tier and hard-exclusion exports derive from metadata. |
| `src/mcp/tool-catalog.ts` | `src/mcp/tool-metadata.ts` | Registered tool metadata validation and descriptions | WIRED | Runtime catalog capture remains in `tool-catalog.ts`; registered SDK descriptions prefer `TOOL_METADATA.description`; `mcp-server-tools.test.ts` wires catalog output into `assertRegisteredToolsHaveMetadata`/`requireToolMetadata`. |
| `src/mcp/utils/response-formats.ts` | `src/mcp/tools/*` | Shared helper imports for migrated handlers | WIRED | `src/mcp/tools/documents.ts` imports and uses `jsonToolResult`, `jsonExpectedError`, and `jsonRuntimeError` for `get_document`. |
| `tests/scenarios/framework/fqc_client.py` | `tests/scenarios/directed/run_suite.py` | Parsed JSON response helper | WIRED | Directed test imports `parse_mcp_json`/`get_json_path`; `run_suite.py --managed foundation` discovers and runs the foundation test. |
| `tests/scenarios/integration/run_integration.py` | `tests/scenarios/integration/tests/foundation_json_response.yml` | `expect_json_*` assertions | WIRED | Runner implements `expect_json_*`; YAML fixture uses those assertions and passed. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `get_document` helper-backed response | `result` / `results` | `resolveAndBuildDocument(...)` in `src/mcp/tools/documents.ts` | Yes | FLOWING - success payload comes from resolver output and is returned through `jsonToolResult`; expected errors come from validation/not-found branches. |
| Directed scenario JSON assertions | `ToolResult.text` parsed by `parse_mcp_json` | Actual MCP `get_document` calls in `test_foundation_json_response.py` | Yes | FLOWING - managed run created a real fixture, scanned vault, parsed success JSON, and asserted expected error JSON. |
| YAML integration JSON assertions | `result` from MCP assert step | Actual MCP calls from `foundation_json_response.yml` | Yes | FLOWING - managed YAML run passed success, not-found, and array assertions. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Foundation unit coverage passes | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/response-formats.test.ts tests/unit/frontmatter-fields.test.ts tests/unit/no-hardcoded-extensions.test.ts` | 6 files, 51 tests passed | PASS |
| Build succeeds | `npm run build` | ESM and DTS build succeeded | PASS |
| Representative integration response-format test passes | `npx vitest run --config tests/config/vitest.integration.config.ts tests/integration/tools-response-format.test.ts` | 1 file, 3 tests passed | PASS |
| Directed foundation scenario passes | `python3 tests/scenarios/directed/run_suite.py --managed foundation` | 1 scenario passed, 0 failed | PASS |
| YAML integration foundation workflow passes | `python3 tests/scenarios/integration/run_integration.py --managed foundation` | 1/1 workflow passed | PASS |
| E2E protocol helper-backed JSON smoke passes | `npm run test:e2e -- tests/e2e/protocol.test.ts` | 1 file, 13 tests passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| FND-01 | 121-01 | Central metadata registry for tool names/categories/eligibility/tier/exclusions | SATISFIED | `TOOL_METADATA` and helper tests verify registry completeness and selector primitives. |
| FND-02 | 121-01 | Host registration, config validation, delegated assembly, and legacy suggestions consume central metadata | PARTIAL WITH DEFERRED SUBSCOPE | Delegated assembly and legacy suggestion helper consume metadata now; host registration filtering and config legacy-name startup enforcement are explicitly Phase 122. |
| FND-03 | 121-02 | Shared JSON response helpers | SATISFIED | Helper exports and tests cover success, expected/runtime errors, warnings, batch, and identification builders. |
| FND-04 | 121-02 | Expected errors use structured JSON with `isError: false`; runtime failures use `isError: true` | SATISFIED | Unit, integration, and E2E tests cover expected and runtime semantics. |
| FND-05 | 121-02 | Canonical codes are lowercase snake_case | SATISFIED | `CANONICAL_ERROR_CODES` and tests assert lowercase snake_case shared vocabulary. |
| FND-06 | 121-02 | Migrated entity-returning tools include required identification block | SATISFIED | `get_document` returns resolver envelope with identification fields; builder tests cover all entity types. |
| FND-07 | 121-03 | Frontmatter access uses `FM.*` constants | SATISFIED | `FM.ARCHIVED_AT` added; guard test blocks new hardcoded managed literals. |
| FND-08 | 121-01 | Tool descriptions follow four-block template | SATISFIED | Metadata descriptions, registered catalog descriptions, and `D-foundation-description-1` assert all four labeled blocks. |
| TEST-01 | 121-01/02/03 | Phase-local traceability table before coding | SATISFIED | All three PLAN files contain traceability tables. |
| TEST-02 | 121-01/02/03 | Unit tests for schema/helper/error paths | SATISFIED | Focused unit suite passed. |
| TEST-03 | 121-02/03 | Integration tests for representative happy/error paths | SATISFIED | Integration Vitest and YAML workflow passed. |
| TEST-04 | 121-02/03 | E2E MCP protocol coverage | SATISFIED | `tests/e2e/protocol.test.ts` parses helper-backed `get_document` success and expected error; E2E run passed. |
| TEST-05 | 121-03 | Directed scenario coverage rows and runnable cases | SATISFIED | Directed coverage rows and `test_foundation_json_response.py`; managed run passed. |
| TEST-06 | 121-03 | YAML integration coverage rows and runnable workflows | SATISFIED | Integration coverage rows and `foundation_json_response.yml`; managed run passed. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| None | - | - | - | No blocker or warning anti-patterns found in modified phase files. Empty returns/nulls found by grep are ordinary helper/control-flow cases, not stubs. |

### Human Verification Required

None.

### Gaps Summary

No blocking gaps found. The phase achieved the foundation goal: central metadata, JSON response helpers, expected-error semantics, frontmatter guardrails, and scenario JSON assertion scaffolding all exist, are wired, and pass focused checks.

The only non-immediate part of the broad FND-02 wording is full host registration/config legacy-name enforcement. That is not treated as a Phase 121 gap because Phase 122 explicitly owns host selector grammar, host registration filtering, delegated host-surface alignment, and legacy-name startup suggestions.

---

_Verified: 2026-05-11T21:36:36Z_  
_Verifier: the agent (gsd-verifier)_
