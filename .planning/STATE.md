---
gsd_state_version: 1.0
milestone: v2.7
milestone_name: "**For detailed information about completed milestones:**"
status: executing
last_updated: "2026-04-23T12:02:01.994Z"
last_activity: 2026-04-23 -- Phase 90 execution started
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 7
  completed_plans: 5
  percent: 71
---

# FlashQuery Core — State

## Current Position

Phase: 90 (centralize-frontmatter-field-names-into-fm-constants-and-ren) — EXECUTING
Plan: 1 of 7
Status: Executing Phase 90
Last activity: 2026-04-23 -- Phase 90 execution started

```
[########################################] 100% — 6/6 phases
```

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-cleanup-consolidate | Consolidate CLEANUP.md info into README.md and add verification to cleanup script | 2026-04-15 | d142f1a | [260415-cleanup-consolidate](./quick/260415-cleanup-consolidate/) |

## Accumulated Context

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

v2.7 ended at Phase 83. v2.8 runs Phases 84-89.

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

### Known Issues Going Into v2.8

None recorded. Baseline from v2.7 is production-ready.

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
