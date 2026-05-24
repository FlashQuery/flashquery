---
phase: 147-tooling-and-dependency-hygiene
plan: 2
subsystem: tooling
tags: [knip, npm, preflight, static-analysis]

requires:
  - phase: 147-tooling-and-dependency-hygiene
    provides: "147-01 dependency baseline and package-lock update lane"
provides:
  - "Typed ESM Knip configuration with required worktree/build/vendor exclusions"
  - "npm run knip file/dependency reachability gate"
  - "T-U-015 static coverage for required Knip ignore globs"
  - "Preflight integration plus documented staged export-reporting rationale"
affects: [phase-147, req-007, preflight, package-scripts]

tech-stack:
  added: [knip]
  patterns: ["Typed ESM tooling configs", "Stage broad export cleanup behind documented exact findings"]

key-files:
  created:
    - knip.ts
    - tests/unit/knip-config.test.ts
    - .planning/phases/147-tooling-and-dependency-hygiene/147-02-SUMMARY.md
  modified:
    - package.json
    - package-lock.json
    - .planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md

key-decisions:
  - "Knip preflight now gates files, dependencies, unlisted dependencies, binaries, and unresolved imports while export reporting remains staged with exact findings documented."
  - "Kept required worktree/build/vendor ignore globs in knip.ts even though Knip emits config hints for them; the plan requires those exact exclusions."

patterns-established:
  - "Knip staged rollout: green preflight scope first, exact export findings documented before future API-surface cleanup."

requirements-completed: [REQ-007]

duration: 6m15s
completed: 2026-05-24
---

# Phase 147 Plan 2: Knip Baseline and Preflight Policy Summary

**Knip file/dependency reachability now runs from package scripts and preflight with explicit noise exclusions and T-U-015 coverage.**

## Performance

- **Duration:** 6m15s
- **Started:** 2026-05-24T16:27:30Z
- **Completed:** 2026-05-24T16:33:40Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added `knip` as an approved dev dependency with a typed ESM `knip.ts` config.
- Added T-U-015 static coverage asserting `.claude/worktrees/**`, `src/node_modules/**`, and `src/dist/**`.
- Added `npm run knip` and wired it into `npm run preflight` after typecheck.
- Documented staged export-reporting rationale and exact export findings in `147-dependency-baseline.md`.

## Task Commits

1. **Task 1: Add T-U-015 Knip exclusion assertion** - `8729cfe` (test)
2. **Task 2: Add typed Knip config and package script** - `3162bb5` (chore)
3. **Task 3: Wire Knip into preflight or staged preflight script** - `847bf5c` (chore)

## Files Created/Modified

- `knip.ts` - Typed Knip config with explicit reachability policy, required ignores, and dependency exceptions.
- `tests/unit/knip-config.test.ts` - T-U-015 static assertion with missing-glob failure messages.
- `package.json` - Added `knip` script, dev dependency, and preflight integration.
- `package-lock.json` - npm-generated lockfile entries for `knip`.
- `.planning/phases/147-tooling-and-dependency-hygiene/147-dependency-baseline.md` - Added Knip staged rollout evidence and exact export findings.

## Decisions Made

- The committed Knip script gates file, dependency, unlisted dependency, binary, and unresolved-import reachability today.
- Full export reporting is staged because the first full run reported existing public/tooling/test-helper exports requiring separate API-surface triage.
- `@types/uuid` and `esbuild` are explicitly ignored in `knip.ts`; their rationale is recorded in the dependency baseline.

## Verification

- `test -f tests/unit/knip-config.test.ts && rg -n "T-U-015|\\.claude/worktrees/\\*\\*|src/node_modules/\\*\\*|src/dist/\\*\\*" tests/unit/knip-config.test.ts` - passed.
- `npm test -- --run tests/unit/knip-config.test.ts` - passed, 1 test.
- `npm run knip` - passed.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npm run preflight` - passed; `preflight:test` passed 142 files / 1,971 tests, package dry-run passed, Docker compose validation skipped because Docker is not installed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Full unscoped Knip export reporting produced existing export/type findings. This did not block REQ-007 because the plan allowed staged rollout when false positives made full preflight gating unsuitable; exact findings are documented in `147-dependency-baseline.md`.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 147-03 can proceed with the isolated Chevrotain 12 upgrade. The Knip file/dependency gate is now part of preflight; export cleanup remains a documented later triage item rather than a hidden command failure.

## Self-Check: PASSED

- Found `knip.ts`.
- Found `tests/unit/knip-config.test.ts`.
- Found `.planning/phases/147-tooling-and-dependency-hygiene/147-02-SUMMARY.md`.
- Found task commits `8729cfe`, `3162bb5`, and `847bf5c`.
- Required verification commands passed.

---
*Phase: 147-tooling-and-dependency-hygiene*
*Completed: 2026-05-24*
