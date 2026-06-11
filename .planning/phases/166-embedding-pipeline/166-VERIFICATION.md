---
phase: 166-embedding-pipeline
verified: 2026-06-11T09:49:49Z
status: passed
score: 27/27 must-haves verified
overrides_applied: 0
---

# Phase 166: Embedding Pipeline Verification Report

**Phase Goal:** All operational data paths — writes, deferred retry, rate-limited provider calls, search, and plugin-table embedding — are wired to the per-entry catalog and produce correct results end-to-end
**Verified:** 2026-06-11T09:49:49Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | With two active catalog entries, document or memory writes trigger parallel embed attempts for both entries; per-entry failures create coexisting pending rows keyed by `embedding_name`; write tools respond with `embedding_deferred:<name>` warnings. | VERIFIED | `scheduleBackgroundEmbeddingsForActiveEntries` loads active entries and `Promise.all`s one `scheduleBackgroundEmbedding` per entry with `embeddingName` in `src/embedding/background-embed.ts:215`; pending upsert conflicts on `(instance_id,target_kind,target_table,target_id,embedding_name)` at `src/embedding/background-embed.ts:358`; deferred warnings are suffixed at `src/embedding/background-embed.ts:211`. Tool paths call the fan-out wrapper from document, memory, compound, and scanner code. |
| 2 | Pending worker retries each entry independently, skips deactivated rows, and deletes retired-entry rows. | VERIFIED | Worker selects `embedding_name` from `fqc_pending_embeds`, resolves the named catalog row, returns `deactivated` or `retired`, and tests cover T-I-040..T-I-043 in `tests/integration/embedding/pending-worker-per-entry.test.ts`; code evidence in `src/embedding/pending-worker.ts:166` and `src/embedding/pending-worker.ts:191`. |
| 3 | Endpoints with `rate_limit.min_delay_ms` enforce call spacing; HTTP 429 retries on the same endpoint before failover; other errors fail over immediately. | VERIFIED | Parser/types preserve rate-limit fields; OpenAI-compatible and Ollama providers normalize rate limits, call `throttleBeforeRequest`, and retry 429s with exponential backoff at `src/embedding/provider.ts:235` and `src/embedding/provider.ts:386`. Focused unit run passed T-U-019..T-U-022. |
| 4 | Catalog search issues per-entry semantic retrieval and returns deterministic RRF fused results; zero-active mixed/semantic modes behave as specified. | VERIFIED | `search` validates `embedding_names`, excludes deactivated entries by default, runs selected retrievers in `Promise.all`, uses RRF k=60, emits `per_embedding_ranks`, and sorts by fused score, rank sum, identifier in `src/mcp/tools/compound.ts:156`, `src/mcp/tools/compound.ts:274`, and `src/mcp/tools/compound.ts:1431`. Focused unit run passed RRF tests; summaries document integration coverage T-I-045..T-I-060. |
| 5 | Plugin registration resolves and freezes `embedding_name`; plugin tables get only that entry's column set/RPC; `write_record` and `search_records` use the plugin's single choice; legacy registrations migrate on first startup. | VERIFIED | Manifest parsing stores `embedding`, `register_plugin` accepts `embedding_name`, resolution handles null/`*`/specific/not-found/deactivated cases, registry stores `embedding_name` and `embedding_resolved_at`, plugin table DDL uses `buildPluginEmbeddingColumnSetDDL`, and records resolve active frozen entries before embedding/search. Evidence: `src/plugins/manager.ts:165`, `src/mcp/tools/plugins.ts:30`, `src/mcp/tools/plugins.ts:66`, `src/mcp/tools/records.ts:85`, `src/mcp/tools/records.ts:365`, `src/mcp/tools/records.ts:827`. |
| 6 | All deactivated-entry refusal paths are complete: write-skip, search-exclude, pending-worker-skip, and plugin-registration-refuse. | VERIFIED | Write/search/pending/plugin code all filter or reject deactivated entries: search returns `unsupported` for explicit deactivated `embedding_names` at `src/mcp/tools/compound.ts:207`; pending resolves deactivated and skips at `src/embedding/pending-worker.ts:216`; plugin registration returns `unsupported` at `src/mcp/tools/plugins.ts:130`; tests listed for T-I-018..T-I-021 and D-102. |
| 7 | Plan truth: core embedding-bearing writes fan out once per active catalog entry and await all per-entry attempts before returning. | VERIFIED | `Promise.all(entries.map(...scheduleBackgroundEmbedding...))` in `src/embedding/background-embed.ts:237`; document/memory/compound/scanner call sites use `scheduleBackgroundEmbeddingsForActiveEntries`. |
| 8 | Plan truth: `fqc_pending_embeds` is keyed by `embedding_name`. | VERIFIED | DDL includes `embedding_name TEXT NOT NULL`, migration fill, old index drop, and new unique index in `src/storage/supabase.ts:450`. |
| 9 | Plan truth: write responses surface `embedding_deferred:<name>` and omit warnings when empty. | VERIFIED | Warning construction in `src/embedding/background-embed.ts:211`; warning dedupe/omit-empty behavior covered by `tests/unit/embedding-write-warnings.test.ts` and focused unit run. |
| 10 | Plan truth: oversized inputs truncate at paragraph/sentence boundaries, stamp `_truncated=true` on success, and retry once at 75% on provider over-limit. | VERIFIED | `truncateEmbeddingInput` prefers paragraph then sentence boundaries in `src/embedding/provider.ts:50`; OpenAI/Ollama paths retry at 75% on over-limit at `src/embedding/provider.ts:176` and `src/embedding/provider.ts:332`; stamping reads metadata in `src/embedding/background-embed.ts:183`. |
| 11 | Plan truth: endpoint `rate_limit` settings parse and persist. | VERIFIED | Config parser accepts `min_delay_ms`, `max_backoff_retries`, `backoff_base_ms` in `src/config/loader.ts:211`; config sync preserves snake_case fields in `src/embedding/embedding-config-sync.ts:35`. |
| 12 | Plan truth: non-429 errors fail over immediately. | VERIFIED | Provider retry loop only handles status 429; otherwise returns the response to fallback at `src/embedding/provider.ts:244` and `src/embedding/provider.ts:395`; T-U-021 passed. |
| 13 | Plan truth: search behavior derives from active catalog count plus mode, with no default embedding knob. | VERIFIED | Search selection uses active `fqc_embeddings` rows and mode in `src/mcp/tools/compound.ts:156`; zero/one/multi behavior is in `src/mcp/tools/compound.ts:1431`. |
| 14 | Plan truth: `embedding_names` omitted/single/multiple/empty semantics are implemented. | VERIFIED | Empty arrays return `invalid_input`, omitted selects active catalog default, filesystem ignores with warning, unknown/deactivated fail as expected in `src/mcp/tools/compound.ts:162`. |
| 15 | Plan truth: RRF uses k=60 and bounded prefetch. | VERIFIED | `RRF_K = 60` and formula `1 / (RRF_K + rank)` in `src/mcp/tools/compound.ts:114` and `src/mcp/tools/compound.ts:278`; T-U-023..T-U-025 passed. |
| 16 | Plan truth: fused results expose deterministic ordering and `per_embedding_ranks`. | VERIFIED | `per_embedding_ranks` populated at `src/mcp/tools/compound.ts:286`; tie sort at `src/mcp/tools/compound.ts:304` and final result sort at `src/mcp/tools/compound.ts:1658`; T-U-026..T-U-029 passed. |
| 17 | Plan truth: partial retriever failures continue when possible and fail when all fail. | VERIFIED | Search records `partial_retriever_failure:<name>` for failed retrievers and returns runtime error when none succeed in `src/mcp/tools/compound.ts:1465`. |
| 18 | Plan truth: plugin manifest `embedding` accepts only null/omitted, `*`, or a specific name. | VERIFIED | Parser rejects non-string non-null and empty string, otherwise stores string/null in `src/plugins/manager.ts:165`; T-U-030..T-U-033 passed. |
| 19 | Plan truth: `register_plugin` accepts optional `embedding_name: string | null` and rejects override `*`. | VERIFIED | Schema and validation in `src/mcp/tools/plugins.ts:30`; T-U-034/T-U-035 passed. |
| 20 | Plan truth: plugin choice resolves at registration time, is stored/frozen, and is not auto-updated by later catalog changes. | VERIFIED | Resolution decision tree in `src/mcp/tools/plugins.ts:66`; registry update/insert stores `embedding_name` and `embedding_resolved_at`; integration test T-I-063 verifies later catalog additions do not auto-grow plugin tables. |
| 21 | Plan truth: plugin tables receive only the resolved entry's column set and `match_records_<table>_<name>` RPC in one DDL pass. | VERIFIED | `buildPluginEmbeddingColumnSetDDL` creates vector/stamping columns, HNSW index, and record RPC in `src/storage/supabase.ts:1185`; register paths call it in DB transactions before registry update. |
| 22 | Plan truth: `write_record` and `search_records` use the plugin's single resolved entry. | VERIFIED | `write_record` calls `scheduleRecordEmbedding` only for `resolvePluginActiveEmbedding` result at `src/mcp/tools/records.ts:365`; `search_records` queries `embedding_${activeEmbedding.name}` at `src/mcp/tools/records.ts:827`. |
| 23 | Plan truth: legacy registrations migrate according to one-active versus multi-active rules without touching legacy singular columns. | VERIFIED | Legacy sentinel is `embedding_resolved_at === null`; migration resolves one active entry or null for zero/multiple active entries in `src/plugins/manager.ts:577` and `src/plugins/manager.ts:603`; tests T-I-067..T-I-069 are present. |
| 24 | Post-review fix: versioned plugin re-registration cannot point registry at missing columns. | VERIFIED | Commit `d265ebe` is HEAD. Version upgrade path applies safe DDL and resolved-entry embedding DDL for all embed-bearing tables inside one transaction before updating registry at `src/mcp/tools/plugins.ts:305`; regression test at `tests/integration/plugin-embedding-columns.test.ts:222` verifies `embedding_analysis`, HNSW index, and `match_records_*_analysis`. Focused integration run passed. |
| 25 | Requirement coverage: REQ-006, REQ-008, REQ-012..REQ-017, REQ-020..REQ-034 are implemented and have matching tests. | VERIFIED | Requirements are mapped in plan frontmatter and test files exist for the product test plan IDs T-I-018..T-I-069, T-U-014..T-U-035, D-100..D-103. Direct code inspection above verified the implementation paths. |
| 26 | Phase code is substantive and wired, not stubs/placeholders. | VERIFIED | Anti-pattern scan found no blocking `TBD`, `FIXME`, or `XXX` markers in modified production/test files; benign `return null`/empty-array guards do not feed visible placeholder behavior. |
| 27 | Verification commands still pass after commit `d265ebe`. | VERIFIED | Ran `npm run typecheck` (passed), focused unit suite (7 files, 24 tests passed), and `npm run test:integration -- tests/integration/plugin-embedding-columns.test.ts` (1 file, 4 tests passed). |

**Score:** 27/27 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/embedding/background-embed.ts` | Per-entry write fan-out, stamping, deferred warnings, pending upsert | VERIFIED | Substantive and wired by document, memory, compound, and scanner handlers. |
| `src/embedding/pending-worker.ts` | Per-entry pending retry and catalog-state handling | VERIFIED | Selects `embedding_name`, resolves catalog entry state, and updates/deletes rows appropriately. |
| `src/storage/supabase.ts` | Pending queue schema, plugin column set/RPC helpers, plugin registry columns | VERIFIED | Contains pending queue `embedding_name`, new unique index, plugin registry `embedding_name`, and per-entry plugin DDL/RPC generation. |
| `src/embedding/provider.ts` | Truncation, length metadata, rate limiting, 429 retry | VERIFIED | Implements boundary truncation, metadata, 75% retry, min-delay, 429 backoff, and rate-limit events. |
| `src/mcp/tools/compound.ts` | Catalog-aware `search`, `embedding_names`, RRF, partial failure | VERIFIED | Search handler is wired to catalog entries and response envelope metadata. |
| `src/plugins/manager.ts` | Manifest parsing and legacy plugin migration | VERIFIED | Parses `embedding`, loads frozen registry choice, and migrates legacy rows using catalog state. |
| `src/mcp/tools/plugins.ts` | `register_plugin` override/resolution, plugin DDL, re-registration fix | VERIFIED | DDL is applied before registry updates; post-review fix present. |
| `src/mcp/tools/records.ts` | Plugin single-entry `write_record`/`search_records` routing | VERIFIED | Resolves frozen active entry and embeds/searches one plugin entry only. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Write tools | Active catalog entries | `scheduleBackgroundEmbeddingsForActiveEntries` | WIRED | Core write call sites import and call the fan-out helper. |
| Write failures | `fqc_pending_embeds` | `upsertPendingEmbedding` | WIRED | Upsert includes `embedding_name` and conflict key. |
| Pending worker | Catalog entry provider chain | `resolvePendingEmbeddingEntry` + `createEmbeddingProviderForCatalogEntry` | WIRED | Worker uses row `embedding_name` to pick entry/endpoints. |
| Provider metadata | Row stamping | `getLastEmbeddingMetadata` -> `updateTargetEmbedding` | WIRED | `_truncated` stamp follows provider metadata on successful writes. |
| Search tool | Per-entry RPC/search fusion | `runEmbeddingRetriever` + RRF | WIRED | Selected entries are queried in parallel and fused app-side. |
| Plugin registration | Plugin table DDL/RPC | `buildPluginEmbeddingColumnSetDDL` | WIRED | New, same-version, version-upgrade, and legacy migration paths call DDL for resolved entries. |
| Plugin registry | `write_record`/`search_records` | `resolvePluginActiveEmbedding` | WIRED | Frozen registry value controls single-entry record embedding/search. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `background-embed.ts` | `entries` | `selectActiveEmbeddingEntries` from `fqc_embeddings` | Yes | FLOWING |
| `pending-worker.ts` | `row.embedding_name` | `fqc_pending_embeds` selected rows | Yes | FLOWING |
| `provider.ts` | endpoint config | parsed config/catalog endpoints | Yes | FLOWING |
| `compound.ts` | `catalogEntries` / selected retrievers | DB catalog lookup and provider/RPC calls | Yes | FLOWING |
| `plugins.ts` | `embeddingResolution.entry` | catalog query and manifest/operator input | Yes | FLOWING |
| `records.ts` | `entry.embedding_name` | `fqc_plugin_registry` loaded entry | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| TypeScript compiles | `npm run typecheck` | `tsc --noEmit` exited 0 | PASS |
| Unit coverage for warnings, truncation, rate limit, RRF, plugin parsing/override | `npm run test:unit -- tests/unit/embedding-write-warnings.test.ts tests/unit/embedding-truncation.test.ts tests/unit/embedding-rate-limit.test.ts tests/unit/rrf-fusion.test.ts tests/unit/rrf-tie-break.test.ts tests/unit/plugin-manifest-embedding.test.ts tests/unit/register-plugin-embedding-param.test.ts` | 7 files, 24 tests passed | PASS |
| Post-review plugin re-registration regression | `npm run test:integration -- tests/integration/plugin-embedding-columns.test.ts` | 1 file, 4 tests passed | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| None | Probe discovery found no `scripts/*/tests/probe-*.sh` and no phase-declared probes | Not applicable | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| REQ-006 | 166-01, 166-03, 166-04 | Deactivated entries refused/skipped/excluded across operations | SATISFIED | Search, pending worker, and plugin registration code paths verified; tests T-I-018..T-I-021 and D-102 present. |
| REQ-008 | 166-04 | Plugin-table per-entry column sets | SATISFIED | `buildPluginEmbeddingColumnSetDDL`; T-I-061..T-I-063 plus post-review regression. |
| REQ-012 | 166-01 | Parallel inline attempt per active entry | SATISFIED | `Promise.all` fan-out and T-I-034/T-I-035. |
| REQ-013 | 166-01 | Per-entry pending queue | SATISFIED | DDL/index/upsert verified; T-I-037..T-I-039. |
| REQ-014 | 166-01 | Write warning surface | SATISFIED | `embedding_deferred:<name>` warning construction; T-U-014/T-U-015 passed. |
| REQ-015 | 166-01 | Pending-worker per-entry retry | SATISFIED | Worker selection/resolution/stamping verified; T-I-040..T-I-043. |
| REQ-016 | 166-01 | Oversized-input truncation | SATISFIED | Provider truncation/retry/stamping verified; T-U-016..T-U-018, T-I-044. |
| REQ-017 | 166-02 | Rate limit and 429 backoff | SATISFIED | Parser/provider implementation verified; T-U-019..T-U-022 passed. |
| REQ-020 | 166-03 | Catalog-state-derived search behavior | SATISFIED | Search mode matrix verified; T-I-045..T-I-049. |
| REQ-021 | 166-04 | Plugin-table per-entry RPCs | SATISFIED | `match_records_<table>_<name>` DDL verified; regression test confirms RPC for re-registration. |
| REQ-022 | 166-03 | `embedding_names` parameter | SATISFIED | Validation/selection verified; T-I-052..T-I-055. |
| REQ-023 | 166-03 | RRF fusion | SATISFIED | RRF formula and prefetch verified; T-U-023..T-U-025 passed. |
| REQ-024 | 166-03 | Deterministic ordering/tie-breaks | SATISFIED | Tie-break sort verified; T-U-026..T-U-029 passed. |
| REQ-025 | 166-03 | Zero-active semantic unsupported | SATISFIED | `unsupportedZeroActiveSemantic`; T-I-056. |
| REQ-026 | 166-03 | Zero-active mixed filesystem-only | SATISFIED | `embedding_unavailable` path; T-I-057/T-I-058. |
| REQ-027 | 166-03 | Partial retriever failure | SATISFIED | Partial/all failure branches verified; T-I-059/T-I-060. |
| REQ-028 | 166-04 | Plugin manifest embedding values | SATISFIED | Parser verified; T-U-030..T-U-033 passed. |
| REQ-029 | 166-04 | `register_plugin.embedding_name` parameter | SATISFIED | Schema/validation verified; T-U-034/T-U-035 passed. |
| REQ-030 | 166-04 | Registration resolution rules | SATISFIED | Resolution function verified; D-100..D-102 present. |
| REQ-031 | 166-04 | Plugin schema implications | SATISFIED | Plugin DDL creates only resolved entry columns/RPCs; T-I-061..T-I-063. |
| REQ-032 | 166-04 | Plugin write/search routing | SATISFIED | `records.ts` single-entry paths verified; T-I-064..T-I-066. |
| REQ-033 | 166-04 + post-review fix | Plugin re-registration switches entries safely | SATISFIED | `d265ebe` fix verified in code; integration regression passed. |
| REQ-034 | 166-04 | First-startup legacy plugin registration migration | SATISFIED | Migration code verified; T-I-067..T-I-069 present. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| None blocking | - | No `TBD`, `FIXME`, or `XXX` markers in phase-touched source/test files | INFO | Benign guard returns (`return null`, `return []`) are control-flow cases, not stubs. |

### Human Verification Required

None. The phase is CLI/MCP/database behavior with automated code and test verification; no visual or external-service-only UAT item is required for this phase.

### Gaps Summary

No gaps found. The post-review plugin re-registration blocker is fixed in commit `d265ebe` and verified by both code inspection and the targeted integration regression.

---

_Verified: 2026-06-11T09:49:49Z_
_Verifier: the agent (gsd-verifier)_
