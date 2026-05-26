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

T-U-036 in `tests/unit/no-coarse-resource-locks.test.ts` statically verifies
that the old coarse `records`, `memory`, and `plugins` lock literals do not
return in first-party source. The record and plugin unit suites also assert that
the Supabase-gated runtime guarantees are backed by always-on unit coverage:
`tests/unit/record-tools.test.ts` checks that `write_record`, `get_record`,
`archive_record`, and `search_records` call `withPluginCoordinationLock` with
the expected `{ pluginId, pluginInstance }`, and `tests/unit/plugin-tools.test.ts`
does the same for `unregister_plugin`.

## Unregister Plugin Concurrency Note

`unregister_plugin` uses the same per-plugin coordination key:

`plugin:${config.instance.id}:${pluginId}:${pluginInstance}`

The unregister cleanup sequence is intentionally serialized by advisory lock but
is not wrapped in a single Postgres transaction. The current implementation uses
Supabase REST calls for each cleanup step:

1. Clear `fqc_documents` ownership for the plugin.
2. Delete plugin-scoped `fqc_memory` rows.
3. Delete `fqc_pending_plugin_review` rows for the plugin.
4. Delete the `fqc_plugin_registry` row.
5. Remove the plugin from in-memory registries and reload manifests.

REQ-023 allows either a per-plugin advisory lock or a transaction for this
sequence. The advisory-lock path was chosen to preserve the existing Supabase
REST implementation and avoid rewriting the unregister flow as raw SQL inside
`withPgClient`. The residual risk is that a mid-sequence failure can leave
intermediate state from prior successful cleanup steps. The handler must return a
`runtime_error` immediately on those failures rather than reporting
`status: "unregistered"`, and operators can safely retry because the cleanup
steps are scoped by plugin and are idempotent for already-cleared/deleted rows.

T-I-045 in `tests/integration/unregister-plugin-races.integration.test.ts`
verifies concurrent unregister calls serialize to one success and one structured
not-found result. `tests/unit/plugin-tools.test.ts` adds a focused mid-sequence
failure regression that forces the memory-delete step to fail and asserts the
handler returns `runtime_error`, does not remove the plugin from memory, and does
not report `status: "unregistered"`.
