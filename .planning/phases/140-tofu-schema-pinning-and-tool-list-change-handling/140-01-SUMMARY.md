---
phase: 140-tofu-schema-pinning-and-tool-list-change-handling
plan: 01
subsystem: mcp-broker
tags: [mcp-broker, tofu, schema-drift, registry, diff]

requires:
  - phase: 139-broker-foundation-registry-and-dispatch
    provides: broker registry, TOFU hash helper, and brokered tool type contracts
provides:
  - Reusable broker tools/list snapshot diff utility
  - In-memory TOFU state machine with trusted, pending, blocked, approved, rejected, and removed states
  - Registry APIs for removing blocked or removed brokered tools from callable views
affects: [phase-141-tool-search, phase-142-host-surface, phase-143-cli-and-macro-extensions]

tech-stack:
  added: []
  patterns:
    - Pure reusable broker utilities with no SDK or filesystem dependency
    - TDD RED/GREEN commits for broker safety behavior
    - Process-local TOFU state keyed by server ID and upstream tool name

key-files:
  created:
    - src/services/mcp-broker/diff.ts
    - tests/unit/mcp-broker-diff.test.ts
  modified:
    - src/services/mcp-broker/tofu.ts
    - src/services/mcp-broker/types.ts
    - src/services/mcp-broker/registry.ts
    - tests/unit/mcp-broker-tofu.test.ts
    - tests/unit/mcp-broker-registry.test.ts

key-decisions:
  - "TOFU state remains process-local and in-memory, with trusted and pending schema snapshots stored separately."
  - "Diff identity is server ID plus upstream tool name, and classification output is sorted by that identity for deterministic consumers."
  - "Registry blocking uses removal from the registry map so listToolsForConsumer remains the single callable gate."

patterns-established:
  - "Broker snapshot diff: compare <serverId>:<toolName> identity and tofuHash, then return deterministic added/changed/removed/unchanged arrays."
  - "TOFU drift payloads include old_schema, new_schema, deterministic diff_summary, approve/reject options, and frontmatter answer_shape."
  - "Blocked, rejected, or removed tools disappear from host and purpose views by unregistering their registry key."

requirements-completed: [REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-047, REQ-062, REQ-064]

duration: 5m45s
completed: 2026-05-18
---

# Phase 140 Plan 01: TOFU Schema Pinning And Tool-List Change Handling Summary

**Pure tools/list diffing, in-memory TOFU schema drift state, and registry blocking APIs for brokered tools**

## Performance

- **Duration:** 5m45s
- **Started:** 2026-05-18T13:13:13Z
- **Completed:** 2026-05-18T13:18:58Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added `diffToolSnapshots` with deterministic added, changed, removed, and unchanged classification for T-U-035.
- Added `InMemoryTofuStore` with first-trust, pending drift, approval, rejection, and removal tombstone behavior.
- Added registry `hasTool`, `unregisterTool`, and `unregisterTools` APIs so blocked or removed tools are absent from host and purpose callable views.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: broker tool diff tests** - `8dfd121` (test)
2. **Task 1 GREEN: broker tool snapshot diff** - `d7760d4` (feat)
3. **Task 2 RED: TOFU state machine tests** - `b672325` (test)
4. **Task 2 GREEN: in-memory TOFU state machine** - `6ef76f1` (feat)
5. **Task 3 RED: registry blocking API tests** - `5441dac` (test)
6. **Task 3 GREEN: registry blocking APIs** - `09ba2d7` (feat)

## Files Created/Modified

- `src/services/mcp-broker/diff.ts` - Reusable pure diff utility for brokered tool snapshots.
- `src/services/mcp-broker/tofu.ts` - In-memory TOFU store, drift payload builder, tombstone handling, and schema diff summaries.
- `src/services/mcp-broker/types.ts` - TOFU decision, payload, entry, observation, and future index sink contracts.
- `src/services/mcp-broker/registry.ts` - Registry removal and existence APIs that preserve consumer filtering behavior.
- `tests/unit/mcp-broker-diff.test.ts` - T-U-035 and deterministic identity-order coverage.
- `tests/unit/mcp-broker-tofu.test.ts` - TOFU hash, first trust, drift, approval, rejection, and tombstone regressions.
- `tests/unit/mcp-broker-registry.test.ts` - Block/remove/re-register consumer visibility regressions.

## Decisions Made

- Kept TOFU persistence out of scope and used a process-local map keyed by `<serverId>:<toolName>`.
- Stored pending hash/schema separately from trusted hash/schema so rejection preserves the old trusted state.
- Modeled registry blocking as unregistering brokered tools, leaving TOFU tombstones in the TOFU store.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. The stub scan found only local empty object/array initializers used for normal data structures, not UI or unimplemented behavior.

## Verification

- `npm test -- --run tests/unit/mcp-broker-diff.test.ts` - passed.
- `npm test -- --run tests/unit/mcp-broker-tofu.test.ts` - passed.
- `npm test -- --run tests/unit/mcp-broker-registry.test.ts` - passed.
- `npm test -- --run tests/unit/mcp-broker-diff.test.ts tests/unit/mcp-broker-tofu.test.ts tests/unit/mcp-broker-registry.test.ts` - 3 files, 20 tests passed.
- `npm run build` - passed.

## Acceptance Criteria

- `src/services/mcp-broker/diff.ts` exports `diffToolSnapshots`.
- `tests/unit/mcp-broker-diff.test.ts` includes T-U-035 coverage.
- `src/services/mcp-broker/diff.ts` has no MCP SDK, filesystem, or BrokerClient imports.
- `src/services/mcp-broker/tofu.ts` has no filesystem, Supabase, or vault imports.
- `hashToolSchema` still hashes `name`, `description`, and `inputSchema`.
- Registry tests prove removed or blocked tools disappear from host and purpose views, and re-registration restores visibility.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 141 can attach the BM25 indexer to the `ToolIndexSink` shape and consume `diffToolSnapshots` for synchronous index add/remove behavior. Later Phase 140 plans can wire these pure state APIs into broker notification, macro, audit, and scenario flows.

## Self-Check: PASSED

- Created files exist: `src/services/mcp-broker/diff.ts`, `tests/unit/mcp-broker-diff.test.ts`.
- Commits exist: `8dfd121`, `d7760d4`, `b672325`, `6ef76f1`, `5441dac`, `09ba2d7`.
- Verification commands passed.

---
*Phase: 140-tofu-schema-pinning-and-tool-list-change-handling*
*Completed: 2026-05-18*
