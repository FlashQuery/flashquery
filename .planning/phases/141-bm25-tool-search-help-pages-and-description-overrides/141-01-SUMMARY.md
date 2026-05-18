---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 1
subsystem: tool-search
tags: [bm25, tool-search, mcp-broker, vitest]

requires:
  - phase: 140-tofu-schema-pinning-and-tool-list-change-handling
    provides: BrokeredTool and ToolIndexSink contracts for later search wiring
provides:
  - Pure TypeScript BM25+ indexer with pinned constants
  - Inline 153-word English stopword set
  - Production unit coverage for BM25 idempotency, live stats, empty states, and fixture parsing
  - Graduated BM25 POC corpus and query fixtures
affects: [phase-141-search-tools, mcp-broker, delegated-tool-search]

tech-stack:
  added: []
  patterns:
    - zero-dependency pure TypeScript ranking module
    - registry_key-based idempotent tool indexing

key-files:
  created:
    - src/services/tool-search/indexer.ts
    - src/services/tool-search/stopwords.ts
    - tests/fixtures/tool-search/corpus.md
    - tests/fixtures/tool-search/corpus-flashquery.md
    - tests/fixtures/tool-search/queries.json
    - tests/fixtures/tool-search/queries-call-macro.json
  modified:
    - tests/unit/tool-search/indexer.test.ts

key-decisions:
  - "PureBM25Indexer uses registry_key as the canonical identity while accepting POC-style {server, tool} removal keys for compatibility."
  - "Duplicate addTools calls replace the live document for the same registry_key, preserving one live indexed entry and allowing future description updates."

patterns-established:
  - "BM25 documents carry server, tool, registry_key, description, argNames, and arg_summary so later search result hydration does not need an API break."
  - "Pinned algorithm constants are exported for regression tests and downstream consumers."

requirements-completed: [REQ-074, REQ-075, REQ-076, REQ-077, REQ-078, REQ-079, REQ-080, REQ-081, REQ-088]

duration: 4m16s
completed: 2026-05-18T16:34:14Z
---

# Phase 141 Plan 1: Pure TypeScript BM25 Indexer And POC Fixture Graduation Summary

**Zero-dependency BM25+ tool search core with pinned constants, idempotent indexing, live stats, and graduated POC fixtures.**

## Performance

- **Duration:** 4m16s
- **Started:** 2026-05-18T16:29:58Z
- **Completed:** 2026-05-18T16:34:14Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added `PureBM25Indexer` with pinned `k1=2.0`, `b=0.5`, `delta=0.25`, name boost `3`, stopwords on, and stemming off.
- Implemented idempotent `build`, `addTools`, `removeTools`, empty-query/empty-corpus behavior, and live-only stats.
- Copied the four BM25 POC fixture files byte-for-byte into `tests/fixtures/tool-search/`.
- Added focused Vitest coverage for T-U-022 through T-U-027 plus fixture parsing smoke checks.

## Task Commits

1. **Task 1 RED: BM25 indexer contract tests** - `8716a37` (`test`)
2. **Tasks 1-2 GREEN: indexer implementation and fixture graduation** - `b5e3b11` (`feat`)

## Files Created/Modified

- `src/services/tool-search/indexer.ts` - Pure TypeScript BM25+ indexer and exported pinned constants/types.
- `src/services/tool-search/stopwords.ts` - Inline 153-word English stopword set copied from the POC.
- `tests/unit/tool-search/indexer.test.ts` - Unit coverage for indexer invariants, constants, stopwords, empty states, and fixture parsing.
- `tests/fixtures/tool-search/corpus.md` - POC tool corpus copied without semantic edits.
- `tests/fixtures/tool-search/corpus-flashquery.md` - FlashQuery-native POC corpus copied without semantic edits.
- `tests/fixtures/tool-search/queries.json` - POC ranking query fixture copied without semantic edits.
- `tests/fixtures/tool-search/queries-call-macro.json` - POC call_macro placement query fixture copied without semantic edits.

## Decisions Made

- `registry_key` is the canonical document identity because Phase 139/140 broker surfaces already use `RegistryKey` for index sink add/remove operations.
- `addTools` replaces existing live entries for the same key rather than skipping them, keeping duplicate calls idempotent while allowing future description override updates to refresh index text.
- The indexer is synchronous because it is pure in-memory computation; callers can still `await` these methods if future interfaces use async boundaries.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The JSON fixture smoke assertion initially expected the fixture root to be an array. The POC JSON files use `{ metadata, queries }`; the assertion was corrected to read `.queries`.

## Known Stubs

None. Stub-pattern scan findings were internal empty collection initialization or copied POC fixture prose, not incomplete implementation.

## Threat Flags

None. This plan added no network endpoints, auth paths, file access at runtime, or schema trust-boundary changes.

## Verification

- `npm test -- --run tests/unit/tool-search/indexer.test.ts` - passed, 9 tests.
- `test -f tests/fixtures/tool-search/queries.json && test -f tests/fixtures/tool-search/queries-call-macro.json && npm test -- --run tests/unit/tool-search/indexer.test.ts` - passed.
- SHA-256 hashes for all four copied fixture files matched their POC source files.
- `package.json` and `package-lock.json` were unchanged; no dependency was added.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can build metadata/help primitives on top of the new `src/services/tool-search/` directory. Later `fq.search_tools` wiring can use `ToolSearchDocument` without changing the BM25 API.

## Self-Check: PASSED

- Created files exist.
- Commits `8716a37` and `b5e3b11` exist in git history.
- Focused test command passed after commits.

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18*
