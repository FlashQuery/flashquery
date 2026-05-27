# Phase 160: Folder Locks + Manage Directory Migration - Research

**Researched:** 2026-05-27 [VERIFIED: gsd-sdk init.phase-op]
**Domain:** PostgreSQL session advisory locks, FlashQuery vault file writes, and `manage_directory` migration [VERIFIED: .planning/phases/160-folder-locks-manage-directory-migration/160-CONTEXT.md]
**Confidence:** HIGH for implementation shape, MEDIUM for current-test executability because `.env.test` uses a likely transaction-mode Supabase pooler URL [VERIFIED: tests/helpers/test-env.ts; .env.test grep]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01: Canonical Source Documents
- Downstream planner, executor, checker, reviewer, and verifier agents MUST read these two source documents before making implementation decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`
- These external docs are canonical for phase requirements, acceptance criteria, test IDs, and known assumptions. If local `.planning/REQUIREMENTS.md` and these docs disagree, stop and surface the conflict.
- For implementation questions, consult those docs first. Ask the user only if the docs do not answer the question or conflict with current repo reality.

### D-02: REQ-007 Shared Ancestor Directory Locks
- Every file write must hold shared global-tier advisory locks on each ancestor directory from the file's parent up to the vault root while it holds or performs the file write.
- Shared directory locks MUST use Postgres shared advisory locks, expected as `pg_advisory_lock_shared`, with the `dir:` canonical directory key from REQ-003 / Phase 159.
- Shared directory locks coexist, so two concurrent writes under the same folder must not serialize merely because they share an ancestor folder.
- Directory locks are global-tier only; the existing Tier 1 in-process registry remains file-only.
- File write composition should follow the requirements direction: a file write wraps its existing `withDocumentLock` critical section with ancestor shared directory locks. Preserve the existing per-file write serialization and timeout semantics from Phases 155, 158, and 159.

### D-03: REQ-024 Exclusive `manage_directory` Locks
- `manage_directory` in `src/mcp/tools/files.ts` must take an exclusive advisory directory lock on the operated-on folder before structural operations that can invalidate existing paths.
- Preserve caller-visible `manage_directory` response semantics: ordered per-path JSON results, outer `isError: false`, and unchanged conflict envelope shape for contention/conflict cases.
- Two concurrent `manage_directory` operations on the same folder must not both proceed. One should succeed and the other should return the existing `conflict` / `lock_contention` shape or the Phase 159 `lock_timeout` reason if the holder exceeds the configured timeout.
- Folder creation is additive and MUST NOT take an exclusive directory lock. It should retain idempotent create behavior.
- A folder rename/move/delete must conflict with in-flight descendant file writes that hold shared ancestor locks, waiting until they complete or timing out per REQ-006.

### D-04: Required Test Scope
- Integration tests MUST include Test Plan §4.1.7 cases `T-I-011`, `T-I-012`, and `T-I-013` in `tests/integration/folder-lock.integration.test.ts`.
- Integration tests MUST include Test Plan §4.5.2 cases `T-I-046` and `T-I-047` in `tests/integration/manage-directory-advisory-lock.integration.test.ts`.
- Integration scenario coverage MUST include `T-Y-001` / `INT-WCO-01` in `tests/scenarios/integration/tests/folder_coordination.yml` when the YAML scenario lands.
- Required execution evidence from the roadmap is:
  - `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"`
  - integration scenario `INT-WCO-01` when the YAML scenario lands.
- Plans should include exact test names/patterns and may include direct file/testNamePattern fallbacks if local Vitest grep behavior requires them.

### D-05: Current Repo Starting Point
- `src/services/document-lock.ts` currently exports `LockTimeoutError`, `withDocumentLock`, `withDocumentLocks`, and `__testing`; there is no shared/exclusive directory-lock helper yet.
- Phase 159 introduced canonical `file:` / `dir:` key derivation internally via `toEntry(config, path, kind)`, but only file-lock exports are currently public. Phase 160 should add narrow directory-lock helper exports without leaking lower-level advisory primitives broadly.
- Document and compound write call sites currently use `withDocumentLock` / `withDocumentLocks`; this phase should layer shared ancestor directory locks around those writes without regressing existing lock timeout handling.
- `src/mcp/tools/files.ts` currently implements `manage_directory` directly with `mkdir`, `stat`, `readdir`, and `rmdir`, and has no advisory lock import. This is the main migration target for REQ-024.

### the agent's Discretion
- Exact helper names are discretionary, but the requirements examples are `withAncestorDirectoryLocksShared(filePath, fn)` and `withDirectoryLockExclusive(dirPath, fn)`.
- The exact implementation of ancestor enumeration is discretionary if it uses canonical absolute directories, includes the file parent through vault root, and never escapes the configured vault root.
- Tests may use targeted helper-level delay hooks, public tool concurrency, or `pg_locks` inspection helpers, but must prove the required shared/exclusive behavior rather than only source-level wrapping.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

Destination-path locking and EXDEV fallback remain Phase 161. Version tokens remain Phase 162. Multi-file batch contracts remain Phase 163. Macro-specific semantics remain outside Phase 160.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-007 | Shared/exclusive directory locks for folder operations. [CITED: external Requirements §6.1.7] | Use `dir:` canonical keys, shared session advisory locks for ancestor dirs on file writes, exclusive session advisory locks for structural folder ops, and keep Tier 1 file-only. [VERIFIED: PostgreSQL docs; src/services/document-lock.ts] |
| REQ-024 | `manage_directory` migrates from table-keyed `directory:` locking to advisory directory locks. [CITED: external Requirements §6.5.2] | Wrap current `remove` structural path in an exclusive `dir:` advisory lock, preserve ordered `results` plus outer `isError: false`, and keep `create` lock-free. [VERIFIED: src/mcp/tools/files.ts] |
</phase_requirements>

## Summary

Phase 160 should extend the existing `src/services/document-lock.ts` facade, not create a parallel locking subsystem. [VERIFIED: src/services/document-lock.ts] Phase 159 already has canonical `file:` and `dir:` entry derivation through the private `toEntry(config, path, kind)` helper, and Phase 160 needs to expose narrow directory helper functions while keeping advisory-key derivation and SQL private. [VERIFIED: src/services/document-lock.ts:165]

The core design is a readers-writer directory protocol implemented with PostgreSQL session advisory locks: file writes acquire shared locks for every ancestor directory, and structural folder operations acquire an exclusive lock on the operated folder. [CITED: external Requirements §6.1.7; CITED: https://www.postgresql.org/docs/current/functions-admin.html] PostgreSQL shared advisory locks do not conflict with other shared locks on the same resource, but they conflict with exclusive locks. [CITED: https://www.postgresql.org/docs/current/functions-admin.html]

**Primary recommendation:** Add `withAncestorDirectoryLocksShared(config, filePath, fn)` and `withDirectoryLockExclusive(config, dirPath, fn)` to `document-lock.ts`, route every document/compound/scanner write through the shared wrapper around existing per-file locks, and wrap only `manage_directory(action: "remove")` in the exclusive helper while leaving `create` unchanged. [VERIFIED: src/services/document-lock.ts; src/mcp/tools/files.ts; CITED: external Requirements §6.1.7 and §6.5.2]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20, TypeScript strict mode, ESM modules, `@modelcontextprotocol/sdk`, Supabase, `pg`, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md; package.json]
- Do not use CommonJS or `require`. [VERIFIED: AGENTS.md]
- Do not use `@modelcontextprotocol/server`; the project uses `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- MCP tools return `{ content: [{ type: "text", text: "..." }] }`; expected conflict responses should use human-readable JSON text and outer `isError: false` when they are caller-visible expected errors. [VERIFIED: AGENTS.md; src/mcp/tools/files.ts]
- Integration tests require `.env.test`; Supabase-dependent tests skip gracefully when credentials are missing or unsuitable. [VERIFIED: AGENTS.md; tests/helpers/test-env.ts]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| File write ancestor coordination | API / Backend | Database / Storage | Tool handlers initiate writes, but global exclusion is enforced through Postgres advisory locks and vault paths. [VERIFIED: src/mcp/tools/documents/write.ts; src/services/document-lock.ts] |
| Structural folder coordination | API / Backend | Database / Storage | `manage_directory` validates paths and performs filesystem actions; the lock helper owns advisory coordination. [VERIFIED: src/mcp/tools/files.ts] |
| Advisory lock persistence and cleanup | Database / Storage | API / Backend | PostgreSQL session advisory locks are held by backend sessions and are released by explicit unlock or session end. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html] |
| Caller-visible conflict envelopes | API / Backend | — | MCP handlers shape expected conflicts into JSON result payloads. [VERIFIED: src/mcp/tools/files.ts; src/mcp/tools/documents/write.ts] |
| Integration scenario evidence | Test Infrastructure | API / Backend | Vitest integration tests and YAML scenarios exercise public tool behavior plus `pg_locks` inspection where needed. [CITED: external Test Plan §4.1.7 and §4.5.2; VERIFIED: tests/config/vitest.integration.config.ts] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | Current local `v24.7.0`; project requires `>=20`. [VERIFIED: node --version; package.json] | Runtime for CLI/MCP process. | Existing project runtime. [VERIFIED: AGENTS.md] |
| TypeScript | Project dev dependency `^6.0.2`. [VERIFIED: package.json] | Strict ESM source language. | Existing project language and typecheck gate. [VERIFIED: AGENTS.md; package.json] |
| `pg` | Project range `^8.21.0`; npm latest `8.21.0`, modified 2026-05-18. [VERIFIED: package.json; npm registry] | Session-capable PostgreSQL clients for advisory locks. | Existing lock tier uses `withPgClient` and `PoolClient`. [VERIFIED: src/services/document-lock.ts; src/utils/pg-client.ts] |
| PostgreSQL advisory lock functions | PostgreSQL current docs v18. [CITED: https://www.postgresql.org/docs/current/functions-admin.html] | `pg_try_advisory_lock`, `pg_try_advisory_lock_shared`, `pg_advisory_unlock`, `pg_advisory_unlock_shared`. | Native shared/exclusive session locks match REQ-007 and REQ-024. [CITED: external Requirements §7.1] |
| Vitest | Project range `^4.1.1`; npm latest `4.1.7`, modified 2026-05-20. [VERIFIED: package.json; npm registry] | Unit and integration test runner. | Existing `npm test` and `npm run test:integration` scripts. [VERIFIED: package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `async-mutex` | Project range `^0.5.0`; npm latest `0.5.0`. [VERIFIED: package.json; npm registry] | Existing Tier 1 file mutex stripes. | Keep for file locks only; directory locks are global-tier only per REQ-007. [VERIFIED: src/services/document-lock.ts; CITED: external Requirements §6.1.7] |
| `@modelcontextprotocol/sdk` | Project range `^1.29.0`; npm latest `1.29.0`. [VERIFIED: package.json; npm registry] | MCP tool registration types. | Existing `registerTool` API in `files.ts` and document tool modules. [VERIFIED: src/mcp/tools/files.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg_try_advisory_lock_shared` retry loop | Blocking `pg_advisory_lock_shared` plus `lock_timeout` | Existing Phase 159 chose bounded retry loops for exclusive document locks; mirroring it keeps one timeout mechanism. [VERIFIED: src/services/document-lock.ts:232; .planning/phases/159-lock-timeout-canonical-key-derivation/159-02-SUMMARY.md] |
| Shared/exclusive advisory locks | A new lock table | The lock table was retired in Phase 158 and must not be recreated. [VERIFIED: .planning/phases/158-tier-2-lock-table-retirement-session-check/158-02-SUMMARY.md] |
| Directory Tier 1 mutexes | Reuse `async-mutex` stripes for dirs | REQ-007 explicitly says directory locks are global-tier only and Tier 1 remains file-only. [CITED: external Requirements §6.1.7] |

**Installation:** No new package installation is required for this phase. [VERIFIED: package.json; codebase grep]

## Package Legitimacy Audit

No new external packages should be installed for Phase 160. [VERIFIED: package.json; phase scope] Existing relevant packages were spot-checked because they are part of the implementation/test stack. [VERIFIED: slopcheck output; npm registry]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `pg` | npm | Created 2010-12-19; modified 2026-05-18. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/brianc/node-postgres`. [VERIFIED: npm registry] | OK [VERIFIED: slopcheck] | Existing dependency; approved. |
| `@modelcontextprotocol/sdk` | npm | Created 2024-11-11; modified 2026-03-30. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/modelcontextprotocol/typescript-sdk`. [VERIFIED: npm registry] | OK [VERIFIED: slopcheck] | Existing dependency; approved. |
| `async-mutex` | npm | Created 2016-10-12; modified 2024-03-11. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/DirtyHairy/async-mutex`. [VERIFIED: npm registry] | OK [VERIFIED: slopcheck] | Existing dependency; keep file-only. |
| `vitest` | npm | Created 2021-12-03; modified 2026-05-20. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/vitest-dev/vitest`. [VERIFIED: npm registry] | SUS: slopcheck flagged name similarity to `vite`. [VERIFIED: slopcheck] | Existing dev dependency; do not newly install; planner does not need a package checkpoint because no install is planned. |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]
**Packages flagged as suspicious [SUS]:** `vitest`, existing dev dependency only. [VERIFIED: slopcheck; package.json]

## Architecture Patterns

### System Architecture Diagram

```text
write_document / archive / remove / copy / move / compound / scanner
  -> validate/resolve file path
  -> withAncestorDirectoryLocksShared(config, filePath)
      -> enumerate canonical dirs: parent -> ... -> vault root
      -> derive dir:<canonical-path> advisory keys
      -> acquire pg_try_advisory_lock_shared on one PoolClient with Phase 159 timeout
      -> withDocumentLock / withDocumentLocks existing per-file critical section
      -> vault file write
      -> release shared directory locks in reverse order

manage_directory(action:"create")
  -> validate/sanitize path
  -> mkdir/stat path
  -> ordered result item

manage_directory(action:"remove")
  -> validate/sanitize path
  -> withDirectoryLockExclusive(config, absDir)
      -> derive dir:<canonical-path> advisory key
      -> acquire pg_try_advisory_lock on one PoolClient with Phase 159 timeout
      -> stat/readdir/rmdir
      -> release exclusive lock
  -> ordered result item / expected conflict envelope
```

All lock helper SQL should stay inside `src/services/document-lock.ts`. [VERIFIED: src/services/document-lock.ts; tests/unit/lock-helper-only.test.ts]

### Recommended Project Structure

```text
src/
├── services/
│   └── document-lock.ts          # add directory helper facade; keep advisory primitives private
├── mcp/tools/
│   ├── documents/*.ts            # wrap file-write critical sections with ancestor shared dir locks
│   ├── compound.ts               # wrap compound file mutations with ancestor shared dir locks
│   └── files.ts                  # wrap structural manage_directory remove with exclusive dir lock
tests/
├── unit/
│   ├── with-directory-lock.test.ts
│   └── lock-helper-only.test.ts
└── integration/
    ├── folder-lock.integration.test.ts
    └── manage-directory-advisory-lock.integration.test.ts
```

### Pattern 1: Directory helper facade

**What:** Extend `document-lock.ts` with directory-specific helpers using `kind: "dir"` entries, shared/exclusive mode, one checked-out `PoolClient`, bounded retry, and reverse-order unlock. [VERIFIED: src/services/document-lock.ts; CITED: external Requirements §7.1]

**When to use:** Use shared helper around file writes and exclusive helper around structural folder operations. [CITED: external Requirements §6.1.7 and §6.5.2]

**Example:**

```ts
// Source: PostgreSQL advisory lock functions + existing Phase 159 retry style.
// [CITED: https://www.postgresql.org/docs/current/functions-admin.html]
export async function withAncestorDirectoryLocksShared<T>(
  config: FlashQueryConfig,
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const entries = await ancestorDirectoryEntries(config, filePath);
  return runWithAdvisoryLocks(config, entries, 'shared', fn);
}
```

### Pattern 2: Shared wraps file-specific lock

**What:** File writes should hold directory shared locks while the existing per-file document lock critical section runs. [CITED: external Requirements §6.1.7]

**When to use:** In `write_document`, `archive_document`, `remove_document`, `copy_document`, `move_document`, compound mutations, and scanner frontmatter repairs. [VERIFIED: codebase grep for `withDocumentLock` call sites]

**Example:**

```ts
// Source: canonical requirement direction. [CITED: external Requirements §6.1.7]
return withAncestorDirectoryLocksShared(config, absolutePath, async () =>
  withDocumentLock(config, absolutePath, async () => {
    // existing write logic unchanged
  })
);
```

### Pattern 3: Exclusive only for structural `manage_directory`

**What:** Current `manage_directory` supports `create` and `remove`; only `remove` invalidates an existing path and should take the exclusive lock. [VERIFIED: src/mcp/tools/files.ts:55]

**When to use:** Wrap the section that `stat`s, `readdir`s, and `rmdir`s the target directory. [VERIFIED: src/mcp/tools/files.ts:221]

**Example:**

```ts
// Source: REQ-024 and current files.ts structure. [CITED: external Requirements §6.5.2]
const result = await withDirectoryLockExclusive(config, absPath, async () => {
  const dirStat = await stat(absPath);
  const entries = await readdir(absPath);
  if (entries.length > 0) return directoryNotEmptyConflict(entries.length);
  await rmdir(absPath);
  return directoryResult({ path: safePath, action, status: 'removed', timestamp });
});
```

### Anti-Patterns to Avoid

- **Adding directory locks to Tier 1:** REQ-007 says directory locks are global-tier only. [CITED: external Requirements §6.1.7]
- **Locking folder creation exclusively:** Folder creation is additive and must not take an exclusive directory lock. [CITED: external Requirements §6.1.7]
- **Exporting raw advisory primitives:** Existing static guard expects only facade helpers plus `__testing` from `document-lock.ts`; widen the allowed exports narrowly. [VERIFIED: tests/unit/lock-helper-only.test.ts]
- **Using blocking `pg_advisory_lock*` without a timeout:** INV-04 forbids block-forever waits, and Phase 159 implemented bounded retry loops. [CITED: external Requirements §4; VERIFIED: src/services/document-lock.ts:223]
- **Inspecting `pg_locks` with an inconsistent key formula:** Existing integration helpers reconstruct a signed 64-bit key from SHA-256 resource bytes; directory tests should use the same helper path or `__testing`. [VERIFIED: tests/integration/lock-timeout.integration.test.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process folder exclusion | A new `fqc_write_locks` table or TTL cleanup loop | PostgreSQL session advisory locks | Phase 158 retired the table; PostgreSQL releases session advisory locks at session end. [VERIFIED: Phase 158 summaries; CITED: PostgreSQL docs] |
| Shared/exclusive compatibility | Custom in-memory readers-writer lock | `pg_try_advisory_lock_shared` / `pg_try_advisory_lock` on `dir:` keys | The requirement is cross-process and shared/exclusive semantics already exist in PostgreSQL. [CITED: external Requirements §6.1.7; PostgreSQL docs] |
| Timeout behavior | Sleep-only unbounded waiting | Existing Phase 159 deadline and `LockTimeoutError` pattern | Current document locks already translate timeout into a typed error. [VERIFIED: src/services/document-lock.ts:16] |
| Test lock visibility | Timing assertions only | `pg_locks` inspection plus deterministic gates | Test Plan calls out `pg_locks` visibility as a QA concern. [CITED: external Test Plan §9] |

**Key insight:** The planner should treat directory locking as an extension of the current document-lock facade, not a new service. [VERIFIED: src/services/document-lock.ts; .planning/phases/160-CONTEXT.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None requiring migration; `fqc_write_locks` was retired in Phase 158. [VERIFIED: Phase 158 Plan 02 summary] | No data migration for Phase 160. |
| Live service config | `.env.test` currently contains a likely transaction-mode Supabase pooler URL on `pooler.supabase.com:6543`. [VERIFIED: rg without secret disclosure; tests/helpers/test-env.ts] | Advisory-lock integration tests using `HAS_SESSION_CAPABLE_DATABASE_URL` will skip unless the user supplies a direct/session-capable `DATABASE_URL`. |
| OS-registered state | None found for this phase; no launchd/systemd/pm2 state is involved in folder lock code. [VERIFIED: phase scope and AGENTS.md] | No OS registration task. |
| Secrets/env vars | `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` drive integration tests. [VERIFIED: tests/helpers/test-env.ts] | Do not rename env vars; planner should avoid printing secrets. |
| Build artifacts | `dist/` exists and will be stale after TypeScript edits. [VERIFIED: ls] | Run `npm run build` after implementation. |

## Common Pitfalls

### Pitfall 1: Ancestor list misses the vault root
**What goes wrong:** A folder operation on the vault root or upper folder can race a descendant write if shared locks start too low. [CITED: external Requirements §6.1.7]
**Why it happens:** Implementers often lock only the immediate parent. [ASSUMED]
**How to avoid:** Enumerate from `dirname(filePath)` up to and including canonical vault root, stopping before escape. [CITED: external Requirements §6.1.7]
**Warning signs:** T-I-011 passes for direct child folders but fails for nested descendants. [CITED: external Test Plan §4.1.7]

### Pitfall 2: Directory helper accidentally serializes sibling writes
**What goes wrong:** T-I-012 fails because two writes under `Notes/` block each other on directory locks. [CITED: external Test Plan §4.1.7]
**Why it happens:** The helper uses exclusive locks or Tier 1 mutexes for directories. [CITED: external Requirements §6.1.7]
**How to avoid:** Use `pg_try_advisory_lock_shared` for file-write ancestor locks and no directory Tier 1 lock. [CITED: PostgreSQL docs; external Requirements §6.1.7]
**Warning signs:** Sibling write tests enter sequentially despite different file locks. [VERIFIED: existing per-file integration pattern in tests/integration/per-file-lock.test.ts]

### Pitfall 3: `manage_directory create` takes an exclusive lock
**What goes wrong:** T-I-013 fails because create shows an exclusive advisory lock. [CITED: external Test Plan §4.1.7]
**Why it happens:** A broad wrapper is placed around the whole `manage_directory` loop. [VERIFIED: src/mcp/tools/files.ts current loop]
**How to avoid:** Branch first; wrap only `action === "remove"` with `withDirectoryLockExclusive`. [VERIFIED: src/mcp/tools/files.ts:152]
**Warning signs:** `pg_locks` shows an exclusive `dir:` lock during folder creation. [CITED: external Test Plan §4.1.7]

### Pitfall 4: Response-shape regression in `manage_directory`
**What goes wrong:** A contention or timeout becomes outer `isError: true` or a thrown runtime error instead of an ordered result item. [CITED: external Requirements §6.5.2]
**Why it happens:** `LockTimeoutError` handling is added at the outer tool level rather than per-path inside the loop. [VERIFIED: src/mcp/tools/files.ts current per-path result loop]
**How to avoid:** Catch `LockTimeoutError` inside each path iteration and push the canonical conflict item with `details.reason`. [CITED: external Requirements §7.4]
**Warning signs:** T-I-047 sees a missing `results[1]` entry or `isError: true`. [CITED: external Test Plan §4.5.2]

### Pitfall 5: Test files are not included in integration config
**What goes wrong:** New integration files do not run under `npm run test:integration`. [VERIFIED: Phase 158 Plan 01/02 summaries]
**Why it happens:** `tests/config/vitest.integration.config.ts` has an explicit include list. [VERIFIED: tests/config/vitest.integration.config.ts]
**How to avoid:** Add both new integration files to the include array. [VERIFIED: tests/config/vitest.integration.config.ts]
**Warning signs:** Direct file command finds tests, but broad integration command does not. [VERIFIED: Phase 158 summaries]

## Code Examples

### Shared and exclusive advisory acquire shape

```ts
// Source: PostgreSQL docs + existing document-lock retry loop.
// [CITED: https://www.postgresql.org/docs/current/functions-admin.html]
const sql =
  mode === 'shared'
    ? 'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired'
    : 'SELECT pg_try_advisory_lock($1::bigint) AS acquired';
```

### Unlock shape

```ts
// Source: PostgreSQL docs + existing document-lock unlock checking.
// [CITED: https://www.postgresql.org/docs/current/functions-admin.html]
const sql =
  mode === 'shared'
    ? 'SELECT pg_advisory_unlock_shared($1::bigint) AS released'
    : 'SELECT pg_advisory_unlock($1::bigint) AS released';
```

### Vitest fallback filter

```bash
# Source: Context7 / Vitest docs.
# [CITED: Context7 /vitest-dev/vitest filtering docs]
npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "folder-lock|manage-directory-advisory"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fqc_write_locks` table and manual unlock CLI | Native session-scoped PostgreSQL advisory locks | Phase 158 [VERIFIED: Phase 158 summaries] | Do not recreate table-backed directory locks. |
| Unbounded advisory lock acquisition | `pg_try_advisory_lock` retry loop with `LockTimeoutError` | Phase 159 [VERIFIED: Phase 159 Plan 02 summary] | Directory helpers should reuse the same deadline pattern. |
| Basic document resource key | Canonical `file:` / `dir:` resource strings | Phase 159 [VERIFIED: Phase 159 Plan 01 summary; src/services/document-lock.ts] | Reuse `toEntry(..., "dir")` rather than duplicate canonicalization. |
| `manage_directory` legacy table lock | No advisory directory lock yet after table retirement | Phase 158 removed table calls; Phase 160 adds advisory dir lock [VERIFIED: Phase 158 Plan 02 summary; src/mcp/tools/files.ts] | There is a current gap against REQ-024. |

**Deprecated/outdated:**
- `src/services/write-lock.ts` and `flashquery unlock` were deleted in Phase 158. [VERIFIED: Phase 158 Plan 02 summary]
- `locking.ttl_seconds` is compatibility-only and not effective runtime behavior. [VERIFIED: Phase 158 Plan 02/05 summaries]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Downloads were not collected for npm package audit rows. [ASSUMED] | Package Legitimacy Audit | Low; no package install is planned. |
| A2 | Implementers commonly miss ancestor root locks or accidentally serialize sibling writes. [ASSUMED] | Common Pitfalls | Low; tests directly verify these behaviors. |
| A3 | No OS-registered state participates in this phase. [ASSUMED] | Runtime State Inventory | Low; code changes are repo-local and service-level. |

## Open Questions

1. **Should Phase 160 add public `rename` / `move` actions to `manage_directory`?**
   - What we know: The phase goal names folder rename, move, and delete, while current `manage_directory` schema only accepts `create` and `remove`. [VERIFIED: .planning/ROADMAP.md; src/mcp/tools/files.ts]
   - What's unclear: The canonical REQ-024 focuses on migrating current `manage_directory`; it does not specify a new input schema for folder rename/move. [CITED: external Requirements §6.5.2]
   - Recommendation: Do not add new public actions in Phase 160 unless the planner finds explicit canonical docs requiring them; implement helper shapes that future rename/move can reuse. [VERIFIED: 160-CONTEXT.md deferred scope]

2. **What exact `lock_contention` envelope should be preserved after Phase 158 removed legacy table-lock code from `files.ts`?**
   - What we know: Canonical docs require `error: "conflict"` with `details.reason: "lock_contention"` for directory contention, and `lock_timeout` for Phase 159 timeout cases. [CITED: external Requirements §7.4]
   - What's unclear: Current `files.ts` no longer contains a `lock_contention` branch after Phase 158 retirement. [VERIFIED: src/mcp/tools/files.ts]
   - Recommendation: Treat the canonical docs as authoritative and add explicit per-path `LockTimeoutError` mapping plus a conflict envelope for non-timeout exclusive contention tests. [CITED: 160-CONTEXT.md D-01]

3. **Will the required advisory-lock integration tests execute locally or skip?**
   - What we know: `HAS_SESSION_CAPABLE_DATABASE_URL` is false for likely Supabase transaction pooler URLs on port `6543`, and current `.env.test` matches that pattern. [VERIFIED: tests/helpers/test-env.ts; .env.test grep]
   - What's unclear: Whether the user will provide a direct/session-capable `DATABASE_URL` before execution. [ASSUMED]
   - Recommendation: Planner should include skip-aware verification and call out that full evidence requires a session-capable database URL. [VERIFIED: Phase 159 Plan 05 summary]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build, tests, dev server process | yes | `v24.7.0` [VERIFIED: node --version] | Project requires >=20. [VERIFIED: package.json] |
| npm | scripts and package metadata | yes | `11.5.1` [VERIFIED: npm --version] | none needed |
| Python 3 | YAML scenario runner | yes | `3.12.3` [VERIFIED: python3 --version] | none needed |
| `psql` CLI | manual DB inspection only | no | — [VERIFIED: command -v psql] | Use Node `pg` helpers and Vitest tests. |
| Supabase/Postgres session-capable URL | advisory-lock integration evidence | partially | `.env.test` uses likely transaction pooler `:6543`. [VERIFIED: .env.test grep; tests/helpers/test-env.ts] | Tests can skip; full evidence requires direct/session-mode URL. |
| `slopcheck` | package legitimacy audit | yes | `0.6.1` [VERIFIED: slopcheck --version] | none needed |

**Missing dependencies with no fallback:**
- Session-capable `DATABASE_URL` is missing for non-skipped advisory-lock integration evidence. [VERIFIED: tests/helpers/test-env.ts; .env.test grep]

**Missing dependencies with fallback:**
- `psql` CLI is missing, but Node `pg` tests can inspect `pg_locks`. [VERIFIED: tests/integration/two-tier-lock.integration.test.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` in project, npm latest `4.1.7`. [VERIFIED: package.json; npm registry] |
| Config file | `tests/config/vitest.integration.config.ts` with explicit include list. [VERIFIED: tests/config/vitest.integration.config.ts] |
| Quick run command | `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"` per roadmap; fallback to `--testNamePattern` because Vitest docs verify that filter. [VERIFIED: .planning/ROADMAP.md; CITED: Context7 /vitest-dev/vitest] |
| Full suite command | `npm test && npm run typecheck && npm run build && npm run test:integration` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-007 | File write blocks structural folder remove/rename via shared/exclusive `dir:` locks. [CITED: external Test Plan T-I-011] | integration | `npm run test:integration -- tests/integration/folder-lock.integration.test.ts --testNamePattern "T-I-011|folder-lock"` | No; Wave 0. [VERIFIED: ls] |
| REQ-007 | Sibling writes under same folder both enter with shared locks. [CITED: external Test Plan T-I-012] | integration | `npm run test:integration -- tests/integration/folder-lock.integration.test.ts --testNamePattern "T-I-012|shared"` | No; Wave 0. [VERIFIED: ls] |
| REQ-007 | Folder creation takes no exclusive directory lock. [CITED: external Test Plan T-I-013] | integration | `npm run test:integration -- tests/integration/folder-lock.integration.test.ts --testNamePattern "T-I-013|create"` | No; Wave 0. [VERIFIED: ls] |
| REQ-024 | `manage_directory` takes exclusive advisory lock on structural folder operation. [CITED: external Test Plan T-I-046] | integration | `npm run test:integration -- tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "T-I-046|exclusive"` | No; Wave 0. [VERIFIED: ls] |
| REQ-024 | Concurrent same-folder `manage_directory` returns one success and one preserved conflict shape. [CITED: external Test Plan T-I-047] | integration | `npm run test:integration -- tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "T-I-047|contention"` | No; Wave 0. [VERIFIED: ls] |
| REQ-007 | YAML scenario `INT-WCO-01` folder coordination. [CITED: external Test Plan T-Y-001] | integration scenario | `python3 tests/scenarios/integration/run_integration.py --managed folder_coordination` | No; Wave 0. [VERIFIED: ls tests/scenarios/integration/tests] |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/with-directory-lock.test.ts tests/unit/lock-helper-only.test.ts --testNamePattern "directory-lock|helper-only"` after helper changes. [VERIFIED: package.json; existing unit patterns]
- **Per wave merge:** `npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "folder-lock|manage-directory-advisory"`. [CITED: external Test Plan §4.1.7 and §4.5.2]
- **Phase gate:** Full suite plus required roadmap evidence; advisory-lock integration evidence is meaningful only with `HAS_SESSION_CAPABLE_DATABASE_URL=true`. [VERIFIED: tests/helpers/test-env.ts]

### Wave 0 Gaps

- [ ] `tests/unit/with-directory-lock.test.ts` covers helper acquire/release modes and timeout mapping. [VERIFIED: no existing file via ls]
- [ ] `tests/integration/folder-lock.integration.test.ts` covers `T-I-011` through `T-I-013`. [CITED: external Test Plan §4.1.7]
- [ ] `tests/integration/manage-directory-advisory-lock.integration.test.ts` covers `T-I-046` and `T-I-047`. [CITED: external Test Plan §4.5.2]
- [ ] `tests/scenarios/integration/tests/folder_coordination.yml` covers `INT-WCO-01` when the YAML scenario lands. [CITED: external Test Plan §4.1.7]
- [ ] Add new integration files to `tests/config/vitest.integration.config.ts`. [VERIFIED: explicit include list]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface changes in Phase 160. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless per AGENTS.md. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Keep existing vault path validation and traversal rejection before locking. [VERIFIED: src/mcp/tools/files.ts:125; src/mcp/tools/documents/write.ts] |
| V5 Input Validation | yes | Continue Zod schema plus `validateVaultPath` / segment validation before filesystem operations. [VERIFIED: src/mcp/tools/files.ts] |
| V6 Cryptography | yes | Reuse existing SHA-256-to-bigint advisory key derivation; do not invent new hash logic unless kept compatible. [VERIFIED: src/services/document-lock.ts:196] |

### Known Threat Patterns for FlashQuery Locking

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal into non-vault directories | Tampering | Validate and canonicalize with `validateVaultPath` before deriving locks or touching disk. [VERIFIED: src/mcp/tools/files.ts] |
| Deadlock from multi-lock acquisition | Denial of Service | Acquire canonical entries in deterministic sorted order and release reverse order. [VERIFIED: src/services/document-lock.ts:180] |
| Infinite wait on contended locks | Denial of Service | Use Phase 159 bounded retry and `LockTimeoutError`. [VERIFIED: src/services/document-lock.ts:223] |
| Advisory lock leakage | Denial of Service | Release all acquired keys in `finally` and keep one checked-out session per helper span. [VERIFIED: src/services/document-lock.ts:218] |
| SQL injection in lock SQL | Tampering | Continue parameterized `$1::bigint` advisory-lock queries. [VERIFIED: src/services/document-lock.ts:232] |

## Sources

### Primary (HIGH confidence)
- `AGENTS.md` - project runtime, testing, MCP, and forbidden-pattern constraints. [VERIFIED: AGENTS.md]
- `.planning/phases/160-folder-locks-manage-directory-migration/160-CONTEXT.md` - locked decisions and phase scope. [VERIFIED: codebase read]
- External Requirements doc - REQ-007, REQ-024, invariants, lock subsystem contract. [CITED: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`]
- External Test Plan doc - T-I-011 through T-I-013, T-I-046, T-I-047, T-Y-001 / INT-WCO-01. [CITED: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`]
- PostgreSQL current docs - advisory lock semantics and function signatures. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html; https://www.postgresql.org/docs/current/functions-admin.html]
- Context7 `/vitest-dev/vitest` - `--testNamePattern` filter behavior. [CITED: Context7 docs]

### Secondary (MEDIUM confidence)
- Phase 158 and 159 summary files - shipped implementation details and known environment limitations. [VERIFIED: .planning/phases/158-*/*-SUMMARY.md; .planning/phases/159-*/*-SUMMARY.md]
- npm registry metadata for relevant existing packages. [VERIFIED: npm registry]
- slopcheck package scan for existing relevant packages. [VERIFIED: slopcheck]

### Tertiary (LOW confidence)
- Package download counts were not collected. [ASSUMED]
- Some pitfall frequency statements are based on engineering judgment rather than project-specific incident data. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing dependencies and versions were checked in `package.json` and npm registry. [VERIFIED: package.json; npm registry]
- Architecture: HIGH - canonical docs, Phase 159 implementation, and PostgreSQL docs agree on the shared/exclusive advisory-lock design. [CITED: external Requirements; PostgreSQL docs; VERIFIED: src/services/document-lock.ts]
- Pitfalls: MEDIUM - most are directly covered by the Test Plan, while frequency/likelihood is partly engineering judgment. [CITED: external Test Plan; ASSUMED]

**Research date:** 2026-05-27 [VERIFIED: gsd-sdk init.phase-op]
**Valid until:** 2026-06-26 for design, 2026-06-03 for package/version metadata. [ASSUMED]
