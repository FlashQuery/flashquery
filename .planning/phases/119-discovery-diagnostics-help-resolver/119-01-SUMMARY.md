---
phase: 119-discovery-diagnostics-help-resolver
plan: 01
subsystem: testing
tags: [call-model, discovery, diagnostics, help-resolver, red-tests]

requires:
  - phase: 118-template-discovery-masquerade-dispatch
    provides: Template discovery, template diagnostics, native/template registry merging, and directed scenario patterns
provides:
  - RED unit contracts for the Phase 119 help resolver and discovery diagnostics
  - RED capability diagnostics contracts for unknown versus declared-unsupported model capabilities
  - ATL-DS-15 managed directed scenario skeleton for public resolver="help" behavior
affects: [phase-119, phase-120, call-model, validation]

tech-stack:
  added: []
  patterns:
    - RED-first public JSON contract tests for discovery/help resolvers
    - Managed directed scenario assertions over public MCP call_model behavior

key-files:
  created:
    - tests/scenarios/directed/testcases/test_call_model_help_resolver.py
    - .planning/phases/119-discovery-diagnostics-help-resolver/119-01-SUMMARY.md
  modified:
    - tests/unit/llm-tool.test.ts
    - tests/unit/llm-template-tools.test.ts
    - tests/unit/llm-tool-registry.test.ts
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Plan 01 intentionally leaves focused validation RED so Plan 02 can implement exact public discovery/help contracts."
  - "Help resolver tests require raw JSON outside CallModelEnvelope and assert stable top-level key order."

patterns-established:
  - "Discovery drift tests assert resolver values and no-envelope behavior before production implementation."
  - "Capability diagnostic tests distinguish unknown_declaration remediation from declared_unsupported states."

requirements-completed: [DISC-01, DISC-02, DISC-03, DISC-04, VAL-119]

duration: 6min
completed: 2026-05-06
---

# Phase 119 Plan 01: RED Validation Surface Summary

**RED public contract coverage for `call_model` discovery diagnostics, search metadata, and the v1 help resolver.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-06T23:52:19Z
- **Completed:** 2026-05-06T23:57:55Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added RED unit contracts for `resolver: "help"` availability, exact help key order, raw JSON/no-envelope behavior, resolver-list drift, and search diagnostic metadata.
- Added RED unit contracts for `list_purposes` native/template diagnostics and `list_models` unknown-vs-false capability diagnostics.
- Created the ATL-DS-15 managed directed scenario proving public MCP help behavior after Plan 02 implements the resolver.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RED help resolver and discovery drift contracts** - `a3358c4` (test)
2. **Task 2: Add RED diagnostics contracts for purposes and models** - `413360b` (test)
3. **Task 3: Create directed help scenario skeleton** - `9cea873` (test)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `tests/unit/llm-tool.test.ts` - Adds RED help resolver, search metadata, purpose diagnostics, and model capability diagnostics contracts.
- `tests/unit/llm-template-tools.test.ts` - Pins stable empty template diagnostic arrays from the template registry source.
- `tests/unit/llm-tool-registry.test.ts` - Pins stable empty native diagnostic arrays from the native registry source.
- `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` - Adds ATL-DS-15 public MCP help resolver scenario skeleton.

## Decisions Made

Plan 01 remains RED by design. No production behavior was changed; all failures are missing Phase 119 implementation behavior that Plan 02 is expected to satisfy.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The focused failures are expected RED evidence for missing implementation, not execution blockers.

## Verification

- `npm test -- tests/unit/llm-tool.test.ts` - RED as expected: 9 focused failures for missing help resolver, missing capability diagnostics, missing native purpose diagnostics, and missing search diagnostic indexing.
- `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` - RED as expected: `llm-template-tools` and `llm-tool-registry` pass; `llm-tool` has the 9 missing public discovery/help behavior failures.
- `python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed` - RED as expected: MCP input validation rejects `resolver="help"` because the production resolver enum has not been extended yet.

## User Setup Required

None - no external service configuration required beyond the existing managed scenario harness.

## Known Stubs

None. Stub-pattern scan matches intentional reference placeholder test fixtures and the managed scenario's `sk-test-placeholder` fallback for non-calling discovery tests.

## Threat Flags

None. This plan added tests only and introduced no new runtime endpoint, auth path, file access surface, or schema trust boundary.

## Next Phase Readiness

Plan 02 can implement the help resolver, capability diagnostics, native/template purpose diagnostics, and search metadata directly against this RED surface.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/119-discovery-diagnostics-help-resolver/119-01-SUMMARY.md`.
- Task commits exist in git log: `a3358c4`, `413360b`, `9cea873`.
- Key files exist on disk.
- No tracked file deletions were introduced.
- Verification commands produced the expected RED failures for missing implementation only.

---
*Phase: 119-discovery-diagnostics-help-resolver*
*Completed: 2026-05-06*
