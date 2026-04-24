# Phase 93: `list_vault` Handler — Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the `list_vault` MCP tool to the existing `files.ts` module, with unit tests for internal logic and directed scenario tests. Phase 91 shared utilities and Phase 92 `create_directory` are complete and ready to use.

**In scope:**
- `src/mcp/tools/files.ts` — add the `list_vault` handler to `registerFileTools()`
- Unit tests for list_vault-specific logic (U-34 through U-43, U-54 through U-58, U-66 through U-69) in `tests/unit/`
- 7 directed scenario test files (F-08 through F-11, F-53 through F-97) in `tests/scenarios/directed/testcases/`
- Un-skip F-51 in the Phase 92 test file (`test_create_directory_special.py`) — `list_vault` is now available

**Out of scope:** `remove_directory` migration (Phase 94), `list_files` removal (Phase 94), integration tests (Phase 95), plugin updates (Phase 97).

</domain>

<decisions>
## Implementation Decisions

### Plan Structure
- **D-01:** Two plans. **Plan 1** covers unit tests for internal logic (dev plan 3A) + the handler implementation (dev plan 3B) — TDD ordering: unit tests first, then make them pass. **Plan 2** covers all 7 directed scenario test files (dev plan 3C, ~60 test steps). Un-skipping F-51 from Phase 92's test file is included in Plan 2 once `list_vault` is confirmed working.

### Handler Architecture (pre-resolved from dev plan)
- **D-02:** No write lock. `list_vault` is a read operation — no `acquireLock()`/`releaseLock()`.
- **D-03:** Supabase access via `supabaseManager.getClient()` called inside the handler — matches the established pattern in `registerDocumentTools` and `registerCompoundTools`. No signature change to `registerFileTools`.
- **D-04:** Pipeline order: shutdown check → path validation → stat (file check) → filesystem walk → filter (show, extensions, date) → DB enrichment → sort → limit/truncate → serialize → build trailing notes → return.
- **D-05:** Non-existent path returns `isError: true`. This is a **behavior change** from old `list_files` (which returned empty results). Critical — F-84 validates this.
- **D-06:** Target directory is NOT included in results. Follow `ls`/`readdir` semantics — list only contents. The summary line already names the target.

### Sort Order and Limit (OQ-6 resolved)
- **D-07:** `limit` applies to the combined sorted list. Sort everything (directories first by depth+alpha, then files by date descending), then take the first N. Callers who want only files can use `show: "files"`.

### DB Enrichment (OQ-4 resolved)
- **D-08:** Batch DB queries in chunks of 100 paths. Query `fqc_documents` filtered by `instance_id` and path batch. Merge results into a single lookup map. The `limit` parameter (default 200) bounds worst-case to 2 batches.

### Extension Filtering Edge Case
- **D-09:** When `show: "directories"` and `extensions` is provided: log at debug level (`logger.debug(...)`) and proceed without applying the filter — silently ignored, not an error. Helps plugin developers catch misuse without penalizing them.

### Date Filtering Error Handling (OQ-2 resolved)
- **D-10:** `parseDateFilter()` (from `date-filter.ts`) returns `null` for invalid date strings (NaN bug fixed in Phase 91). `list_vault` treats a `null` return as an error: return `isError: true` with message `Invalid date format: "{value}". Use ISO format (YYYY-MM-DD) or relative format (7d, 24h, 1w).`

### F-51 Activation
- **D-11:** F-51 was marked `skip` in Phase 92's `test_create_directory_special.py` with comment "Deferred to Phase 93 — requires list_vault." Plan 2 includes a task to remove the skip annotation and verify the test passes.

### Claude's Discretion
- How the recursive directory walk is implemented internally (async generator, recursive calls, or queue-based BFS) — follow performance best practices for Node.js async I/O.
- Whether `list_vault`-specific helper functions (walk, enrich, sort, serialize) are extracted into named internal functions or kept inline in the handler — lean toward named functions for testability.
- Internal organization of filter composition (one pass or separate passes per filter dimension).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary: Requirements and Dev Plan
- `../../../flashquery-product/Product/Definition/MCP for Directory Creation/MCP Directory Create and List.md` — Full SPEC-21 requirements: parameters, validation rules, behavior, exception paths, response format, response examples, test cases, and the complete Testing Strategy section (§ Testing Strategy > 1. Unit Tests defines U-34 through U-69; § Testing Strategy > 2.6–2.9 defines F-53 through F-97). The authoritative source.
- `../../../flashquery-product/Product/Definition/MCP for Directory Creation/MCP for Directory Creation Dev Plan.md` — **Phase 3 is the primary implementation guide.** Covers exact handler pipeline (3B), unit test table with all IDs (3A), directed test file listing with F-coverage IDs (3C), all resolved open questions (OQ-1 through OQ-6), and the explicit note: "Now run F-51 from Phase 2."

### Prior Phase Context
- `.planning/phases/91-shared-utilities/91-CONTEXT.md` — Phase 91 decisions (test file location: `tests/unit/`, not `__tests__/`; parseDateFilter NaN fix; sanitizeDirectorySegment wrapping pattern)
- `.planning/phases/92-create-directory-handler/92-CONTEXT.md` — Phase 92 decisions (F-51 skipped with comment "Deferred to Phase 93"; files.ts module structure; registerFileTools signature)

### Existing Code to Read Before Implementing
- `src/mcp/tools/files.ts` — Phase 92 output: current `registerFileTools()` structure; add `list_vault` handler alongside `create_directory`
- `src/mcp/tools/documents.ts` §223 and §437 — `supabaseManager.getClient()` call pattern inside handlers (reference for DB enrichment)
- `src/mcp/utils/path-validation.ts` — Phase 91 output: `validateVaultPath` (required for path validation step)
- `src/mcp/utils/format-file-size.ts` — Phase 91 output: `formatFileSize` (required for size column)
- `src/mcp/utils/date-filter.ts` — Phase 91 output: `parseDateFilter` (required for after/before filtering)
- `src/mcp/utils/response-formats.ts` — Phase 91 additions: `formatTableHeader()` and `formatTableRow()` (required for table serialization)
- `src/storage/vault.ts` §110-120 — `listMarkdownFiles` dotfile filtering logic (replicate for list_vault's walk)
- `tests/scenarios/directed/testcases/test_create_directory_special.py` — contains F-51 marked `skip`; Plan 2 removes the skip

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- All Phase 91 utilities ready to import: `validateVaultPath`, `formatFileSize`, `parseDateFilter`, `formatTableHeader`, `formatTableRow`
- `supabaseManager.getClient()` (storage/supabase.ts) — call inside the handler; no signature change needed
- `formatKeyValueEntry()`, `joinBatchEntries()` (response-formats.ts) — use for `format: "detailed"` serialization
- `formatEmptyResults()` (response-formats.ts) — use for empty results path

### Established Patterns
- MCP tool handlers: shutdown check → validation → ops → response (isError flag)
- DB access: `supabaseManager.getClient()` called at handler invocation time, not at registration time
- Dotfile filtering: skip entries where `name.startsWith('.')` (matching `listMarkdownFiles` in vault.ts:110-120)
- Test file location: `tests/unit/` (flat directory) — never `__tests__/`
- ESM imports: `.js` extension (e.g., `import { parseDateFilter } from '../utils/date-filter.js'`)

### Integration Points
- `registerFileTools(server, config)` in `files.ts` — add `list_vault` alongside `create_directory`; no signature change
- `server.ts` — already imports and registers `registerFileTools`; no changes needed
- Phase 92 test file (`test_create_directory_special.py`) — F-51 skip annotation needs removal in Plan 2

</code_context>

<specifics>
## Specific Ideas

- Dev plan 3B handler pipeline order is authoritative — implement exactly as written (D-04 above).
- Zod schema is fully specified in the dev plan — use exactly as written (path, show, format, recursive, extensions, after, before, date_field, limit with all defaults).
- Detailed format field order is specified: tracked file (Title→Path→Type→Size→Status→Tags→Updated→Created→fqc_id), untracked file (Path→Type→Size→Tracked→Updated→Created), directory (Path→Type→Size→Children→Updated→Created).
- Summary line is always present: `Showing {displayed} of {total} entries in {path}/.` When truncated: `Showing {limit} of {total} entries (truncated). Use a narrower path, date filter, or higher limit to see more.`
- Untracked note only when untracked files appear in results: `{N} untracked file(s) included — dates are filesystem-reported and may be less reliable than DB timestamps for tracked files.`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 93-list-vault-handler*
*Context gathered: 2026-04-24*
