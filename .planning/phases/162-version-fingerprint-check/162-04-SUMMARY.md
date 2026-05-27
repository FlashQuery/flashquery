---
phase: 162-version-fingerprint-check
plan: 04
subsystem: api
tags: [mcp, document-tools, version-token, optimistic-concurrency, vault-writes]
requires:
  - phase: 162-03
    provides: read-side version_token plumbing and document-version helpers
provides:
  - top-level document write tools accept optional expected_version and if_match
  - write/archive/copy/move success responses include post-write or destination version_token
  - stale top-level document writes return version_mismatch conflict envelopes without disk mutation
  - copy_document source-token semantics while preserving destination locking
affects: [document-tools, tool-help, vault-write-coherency]
tech-stack:
  added: []
  patterns:
    - fresh raw-byte version_token comparison inside document locks
    - whole-document targeted_region conflict envelopes for top-level structural writes
key-files:
  created:
    - .planning/phases/162-version-fingerprint-check/162-04-SUMMARY.md
  modified:
    - src/mcp/utils/document-write.ts
    - src/mcp/utils/response-formats.ts
    - src/mcp/tools/documents/write.ts
    - src/mcp/tools/documents/archive.ts
    - src/mcp/tools/documents/remove.ts
    - src/mcp/tools/documents/copy.ts
    - src/mcp/tools/documents/move.ts
    - src/mcp/tool-help/write_document.tool.md
    - src/mcp/tool-help/archive_document.tool.md
    - src/mcp/tool-help/remove_document.tool.md
    - src/mcp/tool-help/copy_document.tool.md
    - src/mcp/tool-help/move_document.tool.md
key-decisions:
  - "Scoped implementation to the five top-level document tools named by the plan and user constraint; compound-tool schema failures remain outside this plan."
  - "Used whole-document conflict regions for top-level structural/destructive tools, matching REQ-015 for this phase."
patterns-established:
  - "Top-level write tools use pickExpectedVersion({ expected_version, if_match }) and compare against computeVersionToken(rawContent) after lock acquisition."
  - "copy_document takes both source and destination locks only when a source version precondition is supplied; destination existence remains checked under destination locking."
requirements-completed: [REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016]
duration: 9min
completed: 2026-05-27
---

# Phase 162 Plan 04: Top-Level Version Preconditions Summary

**Opt-in expected_version / if_match checks for top-level document write tools with success version_token responses and stale-write conflict envelopes**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-27T16:43:32Z
- **Completed:** 2026-05-27T16:52:06Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- Added `expected_version` and `if_match` schemas to `write_document`, `archive_document`, `remove_document`, `copy_document`, and `move_document`.
- Added success `version_token` output for `write_document`, `archive_document`, `copy_document`, and `move_document`; `remove_document` success still omits it.
- Added in-lock fresh raw-byte token checks for stale write rejection with `details.reason: "version_mismatch"` and whole-document `targeted_region`.
- Preserved no-token last-writer-wins behavior and source-token semantics for `copy_document` while keeping destination existence checks inside destination locking.
- Updated top-level tool help markdown to document `version_token`, `expected_version`, `if_match`, omitted-token behavior, and source/destination token semantics.

## Task Commits

1. **Task 1: Add schema aliases and success version_token builders** - `0c04b0b`
2. **Task 2: Add in-lock expected-version checks for write, archive, remove, copy, and move** - `9e70162`
3. **Task 3: Update top-level document tool help output** - `0cb3378`

## Files Created/Modified

- `src/mcp/utils/document-write.ts` - Added version precondition input fields and whole-document conflict region builder.
- `src/mcp/utils/response-formats.ts` - Added optional `version_token` to shared document identification while stripping it from removal results.
- `src/mcp/tools/documents/write.ts` - Added update-mode in-lock version checks and post-write success token.
- `src/mcp/tools/documents/archive.ts` - Added source-token checks and post-archive success token.
- `src/mcp/tools/documents/remove.ts` - Added source-token checks while preserving no success token.
- `src/mcp/tools/documents/copy.ts` - Added source-token checks under source+destination locks and destination success token.
- `src/mcp/tools/documents/move.ts` - Added source-token checks under source+destination locks and moved-file success token.
- `src/mcp/tool-help/*.tool.md` - Documented top-level version preconditions and response tokens.

## Decisions Made

- Kept compound tools unchanged because the plan `files_modified` list and user constraint only allowed the five top-level document tools.
- Treated full-document `targeted_region` as current raw file content plus path and char count for these top-level tools.

## Deviations from Plan

### Auto-fixed Issues

None.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** Implementation stayed inside the requested file ownership boundary.

## Issues Encountered

- The plan-level unit command `npm test -- tests/unit/document-output-version-token.test.ts tests/unit/expected-version-schema.test.ts` still fails four assertions for compound tools in `src/mcp/tools/compound.ts`: `insert_doc_link`, `insert_in_doc`, `replace_doc_section`, and `apply_tags`. Those files are outside this plan's `files_modified` list and outside the user's ownership constraint. Top-level owned-tool schema checks pass with `npm test -- tests/unit/expected-version-schema.test.ts -t "write_document|archive_document|remove_document|copy_document|move_document"`.
- Integration tests emit `background_embed_failed` log lines because no embedding API key is configured; the tested document-write behavior still passes.

## Verification

- `npm run typecheck` - PASS.
- `npm test -- tests/unit/document-output-version-token.test.ts` - PASS, 5 tests.
- `npm test -- tests/unit/expected-version-schema.test.ts -t "write_document|archive_document|remove_document|copy_document|move_document"` - PASS, 5 passed / 4 skipped.
- `npm test -- tests/unit/document-output-version-token.test.ts tests/unit/expected-version-schema.test.ts` - FAIL, 10 passed / 4 failed; failures are compound-tool schema assertions outside this plan's owned files.
- `npm run test:integration -- tests/integration/version-token-precondition.integration.test.ts tests/integration/version-check-inside-lock.integration.test.ts` - PASS, 7 tests.
- Help acceptance grep for `version_token`, `expected_version`, and `if_match` in all five modified help files - PASS.
- Help grep for `section-scoped` and `default-on` in the five modified help files - PASS, no matches.

## Known Stubs

None.

## Threat Flags

None. The modified MCP write precondition surface is covered by this plan's threat model.

## User Setup Required

None.

## Next Phase Readiness

Top-level write tools now support opt-in read-to-write conflict detection. Remaining Phase 162 work can build on the same `document-version` helper pattern for compound tools and broader conflict-region specificity.

## Self-Check: PASSED

- Summary file exists.
- Task commits found: `0c04b0b`, `9e70162`, `0cb3378`.
- No required created/modified file is missing from disk.

---
*Phase: 162-version-fingerprint-check*
*Completed: 2026-05-27*
