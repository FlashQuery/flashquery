---
phase: 167-lifecycle-operations-and-validation
plan: 01
subsystem: mcp
tags: [maintain-vault, embeddings, lifecycle, validation, max-rows]

requires:
  - phase: 166-embedding-pipeline
    provides: plugin embedding resolution, per-entry write/search routing, and embedding catalog behavior consumed by lifecycle scope rules
provides:
  - maintain_vault lifecycle action input contract
  - max_rows pure validation foundation
  - pure-records rebuild confirm resolution contract
  - lifecycle response type foundation
affects: [maintain_vault, lifecycle-processors, embedding-operator-recipes]

tech-stack:
  added: []
  patterns:
    - Zod MCP input schema extension
    - Pure lifecycle validation helpers returning ErrorEnvelope-compatible results
    - Expected-error dispatcher placeholders for future lifecycle processors

key-files:
  created:
    - src/embedding/lifecycle/types.ts
    - src/embedding/lifecycle/scope.ts
    - tests/unit/max-rows-contract.test.ts
  modified:
    - src/mcp/tools/scan.ts
    - src/mcp/tool-help/maintain_vault.tool.md
    - src/services/maintenance.ts
    - src/mcp/utils/response-formats.ts

key-decisions:
  - "Lifecycle execution remains an explicit unsupported placeholder in Plan 167-01; this plan establishes validation contracts for later processors."
  - "Lifecycle actions are accepted as single actions at the MCP schema layer but rejected when included in action arrays before mutation."
  - "max_rows validation is pure and returns ErrorEnvelope-compatible invalid_input results before downstream DML, DDL, provider, or lock work can run."

patterns-established:
  - "Lifecycle validation result: pure helpers return { ok, payload | error } with ErrorEnvelope-compatible failures."
  - "Derived records confirm: pure-records rebuild can derive one expected confirm from resolved plugin work units or reject multiple names with narrowing guidance."

requirements-completed: [REQ-038, REQ-039, REQ-040]

duration: ~8min
completed: 2026-06-11
---

# Phase 167 Plan 01: Lifecycle Contract and Max Rows Summary

**maintain_vault lifecycle input contract with pure max_rows validation and derived records-scope rebuild confirm rules**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-11T13:20:00Z
- **Completed:** 2026-06-11T13:27:25Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments

- Extended `maintain_vault` to accept `backfill_embeddings`, `rebuild_embeddings`, `retire_embedding`, and `abort` plus lifecycle parameters at the Zod/MCP boundary.
- Added lifecycle types and pure validation helpers for `max_rows`, action-specific parameter rules, lifecycle array rejection, and pure-records rebuild confirm derivation.
- Added T-U-036 through T-U-040 unit coverage for REQ-040 and additional contract coverage for lifecycle action arrays and records-scope confirm resolution.

## Task Commits

1. **Task 1 RED: max_rows lifecycle contract tests** - `7898c56` (test)
2. **Task 1 GREEN: lifecycle contract validation foundation** - `cd78c20` (feat)

## Files Created/Modified

- `src/embedding/lifecycle/types.ts` - Lifecycle action, scope, count, failure, estimate, job, and validation result contracts.
- `src/embedding/lifecycle/scope.ts` - Pure validation helpers for `max_rows`, action-specific lifecycle parameters, action detection, and derived rebuild confirm resolution.
- `tests/unit/max-rows-contract.test.ts` - REQ-040 T-U-036 through T-U-040 coverage plus lifecycle action-array and records confirm contract tests.
- `src/mcp/tools/scan.ts` - `maintain_vault` Zod schema extended with lifecycle actions and parameters.
- `src/services/maintenance.ts` - Lifecycle dispatcher validation hook and pre-work rejection for lifecycle action arrays.
- `src/mcp/utils/response-formats.ts` - Maintenance result union extended for lifecycle count/result shapes while preserving legacy sync/repair shape.
- `src/mcp/tool-help/maintain_vault.tool.md` - Lifecycle parameter matrix, non-combinable action rule, max_rows contract, derived confirm contract, and external-spec authority note.

## Decisions Made

- Lifecycle processors intentionally return expected `unsupported` after validation until later Plan 167 work wires concrete handlers.
- The only valid action-array path remains legacy `repair`/`sync`; any array containing a lifecycle action returns `invalid_input` before shutdown checks, lock acquisition, scanner mutation, DML, DDL, or provider calls.
- `max_rows: 0` and omitted backfill `max_rows` normalize to unlimited in pure validation, while rebuild omission and retire usage return `invalid_input`.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- `gsd-sdk` was unavailable on PATH, consistent with prior phase notes. Summary creation and `STATE.md` update were handled directly; `ROADMAP.md` was intentionally not updated per user instruction.

## Known Stubs

- `src/services/maintenance.ts` lifecycle single-action dispatch validates inputs and then returns expected `unsupported`. This is intentional for Plan 167-01; concrete backfill/rebuild/retire/abort processors are assigned to later lifecycle plans.

## Authentication Gates

None.

## Verification

- `npm run test:unit -- tests/unit/max-rows-contract.test.ts` - passed, 13 tests.
- `npm run typecheck` - passed.
- `npm run test:unit -- tests/unit/maintain-vault.test.ts tests/unit/max-rows-contract.test.ts` - passed, 30 tests.

## Self-Check: PASSED

- Created files exist: `src/embedding/lifecycle/types.ts`, `src/embedding/lifecycle/scope.ts`, `tests/unit/max-rows-contract.test.ts`.
- Modified files exist: `src/mcp/tools/scan.ts`, `src/mcp/tool-help/maintain_vault.tool.md`, `src/services/maintenance.ts`, `src/mcp/utils/response-formats.ts`.
- Commits exist: `7898c56`, `cd78c20`.
- Required plan checks passed: targeted unit test and typecheck.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Downstream lifecycle processor plans can consume the stable `maintain_vault` input surface, the `LifecycleScope`/count/result types, and the pure validation helpers. Concrete lifecycle processing still needs durable job/lock, backfill/rebuild, retire, records-scope resolution, and abort implementations.

---
*Phase: 167-lifecycle-operations-and-validation*
*Completed: 2026-06-11*
