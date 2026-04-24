# Phase 92: `create_directory` Handler — Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the `create_directory` MCP tool: new `files.ts` module with the handler, register it in `server.ts`, and validate with directed scenario tests (F-19 through F-52). Phase 91 shared utilities are complete and ready to import.

**In scope:**
- `src/mcp/tools/files.ts` — new module with `registerFileTools()` containing the `create_directory` handler
- `src/mcp/server.ts` — add import + registration call
- 7 directed scenario test files (F-19 through F-52) in `tests/scenarios/directed/testcases/`

**Out of scope:** `list_vault` handler (Phase 93), `remove_directory` migration (Phase 94), `list_files` removal (Phase 94), integration tests (Phase 95), plugin updates (Phase 97).

</domain>

<decisions>
## Implementation Decisions

### Plan Structure
- **D-01:** Single plan — one PLAN.md covering all three sections from the dev plan (2A: `files.ts` handler, 2B: `server.ts` wiring, 2C: all 7 directed test files). No wave split needed; the sections are sequential, not parallelizable.

### Handler Implementation (pre-resolved from dev plan)
- **D-02:** No write lock. `create_directory` does NOT acquire the write lock. The lock resource is `'documents'` — directory creation is not a document operation. `mkdir -p` is atomic at the OS level. The contradicting statement in the Implementation Guide (OQ-1) is an oversight — disregard it.
- **D-03:** Shutdown check first. `getIsShuttingDown()` is checked before any path processing. Returns `isError: true` with message `"Server is shutting down; new requests cannot be processed."` on shutdown.
- **D-04:** Partial success semantics. When some paths in a batch succeed and others fail, `isError` is `false` — the tool did useful work. Only when every path fails is `isError` set to `true`. Failed paths go in a `Failed` block in the response.
- **D-05:** Idempotency. A path that already exists as a directory is not an error. Response reports it as `(already exists)`. Server-side warning log only — does not affect `isError` or response format.
- **D-06:** No database writes. Pure filesystem operation — no Supabase queries, no embeddings, no write lock.

### Test Handling
- **D-07:** F-51 (dot-prefixed directory invisible to `list_vault`) — mark as `skip` or pending in the Phase 92 test file. `list_vault` is not available until Phase 93. Add a clear comment: "Deferred to Phase 93 — requires list_vault."
- **D-08:** F-52 (shutdown check) — implementation approach is Claude's discretion. The Python directed test framework has no existing shutdown mock pattern. The planner should check the test framework for viable approaches (SIGTERM + immediate call, or fall back to a unit test if integration testing shutdown state is not feasible).

### Claude's Discretion
- How F-52 is implemented in the directed test framework (SIGTERM timing, framework extension, or unit test fallback) — planner decides after reading the test framework code.
- Internal organization of `files.ts` (helper functions, ordering of validation steps) — follow the dev plan exactly for the public handler structure; internals are Claude's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary: Requirements and Dev Plan
- `../../../flashquery-product/Product/Definition/MCP for Directory Creation/MCP Directory Create and List.md` — Full SPEC-20 requirements: parameters, validation rules, behavior, exception paths, response format, response examples, test cases. The authoritative source.
- `../../../flashquery-product/Product/Definition/MCP for Directory Creation/MCP for Directory Creation Dev Plan.md` — **Phase 2 is the primary implementation guide.** Covers exact handler structure (2A), server wiring with line numbers (2B), and all 7 directed test files with their F-coverage IDs (2C). All OQ-1 through OQ-6 are resolved here.

### Prior Phase Context
- `.planning/phases/91-shared-utilities/91-CONTEXT.md` — Phase 91 decisions (test file location convention: `tests/unit/`, not `__tests__/`; parseDateFilter extraction; sanitizeDirectorySegment wrapping pattern)

### Existing Code to Read Before Implementing
- `src/mcp/tools/documents.ts` §1527-1694 — `remove_directory` handler — the reference implementation pattern for `create_directory` (shutdown check, handler structure, error mapping)
- `src/mcp/server.ts` §14 and §446 — where to add the `registerFileTools` import and registration call (exact line numbers from dev plan)
- `src/mcp/utils/path-validation.ts` — Phase 91 output: `validateVaultPath`, `normalizePath`, `joinWithRoot`, `sanitizeDirectorySegment`, `validateSegment`
- `tests/scenarios/directed/testcases/test_directory_operations.py` — existing directed test pattern for directory operations (reference for F-19 through F-52 test file structure)
- `tests/scenarios/framework/fqc_test_utils.py` — test framework utilities; check for SIGTERM support before deciding F-52 approach

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `validateVaultPath`, `normalizePath`, `joinWithRoot`, `sanitizeDirectorySegment`, `validateSegment` (src/mcp/utils/path-validation.ts) — all built in Phase 91, import directly
- `remove_directory` handler (documents.ts:1527-1694) — structural reference for `create_directory`: shutdown check → validation loop → filesystem ops → response building → error mapping
- `wrapServerWithCorrelationIds()` (server.ts:137) — wraps all registered tools automatically; `create_directory` inherits correlation ID tracking for free

### Established Patterns
- MCP tool handlers: shutdown check → input validation → filesystem/DB ops → response building (isError flag)
- Directed test structure: Python file with `COVERAGE = [...]`, `TestRun`, `TestContext`, `--managed` flag for isolated subprocess
- Test file naming: `test_{feature}_{category}.py` — see dev plan for the 7 specific file names
- ESM imports in TypeScript: `.js` extension (e.g., `import { validateVaultPath } from '../utils/path-validation.js'`)

### Integration Points
- `server.ts` — add `import { registerFileTools } from './tools/files.js'` near line 14; add `registerFileTools(server, config)` near line 446
- Phase 93 (`list_vault`) will also go in `files.ts` — `registerFileTools()` will grow; design it to accept additional handlers

</code_context>

<specifics>
## Specific Ideas

- The dev plan's handler structure for Phase 2A is authoritative — implement steps 0-8 in exact order (shutdown check, normalize, wrap string, prepend root_path, validate, sanitize, mkdir, build response).
- Response header says "Created N directory:" or "Created N directories:" — only newly created directories count; already-existing directories are listed but not counted.
- Zod schema uses `z.union([z.string(), z.array(z.string())])` for `paths` — the string-or-array handling is validated at the schema level, not manually.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 92-create-directory-handler*
*Context gathered: 2026-04-24*
