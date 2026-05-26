---
phase: 157-records-memory-plugins-audit-guards
plan: 03
subsystem: plugins
tags: [plugins, unregister, advisory-locks, static-guard, vitest]
requires:
  - phase: 157-records-memory-plugins-audit-guards
    provides: withPluginCoordinationLock and memory/records lock removal
provides:
  - Plugin unregister scoped coordination
  - Failure-safe unregister cleanup behavior
  - T-U-036 static coarse-lock guard
  - T-I-045 concurrent unregister integration coverage
affects: [plugins, records, memory, req-023]
tech-stack:
  added: []
  patterns: [checked multi-step cleanup before success responses]
key-files:
  created:
    - tests/integration/unregister-plugin-races.integration.test.ts
    - tests/unit/no-coarse-resource-locks.test.ts
  modified: [src/mcp/tools/plugins.ts, tests/unit/plugin-tools.test.ts, tests/config/vitest.integration.config.ts]
key-decisions:
  - "unregister_plugin cleanup failures return runtime errors instead of falling through to status: unregistered."
  - "The final static guard scans src/ for coarse records, memory, and plugins lock call arguments."
patterns-established:
  - "Plugin unregister critical sections use the same scoped plugin coordination key as records reconciliation."
requirements-completed: [REQ-023]
duration: 40min
completed: 2026-05-26
---

# Phase 157 Plan 03: Plugin Unregister Guard Summary

**Plugin unregister now coordinates per plugin instance and fails closed on partial cleanup errors**

## Performance

- **Duration:** 40 min
- **Started:** 2026-05-26T18:18:00Z
- **Completed:** 2026-05-26T18:53:11Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Removed coarse `plugins` lock usage from `unregister_plugin`.
- Wrapped unregister inventory and cleanup in `withPluginCoordinationLock`.
- Changed cleanup failures for documents, memories, pending review, registry, and manifest reload to return runtime errors before success.
- Added T-I-045 concurrent unregister coverage and T-U-036 static source guard.

## Task Commits

Implemented in the final Phase 157 commit.

## Files Created/Modified

- `src/mcp/tools/plugins.ts` - Uses scoped plugin coordination and checked cleanup.
- `tests/integration/unregister-plugin-races.integration.test.ts` - Covers concurrent unregister behavior and cleanup state.
- `tests/unit/no-coarse-resource-locks.test.ts` - Guards against coarse records/memory/plugins lock reintroduction.
- `tests/unit/plugin-tools.test.ts` - Mocks scoped coordination in unit coverage.

## Decisions Made

The phase keeps `src/services/write-lock.ts`, document/macro lock behavior, and the future lock-table retirement work untouched.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The first combined integration run exposed that `.env.test` must be sourced into the process environment for these files because static imports read the environment before the setup file injection. The passing evidence commands source `.env.test` explicitly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 158 can retire the legacy lock table with records, memory, and plugins no longer depending on coarse `records`, `memory`, or `plugins` resources.

---
*Phase: 157-records-memory-plugins-audit-guards*
*Completed: 2026-05-26*
