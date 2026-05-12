# Phase 125: Unified Search + Memory Consolidation - Research

**Researched:** 2026-05-12
**Status:** Complete

## Research Question

What do we need to know to plan Phase 125 well?

Phase 125 must consolidate search and memory MCP tools while preserving existing behavior through the final tool contracts from the MCP Tool Consolidation product docs.

## Canonical Product References

Downstream planning, implementation, review, and verification agents MUST read these first:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`

Key product sections:

- Requirements §4.12 `search`
- Requirements §4.18 `write_memory`
- Requirements entries for `get_memory`, `archive_memory`, `search_memory`, `list_memories`, `save_memory`, and `update_memory`
- Test Plan §4.1 `search`
- Test Plan §4.3 `write_memory`
- Test Plan standard-tool rows for `get_memory` and `archive_memory`
- Test Plan §7 scenario migration and §8 test-file migration guidance

## Phase Boundary

Roadmap Phase 125 requirements:

- SRCH-01 through SRCH-06
- MEM-01 through MEM-04

Phase 128 owns MEM-05 and final legacy surface removal/audit. Phase 125 should make final tools current and migrate coverage, but only remove legacy names where product docs and roadmap explicitly permit doing so without stealing Phase 128's final audit work.

## Current Code State

### Phase 124 Gap-Fix Baseline

Phase 124 should be treated as complete for planning purposes. Some early `124-01` through `124-04` summaries still describe partial completion, but the later gap-fix artifacts supersede those notes:

- `.planning/phases/124-document-write-primitives/TRACEABILITY.md` marks DOC-03 through DOC-08 complete with gap-fix gates passed on 2026-05-12.
- `.planning/phases/124-document-write-primitives/124-VALIDATION.md` records focused unit, integration, E2E, directed scenario, YAML scenario, and build gates as green.
- `tests/integration/write-document.integration.test.ts` now exists and covers Phase 124 write/insert/replace/apply-tags integration evidence.
- `tests/e2e/protocol.test.ts` includes Phase 124 final-tool protocol coverage.
- `apply_tags` supports final ordered `targets: [{ entity_type, identifier }]` and JSON results, while legacy `identifiers` / `memory_id` compatibility remains temporarily for migration.
- `apply_tags` now rejects a call that supplies targets but neither `add_tags` nor `remove_tags`, returning expected `invalid_input` with `details.requires: ["add_tags","remove_tags"]`.
- `write_document` now rejects conflicting `tags` and `frontmatter.fq_tags` at the handler boundary through `resolveTagsFrontmatterConflict`; tests should use either top-level `tags` or matching `frontmatter.fq_tags`, not divergent values.
- `write_document` create now rejects symlinked vault path segments with an expected `invalid_input` envelope, and integration evidence verifies it does not write outside the vault.
- `insert_in_doc` and `replace_doc_section` are locked document writes when locking is enabled. Both synchronously refresh `fqc_documents.content_hash` / `updated_at` from the raw post-write file before background embedding.
- `replace_doc_section` now fails loudly if the expected `fqc_documents` row is not updated. Unit mocks for this path need to support `.update(...).eq(...).eq(...).select('id').maybeSingle()`.
- `tests/integration/write-document.integration.test.ts` now asserts raw-file `content_hash` parity after `write_document`, `insert_in_doc`, and `replace_doc_section`.

Phase 125 plans should therefore reuse Phase 124 final primitives and tests as stable analogs, not assume integration/E2E coverage is missing. Search integration setup should not manually patch `fqc_documents` rows or depend on a targeted scan after Phase 124 writes; the current contract is that document write primitives leave the DB row fresh enough for search filtering and identification. Semantic embedding refresh remains background work, so tests that need deterministic immediate visibility should use filesystem/list-mode paths or explicit embedding stubs.

### Search

Current search behavior is split:

- `src/mcp/tools/documents.ts`
  - `searchDocumentsSemantic(config, query, opts)` shared helper.
  - `search_documents` supports `mode: "filesystem" | "semantic" | "mixed"` and title/path/tag search, but returns key-value prose.
  - Filesystem mode uses `listMarkdownFiles` + `parseDocMeta`.
  - Semantic mode uses `match_documents`.
  - Mixed mode currently appends semantic then filesystem results rather than producing the final unified JSON envelope.

- `src/mcp/tools/compound.ts`
  - `search_all` combines documents and memories in separate markdown sections.
  - Uses `searchDocumentsSemantic`, `searchMemoriesSemantic`, `listMarkdownFiles`, and `parseDocMeta`.
  - Falls back to document filesystem search when embeddings are unavailable.
  - Memory fallback behavior is prose and not the final canonical warning/error envelope.

- `src/mcp/tool-metadata.ts`
  - `search` already exists as `future('search', ['doc-read', 'memory'], 'read-only', D.search)`.
  - Legacy search names are still current.
  - `D.search` description is a placeholder and must be replaced with product Requirements §4.12 literal description.

### Memory

Current memory behavior lives in `src/mcp/tools/memory.ts`:

- `save_memory`
  - Inserts into `fqc_memory` with `content`, `tags`, `plugin_scope`, `status: 'active'`, and `embedding: null`.
  - Background embeds after response.
  - Returns prose.

- `search_memory`
  - Uses `searchMemoriesSemantic`.
  - Falls back to tag DB query for lenient thresholds when embeddings fail.
  - Returns key-value prose.

- `update_memory`
  - Inserts a new row with incremented `version` and `previous_version_id`.
  - Does not mark prior row `is_latest:false` because the column does not exist yet.
  - Does not reject updates to non-latest memories.
  - Returns prose.

- `list_memories`
  - Lists active memories by tags with a truncated preview.
  - Does not filter on latest-chain state because `is_latest` does not exist yet.
  - Returns key-value prose.

- `get_memory`
  - Already accepts `memory_ids: string | string[]`.
  - Returns key-value prose and sets `isError:true` when all requested IDs are missing.
  - Does not support final `include: ["content", "tags_full"]`.

- `archive_memory`
  - Accepts singular `memory_id`, not `memory_ids`.
  - Sets `status:'archived'` and adds `#status/archived`.
  - Does not set `archived_at`.
  - Does not archive a full version chain.
  - Returns prose.

### Schema

`src/storage/supabase.ts` defines `fqc_memory` with:

- `version INTEGER DEFAULT 1`
- `previous_version_id UUID`
- no `is_latest`
- no `archived_at`

Phase 125 requires both `is_latest` and `archived_at`. The plan must include a blocking schema task:

- Add `is_latest BOOLEAN DEFAULT true` to `fqc_memory`.
- Add `archived_at TIMESTAMPTZ` to `fqc_memory`.
- Add indexes useful for visibility: `(instance_id, status, is_latest)` and/or standalone `is_latest`, plus `archived_at` only if query plans need it.
- Backfill existing active rows so latest semantics are deterministic. A safe migration can set all existing rows to true initially, then mark rows with a child in `previous_version_id` as false.
- Update match/list queries to include `is_latest = true` by default.
- Update tests in `tests/unit/supabase.test.ts` / schema-migration coverage as appropriate.

Because this repo uses inline idempotent DDL in `buildSchemaDDL`, the schema task belongs before memory tool work. The GSD schema gate should mark this as `[BLOCKING]`; build/types alone cannot prove live DB shape.

### Response Helpers

`src/mcp/utils/response-formats.ts` already provides the Phase 121 helpers:

- `jsonToolResult`
- `jsonExpectedError`
- `jsonRuntimeError`
- `documentIdentification`
- `memoryIdentification`
- `batchResult`
- `withWarnings`

Phase 125 should reuse these rather than constructing JSON ad hoc. `memoryIdentification` already has the required base block:

```typescript
{
  memory_id,
  content_preview,
  tags,
  plugin_scope,
  created_at,
  updated_at,
}
```

The phase likely needs memory-specific helper functions for:

- content preview construction
- include payload handling
- expected error envelope construction
- ordered batch result assembly
- version-chain fetch/archive helpers

Recommended file: `src/mcp/utils/memory-output.ts` or `src/mcp/utils/memory-results.ts`, following `src/mcp/utils/document-write.ts` and `document-output.ts`.

## Implementation Approach

### 1. Foundation and schema

Create the Phase 125 traceability ledger first, then add `fqc_memory.is_latest` and `fqc_memory.archived_at` to the schema.

This is the right first slice because `write_memory`, `get_memory`, `archive_memory`, and `search` all depend on latest/archived semantics. Without schema support, tests can pass through old status-only behavior while violating the product contract.

### 2. Memory final tools

Implement `write_memory` and migrate `get_memory` / `archive_memory` before unified `search`:

- `write_memory(mode:"create")` can reuse `save_memory` internals but returns JSON and sets `is_latest:true`.
- `write_memory(mode:"update")` must run in one transactional sequence: verify target exists, verify `is_latest:true`, insert new row with `previous_version_id`, mark previous row false, return the new memory identification block plus version metadata.
- `get_memory` should read by explicit ID and not require `is_latest:true`; direct previous-version retrieval is required.
- `archive_memory` should resolve the full chain and set status/archived_at consistently across the chain.

### 3. Unified search

Implement `search` as the final public wrapper after memory latest/archived semantics exist.

Recommended internal shape:

- `src/mcp/utils/search.ts` or `src/mcp/utils/search-results.ts`
- pure functions for validation, mode resolution, entity-type resolution, dedupe/merge/sort/limit
- document adapter using `searchDocumentsSemantic`, `listMarkdownFiles`, `parseDocMeta`, and `documentIdentification`
- memory adapter using `searchMemoriesSemantic` plus DB list-mode/latest filters and `memoryIdentification`

The tool can initially live in `src/mcp/tools/compound.ts` near `search_all`, but extracting helpers keeps unit tests focused and prevents the handler from becoming a long conditional block.

Final output envelope:

```json
{
  "query": "planning",
  "entity_types": ["documents", "memories"],
  "mode": "mixed",
  "total": 2,
  "warnings": ["memory_category_disabled"],
  "results": []
}
```

### 4. Tests and scenarios

Test Plan §3.1 requires phase-local traceability rows. For Phase 125, instantiate:

- `search` -> `tests/unit/search.test.ts`, `tests/integration/search.integration.test.ts`, E2E protocol search round trips, D-search-* and INT-search-* rows
- `write_memory` -> `tests/unit/write-memory.test.ts`, `tests/integration/write-memory.integration.test.ts`, E2E write/search memory round trip, D-wmem-* and INT-wmem-* rows
- `get_memory` / `archive_memory` -> existing or new memory unit/integration/E2E slices plus directed/integration coverage rows

Existing test files to port:

- `tests/unit/search-all.test.ts`
- `tests/unit/search-documents.test.ts`
- `tests/unit/search-memory-list.test.ts`
- `tests/unit/memory-tools.test.ts`
- `tests/unit/get-memory.test.ts`
- `tests/integration/search-all.integration.test.ts`
- `tests/integration/save-memory-tags.test.ts`
- `tests/integration/write-document.integration.test.ts` as the current Phase 124 integration analog for JSON write/read/edit assertions.
- E2E memory/search portions of `tests/e2e/protocol.test.ts`
- scenario ledgers in `tests/scenarios/directed/DIRECTED_COVERAGE.md` and `tests/scenarios/integration/INTEGRATION_COVERAGE.md`

Phase 125 scenario/test setup that uses Phase 124 tools must obey the gap-fixed contracts: `write_document` fixture creation should avoid divergent `tags` and `frontmatter.fq_tags`, and `apply_tags` calls must include at least one operation list (`add_tags` or `remove_tags`).
If setup mutates documents with `insert_in_doc` or `replace_doc_section`, assert against current file/row state rather than compensating with manual `fqc_documents` updates; Phase 124 now owns synchronous hash freshness for those tools.

## Validation Architecture

Phase 125 is Nyquist-applicable because it changes high-risk tool contracts, search ranking/visibility behavior, schema shape, and scenario coverage.

Minimum focused gates:

- `npm test -- tests/unit/supabase.test.ts tests/unit/response-formats.test.ts`
- `npm test -- tests/unit/write-memory.test.ts tests/unit/get-memory.test.ts tests/unit/memory-tools.test.ts tests/unit/tool-metadata.test.ts`
- `npm test -- tests/unit/search.test.ts tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts`
- `npm run test:integration -- tests/integration/write-memory.integration.test.ts tests/integration/search.integration.test.ts`
- `npm run test:e2e -- tests/e2e/protocol.test.ts`
- directed scenario command after ledger updates
- integration scenario command after YAML ports
- `npm run build`

External Supabase / embedding-dependent tests may skip gracefully only when the existing test helpers mark them skipped. Any skip must be recorded in plan summaries with the missing dependency.

## Key Risks

| Risk | Why It Matters | Mitigation |
|------|----------------|------------|
| Schema drift | `is_latest` and `archived_at` are required but absent. | Put schema migration in wave 1 with blocking push/test evidence. |
| Search behavior regression | Current search has several legacy surfaces with subtly different fallbacks. | Port legacy tests into final `search` tests before deleting/renaming them. |
| Ranking/list-mode ambiguity | Empty query/list-mode and mixed merge behavior are easy to underspecify. | Unit-test validation and pure merge functions before integration tests. |
| Memory update race | Latest-version updates require transactional behavior. | Use DB transaction/RPC or a single locked critical section; test non-latest conflict. |
| Phase 128 scope creep | Removing all legacy tools now can make final audit harder. | Make final tools current and migrate tests, but leave broad legacy removal/audit to Phase 128 unless product docs require immediate absence. |

## Recommended Plan Shape

1. `125-01` Foundation: traceability, memory schema, response/helper scaffolding.
2. `125-02` Memory writer/read/archive final contracts.
3. `125-03` Unified search implementation and metadata exposure.
4. `125-04` Integration/E2E search-memory workflows.
5. `125-05` Directed/integration scenario ledger and test ports.
6. `125-06` Final validation, build, and traceability closure.

## Research Complete

The phase is plannable. The main planning constraint is to sequence schema/latest semantics before final memory/search behavior, and to preserve the user-supplied product docs as mandatory downstream references in every plan.
