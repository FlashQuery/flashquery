---
phase: 147-tooling-and-dependency-hygiene
plan: 3
subsystem: tooling
tags: [npm, dependencies, audit, chevrotain, macro-parser, macro-framework]

requires:
  - phase: 147-tooling-and-dependency-hygiene
    provides: "147-01 dependency baseline and 147-02 Knip preflight baseline"
provides:
  - "Root Chevrotain v12 update with parser, typecheck, and lint regression evidence"
  - "Nested macro golden-model Chevrotain v12 update and explicit audit decision"
  - "Clean Chevrotain-related npm audit evidence for root and nested package trees"
affects: [phase-147, req-006, macro-parser, macro-framework]

tech-stack:
  added: []
  patterns: ["Isolate parser dependency major updates in their own package commits", "Record nested fixture audit state separately from root dependency acceptance"]

key-files:
  created:
    - .planning/phases/147-tooling-and-dependency-hygiene/147-03-SUMMARY.md
  modified:
    - package.json
    - package-lock.json
    - tests/macro-framework/macro-golden-model/package.json
    - tests/macro-framework/macro-golden-model/package-lock.json
    - .planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md

key-decisions:
  - "Updated the nested private macro golden-model package to Chevrotain 12 instead of excluding it from REQ-006 audit closure."
  - "No macro parser source or parser test assertion changes were needed because Chevrotain 12 preserved the existing parser behavior gates."

patterns-established:
  - "Chevrotain verification evidence records root and nested package decisions, regression commands, and audit results as separate rows."

requirements-completed: []

duration: 4m49s
completed: 2026-05-24
---

# Phase 147 Plan 3: Isolated Chevrotain Upgrade Summary

**Root and nested macro parser packages now resolve to Chevrotain 12 with parser, framework, typecheck, lint, and audit evidence recorded.**

## Performance

- **Duration:** 4m49s
- **Started:** 2026-05-24T16:37:01Z
- **Completed:** 2026-05-24T16:41:50Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Upgraded root `chevrotain` from `^11.2.0` to `^12.0.0` and regenerated the root lockfile.
- Upgraded the nested private macro golden-model package from `^11.0.3` to `^12.0.0` from inside its package directory.
- Removed the Chevrotain 11 / `lodash-es` advisory chain from both root and nested package trees.
- Recorded T-U-013, T-U-014, root audit, production audit, and nested audit evidence in `147-dependency-baseline.md`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade root Chevrotain to v12 with parser regression gate** - `33c9335` (chore)
2. **Task 2: Resolve nested macro golden-model Chevrotain audit state** - `d11075d` (chore)
3. **Task 3: Record Chevrotain verification evidence** - `caf0658` (docs)

## Files Created/Modified

- `package.json` - Root `chevrotain` dependency range updated to `^12.0.0`.
- `package-lock.json` - Root lockfile regenerated with Chevrotain 12 packages and no root Chevrotain 11 path.
- `tests/macro-framework/macro-golden-model/package.json` - Nested fixture `chevrotain` dependency range updated to `^12.0.0`.
- `tests/macro-framework/macro-golden-model/package-lock.json` - Nested lockfile regenerated from inside the nested package.
- `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md` - Nested decision and Chevrotain verification evidence appended.

## Decisions Made

- Updated the nested private golden-model package rather than documenting it out of root acceptance scope.
- Left parser source and parser test assertions unchanged because existing parser and framework regression gates stayed green.
- Kept MCP SDK wanted drift deferred to Plan 147-04; it is not parser-related.

## Verification

- `npm test -- --run tests/unit/macro-parser.test.ts` - passed, 1 file / 35 tests.
- `npm run test:macro-framework` - passed, 1 file / 518 tests.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npm audit` - passed, found 0 vulnerabilities.
- `npm audit --omit=dev` - passed, found 0 vulnerabilities.
- `npm audit` in `tests/macro-framework/macro-golden-model` - passed, found 0 vulnerabilities.
- `npm outdated` - exits 1 with remaining non-parser drift: deferred `@modelcontextprotocol/sdk` wanted drift and `uuid` latest-major drift.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npm run script` inside `tests/macro-framework/macro-golden-model` starts the nested CLI but exits with usage when no macro file is supplied. This was not treated as a failed smoke because the root `npm run test:macro-framework` gate is the planned framework verification and passed.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 147-04 can proceed with the MCP SDK update/deferral decision and final Phase 147 command gates. Chevrotain-related root and nested audit findings are closed.

## Self-Check: PASSED

- Found `package.json`.
- Found `package-lock.json`.
- Found `tests/macro-framework/macro-golden-model/package.json`.
- Found `tests/macro-framework/macro-golden-model/package-lock.json`.
- Found `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md`.
- Found `.planning/phases/147-tooling-and-dependency-hygiene/147-03-SUMMARY.md`.
- Found task commits `33c9335`, `d11075d`, and `caf0658`.
- Required verification commands passed.

---
*Phase: 147-tooling-and-dependency-hygiene*
*Completed: 2026-05-24*
