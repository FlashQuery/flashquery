---
phase: 162-version-fingerprint-check
plan: 05
subsystem: mcp-tools
tags: [version-token, optimistic-concurrency, compound-tools, markdown]
requires:
  - phase: 162-04
    provides: top-level document version preconditions and shared version helpers
provides:
  - Compound document mutation schemas for expected_version and if_match
  - Fresh in-lock byte checks and post-write version_token responses for compound document tools
  - Targeted conflict regions for section, frontmatter, anchor, and document-end edits
affects: [compound-tools, mcp-tool-help, vault-write-coherency]
tech-stack:
  added: []
  patterns:
    - Use computeVersionToken and pickExpectedVersion for compound write preconditions
    - Build version_mismatch envelopes from the locked fresh file snapshot
key-files:
  created:
    - .planning/phases/162-version-fingerprint-check/162-05-SUMMARY.md
  modified:
    - src/mcp/tools/compound.ts
    - src/mcp/tool-help/insert_in_doc.tool.md
    - src/mcp/tool-help/replace_doc_section.tool.md
    - src/mcp/tool-help/apply_tags.tool.md
    - src/mcp/tool-help/insert_doc_link.tool.md
key-decisions:
  - "Preserved memory-target apply_tags behavior; version preconditions apply only to document targets."
  - "Used whole-file version_token semantics for section and frontmatter tools; no section-scoped token fields were added."
patterns-established:
  - "Compound tools compare expected_version/if_match against fresh bytes read inside withDocumentLock."
  - "Conflict envelopes reuse the current locked content to build targeted_region without a second envelope read."
requirements-completed: [REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016]
duration: 11min
completed: 2026-05-27T17:04:56Z
---

# Phase 162 Plan 05: Compound Version Fingerprint Summary

**Compound document mutations now support opt-in whole-file version preconditions with post-write tokens and caller-focused conflict regions**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-27T16:54:06Z
- **Completed:** 2026-05-27T17:04:56Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `expected_version` and `if_match` schema fields to `insert_in_doc`, `replace_doc_section`, document-target `apply_tags`, and `insert_doc_link`.
- Added fresh in-lock token comparisons and post-write `version_token` responses for compound document mutations.
- Added version mismatch envelopes with targeted regions for frontmatter, sections, anchor insertions, and document-end append targets.
- Updated compound tool help to document success tokens, version preconditions, and mismatch recovery payloads.

## Task Commits

1. **Task 1: Add compound schemas, in-lock checks, and success tokens** - `1978e3e`
2. **Task 2: Build targeted_region conflict payloads for compound tools** - `166d41c`
3. **Task 3: Update compound tool help output** - `6543fae`

## Files Created/Modified

- `src/mcp/tools/compound.ts` - Added compound schema fields, locked-byte precondition checks, success `version_token`, and targeted conflict regions.
- `src/mcp/tool-help/insert_in_doc.tool.md` - Documented version preconditions, success tokens, and anchor/end conflict recovery.
- `src/mcp/tool-help/replace_doc_section.tool.md` - Documented version preconditions, success tokens, and section conflict recovery.
- `src/mcp/tool-help/apply_tags.tool.md` - Documented document-target version preconditions and preserved memory-target behavior.
- `src/mcp/tool-help/insert_doc_link.tool.md` - Documented source document version preconditions and frontmatter conflict recovery.

## Decisions Made

- `apply_tags` keeps memory targets outside document version semantics; only document targets read locked disk bytes and compare tokens.
- `position: "end"` is accepted by `insert_in_doc` as an append alias and reported as `bottom` in successful `inserted_at` metadata.
- Compound conflict regions intentionally disclose only the caller-relevant region: frontmatter for tag/link tools, current section for replacement, and anchor/end regions for insertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Accepted `insert_in_doc` position `end` alias used by existing integration coverage**
- **Found during:** Task 1
- **Issue:** Existing Phase 162 integration coverage invokes `insert_in_doc` with `position: "end"`, while the handler only accepted `bottom`.
- **Fix:** Added `end` as an append alias and kept the internal write path mapped to `bottom`.
- **Files modified:** `src/mcp/tools/compound.ts`, `src/mcp/tool-help/insert_in_doc.tool.md`
- **Verification:** `npm run typecheck`; integration reached the compound equality assertion without failing on invalid position.
- **Committed in:** `1978e3e`

**Total deviations:** 1 auto-fixed.

## Verification

- `npm test -- tests/unit/expected-version-schema.test.ts tests/unit/conflict-envelope.test.ts` - PASS, 10 tests.
- `npm run typecheck` - PASS.
- `npm run test:integration -- tests/integration/version-token-precondition.integration.test.ts` - PASS, 6 tests.
- `npm run test:integration -- tests/integration/refused-write-envelope.integration.test.ts` - PARTIAL: 2 passed, 1 failed. `T-I-031` compares `JSON.stringify(conflict.targeted_region)` to a string containing literal newline bytes after JSON parse/stringify; JSON stringification escapes newlines. The payload contains the section body under `targeted_region.body`.
- `npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts` - PARTIAL: 1 passed, 2 failed outside this plan's owned files. `T-I-027` fails because `write_document` rejects an update with no content as `invalid_input`; `T-I-028` fails after `archive_document` because DB `content_hash` differs from the returned token.

Background embedding warnings appeared because no embedding API key is configured; tests continued.

## Known Stubs

None. The empty arrays found in `compound.ts` are runtime accumulators, not placeholder UI or mock data.

## Threat Flags

None. The changed surface is the planned MCP caller input and conflict envelope boundary from the plan threat model.

## Issues Encountered

- Existing focused integration tests still expose failures in `write_document`, `archive_document`, and a newline-sensitive assertion in `refused-write-envelope.integration.test.ts`. These files are outside this plan's owned file list, so they were recorded rather than modified.

## User Setup Required

None.

## Next Phase Readiness

Plan 06 can build on compound tool version precondition support. Remaining non-compound token/hash integration failures should be handled by the owning document-tool plans or a follow-up repair plan.

## Self-Check: PASSED

- Created summary file exists.
- Task commits exist: `1978e3e`, `166d41c`, `6543fae`.
- Owned files were the only implementation/help files staged for this plan.

---
*Phase: 162-version-fingerprint-check*
*Completed: 2026-05-27T17:04:56Z*
