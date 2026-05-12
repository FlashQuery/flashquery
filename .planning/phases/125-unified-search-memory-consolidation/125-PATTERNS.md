# Phase 125 Pattern Map

**Phase:** 125 - Unified Search + Memory Consolidation
**Created:** 2026-05-12

## Mandatory Product References

Executors must read these before implementation:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`

## Files To Create Or Modify

| Target | Role | Closest Existing Analog | Notes |
|--------|------|-------------------------|-------|
| `src/storage/supabase.ts` | Memory schema DDL | Existing `fqc_documents.archived_at` migration in same file | Add `is_latest`, `archived_at`, and indexes idempotently. |
| `src/utils/schema-migration.ts` | Schema constant/tests if used | `DOCUMENT_ARCHIVED_AT_MIGRATION_SQL` | Add memory migration constants only if tests need stable SQL snippets. |
| `src/mcp/utils/memory-output.ts` | Memory validation/output helpers | `src/mcp/utils/document-write.ts`, `src/mcp/utils/document-output.ts` | Build memory identification, include handling, expected errors, version metadata. |
| `src/mcp/utils/search-results.ts` | Search validation/merge helpers | `src/mcp/utils/response-formats.ts`, `src/mcp/tools/compound.ts` | Keep merge/dedupe/sort unit-testable outside handler. |
| `src/mcp/tools/memory.ts` | Final memory tools | Existing legacy memory handlers in same file | Register `write_memory`, migrate `get_memory`, migrate `archive_memory`; keep broad final removal for Phase 128. |
| `src/mcp/tools/compound.ts` | Unified `search` registration | Existing `search_all` handler | Add final `search` or replace current `search_all` registration with final tool while preserving legacy status per plan scope. |
| `src/mcp/tool-metadata.ts` | Tool exposure metadata | Phase 121-124 metadata transitions | Promote `search` and `write_memory`; update descriptions for memory/search tools. |
| `tests/unit/write-memory.test.ts` | Memory write unit coverage | `tests/unit/write-document.test.ts`, `tests/unit/memory-tools.test.ts` | New final-tool unit suite. |
| `tests/unit/search.test.ts` | Search unit coverage | `tests/unit/search-all.test.ts`, `tests/unit/search-documents.test.ts`, `tests/unit/search-memory-list.test.ts` | Port old tests and add pure merge/list-mode tests. |
| `tests/integration/write-memory.integration.test.ts` | Memory persistence integration | `tests/integration/save-memory-tags.test.ts` | New or renamed integration suite. |
| `tests/integration/search.integration.test.ts` | Search integration | `tests/integration/search-all.integration.test.ts` | New final unified search integration suite. |
| `tests/integration/write-document.integration.test.ts` | Existing Phase 124 integration analog | Itself | Use as the current JSON envelope, symlink rejection, and document-write DB freshness analog. |
| `tests/unit/advanced-document-tools.test.ts` | Existing section-write mock analog | `replace_doc_section` tests | Mock `fqc_documents` update chains with `.select('id').maybeSingle()` when exercising section writes. |
| `tests/unit/compound-tools.test.ts` | Existing apply_tags validation analog | `apply_tags rejects targets when neither add_tags nor remove_tags is provided` | Use when Phase 125 scenarios need tag setup through `apply_tags`. |
| `tests/unit/write-document.test.ts` | Existing write_document validation analog | `resolveTagsFrontmatterConflict` tests | Use when Phase 125 document fixtures include both `tags` and frontmatter. |
| `tests/e2e/protocol.test.ts` | MCP round trips | Existing protocol memory/search tests | Update/add final tool round trips. |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | Directed coverage ledger | Phase 124 ledger edits | Update before scenario files. |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | YAML coverage ledger | Phase 124 ledger edits | Update before scenario files. |
| `.planning/phases/125-unified-search-memory-consolidation/TRACEABILITY.md` | Evidence ledger | `.planning/phases/124-document-write-primitives/TRACEABILITY.md` | Create first before code changes. |

## Existing Patterns

### JSON Tool Results

Use `src/mcp/utils/response-formats.ts`:

```typescript
jsonToolResult(payload);
jsonExpectedError({ error: 'invalid_input', message, identifier, details });
memoryIdentification({ memory_id, content_preview, tags, plugin_scope, created_at, updated_at });
documentIdentification({ identifier, title, path, fq_id, modified, chars });
withWarnings(payload, warnings);
```

Expected validation/not-found/conflict/unsupported results use `jsonExpectedError` and `isError:false`. Unexpected DB/FS/runtime failures use `jsonRuntimeError` / `isError:true`.

### Document Search Building Blocks

Use existing exports from `src/mcp/tools/documents.ts`:

```typescript
searchDocumentsSemantic(config, query, { tags, tagMatch, limit });
listMarkdownFiles(vaultRoot, extensions, projectPrefix?);
parseDocMeta(vaultRoot, relativePath);
```

`search_documents` currently contains title/path/tag filesystem logic and semantic/mixed logic. Reuse the behavior but not the key-value output.

### Memory Search Building Blocks

Use existing export from `src/mcp/tools/memory.ts`:

```typescript
searchMemoriesSemantic(config, query, { tags, tagMatch, threshold, limit });
```

List-mode memory search should query `fqc_memory` directly with:

- `instance_id = config.instance.id`
- `status = 'active'`
- `is_latest = true`
- tag filters via `overlaps` / `contains`
- `order('created_at', { ascending: false })`

### Tool Metadata Transition

`src/mcp/tool-metadata.ts` already has future entries:

```typescript
future('search', ['doc-read', 'memory'], 'read-only', D.search)
future('write_memory', ['memory'], 'read-write', D.writeMemory)
```

Phase 125 should promote final tools to current/final exposure. Legacy names remain broad-removal candidates for Phase 128 unless a plan explicitly scopes a narrow absence assertion after coverage is ported.

### Schema DDL

`src/storage/supabase.ts` uses idempotent DDL inside `buildSchemaDDL(dimensions)`.

Existing document archived pattern:

```sql
archived_at TIMESTAMPTZ
ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
```

Memory should follow the same style:

```sql
ALTER TABLE IF EXISTS fqc_memory ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS fqc_memory ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
```

Backfill pattern should be idempotent and safe for existing version chains:

```sql
UPDATE fqc_memory SET is_latest = true WHERE is_latest IS NULL;
UPDATE fqc_memory parent
SET is_latest = false
WHERE EXISTS (
  SELECT 1 FROM fqc_memory child
  WHERE child.previous_version_id = parent.id
);
```

### Test Patterns

Use the mock-server capture helper pattern from existing unit tests:

- `tests/unit/write-document.test.ts`
- `tests/unit/memory-tools.test.ts`
- `tests/unit/search-all.test.ts`
- `tests/unit/search-memory-list.test.ts`

Use integration helpers from:

- `tests/helpers/supabase.ts`
- `tests/helpers/mcp-server-fixture.ts`
- `tests/integration/write-document.integration.test.ts`
- `tests/integration/save-memory-tags.test.ts`
- `tests/integration/search-all.integration.test.ts`

Use E2E protocol parsing pattern from:

- `tests/e2e/protocol.test.ts`

Final Phase 125 E2E additions should parse JSON envelopes with `JSON.parse(getText(result))`, following Phase 107/124 JSON assertions.

### Phase 124 Document Freshness Contract

Phase 124 section writes are now part of the stable baseline:

- `write_document`, `insert_in_doc`, and `replace_doc_section` refresh `fqc_documents.content_hash` from raw post-write file bytes.
- `insert_in_doc` and `replace_doc_section` acquire/release the document write lock when locking is enabled.
- `replace_doc_section` treats "no DB row updated" as a runtime failure, so tests should seed/resolve a real tracked document row before calling it.
- Immediate deterministic search assertions should use filesystem/list-mode paths or controlled embedding stubs; background re-embedding is still asynchronous.

## Pitfalls

- Do not build new output shapes by string concatenation; use JSON helpers.
- Do not keep `get_memory` all-missing as `isError:true`; expected not-found behavior must use structured envelopes.
- Do not allow `write_memory(mode:"update")` to update non-latest rows.
- Do not compare per-domain search limits; final `limit` is global after merge/dedupe/sort.
- Do not expose sync/internal freshness fields in search results.
- Do not treat early Phase 124 partial summaries as current truth; use Phase 124 `TRACEABILITY.md`, `124-VALIDATION.md`, and live tests for the gap-fixed baseline.
- Do not create document fixtures with divergent top-level `tags` and `frontmatter.fq_tags`; Phase 124 now rejects that conflict.
- Do not call `apply_tags` only with `targets`; Phase 124 now requires at least one of `add_tags` or `remove_tags`.
- Do not manually patch `fqc_documents.content_hash` in Phase 125 search tests to compensate for Phase 124 document writes; that freshness is now a Phase 124 contract.
- Do not assume immediate semantic visibility after document section writes unless embedding is stubbed or awaited through an existing deterministic test hook.
- Do not remove every legacy search/memory tool in Phase 125 unless the plan includes coverage port evidence and explicitly notes Phase 128 final audit remains.
- Do not add literal body grep/regex search to `search`; product docs defer it.
