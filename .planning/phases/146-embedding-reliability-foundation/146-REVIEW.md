---
phase: 146-embedding-reliability-foundation
reviewed: 2026-05-24T10:05:29Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/embedding/background-embed.ts
  - src/embedding/pending-worker.ts
  - src/services/scanner.ts
  - src/cli/doctor.ts
  - src/utils/pg-client.ts
  - src/mcp/tools/records.ts
  - src/mcp/tools/memory.ts
  - src/mcp/tools/documents.ts
  - src/mcp/tools/compound.ts
  - src/storage/supabase.ts
  - tests/unit/background-embed-helper.test.ts
  - tests/unit/pending-embed-worker.test.ts
  - tests/unit/pg-client-pool.test.ts
  - tests/unit/scanner-embed-drain-status.test.ts
  - tests/integration/embedding/background-embed-doc-memory-record.test.ts
  - tests/integration/embedding/pending-embed-worker.test.ts
  - tests/integration/doctor/embedding-diagnostics.test.ts
  - tests/integration/mcp/tools/records-pg-pool.test.ts
  - tests/scenarios/directed/testcases/test_background_embed_failure_warning.py
  - tests/scenarios/integration/tests/record_embed_pool_concurrency.yml
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 146: Code Review Report

**Reviewed:** 2026-05-24T10:05:29Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** clean

## Summary

Reviewed the Phase 146 implementation against the stated goal: centralize background embedding, add durable retry state, surface deferred warnings, and route record direct SQL through the pool abstraction. The two previously reported blocker areas are now addressed:

- Successful foreground embedding writes call `clearPendingEmbedding` after the target embedding update, deleting stale rows in `fqc_pending_embeds` for the same target.
- Scanner-created document embeddings use `scheduleBackgroundEmbedding`; helper warnings mark scanner status as `partial`, and failures upsert durable retry state instead of being logged-only.

Record semantic SQL and record embedding updates now route through `queryPgPool`, pending retries cover document/memory/record targets, and doctor diagnostics surface active rows missing both embeddings and pending retry records. No blocking findings remain.

The requested paths `migrations/20260523130000_add_pending_embeds.sql` and `types/supabase.ts` are not present in this repo. I reviewed the equivalent schema-management implementation in `src/storage/supabase.ts`, where `fqc_pending_embeds` is added through the existing buildSchema DDL convention.

## Narrative Findings (AI reviewer)

No Critical, Warning, or Info findings were found in the reviewed files.

## Verification

Focused Phase 146 unit tests passed:

```bash
npm test -- --run tests/unit/background-embed-helper.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/pg-client-pool.test.ts tests/unit/scanner-embed-drain-status.test.ts
```

Result: 4 test files passed, 16 tests passed.

---

_Reviewed: 2026-05-24T10:05:29Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
