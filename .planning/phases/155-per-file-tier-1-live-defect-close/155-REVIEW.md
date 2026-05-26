---
phase: 155
slug: per-file-tier-1-live-defect-close
status: clean
review_depth: standard
reviewed_at: 2026-05-26T16:07:00Z
---

# Phase 155 Code Review

## Result

Status: clean after fixes.

## Files Reviewed

- `src/services/document-lock.ts`
- `src/services/scanner.ts`
- `src/mcp/tools/documents/write.ts`
- `src/mcp/tools/documents/archive.ts`
- `src/mcp/tools/documents/remove.ts`
- `src/mcp/tools/documents/copy.ts`
- `src/mcp/tools/documents/move.ts`
- `src/mcp/tools/compound.ts`
- `src/mcp/tool-help/call_macro.tool.md`
- `tests/unit/document-lock-registry.test.ts`
- `tests/unit/with-document-lock.test.ts`
- `tests/unit/lock-helper-only.test.ts`
- `tests/unit/document-tool-lock-call-sites.test.ts`
- `tests/unit/macro-no-lock-imports.test.ts`
- `tests/scenarios/directed/testcases/test_per_file_lock_parallel.py`
- `tests/scenarios/directed/testcases/test_apply_tags_no_lost_update.py`
- `tests/scenarios/directed/testcases/test_parallel_macros_per_file_lock.py`
- `tests/scenarios/directed/DIRECTED_COVERAGE.md`

## Findings Fixed During Review

1. Warning: `withDocumentLocks` could self-deadlock when two different document paths mapped to the same Tier 1 stripe.
   - Fix: acquire each unique stripe only once, then acquire sorted per-document Tier 2 locks.
   - Regression: `tests/unit/with-document-lock.test.ts` covers colliding stripe keys.
   - Commit: `a81c7a9`.

2. Warning: compound document mutations could report `LockTimeoutError` as generic runtime errors.
   - Fix: map lock contention to expected `conflict` envelopes for `insert_doc_link`, `apply_tags`, `insert_in_doc`, and `replace_doc_section`.
   - Regression: `tests/unit/document-tool-lock-call-sites.test.ts` guards compound lock timeout mapping.
   - Commit: `a9bf623`.

## Residual Risk

- Phase 155 intentionally uses already validated absolute paths as the basic key. Full realpath and case-folding canonicalization remains deferred to Phase 159 per the phase plan.
- The legacy Supabase-backed Tier 2 path remains isolated inside `src/services/document-lock.ts` until the later removal phase.

## Verification Evidence

- `npm test -- tests/unit/document-tool-lock-call-sites.test.ts` — passed after compound timeout fix.
- `npm test -- tests/unit/with-document-lock.test.ts tests/unit/document-lock-registry.test.ts` — passed after stripe collision fix.
- `npm run typecheck` — passed.

