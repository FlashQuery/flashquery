---
phase: 146-embedding-reliability-foundation
verified: 2026-05-24T10:09:41Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 146: Embedding Reliability Foundation Verification Report

**Phase Goal:** Centralize background embedding, add durable retry state, surface deferred warnings, and move record direct SQL usage to a pool.
**Verified:** 2026-05-24T10:09:41Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | No duplicated direct background embed idioms remain in MCP tools outside approved helper/scanner code. | VERIFIED | `rg -n "void embeddingProvider" src/mcp` returned no matches. MCP memory/document/compound/record/document-output paths import and call `scheduleBackgroundEmbedding`; scanner uses the helper for operational embedding work. |
| 2 | Pending embeddings retry successfully and remain diagnosable after repeated failures. | VERIFIED | `processPendingEmbeddings` selects `fqc_pending_embeds` by `instance_id/status/next_retry_at`, updates document/memory/record embeddings through shared target helpers, clears rows on success, and increments `attempt_count`/`last_error`/`last_attempt_at` on failure (`src/embedding/pending-worker.ts:73`, `src/embedding/pending-worker.ts:120`, `src/embedding/pending-worker.ts:242`). |
| 3 | Record direct SQL paths use pooled borrowing/release and preserve IPv4 behavior. | VERIFIED | `src/utils/pg-client.ts` keeps `createPgClientIPv4`, adds process-scoped `Pool`, `queryPgPool`, `withPgClient`, and `closePgPools` with release/close logging (`src/utils/pg-client.ts:25`, `src/utils/pg-client.ts:38`, `src/utils/pg-client.ts:57`, `src/utils/pg-client.ts:65`, `src/utils/pg-client.ts:81`). |
| 4 | Focused unit/integration/scenario coverage lands with the implementation. | VERIFIED | Unit tests T-U-006..012, integration tests T-I-003..008, directed D-69, and integration scenario IS-15 exist and are registered (`tests/unit/background-embed-helper.test.ts:68`, `tests/unit/pending-embed-worker.test.ts:83`, `tests/unit/pg-client-pool.test.ts:29`, `tests/scenarios/directed/DIRECTED_COVERAGE.md:231`, `tests/scenarios/integration/INTEGRATION_COVERAGE.md:127`). |
| 5 | `npm run typecheck` and `npm run lint` pass. | VERIFIED | User-provided orchestrator gate reports both commands exited 0 after implementation. This is accepted as command-gate evidence; code-level checks above were verified independently. |
| 6 | REQ-003: background embedding uses a centralized durable helper and surfaces `warnings:["embedding_deferred"]`. | VERIFIED | `scheduleBackgroundEmbedding` owns provider calls, target updates, pending-row upsert, stale pending-row clear, structured `background_embed_failed` logging, and deferred warnings (`src/embedding/background-embed.ts:105`, `src/embedding/background-embed.ts:172`, `src/embedding/background-embed.ts:195`, `src/embedding/background-embed.ts:231`). Write handlers merge warnings via `withWarnings`, including records (`src/mcp/tools/records.ts:93`, `src/mcp/tools/records.ts:348`). |
| 7 | REQ-004: pending state covers documents, memories, and records, and diagnostics report embedding-null rows without pending retry state. | VERIFIED | Pending schema stores target kind/table/id and retry metadata (`src/storage/supabase.ts:447`); schema verification checks required table/columns (`src/storage/schema-verify.ts:80`, `src/storage/schema-verify.ts:96`). Doctor anti-joins documents, memories, and record tables against pending rows (`src/cli/doctor.ts:160`, `src/cli/doctor.ts:198`, `src/cli/doctor.ts:216`, `src/cli/doctor.ts:253`). |
| 8 | REQ-005: record embedding updates and semantic `search_records` vector SQL use the pool with SQL injection protections. | VERIFIED | Record embedding target update uses `queryPgPool`, escaped table identifiers, instance filters, and parameterized vector/id values (`src/embedding/background-embed.ts:149`). `search_records` semantic and ILIKE SQL use `queryPgPool`, `pg.escapeIdentifier`, and parameter arrays (`src/mcp/tools/records.ts:733`, `src/mcp/tools/records.ts:760`, `src/mcp/tools/records.ts:792`, `src/mcp/tools/records.ts:816`). |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/embedding/background-embed.ts` | Central background embedding helper, target abstraction, warning and pending-state ownership | VERIFIED | Substantive helper exports document/memory/record targets and shared update logic; wired into MCP tools, scanner, and pending worker. |
| `src/embedding/pending-worker.ts` | Pending retry worker | VERIFIED | Instance-scoped due-row selection, bounded processing, shared target updates, success cleanup, repeated-failure metadata. |
| `src/storage/supabase.ts` | Durable `fqc_pending_embeds` schema | VERIFIED | Table, status constraint, unique target index, retry index, target lookup index. |
| `src/storage/schema-verify.ts` | Schema verification for pending rows | VERIFIED | Required table and all required columns are checked. |
| `src/mcp/tools/memory.ts`, `src/mcp/tools/documents.ts`, `src/mcp/tools/compound.ts`, `src/mcp/tools/records.ts`, `src/mcp/utils/document-output.ts` | Helper-backed write/re-embed paths | VERIFIED | All required call sites call `scheduleBackgroundEmbedding`; no direct `void embeddingProvider` match remains under `src/mcp`. |
| `src/utils/pg-client.ts` | Process-scoped pg pool abstraction | VERIFIED | Pool map, query/borrow APIs, release logging, close logging, IPv4-compatible `createPgClientIPv4` preserved. |
| `src/server/shutdown.ts` | Pool shutdown cleanup | VERIFIED | `closePgPools()` called in shutdown cleanup (`src/server/shutdown.ts:212`). |
| Phase 146 tests and scenarios | Required coverage T-U-006..012, T-I-003..008, D-69, IS-15 | VERIFIED | Files exist, are substantive, are registered in integration/scenario coverage, and focused unit spot-check passed locally. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/embedding/background-embed.ts` | `fqc_pending_embeds` | Supabase upsert/delete/select | VERIFIED | Failure path upserts retry state; success path clears matching pending rows. |
| `src/storage/supabase.ts` | `src/storage/schema-verify.ts` | DDL/verification parity | VERIFIED | Table and column names match across DDL and verifier. |
| MCP write tools | `src/embedding/background-embed.ts` | `scheduleBackgroundEmbedding` + `withWarnings` | VERIFIED | Memory, document, compound, record, and stale-hash paths are wired. SDK key-link check had one literal-pattern false negative for records; manual evidence verifies `recordEmbeddingTarget` and `withWarnings`. |
| `src/services/scanner.ts` | `src/embedding/pending-worker.ts` | Bounded pending retry invocation | VERIFIED | `runScanOnce` dynamically imports and calls `processPendingEmbeddings` with limit 25. |
| `src/cli/doctor.ts` | `fqc_pending_embeds` | Anti-join diagnostics | VERIFIED | Diagnostic identifies embedding-null rows with no pending retry row for documents, memories, and records. |
| Record vector SQL paths | `src/utils/pg-client.ts` | `queryPgPool` | VERIFIED | Record embedding update and search SQL use pooled queries. |
| `src/server/shutdown.ts` | `src/utils/pg-client.ts` | `closePgPools` | VERIFIED | Shutdown closes pooled pg connections. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/embedding/background-embed.ts` | `warnings`, pending row fields, target embeddings | Provider result or caught provider/update error | Yes | VERIFIED - success writes target embedding and clears pending state; failure records retry row and returns `embedding_deferred`. |
| `src/embedding/pending-worker.ts` | pending rows selected from `fqc_pending_embeds` | Supabase query scoped by `instance_id`, `status`, due `next_retry_at` | Yes | VERIFIED - rows drive provider embedding, target update, and delete/failure update. |
| `src/cli/doctor.ts` | embedding gap counts/IDs | Direct pg anti-join queries against live document, memory, record tables and `fqc_pending_embeds` | Yes | VERIFIED - diagnostic reports actual DB rows, not static data. |
| `src/mcp/tools/records.ts` | record write warnings and search rows | Helper warning result and pooled SQL result rows | Yes | VERIFIED - write responses merge helper warnings; search envelopes are built from `queryPgPool` rows. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Helper, retry worker, pg pool, and scanner retry unit behavior | `npm test -- tests/unit/background-embed-helper.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/pg-client-pool.test.ts tests/unit/scanner-embed-drain-status.test.ts` | 4 files passed, 16 tests passed, duration 737ms | PASS |
| Full Phase 146 integration/scenario/type/lint gate | User-provided orchestrator commands | All listed unit, integration, directed, integration scenario, typecheck, and lint gates exited 0 | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| Probe discovery | `find scripts -path '*/tests/probe-*.sh' -type f` and plan/summary grep | No phase-declared or conventional probes found for this phase | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-003 | 146-01, 146-02 | Background embedding uses a centralized durable helper | SATISFIED | Helper owns target updates, pending state, structured failure logging, and warning code; MCP write/re-embed paths are helper-backed. |
| REQ-004 | 146-01, 146-03 | Pending embeddings are retried and surfaced operationally | SATISFIED | Durable table, retry worker, scanner reachability, doctor diagnostic, and document/memory/record coverage exist. |
| REQ-005 | 146-04 | Direct `pg` usage for records is pooled | SATISFIED | Record embedding update and search SQL use `queryPgPool`; pool API preserves `createPgClientIPv4` and is closed during shutdown. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/mcp/tools/records.ts` | 704, 731 | `TODO LOG-01` | INFO | Pre-existing/formally labeled logging instrumentation follow-up; not a Phase 146 completion blocker. |
| Multiple touched files/tests | various | Empty arrays/null defaults | INFO | Normal initialization/test setup; not user-visible placeholder behavior and populated by real query/helper paths. |

### Human Verification Required

None.

### Gaps Summary

No blocking gaps found. ROADMAP/STATE/REQUIREMENTS contain stale status/progress text for Phase 146 and REQ-005, but the implementation, wiring, data flow, and focused verification evidence satisfy the phase goal and requirement intent.

---

_Verified: 2026-05-24T10:09:41Z_
_Verifier: the agent (gsd-verifier)_
