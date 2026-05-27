---
phase: 162-version-fingerprint-check
plan: 03
subsystem: mcp-documents
tags: [version-token, get-document, content-hash, targeted-scan]
requires:
  - phase: 156-atomic-durable-write-primitive-consolidation
    provides: writeVaultFile contentHash return
  - phase: 162-version-fingerprint-check
    provides: Wave 1 version-token tests
provides:
  - Shared document version-token helper exports
  - targetedScan repair hash propagation from writeVaultFile
  - get_document DocumentEnvelope.version_token
  - get_document DB content_hash and response token alignment
  - get_document help text for version_token
affects: [document-output, document-resolver, get-document, version-token]
tech-stack:
  added: []
  patterns:
    - Shared SHA-256 version-token helper for read and future write plumbing
    - Repair paths propagate durable primitive contentHash rather than caller pre-hash
key-files:
  created:
    - src/mcp/utils/document-version.ts
  modified:
    - src/mcp/utils/document-resolver-primitives.ts
    - src/mcp/utils/document-output.ts
    - src/mcp/tools/documents/get.ts
    - src/mcp/tool-help/get_document.tool.md
key-decisions:
  - "get_document uses targetedScan.capturedFrontmatter.contentHash as the response version_token and DB content_hash update value after repair."
  - "This executor did not modify write-tool schemas or response helpers because they are outside 162-03 files_modified."
patterns-established:
  - "computeVersionToken(raw) is the shared raw-byte SHA-256 helper for version_token calculation."
requirements-completed:
  - REQ-011
  - REQ-014
  - REQ-016
duration: 4min
completed: 2026-05-27
---

# Phase 162 Plan 03: Read-side Version Token Summary

**get_document now returns a whole-file version_token, and read-triggered repairs propagate the durable write hash into both response and DB content_hash updates**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-27T16:37:00Z
- **Completed:** 2026-05-27T16:41:04Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `computeVersionToken`, `pickExpectedVersion`, and `buildVersionMismatchEnvelope` in `src/mcp/utils/document-version.ts`.
- Updated `targetedScan` so frontmatter repair snapshots use the `writeVaultFile` returned `contentHash`.
- Added `DocumentEnvelope.version_token` and wired `get_document` stale hash DB updates to the same token returned to callers.
- Updated `get_document` tool description and help markdown to document `version_token`.

## Task Commits

1. **Task 1: Create shared version helper and repair hash return path** - `50317ec` (feat)
2. **Task 2: Return version_token from get_document with DB/disk consistency** - `ed62a45` (feat)

**Plan metadata:** pending docs commit.

## Files Created/Modified

- `src/mcp/utils/document-version.ts` - Shared version-token calculation, expected-version alias selection, and conflict envelope builder.
- `src/mcp/utils/document-resolver-primitives.ts` - Repair writes now return and store durable primitive `contentHash`.
- `src/mcp/utils/document-output.ts` - `get_document` response envelope includes `version_token`; stale DB hash update uses the same token.
- `src/mcp/tools/documents/get.ts` - Tool schema description documents `version_token`.
- `src/mcp/tool-help/get_document.tool.md` - User-facing help documents whole-file token behavior.

## Decisions Made

- `targetedScan` repair snapshots use post-write `writeVaultFile(...).contentHash`; no-write paths keep the fresh pre-scan disk hash.
- `buildMetadataEnvelope` accepts `capturedFrontmatter.contentHash` as the authoritative token and falls back to hashing supplied content only for direct unit-builder callers.
- `get_document` remains free of document-lock and directory-lock imports.

## Deviations from Plan

### Auto-fixed Issues

None.

### Verification Scope Deviations

**1. Out-of-scope Wave 1 tests cover write-side work not owned by 162-03**
- **Found during:** Task 2 verification.
- **Issue:** `tests/unit/document-output-version-token.test.ts`, `tests/unit/expected-version-schema.test.ts`, and `tests/integration/token-equals-disk.integration.test.ts` include write-tool response token and `expected_version` assertions for files outside this plan's `files_modified`.
- **Handling:** Did not modify write-tool schemas, `document-write.ts`, or `response-formats.ts` because the user constrained ownership to the 162-03 file list.
- **Impact:** Read-side checks pass, but broad ROADMAP selectors still fail until write-side plans land.

**2. Existing resolver unit assertion expects the old pre-repair hash**
- **Found during:** Task 1 verification.
- **Issue:** `tests/unit/resolve-document.test.ts` still expects `capturedFrontmatter.contentHash` to remain the caller pre-hash after a frontmatter repair, which conflicts with REQ-014 and this plan's acceptance criteria.
- **Handling:** Preserved the REQ-014 implementation and did not edit tests outside the plan file list.

## Issues Encountered

- No implementation blockers. Verification is partially red because the already-added test set spans write-side behavior that 162-03 is not allowed to change.

## Verification

- `npm test -- tests/unit/version-token-shape.test.ts tests/unit/resolve-document.test.ts` - failed: `resolve-document.test.ts` has one stale pre-repair hash expectation; `version-token-shape.test.ts` passed after implementation.
- `npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/version-token-shape.test.ts` - failed only on write response helper expectations outside this plan; read-side and no-lock cases passed.
- `npm run test:integration -- tests/integration/version-token-shape.integration.test.ts tests/integration/token-equals-disk.integration.test.ts` - `version-token-shape.integration.test.ts` passed; `token-equals-disk.integration.test.ts` failed on write-side `expected_version` / write response token cases outside this plan.
- `npm test -- --grep "version-token|expected-version|conflict-envelope|get-document-no-lock"` - failed because Vitest 4 rejects `--grep`.
- `npm test -- --testNamePattern "version_token|expected_version|conflict envelope|get_document source does not import"` - failed on write-side schema/response assertions outside this plan; matched read-side tests passed.
- `npm test -- tests/unit/version-token-shape.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/conflict-envelope.test.ts` - passed, 5 tests.
- `npm run typecheck` - passed.

## Known Stubs

None.

## Threat Flags

None. The changes touch the existing vault-file-to-response and vault-file-to-database boundaries already captured by the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Read-side version-token plumbing is ready. Remaining red tests point to write-side version-token and `expected_version` plumbing that should be handled by the follow-on write/conflict plans.

## Self-Check: PASSED

- Key files exist on disk.
- Task commits `50317ec` and `ed62a45` exist in git history.
- `get_document` has no document-lock or directory-lock imports.
- SUMMARY created without modifying shared `.planning/STATE.md` or `.planning/ROADMAP.md`.

---
*Phase: 162-version-fingerprint-check*
*Completed: 2026-05-27*
