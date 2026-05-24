---
phase: 147-tooling-and-dependency-hygiene
plan: 1
subsystem: tooling
tags: [npm, dependencies, audit, lockfile, chevrotain, mcp-sdk]

requires:
  - phase: 147-tooling-and-dependency-hygiene
    provides: "REQ-006 source requirements and dependency hygiene plan"
provides:
  - "Pre-update npm audit, production audit, and outdated baseline evidence"
  - "Non-major wanted dependency lockfile refresh while deferring Chevrotain major and MCP SDK lanes"
affects: [phase-147, req-006, package-lock]

tech-stack:
  added: []
  patterns: ["Record audit/outdated evidence before package metadata edits", "Keep risky dependency lanes isolated in separate commits"]

key-files:
  created:
    - .planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md
  modified:
    - package-lock.json

key-decisions:
  - "Kept Chevrotain 12 out of 147-01 so parser major risk remains isolated for the dedicated Phase 147 lane."
  - "Corrected npm update's in-range MCP SDK lockfile refresh back to 1.27.1 to preserve the later SDK decision lane."

patterns-established:
  - "Dependency remediation evidence records command, timestamp, exit code, and remaining drift before and after npm update."

requirements-completed: []

duration: 4m12s
completed: 2026-05-24
---

# Phase 147 Plan 1: Dependency Baseline and Non-Major Updates Summary

**npm audit/outdated evidence captured before edits, then wanted non-major lockfile updates applied while preserving Chevrotain and MCP SDK deferrals.**

## Performance

- **Duration:** 4m12s
- **Started:** 2026-05-24T16:18:47Z
- **Completed:** 2026-05-24T16:22:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `147-dependency-baseline.md` with T-C-001, T-C-002, and T-C-003 pre-update evidence.
- Ran `npm update` and refreshed `package-lock.json` for wanted non-major dependency drift.
- Reduced npm audit findings from 13 full-tree / 12 production-tree advisories to 4 high advisories, all in the deferred Chevrotain 11 chain.
- Preserved `chevrotain@11.2.0` and `@modelcontextprotocol/sdk@1.27.1` for later Phase 147 lanes.

## Task Commits

1. **Task 1: Record dependency audit and drift baseline** - `96ff607` (docs)
2. **Task 2: Apply non-major wanted dependency updates** - `9a37040` (chore)

## Files Created/Modified

- `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md` - Pre/post command evidence for audit, production audit, and outdated drift.
- `package-lock.json` - npm-generated lockfile refresh for non-major dependency updates.

## Decisions Made

- Chevrotain stayed at `11.2.0`; the v12 parser major upgrade remains isolated for Plan 147-03.
- MCP SDK stayed at `1.27.1`; SDK drift remains deferred to the later Phase 147 decision lane.
- `package.json` was left unchanged because `npm update` satisfied the non-major lane through the existing semver ranges.

## Verification

- `test -f .planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md && rg -n "T-C-001|T-C-002|T-C-003|chevrotain|@modelcontextprotocol/sdk" .planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md` - passed.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npm test -- --run tests/unit/macro-parser.test.ts` - passed, 35 tests.
- Acceptance check confirmed lockfile v3, `chevrotain` range/install remained `^11.2.0` / `11.2.0`, and MCP SDK range/install remained `^1.27.1` / `1.27.1`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preserved MCP SDK deferral after npm update**
- **Found during:** Task 2
- **Issue:** `npm update` refreshed `@modelcontextprotocol/sdk` to `1.29.0` inside the existing `^1.27.1` range, conflicting with the plan's explicit SDK deferral.
- **Fix:** Ran `npm install @modelcontextprotocol/sdk@1.27.1` to regenerate the lockfile with the deferred SDK version while preserving other wanted non-major updates.
- **Files modified:** `package-lock.json`, `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md`
- **Verification:** Node acceptance check confirmed package and lockfile SDK range/install remained `^1.27.1` / `1.27.1`; typecheck, lint, and macro parser tests passed.
- **Committed in:** `9a37040`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking).  
**Impact on plan:** The correction preserved the intended review boundary; no scope expansion.

## Issues Encountered

- Remaining `npm audit` and `npm audit --omit=dev` output reports 4 high advisories through `chevrotain` 11 and `lodash-es`; this is expected and deferred to the isolated Chevrotain major lane.
- `npm outdated` still reports MCP SDK wanted drift and Chevrotain/uuid latest-major drift; these are documented in the baseline and deferred according to plan.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 147-02 can proceed with the Knip baseline. Plan 147-03 still owns the Chevrotain 12 major upgrade and macro framework regression gate. A later Phase 147 lane still owns the MCP SDK update/deferral decision.

## Self-Check: PASSED

- Found `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md`.
- Found task commits `96ff607` and `9a37040`.
- Acceptance criteria and verification commands listed above passed.

---
*Phase: 147-tooling-and-dependency-hygiene*
*Completed: 2026-05-24*
