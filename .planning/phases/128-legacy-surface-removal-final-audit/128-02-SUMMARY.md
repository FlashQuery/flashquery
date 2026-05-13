---
phase: 128-legacy-surface-removal-final-audit
plan: 02
subsystem: api
tags: [mcp-tools, metadata, config, delegated-tools, protocol]
requires:
  - phase: 128-legacy-surface-removal-final-audit
    provides: Plan 01 traceability and legacy audit vocabulary
provides:
  - Removed tool metadata and host selector validation finalized
  - Dead project tools omitted from metadata
  - Delegated and protocol absence assertions for removed/dead names
affects: [tool-metadata, host-tool-exposure, llm-tool-registry, protocol-e2e]
tech-stack:
  added: []
  patterns: [metadata-driven availability, no-alias legacy validation, protocol absence table]
key-files:
  created: []
  modified:
    - src/mcp/tool-metadata.ts
    - src/mcp/tool-exposure.ts
    - tests/unit/tool-metadata.test.ts
    - tests/unit/tool-exposure.test.ts
    - tests/unit/llm-tool-registry.test.ts
    - tests/e2e/protocol.test.ts
key-decisions:
  - "list_projects and get_project_info now have no metadata entries; they resolve as unknown rather than dead metadata."
  - "Removed host selector errors reuse getLegacyToolSuggestion no-alias replacement text."
  - "Default protocol discovery asserts transitional get_briefing and insert_doc_link remain present while all removed/dead names stay absent."
patterns-established:
  - "Host exposure validation surfaces canonical no-alias migration guidance for removed tools."
  - "Delegated assembly tests prove removed/dead explicit requests produce diagnostics and no provider-visible tools."
requirements-completed: [DOC-10, MEM-05, SYS-05, TEST-07]
duration: 6min
completed: 2026-05-13
---

# Phase 128: Plan 02 Summary

**Central metadata, host validation, delegated registry tests, and protocol discovery now encode the final reduced tool surface**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-13T00:24:57Z
- **Completed:** 2026-05-13T00:30:43Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Removed `list_projects` and `get_project_info` metadata entries entirely.
- Updated host selector validation so removed names report canonical replacement guidance and explicitly say FlashQuery does not alias legacy tool names.
- Added delegated registry assertions that removed/dead explicit requests produce diagnostics without provider-tool exposure.
- Expanded protocol `listTools` assertions for the full removed/dead set and positive transitional defaults for `get_briefing` and `insert_doc_link`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Finalize metadata status and selector validation** - `9de64ee` (fix)
2. **Task 2: Prove delegated and protocol absence** - `167b98e` (test)

## Files Created/Modified

- `src/mcp/tool-metadata.ts` - Removed dead project metadata entries and the dead metadata helper/status.
- `src/mcp/tool-exposure.ts` - Uses `getLegacyToolSuggestion` for removed host selector errors.
- `tests/unit/tool-metadata.test.ts` - Asserts dead project tools have no metadata and no tier/suggestion presence.
- `tests/unit/tool-exposure.test.ts` - Asserts removed names include no-alias replacement guidance and project tools are unknown selectors.
- `tests/unit/llm-tool-registry.test.ts` - Asserts removed/dead explicit delegated requests stay diagnostic-only.
- `tests/e2e/protocol.test.ts` - Asserts full removed/dead host absence and transitional default presence.

## Decisions Made

- Kept removed/merged tool metadata for replacement suggestions, but removed project-tool metadata entirely because those tools are dead, not migrated.
- Treated `list_projects` and `get_project_info` as unknown selectors in active config validation.
- Left handler deletion to Plan 128-03, as planned.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

None.

## User Setup Required

None - `.env.test` credentials were used by existing integration/E2E test helpers.

## Verification

- `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts tests/unit/config.test.ts tests/unit/llm-config.test.ts` - PASS, 4 files / 96 tests.
- `npm test -- tests/unit/llm-tool-registry.test.ts` - PASS, 1 file / 25 tests.
- `npm run test:integration -- tests/integration/llm-config-sync.test.ts` - PASS, 1 file / 4 tests.
- `npm run test:e2e -- tests/e2e/protocol.test.ts` - PASS, 1 file / 25 tests.
- `grep -q "getLegacyToolSuggestion" src/mcp/tool-metadata.ts` - PASS.
- `grep -q "get_briefing" src/mcp/tool-metadata.ts && grep -q "insert_doc_link" src/mcp/tool-metadata.ts` - PASS.
- `! rg -n "name:\\s*['\\\"](list_projects|get_project_info)['\\\"]|list_projects:|get_project_info:" src/mcp/tool-metadata.ts` - PASS.
- `! grep -n "PHASE_127_LOCALLY_REPLACED_TOOLS" src/mcp/tool-exposure.ts` - PASS.
- `grep -q "append_to_doc" tests/e2e/protocol.test.ts` - PASS.
- `grep -q "not.toContain" tests/e2e/protocol.test.ts` - PASS.
- `grep -q "get_briefing" tests/e2e/protocol.test.ts && grep -q "insert_doc_link" tests/e2e/protocol.test.ts` - PASS.

## Self-Check: PASSED

Summary created after both task commits; focused unit, integration, and E2E gates passed; and handler deletion was left to Plan 128-03.

## Next Phase Readiness

Wave 3 can delete stale legacy/dead handlers and obsolete handler tests against a registry/config/protocol baseline that already rejects or hides removed names.

---
*Phase: 128-legacy-surface-removal-final-audit*
*Completed: 2026-05-13*
