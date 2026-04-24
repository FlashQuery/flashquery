---
gsd_state_version: 1.0
milestone: v2.9
milestone_name: Filesystem Primitive Tools
status: ready_to_plan
last_updated: "2026-04-24T19:20:02.210Z"
last_activity: 2026-04-24 -- Phase --phase execution started
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 10
  completed_plans: 8
  percent: 25
---

# FlashQuery Core — State

## Current Position

Phase: 93
Plan: Not started
Status: Ready to plan
Last activity: 2026-04-24

```
[________________________________________] 0% — 0/7 phases
```

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-cleanup-consolidate | Consolidate CLEANUP.md info into README.md and add verification to cleanup script | 2026-04-15 | d142f1a | [260415-cleanup-consolidate](./quick/260415-cleanup-consolidate/) |

## Accumulated Context

### Milestone v2.9 Initialization (2026-04-24)

**Milestone:** Filesystem Primitive Tools — add `create_directory` MCP tool and upgrade `list_files` to `list_vault`.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 91 | Shared Utilities | REFAC-03, REFAC-04, TEST-01, TEST-02, TEST-03 |
| 92 | create_directory Handler | DIR-01 through DIR-10, TEST-04 |
| 93 | list_vault Handler | LIST-01 through LIST-13, TEST-05 |
| 94 | Migration and Cleanup | REFAC-01, REFAC-02 |
| 95 | Integration Tests | TEST-06 |
| 96 | Coverage Matrix Updates | TEST-07 |
| 97 | Plugin Updates | PLUG-01 through PLUG-05 |

**Note:** TEST-08 (no regressions) is a continuous requirement spanning all phases.

**Dependencies:**

- Phase 91: no dependencies (foundation — must be first)
- Phase 92: depends on Phase 91
- Phase 93: depends on Phases 91 and 92
- Phase 94: depends on Phases 91, 92, and 93
- Phase 95: depends on Phase 94 (all tools in final locations)
- Phase 96: depends on Phase 95 (test IDs finalized after implementation)
- Phase 97: depends on Phase 94 (API surface finalized); can run parallel with Phases 95-96

**Key architectural decisions for this milestone:**

- `create_directory` does NOT acquire the write lock — `mkdir -p` is OS-atomic; the Implementation Guide note about needing a lock was an oversight (OQ-1 resolved)
- `parseDateFilter()` NaN bug is fixed during Phase 91 extraction — invalid ISO strings return `null`, not `NaN` (OQ-2 resolved)
- `list_vault` on a non-existent path returns `isError: true` — behavior change from old `list_files` which returned empty results (OQ-3 resolved)
- DB enrichment in `list_vault` is batched in chunks of 100 paths per query (OQ-4 resolved)
- `remove_directory` migration is a two-step commit: (1) copy unchanged, verify tests; (2) update to use `validateVaultPath()` (OQ-5 resolved)
- `limit` in `list_vault` applies to the combined sorted list (directories first, then files), not per-group (OQ-6 resolved)
- New files.ts module is home for filesystem primitives: `create_directory`, `list_vault`, and migrated `remove_directory`

**Test suite baseline going into v2.9 (2026-04-23 post-Phase 90):**

- Unit: 1091/1111 (20 pre-existing deferred failures)
- Integration: 333 pass
- E2E: 40/40

**Reference documents (authoritative):**

- Requirements spec: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Product/Definition/MCP for Directory Creation/MCP Directory Create and List.md`
- Dev plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Product/Definition/MCP for Directory Creation/MCP for Directory Creation Dev Plan.md`

### Milestone v2.8 Initialization (2026-04-20)

**Milestone:** Plugin Callback Overhaul — replace push-based plugin callbacks with reconcile-on-read pattern.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 84 | Schema Parsing & Policy Infrastructure | SCHEMA-01 through SCHEMA-06 (6 reqs) |
| 85 | Reconciliation Engine | RECON-01 through RECON-08 (8 reqs) |
| 86 | Record Tool Integration & Pending Review | RECTOOLS-01 through RECTOOLS-09 (9 reqs) |
| 87 | Scanner Modifications & Frontmatter Sync | SCANNER-01 through SCANNER-04 (4 reqs) |
| 88 | Legacy Infrastructure Removal | LEGACY-01 through LEGACY-07 (7 reqs) |
| 89 | Test Helper & Existing Test Updates | TEST-01 through TEST-17 (17 reqs) |

**Dependencies:**

- Phase 84: no dependencies (foundation)
- Phase 85: depends on Phase 84
- Phase 86: depends on Phases 84 + 85
- Phase 87: depends on Phases 84 + 85 (parallel with Phase 86)
- Phase 88: depends on Phases 85, 86, 87
- Phase 89: depends on all previous phases

**Key architectural decisions for this milestone:**

- `ParsedPluginSchema` interface → `DocumentTypePolicy` (updated name)
- `atomicWriteFrontmatter()` extracted to `src/utils/frontmatter.ts` before legacy deletion
- `fqc_change_queue` table dropped via `ALTER TABLE IF EXISTS` migration
- Staleness cache threshold: 30 seconds (hardcoded, configurable in future)
- `access: read-only` is a warning guardrail only — hard enforcement deferred post-v2.8
- `flashquery discover` CLI command removed without replacement

**Test suite baseline going into v2.8 (2026-04-15 post-v2.7):**

- Phase 83 (FQC Name Change) completed 2026-04-16
- Last known passing baseline: ~1117 unit / 323 integration / 40 E2E

### Phase Numbering

v2.7 ended at Phase 83. v2.8 ran Phases 84-89. Phase 90 was a standalone frontmatter centralization phase. v2.9 runs Phases 91-97.

### Phase 86 Decisions (2026-04-21)

- `instance_id` in plugin tables and `fqc_pending_plugin_review` must be `config.instance.id` (FQC server identity), not the plugin instance name — these are distinct concepts
- `executeReconciliationActions` receives `fqcInstanceId` as optional 4th param + `databaseUrl` as optional 5th param (threaded from config, falls back to `process.env.DATABASE_URL`)
- `clear_pending_reviews` scopes by `config.instance.id`, not `plugin_instance` parameter
- After auto-tracking a document, `updateDocumentOwnership` must be called so subsequent reconciliation classifies it as `unchanged` not `disassociated`
- `search_records` reconciliation preamble now guarded by write-lock (consistent with other 4 record tools)
- Code review fixes applied: WR-02 (databaseUrl threading), WR-03 (search_records lock), WR-04 (UUID validation error surface)

### Phase 87 Decisions (2026-04-21)

- `fqcOwner`/`fqcType` extracted null-safely from frontmatter (`typeof frontmatter.fqc_owner === 'string' ? frontmatter.fqc_owner : null`); synced to `ownership_plugin_id`/`ownership_type` on all 6 INSERT/content-change UPDATE paths; MOVE branch excluded (path-only update, no ownership change)
- `fqc_change_queue` write blocks (NOTIF-01/NOTIF-02) fully removed from scanner.ts; `invokeChangeNotifications`, `getWatcherMap`, `ChangePayload` imports removed (~265 lines deleted)
- `ensureLastSeenColumn` exported from `plugin-reconciliation.ts` so `propagateFqcIdChange()` can call it per-table during fqc_id UPDATE
- `pgClient.connect()` must be inside the try block in `propagateFqcIdChange()` — placing it outside breaks graceful degradation (ECONNREFUSED propagates unhandled)

### Known Issues Going Into v2.9

- 20 pre-existing deferred unit test failures (tracked since v2.8; do not fix during v2.9)
- 1 deferred Phase 86 multi-table-reconciliation test (ownership reset fix applied but unverified per MEMORY.md)

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-04-21:

| Category | Item | Status |
|----------|------|--------|
| debug | claude-code-auth-reauth | investigating |
| debug | crm-plugin-multi-bug | verifying |
| debug | ddl-table-creation | awaiting_human_verify |
| debug | docker-config-missing | awaiting_human_verify |
| debug | dockerfile-build-context-and-file-org | awaiting_human_verify |
| debug | example-config-deprecated-projects | awaiting_human_verify |
| debug | exit-immediately | investigating |
| debug | fqc-background-scan-blocks-archives | unknown |
| debug | fqc-binary-missing | awaiting_human_verify |
| debug | fqc-cc-auth-mismatch | awaiting_human_verify |
| debug | fqc-documents-orphaned-rows | awaiting_human_verify |
| debug | fqc-documents-sync | awaiting_human_verify |
| debug | fqc-mcp-claude-desktop-ehostunreach | investigating |
| debug | fqc-memory-tools-create-documents | investigating |
| debug | fqc-move-vs-duplicate-detection | awaiting_human_verify |
| debug | fqc-search-documents-path-update | awaiting_human_verify |
| debug | fqc-vault-scan-zero-docs | investigating |
| debug | integration-test-vault-undefined | investigating |
| debug | knowledge-base | unknown |
| debug | linux-supabase-hang-2026-04-10 | unknown |
| debug | plugin-registration-yaml-validation | verified |
| debug | postgres-meta-ddl-failure | root_cause_found |
| debug | release-not-function-FINAL | unknown |
| debug | remaining-mcp-tool-tests | pending |
| debug | scanner-duplicate-race-analysis | unknown |
| debug | scanner-hash-first-refactor | awaiting_human_verify |
| debug | search-documents-vault-path-column | investigating |
| debug | shutdown-listening-debug | investigating |
| debug | unit-test-mocks | investigating |
| debug | v17-integration-regression | investigating |
| uat_gap | Phase 78 (78-HUMAN-UAT.md) | partial — 1 pending scenario |
| uat_gap | Phase 80 (80-UAT.md) | diagnosed |
| verification_gap | Phase 78 (78-VERIFICATION.md) | human_needed |
| quick_task | 260324-mad-configure-internal-supabase-for-testing- | missing |
| quick_task | 260324-r95-add-ollama-integration-test-for-embeddin | missing |
| quick_task | 260330-gia-investigate-setup-sh-and-document-implem | missing |
| quick_task | 260330-x8l-add-test-case-code-samples-to-backlog-it | missing |
| quick_task | 260331-1os-setup-sh-bearer-token-generation-and-gui | missing |
| quick_task | 260331-lko-all-e2e-tests-should-remove-test-entries | missing |
| quick_task | 260331-o5x-fix-integration-test-configs-add-missing | missing |
| quick_task | 260408-h1j-rename-inner-flashquery-core-folder-to-s | missing |
| quick_task | 260408-hdk-flatten-flashquery-core-project-structur | missing |
| quick_task | 260409-r63-audit-docker-support-in-fqc-check-testin | missing |
| quick_task | 260409-sny-add-docker-compose-syntax-validation-to- | missing |
| quick_task | 260412-e2e-check-e2e-tests | missing |
| quick_task | 260414-ey9-understand-the-state-of-unit-integration | unknown |
| quick_task | 260415-cleanup-consolidate | missing |

**Planned Phase:** 92 (create_directory Handler) — 1 plans — 2026-04-24T19:12:41.838Z
