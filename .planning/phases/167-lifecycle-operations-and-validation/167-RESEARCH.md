# Phase 167: Lifecycle Operations and Validation - Research

**Researched:** 2026-06-11 [VERIFIED: current_date]
**Domain:** FlashQuery embedding lifecycle operations, MCP maintenance tooling, Supabase/pgvector DDL, directed/integration scenario validation [CITED: .planning/ROADMAP.md]
**Confidence:** HIGH for phase scope and local code paths; MEDIUM for final lock table shape because the source spec explicitly leaves advisory-lock vs tracking-table implementation to the executor [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

## User Constraints (from CONTEXT.md)

### Locked Source Of Truth
- Downstream planning, execution, test-generation, review, and verification agents MUST read the external requirements specification before answering open questions or making implementation choices: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Purpose Dimensions/Embedding Mgmt and Multi-Provider Support Requirements.md` [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
- Downstream planning, execution, test-generation, review, and verification agents MUST read the external test plan before selecting tests, naming scenario IDs, or deciding coverage scope: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Purpose Dimensions/Embedding Mgmt and Multi-Provider Support Test Plan.md` [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
- If these docs answer a question, agents should follow them directly. Only unresolved questions should come back to the user. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

### Phase Requirements
- Phase 167 must cover REQ-035, REQ-036, REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, and REQ-043. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
- Implementation must preserve the canonical ordering from the source spec: sub-step 3.1 lifecycle actions and concurrency before sub-step 3.2 operator recipes. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
- The plan must include tests required by Test Plan sections 4.8.1 through 4.9.2 and the coverage rows D-104 through D-121 plus IS-50. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

### Integration With Prior Phases
- Phase 167 must build on Phase 165 summaries and Phase 166 summaries. In particular, lifecycle operations should reuse the catalog rows, per-entry column/RPC naming, stamping helpers, provider guards, write fan-out, pending queue, search behavior, and plugin `embedding_name` resolution already implemented. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
- Retire-time RPC drops complete the lifecycle side of REQ-021 and must cover core and plugin RPCs created by prior phases. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

### the agent's Discretion
- Internal module organization for lifecycle helpers is flexible as long as the public `maintain_vault` contract, tests, and source-of-truth docs are satisfied. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
- The per-entry lock implementation may use PostgreSQL advisory locks or a `fqc_maintenance_jobs`-style tracking table with a partial unique index, provided heartbeat crash safety, conflict reporting, background status, and abort semantics are all implemented and tested. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

### Deferred Ideas (OUT OF SCOPE)
- No additional deferrals beyond those already captured by the external requirements spec. Do not defer any Phase 167-owned REQ without explicit user approval. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

## Project Constraints (from AGENTS.md)

- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- Use Node.js >= 20, TypeScript strict mode, ESM imports, `@modelcontextprotocol/sdk`, Supabase/pg, and Vitest. [VERIFIED: AGENTS.md]
- Use `async/await`; module boundaries should return typed errors instead of throwing where the surrounding pattern expects error envelopes. [VERIFIED: AGENTS.md]
- MCP tool handlers must catch failures internally and return `isError: true` only for runtime failures; expected errors should use the project response helpers. [VERIFIED: AGENTS.md]
- Use Zod for external input validation, including MCP parameters. [VERIFIED: AGENTS.md]
- All MCP tool responses use `{ content: [{ type: "text", text: "..." }] }`; response text should include IDs and key metadata for follow-up calls. [VERIFIED: AGENTS.md]
- Do not use CommonJS, `@modelcontextprotocol/server`, `npm link`, or server-side MCP session state. [VERIFIED: AGENTS.md]

## Phase Requirements

| ID | Planner Support |
|----|-----------------|
| REQ-035 | Plan `backfill_embeddings` schema, row selection, idempotent NULL-only embedding, dry-run/background/status, counts, failures, reindex, and per-entry lock reuse. [CITED: external requirements §6.6.1] |
| REQ-036 | Plan `rebuild_embeddings` overwrite path, `confirm`, required `max_rows`, `stale_only`, `mismatched_width_only`, background/dry-run parity, and reindex. [CITED: external requirements §6.6.2] |
| REQ-037 | Plan transactional retire: plugin conflict check, drop core/plugin columns, indexes, RPCs, delete catalog row, support deactivated entries, reject dry-run/background. [CITED: external requirements §6.6.3] |
| REQ-038 | Plan a per-entry lifecycle lock keyed by `(instance_id, embedding_name)` with heartbeat staleness, conflict details, independent entries, and no write-traffic blocking. [CITED: external requirements §6.6.4] |
| REQ-039 | Plan `abort` as a background-job signal observed at checkpoints, preserving completed rows and releasing the lock. [CITED: external requirements §6.6.5] |
| REQ-040 | Plan `max_rows` as a pre-work hard ceiling; `0` means unlimited; rebuild requires it; retire rejects it. [CITED: external requirements §6.6.6] |
| REQ-041 | Plan records-scope resolution through frozen plugin `embedding_name`, rejecting top-level `embedding_name` for pure records scope and splitting mixed scope correctly. [CITED: external requirements §6.6.7] |
| REQ-042 | Plan first-time enablement directed and YAML integration recipe scenarios. [CITED: external requirements §6.7.1] |
| REQ-043 | Plan legacy schema reset directed recipe scenario. [CITED: external requirements §6.7.2] |

## Summary

Phase 167 should be planned as exactly two implementation waves: first extend `maintain_vault` with lifecycle action validation, data/DDL helpers, per-entry locking, background status, and abort; then add the operator recipe scenarios and coverage rows. [CITED: .planning/ROADMAP.md] The planner should not split recipe tests ahead of lifecycle implementation because the recipes depend on working `backfill_embeddings`, `rebuild_embeddings`, `retire_embedding`, job status, and records-scope behavior. [CITED: external requirements §8.5]

The main implementation seam is `src/services/maintenance.ts`: it currently supports only `sync`, `repair`, and `status`, uses a single process-local `maintenanceInProgress` boolean, and stores background jobs in an in-memory `Map`. [VERIFIED: codebase grep: src/services/maintenance.ts] Phase 167 needs an embedding lifecycle path that preserves existing sync/repair semantics while introducing per-entry locks and richer job records for long-running embedding jobs. [CITED: external requirements §6.6.4]

**Primary recommendation:** Use a durable `fqc_maintenance_jobs`/lock table with a partial unique lock on running lifecycle jobs keyed by `(instance_id, embedding_name)` rather than extending the existing global boolean; this matches heartbeat, conflict-detail, status, stale-lock, and abort requirements more directly than process-local state. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md] [ASSUMED: implementation recommendation]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `maintain_vault` input schema and response envelopes | MCP Tool Layer | Service Layer | The MCP surface is registered in `src/mcp/tools/scan.ts`, while execution is delegated to `maintainVault`. [VERIFIED: codebase grep] |
| Lifecycle orchestration, validation, jobs, abort | Service Layer | Database / Storage | `src/services/maintenance.ts` owns maintenance job orchestration today; lifecycle persistence and locks need DB backing. [VERIFIED: codebase grep] |
| Core document/memory row selection and stamping writes | Embedding Service Layer | Database / Storage | `updateTargetEmbedding` already writes vectors plus stamping columns atomically when given an `EmbeddingWriteStamp`. [VERIFIED: codebase grep: src/embedding/background-embed.ts] |
| Provider calls | Embedding Provider Layer | Service Layer | `createEmbeddingProviderForCatalogEntry` is already used by catalog write, pending retry, plugin record, and search paths. [VERIFIED: codebase grep] |
| Core/plugin DDL drop and reindex | Database / Storage | Service Layer | Creation helpers live in `src/storage/supabase.ts`; retire and reindex should extend that storage boundary. [VERIFIED: codebase grep] |
| Records-scope resolution | Plugin / Records Layer | Service Layer | Frozen plugin choices are stored in `fqc_plugin_registry.embedding_name`; `records.ts` resolves active choices for write/search. [VERIFIED: codebase grep] |
| Directed and YAML scenario recipes | Test Harness | MCP Tool Layer | The external test plan requires Python directed scenarios and one YAML integration scenario through the public surface. [CITED: external test plan §4.8-§4.9] |

## Codebase Patterns

### Existing `maintain_vault` Surface

- `src/mcp/tools/scan.ts` registers `maintain_vault` with Zod schemas for `action`, `dry_run`, `background`, and `job_id`. [VERIFIED: codebase grep: src/mcp/tools/scan.ts]
- The current action enum is `sync | repair | status`, and action arrays are limited to `sync`/`repair`. [VERIFIED: codebase grep: src/services/maintenance.ts]
- Current `background: true` is valid only for `sync`; `dry_run: true` is valid only for `repair`; `status` rejects both. [VERIFIED: codebase grep: src/services/maintenance.ts]
- Background jobs are process-local `Map` records with `running | completed | failed | aborted`, but there is no public abort implementation yet. [VERIFIED: codebase grep: src/services/maintenance.ts]
- Existing response helpers are `maintenanceActionResult`, `jsonToolResult`, `jsonExpectedError`, and `jsonRuntimeError`. [VERIFIED: codebase grep: src/services/maintenance.ts, src/mcp/tools/scan.ts]

### Embedding Catalog and DDL Helpers

- `fqc_embeddings` already exists with `instance_id`, `name`, `dimensions`, ordered `endpoints`, `source`, and `status active/deactivated`. [VERIFIED: codebase grep: src/storage/supabase.ts]
- Startup catalog sync is implemented in `src/embedding/embedding-config-sync.ts` and calls `createCoreEmbeddingColumnSet(config, incoming)` for active entries. [VERIFIED: codebase grep]
- Core per-entry DDL creation is in `buildCoreEmbeddingColumnSetDDL` and creates `embedding_<name>`, four stamping columns, HNSW indexes, `match_memories_<name>`, and `match_documents_<name>`. [VERIFIED: codebase grep: src/storage/supabase.ts]
- Plugin-table per-entry DDL is in `buildPluginEmbeddingColumnSetDDL` and creates the same column set, HNSW index, `embedding_updated_at`, and `match_records_<table>_<name>`. [VERIFIED: codebase grep: src/storage/supabase.ts]
- No retire/drop helper currently exists for per-entry core/plugin columns, indexes, RPCs, or catalog rows; Phase 167 should add it in `src/storage/supabase.ts` or a storage-adjacent module. [VERIFIED: codebase grep]
- SQL identifier validation exists as `validateEmbeddingSqlName` with lowercase snake-case constraints; retire/reindex helpers should reuse it before deriving SQL names. [VERIFIED: codebase grep: src/storage/supabase.ts]

### Embedding Row Writes and Provider Calls

- `updateTargetEmbedding(target, vector, supabase, databaseUrl, stamp)` writes the vector and stamping columns in one SQL update for stamped entries. [VERIFIED: codebase grep: src/embedding/background-embed.ts]
- `documentEmbeddingTarget`, `memoryEmbeddingTarget`, and `recordEmbeddingTarget` already normalize target metadata for writes. [VERIFIED: codebase grep: src/embedding/background-embed.ts]
- `scheduleBackgroundEmbeddingsForActiveEntries` selects active catalog entries and fans out per-entry writes; lifecycle should not reuse fan-out directly for named core `embedding_name`, but should reuse provider creation and target/stamp helpers. [VERIFIED: codebase grep: src/embedding/background-embed.ts]
- `processPendingEmbeddings` already resolves active/deactivated/retired entries and deletes pending rows for retired entries; retire should preserve that invariant by deleting the catalog row only after transactionally dropping artifacts. [VERIFIED: codebase grep: src/embedding/pending-worker.ts] [CITED: external requirements §6.6.3]
- Provider length guards and metadata are already implemented in Phase 165, so lifecycle writes can rely on provider-level width validation before storing vectors. [CITED: .planning/phases/165-foundation-infrastructure/165-03-SUMMARY.md]

### Phase 166 Gap-Fix Reconciliation

- Phase 166 gap fix `3056376` changed document re-embed callers to use `scheduleBackgroundEmbeddingsForActiveEntries`, so any Phase 167 document/memory mutation path that is not a named lifecycle operation should continue using active-catalog fan-out. Named `backfill_embeddings` and `rebuild_embeddings` still must target the caller-selected catalog entry and therefore should call `createEmbeddingProviderForCatalogEntry`, `provider.embed`, and `updateTargetEmbedding` directly. [VERIFIED: git show 3056376] [VERIFIED: codebase grep]
- The same gap fix preserves fallback-provider metadata and warnings across failed endpoints before a later endpoint succeeds. Lifecycle processors must read `provider.getLastEmbeddingMetadata()` after each embed and aggregate warnings such as `truncated_inputs` and `rate_limit_events` into lifecycle result/job metadata instead of reducing them to row failures only. [VERIFIED: git show 3056376] [VERIFIED: codebase grep: src/embedding/provider.ts]
- Startup validation now skips direct PostgreSQL catalog validation when `supabase.databaseUrl` is empty, but Phase 167 DDL and durable-job helpers still require direct PostgreSQL access. Plans that add DDL, locks, retire transactions, reindexing, or schema/proc/index inventory must keep `config.supabase.databaseUrl` as a required implementation precondition for those paths; stamped row writes through `updateTargetEmbedding` may still use its existing Supabase fallback when direct PostgreSQL is unavailable. [VERIFIED: git show 3056376] [VERIFIED: codebase grep: src/embedding/startup-validation.ts, src/embedding/background-embed.ts]
- Plugin same-version re-registration now switches the frozen embedding entry and creates the new entry's columns/RPC while leaving old columns/RPCs in place. Retire inventory must therefore keep schema/proc/index discovery for stale artifacts and must remove the base `embedding_<name>` column plus stamps/index/RPCs completely so later plugin registration is not refused as an orphaned embedding artifact. [VERIFIED: git show 3056376] [VERIFIED: tests/scenarios/directed/testcases/test_plugin_re_register_switch_entry.py]

### Plugin and Records Patterns

- Plugin registration stores frozen `embedding_name` and `embedding_resolved_at` on `fqc_plugin_registry`. [VERIFIED: codebase grep: src/storage/supabase.ts, src/mcp/tools/plugins.ts]
- `resolvePluginActiveEmbedding` in `src/mcp/tools/records.ts` looks up a registry entry's active catalog entry and returns `null` for missing/deactivated/opted-out choices. [VERIFIED: codebase grep]
- `scheduleRecordEmbedding` builds record embed text from `embed_fields` and writes only the plugin's resolved entry. [VERIFIED: codebase grep: src/mcp/tools/records.ts]
- Retire conflict detection should query active registered plugin rows whose stored `embedding_name` equals the target and return `conflict` with `affected_plugins`. [CITED: external requirements §6.6.3]
- Records-scope lifecycle work needs plugin table discovery from registry rows plus parsed schema/table specs, not a top-level `embedding_name`, for pure-record scopes. [CITED: external requirements §6.6.7]

### Test Patterns

- Vitest unit tests live under `tests/unit`; `npm run test:unit -- <files>` is the reliable targeted command pattern used by prior phase summaries. [CITED: .planning/phases/165-foundation-infrastructure/165-02-SUMMARY.md]
- Vitest integration tests live under `tests/integration` and use real Supabase via `.env.test`; `.env.test` exists in this workspace. [VERIFIED: env probe] [VERIFIED: AGENTS.md]
- Directed scenario tests live under `tests/scenarios/directed/testcases` and are run with positional patterns, not `--pattern`, because prior Phase 166 observed `--pattern` is unsupported by the runner. [CITED: .planning/phases/166-embedding-pipeline/166-04-SUMMARY.md]
- Directed tests needing embeddings should force a dedicated managed server with `managed=True` and `require_embedding=True`; the shared suite server runs without embedding provider config by default. [VERIFIED: codebase grep: tests/scenarios/directed/WRITING_SCENARIOS.md]
- YAML integration scenarios live under `tests/scenarios/integration/tests` and are run with `python3 tests/scenarios/integration/run_integration.py --managed <pattern>`. [VERIFIED: codebase grep: tests/scenarios/integration/README.md]

## Implementation Architecture

### Recommended Module Layout

```text
src/
├── mcp/tools/scan.ts                         # extend maintain_vault schema and descriptions [VERIFIED: codebase grep]
├── services/maintenance.ts                   # dispatch, status, abort, compatibility with sync/repair [VERIFIED: codebase grep]
├── embedding/lifecycle/
│   ├── types.ts                              # input, scope, counts, failures [ASSUMED]
│   ├── jobs.ts                               # job/lock acquire, heartbeat, status, abort signal [ASSUMED]
│   ├── scope.ts                              # core + records scope resolution and max_rows counts [ASSUMED]
│   ├── backfill.ts                           # NULL-only processing [ASSUMED]
│   ├── rebuild.ts                            # overwrite processing and stale/mismatched filters [ASSUMED]
│   └── retire.ts                             # transaction orchestration calling storage DDL helpers [ASSUMED]
└── storage/supabase.ts                       # add lifecycle DDL: job table, drop helpers, reindex helpers [VERIFIED: codebase grep]
```

### Data and Job Model

- Add a durable job/lock table rather than extending only the existing in-memory `Map`, because heartbeat crash recovery and stale lock acquisition cannot be satisfied across process crashes with process-local state alone. [CITED: external requirements §6.6.4] [ASSUMED: implementation recommendation]
- Recommended table shape: `fqc_maintenance_jobs(id uuid, instance_id text, action text, embedding_name text, status text, started_at, finished_at, heartbeat_at, abort_requested_at, counts jsonb, failures jsonb, error jsonb, metadata jsonb)`. [ASSUMED]
- Recommended lock enforcement: partial unique index on `(instance_id, embedding_name)` where `status = 'running'` and action is one of `backfill_embeddings`, `rebuild_embeddings`, `retire_embedding`. [ASSUMED]
- Heartbeat should update `heartbeat_at` after each batch/checkpoint; lock acquisition should treat stale rows older than default 5 minutes as acquirable and mark the stale job failed/abandoned before taking over. [CITED: external requirements §6.6.4] [ASSUMED: exact status label]
- Abort should set `abort_requested_at` or equivalent on running background jobs; processors check it between rows/batches, stop starting new rows, mark status `aborted`, persist partial counts, and release the lock. [CITED: external requirements §6.6.5]

### Lifecycle Action Flow

1. Validate public input in `scan.ts` with Zod and in `maintenance.ts` with action-specific semantic checks. [VERIFIED: codebase grep] [CITED: external requirements §6.6]
2. Resolve catalog entry by `(instance_id, embedding_name)` for core backfill/rebuild/retire; return `not_found` for missing entries and `unsupported` for deactivated entries on backfill/rebuild. [CITED: external requirements §6.1.6] [CITED: external requirements §6.6.1-§6.6.3]
3. Resolve scope into concrete work units before work: core documents, core memories, and plugin record tables with their per-plugin choices. [CITED: external requirements §6.6.7]
4. Count in-scope rows before work and enforce `max_rows` before any DML/DDL. [CITED: external requirements §6.6.6]
5. Acquire the per-entry lifecycle lock before any row mutation or retire DDL. [CITED: external requirements §6.6.4]
6. For backfill/rebuild, process rows in small batches, call `createEmbeddingProviderForCatalogEntry`, write with `updateTargetEmbedding`, collect failures, heartbeat, and observe abort checkpoints. [VERIFIED: codebase grep] [CITED: external requirements §6.6.1-§6.6.5]
7. Run `REINDEX INDEX idx_<table>_embedding_<name>` for affected tables after successful backfill/rebuild. [CITED: external requirements §6.6.1-§6.6.2]
8. For retire, run a single transaction that drops `match_memories_<name>`, `match_documents_<name>`, every `match_records_<plugin_table>_<name>`, HNSW indexes, columns, and finally deletes `fqc_embeddings` row. [CITED: external requirements §6.6.3]
9. Release lock in `finally` for success, failure, and abort paths. [CITED: external requirements §6.6.4-§6.6.5]

### Action Validity Matrix To Plan

| Action | Required | Optional | Invalid |
|--------|----------|----------|---------|
| `backfill_embeddings` | `scope`; `embedding_name` when core scope needs it | `max_rows`, `dry_run`, `background` | `confirm`, `stale_only`, `mismatched_width_only`, `drop_stamping_columns` unless external spec §7.8 says otherwise [CITED: external requirements §6.6.1] |
| `rebuild_embeddings` | `scope`, `max_rows`, `confirm`; `embedding_name` when core scope needs it | `dry_run`, `background`, `stale_only`, `mismatched_width_only` | `drop_stamping_columns` [CITED: external requirements §6.6.2] |
| `retire_embedding` | `embedding_name`, `confirm` | `drop_stamping_columns` default true | `scope`, `max_rows`, `dry_run`, `background`, `stale_only`, `mismatched_width_only` [CITED: external requirements §6.6.3] |
| `abort` | `job_id` | none | all embedding-specific parameters [CITED: external requirements §6.6.5] |
| `status` | `job_id` | none | `dry_run`, `background`; preserve existing convention [VERIFIED: codebase grep: src/services/maintenance.ts] |

### File-Level Modification Points

| File | Planner Assignment |
|------|--------------------|
| `src/mcp/tools/scan.ts` | Extend `MaintenanceActionSchema`, add lifecycle parameters, update tool description, preserve current response wrapping. [VERIFIED: codebase grep] |
| `src/services/maintenance.ts` | Introduce lifecycle dispatch without regressing current sync/repair/status behavior; route expected errors through `ErrorEnvelope`. [VERIFIED: codebase grep] |
| `src/mcp/utils/response-formats.ts` | Extend maintenance result/count/error shapes if needed; use existing expected-error conventions. [VERIFIED: codebase grep] |
| `src/storage/supabase.ts` | Add `fqc_maintenance_jobs` DDL, lock indexes, retire/drop helpers, and reindex helpers. [VERIFIED: codebase grep] [ASSUMED: table name] |
| `src/embedding/background-embed.ts` | Reuse targets and `updateTargetEmbedding`; avoid duplicating stamped SQL. [VERIFIED: codebase grep] |
| `src/embedding/provider.ts` | Reuse `createEmbeddingProviderForCatalogEntry`; do not add new provider packages. [VERIFIED: codebase grep] |
| `src/plugins/manager.ts` / `src/mcp/tools/records.ts` | Reuse plugin table naming/schema parsing and frozen embedding choices for records-scope work. [VERIFIED: codebase grep] |
| `flashquery.example.yml` | Update final recipe YAML expectations for REQ-042/REQ-043. [CITED: external requirements §6.7] |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Unit framework | Vitest via `npm run test:unit` [VERIFIED: package.json] |
| Integration framework | Vitest via `npm run test:integration`; requires `.env.test` for Supabase [VERIFIED: package.json] [VERIFIED: AGENTS.md] |
| Directed scenarios | Python runner `python3 tests/scenarios/directed/run_suite.py --managed <pattern>` [VERIFIED: codebase grep] |
| YAML integration scenarios | Python runner `python3 tests/scenarios/integration/run_integration.py --managed <pattern>` [VERIFIED: codebase grep] |
| Typecheck | `npm run typecheck` [VERIFIED: package.json] |

### Required Test Coverage From External Test Plan

| REQ | Required Tests |
|-----|----------------|
| REQ-035 | T-S-005/D-104 `test_backfill_embeddings_full_scope.py`; T-S-006/D-105 `test_backfill_embeddings_dry_run.py`; T-S-007/D-106 `test_backfill_embeddings_background.py`; T-S-008/D-107 `test_backfill_embeddings_failures.py`. [CITED: external test plan §4.8.1] |
| REQ-036 | T-S-009/D-108 `test_rebuild_embeddings_stale_only.py`; T-S-010/D-109 `test_rebuild_embeddings_confirm_mismatch.py`; T-S-011/D-110 `test_rebuild_embeddings_max_rows_required.py`. [CITED: external test plan §4.8.2] |
| REQ-037 | T-S-012/D-111 `test_retire_embedding_transactional.py`; T-S-013/D-112 `test_retire_embedding_plugin_conflict.py`; T-S-014/D-113 `test_retire_embedding_deactivated_entry.py`. [CITED: external test plan §4.8.3] |
| REQ-038 | T-S-015/D-114 `test_lifecycle_lock_per_entry.py`; T-S-016/D-115 `test_lifecycle_lock_heartbeat.py`. [CITED: external test plan §4.8.4] |
| REQ-039 | T-S-017/D-116 `test_abort_background_job.py`; T-S-018/D-117 `test_abort_unknown_job.py`. [CITED: external test plan §4.8.5] |
| REQ-040 | T-U-036..T-U-040 in `tests/unit/max-rows-contract.test.ts`. [CITED: external test plan §4.8.6] |
| REQ-041 | T-S-019/D-118 `test_records_scope_embedding_resolution.py`; T-S-020/D-119 `test_records_scope_mixed.py`. [CITED: external test plan §4.8.7] |
| REQ-042 | T-S-021/D-120 `test_first_time_enablement.py`; T-Y-001/IS-50 `embedding_first_time_enablement_search.yml`. [CITED: external test plan §4.9.1] |
| REQ-043 | T-S-022/D-121 `test_legacy_schema_reset.py`. [CITED: external test plan §4.9.2] |

### Commands Planner Should Use

```bash
npm run test:unit -- tests/unit/max-rows-contract.test.ts
npm run test:integration -- tests/integration/embedding/maintain-vault-lifecycle.test.ts
npm run build
python3 tests/scenarios/directed/run_suite.py --managed "test_backfill_embeddings_*"
python3 tests/scenarios/directed/run_suite.py --managed "test_rebuild_embeddings_*"
python3 tests/scenarios/directed/run_suite.py --managed "test_retire_embedding_*"
python3 tests/scenarios/directed/run_suite.py --managed "test_lifecycle_lock_*"
python3 tests/scenarios/directed/run_suite.py --managed "test_abort_*"
python3 tests/scenarios/directed/run_suite.py --managed "test_records_scope_*"
python3 tests/scenarios/directed/run_suite.py --managed "test_first_time_enablement"
python3 tests/scenarios/directed/run_suite.py --managed "test_legacy_schema_reset"
python3 tests/scenarios/integration/run_integration.py --managed "embedding_first_time_enablement_search"
npm run typecheck
```

- The roadmap mentions `--grep`, but Vitest 4 in this repo rejects `--grep`; use file targeting or `-t` where appropriate. [CITED: .planning/phases/165-foundation-infrastructure/165-02-SUMMARY.md]
- The directed runner should use positional patterns, not `--pattern`, based on Phase 166 verification. [CITED: .planning/phases/166-embedding-pipeline/166-04-SUMMARY.md]
- Run `npm run build` before directed scenarios when source changes affect `dist`, because Phase 166 found the directed runner could otherwise use stale build output. [CITED: .planning/phases/166-embedding-pipeline/166-04-SUMMARY.md]

### Coverage Matrix Updates

- Add D-104 through D-121 to `tests/scenarios/directed/DIRECTED_COVERAGE.md`. [CITED: external test plan §7]
- Add IS-50 to `tests/scenarios/integration/INTEGRATION_COVERAGE.md`. [CITED: external test plan §7]
- Use `flashquery-directed-testgen`, `flashquery-directed-covgen`, `flashquery-integration-testgen`, and `flashquery-integration-covgen` where implementation agents choose skill-assisted scenario authoring. [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]

## Risks

| Risk | Why It Matters | Mitigation |
|------|----------------|------------|
| Process-local lock state cannot satisfy heartbeat crash recovery. [VERIFIED: codebase grep] | Existing `maintenanceInProgress` and job `Map` vanish on process crash. [VERIFIED: codebase grep] | Plan durable DB-backed jobs/locks or explicitly prove advisory-lock heartbeat semantics. [CITED: external requirements §6.6.4] |
| `max_rows` implemented as a loop budget instead of pre-work ceiling. [ASSUMED] | Spec requires refusal before any DML/DDL when rows exceed cap. [CITED: external requirements §6.6.6] | Plan a count query before lock-protected row processing and assert no mutation in tests. [CITED: external test plan §4.8.6] |
| Retire drops only core artifacts and misses plugin RPCs/columns. [ASSUMED] | REQ-037 requires every embedding-bearing core table and every plugin table registered against the entry. [CITED: external requirements §6.6.3] | Build artifact inventory from `fqc_plugin_registry` plus parsed plugin table names before transaction. [VERIFIED: codebase grep] |
| Backfill/rebuild duplicate stamped SQL. [ASSUMED] | Duplicated SQL risks missing stamp columns or record timestamp differences. [VERIFIED: codebase grep] | Reuse `updateTargetEmbedding` and target helpers. [VERIFIED: codebase grep] |
| Records-scope uses top-level `embedding_name`. [ASSUMED] | Pure records scope must reject top-level `embedding_name`; plugin registration owns records choice. [CITED: external requirements §6.6.7] | Create a scope resolver with separate core and records branches. [ASSUMED] |
| Abort can interrupt mid-row with inconsistent counts. [ASSUMED] | Spec permits in-flight embed to complete but forbids starting new rows after abort is observed. [CITED: external requirements §6.6.5] | Check abort only at row/batch checkpoints, then persist partial counts. [CITED: external requirements §6.6.5] |
| Scenario tests depend on embeddings but run on shared managed server without embedding provider. [VERIFIED: codebase grep] | Scenario docs state `require_embedding` flags only apply when the test starts its own managed server. [VERIFIED: codebase grep: tests/scenarios/directed/WRITING_SCENARIOS.md] | Force `managed=True` for embedding-required directed scenarios. [VERIFIED: codebase grep] |
| Legacy schema reset can damage non-test DBs. [CITED: external requirements §6.7.2] | Integration runner deletes `fqc_*` data and recipe drops legacy columns. [VERIFIED: codebase grep: tests/scenarios/integration/README.md] | Mark scenarios managed/test-only and assert throwaway `.env.test`. [VERIFIED: AGENTS.md] |

## Planner Guidance

### Recommended Plan Split

1. **Lifecycle contract and job foundation:** extend `scan.ts`, `maintenance.ts`, response types, job table DDL, lock acquire/release/heartbeat/status/abort plumbing, and `max_rows` unit tests. [VERIFIED: codebase grep] [CITED: external requirements §6.6.4-§6.6.6]
2. **Backfill/rebuild core rows:** implement scope counting, core document/memory row selection, provider calls, stamped writes, dry-run/background, failures, reindex, and directed coverage D-104 through D-110. [CITED: external test plan §4.8.1-§4.8.2]
3. **Records scope and retire:** implement plugin-record scope resolution, mixed scope behavior, transactional retire drop helpers, plugin conflict refusal, pending-row/catalog cleanup behavior, and directed coverage D-111 through D-119. [CITED: external test plan §4.8.3-§4.8.7]
4. **Operator recipes:** implement `test_first_time_enablement.py`, `test_legacy_schema_reset.py`, `embedding_first_time_enablement_search.yml`, update coverage matrices, and update `flashquery.example.yml`. [CITED: external test plan §4.9.1-§4.9.2]

### Must Not Hand-Roll

| Problem | Use Instead |
|---------|-------------|
| Provider chains and vector width validation | `createEmbeddingProviderForCatalogEntry` and existing provider guards. [VERIFIED: codebase grep] |
| Stamped vector updates | `updateTargetEmbedding` with `EmbeddingWriteStamp`. [VERIFIED: codebase grep] |
| SQL identifier derivation | `validateEmbeddingSqlName` and identifier escaping helpers in storage code. [VERIFIED: codebase grep] |
| Plugin embedding choice | Frozen `fqc_plugin_registry.embedding_name`; do not infer from current YAML during records lifecycle work. [VERIFIED: codebase grep] |
| Scenario harness behavior | Existing directed/YAML runners and coverage matrices. [VERIFIED: codebase grep] |

### Resolved Planner Decisions

1. **Exact job table naming and schema:** use a durable tracking table named `fqc_maintenance_jobs`, not advisory locks. The table shape is specified in Plan 2 and includes job id, instance id, action, embedding name, status, started/finished/heartbeat/abort timestamps, counts, failures, error, and metadata. A partial unique index enforces one running lifecycle job per `(instance_id, embedding_name)` for backfill, rebuild, and retire. [RESOLVED: revision iteration 1] [CITED: .planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md]
2. **Dry-run estimate formula:** lifecycle dry-runs use deterministic conservative estimates. `estimated.input_tokens = ceil(total_input_characters / 4)`. `estimated.cost_usd = null` because neither the external requirements nor local catalog endpoint config defines pricing metadata. Responses include `estimated.cost_basis = "unavailable_provider_pricing_metadata"`. `estimated.wall_time_seconds = ceil(would_process * max(rate_limit.min_delay_ms across entry endpoints, 0) / 1000)`. [RESOLVED: revision iteration 1] [CITED: external requirements §6.6.1]
3. **Legacy schema reset mechanics:** Plan 7 implements the external test plan's seven-step managed scenario exactly: create a managed/test database snapshot with legacy singular `embedding` columns and legacy `purposes: - name: embedding`, assert the documented startup failure from Research §5.3/§9.1 as referenced by requirements §6.7.2, stop the server, drop legacy columns only under the managed scenario guard, update YAML to top-level `embeddings:`, restart, re-register plugins with explicit embedding choice, run `backfill_embeddings`, and verify semantic search. [RESOLVED: revision iteration 1] [CITED: external requirements §6.7.2] [CITED: external test plan §4.9.2]
4. **Pure-records `rebuild_embeddings` confirm contract:** REQ-041 forbids top-level `embedding_name` for pure-records scope, while REQ-036 requires `confirm` to match the embedding entry being rebuilt. Resolve this by deriving the expected confirm value from the frozen plugin choices selected by records scope. For pure-records `rebuild_embeddings`, first resolve all non-skipped record work units; if all non-null work units share one `embedding_name`, require `confirm` to equal that derived name. If non-skipped work units span multiple distinct embedding names, return `invalid_input` before mutation with `details.resolved_embedding_names` and a message telling the operator to narrow `scope.plugin`/`scope.records.targets` so one embedding entry is rebuilt per call. Opted-out plugins (`embedding_name = null`) remain skipped and do not affect the expected confirm. Mixed scope continues to require top-level `embedding_name`/`confirm` for the core half, while records use frozen plugin choices. [RESOLVED: revision iteration 2] [CITED: external requirements §6.6.2] [CITED: external requirements §6.6.7] [CITED: external research §7.3] [CITED: external research §7.8]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, tests, runtime | yes | v26.0.0 | Must still respect package engine `>=20`. [VERIFIED: env probe] |
| npm | Build and Vitest scripts | yes | 11.12.1 | none needed. [VERIFIED: env probe] |
| Python 3 | Scenario runners | yes | 3.12.3 | none needed. [VERIFIED: env probe] |
| `.env.test` | Integration and scenario tests | yes | present | Tests that need Supabase skip/fail without it. [VERIFIED: env probe] |
| `gsd-sdk` | Optional commit/state automation | no | missing | Prior phases updated state manually when SDK was unavailable. [VERIFIED: env probe] [CITED: .planning/STATE.md] |

## Package Legitimacy Audit

No new external packages are recommended for Phase 167. [VERIFIED: package.json] The planner should use existing dependencies: TypeScript, Zod, Supabase/pg, Vitest, and the Python scenario framework already in the repo. [VERIFIED: AGENTS.md] [VERIFIED: package.json]

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth surface | `maintain_vault` remains an existing MCP admin tool; no session state should be added. [VERIFIED: AGENTS.md] |
| V3 Session Management | no | MCP remains stateless per project instruction. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve host/tool exposure conventions; lifecycle actions are admin maintenance behavior. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Zod schema plus semantic validation for action matrices, `embedding_name`, scope, `confirm`, `max_rows`, and `job_id`. [VERIFIED: AGENTS.md] [CITED: external requirements §6.6] |
| V6 Cryptography | no new crypto | Do not add cryptographic code. [ASSUMED] |

## Sources

### Primary
- `.planning/phases/167-lifecycle-operations-and-validation/167-CONTEXT.md` - locked decisions, discretion areas, canonical refs. [VERIFIED: codebase grep]
- `.planning/ROADMAP.md` - Phase 167 goal, sub-steps, success criteria, test gates. [VERIFIED: codebase grep]
- `.planning/REQUIREMENTS.md` - REQ-035 through REQ-043 traceability. [VERIFIED: codebase grep]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Purpose Dimensions/Embedding Mgmt and Multi-Provider Support Requirements.md` - authoritative REQ details. [CITED: external requirements]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Purpose Dimensions/Embedding Mgmt and Multi-Provider Support Test Plan.md` - authoritative test IDs and scenario names. [CITED: external test plan]
- `AGENTS.md` - project stack, tool, testing, and prohibition constraints. [VERIFIED: AGENTS.md]

### Codebase
- `src/services/maintenance.ts`, `src/mcp/tools/scan.ts`, `src/embedding/background-embed.ts`, `src/embedding/pending-worker.ts`, `src/storage/supabase.ts`, `src/embedding/embedding-config-sync.ts`, `src/mcp/tools/records.ts`, `src/mcp/tools/plugins.ts`, `src/plugins/manager.ts`. [VERIFIED: codebase grep]
- Prior summaries: `.planning/phases/165-foundation-infrastructure/165-01-SUMMARY.md`, `165-02-SUMMARY.md`, `165-03-SUMMARY.md`, `.planning/phases/166-embedding-pipeline/166-01-SUMMARY.md`, `166-02-SUMMARY.md`, `166-03-SUMMARY.md`, `166-04-SUMMARY.md`. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**
- Codebase patterns: HIGH - verified against local files. [VERIFIED: codebase grep]
- Implementation architecture: MEDIUM-HIGH - source docs define behavior; module split and DB job table are recommended design choices. [CITED: external requirements] [ASSUMED]
- Validation architecture: HIGH - test IDs and commands come from external test plan and local scripts, with known runner caveats from prior summaries. [CITED: external test plan] [VERIFIED: package.json]

**Valid until:** 2026-07-11 for local codebase findings unless Phase 167 planning/execution changes these files first. [ASSUMED]
