# Requirements: FlashQuery Core — v2.9 Filesystem Primitive Tools

**Defined:** 2026-04-24
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.

**Reference documents (authoritative — defer to these for full detail):**
- Requirements spec: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Product/Definition/MCP for Directory Creation/MCP Directory Create and List.md`
- Development plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Product/Definition/MCP for Directory Creation/MCP for Directory Creation Dev Plan.md`

**Test credentials:** `.env.test` in the repo root contains all credentials needed to run integration and E2E tests. Use these directly — do not ask the user to run tests.

---

## v2.9 Requirements

### Directory Creation (`create_directory`)

Spec reference: SPEC-20 in requirements doc.

- [x] **DIR-01**: AI can create a single vault directory at any path via `create_directory`
- [x] **DIR-02**: AI can create a full nested directory hierarchy in one call (mkdir -p semantics — intermediate directories created automatically)
- [x] **DIR-03**: AI can batch-create up to 50 directories in a single `create_directory` call by passing an array of paths
- [x] **DIR-04**: `create_directory` accepts optional `root_path` parameter so all paths in the batch are resolved relative to a declared root
- [x] **DIR-05**: `create_directory` sanitizes illegal filesystem characters in directory name segments (replacing with spaces) and reports what was sanitized in the response
- [x] **DIR-06**: `create_directory` validates paths against traversal attempts, symlinks, file-at-path conflicts, whitespace-only segments, and byte-length limits — rejecting invalid paths without blocking valid ones in the same batch
- [x] **DIR-07**: `create_directory` returns partial success on batch calls — valid paths are created even when some paths in the same call fail; `isError` is false when at least one path succeeded
- [x] **DIR-08**: `create_directory` is idempotent — calling it on an already-existing directory succeeds without error (directory already exists is noted in the response, not an error)
- [x] **DIR-09**: `create_directory` performs shutdown check and returns an error immediately if the server is shutting down
- [x] **DIR-10**: `create_directory` is a pure filesystem operation — no database writes, no embedding, no write lock acquisition

### Vault Listing (`list_vault`)

Spec reference: SPEC-21 in requirements doc. Replaces existing `list_files` tool.

- [ ] **LIST-01**: AI can list vault contents at any path via `list_vault`; the tool replaces `list_files` entirely with the same tool name change applied across the codebase
- [ ] **LIST-02**: `list_vault` supports `show` parameter: `"files"` (files only), `"directories"` (directories only), `"all"` (both); default is `"all"`
- [ ] **LIST-03**: `list_vault` supports `format` parameter: `"table"` (markdown table with Name/Type/Size/Created/Updated columns) and `"detailed"` (key-value blocks separated by `---`); default is `"table"`
- [ ] **LIST-04**: `list_vault` supports `recursive` parameter to walk the full directory subtree; default is `false`
- [ ] **LIST-05**: `list_vault` supports `extensions` parameter (array of strings) to filter file entries by extension; ignored (with debug log) when `show` is `"directories"`
- [ ] **LIST-06**: `list_vault` supports `after` and `before` date filter parameters (relative: `7d`, `24h`, `1w`; or ISO: `YYYY-MM-DD`) and `date_field` (`"updated"` or `"created"`) to control which timestamp is filtered; invalid date strings return `isError: true`
- [ ] **LIST-07**: `list_vault` returns DB-enriched metadata (title, tags, fqc_id, status, DB timestamps) for files tracked in `fqc_documents`; untracked files use filesystem metadata and are marked as such in the response
- [ ] **LIST-08**: `list_vault` returns real file sizes via `fs.stat()` (not hardcoded `"0 bytes"` as in the old `list_files`)
- [ ] **LIST-09**: `list_vault` enforces `limit` parameter (default 200) and appends a truncation notice when results exceed the limit
- [ ] **LIST-10**: `list_vault` returns `isError: true` for non-existent paths (behavior change from old `list_files` which returned empty results)
- [ ] **LIST-11**: `list_vault` always appends a summary line: `Showing {displayed} of {total} entries in {path}/.`; untracked files trigger an additional note about timestamp reliability
- [ ] **LIST-12**: `list_vault` sorts directories by path depth then alphabetically, files by `date_field` timestamp newest-first; when `show: "all"`, directories precede files
- [ ] **LIST-13**: `list_vault` skips dot-prefixed files and directories (same dotfile filtering as the scanner)

### Module Refactor and Cleanup

Dev plan reference: Phase 4.

- [ ] **REFAC-01**: `remove_directory` handler migrated from `src/mcp/tools/documents.ts` to new `src/mcp/tools/files.ts` without behavioral changes; existing `remove_directory` tests continue to pass
- [ ] **REFAC-02**: `list_files` tool removed from `src/mcp/tools/compound.ts`; any tests calling `list_files` by name are updated or removed
- [x] **REFAC-03**: `parseDateFilter()` extracted from `compound.ts` to `src/mcp/utils/date-filter.ts` with bug fix: invalid date strings return `null` instead of `NaN`
- [x] **REFAC-04**: Shared `src/mcp/utils/path-validation.ts` utility created with `validateVaultPath()`, `normalizePath()`, `joinWithRoot()`, `sanitizeDirectorySegment()`, and `validateSegment()` functions; `remove_directory` updated to use `validateVaultPath()` after migration

### Plugin Updates

Dev plan reference: Phase 7.

- [ ] **PLUG-01**: `fq-base` plugin `README.md` updated: `list_files` → `list_vault` in tool lists; `create_directory` added to Directory tools section
- [ ] **PLUG-02**: `fq-base` `skills/fq-finder/workflows/file-browse.md` rewritten for `list_vault` API: all parameter names, types, defaults, examples, and response format documentation updated
- [ ] **PLUG-03**: `fq-base` `skills/fq-organizer/workflows/vault-maintenance.md` updated: `create_directory` section added with usage, idempotency note, and example
- [ ] **PLUG-04**: `fq-skill-creator` `skills/creator/SKILL.md` updated: `list_files` → `list_vault` in tool decision guide and summary table
- [ ] **PLUG-05**: `fq-skill-creator` `skills/creator/references/flashquery-tools.md` updated: `list_files` section renamed and rewritten for `list_vault`; `create_directory` section added before `remove_directory`

### Test Coverage

Dev plan references: Phases 1–6.

- [x] **TEST-01**: Unit tests pass for all path-validation utilities (`validateVaultPath`, `normalizePath`, `joinWithRoot`, `sanitizeDirectorySegment`, `validateSegment`): U-01 through U-33 as defined in the dev plan
- [x] **TEST-02**: Unit tests pass for `formatFileSize()`: U-44 through U-53 as defined in the dev plan
- [x] **TEST-03**: Unit tests pass for `parseDateFilter()` including the NaN fix: all cases including `"garbage"` → `null` (not `NaN`)
- [x] **TEST-04**: Directed scenario tests pass for `create_directory`: F-19 through F-52 as defined in the dev plan; tests cover single, deep hierarchy, batch, root_path, normalization, sanitization, rejection, and special cases
- [ ] **TEST-05**: Directed scenario tests pass for `list_vault`: F-08 through F-11, F-53 through F-97 as defined in the dev plan; tests cover show modes, format modes, param validation, FS resilience
- [ ] **TEST-06**: Integration tests pass for cross-tool workflows: IF-01 through IF-16 as defined in the dev plan (create → list → remove lifecycle, plugin init scaffold, format modes, file size rendering)
- [ ] **TEST-07**: Coverage matrix documents updated: `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` reflect all new F- and IF- IDs; use `/flashquery-directed-covgen` and `/flashquery-integration-covgen` skills with the requirements doc path as reference material
- [ ] **TEST-08**: All pre-existing tests continue to pass throughout development; no regressions introduced

---

## Future Requirements (v3.0+)

- Non-markdown file read support (PDFs, Word docs, images) via `files.ts`
- Configurable date filter behavior (currently: invalid date → error; future: could silently ignore filter)
- `list_vault` pagination (cursor-based) for very large vaults
- Hard `access: read-only` enforcement (currently warning-only guardrail)

## Out of Scope

| Feature | Reason |
|---------|--------|
| File content operations in `files.ts` | Phase 7 docs describe `files.ts` as home for future binary reads, but implementation is deferred |
| `create_directory` database record | Pure filesystem op by spec decision; no DB side effects |
| `list_vault` write lock | Read operation; no locking per spec |
| `create_directory` write lock | `mkdir -p` is OS-atomic; lock would only block unrelated document writes (OQ-1 resolved) |
| `list_vault` real-time watching | File-watcher infrastructure not in scope for this milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIR-01 | Phase 92 | Complete |
| DIR-02 | Phase 92 | Complete |
| DIR-03 | Phase 92 | Complete |
| DIR-04 | Phase 92 | Complete |
| DIR-05 | Phase 92 | Complete |
| DIR-06 | Phase 92 | Complete |
| DIR-07 | Phase 92 | Complete |
| DIR-08 | Phase 92 | Complete |
| DIR-09 | Phase 92 | Complete |
| DIR-10 | Phase 92 | Complete |
| LIST-01 | Phase 93 | Pending |
| LIST-02 | Phase 93 | Pending |
| LIST-03 | Phase 93 | Pending |
| LIST-04 | Phase 93 | Pending |
| LIST-05 | Phase 93 | Pending |
| LIST-06 | Phase 93 | Pending |
| LIST-07 | Phase 93 | Pending |
| LIST-08 | Phase 93 | Pending |
| LIST-09 | Phase 93 | Pending |
| LIST-10 | Phase 93 | Pending |
| LIST-11 | Phase 93 | Pending |
| LIST-12 | Phase 93 | Pending |
| LIST-13 | Phase 93 | Pending |
| REFAC-01 | Phase 94 | Pending |
| REFAC-02 | Phase 94 | Pending |
| REFAC-03 | Phase 91 | Complete |
| REFAC-04 | Phase 91 | Complete |
| PLUG-01 | Phase 97 | Pending |
| PLUG-02 | Phase 97 | Pending |
| PLUG-03 | Phase 97 | Pending |
| PLUG-04 | Phase 97 | Pending |
| PLUG-05 | Phase 97 | Pending |
| TEST-01 | Phase 91 | Complete |
| TEST-02 | Phase 91 | Complete |
| TEST-03 | Phase 91 | Complete |
| TEST-04 | Phase 92 | Complete |
| TEST-05 | Phase 93 | Pending |
| TEST-06 | Phase 95 | Pending |
| TEST-07 | Phase 96 | Pending |
| TEST-08 | All phases (91-97) | Pending |

**Coverage:**
- v2.9 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 — traceability updated with phase numbers 91-97*
