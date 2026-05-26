---
phase: 157-records-memory-plugins-audit-guards
plan: 02
type: audit
requirement: REQ-023
---

# Phase 157 Records Reconciliation Concurrency Audit

## Scope

This audit covers the record-tool reconciliation preamble:

- `reconcilePluginDocuments`
- `executeReconciliationActions`
- `result.added`
- `fqc_documents` ownership/content-hash updates
- plugin table inserts
- `fqc_pending_plugin_review` inserts and deletes
- the in-memory reconciliation staleness cache

## Decision

Concurrent reconciliation runs are **not assumed idempotent**. The `result.added`
branch can classify the same document as untracked in two callers before either
caller inserts the plugin-table row. The action executor then writes frontmatter,
updates `fqc_documents`, inserts a plugin-table row, and can insert a pending
review. The staleness cache is updated after classification, so it is not a
cross-call mutual exclusion mechanism.

Therefore `write_record`, `get_record`, `archive_record`, and `search_records`
must run the `reconcilePluginDocuments` plus `executeReconciliationActions`
preamble under `withPluginCoordinationLock(config, { pluginId, pluginInstance },
fn)`.

## Scope Boundary

`withPluginCoordinationLock` is keyed as:

`plugin:${config.instance.id}:${pluginId}:${pluginInstance}`

That key is intentionally scoped to one FlashQuery instance, plugin id, and
plugin instance. It is not a global `'records'` lock and it is not a replacement
for the later Phase 158 document advisory locking subsystem.

## Evidence

T-I-044 in `tests/integration/records-reconciliation.integration.test.ts`
dispatches concurrent `write_record` calls against the same plugin instance and
checks that reconciliation produces no duplicate plugin-table row or duplicate
pending-review row for the same `fqc_documents` entry.
