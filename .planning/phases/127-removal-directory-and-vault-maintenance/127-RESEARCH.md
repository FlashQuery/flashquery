# Phase 127: Removal, Directory, And Vault Maintenance - Research

**Researched:** 2026-05-12
**Domain:** FlashQuery MCP document removal, directory management, vault maintenance, and legacy filesystem-tool migration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Canonical Source Documents
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the phase boundary and the two product docs above as the detailed contract inside that boundary.
- Implementation agents should answer their own scope questions from those docs first, then from phase artifacts, before asking the user.

### `remove_document` Locked Scope
- `remove_document` accepts `identifiers: string | string[]`. Single input returns one document identification block; array input returns `{ results: [DocumentIdentificationBlock | ErrorEnvelope], warnings?: WarningCode[] }`.
- The tool must mark the DB lifecycle state archived before moving or deleting the file. There is no persistent `removed` status and no `removed_at` or `removed_to` DB column in this phase.
- `archived_at` is the lifecycle timestamp. Trash-folder moves may return `moved_to` operation feedback and should add `original_path` frontmatter for manual recovery.
- `trash_folder` config shape is locked: `enabled: false`, `path: ".flashquery/removed"`, `collision_strategy: "suffix" | "timestamp"`. Relative paths resolve from vault root; absolute paths are allowed if validation accepts them safely.
- Trash moves use basename-only destinations, not mirrored source paths. Collisions append a deterministic suffix or timestamp according to config.
- If trash is disabled, removal is a hard delete. No MCP restore tool ships in this phase.
- Git behavior must honor existing vault git policy for hard delete, in-repo trash move, and external trash move: no auto commit when disabled, auto commit when enabled, and auto push when enabled.
- Batch removal preserves input order, reports per-element expected errors with `isError:false`, and emits `warnings: ["bulk_removal: N items"]` for more than five identifiers.

### `manage_directory` Locked Scope
- `manage_directory` requires explicit `action: "create" | "remove"` and `paths: string[]`.
- Output is `{ results: [DirectoryResult | ErrorEnvelope] }`, where success results are `{ path, action, status: "created" | "removed" | "unchanged", timestamp }`.
- Both create and remove acquire per-path directory-scoped write locks. This intentionally replaces the legacy asymmetric behavior where create avoided locking.
- Create is idempotent and returns `status: "unchanged"` for an existing directory.
- Remove rejects non-empty directories with canonical `conflict` and `details.reason: "directory_not_empty"`.
- The tool belongs to `doc-write` and `tier:read-write`; it is not a `system` maintenance tool.

### `maintain_vault` Locked Scope
- `maintain_vault` requires `action: "sync" | "repair" | "status" | ["repair","sync"]`.
- Combined actions always run repair before sync, regardless of input order.
- `dry_run` applies only to repair. `background: true` applies only to sync and is rejected for repair.
- Synchronous maintenance returns `{ actions: [{ action, started_at, finished_at, dry_run, counts: { scanned, added, updated, repaired, archived }, warnings? }] }`.
- Background sync returns `{ accepted: true, job_id, started_at }`; `status` returns job-level state for a queried `job_id`.
- Background job state is process-local for v1 and does not survive restart. Unknown or restarted-away `job_id` values return canonical `not_found`.
- Only one maintenance run may execute at a time. Concurrent calls return canonical `conflict` with `details.reason: "maintenance_in_progress"`.
- `status` must not expose scanner internals such as queue depth, hashes, embedding state, per-document sync versions, or maintenance availability flags.

### Testing And Traceability
- The first implementation task must instantiate a phase-local traceability table mapping `DOC-09`, `SYS-01`, `SYS-02`, and `SYS-03` to unit, integration, E2E, directed scenario, and integration scenario evidence.
- High-risk tool contracts for `remove_document`, `manage_directory`, and `maintain_vault` from the test plan must be satisfied in this phase.
- Existing `create_directory`, `remove_directory`, `force_file_scan`, and `reconcile_documents` tests and scenarios must be ported to final surfaces or removed in the same phase that removes their active surface.
- Directed and integration scenario coverage ledgers must be updated before scenario files are changed.
- Verification must include focused unit, integration, E2E, directed scenario, integration scenario, removed-tool grep, old prose-response assertion grep, `fq_*` frontmatter review, and `npm run build`.

### the agent's Discretion
- Exact helper/module boundaries may follow existing repo patterns, but shared JSON helpers in `src/mcp/utils/response-formats.ts`, document output helpers, vault manager patterns, write locks, and Phase 121-126 consolidation helpers should be preferred over per-tool bespoke output code.
- Maintenance background job state may live in a small process-local service/module if that keeps handler code testable.
- Existing tests may be renamed or split when porting from legacy tools, provided coverage remains traceable and obsolete assertions are removed.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Final global removal audit and stale-reference cleanup for every consolidated legacy name remains Phase 128 unless a narrow assertion is needed for local correctness.
- Macro-dependent legacy composition removals remain outside this phase.
- Persistent job registry, restore API, trash retention/purge, and external confirmation UX remain outside this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOC-09 | `remove_document` archives lifecycle state before moving to the configured trash folder or hard-deleting the file, preserves input order for batch results, and honors existing git auto-commit/auto-push policy. | Plan around `archive_document` lifecycle semantics, new `trash_folder` config parsing, VaultManager move/remove APIs, and GitManager policy hooks. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/storage/vault.ts`; VERIFIED: `src/git/manager.ts`; CITED: MCP Tool Consolidation Requirements §4.41; CITED: MCP Tool Consolidation Test Plan §4.5] |
| SYS-01 | `manage_directory(action:"create")` replaces `create_directory` with ordered per-path results, idempotent create status, path validation, and directory-scoped locking. | Existing `create_directory` has normalization/sanitization behavior but returns prose and intentionally avoids locking; final surface must convert to JSON and add per-path directory lock acquisition. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/files.ts`; CITED: MCP Tool Consolidation Requirements §4.39; CITED: MCP Tool Consolidation Test Plan §4.6] |
| SYS-02 | `manage_directory(action:"remove")` replaces `remove_directory` with ordered per-path results, empty-directory-only removal, conflict errors for non-empty paths, and directory-scoped locking. | Existing `remove_directory` is single-path, locks the broad `documents` resource, returns prose, and rejects non-empty directories; final surface must batch and return canonical per-path `conflict` envelopes. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/files.ts`; CITED: MCP Tool Consolidation Requirements §4.39; CITED: MCP Tool Consolidation Test Plan §4.6] |
| SYS-03 | `maintain_vault(action:"sync" | "repair" | "status" | ["repair","sync"])` replaces `force_file_scan` and `reconcile_documents` with structured per-action results, job status, dry-run repair, background sync, and maintenance conflict handling. | Existing `force_file_scan` wraps `runScanOnce`; existing `reconcile_documents` is still registered from document tools; final surface needs a single maintenance service with process-local jobs and conflict gating. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/scan.ts`; VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/services/scanner.ts`; CITED: MCP Tool Consolidation Requirements §4.40; CITED: MCP Tool Consolidation Test Plan §4.7] |
</phase_requirements>

## Summary

Phase 127 is a high-risk filesystem/admin consolidation phase, not a greenfield feature phase. [VERIFIED: `.planning/ROADMAP.md`; VERIFIED: `127-CONTEXT.md`] The planner should split the work around the three public surfaces: `remove_document`, `manage_directory(action)`, and `maintain_vault(action)`, while porting legacy `create_directory`, `remove_directory`, `force_file_scan`, and `reconcile_documents` coverage in lockstep. [CITED: MCP Tool Consolidation Test Plan §6-§7; VERIFIED: current legacy references in `tests/scenarios/*`]

The strongest codebase pattern is the Phase 121-126 JSON envelope migration: shared helpers in `src/mcp/utils/response-formats.ts`, metadata updates in `src/mcp/tool-metadata.ts`, focused unit/integration/E2E tests, then directed/YAML scenario closure. [VERIFIED: `src/mcp/utils/response-formats.ts`; VERIFIED: `126-RESEARCH.md`; VERIFIED: `126-PATTERNS.md`; VERIFIED: `126-*-SUMMARY.md`] Current code already contains `future()` metadata entries for `remove_document`, `manage_directory`, and `maintain_vault`, but the active registered tools are still the legacy handlers. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `src/mcp/tools/files.ts`; VERIFIED: `src/mcp/tools/scan.ts`; VERIFIED: `src/mcp/tools/documents.ts`]

**Primary recommendation:** plan six waves: traceability/config/low-level helpers, `manage_directory`, `maintain_vault` service and handler, `remove_document` lifecycle/trash/git APIs, protocol/scenario migration, then local absence/prose/frontmatter/build verification. [VERIFIED: phase success criteria in `.planning/ROADMAP.md`; VERIFIED: Test Plan §4.5-§4.7 and §7]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, and ESM; do not introduce CommonJS. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: `AGENTS.md`]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`]
- Use Zod for external input validation, including MCP params and config. [VERIFIED: `AGENTS.md`; VERIFIED: `src/config/loader.ts`; VERIFIED: current MCP handlers]
- MCP tools return text content; expected validation/not-found/conflict errors must use structured JSON with `isError:false`, while unexpected runtime failures use `isError:true`. [VERIFIED: `AGENTS.md`; VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: Context7 `/modelcontextprotocol/typescript-sdk`]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; E2E tests under `tests/e2e/*.test.ts`; scenario suites live under `tests/scenarios/`. [VERIFIED: `AGENTS.md`; VERIFIED: test file listing]
- Integration and E2E tests read `.env.test` through setup helpers and can skip where external Supabase/provider prerequisites are unavailable. [VERIFIED: `AGENTS.md`; VERIFIED: `tests/config/vitest.integration.config.ts`; VERIFIED: `tests/config/vitest.e2e.config.ts`]
- Never use `npm link` for local development. [VERIFIED: `AGENTS.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Document removal lifecycle | API / Backend | Local vault + Database / Storage + Git | MCP handler owns validation, lifecycle ordering, JSON response shape, and expected errors; vault storage moves/deletes files; Supabase stores archived lifecycle state; GitManager honors auto-commit/auto-push policy. [VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/storage/vault.ts`; VERIFIED: `src/git/manager.ts`; CITED: Requirements §4.41] |
| Directory create/remove | API / Backend | Local vault + Database write-lock table | MCP handler owns action dispatch, per-path ordering, expected-error envelopes, and lock acquisition; filesystem performs mkdir/rmdir; `fqc_write_locks` backs distributed lock semantics. [VERIFIED: `src/mcp/tools/files.ts`; VERIFIED: `src/services/write-lock.ts`; CITED: Requirements §4.39] |
| Vault sync/repair/status | API / Backend | Scanner service + Database / Storage | `maintain_vault` is the sole user-facing sync exception; it should call scanner/repair code and expose action counts/job state, not scanner internals. [VERIFIED: `src/mcp/tools/scan.ts`; VERIFIED: `src/services/scanner.ts`; CITED: Requirements XC-11 and §4.40] |
| Legacy surface migration | API / Backend | Test harness + config validation | Tool metadata, registration, config suggestions, and tests must move from old names to final names without compatibility aliases. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: Test Plan §6-§7] |
| Scenario coverage closure | Test Harness | MCP process + local vault | Directed scenarios verify public single-tool behavior; YAML integration scenarios verify multi-tool workflows and must update coverage ledgers before scenario files. [VERIFIED: `tests/scenarios/directed/WRITING_SCENARIOS.md`; VERIFIED: `tests/scenarios/integration/README.md`; CITED: Test Plan §7] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | Installed `^1.27.1`; npm latest `1.29.0`, modified 2026-03-30 | MCP server tool registration and `CallToolResult` handling | Existing project standard; official SDK docs show `registerTool`, Zod input schemas, `content`, `structuredContent`, and `isError` tool-error semantics. [VERIFIED: `package.json`; VERIFIED: npm registry; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| `zod` | Installed `^4.3.6`; npm latest `4.4.3`, modified 2026-05-04 | Config and MCP input validation | Required by project convention and used by current config/tool schemas. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`; VERIFIED: npm registry; VERIFIED: `src/config/loader.ts`] |
| `simple-git` | Installed `^3.33.0`; npm latest `3.36.0`, modified 2026-04-12 | Vault git staging, commit, and push policy | Existing `GitManagerImpl` uses `simpleGit(vaultPath)`, mutexes commits, and implements auto-commit/auto-push policy. [VERIFIED: `package.json`; VERIFIED: npm registry; VERIFIED: `src/git/manager.ts`] |
| `async-mutex` | Installed `^0.5.0` | In-process Git mutex and likely maintenance-service mutex | Existing GitManager uses `Mutex`; maintain_vault can use the same style for process-local conflict gating while write locks cover distributed DB-backed resource locks. [VERIFIED: `package.json`; VERIFIED: `src/git/manager.ts`; VERIFIED: `src/services/write-lock.ts`] |
| `@supabase/supabase-js` | Installed `^2.100.0` | `fqc_documents`, `fqc_write_locks`, and metadata row operations | Current handlers and lock service use Supabase client CRUD. [VERIFIED: `package.json`; VERIFIED: `src/services/write-lock.ts`; VERIFIED: `src/mcp/tools/documents.ts`] |
| `gray-matter` | Installed `^4.0.3` | Markdown frontmatter read/write | Existing document/archive/scanner code uses it to preserve and mutate FlashQuery frontmatter. [VERIFIED: `package.json`; VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/storage/vault.ts`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | Installed `^4.1.1`; npm latest `4.1.6`, modified 2026-05-11 | Unit/integration/E2E test runner | Use existing configs and focused commands for unit, integration, and E2E protocol coverage. [VERIFIED: `package.json`; VERIFIED: npm registry; VERIFIED: `tests/config/*.ts`] |
| `tsx` | Installed `^4.21.0`; npm latest `4.21.0`, modified 2025-11-30 | Development CLI execution | Use through existing npm scripts only. [VERIFIED: `package.json`; VERIFIED: npm registry] |
| `tsup` | Installed `^8.5.1`; npm latest `8.5.1`, modified 2025-11-12 | Production build | Required final gate is `npm run build`. [VERIFIED: `package.json`; VERIFIED: npm registry; VERIFIED: `.planning/ROADMAP.md`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared response helpers | Per-tool JSON assembly | Rejected because Phase 121 established helpers and product docs require uniform JSON/error semantics. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: Requirements XC-3 through XC-5] |
| Existing `VaultManager`/`GitManager` extension | Raw `fs.rename`/`fs.unlink` directly in handler | Rejected for `remove_document` because git policy must be centralized and testable. [VERIFIED: `src/storage/vault.ts`; VERIFIED: `src/git/manager.ts`; CITED: Requirements §4.41] |
| Persistent job registry | New DB table for maintenance jobs | Rejected for Phase 127 because the locked scope says background job state is process-local and restart-away job IDs return `not_found`. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements DAQ-15 / §4.40] |
| Reusing broad document write lock for directory operations | `resource_type = "documents"` for all directory paths | Rejected for final `manage_directory`; user decision requires per-path directory-scoped locks for create and remove. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements DAQ-9] |

**Installation:**
```bash
npm install
```

**Version verification:** `npm view` was run for `@modelcontextprotocol/sdk`, `zod`, `simple-git`, `vitest`, `tsx`, and `tsup`; installed versions should remain the planning baseline unless a separate dependency-upgrade phase is approved. [VERIFIED: npm registry; VERIFIED: `package.json`]

## Architecture Patterns

### System Architecture Diagram

```text
AI client over MCP stdio
  -> src/mcp/server.ts registration gate
    -> tool metadata / host exposure selection
      -> remove_document
           -> resolve document identifier
           -> acquire document/path lock
           -> set DB + frontmatter archived_at/status first
           -> trash move OR hard delete through VaultManager git-aware API
           -> per-identifier JSON result / expected error
      -> manage_directory(action)
           -> normalize + validate each path
           -> acquire directory:<path> lock per element
           -> mkdir OR empty-rmdir
           -> ordered { results } JSON
      -> maintain_vault(action)
           -> validate discriminator/options
           -> maintenance in-flight guard
           -> repair and/or runScanOnce
           -> process-local job registry for background sync
           -> action counts/status JSON, no scanner internals
```

[VERIFIED: `src/mcp/server.ts`; VERIFIED: `src/mcp/tools/files.ts`; VERIFIED: `src/mcp/tools/scan.ts`; VERIFIED: `src/mcp/tools/documents.ts`; CITED: Requirements §4.39-§4.41]

### Recommended Project Structure

```text
src/config/
  loader.ts                    # add trash_folder schema + camelCase config mapping
src/constants/
  frontmatter-fields.ts        # add ORIGINAL_PATH constant before use
src/storage/
  vault.ts                     # add git-aware move/remove APIs
src/git/
  manager.ts                   # add remove/move staging policy helpers if VaultManager needs them
src/services/
  maintenance.ts               # recommended process-local maintain_vault job/conflict service
  write-lock.ts                # reuse for directory-scoped locks
src/mcp/tools/
  documents.ts                 # register remove_document and reuse archive/document helpers
  files.ts                     # replace create/remove_directory with manage_directory
  scan.ts                      # replace force_file_scan with maintain_vault
src/mcp/utils/
  response-formats.ts          # add directory/removal/maintenance helpers only if useful
tests/unit/
  remove-document.test.ts
  manage-directory.test.ts
  maintain-vault.test.ts
tests/integration/
  remove-document.integration.test.ts
  manage-directory.integration.test.ts
  maintain-vault.integration.test.ts
tests/e2e/
  protocol.test.ts
tests/scenarios/
  directed/DIRECTED_COVERAGE.md
  directed/testcases/test_removal_directory_maintenance.py
  integration/INTEGRATION_COVERAGE.md
  integration/tests/removal_directory_maintenance.yml
```

[VERIFIED: current repo layout; VERIFIED: `127-CONTEXT.md`; VERIFIED: Phase 126 summary pattern]

### Pattern 1: Expected Errors Use JSON Envelopes

**What:** Validation, not-found, conflict, unsupported, and partial-batch failures return JSON error envelopes with `isError:false`. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: Requirements XC-4/XC-5]

**When to use:** All `remove_document`, `manage_directory`, and `maintain_vault` expected errors. [CITED: Test Plan §4.5-§4.7]

**Example:**
```typescript
// Source: src/mcp/utils/response-formats.ts
return jsonExpectedError({
  error: 'conflict',
  message: 'Directory is not empty.',
  identifier: path,
  details: { reason: 'directory_not_empty' },
});
```

### Pattern 2: Batch Results Preserve Input Order

**What:** Batch-capable mutation tools execute in input order and put success or error objects at the corresponding response index. [CITED: Requirements XC-14; VERIFIED: `archive_document` and `archive_record` migrations]

**When to use:** `remove_document.identifiers`, `manage_directory.paths`, and any array action processing. [VERIFIED: `127-CONTEXT.md`]

**Example:**
```typescript
// Source: derived from Phase 126 archive_record and Phase 123 archive_document patterns
const results = [];
for (const identifier of identifiers) {
  results.push(await removeOne(identifier));
}
return jsonToolResult({ results });
```

### Pattern 3: Directory-Scoped Locks

**What:** Use the existing DB write-lock service with resource names scoped to normalized directory paths rather than the global `documents` lock. [VERIFIED: `src/services/write-lock.ts`; VERIFIED: `127-CONTEXT.md`]

**When to use:** Each `manage_directory` path for both `create` and `remove`. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements DAQ-9]

**Example:**
```typescript
// Source: src/services/write-lock.ts pattern
const resourceType = `directory:${normalizedPath}`;
const locked = await acquireLock(supabase, config.instance.id, resourceType, {
  ttlSeconds: config.locking.ttlSeconds,
});
```

### Pattern 4: Maintenance Service Boundary

**What:** Keep background job state and in-flight conflict tracking in a small service/module rather than embedding all state in the handler. [VERIFIED: `127-CONTEXT.md`; VERIFIED: existing singleton/service style in `src/services/*`]

**When to use:** `maintain_vault(background:true)`, `maintain_vault(action:"status")`, and synchronous conflict checks. [CITED: Requirements §4.40]

**Example:**
```typescript
// Source: based on locked process-local job contract in 127-CONTEXT.md
if (maintenanceService.isRunning()) {
  return jsonExpectedError({
    error: 'conflict',
    message: 'Vault maintenance is already in progress.',
    details: { reason: 'maintenance_in_progress' },
  });
}
```

### Anti-Patterns to Avoid

- **Exposing scanner internals in `maintain_vault(status)`:** status is job-level only and must not include queue depth, hashes, embeddings, or availability booleans. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements XC-11 and DAQ-16]
- **Creating a `removed` DB lifecycle state:** locked scope says archive first and do not add `removed` status/columns in this phase. [VERIFIED: `127-CONTEXT.md`; CITED: Test Plan §4.5 U5]
- **Mirroring trash folder source paths:** trash destinations are basename-only with collision handling. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements DAQ-6]
- **Returning old prose strings from migrated tools:** final tools must emit parseable JSON responses. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: Requirements XC-3 through XC-5]
- **Keeping parallel legacy scenario tests:** scenario rules require port/delete in the same behavior phase. [CITED: Test Plan §7.1; VERIFIED: current legacy scenario rows]
- **Broad Phase 128 cleanup inside Phase 127:** final global stale-name audit remains Phase 128 except narrow local absence assertions. [VERIFIED: `127-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP JSON results | Ad hoc `JSON.stringify` payloads in each handler | `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `documentIdentification`, `withWarnings` | Keeps `isError` and envelope semantics consistent. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: Context7 MCP SDK docs] |
| Document archive semantics | A second custom archive path inside `remove_document` | Existing `archive_document` logic and helper patterns, factored if needed | `archive_document` already sets `status:"archived"`, `archived_at`, frontmatter, and DB state. [VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/mcp/utils/response-formats.ts`] |
| Vault path safety | Raw path concatenation or string-prefix checks | `validateVaultPath`, `normalizePath`, `sanitizeDirectorySegment`, `validateSegment` | Existing utilities handle traversal, root-target rejection, symlinks, segment sanitization, and byte limits. [VERIFIED: `src/mcp/utils/path-validation.ts`] |
| Directory/resource locking | In-memory only locks for directory mutations | `acquireLock`/`releaseLock` with `directory:<path>` resource names | Existing DB-backed locks work across FlashQuery instances. [VERIFIED: `src/services/write-lock.ts`; VERIFIED: `127-CONTEXT.md`] |
| Git staging/commit/push policy | Handler-local shell `git` commands | Extend `VaultManager`/`GitManagerImpl` | Current writes centralize git policy; removal needs the same policy boundary. [VERIFIED: `src/storage/vault.ts`; VERIFIED: `src/git/manager.ts`] |
| Background job persistence | New durable job table | Process-local maintenance service | Locked v1 scope says jobs do not survive restart. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements DAQ-15] |
| Scenario framework | Custom Python/YAML runner | Existing directed and integration scenario runners | Project skills and docs define coverage-first scenario authoring and runner commands. [VERIFIED: `.agents/skills/*`; VERIFIED: `tests/scenarios/directed/WRITING_SCENARIOS.md`; VERIFIED: `tests/scenarios/integration/README.md`] |

**Key insight:** Phase 127 is dangerous because the visible operations mutate or delete filesystem state; safety comes from reusing existing path validation, lifecycle, lock, git, and scenario frameworks rather than inventing parallel mechanisms. [VERIFIED: current codebase patterns; VERIFIED: `127-CONTEXT.md`]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `fqc_documents` stores `status`, `archived_at`, `path`, and content hashes; `fqc_write_locks` stores active locks by `resource_type`. [VERIFIED: `src/storage/supabase.ts`; VERIFIED: `src/services/write-lock.ts`] | Code must update document rows to archived before file movement/deletion; no data migration for legacy tool names was found. [VERIFIED: `127-CONTEXT.md`] |
| Live service config | `flashquery.yml` and fixtures may contain host/delegated tool selectors; current grep did not find Phase 127 legacy tool names in root `flashquery.yml`, but tests still contain legacy config/tool references. [VERIFIED: `rg` over `flashquery*.yml`, `.env*`, `src`, `tests`] | Port or delete tests/scenarios that call `create_directory`, `remove_directory`, `force_file_scan`, or `reconcile_documents`; keep suggestion-map references only where config validation needs them. [CITED: Test Plan §6-§7] |
| OS-registered state | None found in repo research; FlashQuery runs as CLI/MCP subprocess and no launchd/systemd/pm2 files were found in the phase scope. [VERIFIED: `AGENTS.md`; VERIFIED: repo file listing] | None for planning; no OS re-registration task required. [VERIFIED: repo audit] |
| Secrets/env vars | `.env.test` exists locally; no env var or secret key names tied to legacy Phase 127 tool names were found. [VERIFIED: environment audit; VERIFIED: `rg` over `.env*`] | No secret rename required; integration/E2E/scenario execution still depends on `.env.test` values. [VERIFIED: `AGENTS.md`; VERIFIED: environment audit] |
| Build artifacts | `node_modules` and `dist/` exist; no generated artifact rename is required for Phase 127. [VERIFIED: repo listing; VERIFIED: environment audit] | Run `npm run build` after implementation; no reinstall task required unless dependencies change. [VERIFIED: `package.json`; VERIFIED: `.planning/ROADMAP.md`] |

## Common Pitfalls

### Pitfall 1: Archive/Filesystem Ordering Reversal
**What goes wrong:** The file is moved/deleted before the DB and frontmatter lifecycle state is archived. [CITED: Test Plan §4.5 U5/I1-I5]
**Why it happens:** Existing `archive_document` and filesystem operations live in different code paths. [VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/storage/vault.ts`]
**How to avoid:** Factor or reuse archive transition logic so archived state and `archived_at` are persisted before `rename`/`unlink`. [VERIFIED: `127-CONTEXT.md`]
**Warning signs:** Repair or search reclassifies an intentionally removed document as `missing`. [CITED: Test Plan §4.5 I5]

### Pitfall 2: Trash Folder Reintroduced Into Search
**What goes wrong:** A moved trash file is scanned as a normal active document because it still has `fq_id`. [VERIFIED: scanner indexes markdown files with frontmatter; CITED: Test Plan §4.5 I2/I5]
**Why it happens:** The locked trash config intentionally omits a separate indexing exclusion flag. [VERIFIED: `127-CONTEXT.md`]
**How to avoid:** Ensure trash-moved files have archived status/frontmatter before the move, preserve `original_path`, and test default search exclusion. [VERIFIED: `127-CONTEXT.md`; CITED: Test Plan §4.5]
**Warning signs:** Default `search` returns removed/trash files. [CITED: Integration Scenario INT-rdoc-1/2]

### Pitfall 3: Lock Scope Too Broad Or Too Narrow
**What goes wrong:** Directory operations either block unrelated document writes or race on the same directory path. [VERIFIED: current `remove_directory` uses `documents` lock; VERIFIED: current `create_directory` avoids locking]
**Why it happens:** Legacy tools had asymmetric locking. [VERIFIED: `src/mcp/tools/files.ts`; VERIFIED: `127-CONTEXT.md`]
**How to avoid:** Use per-path resource names such as `directory:${normalizedPath}` for both actions. [VERIFIED: `127-CONTEXT.md`]
**Warning signs:** Tests assert no lock for create, or lock contention tests only cover remove. [VERIFIED: `tests/unit/files-tools.test.ts`; CITED: Test Plan §4.6 U7]

### Pitfall 4: Maintenance Status Scope Creep
**What goes wrong:** `maintain_vault(status)` becomes an internal scanner dashboard. [CITED: Requirements XC-11 and DAQ-16]
**Why it happens:** Existing `force_file_scan` exposes `embedding_status`/`embeds_awaited` and scanner implementation details. [VERIFIED: `src/mcp/tools/scan.ts`]
**How to avoid:** Return only job-level state and action counts; assert forbidden fields are absent. [VERIFIED: `127-CONTEXT.md`; CITED: Test Plan §4.7 U8]
**Warning signs:** Output fields like `queue_depth`, `hash`, `embedding_status`, `availability`, or per-document sync state appear. [CITED: Test Plan §4.7 U8]

### Pitfall 5: Scenario Fossils
**What goes wrong:** Active scenario files keep calling `create_directory`, `remove_directory`, `force_file_scan`, or `reconcile_documents`. [VERIFIED: current `rg` over `tests/scenarios`]
**Why it happens:** Legacy scenario coverage is broad and spread across directed and YAML integration suites. [VERIFIED: `tests/scenarios/directed/DIRECTED_COVERAGE.md`; VERIFIED: `tests/scenarios/integration/INTEGRATION_COVERAGE.md`]
**How to avoid:** Update coverage rows first, then port/delete files in the same plan wave. [CITED: Test Plan §7.1-§7.4]
**Warning signs:** `scan_vault` still maps to `force_file_scan` after `maintain_vault` lands. [VERIFIED: `tests/scenarios/integration/README.md`; VERIFIED: `tests/scenarios/framework/fqc_test_utils.py`]

## Code Examples

Verified patterns from official/project sources:

### MCP Tool Result Shape
```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk and src/mcp/utils/response-formats.ts
return {
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  isError: false,
};
```

### Archive Identification Result
```typescript
// Source: src/mcp/utils/response-formats.ts
return {
  ...documentIdentification(input),
  status: 'archived',
  archived_at: input.archived_at,
};
```

### Git-Aware Write Policy Boundary
```typescript
// Source: src/storage/vault.ts
if (options?.gitAction && options?.gitTitle) {
  void gitManager
    ?.commitVaultChanges(options.gitAction, options.gitTitle, relativePath)
    .catch((err) => logger.warn(`Git: commitVaultChanges error: ${String(err)}`));
}
```

### DB-Backed Lock Pattern
```typescript
// Source: src/services/write-lock.ts
const locked = await acquireLock(client, config.instance.id, resourceType, {
  ttlSeconds: config.locking.ttlSeconds,
});
if (!locked) {
  return jsonExpectedError({
    error: 'conflict',
    message: 'Lock contention.',
    details: { reason: 'lock_contention' },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `create_directory` and `remove_directory` as separate tools | `manage_directory(action:"create"|"remove")` | Phase 127 target, specified 2026-05-12 | Planner should port existing directory behavior into one JSON/batch/locked surface. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements §4.39] |
| `force_file_scan` and `reconcile_documents` as separate sync/repair tools | `maintain_vault(action:"sync"|"repair"|"status"|["repair","sync"])` | Phase 127 target, specified 2026-05-12 | Planner should consolidate scan/repair/status/background/conflict behavior into one admin tool. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements §4.40] |
| Archive only hides documents | `remove_document` archives then trash-moves or hard-deletes files | Phase 127 target, specified 2026-05-12 | Planner must handle destructive filesystem state and git policy, not only DB status. [VERIFIED: `.planning/ROADMAP.md`; CITED: Requirements §4.41] |
| Prose/key-value responses | JSON envelopes with canonical expected errors | Phase 121 onward | Planner must include old prose assertion grep and JSON assertion migration. [VERIFIED: `src/mcp/utils/response-formats.ts`; VERIFIED: Phase 121-126 summaries] |

**Deprecated/outdated:**
- `create_directory`, `remove_directory`, `force_file_scan`, and `reconcile_documents` as active public surfaces are merged in this phase and should not remain in active tests/scenarios after their coverage is ported. [CITED: Test Plan §6; VERIFIED: `127-CONTEXT.md`]
- `scan_vault` runner alias currently maps to `force_file_scan`; Phase 127 planning must update or deliberately bridge this alias to `maintain_vault(action:"sync")`. [VERIFIED: `tests/scenarios/integration/README.md`; VERIFIED: `tests/scenarios/framework/fqc_test_utils.py`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `src/services/maintenance.ts` is the best file name for process-local maintenance job state. [ASSUMED] | Recommended Project Structure | Low; implementation can choose another module boundary while preserving the service pattern. |
| A2 | The exact YAML runner ergonomics for replacing `scan_vault` are implementation detail. [ASSUMED] | Open Questions | Medium; planner may need to choose between direct final-tool YAML actions and a temporary runner helper. |
| A3 | Research remains valid until 2026-06-11 for local codebase patterns. [ASSUMED] | Metadata | Low; product docs or package versions may change before planning execution. |

## Open Questions

1. **Should Phase 127 update the YAML integration runner alias `scan_vault` directly or add a new `maintain_vault` action helper and port files gradually inside the phase?**
   - What we know: The test plan says replace scan/repair steps with `maintain_vault`; current YAML docs map `scan_vault` to `force_file_scan`. [CITED: Test Plan §7.3; VERIFIED: `tests/scenarios/integration/README.md`]
   - What's unclear: The exact runner ergonomics are implementation detail. [ASSUMED]
   - Recommendation: Prefer adding/using final `maintain_vault` YAML actions in Phase 127 scenarios, and keep only a temporary runner compatibility shim if required to avoid unrelated scenario churn. [VERIFIED: Test Plan requires no parallel legacy scenarios after removal]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript build/tests/dev server | ✓ | `v24.7.0` | Project minimum is Node >=20. [VERIFIED: environment audit; VERIFIED: `package.json`] |
| npm | Package scripts and `npm view` | ✓ | `11.5.1` | None needed. [VERIFIED: environment audit] |
| `node_modules` | Local tests/build | ✓ | Present | Run `npm install` if missing. [VERIFIED: environment audit] |
| Git CLI | Git policy tests and VaultManager/GitManager behavior | ✓ | `git version 2.50.1 (Apple Git-155)` | Unit-mock partial git matrix if remote push is infeasible. [VERIFIED: environment audit; CITED: Test Plan §4.5 I7] |
| Python 3 | Directed and YAML scenario runners | ✓ | `Python 3.12.3` | None needed for scenario execution. [VERIFIED: environment audit] |
| `.env.test` | Integration/E2E tests using Supabase/provider config | ✓ | Present | Existing helpers skip missing/incomplete external credentials. [VERIFIED: environment audit; VERIFIED: `AGENTS.md`] |
| Supabase service | Integration/E2E/scenario DB assertions | Not directly probed | — | Existing tests skip or managed scenario harness handles setup where configured. [VERIFIED: `AGENTS.md`; VERIFIED: `tests/helpers/test-env.ts` referenced by instructions] |

**Missing dependencies with no fallback:**
- None found in local CLI/tooling audit. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- Remote git push behavior may be impractical locally; Test Plan permits some matrix coverage at unit level when remote push is infeasible. [CITED: Test Plan §4.5 I7]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` installed; npm latest `4.1.6`. [VERIFIED: `package.json`; VERIFIED: npm registry] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: tests config listing] |
| Quick run command | `npm test -- tests/unit/remove-document.test.ts tests/unit/manage-directory.test.ts tests/unit/maintain-vault.test.ts` [VERIFIED: `package.json`; CITED: Test Plan §4.5-§4.7] |
| Full suite command | `npm test && npm run test:integration && npm run test:e2e && npm run build` [VERIFIED: `package.json`; VERIFIED: `.planning/ROADMAP.md`] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DOC-09 | Remove document archive-before-delete/trash, ordered batch, trash config, git policy | unit/integration/e2e/scenario | `npm test -- tests/unit/remove-document.test.ts` and `npm run test:integration -- tests/integration/remove-document.integration.test.ts` | ❌ Wave 0 |
| SYS-01 | Create directories through `manage_directory(action:"create")` with ordered results and directory locks | unit/integration/e2e/scenario | `npm test -- tests/unit/manage-directory.test.ts` and `npm run test:integration -- tests/integration/manage-directory.integration.test.ts` | ❌ Wave 0 |
| SYS-02 | Remove empty directories through `manage_directory(action:"remove")`, conflict on non-empty | unit/integration/e2e/scenario | `npm test -- tests/unit/manage-directory.test.ts` and `npm run test:integration -- tests/integration/manage-directory.integration.test.ts` | ❌ Wave 0 |
| SYS-03 | Sync/repair/status/background/conflict through `maintain_vault` | unit/integration/e2e/scenario | `npm test -- tests/unit/maintain-vault.test.ts` and `npm run test:integration -- tests/integration/maintain-vault.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** focused unit test for touched tool plus `npm run build` when exported types or registration changes. [VERIFIED: Phase 126 summaries]
- **Per wave merge:** focused unit + integration + `npm run test:e2e -- tests/e2e/protocol.test.ts`. [VERIFIED: Phase 126 summaries]
- **Phase gate:** `npm test`, focused integration set, E2E protocol, directed scenario command, YAML integration command, removed-tool/prose/frontmatter greps, and `npm run build`. [VERIFIED: `127-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

### Wave 0 Gaps
- [ ] `.planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md` — maps `DOC-09`, `SYS-01`, `SYS-02`, `SYS-03` to all five evidence layers. [VERIFIED: `127-CONTEXT.md`]
- [ ] `tests/unit/remove-document.test.ts` — covers Test Plan §4.5 U1-U8. [CITED: Test Plan §4.5]
- [ ] `tests/unit/manage-directory.test.ts` — covers Test Plan §4.6 U1-U7. [CITED: Test Plan §4.6]
- [ ] `tests/unit/maintain-vault.test.ts` — covers Test Plan §4.7 U1-U9. [CITED: Test Plan §4.7]
- [ ] `tests/integration/remove-document.integration.test.ts`, `tests/integration/manage-directory.integration.test.ts`, `tests/integration/maintain-vault.integration.test.ts` — focused integration targets. [CITED: Test Plan §4.5-§4.7]
- [ ] Directed and YAML coverage rows must be updated before scenario files. [CITED: Test Plan §7.4]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No direct new auth surface | Existing MCP auth/server config remains unchanged. [VERIFIED: Phase scope; VERIFIED: `src/mcp/auth.ts` exists] |
| V3 Session Management | No | MCP is stateless and project instructions forbid server-side session state. [VERIFIED: `AGENTS.md`] |
| V4 Access Control | Yes | Host tool exposure metadata categories and admin hard exclusions must keep `maintain_vault` as system/admin and `manage_directory` as doc-write/read-write. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `127-CONTEXT.md`] |
| V5 Input Validation | Yes | Zod input schemas plus `validateVaultPath`, `normalizePath`, segment validation, and canonical `invalid_input` envelopes. [VERIFIED: `src/config/loader.ts`; VERIFIED: `src/mcp/utils/path-validation.ts`; VERIFIED: `src/mcp/utils/response-formats.ts`] |
| V6 Cryptography | No new crypto | Phase uses existing git/filesystem/database behavior; no custom crypto should be added. [VERIFIED: phase scope] |
| V7 Error Handling | Yes | Expected destructive/admin errors return structured JSON with `isError:false`; runtime failures use `jsonRuntimeError`. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: Context7 MCP SDK docs] |
| V12 File and Resources | Yes | Path traversal, symlink, root-target, non-empty directory, trash collision, and destructive delete/move controls are core requirements. [VERIFIED: `src/mcp/utils/path-validation.ts`; CITED: Test Plan §4.5-§4.7] |

### Known Threat Patterns for FlashQuery Filesystem/Admin Tools

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal out of vault | Tampering / Information Disclosure | `validateVaultPath` with `resolve` + `relative` confinement and tests for traversal. [VERIFIED: `src/mcp/utils/path-validation.ts`] |
| Symlink escape or destructive action through symlink | Tampering / Elevation | Existing path validation rejects symlinks on existing path segments; tests must retain this for final tools. [VERIFIED: `src/mcp/utils/path-validation.ts`; CITED: Test Plan §4.6] |
| Accidental recursive deletion | Tampering / Denial of Service | `manage_directory(remove)` removes only empty directories and returns `conflict` for non-empty. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements §4.39] |
| Silent destructive commit/push | Repudiation / Tampering | Route file removal through GitManager policy and test auto-commit/auto-push matrix. [VERIFIED: `src/git/manager.ts`; CITED: Test Plan §4.5 I7] |
| Scanner state leakage | Information Disclosure | `maintain_vault(status)` exposes job-level status only. [VERIFIED: `127-CONTEXT.md`; CITED: Requirements XC-11] |
| Concurrent destructive/admin operations | Tampering / Denial of Service | Directory-scoped locks for directory operations and single in-flight maintenance conflict for vault maintenance. [VERIFIED: `127-CONTEXT.md`; VERIFIED: `src/services/write-lock.ts`] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/127-removal-directory-and-vault-maintenance/127-CONTEXT.md` — locked user decisions and phase boundary. [VERIFIED]
- `.planning/ROADMAP.md` — Phase 127 success criteria and dependency on Phase 126. [VERIFIED]
- `.planning/REQUIREMENTS.md` — DOC-09, SYS-01, SYS-02, SYS-03. [VERIFIED]
- MCP Tool Consolidation Requirements — cross-cutting decisions plus §4.39-§4.41 and DAQ clarifications. [CITED: local product doc]
- MCP Tool Consolidation Test Plan — high-risk contracts §4.5-§4.7 and migration rules §6-§7. [CITED: local product doc]
- `src/mcp/tools/files.ts`, `src/mcp/tools/documents.ts`, `src/mcp/tools/scan.ts`, `src/storage/vault.ts`, `src/git/manager.ts`, `src/services/write-lock.ts`, `src/mcp/utils/response-formats.ts`, `src/mcp/tool-metadata.ts`, `src/config/loader.ts`. [VERIFIED]
- Context7 `/modelcontextprotocol/typescript-sdk` — MCP `registerTool`, Zod schema, `CallToolResult`, and `isError` semantics. [CITED: Context7]
- npm registry checks for `@modelcontextprotocol/sdk`, `zod`, `simple-git`, `vitest`, `tsx`, and `tsup`. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- `.agents/skills/flashquery-directed-*` and `flashquery-integration-*` skills — project scenario coverage/test workflow conventions. [VERIFIED: local skill docs]
- Phase 126 `126-RESEARCH.md`, `126-PATTERNS.md`, and `126-*-SUMMARY.md` — latest consolidation pattern. [VERIFIED]

### Tertiary (LOW confidence)
- None used for requirements or implementation recommendations. [VERIFIED: source list]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package versions verified via local `package.json` and npm registry. [VERIFIED]
- Architecture: HIGH — based on current source files and locked product docs. [VERIFIED; CITED]
- Pitfalls: HIGH — derived from current legacy code, Phase 127 context, and test-plan high-risk contracts. [VERIFIED; CITED]

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 for local codebase patterns; re-check npm/package versions and product docs if planning occurs after that date. [ASSUMED]
