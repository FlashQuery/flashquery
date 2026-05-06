---
phase: 116-model-visible-tool-registry
plan: 04
subsystem: llm
tags: [call-model, tool-registry, native-tools, directed-scenario, vitest]

requires:
  - phase: 116-model-visible-tool-registry
    provides: Native registry expansion, schema translation, catalog capture, and startup validation from Plans 01-03
provides:
  - Purpose call_model provider-tool wiring for non-empty native registries
  - Public metadata.tools diagnostics with snake_case keys
  - Empty native-tool registry omission for provider requests
  - Managed public directed scenario coverage for VAL-116
affects: [phase-117-agent-loop-executor, phase-119-discovery-diagnostics, phase-120-cross-phase-validation]

tech-stack:
  added: []
  patterns: [Purpose-only provider tool merge, public registry diagnostics envelope, deterministic OpenAI-compatible scenario mock]

key-files:
  created:
    - tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py
    - .planning/phases/116-model-visible-tool-registry/116-04-SUMMARY.md
  modified:
    - src/llm/types.ts
    - src/mcp/tools/llm.ts
    - tests/unit/llm-tool.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - .planning/phases/116-model-visible-tool-registry/116-VALIDATION.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "Kept registry provider tools scoped to resolver='purpose'; direct model calls still pass only caller-supplied provider parameters."
  - "Exposed public diagnostics with snake_case keys while preserving internal registry diagnostics in camelCase."
  - "Used a deterministic local OpenAI-compatible mock provider for VAL-116 instead of requiring external LLM credentials."

patterns-established:
  - "Purpose call_model requests compute selected-model strict support through client.getModelForPurpose plus modelCapabilitiesWithDefaults before assembling provider tools."
  - "Directed provider-shape scenarios can decode chunked OpenAI-compatible requests from Node's HTTP client."

requirements-completed: [TOOL-01, TOOL-02, TOOL-03, TOOL-04, VAL-116]

duration: 12min
completed: 2026-05-06
---

# Phase 116 Plan 04: call_model Native Registry Wiring Summary

**Purpose-based call_model requests now pass model-visible native tools to providers only when non-empty and report public hard-exclusion diagnostics**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-06T12:08:07Z
- **Completed:** 2026-05-06T12:19:22Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added RED unit coverage proving purpose calls pass `get_document` as a provider function tool, omit empty registries, expose `metadata.tools.native_tool_names`, and report `hard_excluded`.
- Wired `src/mcp/tools/llm.ts` to assemble native registries for purpose calls, merge non-empty provider tools, and keep direct model calls unchanged.
- Added `CallModelMetadata.tools` and public snake_case diagnostics.
- Added `test_call_model_native_tool_registry.py` managed scenario and updated VAL-116 coverage, validation, requirements, and roadmap traceability.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add call_model registry wiring tests** - `da64ac7` (test)
2. **Task 2: Wire registry assembly into purpose calls** - `4ec0def` (feat)
3. **Task 3: Add public scenario and close validation traceability** - `5cc6cbc` (test)

**Plan metadata:** final docs commit pending

## Files Created/Modified

- `tests/unit/llm-tool.test.ts` - Adds Phase 116 purpose-path provider parameter and metadata assertions.
- `src/llm/types.ts` - Adds optional `CallModelMetadata.tools`.
- `src/mcp/tools/llm.ts` - Assembles native tool registry for purpose calls and wires provider parameters plus public diagnostics.
- `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py` - Managed public VAL-116 scenario with deterministic mock provider.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Adds L-85 coverage row and testcase mapping.
- `.planning/phases/116-model-visible-tool-registry/116-VALIDATION.md` - Marks Phase 116 validation complete and records runnable commands.
- `.planning/REQUIREMENTS.md` - Updates last-updated marker after Phase 116 validation.
- `.planning/ROADMAP.md` - Marks Phase 116 and Plan 116-04 complete.

## Decisions Made

- Kept native provider tool assembly out of `resolver='model'` so direct calls remain unchanged unless callers explicitly pass provider parameters.
- Passed provider `tools` only when `registry.providerTools` is non-empty; empty registries pass `{}` for tool-configured purposes, never `tools: []`.
- Used local deterministic provider capture in the directed scenario because VAL-116 needs provider request evidence without depending on external API credentials.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Selected the scenario's provider request by prompt instead of first request**
- **Found during:** Task 3 (Add public scenario and close validation traceability)
- **Issue:** The mock provider can receive lifecycle/startup requests before the scenario's target call, so checking the first captured request could inspect the wrong body.
- **Fix:** Added `_request_for_prompt()` and selected the request matching each `call_model` prompt.
- **Files modified:** `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py`
- **Verification:** `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed` passed.
- **Committed in:** `5cc6cbc`

**2. [Rule 1 - Bug] Added chunked transfer decoding to the scenario mock provider**
- **Found during:** Task 3 (Add public scenario and close validation traceability)
- **Issue:** Node's HTTP client sent the provider request with chunked transfer encoding, so the Python mock's `Content-Length`-only reader captured an empty body.
- **Fix:** Added chunked-body decoding to the mock provider handler.
- **Files modified:** `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py`
- **Verification:** `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed` passed.
- **Committed in:** `5cc6cbc`

---

**Total deviations:** 2 auto-fixed (2 bugs).
**Impact on plan:** Both fixes were test-harness correctness fixes required to prove VAL-116 provider request behavior. No product scope expansion.

## Issues Encountered

- The workspace had pre-existing dirty LLM/config/test changes. Task commits staged only plan-related files; unrelated dirty changes remain in the working tree.
- Managed directed scenarios execute `dist/index.js`, so `npm run build` was run before the first scenario attempt to ensure the local server used the new wiring.
- `.planning/` is ignored by `.gitignore`; the Phase 116 validation file was force-added because it was explicitly required by the plan.

## Known Stubs

None. Stub scan hits were test-local empty collection/error initializers and the mock provider's placeholder API key string; no production placeholder behavior or unwired data path was introduced.

## Threat Flags

None. Production changes stayed within the planned `call_model` provider-request and metadata trust boundaries. The new HTTP server exists only inside the directed scenario test.

## Verification

- RED: `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool-registry.test.ts` - FAIL as expected before implementation, with 3 new registry wiring failures.
- Task 2: `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool-registry.test.ts` - PASS, 105 tests.
- Task 3 scenario: `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed` - PASS, 2/2 steps.
- Full focused gate: `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed && npm run build` - PASS.
- Acceptance greps for `metadata.tools`, `native_tool_names`, `hard_excluded`, `assembleNativeToolRegistry`, `getNativeToolCatalog`, `tools?:`, and `test_call_model_native_tool_registry` all passed.

## User Setup Required

None - no external service configuration required beyond the repo's existing managed scenario prerequisites.

## Next Phase Readiness

Phase 117 can consume purpose `metadata.tools.native_tool_names` and provider tool definitions for the agent loop executor. Direct model calls remain isolated from automatic native tool exposure, and empty final registries are proven to omit provider `tools`.

## Self-Check: PASSED

- Found `src/llm/types.ts`
- Found `src/mcp/tools/llm.ts`
- Found `tests/unit/llm-tool.test.ts`
- Found `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py`
- Found `tests/scenarios/directed/DIRECTED_COVERAGE.md`
- Found `.planning/phases/116-model-visible-tool-registry/116-VALIDATION.md`
- Found `.planning/phases/116-model-visible-tool-registry/116-04-SUMMARY.md`
- Found commits `da64ac7`, `4ec0def`, and `5cc6cbc`
- Re-ran full focused verification successfully.

---
*Phase: 116-model-visible-tool-registry*
*Completed: 2026-05-06*
