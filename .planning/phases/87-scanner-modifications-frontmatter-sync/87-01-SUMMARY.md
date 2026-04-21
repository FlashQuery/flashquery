---
phase: 87-scanner-modifications-frontmatter-sync
plan: 01
subsystem: scanner
tags: [scanner, frontmatter, ownership, notifications, supabase]

requires:
  - phase: 84-schema-parsing-policy-infrastructure
    provides: DocumentTypePolicy interface and plugin schema foundations
  - phase: 85-reconciliation-engine
    provides: Reconciliation engine that reads ownership_plugin_id/ownership_type columns
  - phase: 86-record-tool-integration-pending-review
    provides: Record tool reconciliation preamble wired and tested

provides:
  - scanner.ts free of all push-notification code (NOTIF-01, NOTIF-02 try/catch blocks removed)
  - ownership_plugin_id and ownership_type synced to DB on all 6 INSERT/content-change UPDATE paths
  - fqcOwner/fqcType null-safe extraction from frontmatter (typeof guard pattern)
  - CONTENT CHANGED updates object typed as Record<string, unknown> (supports null values)

affects:
  - phase: 88-legacy-infrastructure-removal
  - phase: 89-test-helper-existing-test-updates

tech-stack:
  added: []
  patterns:
    - "Null-safe frontmatter extraction: typeof frontmatter.fqc_owner === 'string' ? ... : null"
    - "Single extraction point for fqcOwner/fqcType placed before hash lookup — reused across all 6 sites"
    - "Record<string, unknown> for update objects that may contain null values alongside strings"

key-files:
  created: []
  modified:
    - src/services/scanner.ts

key-decisions:
  - "fqcOwner/fqcType extracted once per file iteration (after title, before dbRowByHash lookup) rather than per-site — avoids repetition and ensures consistency"
  - "MOVE branch (updates.path = relativePath) explicitly excluded from ownership sync per D-01 — path-only update, no content change semantics"
  - "CONTENT CHANGED updates type broadened to Record<string, unknown> to accommodate null ownership values alongside string hash/timestamp values"

patterns-established:
  - "Ownership sync pattern: extract fqcOwner/fqcType near top of per-file block, pass into all downstream INSERT/UPDATE calls"

requirements-completed:
  - SCANNER-01
  - SCANNER-02
  - SCANNER-03

duration: 15min
completed: 2026-04-21
---

# Phase 87 Plan 01: Scanner Modifications Summary

**Push-notification code (NOTIF-01/NOTIF-02, ~250 lines) removed from scanner.ts and fqc_owner/fqc_type frontmatter synced to ownership_plugin_id/ownership_type DB columns on all 6 INSERT/content-change UPDATE paths**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-21T03:15:00Z
- **Completed:** 2026-04-21T03:30:38Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Removed `getWatcherMap`/`invokeChangeNotifications` imports and `ChangePayload` type import from scanner.ts
- Removed NOTIF-01 PREREQUISITE block (`detectionResult`/`changePayload` computation, ~8 lines) that used the deleted type
- Removed NOTIF-01 try/catch block (~80 lines) — change notification callbacks on content-hash mismatch
- Removed NOTIF-02 try/catch block (~85 lines) — deletion notification callbacks on missing file detection
- Added `fqcOwner`/`fqcType` null-safe extraction pattern placed once per file iteration
- Added `ownership_plugin_id: fqcOwner` and `ownership_type: fqcType` to all 6 INSERT/UPDATE sites (DUPLICATE, DCP-01, CONTENT CHANGED updates, INF-04 path-reconnect, IDC-04 foreign UUID, Tier 4 new file)
- Broadened CONTENT CHANGED `updates` type from `Record<string, string>` to `Record<string, unknown>` to handle null ownership values

## Task Commits

1. **Task 1: Remove notification imports and NOTIF-01 PREREQUISITE block** - `f09dbcd` (refactor)
2. **Task 2: Remove NOTIF-01 and NOTIF-02 try/catch blocks** - `cce27ae` (refactor)
3. **Task 3: Add ownership column sync to all INSERT/UPDATE sites** - `c341798` (feat)

## Files Created/Modified

- `src/services/scanner.ts` - Removed ~265 lines of push-notification code; added 18 lines of ownership sync

## Decisions Made

- Placed `fqcOwner`/`fqcType` extraction once near the top of the per-file processing block (after `title`, before `dbRowByHash` lookup) rather than repeating at each site — cleaner and eliminates inconsistency risk
- Excluded MOVE branch from ownership sync per D-01 (path-only update, no content read)
- No extraction in YAML-recovery fallback path needed — `frontmatter` always has at least `{ fqc_id }` after recovery; `fqc_owner`/`fqc_type` will be `undefined` (not string), so `fqcOwner`/`fqcType` correctly resolve to `null`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript errors from `npx tsc --noEmit` are all pre-existing in legacy files (`discovery-orchestrator.ts`, `discovery-coordinator.ts`, `document-ownership.ts`, `plugin-skill-invoker.ts`, `server.ts`) that Phase 88 will delete. scanner.ts has zero TypeScript errors.

Unit test failures (12 in 6 files) are the pre-existing deferred failures from project memory — unchanged from Phase 86 baseline. No new failures introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- scanner.ts is ready for Phase 88 which will delete the legacy source files (`discovery-orchestrator.ts`, `plugin-skill-invoker.ts`, etc.) that were imported by the now-removed notification code
- Phase 88 can also drop `fqc_change_queue` table (zero references in scanner.ts)
- Phase 89 test updates should update any scanner tests that checked for NOTIF-01/NOTIF-02 behavior

## Self-Check

**Files exist:**
- `src/services/scanner.ts` — FOUND

**Commits exist:**
- `f09dbcd` — FOUND (Task 1)
- `cce27ae` — FOUND (Task 2)
- `c341798` — FOUND (Task 3)

**Acceptance criteria:**
- `grep "invokeChangeNotifications" src/services/scanner.ts` — 0 matches
- `grep "getWatcherMap" src/services/scanner.ts` — 0 matches
- `grep "ChangePayload" src/services/scanner.ts` — 0 matches
- `grep -c "ownership_plugin_id: fqcOwner" src/services/scanner.ts` — 6
- `grep -c "ownership_type: fqcType" src/services/scanner.ts` — 6
- `grep "Record<string, unknown>" src/services/scanner.ts` — matched at CONTENT CHANGED updates
- MOVE branch has no ownership fields

## Self-Check: PASSED

---
*Phase: 87-scanner-modifications-frontmatter-sync*
*Completed: 2026-04-21*
