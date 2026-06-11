---
phase: 166-embedding-pipeline
reviewed: 2026-06-11T09:33:34Z
depth: deep
files_reviewed: 58
files_reviewed_list:
  - src/config/loader.ts
  - src/config/types.ts
  - src/embedding/background-embed.ts
  - src/embedding/embedding-config-sync.ts
  - src/embedding/pending-worker.ts
  - src/embedding/provider.ts
  - src/mcp/tools/compound.ts
  - src/mcp/tools/documents/write.ts
  - src/mcp/tools/memory.ts
  - src/mcp/tools/plugins.ts
  - src/mcp/tools/records.ts
  - src/mcp/utils/document-resolver-primitives.ts
  - src/mcp/utils/response-formats.ts
  - src/plugins/manager.ts
  - src/services/scanner.ts
  - src/storage/supabase.ts
  - tests/config/vitest.integration.config.ts
  - tests/helpers/test-env.ts
  - tests/integration/batch-envelope.integration.test.ts
  - tests/integration/compound-tools.integration.test.ts
  - tests/integration/embedding/column-set-creation.test.ts
  - tests/integration/embedding/deactivated-operations.test.ts
  - tests/integration/embedding/drift-detection.test.ts
  - tests/integration/embedding/embedding-names-param.test.ts
  - tests/integration/embedding/multi-tenancy.test.ts
  - tests/integration/embedding/parallel-per-entry-attempt.test.ts
  - tests/integration/embedding/partial-retriever-failure.test.ts
  - tests/integration/embedding/pending-queue-per-entry.test.ts
  - tests/integration/embedding/pending-worker-per-entry.test.ts
  - tests/integration/embedding/search-mode-matrix.test.ts
  - tests/integration/embedding/search-test-helpers.ts
  - tests/integration/embedding/search-zero-active-mixed.test.ts
  - tests/integration/embedding/search-zero-active-semantic.test.ts
  - tests/integration/embedding/truncation-reactive-fallback.test.ts
  - tests/integration/macro-tool-dispatch.test.ts
  - tests/integration/plugin-embedding-columns.test.ts
  - tests/integration/plugin-legacy-registration-migration.test.ts
  - tests/integration/plugin-reconciliation.integration.test.ts
  - tests/integration/plugin-record-embedding-helpers.ts
  - tests/integration/plugin-search-records-semantic.test.ts
  - tests/integration/plugin-write-record-embed.test.ts
  - tests/integration/records-reconciliation.integration.test.ts
  - tests/integration/refused-write-envelope.integration.test.ts
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
  - tests/scenarios/directed/testcases/plugin_embedding_scenario_helpers.py
  - tests/scenarios/directed/testcases/test_plugin_re_register_switch_entry.py
  - tests/scenarios/directed/testcases/test_plugin_registration_deactivated.py
  - tests/scenarios/directed/testcases/test_plugin_registration_resolution.py
  - tests/scenarios/directed/testcases/test_plugin_registration_specific_not_found.py
  - tests/unit/embedding-rate-limit.test.ts
  - tests/unit/embedding-truncation.test.ts
  - tests/unit/embedding-write-warnings.test.ts
  - tests/unit/embedding-yaml-parser.test.ts
  - tests/unit/plugin-manifest-embedding.test.ts
  - tests/unit/register-plugin-embedding-param.test.ts
  - tests/unit/rrf-fusion.test.ts
  - tests/unit/rrf-tie-break.test.ts
  - tests/unit/test-env-pooler.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
resolved:
  - CR-01
  - WR-01
---

# Phase 166: Code Review Report

**Reviewed:** 2026-06-11T09:33:34Z
**Depth:** deep
**Files Reviewed:** 58
**Status:** clean after post-review fixes

## Summary

Reviewed Phase 166 source changes from `14cf991` through `2a7c3aa` against the Phase 166 plans, summaries, AGENTS.md, and the external embedding requirements/test plan. The main implementation paths are present, but plugin re-registration has a correctness hole when the embedding switch happens during a plugin schema-version migration.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Versioned plugin re-registration can point the registry at columns that were never created

**File:** `src/mcp/tools/plugins.ts:237`
**Issue:** The version-migration branch updates `fqc_plugin_registry.embedding_name` to the newly resolved entry at lines 358-368, but it only runs plugin embedding DDL for newly added tables inside the `safe` change loop at lines 305-336. Existing embed-bearing tables never receive the new `embedding_<Y>` column set or `match_records_<table>_<Y>` RPC when a plugin is re-registered with both a schema-version change and a new `embedding_name`. After that update, `write_record`/`search_records` resolve the frozen entry from the registry and target `embedding_Y`, so existing tables can fail semantic search with missing-column errors or defer every write because `updateTargetEmbeddingWithPg` cannot update the absent column. This violates REQ-033 criteria 1, 3, and 4.
**Fix:** After resolving a new plugin embedding for any existing registration, run `buildPluginEmbeddingColumnSetDDL` for every existing embed-bearing table, not only `table_added` safe changes. Do it before updating the registry/in-memory entry, inside a transaction with the safe schema DDL, so the frozen registry value is never ahead of table DDL.

```ts
if (resolvedEmbedding) {
  for (const table of schema.tables) {
    if (!table.embed_fields || table.embed_fields.length === 0) continue;
    const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
    await pgClient.query(buildPluginEmbeddingColumnSetDDL(fullTableName, resolvedEmbedding));
  }
}
```

**Resolution:** Fixed in post-review commit. Version-upgrade registration now applies safe schema DDL and resolved-entry embedding DDL for all embed-bearing tables in one transaction before updating `fqc_plugin_registry.embedding_name`. Added integration coverage that re-registers an existing plugin from `primary` to `analysis` during a schema-version upgrade and verifies the existing table has the new column set, HNSW index, and `match_records_*_analysis` RPC.

## Warnings

### WR-01: Re-registration coverage checks only the response, not the post-switch write/search contract

**File:** `tests/scenarios/directed/testcases/test_plugin_re_register_switch_entry.py:57`
**Issue:** The D-103 scenario re-registers from `primary` to `analysis` and asserts only that the second `register_plugin` response returns `"embedding_name": "analysis"`. It never verifies that `analysis` columns/RPCs exist, that `write_record` targets only `analysis`, or that `search_records` uses `embedding_analysis`. This missed CR-01's versioned re-registration path and does not cover REQ-033 criteria 3-4.
**Fix:** Extend coverage with an integration or directed scenario that re-registers while changing schema version, then writes/searches a record and asserts the new entry column/RPC is used. Also add a same-version re-registration assertion for actual table columns, not only the response payload.

**Resolution:** Addressed by the same integration regression test for versioned re-registration. Existing directed scenario coverage remains response-oriented, while integration coverage now proves the post-switch table/RPC contract that directed tests cannot inspect directly.

---

_Reviewed: 2026-06-11T09:33:34Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
