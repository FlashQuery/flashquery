---
phase: 168-chunking-foundation-and-write-pipeline
plan: 01
subsystem: embedding
tags: [markdown, chunks, parser, uuid5, gfm, embeddings]

requires: []
provides:
  - Deterministic chunk normalization, hashing, and embed text helpers
  - UUID5 chunk identity and sub-split parent link helpers
  - Heading-aware markdown chunk parser with merge-forward, split, and overlap behavior
  - CommonMark/GFM atomic handling for fenced code, tables, and top-level lists
affects: [phase-168-schema-write-pipeline, phase-169-lifecycle-search]

tech-stack:
  added: [mdast-util-from-markdown, mdast-util-gfm, micromark-extension-gfm]
  patterns:
    - Pure parser modules under src/embedding/chunks
    - Stable UUID5 identity over instance/document/heading path/chunk index
    - AST-backed markdown block splitting for GFM structures

key-files:
  created:
    - src/embedding/chunks/types.ts
    - src/embedding/chunks/normalize.ts
    - src/embedding/chunks/identity.ts
    - src/embedding/chunks/parser.ts
    - src/embedding/chunks/atomic-blocks.ts
    - tests/unit/chunk-normalize.test.ts
    - tests/unit/chunk-parser.test.ts
    - tests/unit/chunk-atomic-blocks.test.ts
    - tests/unit/chunk-identity.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Parser params remain internal defaults for this plan; no YAML configuration surface was added."
  - "Chunk content normalization preserves markdown indentation so nested lists and fenced-code structure survive storage."
  - "CommonMark/GFM atomic handling uses only the package set approved in 168-RESEARCH.md."

patterns-established:
  - "Parsed chunks expose stored content, content_hash, breadcrumb, embed_text, order, parent_chunk_id, and source metadata for downstream diffing."
  - "Oversized atomic blocks split structurally first and fall back to token splitting only for an oversized single row, line, or list item."

requirements-completed:
  - REQ-CHUNK-001
  - REQ-CHUNK-002
  - REQ-CHUNK-003
  - REQ-CHUNK-004
  - REQ-CHUNK-005

duration: 8min
completed: 2026-06-14
---

# Phase 168 Plan 01: Chunking Parser Foundation Summary

**Deterministic markdown chunk parser with normalized body hashes, UUID5 identity, heading-aware splitting, and GFM atomic block preservation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-14T20:25:25Z
- **Completed:** 2026-06-14T20:33:50Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added `src/embedding/chunks/` contracts for normalized chunk content, SHA-256 body hashes, embed-time text, stable UUID5 chunk ids, and sub-split parent links.
- Added `parseDocumentChunks` for heading-aware deterministic parsing, merge-forward behavior, empty-section breadcrumb retention, prose sub-splitting, overlap, and first-sibling id stability.
- Added AST-backed CommonMark/GFM atomic block handling for fenced code, tables, and top-level lists using the approved parser packages.
- Added unit coverage T-U-001 through T-U-025 across the four required test files.

## Task Commits

1. **Task 1: Implement normalization, hash, embed text, and UUID5 identity** - `aa90741` (feat)
2. **Task 2: Implement heading-aware parser and size guard behavior** - `ae2aecd` (feat)
3. **Task 3: Add CommonMark/GFM atomic block handling** - `e49c53d` (feat)

## Files Created/Modified

- `src/embedding/chunks/types.ts` - Shared parser params and parsed chunk contracts for downstream schema/write work.
- `src/embedding/chunks/normalize.ts` - Deterministic normalization, body-only content hash, and breadcrumb embed-text helper.
- `src/embedding/chunks/identity.ts` - UUID5 namespace, identity name, chunk id, and sub-split parent id helpers.
- `src/embedding/chunks/parser.ts` - Heading-aware parser orchestration, merge-forward, split, overlap, metadata, and identity wiring.
- `src/embedding/chunks/atomic-blocks.ts` - CommonMark/GFM block extraction and structure-preserving split rules.
- `tests/unit/chunk-normalize.test.ts` - T-U-001 through T-U-003.
- `tests/unit/chunk-parser.test.ts` - T-U-004 through T-U-014.
- `tests/unit/chunk-atomic-blocks.test.ts` - T-U-015 through T-U-020.
- `tests/unit/chunk-identity.test.ts` - T-U-021 through T-U-025.
- `package.json` / `package-lock.json` - Approved markdown parser dependencies.

## Verification

- `npm run test:unit -- tests/unit/chunk-normalize.test.ts tests/unit/chunk-parser.test.ts tests/unit/chunk-atomic-blocks.test.ts tests/unit/chunk-identity.test.ts` - passed, 4 files / 25 tests.
- `npm run typecheck` - passed.

## Decisions Made

- Parser defaults are exported from `types.ts` and remain internal for this plan because config exposure is not required for REQ-CHUNK-001 through REQ-CHUNK-005.
- Stored chunk content preserves markdown indentation while still normalizing line endings, trailing whitespace, repeated spaces after indentation, and repeated blank lines.
- Atomic splitting is parser-integrated but storage, lifecycle, and search behaviors remain deferred to later Phase 168/169 plans.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npm install mdast-util-from-markdown mdast-util-gfm micromark-extension-gfm` completed successfully but reported two existing high-severity audit findings. Audit remediation was left out of scope because it was unrelated to the approved parser package install and could require broader dependency changes.

## Known Stubs

None.

## Threat Flags

None. The new surface is the parser trust boundary already listed in the plan threat model; no network endpoints, auth paths, file access paths, or schema trust boundaries were added.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The parser foundation is ready for Phase 168 schema/catalog DDL and document write diffing. Downstream plans can use `ParsedChunk.id`, `content_hash`, `parent_chunk_id`, and `embed_text` directly when creating `fqc_chunks` rows and scheduling `document_chunk` embeddings.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/168-chunking-foundation-and-write-pipeline/168-01-SUMMARY.md`.
- Task commits found: `aa90741`, `ae2aecd`, `e49c53d`.
- Required verification commands passed after the final task commit.

---
*Phase: 168-chunking-foundation-and-write-pipeline*
*Completed: 2026-06-14*
