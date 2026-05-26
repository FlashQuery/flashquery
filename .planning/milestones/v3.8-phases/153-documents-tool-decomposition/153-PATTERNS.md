# Phase 153: Documents Tool Decomposition - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 18
**Analogs found:** 18 / 18

## Mandatory Source Order

Downstream implementation and verification agents MUST read these external docs first for any Phase 153 question, then local planning docs:

1. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md` - authoritative spec, Phase 153 scope is Spec Section 6.3 / REQ-009.
2. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md` - authoritative test plan, Phase 153 scope is Test Plan Section 4.3.
3. `.planning/phases/153-documents-tool-decomposition/153-CONTEXT.md`
4. `.planning/ROADMAP.md`
5. `.planning/REQUIREMENTS.md`

Phase 153 is only REQ-009. Do not reopen Phase 151 / Phase 152 cleanup unless needed for import compatibility or guard preservation.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/mcp/tools/documents.ts` | MCP entrypoint | request-response registration | current `registerDocumentTools` | exact |
| `src/mcp/tools/documents/deps.ts` | dependency wiring | dependency injection | current `registerDocumentTools` local `supabase`, `vaultRoot`, `logger` setup | exact |
| `src/mcp/tools/documents/write.ts` | MCP tool registration | request-response + file-I/O + CRUD | current `write_document` registration | exact |
| `src/mcp/tools/documents/get.ts` | MCP tool registration | request-response + file-I/O | current `get_document` registration | exact |
| `src/mcp/tools/documents/archive.ts` | MCP tool registration | request-response + file-I/O + CRUD + rollback | current `archive_document` registration | exact |
| `src/mcp/tools/documents/remove.ts` | MCP tool registration | request-response + file-I/O + CRUD + rollback | current `remove_document` registration | exact |
| `src/mcp/tools/documents/copy.ts` | MCP tool registration | request-response + file-I/O + CRUD + embedding | current `copy_document` registration | exact |
| `src/mcp/tools/documents/move.ts` | MCP tool registration | request-response + file-I/O + CRUD + plugin ownership | current `move_document` registration | exact |
| `src/mcp/tools/documents/helpers.ts` | local helpers | transform + path safety | current helper block at top of `documents.ts` | exact |
| `src/mcp/utils/document-output.ts` | existing utility | response construction | `resolveAndBuildDocument` and consolidated output helpers | exact |
| `src/mcp/utils/resolve-document.ts` | existing utility | identifier resolution | `resolveDocumentIdentifier` | exact |
| `src/mcp/utils/document-resolver-primitives.ts` | existing utility | targeted scan and resolver primitives | `targetedScan`, `DocumentReadError` patterns | exact |
| `tests/unit/codebase-audit-remaining-remediation.test.ts` | test | static guard | prior Phase 151/152 guards | exact |
| `tests/unit/advanced-document-tools.test.ts` | test | MCP document behavior | existing advanced document tool coverage | exact |
| `tests/unit/archive-document.test.ts` | test | archive/copy/move behavior | existing archive document coverage | exact |
| `tests/unit/copy-document.test.ts` | test | copy_document source/response contract | existing source-slice assertions against `documents.ts` | exact |
| `tests/unit/remove-document.test.ts` | test | remove_document source/response contract | existing source-slice assertions against `documents.ts` | exact |
| `tests/unit/move-document.test.ts` | test | move_document source/response contract | existing source-slice assertions against `documents.ts` | exact |
| `tests/unit/document-output.test.ts` | test | get_document validation contract | existing source-slice assertions against `documents.ts` | exact |
| `tests/unit/no-hardcoded-extensions.test.ts` | test | source-wide frontmatter/extension guard | managed frontmatter literal allowlist | exact |
| `tests/integration/documents.integration.test.ts` | test | MCP document integration | existing document registration/flow setup | exact |
| `tests/integration/write-document.integration.test.ts` | test | write_document integration | existing write behavior baseline | exact |
| `tests/integration/remove-document.integration.test.ts` | test | remove/archive integration | existing remove/archive behavior baseline | exact |

## Pattern Assignments

### Public entrypoint: `src/mcp/tools/documents.ts`

Current contract:
- Imports `McpServer` and `FlashQueryConfig`.
- Exports `registerDocumentTools(server, config): void`.
- Registers `write_document`, `get_document`, `archive_document`, `remove_document`, `copy_document`, and `move_document`.

Target pattern:
- Keep `registerDocumentTools(server, config)` in this file.
- Build shared dependencies once, then call imported registration functions, for example:
  - `registerWriteDocumentTool(server, deps)`
  - `registerGetDocumentTool(server, deps)`
  - `registerArchiveDocumentTool(server, deps)`
  - `registerRemoveDocumentTool(server, deps)`
  - `registerCopyDocumentTool(server, deps)`
  - `registerMoveDocumentTool(server, deps)`
- Avoid importing plugin lifecycle modules in the entrypoint if those dependencies can live only in the specific moved modules that need them.

### Shared dependency module: `src/mcp/tools/documents/deps.ts`

Current analogs:
- Current `registerDocumentTools` obtains `supabase` from `supabaseManager.getClient(config)`.
- Uses `vaultManager`, `logger`, `embeddingProvider`, and `scheduleDocumentEmbedding`.

Target pattern:
- Define a local `DocumentToolDeps` interface for shared services needed by moved registrations.
- Keep dependency fields explicit and concrete; do not create server-side session state.
- If a dependency is needed by only one handler, prefer local import in that handler to reduce coupling.

### Local helpers: `src/mcp/tools/documents/helpers.ts`

Current helper candidates:
- Path containment helpers such as `isWithin`, `toVaultRelative`, and trash-root/path helpers.
- `stringField` and other document-specific shape helpers.
- Shared success/error response assembly only if it is currently duplicated across moved handlers.

Target pattern:
- Keep helper imports dependency-light.
- Do not move helpers that belong to existing reusable utilities unless the move lowers coupling without changing behavior.
- Preserve exact error envelope shape through existing `response-formats` helpers.

### Moved tool modules

Each moved tool file should:
- Export one registration function.
- Keep the existing Zod schema and description text unless an import update requires a harmless formatting change.
- Keep the current try/catch and `isError: true` behavior.
- Preserve all write locks, targeted scans, embedding scheduling, identity resolution, plugin propagation/ownership checks, rollback paths, and logger calls.
- Read the external source docs and this pattern map before editing.

Suggested split:
- `write.ts`: `write_document` create/update flow, title/tags frontmatter conflict checks, plugin readonly folder warning, stale-row cleanup, embedding scheduling.
- `get.ts`: `get_document` consolidated response flow using `resolveAndBuildDocument`.
- `archive.ts`: archive flow, targeted scan, rollback, status/frontmatter handling.
- `remove.ts`: hard delete/trash behavior, targeted scan, rollback, trash path resolution.
- `copy.ts`: copy path normalization, identity reset, DB insert, embedding scheduling.
- `move.ts`: move/rename behavior, plugin ownership warning, cross-device fallback, identity preservation.

### Static guard pattern: `tests/unit/codebase-audit-remaining-remediation.test.ts`

Existing pattern:
- Reads source files with `read(relativePath)`.
- Uses exact string or regex guards for prior remediation findings.
- Walks directories for source-level structural assertions.

REQ-009 guard additions:
- T-U-026: assert `src/mcp/tools/documents.ts` remains the public entrypoint and is thin enough after final extraction.
- T-U-027: assert files under `src/mcp/tools/documents/` stay below the chosen line threshold or contain an explicit justification marker.
- T-U-028: assert forbidden document/plugin cycle fragments do not reappear.
- Preserve T-U-004, T-U-007, T-U-008, T-U-009, T-U-011, T-U-012, T-U-013, T-U-016, T-U-017, T-U-019, T-U-020, and T-U-025.

### Existing source-slice tests to update during decomposition

These tests currently read `src/mcp/tools/documents.ts` directly and slice for handler-specific source fragments. As handlers move, update them to read the moved module files or a helper that concatenates the entrypoint plus `src/mcp/tools/documents/` modules:

- `tests/unit/document-output.test.ts` - get_document numeric validation contract.
- `tests/unit/copy-document.test.ts` - copy_document runtime envelope and source contract.
- `tests/unit/remove-document.test.ts` - remove_document trash/archive/rollback source contract.
- `tests/unit/move-document.test.ts` - move_document identity/plugin/path source contract.
- `tests/unit/no-hardcoded-extensions.test.ts` - managed frontmatter literal allowlist may need `src/mcp/tools/documents/*.ts` entries if moved modules retain `FM.*` literals.

### Regression test pattern

Primary document behavior baselines:
- `tests/unit/advanced-document-tools.test.ts`
- `tests/unit/archive-document.test.ts`
- `tests/integration/documents.integration.test.ts`
- `tests/integration/write-document.integration.test.ts`
- `tests/integration/remove-document.integration.test.ts`
- `tests/integration/tools-response-format.test.ts`
- `tests/integration/plugin-reconciliation.integration.test.ts`

Scenario baselines:
- `tests/scenarios/directed/testcases/test_consolidated_get_document.py`
- `tests/scenarios/directed/testcases/test_document_archive_and_search.py`
- `tests/scenarios/directed/testcases/test_document_copy_and_move.py`
- `tests/scenarios/directed/testcases/test_content_frontmatter_ops.py`
- `tests/scenarios/integration/tests/write_then_search.yml`
- `tests/scenarios/integration/tests/archive_status_field.yml`
- `tests/scenarios/integration/tests/document_retrieval_by_id.yml`

## Risk Notes

- The highest-risk behavior is subtle response drift from moved handlers; preserve schema/description/output text unless tests force a compatibility update.
- The highest-risk structural issue is reintroducing document/plugin cycles by centralizing plugin imports in shared helpers. Keep plugin-specific imports local to handler modules when feasible.
- The static guard file is already shared by prior phases; append REQ-009 assertions without weakening prior checks.
