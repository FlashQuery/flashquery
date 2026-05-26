---
type: requirements_spec
created: 2026-05-25
status: active
milestone: v3.9
feature: 'Vault Write Coherency Locking'
research_doc: 'Vault Write Coherency Locking Research.md'
test_plan: 'Vault Write Coherency Locking Test Plan.md'
source_folder: '/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research'
poc_path: ''
depends_on: []
enables: []
relates_to:
  - Research/Multi-Vault.md
tags:
  - '#type/requirements'
---

# Vault Write Coherency Locking — Requirements

## 1. Purpose & Sources

This document specifies the rebuild of FlashQuery's write/locking layer for the vault: per-file locking instead of a single global lock, a native Postgres advisory-lock global tier instead of the hand-rolled `fqc_write_locks` table, a durable atomic write primitive, shared/exclusive directory locks for folder operations, destination-path locks for create/copy/move, an optimistic version-fingerprint (`version_token`) check to close the read-to-write gap, and a uniform best-effort multi-file batch contract. Implementing this feature reduces lock contention, fixes a live data-loss defect in `insert_doc_link` / `apply_tags`, makes cross-process exclusion correct rather than aspirational, gives callers a clean way to detect lost-update conflicts, and prepares the metadata-side for Multi-Vault.

**Sources.**

- Research document: [Vault Write Coherency Locking Research.md](./Vault%20Write%20Coherency%20Locking%20Research.md)
- Test plan: [Vault Write Coherency Locking Test Plan.md](./Vault%20Write%20Coherency%20Locking%20Test%20Plan.md)
- Related: `Research/Multi-Vault.md` (will share the global lock model)
- No POC — the research folder contains only the research markdown.

---

## 2. Reading Guide

- Section numbering: `§X.Y` for in-document references; `Test Plan §X.Y` for cross-document references; `Research §X.Y` for the research doc.
- Requirements are numbered `REQ-NNN`, stable; never renumbered. Invariants are numbered `INV-NN`.
- Acceptance criteria use **relaxed BDD** (`Given … when … then …`) for behaviors and **TDD invariants** (`MUST` / `MUST NOT`) for structural and safety guarantees. Both styles may appear within one REQ.
- Load-bearing assumptions are inline-tagged `[ASSUMPTION-NN: …]` and collected in §3.4.
- All file paths are relative to the `flashquery/` repo root unless otherwise stated (the codebase root is `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery/`).

---

## 3. Scope

### 3.1 In Scope

The feature delivers a coherent vault-write subsystem covering:

1. A **two-tier per-file write lock**: an in-process `async-mutex` striped registry (Tier 1) plus a native Postgres `pg_advisory_lock` session-scoped global tier (Tier 2), keyed on the file's canonical absolute path (Research §3.12).
2. **Retirement of the `fqc_write_locks` table** and the `flashquery unlock` CLI (Research §3.12).
3. A **session-capable Postgres connection requirement** with a startup self-test (Research §3.15 OQ22 / §3.16 OQ28).
4. **Shared/exclusive directory locks** for folder operations and **destination-path locks** for create / copy / move (Research §3.12, §3.16 OQ31).
5. A single **lock-aware, durable, atomic write primitive** that every vault write routes through — temp-write + fsync + rename + directory fsync, with unique temp names, surfacing errors rather than swallowing them (Research §3.5, §3.16 OQ33).
6. The **version-fingerprint check** — a `version_token` returned by `get_document` and write tools, optionally accepted as an `expected_version` / `if_match` precondition on every file-affecting tool, validated inside the lock against the freshly hashed disk bytes (Research §3.11, §3.15 OQ23/OQ24, §3.16 OQ27).
7. The **best-effort multi-file batch contract** with an ordered per-item result envelope and a mixed `Array<string | { identifier, version_token }>` input shape (Research §3.13, §3.16 OQ30).
8. **Records / memory / plugins** post-`fqc_write_locks` coordination — per-plugin advisory locks or wrapping transactions where multi-step sequences remain; memory needs nothing further (Research §3.15 OQ25).
9. **Closing the live defect**: `insert_doc_link` and `apply_tags` currently take no write lock at all; the rebuild brings them under the per-file lock (Research §3.8).

### 3.2 Out of Scope / Not Included

1. **Cross-document pointer identity** — referencing the stable `fq_id` UUID rather than mutable titles/paths (Research §3.14, OQ14). This is a separate link/reference-model feature; the locking work does not require it.
2. **Declared read-with-intent-to-modify (RWITM) reservations** — soft modify reservations at `get_document` time (Research §3.14, OQ18 — dropped). The version-fingerprint check covers RWITM correctness without needing declared intent.
3. **Operational Transformation / CRDTs** for concurrent in-document editing (Research §3.8). FlashQuery's server-mediated per-file serialization is sufficient and far simpler.
4. **Default-on version checking for first-party agent/skill callers** — the version check stays strictly opt-in for v1 (Research §3.15 OQ23). First-party agents pass the token in their own code rather than via a server-side default.
5. **A FlashQuery-owned per-resource fair-queue** to deliver strict global FIFO writer ordering (Research §3.16 OQ29). The bounded-wait timeout is sufficient for liveness.
6. **Internal multi-threading** of FlashQuery vault work via `worker_threads` (Research §3.9). FlashQuery remains single-event-loop per process; the global lock handles cross-process coordination.

### 3.3 Deferred to v1+ / Future

1. **3-way / section-aware merge on write conflict** (Research §3.14, OQ19). The reject-and-retry baseline ships now; merge is an enhancement once the core mechanism is in use.
2. **Section-level version tokens** (Research §3.11 requirement #8). Whole-file token plus region-returning refusal is the v1 design; per-section hashing remains a possible later refinement if the false-conflict rate proves painful in practice.
3. **Atomic multi-file batch opt-in** (Research §3.13 "Atomic batches — reserved opt-in"). The hook is reserved in the design — a per-operation flag that acquires all per-file locks up front in sorted canonical-path order and runs the batch under all of them — but no current built-in tool needs it, so it is not built until a concrete operation surfaces a true all-or-nothing requirement (likely a `call_macro` whose steps only make sense together).
4. **Macro-engine auto-threading of `version_token`** (Research §3.17, OQ36). When a macro reads file X (`$x = get_document(path: "X.md")`) and a later step writes the same file without an explicit `expected_version`, the engine would substitute `$x.version_token` automatically — delivering multi-step RWITM safety to macro authors without per-step burden. The right long-term direction, but it needs an identifier-equivalence design (when are `path`, `fq_id`, and a filename-only identifier "the same file"?) and it is a semantic change to existing macros (a macro that succeeded silently today might start refusing writes once auto-threading lands). Lands as its own initiative rather than bundled into the locking rework.
5. **`call_macro` atomic-execution opt-in** (Research §3.17, OQ37). An optional `atomic: true` flag that takes per-file locks on every file the macro will touch in sorted canonical order before any step runs, holds them for the macro's lifetime, releases at the end — the macro-shaped extension of §3.3 #3's atomic-batch opt-in. Same constraint (the file set must be knowable up front — wildcards rule out atomic mode); built when a concrete macro genuinely needs it, ideally co-designed with the atomic-batch opt-in.

### 3.4 Assumptions

- `[ASSUMPTION-01]` The raw `pg` connection pool (`src/utils/pg-client.ts`) is the right home for Tier 2 advisory locks — its `withPgClient(connStr, fn)` helper hands a `PoolClient` to the callback, which is the unit of "session" advisory locks need.
- `[ASSUMPTION-02]` On macOS APFS and on Windows, the vault filesystem is case-insensitive by default; case-folding the lock key is therefore a correctness requirement, not paranoia. Linux ext4/xfs vaults are case-sensitive and case-folding is a no-op.
- `[ASSUMPTION-03]` Supabase deployments that use the connection pooler (Supavisor) in transaction mode are common enough that the startup self-test must fail loudly rather than warn — silent misbehavior in production would be very expensive to debug.
- `[ASSUMPTION-04]` The split of `src/mcp/tools/documents.ts` into `documents/write.ts`, `get.ts`, `remove.ts`, `archive.ts`, `copy.ts`, `move.ts` (plus `deps.ts` / `helpers.ts`) is stable for the duration of this work; the registration barrel `documents.ts` continues to export from these.
- `[ASSUMPTION-05]` The scanner's `repairFrontmatter()` path is the only scan-triggered vault write, and it only writes files whose identity frontmatter is missing or wrong (`needs_frontmatter_repair`) — a steady-state scan of an untouched vault produces zero writes. (Research §3.11 token-stability paragraph, verified against `scanner.ts:684,806,950,985`.)

If any of these assumptions proves wrong during implementation, the dev agent should stop and flag.

---

## 4. Invariants

Project-spanning safety and structural guarantees this feature must respect.

- **INV-01.** A vault file write MUST never produce a torn or partial file visible to readers — atomic rename (or the cross-device equivalent in REQ-022) is the only commit mechanism.
- **INV-02.** No FlashQuery-mediated vault write MAY bypass the lock-aware atomic write primitive (REQ-020).
- **INV-03.** A vault write that fails to reach disk MUST surface an error to the caller — silent write failures are forbidden. (Closes the `atomicWriteFrontmatter` defect at `src/utils/frontmatter.ts:65-69`.)
- **INV-04.** A contended write MUST eventually return — block-forever is forbidden. The bounded-wait timeout (REQ-006) enforces this for every write path.
- **INV-05.** The `version_token` returned by any read MUST equal the SHA-256 of the file's current on-disk bytes at the moment the response is built. The `fqc_documents.content_hash` row update, the returned token, and the file bytes MUST be mutually consistent on every code path that reads or writes the file. (REQ-014.)
- **INV-06.** The scanner MUST NOT write to a vault file whose content is unchanged since its last scan. Two consecutive scans of an untouched vault produce zero file writes. (REQ-017, Research §3.11 token-stability.)
- **INV-07.** Reads MUST NOT acquire any write lock — readers are never blocked by readers, writers, or folder operations. Atomicity of `rename(2)` is the readers' guarantee.
- **INV-08.** The Tier 2 advisory lock MUST be acquired and released on the same Postgres backend session. Transaction-mode connection pooling is forbidden for the lock-tier connection. (REQ-005.)
- **INV-09.** When a single operation needs more than one per-file lock (e.g., `move_document`, atomic batches), the locks MUST be acquired in sorted canonical-path order. No other ordering may take multiple per-file locks together. (REQ-008, REQ-019, deadlock prevention per Research §3.13.)
- **INV-10.** A write tool that performs read-modify-write of a file MUST always re-read the file inside its own write lock — never apply a change to a snapshot captured before lock acquisition. (Preserved invariant; existing tools at `documents/write.ts:215`, `compound.ts:1087`, `compound.ts:1260` already do this.)

---

## 5. Codebase Context

### 5.1 Source Code

**Current locking layer (to be replaced).** `src/services/write-lock.ts` exposes `acquireLock`, `releaseLock`, `isLocked` against the `fqc_write_locks` table. The table is defined in `src/storage/supabase.ts:521-546`; its primary key `(instance_id, resource_type)` is mis-keyed and provides no real cross-instance exclusion (Research §3.4). The current callers pass these literal resource strings: documents tools and `compound.ts` pass `'documents'`; `records.ts` passes `'records'`; `memory.ts` passes `'memory'`; `plugins.ts` passes `'plugins'`; `files.ts` (the existing fine-grained-key precedent) uses `directory:${safePath}` (`files.ts:150`).

**The split document tools.** The monolithic `src/mcp/tools/documents.ts` is now a registration barrel; the actual tool handlers live in `src/mcp/tools/documents/`:

- `documents/write.ts` — `write_document`. `acquireLock` at line 66, `releaseLock` at line 312; the read inside the lock is at line 215.
- `documents/get.ts` — `get_document` (read).
- `documents/archive.ts` — `archive_document`.
- `documents/remove.ts` — `remove_document`.
- `documents/copy.ts` — `copy_document` (destination check-then-write at lines ~131–155).
- `documents/move.ts` — `move_document` (destination check then `rename` at lines ~128–154; EXDEV fallback at lines ~158–164).
- `documents/deps.ts`, `documents/helpers.ts` — shared dependencies and helpers.

The dev agent should confirm the exact line numbers in these files against the current code — the file split was recent.

**Compound tools** in `src/mcp/tools/compound.ts` — `insert_in_doc` (lock at `:1062`) and `replace_doc_section` (lock at `:1237`) take the `'documents'` lock; `insert_doc_link` (`:154`) and `apply_tags` (`:280`) take **no lock at all** (the live defect closed by REQ-010).

**Vault primitive.** `src/storage/vault.ts:220-222` does `writeFile(tmpPath)` → `rename(tmpPath, absolutePath)` with `tmpPath = ${absolutePath}.fqc-tmp`. `cleanStaleTempFiles()` at `vault.ts:337` sweeps stray temp files at startup.

**Frontmatter primitive.** `src/utils/frontmatter.ts` exposes `atomicWriteFrontmatter`; its `try/catch` block at lines ~65-69 swallows write failures at `debug` level and returns normally — INV-03 forbids this; REQ-020 fixes it.

**Document-output utility.** `src/mcp/utils/document-output.ts` is the `get_document` flow. The content hash is computed at line 420 (`createHash('sha256').update(rawContent).digest('hex')`); the DB row update at line 465 writes that hash into `fqc_documents.content_hash` whenever the file has drifted from the stored hash. The `targetedScan` invocation at line 431 may rewrite frontmatter during a read; REQ-014 specifies that the hash used in both the row update and the returned token reflect the bytes actually written (not the pre-repair bytes).

**Document resolver primitives.** `src/mcp/utils/document-resolver-primitives.ts` contains `targetedScan` (writes a repair at line ~470) and a private `writeMarkdownFile` helper (lines 102-116) with its own fixed `.fqc-tmp` temp name — REQ-020 consolidates this onto the single primitive.

**Plugin reconciliation.** `src/services/plugin-reconciliation.ts` calls `atomicWriteFrontmatter` at lines ~380-384; same write-path consolidation under REQ-020.

**Raw Postgres pool.** `src/utils/pg-client.ts` (104 lines, full file readable) exposes:
- `withPgClient(connStr, fn)` — checks out a `PoolClient`, runs `fn(client)`, releases on finally. **This is the unit of "session" that Tier 2 advisory locks need** (`[ASSUMPTION-01]`).
- `queryPgPool(connStr, sql, params)` — pool-level query (not session-stable; do NOT use for advisory locks).
- `__setPgPoolFactoryForTesting(factory)` — test-injection point; the test plan uses this for Tier 2 unit and integration tests.
- IPv4 forcing is global at startup in `src/index.ts`; pool config does not need it.

**Scanner.** `src/services/scanner.ts:28` — `scanMutex` (in-process `async-mutex`) serializes `runScanOnce()` vs `reconcileTrackedDocuments()`. `:1271` — comment recording that `repairFrontmatter` runs outside `scanMutex`. `:684, 806, 950, 985` — the four call sites that set the `needs_frontmatter_repair` flag (REQ-017 token-stability invariant). The scanner's per-document writes should adopt the per-file lock as part of REQ-001 / Phase 1; the top-level `scanMutex` stays in its current role (intra-scan serialization between scan entrypoints).

**Server transport.** `src/mcp/server.ts:705-790` (transport selection); `flashquery.yml:117-133` (`mcp.transport: "streamable-http"` is the default) — one process serves many client sessions on one event loop (Research §3.9).

**CLI.** `src/cli/commands/unlock.ts` (manual orphaned-lock CLI) — becomes obsolete with REQ-004 and is removed.

**Configuration.** `flashquery.yml:220-222` currently:
```yaml
locking:
  enabled: true
  ttl_seconds: 30
```
After this work (REQ-006, REQ-004), the section becomes:
```yaml
locking:
  enabled: true
  # Bounded wait for acquiring a contended write lock, in seconds. If the
  # lock is not acquired within this window the write fails with a
  # lock_timeout / resource_busy error in the response. Default: 10.
  # Comment this out to fall back to the 10 s default.
  # lock_timeout_seconds: 10
```
`ttl_seconds` is removed (the table is gone; advisory locks need no TTL).

### 5.2 Test Infrastructure

FlashQuery has five test layers; the Test Plan uses all five.

**Unit (Vitest).** Location: `tests/unit/` (with subfolders `mcp/`, `tool-search/`, etc.). Run: `npm test`. Pattern: `*.test.ts`. Conventions: relative imports, `vi.mock` for module-level stubs, `beforeEach`/`afterEach` for setup/teardown. Existing tests directly relevant: `tests/unit/apply-tags.test.ts`, `tests/unit/archive-document.test.ts`.

**Integration (Vitest).** Location: `tests/integration/` (flat). Run: `npm run test:integration` (config at `tests/config/vitest.integration.config.ts`). The existing locking integration test that should serve as the structural model is `tests/integration/archive-document-lock.test.ts` — it builds a `FlashQueryConfig`, registers tool handlers, exercises `acquireLock` / `releaseLock` against a test Supabase instance, and toggles `locking.enabled` to compare paths. Use the same `makeConfig`, handler-registration, and `randomUUID()`-namespaced instance-id pattern.

**E2E.** Location: `tests/e2e/`. Few tests; full-stack transport-included. Not heavily used by this feature.

**Directed scenarios (Python).** Location: `tests/scenarios/directed/testcases/`. Run: `python3 tests/scenarios/directed/run_suite.py --managed <pattern>` (managed mode spins up a dedicated FQC subprocess). Coverage matrix: `tests/scenarios/directed/DIRECTED_COVERAGE.md`. Framework: `fqc_test_utils` (`tests/scenarios/framework/`). Example to model after: `tests/scenarios/directed/testcases/test_batch_get_document.py` (declares `COVERAGE = ["D-NN"]`, exit codes 0/2/3 = PASS/FAIL/DIRTY). The authoring skill is `flashquery-directed-testgen`; the coverage-matrix update skill is `flashquery-directed-covgen`.

**Integration scenarios (YAML DSL).** Location: `tests/scenarios/integration/tests/`. Run: `python3 tests/scenarios/integration/run_integration.py --managed`. Coverage matrix: `tests/scenarios/integration/INTEGRATION_COVERAGE.md`. README at `tests/scenarios/integration/README.md`. **Note** — the database is wiped before and after each test; only point at a throwaway Supabase instance. The authoring skill is `flashquery-integration-testgen`; the coverage-matrix update skill is `flashquery-integration-covgen`.

---

## 6. Requirements

REQs are grouped by area. Within each group the REQs are ordered by dependency.

### 6.1 Lock subsystem

#### 6.1.1. REQ-001: Per-file write locking replaces the global `'documents'` lock

**Description.** The unit of write-locking for vault files is the individual file, keyed on the file's canonical absolute path. Writes to two different files never block each other; only writes to the *same* file serialize. This replaces today's single global `'documents'` resource lock that every document write contends on.

**Acceptance criteria.**

1. Given two concurrent `write_document` calls targeting two different vault files, when both are dispatched, then both complete without serializing on a shared lock.
2. Given two concurrent `write_document` calls targeting the **same** vault file, when both are dispatched, then they serialize and the second writer sees the first writer's bytes when it re-reads inside the lock (INV-10).
3. The system MUST NOT route any document write through a coarse `'documents'` resource string after this REQ ships; every document-modifying tool acquires a per-file key.
4. The system MUST treat the file's canonical absolute path (per REQ-003) as the lock key; vault-relative paths MUST NOT be used as keys.

**Source.** Research §2 OQ #2, §3.2, §3.7 step 1, §3.12.
**Failure modes.** Two writes to one file producing a corrupted merged file; two writes to different files blocking each other (the contention problem the rebuild solves). Mishandled identifier resolution producing different keys for the same path on disk (covered by REQ-003).

#### 6.1.2. REQ-002: Two-tier write lock — in-process `async-mutex` + native Postgres advisory locks

**Description.** The write lock has two tiers. Tier 1 is an in-process striped registry of `async-mutex` locks keyed by canonical absolute path — microsecond cost, no I/O, serializes contention *within* one FlashQuery process. Tier 2 is native session-scoped Postgres advisory locks (`pg_advisory_lock`/`pg_advisory_unlock`) keyed on a bigint hash of the canonical absolute path, taken on a `PoolClient` checked out from `src/utils/pg-client.ts` via `withPgClient` — serializes contention *between* separate FlashQuery processes that share a vault. A writer acquires Tier 1, then Tier 2; releases in reverse order. Because Tier 1 collapses all same-process contention, Tier 2 is reached at most once per process for a given file.

**Acceptance criteria.**

1. Given a writer entering the critical section, when it acquires the lock, then Tier 1 is taken first, then Tier 2 on a `PoolClient`; on release Tier 2 is released before Tier 1.
2. Given Tier 1 is contended within one process, when the loser acquires Tier 1, then Tier 2 is **not** re-acquired by that loser (Tier 2 is held by the in-process winner — the loser inherits its serialization via Tier 1).
3. The Tier 1 registry MUST use lock striping with a bounded number of slots (recommended: 1024) — memory MUST NOT scale with the number of unique files ever locked.
4. The Tier 2 lock MUST be a session-scoped `pg_advisory_lock(bigint)`, not transaction-scoped — INV-08 — taken via `withPgClient` so acquire and release run on the same backend session.
5. Given a process crashes while holding Tier 2, when the Postgres backend session ends, then the advisory lock is released automatically (no TTL, no `flashquery unlock`).
6. The system MUST NOT use any other mechanism (the retired `fqc_write_locks` table; filesystem lockfiles; transaction-mode advisory locks) to provide cross-process file mutual exclusion.

**Source.** Research §2 OQ #10/#17, §3.7 step 3, §3.9, §3.12.
**Failure modes.** Tier 2 leaking across `release` because the same `PoolClient` wasn't reused; lock-key hash collisions producing harmless false sharing (acceptable per Research §3.12 caveat); pool exhaustion under pathological contention (bounded per Research §3.12 caveat — Tier 1 caps held connections at one per process).

#### 6.1.3. REQ-003: Canonical lock-key derivation

**Description.** The lock key is derived from the file (or directory) path using `realpath` so symlinks and `.`/`..` segments cannot fragment one file into several keys. For a not-yet-existing destination (a `copy_document` / `move_document` / create-mode `write_document` target), `realpath` is applied to the parent directory and `basename` is appended — because `realpath` cannot resolve a path that does not exist yet. On case-insensitive filesystems (macOS APFS by default and Windows), the resulting path is case-folded; otherwise `Notes/Plan.md` and `notes/plan.md` — the same file on disk — would hash to different advisory-lock keys and silently lose a mutual exclusion. A resource namespace prefix (`file:` or `dir:`) is prepended before the key is hashed to the Tier 2 advisory-lock bigint.

**Acceptance criteria.**

1. Given a path to an existing file, when the lock key is derived, then it equals `case_fold(realpath(path))` prefixed with `file:`.
2. Given a not-yet-existing destination path, when the lock key is derived, then it equals `case_fold(realpath(parent_dir) + '/' + basename)` prefixed with `file:`.
3. Given a directory path, when the lock key is derived, then it equals `case_fold(realpath(dir))` prefixed with `dir:`.
4. Given a case-insensitive filesystem detected at startup, when two paths differ only in case but point at the same file, then they produce the same lock key. The system MUST detect filesystem case-sensitivity at startup (one probe — create a temp file, stat its case-variant path) and apply case-folding only when needed.
5. The system MUST NOT key on `instance_id`, on the vault-relative path, or on any identifier other than the path-derived value above.
6. Hard links and bind mounts that alias one physical file under two absolute paths `realpath` cannot unify are a documented unsupported configuration (Research §3.12 caveat).

**Source.** Research §2 OQ #21/#32, §3.12, §3.16 OQ32.
**Failure modes.** Case-insensitive filesystem not detected, leading to silent missed exclusion on macOS (most common dev environment); `realpath` failing on a not-yet-existing path because the parent-trim wasn't applied; namespace prefix omitted, causing a file key and a directory key to collide on bigint hashing.
**Notes.** `[ASSUMPTION-02]` — case-folding is a no-op on Linux ext4/xfs but is correctness on APFS/Windows.

#### 6.1.4. REQ-004: Retire `fqc_write_locks`

**Description.** The `fqc_write_locks` table is dropped on FlashQuery startup if it exists; the `acquireLock` / `releaseLock` / `isLocked` service in `src/services/write-lock.ts` is removed; the `flashquery unlock` CLI command at `src/cli/commands/unlock.ts` is removed; the `locking.ttl_seconds` config key is removed from `flashquery.yml` / `flashquery.test.yml` (and is silently ignored if encountered, with a deprecation log line on first observation).

**Acceptance criteria.**

1. Given FlashQuery starts up with the `fqc_write_locks` table present, when the startup sequence runs, then the table is dropped via `DROP TABLE IF EXISTS fqc_write_locks` and a single `debug`-level log line records the removal.
2. Given a `flashquery.yml` that still contains `locking.ttl_seconds`, when the config loads, then the key is silently ignored with one `warn`-level "deprecated; safe to remove" log line on startup.
3. The `acquireLock` / `releaseLock` / `isLocked` symbols MUST be removed from `src/services/write-lock.ts`; any remaining import of them is a build failure.
4. The `flashquery unlock` CLI command MUST be removed; the command surface MUST NOT expose it.
5. The `fqc_write_locks` table-definition DDL in `src/storage/supabase.ts:521-546` MUST be removed; the migration block MUST NOT recreate it.

**Source.** Research §2 OQ #9, §3.4, §3.12.
**Failure modes.** Drop-on-startup running on a fresh DB where the table doesn't exist (the `IF EXISTS` guard makes this a no-op); leftover imports of `acquireLock` breaking the build (this is intentional — the compile-time signal forces removal across all callers).

#### 6.1.5. REQ-005: Session-capable Postgres connection requirement + startup self-test

**Description.** The raw `pg` pool used by Tier 2 MUST connect to a session-capable endpoint — a direct Postgres connection or a session-mode pooler. A transaction-mode pooler (Supabase Supavisor's default mode) returns each transaction's connection to the pool, so a session-scoped `pg_advisory_lock` taken on one transaction's backend is invisible to the next — the lock effectively leaks onto an unrelated client. The system runs a startup self-test that takes a throwaway advisory lock on one checked-out `PoolClient`, verifies it is observable from a second checkout, releases it, and fails loudly with a clear message if any step misbehaves.

**Acceptance criteria.**

1. Given FlashQuery starts up with a session-capable `DATABASE_URL`, when the startup self-test runs, then it acquires a throwaway advisory lock on one `withPgClient` call, queries `pg_locks` from a second `withPgClient` call to confirm visibility, releases the lock, and continues startup.
2. Given the startup self-test cannot confirm session-mode behavior (the second connection cannot see the first's lock, or release misbehaves), when it fails, then FlashQuery exits non-zero with a clear error message naming the suspected transaction-mode pooler and pointing the operator at the documentation.
3. The system MUST NOT use `pg_advisory_xact_lock` (transaction-scoped) as a substitute — that would hold a DB transaction open across the file write, the long-held-resource hazard the design avoids (REQ-002 AC #4).
4. The README, `.env.example`, `flashquery.yml` commentary, and the Supabase onboarding documentation MUST be updated to state the session-capable-connection requirement and to document the transaction-pooler failure mode.

**Source.** Research §2 OQ #28, §3.12 caveat, §3.16 OQ28.
**Failure modes.** Operators using the default Supabase pooler URL — must be caught at startup, not in production. False positives (the self-test failing on a session-capable connection) — design the probe to be unambiguous (`pg_locks` shows the row or it doesn't).
**Notes.** `[ASSUMPTION-03]`.

#### 6.1.6. REQ-006: Bounded-wait timeout for lock acquisition

**Description.** A writer waiting for a contended lock acquires it or fails cleanly within a bounded window. The default is 10 seconds, configurable in `flashquery.yml` under the `locking:` section as `lock_timeout_seconds`; when the key is commented out or absent, the default applies. On timeout, the write returns a structured `lock_timeout` / `resource_busy` error in the response envelope — never raises an uncaught exception, never hangs.

**Acceptance criteria.**

1. Given a contended file with another holder, when a second writer attempts the lock with the default timeout, then the second writer either acquires within 10 seconds or returns a `lock_timeout` error envelope with a clear, catchable message and `details.reason: "lock_timeout"`.
2. Given `lock_timeout_seconds: 30` in `flashquery.yml`, when a writer is contended, then the timeout window is 30 seconds.
3. Given no `lock_timeout_seconds` key in `flashquery.yml`, when a writer is contended, then the default 10 seconds applies.
4. The implementation MUST use Postgres `lock_timeout` (set per-acquire on the `PoolClient`) or `pg_try_advisory_lock` wrapped in a bounded retry loop — never an unbounded `pg_advisory_lock` call. INV-04 forbids block-forever.
5. The error envelope MUST be a structured tool-response (the same shape today's `files.ts:150` lock-contention envelope uses: `error: "conflict"`, `details.reason: "lock_timeout"`), not an exception bubbled to the caller.

**Source.** Research §2 OQ #22, §3.15 OQ22.
**Failure modes.** Timeout silently lost (writer hangs anyway) — covered by a unit test that mocks Tier 2 to never grant; timeout set too short producing spurious failures under normal load — 10 s default is the documented order of magnitude from the retired table-based lock.

#### 6.1.7. REQ-007: Shared/exclusive directory locks for folder operations

**Description.** Folder-structure operations (rename, move, delete a folder) need coordination distinct from per-file locks — a folder rename could move a file out from under an in-flight write. The protocol: a file write holds a **shared** lock on every ancestor folder from the file's parent up to the vault root; a folder structural operation takes an **exclusive** lock on the folder it changes. Shared locks coexist (so concurrent file writes never block each other on directory locks); an exclusive folder lock conflicts with shared locks below it, so a folder operation waits for in-flight descendant writes and blocks new ones until it completes. Folder *creation* is additive and does not take the exclusive lock. Directory locks live in the global tier only — `pg_advisory_lock_shared` / `pg_advisory_lock` keyed on the folder's canonical absolute path (REQ-003).

**Acceptance criteria.**

1. Given a `write_document` call to `Notes/Plan.md`, when the lock sequence runs, then it acquires shared advisory locks on `realpath(Notes)` and on every ancestor up to the vault root, in addition to the per-file lock on the file itself.
2. Given a `manage_directory` call to rename `Notes/` to `Archive/Notes/`, when the operation runs, then it acquires an exclusive advisory lock on the canonical absolute path of `Notes/`, which conflicts with the shared locks held by descendant file writes.
3. Given an in-flight `write_document` holds a shared lock on `Notes/`, when a concurrent `manage_directory` rename of `Notes/` is requested, then the rename waits until the write completes (or times out per REQ-006).
4. Given two concurrent `write_document` calls to two different files in `Notes/`, when both run, then both acquire the shared lock on `Notes/` in parallel and neither blocks the other.
5. Folder *creation* (adding a new directory) is additive and MUST NOT take an exclusive folder lock — it invalidates no existing path.
6. The Tier 1 in-process registry MUST stay file-only — directory locks are global-tier only (Research §3.12).

**Source.** Research §2 OQ #13, §3.8 (folder-stress test), §3.12 folder operations.
**Failure modes.** Forgetting to acquire ancestor shared locks on a write (folder rename can move a file mid-write); applying an exclusive lock to folder *creation* (would needlessly serialize unrelated work).

#### 6.1.8. REQ-008: Destination-path locks for create / copy / move

**Description.** Per-file locking keyed on the *source* path leaves a check-then-act race on *destinations*. `copy_document` and `move_document` currently `existsSync(dest)` and then write — two callers can both pass the check and race into the same destination. The rebuild requires every operation that creates or writes to a destination to take the per-file lock on the **destination** canonical path for the operation's duration. `move_document` takes per-file locks on **both** source and destination, acquired in sorted canonical-path order (INV-09). Ancestor shared directory locks (REQ-007) compose on top.

**Acceptance criteria.**

1. Given two concurrent `copy_document` calls with the same destination path, when both dispatch, then exactly one writes the destination and the other returns a structured `conflict` envelope (matching the existing `files.ts` `path_exists` shape).
2. Given a `move_document` call from `Notes/A.md` to `Archive/A.md`, when the lock sequence runs, then per-file locks on both `Notes/A.md` and `Archive/A.md` are acquired in sorted canonical-path order, plus shared ancestor folder locks on both parent chains.
3. Given a create-mode `write_document` to a not-yet-existing path, when the lock sequence runs, then the destination per-file key is derived per REQ-003 AC #2 (`realpath(parent)+basename`) and the per-file lock on that key is taken.
4. The system MUST NOT rely on `existsSync` alone as a destination guard; the existence check stays as a fast-fail but the per-file lock on the destination is the authoritative serialization.
5. INV-09: multi-lock acquisition order MUST be sorted canonical-path; the dev agent emits a small per-tool table in code comments documenting which paths each tool locks and in what order.

**Source.** Research §2 OQ #31, §3.16 OQ31.
**Failure modes.** Deadlock from acquiring two locks in the wrong order (INV-09 prevents); missing the destination lock so two creates clobber each other; `move_document` taking only the source lock and another writer racing the destination.

#### 6.1.9. REQ-009: `withDocumentLock(path, fn)` helper at every document and compound call site

**Description.** A single helper wraps lock acquire/run/release uniformly across all document-touching tools. The helper accepts a path (relative or absolute) and a function; internally it canonicalizes the path to the absolute lock key per REQ-003, acquires Tier 1 then Tier 2 with the configured timeout (REQ-006), runs `fn`, and releases in reverse order. The signatures of the underlying lock service do not leak into call sites — the call sites use only the helper. The helper has a variant for the multi-path case (move/copy) accepting an array and acquiring in sorted canonical-path order (INV-09).

**Acceptance criteria.**

1. The system MUST expose a `withDocumentLock(path: string, fn: () => Promise<T>): Promise<T>` helper (and a `withDocumentLocks(paths: string[], fn)` variant for multi-lock cases) in a single module, e.g., `src/services/document-lock.ts`.
2. Given any call site in `src/mcp/tools/documents/**` or `src/mcp/tools/compound.ts`, when it needs the per-file lock, then it uses the helper rather than calling the underlying Tier 1 / Tier 2 primitives directly.
3. The helper MUST canonicalize the input path per REQ-003 before keying the lock — call sites pass either relative or absolute paths and need not know the keying rules.
4. The helper MUST translate the bounded-wait timeout (REQ-006) into the structured `lock_timeout` envelope at the call site's response shape.
5. The system MUST NOT export the lower-level lock primitives from any module other than the helper module — direct usage outside the helper is a build-time error.

**Source.** Research §2 OQ #8, §3.7 step 1.
**Failure modes.** A call site bypassing the helper and acquiring locks directly (build error if primitives aren't exported); the helper accepting a path it cannot canonicalize and failing silently (must throw a clear error naming the path).

#### 6.1.10. REQ-010: Close the live defect — bring `insert_doc_link` and `apply_tags` under the per-file lock

**Description.** Today `insert_doc_link` (`src/mcp/tools/compound.ts:154`) and `apply_tags` (`compound.ts:280`) perform read-modify-write of document frontmatter with **no `acquireLock` anywhere in their handlers**. Two concurrent `apply_tags` calls on the same document, or an `insert_doc_link` racing a `write_document`, lose updates outright today. This is a live data-loss defect, not a future risk. Closing it is the highest-priority work in Phase 1 — these tools are brought under the `withDocumentLock` helper (REQ-009) in the same change that introduces the helper.

**Acceptance criteria.**

1. The `apply_tags` handler MUST acquire `withDocumentLock` on the target document (or per-target document in the batch case) before the read-modify-write; release in finally.
2. The `insert_doc_link` handler MUST acquire `withDocumentLock` on every source document it mutates, in sorted canonical-path order (INV-09).
3. Given two concurrent `apply_tags` calls on the same document, when both complete, then the resulting tags set contains the union of both calls' inputs (or, on `version_token` mismatch from REQ-012, the second is refused — never silently overwritten).
4. Given an `insert_doc_link` racing a `write_document` on the same source document, when both complete, then the resulting file contains both writers' changes (per-file lock serializes; INV-10 ensures each writer re-reads inside the lock).
5. A regression test MUST exist that races two `apply_tags` calls on one document and asserts no tag is lost (Test Plan §4.1.10).

**Source.** Research §3.8 (the live-defect paragraph), §3.7 step 1 (highest-priority within the step).
**Failure modes.** This is the current bug — without this REQ, the rebuild would still ship the data-loss path.

#### 6.1.11. REQ-025: `call_macro` uses the uniform per-file lock pattern; no macro-level lock spans the macro's lifetime

**Description.** `call_macro` (`src/mcp/tools/macro.ts`) is one MCP tool among many; the macro engine dispatches each tool step through the MCP broker, and every dispatched call goes through its handler, which takes the per-file lock via `withDocumentLock` (REQ-001 / REQ-009). The macro engine itself acquires no macro-spanning lock — no special exception is made for macros, and no new macro-level lock helper is introduced. Two macros running in parallel rely on the same per-file lock + opt-in version-token mechanisms (REQ-012) as any other caller. Multi-step macro consistency across read→write pairs is the macro author's responsibility, achieved by explicitly threading `version_token` through their macro source. Macro engine auto-threading of `version_token` (§3.3 #4) and macro-level atomic execution (§3.3 #5) are deferred to v1+.

**Acceptance criteria.**

1. The system MUST NOT add any `acquireLock` / `withDocumentLock` / lower-level lock primitive call in `src/mcp/tools/macro.ts` or in the macro evaluator (`src/macro/evaluator.ts`). A static-check test (T-U-038) asserts this.
2. Given two parallel `call_macro` invocations whose macros both `write_document` the same file, when both run, then the per-file lock from REQ-001 serializes the two writes; neither produces a torn file; the second writer re-reads inside the lock and writes on top of the first writer's bytes (INV-10).
3. Given a macro that reads file A then writes A *without* passing `expected_version` on the write step, when a concurrent macro modifies A between the read and the write, then the second write proceeds (last-writer-wins) — REQ-012's opt-in stance applies to macro callers unchanged. This is intentional behavior; the macro author opts into RWITM safety by threading the token.
4. Given a macro that reads file A and threads `expected_version: $a.version_token` into a later `write_document` of A, when a concurrent macro modifies A between the read and the write, then the write is refused with the REQ-015 conflict envelope.
5. The `help: true` output for `call_macro` MUST document the model: (a) every step takes its own per-file lock through its tool handler; (b) `call_macro` is **not** atomic — the engine does not span any lock across steps; (c) for multi-step safety across read→write pairs the macro author passes `version_token` explicitly; (d) auto-threading and atomic execution are deferred (§3.3 #4–#5).
6. The system MUST NOT introduce a macro-spanning timeout, watchdog, or any other coordination above the per-step lock layer as part of this work — these are explicitly out of scope (auto-threading and atomic execution cover the remaining cases when they ship).

**Source.** Research §3.17 (OQ35); conversation 2026-05-25.
**Failure modes.** A future change introducing a macro-spanning lock would silently re-introduce the contention pattern the rebuild exists to solve — the static-check test guards against this. Macro authors expecting transactional macro semantics — addressed by the `help: true` text and the §3.3 #4–#5 deferred items.

### 6.2 Version-fingerprint check (optimistic concurrency)

#### 6.2.1. REQ-011: `version_token` on read responses and successful write responses

**Description.** `get_document` adds a `version_token` field to its response envelope — the SHA-256 of the file's current on-disk bytes at the moment the response is built. Every write tool's success response also carries the post-write `version_token` so a caller chaining edits need not re-read between calls.

**Acceptance criteria.**

1. Given a `get_document` call for an existing file, when the response is built, then it contains a `version_token: string` field (lowercase hex SHA-256).
2. Given a successful `write_document`, `insert_in_doc`, `replace_doc_section`, `apply_tags`, `insert_doc_link`, `archive_document`, `remove_document`, `copy_document`, or `move_document` call, when the response is built, then it contains the post-write `version_token` (for `remove_document` returning success, the field is omitted — the file no longer exists; for `move_document` and `copy_document`, the token is of the *destination* file's bytes).
3. The `version_token` MUST be named `version_token` in responses — it is an opaque token from the caller's perspective; the spec MUST NOT name it `content_hash` or expose its computation to callers.
4. `version_token` MUST be present in the `help: true` output of `get_document` and of every write tool, so the mechanism is discoverable.
5. The `modified` timestamp field MUST NOT be used as a version token — timestamps have 1-second resolution and two writes in the same second silently agree (Research §3.11 "what not to use").

**Source.** Research §2 OQ #11/#20/#24/#27, §3.11.

#### 6.2.2. REQ-012: Optional `expected_version` precondition on every file-affecting tool

**Description.** Every write tool that modifies, removes, moves, copies, or archives a file accepts an optional `expected_version` parameter (and an `if_match` alias for the same parameter — both names accepted, `expected_version` preferred in docs). When the parameter is present, the write proceeds only if the file's current on-disk hash matches; on mismatch, the write is refused with a structured conflict envelope (REQ-015). When the parameter is absent, the write proceeds unconditionally — the no-silent-lost-update guarantee is **opt-in** by the caller's choice to pass the token (Research §3.15 OQ23). FlashQuery's own agent and skill callers pass the token in their own code; there is no server-side default-on mode.

**Acceptance criteria.**

1. The system MUST add an optional `expected_version: string` parameter (with `if_match: string` accepted as an alias) to every file-affecting tool: `write_document`, `insert_in_doc`, `replace_doc_section`, `apply_tags`, `insert_doc_link`, `archive_document`, `remove_document`, `copy_document`, `move_document`.
2. Given a write tool invoked without `expected_version`, when it runs, then the write proceeds unconditionally, exactly as today (backward compatible).
3. Given a write tool invoked with `expected_version` matching the file's current on-disk hash, when the write runs, then the write proceeds.
4. Given a write tool invoked with `expected_version` not matching the file's current on-disk hash, when the write is attempted, then it is refused with a `conflict` envelope per REQ-015 — the file MUST NOT be modified.
5. For `remove_document` / `move_document` / `archive_document`, `expected_version` refers to the file being removed / moved / archived. For `copy_document`, `expected_version` refers to the **source** file (the only file the operation reads from disk to copy).
6. The system MUST NOT introduce a default-on mode for first-party callers in v1 — the responsibility for opting in sits with the caller (per §3.2 #4).

**Source.** Research §2 OQ #11/#23/#24, §3.11, §3.15 OQ23/OQ24.

#### 6.2.3. REQ-013: Version check runs inside the write lock against fresh disk bytes

**Description.** The check is a classic time-of-check-to-time-of-use hazard. The sequence MUST be: acquire the per-file write lock → re-read the file from disk → compute its SHA-256 now → compare to the caller's `expected_version` → write or refuse → release. The stored `fqc_documents.content_hash` value MUST NOT be trusted for the comparison — it can lag the file (the scanner refreshes it lazily); the comparison hashes the actual bytes at the moment of writing.

**Acceptance criteria.**

1. Given a write with `expected_version` set, when the tool runs, then the sequence is exactly: acquire lock → fresh `readFile` → compute SHA-256 of the read bytes → compare to `expected_version` → write or refuse → release lock.
2. The check MUST hash the bytes on disk at write time, not `fqc_documents.content_hash` from the DB.
3. The system MUST NOT perform the version comparison outside the write lock — INV-10 forbids any check-then-act on file state outside the lock.
4. Given a write tool that already re-reads inside the lock (documented at `documents/write.ts:215`, `compound.ts:1087`, `compound.ts:1260`), when the version check is added, then the comparison piggybacks on the existing read — no extra `readFile` call is needed.
5. The check is agnostic to *who* modified the file — because the comparison hashes the bytes currently on disk, it catches edits made by external tools (Obsidian, `git`, the user's editor) that an in-process lock cannot see (Research §3.11 requirement #7). A caller that read a file an external tool then edited is correctly refused.

**Source.** Research §3.11 requirements #1, #2, #6, #7.

#### 6.2.4. REQ-014: Token-equals-disk invariant — file, DB row, and returned token mutually consistent

**Description.** Whenever any code path writes a vault file (a normal write, a `targetedScan` repair triggered by `get_document` on drift, or any other helper), the post-write SHA-256 of the bytes actually written is the single source of truth — that value is what is returned as `version_token` on read or write responses **and** what is upserted into `fqc_documents.content_hash`. Today, `document-output.ts:420` computes the hash from the *initial* read, passes it to `targetedScan`, and `document-output.ts:465` writes that pre-repair hash to the DB row; after a frontmatter repair, file / DB row / token all disagree with the bytes now on disk. The fix is to compute the hash from the exact bytes written and propagate that single value.

**Acceptance criteria.**

1. The single atomic write primitive (REQ-020) MUST return the SHA-256 of the bytes it actually wrote.
2. `targetedScan` (or any wrapper that may write a repair on a read path) MUST return a snapshot whose `contentHash` field is the post-write hash returned by the primitive, not the pre-repair hash.
3. `document-output.ts` MUST upsert `fqc_documents.content_hash` with the post-write hash from (1)/(2), and MUST return the same value as `version_token` in the `get_document` response envelope.
4. The system MUST NOT compute the response token by re-hashing in the response builder — the token MUST be the value the write primitive returned, so caller, DB, and disk all agree by construction.
5. INV-05 — at any time `get_document` returns, the bytes on disk SHA-256 to the returned `version_token`, and `fqc_documents.content_hash` for that document equals the same value.
6. Given a `get_document` call that triggers a `targetedScan` repair, when the response is built, then a subsequent `write_document` with `expected_version` equal to the returned token is accepted by the version check (REQ-013) without `targetedScan` having to re-run.

**Source.** Research §2 OQ #27, §3.16 OQ27.
**Failure modes.** This is the current bug exposed by surfacing the token — without this REQ the very first write after a read-triggered repair would be falsely refused.

#### 6.2.5. REQ-015: Refused-write response envelope — new token + caller's current targeted region

**Description.** When a version check refuses a write, the response carries the **new** `version_token` (so a retry need not guess it) and the **caller's current targeted region** (so recovery costs no extra round-trip). The caller then holds three things — (a) the region as it first read it, (b) the region it intended to write, (c) the region as it now stands — and decides locally: if (a) and (c) match, the conflict was caused by an unrelated change and the caller retries with the new token; if they differ, the caller re-reads and re-plans. "Targeted region" is per-tool.

**Acceptance criteria.**

1. The refusal envelope MUST be `error: "conflict"` with `details.reason: "version_mismatch"`, `version_token: <new token>`, and `targeted_region: <per-tool payload>`.
2. The per-tool "targeted region" MUST be: the section body for `replace_doc_section`; the frontmatter object for `apply_tags` and `insert_doc_link`; the whole document for `write_document`; the anchor section or document end for `insert_in_doc`; the whole document for the destructive / structural tools `remove_document` / `move_document` / `archive_document` / `copy_document` (where a conflict means "the file changed — the operation was not performed").
3. Given the caller's target has been **renamed or removed** by the racing change, when the refusal is built, then `targeted_region` MUST contain `not_found: true` rather than a fuzzy or wrong region; the caller's correct response is to re-read the whole document.
4. The representation of the region in the refusal MUST be byte-identical in form to what `get_document` returns for that region — the caller's (a)-versus-(c) comparison MUST NOT spuriously fail due to formatting differences.
5. Building the refusal MUST NOT cost an extra read — the tool already has the full current file in memory at refusal time (it re-read it under the lock per REQ-013).

**Source.** Research §2 OQ #20, §3.11 requirement #5.

#### 6.2.6. REQ-016: The `version_token` is a whole-file hash, not section-scoped

**Description.** The token fingerprints the entire raw file (frontmatter plus body). It is **not** section-scoped, and section-level tokens are explicitly out of scope (§3.3). A consequence is that an unrelated edit elsewhere in a file invalidates the token for a surgical caller's section; the conflict-response design (REQ-015) gives the caller everything it needs to detect and clear that false conflict locally without server complexity.

**Acceptance criteria.**

1. The `version_token` MUST be the SHA-256 of the raw file bytes — frontmatter plus body — with no normalization (no whitespace trimming, no key reordering).
2. `get_document` MUST return the whole-file token even when the caller requested only a section or only the frontmatter (a section read is not a section token).
3. The system MUST NOT expose any section-scoped token, hash, or version field in v1; if one is added later it MUST be a separately named additional field.

**Source.** Research §3.11 requirement #8.

#### 6.2.7. REQ-017: Scanner zero-writes-on-unchanged-files invariant

**Description.** The version-token scheme depends on a load-bearing property: the scanner never rewrites a vault file whose content is unchanged. The current scanner already behaves this way — a steady-state scan reads, hashes, compares, and does nothing on match; only files flagged `needs_frontmatter_repair` (newly discovered, duplicates, path reconnects) get a write, and the flag is cleared on repair. The rebuild MUST preserve this invariant explicitly and a regression test MUST assert it.

**Acceptance criteria.**

1. INV-06 — Given an untouched vault, when two consecutive scans run, then the second scan produces zero file writes (verified by counting `writeMarkdown` calls or stat-based mtime checks).
2. The system MUST NOT introduce any scanner behavior that normalizes or re-timestamps frontmatter on every scan — that would silently break every outstanding `version_token`.
3. Given a scan flags `needs_frontmatter_repair` (one of the four cases at `scanner.ts:684, 806, 950, 985`), when `repairFrontmatter` writes the file, then the flag is cleared so the file is not rewritten on later scans.
4. A regression test that two consecutive scans on a small fixture vault produce zero file writes MUST be added (Test Plan §4.2.7).

**Source.** Research §3.11 token-stability paragraph.
**Notes.** `[ASSUMPTION-05]`.

### 6.3 Multi-file batch contract

#### 6.3.1. REQ-018: Best-effort multi-file batch with per-item result envelope

**Description.** Several tools take more than one file in a single call — `insert_doc_link` (one link, N source documents), `apply_tags`, `archive_document`, `remove_document`, and any `call_macro` touching multiple files. The batch form exists for performance (spares N MCP round-trips) — not for atomic write grouping. Each item is processed exactly as a single-file call: under its own per-file lock and ancestor shared directory locks, with its own optional version check. Items are independent — one item's outcome does not affect another's. The batch is **not** atomic and gives **no ordering guarantee**. The response is an ordered per-item result array, one entry per input file, in input order; each entry's shape is exactly the single-file response (succeeded with new token, conflicted with recovery payload, failed with reason).

**Acceptance criteria.**

1. Given a batch tool called with N items, when the batch returns, then the response contains an ordered array of N result entries, one per input file, in input order.
2. The engine MAY process items in input order, may skip past an item briefly waiting on a lock and return to it, or may process them in parallel — all of which MUST produce the same outcome per item (independence).
3. Each entry MUST be one of: `succeeded` (carries the new `version_token`), `conflicted` (carries the new `version_token` and the targeted region per REQ-015 — identical recovery payload), or `failed` (carries a non-conflict error envelope).
4. The batch MUST NOT be transactional — a half-applied batch is *unfinished*, not *corrupt*; every file in it remains individually valid.
5. The per-tool "targeted region" for a conflicted entry MUST be: the frontmatter for `insert_doc_link` / `apply_tags` / `archive_document`; "the file changed — it was not removed" with the new token + current content for `remove_document` (Research §3.13).
6. Two kinds of "pending" MUST NOT be confused in the response: an item waiting briefly on its lock is invisible to the caller (absorbed as latency); an item failing its version check is an immediate refusal entry in the array.

**Source.** Research §2 OQ #12, §3.13.

#### 6.3.2. REQ-019: Batch input shape — `Array<string | { identifier, version_token }>`

**Description.** Every batch-capable parameter that today accepts `string | string[]` (the `identifiers` field on `remove_document` and `archive_document`, the source-identifiers field on `insert_doc_link`, the targets field on `apply_tags`, and any future batch tool) is widened to `Array<string | { identifier: string, version_token: string }>`. A bare string is an untokened item (behaves exactly as today); an object form carries the token. Tokened and untokened items may be mixed in one call; untokened items simply skip the version check. The change is fully backward-compatible and mirrors the per-item *output* envelope §6.3.1 already defines.

**Acceptance criteria.**

1. Every batch-capable tool MUST accept `Array<string | { identifier: string, version_token: string }>` for its identifier parameter — Zod schema widened accordingly.
2. A bare `string` element MUST be treated exactly as today (no token; no version check).
3. An object element MUST carry its `version_token` into the per-item write path; the per-item result entry MUST be `conflicted` if the token mismatches at write time.
4. Mixed arrays (some elements bare, some object) MUST be valid in one call.
5. The system MUST NOT use parallel positional arrays (e.g., `identifiers: string[]` + `version_tokens?: string[]`) — they were rejected as off-by-one fragile (Research §3.16 OQ30).
6. The system MUST NOT use a separate identifier→token map — it breaks when an identifier repeats or is path-like (Research §3.16 OQ30).

**Source.** Research §2 OQ #30, §3.16 OQ30.

### 6.4 Atomic + durable writes

#### 6.4.1. REQ-020: All vault writes route through one lock-aware, durable atomic write primitive

**Description.** Today at least three independent write paths exist — `vaultManager.writeMarkdown` (`vault.ts:220-222`), the `writeMarkdownFile` helper inside `document-resolver-primitives.ts:102-116`, and `atomicWriteFrontmatter` (`utils/frontmatter.ts`, which swallows errors at debug level) — plus the `move_document` EXDEV fallback (REQ-022). Every one of these is consolidated behind a single lock-aware, durable, unique-temp-name atomic write primitive. Errors MUST surface (INV-03). The devspec phase MUST include an exhaustive write-path inventory as an explicit work item: every `writeFile` / `rename` touching the vault tree is enumerated and reviewed.

**Acceptance criteria.**

1. The system MUST expose a single `writeVaultFile(absPath, content, options)` primitive (or equivalent name) and remove the alternate write helpers.
2. `vaultManager.writeMarkdown`, the inline `writeMarkdownFile` in `document-resolver-primitives.ts`, the body of `atomicWriteFrontmatter`, and the EXDEV branch of `move_document` MUST all delegate to the single primitive.
3. The primitive MUST surface every write error to the caller — INV-03; the current `atomicWriteFrontmatter` catch-and-swallow at `frontmatter.ts:65-69` is removed.
4. The primitive MUST take the per-file lock internally (or document clearly that callers are expected to be inside the lock — recommended: the primitive asserts the lock is held in dev builds).
5. A code review item MUST enumerate every `writeFile`, `appendFile`, or `rename` call against any path under `vault.path` and confirm each routes through the primitive; the review output is recorded in §8 Phase 2 verification.

**Source.** Research §2 OQ #33, §3.5, §3.7 step 6, §3.16 OQ33.

#### 6.4.2. REQ-021: Atomic + durable write sequence

**Description.** The primitive's write sequence is: write a uniquely named temp file in the destination directory → fsync the temp file → atomically rename the temp into place → fsync the containing directory. On macOS, durable flushing requires `fcntl(F_FULLFSYNC)`, not plain `fsync`. The temp filename includes the process pid and a monotonic counter (or a UUID suffix) so two concurrent writes to the same path do not collide on the same temp name (defence in depth — the per-file lock already serializes them, but unique temp names cost nothing).

**Acceptance criteria.**

1. The primitive MUST write to a temp file with a unique name (e.g., `<absPath>.fqc-tmp-${pid}-${counter}` or `<absPath>.fqc-tmp-${uuid}`).
2. The primitive MUST fsync the temp file (`filehandle.sync()`) before the rename.
3. The primitive MUST rename atomically (single-filesystem `rename(2)`).
4. The primitive MUST fsync the containing directory after the rename (`fs.open(dir)` then `fd.sync()` then close).
5. On macOS (`process.platform === 'darwin'`), the primitive MUST use `fcntl(F_FULLFSYNC)` semantics (via the Node API that exposes it, or via an alternative documented in implementation comments) — plain `fsync` is not sufficient.
6. The system MUST keep `cleanStaleTempFiles()` (`vault.ts:337`) running at startup to sweep any stray temp files from crashes; the sweep MUST recognize the unique-name pattern.

**Source.** Research §3.5, §3.7 step 4.
**Failure modes.** Crash between fsync and rename — survivable, the temp is on disk or absent (no torn file). Crash between rename and dir-fsync — the file's bytes are durable but the directory entry pointing at the new inode might not survive on some filesystems; the dir-fsync closes this. Skipping `F_FULLFSYNC` on macOS — would pass plain-fsync tests but lose data after a kernel panic.

#### 6.4.3. REQ-022: Cross-device (EXDEV) fallback uses the same atomic + durable discipline

**Description.** `move_document` may receive an EXDEV error from `rename(2)` if the source and destination are on different filesystems. The current fallback (`move.ts:158-164`) does `readFile(src)` → `writeFile(dst)` → `stat(dst)` → `unlink(src)`, which is not atomic and can leave a partial destination after a crash. The fallback MUST instead apply the §6.4.2 discipline to the cross-device path: write a uniquely named temp file in the *destination* directory, fsync it, rename it into place, fsync the destination directory, then unlink the source. The source is removed only after the destination is committed.

**Acceptance criteria.**

1. Given an EXDEV error on the primary `rename`, when the fallback runs, then it uses the REQ-021 sequence applied to the destination directory.
2. The system MUST NOT use the current direct `writeFile(destAbsPath, content)` fallback.
3. The source MUST be unlinked only after the destination's temp-rename-fsync has completed successfully.
4. Given a crash mid-fallback, when the system restarts, then either the source still exists intact (the destination commit did not complete) or the destination exists intact with the source unlinked — never both partial and never a torn destination.

**Source.** Research §2 OQ #34, §3.16 OQ34.

### 6.5 Records, memory, plugins

#### 6.5.1. REQ-023: Records / memory / plugins coordination after `fqc_write_locks` retirement

**Description.** Records, memory, and plugins are database-backed, not file-backed — per-file locks do not apply to them. They currently hold the coarse `'records'` / `'memory'` / `'plugins'` resource locks via `fqc_write_locks`; retiring the table removes those locks. A per-call-site audit (Research §3.15 OQ25) found: memory's coarse lock is **redundant** (the `fqc_memory_create_version` RPC at `supabase.ts:797` is transactional with its own `SELECT … FOR UPDATE` plus a uniqueness constraint, and `write_memory` already handles the `23505` / `P0002` races); records' coarse lock actually serializes the **reconciliation preamble** (`reconcilePluginDocuments` + `executeReconciliationActions`) shared by `write_record`, `archive_record`, and even the read-only `search_records`; `unregister_plugin` is the only `'plugins'` lock user and is a non-atomic multi-statement delete sequence. The rework replaces these coarse locks with: nothing for memory; a per-plugin advisory lock on the reconciliation preamble (when concurrent runs are not idempotent) and a wrapping transaction on `unregister_plugin`'s delete sequence. Audit results MUST be confirmed before `fqc_write_locks` is dropped (REQ-004).

**Acceptance criteria.**

1. The `acquireLock('records', …)` calls in `records.ts` MUST be removed; the reconciliation preamble MUST be wrapped in either:
   (a) a per-plugin advisory lock keyed on `plugin_id` (`pg_advisory_lock(plugin_id_hash)` on a `withPgClient` checkout), OR
   (b) a no-op, if a concurrency review confirms `reconcilePluginDocuments` + `executeReconciliationActions` are idempotent and tolerate concurrent runs.
   The implementer MUST run the concurrency review and document the choice in code comments.
2. The `acquireLock('memory', …)` calls in `memory.ts` MUST be removed with no replacement; the `fqc_memory_create_version` RPC is the real guard and is already in place.
3. The `acquireLock('plugins', …)` calls in `unregister_plugin` (`plugins.ts`) MUST be removed; the multi-statement delete sequence MUST be wrapped in either a per-plugin advisory lock or a single explicit Postgres transaction.
4. No coarse `'records'` / `'memory'` / `'plugins'` resource lock MUST survive in `fqc_write_locks`'s place — INV-08 also applies to any new advisory locks here.
5. A concurrency review note MUST appear in code comments at each affected handler, documenting why the replacement (or lack thereof) is correct.

**Source.** Research §2 OQ #25, §3.15 OQ25.
**Failure modes.** Removing the `'records'` lock without checking reconciliation idempotence could cause double-applied reconciliation actions; removing `'plugins'` without a transaction could leave a partial unregister mid-delete.

#### 6.5.2. REQ-024: `manage_directory` migrates from table-keyed `directory:` lock to advisory directory locks

**Description.** `manage_directory` in `src/mcp/tools/files.ts:150` is today the lone `directory:`-keyed `fqc_write_locks` user. Retiring the table moves its locking to the new advisory directory locks (REQ-007) — the same `pg_advisory_lock` mechanism, with the resource namespace `dir:` per REQ-003, taking an **exclusive** advisory lock on the folder being structurally changed.

**Acceptance criteria.**

1. `manage_directory` MUST take an exclusive advisory directory lock (via the helper from REQ-007 / REQ-009) on the operated-on folder's canonical absolute path before performing the operation, and release it after.
2. The existing `lock_contention` response envelope shape in `files.ts:155-160` MUST be preserved — only the underlying mechanism changes.
3. Given two concurrent `manage_directory` calls on the same folder, when both dispatch, then exactly one proceeds and the other returns the `conflict` / `lock_contention` envelope (or `lock_timeout` per REQ-006 if the holder takes longer than the timeout).
4. Given an in-flight file write under the folder (holding REQ-007 shared ancestor locks), when `manage_directory` is called for the folder, then the call waits for the file write to complete (or times out per REQ-006).

**Source.** Research §3.12 folder-operations addition.

---

## 7. Architecture & Contracts

### 7.1 Lock subsystem

A single module — recommended path `src/services/document-lock.ts` — exposes the helper API and owns both tiers internally:

```ts
// Single-file lock
export async function withDocumentLock<T>(
  path: string,                           // absolute or vault-relative
  fn: () => Promise<T>
): Promise<T>;

// Multi-file lock (move, copy, atomic batch — sorted-canonical-path order)
export async function withDocumentLocks<T>(
  paths: string[],
  fn: () => Promise<T>
): Promise<T>;

// Directory lock — exclusive for structural ops (manage_directory)
export async function withDirectoryLockExclusive<T>(
  dirPath: string,
  fn: () => Promise<T>
): Promise<T>;

// Directory lock — shared, taken by file writes on every ancestor folder
export async function withAncestorDirectoryLocksShared<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T>;
```

Internals (not exported):

- **Tier 1.** `Map<bigint, AsyncMutex>` lock-striped on the bigint hash of the canonical key (1024 stripes recommended). `async-mutex` library, already a FlashQuery dependency.
- **Tier 2.** Native Postgres advisory locks taken on a `PoolClient` checked out via `withPgClient` from `src/utils/pg-client.ts`. `pg_advisory_lock(key)` / `pg_advisory_unlock(key)` for exclusive; `pg_advisory_lock_shared(key)` / `pg_advisory_unlock_shared(key)` for shared.
- **Key derivation** (REQ-003). One internal function `deriveLockKey(path: string, kind: "file"|"dir"): bigint` — composes realpath, parent-trim for non-existing destinations, case-fold on case-insensitive filesystems, namespace prefix, and a stable bigint hash (e.g., FNV-1a 64-bit).
- **Timeout** (REQ-006). Tier 2 acquire uses `SET LOCAL lock_timeout = '${ms}ms'` then `pg_advisory_lock`, **or** `pg_try_advisory_lock` in a bounded retry loop. The configured `locking.lock_timeout_seconds` (default 10) controls both.

### 7.2 Configuration

`flashquery.yml` `locking:` section (REQ-004, REQ-006):

```yaml
locking:
  enabled: true
  # Bounded wait for acquiring a contended write lock, in seconds.
  # Comment out to use the default of 10.
  # lock_timeout_seconds: 10
```

The legacy `ttl_seconds` key MUST be removed from `flashquery.yml`, `flashquery.test.yml`, and `.env.example` template files; loaders silently ignore it with one `warn` log line if encountered (REQ-004 AC #2).

### 7.3 Tool surface — read and write

**`get_document` response envelope (additive change).** The existing fields (`identifier, title, path, fq_id, modified, size, …`) stay; one new field is added:

```ts
{
  // … existing fields …
  version_token: string;  // lowercase hex SHA-256 of the file's on-disk bytes at response time
}
```

**Write-tool input parameters (additive change).** Every file-affecting tool gains:

```ts
{
  // … existing params …
  expected_version?: string;  // optional — passing it opts in to the version check
  // `if_match: string` is also accepted as an alias for backward-compatibility
  // with HTTP conventions; documented secondarily.
}
```

**Batch-input shape (REQ-019).** Every batch parameter that accepted `string | string[]` accepts:

```ts
Array<string | { identifier: string; version_token: string }>
// or the single-element bare string form, unchanged from today
```

**Success-response envelope (REQ-011).** Every write-tool success response gains:

```ts
{
  // … existing fields …
  version_token?: string;  // present on successful single-file writes;
                           // omitted on remove_document success (file gone)
}
```

**Batch-response envelope (REQ-018).** A batch tool returns an ordered array of per-item entries, in input order:

```ts
type BatchItemResult =
  | { status: "succeeded"; identifier: string; version_token?: string; /* … tool-specific success fields */ }
  | { status: "conflicted"; identifier: string; version_token: string; targeted_region: object; details: { reason: "version_mismatch" } }
  | { status: "failed"; identifier: string; error: ErrorEnvelope };
```

### 7.4 Error envelopes

Three structured envelopes the new layer emits (REQ-006, REQ-015):

```ts
// REQ-015 — version mismatch on a single-file write
{ error: "conflict", message: "…", details: { reason: "version_mismatch" }, version_token: "<new>", targeted_region: <per-tool payload> }

// REQ-006 — lock acquisition exceeded the configured timeout
{ error: "conflict", message: "Write lock timeout: another writer holds this file. Retry in a few seconds.", details: { reason: "lock_timeout" } }

// REQ-007 / REQ-024 — directory lock contention (existing files.ts shape)
{ error: "conflict", message: "Directory is currently locked by another operation.", details: { reason: "lock_contention" } }
```

These envelopes follow the existing `jsonExpectedError` pattern in `src/mcp/utils/response-formats.ts` — they are *expected* (not runtime) errors and have `isError: false` at the MCP level.

### 7.5 Atomic write primitive contract

```ts
// REQ-020 / REQ-021. Recommended location: src/storage/vault-write.ts (new),
// re-exported by vault.ts for backward compatibility.

export async function writeVaultFile(
  absPath: string,
  bytes: Buffer | string,
  options?: { /* allow callers to skip fsync only in test contexts */ }
): Promise<{ contentHash: string }>;
```

The return value carries the SHA-256 of the bytes actually written (REQ-014). All other vault-write helpers — `vaultManager.writeMarkdown`, `writeMarkdownFile` (`document-resolver-primitives.ts`), `atomicWriteFrontmatter` — delegate to this primitive and re-expose any tool-specific shaping above it.

---

## 8. Phased Implementation Plan

### 8.1 Phasing Rationale

The order is driven by three concerns. (1) **Close the live defect first** — REQ-010 (`insert_doc_link` and `apply_tags` unlocked) is losing updates today, so Phase 1 brings them under the per-file lock immediately, using a Tier-1-only implementation that is structurally complete even while Tier 2 remains the old table. (2) **Make the safe primitives safe before changing the lock layer** — Phase 2 consolidates the write primitive and adds durability so subsequent lock changes are testing one variable at a time. (3) **Audit before retire** — Research §3.15 OQ25 explicitly requires the records / memory / plugins concurrency review (Phase 3) to complete *before* `fqc_write_locks` is dropped (Phase 4), because the table is what those subsystems hold today.

Phases 5–9 layer on the remaining decided design (precise key derivation, folder locks, destination locks, version-fingerprint check, batch input shape) in order of decreasing foundational-ness.

### 8.2 Phase Summary

| Phase | Name | Depends On | Key REQs | Test Plan Refs |
|---|---|---|---|---|
| 1 | Per-file Tier 1 + live-defect close | None | REQ-001, REQ-003 (basic key only), REQ-009, REQ-010, REQ-025 | Test Plan §4.1.1, §4.1.3, §4.1.9, §4.1.10, §4.1.11 |
| 2 | Atomic + durable write primitive consolidation | None | REQ-020, REQ-021 | Test Plan §4.4.1, §4.4.2 |
| 3 | Records / memory / plugins audit + guards | Phase 2 (for any vault-write touches) | REQ-023 | Test Plan §4.5.1 |
| 4 | Tier 2 + retire `fqc_write_locks` + session-capable connection | Phases 1, 2, 3 | REQ-002, REQ-004, REQ-005 | Test Plan §4.1.2, §4.1.4, §4.1.5 |
| 5 | Lock-acquisition timeout + full canonical-key derivation | Phase 4 | REQ-006, REQ-003 (full) | Test Plan §4.1.3, §4.1.6 |
| 6 | Folder locks + `manage_directory` migration | Phase 4 | REQ-007, REQ-024 | Test Plan §4.1.7, §4.5.2 |
| 7 | Destination-path locks + EXDEV fallback | Phases 4, 6 | REQ-008, REQ-022 | Test Plan §4.1.8, §4.4.3 |
| 8 | Version-fingerprint check | Phases 1, 2, 4 | REQ-011 — REQ-017 | Test Plan §4.2.1 – §4.2.7 |
| 9 | Multi-file batch contract input + output shape | Phase 8 | REQ-018, REQ-019 | Test Plan §4.3.1, §4.3.2 |

### 8.3. Phase 1: Per-file Tier 1 + live-defect close

**Goals.** Introduce the `withDocumentLock` helper backed by a Tier 1 in-process striped registry on `async-mutex`. Wire it at every documents/* and compound.ts call site, including the two unlocked tools (`insert_doc_link`, `apply_tags`). The legacy `acquireLock('documents', …)` table lock continues to be acquired by the helper's "Tier 2" pass-through while Phase 4 prepares the real Tier 2. Net result: same-process contention is now per-file; the live data-loss defect is closed.

**Depends on.** None.

**Development work.**

- *Files to create:* `src/services/document-lock.ts` — the helper module exposing `withDocumentLock`, `withDocumentLocks`. Tier 1 = striped `Map<bigint, Mutex>` on a simple realpath-based key (full canonical-key derivation lands in Phase 5; Phase 1 uses a relative-path-via-vault-root key that is good enough until Phase 5 tightens it).
- *Files to modify:* `src/mcp/tools/documents/write.ts`, `archive.ts`, `remove.ts`, `copy.ts`, `move.ts`, and `src/mcp/tools/compound.ts` — every `acquireLock('documents', …)` → `withDocumentLock(path, async () => { … })`. The lock helpers from `src/services/write-lock.ts` remain in place internally as the temporary Tier 2 stand-in.
- *Files to modify:* `src/mcp/tools/compound.ts:154` (`insert_doc_link`) and `:280` (`apply_tags`) — wrap their handlers in `withDocumentLock` (or `withDocumentLocks` for `insert_doc_link`'s N-source case) — **highest priority within this phase**.
- *Files to modify:* `src/services/scanner.ts` — `repairFrontmatter()` adopts the per-file lock so scans and MCP writes coordinate on the same file (Research §3.7 step 6); the top-level `scanMutex` stays.
- *Files to **not** modify:* `src/mcp/tools/macro.ts` and `src/macro/evaluator.ts` — `call_macro` MUST remain free of any direct lock acquisition; each macro-dispatched tool call already routes through its handler's `withDocumentLock`. The accompanying test `T-U-038` is a static-check assertion that no lock primitives leak into the macro engine (REQ-025).
- *Documentation update:* `help: true` output for `call_macro` updated per REQ-025 AC #5 — the macro model is documented in-tool: per-step locking, no macro-spanning lock, opt-in `version_token` threading for multi-step safety, auto-threading and atomic execution deferred.

**Requirements implemented.** REQ-001, REQ-003 (basic key), REQ-009, REQ-010, REQ-025.

**Tests required.** Test Plan §4.1.1 (per-file granularity), §4.1.3 (basic key derivation), §4.1.9 (helper API), §4.1.10 (live-defect regression — two concurrent `apply_tags` don't lose updates), §4.1.11 (`call_macro` uniform pattern — every macro step takes its own per-file lock; no macro-spanning lock).

**Definition of Done.**

- All listed REQs have at least one passing unit and one passing integration test.
- The two unlocked compound tools take the per-file lock; the regression test §4.1.10 passes.
- `npm test` and `npm run test:integration` pass; existing tests (notably `tests/integration/archive-document-lock.test.ts`) continue to pass.

**Verification.**

- [ ] `npm test -- --grep "document-lock"` exits 0.
- [ ] `npm run test:integration -- --grep "per-file|live-defect"` exits 0.
- [ ] No `acquireLock('documents', …)` literal remains in `src/mcp/tools/documents/**` or `src/mcp/tools/compound.ts` (grep check).

### 8.4. Phase 2: Atomic + durable write primitive consolidation

**Goals.** Create the single `writeVaultFile` primitive, route every existing vault-write through it, fix the silent-failure path in `atomicWriteFrontmatter`, add the temp-fsync-rename-dir-fsync sequence with `F_FULLFSYNC` on macOS and unique temp names.

**Depends on.** None.

**Development work.**

- *Files to create:* `src/storage/vault-write.ts` — `writeVaultFile(absPath, bytes, options)` implementing REQ-021's sequence and returning the content hash. Unique temp names use `pid` and a process-monotonic counter.
- *Files to modify:* `src/storage/vault.ts` — `vaultManager.writeMarkdown` delegates to `writeVaultFile`; `cleanStaleTempFiles()` recognizes the new unique-name pattern.
- *Files to modify:* `src/mcp/utils/document-resolver-primitives.ts:102-116` — the private `writeMarkdownFile` helper deletes itself; callers use `writeVaultFile`. Importantly the function signature contracts so callers receive the post-write hash for REQ-014.
- *Files to modify:* `src/utils/frontmatter.ts` — `atomicWriteFrontmatter` delegates to `writeVaultFile`; the `try/catch` at lines ~65-69 that swallows errors is removed; errors propagate.
- *Files to modify:* `src/services/plugin-reconciliation.ts:380-384` — caller adapts to the surfaced errors (no code change required beyond ensuring it does not catch-and-swallow).
- *Audit deliverable:* a code-review checklist file under `flashquery-product/Meta/Reviews/` (or attached to the Phase 2 PR description) enumerating every `writeFile` / `appendFile` / `rename` call against a path under `vault.path` and noting that each routes through `writeVaultFile`.

**Requirements implemented.** REQ-020, REQ-021.

**Tests required.** Test Plan §4.4.1 (write-path consolidation), §4.4.2 (atomic + durable sequence — fsync calls, unique temp names, error surface).

**Definition of Done.**

- The audit checklist shows every vault write routes through `writeVaultFile`.
- `atomicWriteFrontmatter` errors propagate (a regression test §4.4.1 forces a write failure and asserts the error is surfaced).
- All existing tests pass.

**Verification.**

- [ ] `npm test -- --grep "vault-write|atomic-write"` exits 0.
- [ ] `grep -rn "writeFile\|\.rename(" src/storage src/utils src/mcp src/services | grep -v "vault-write.ts"` returns no vault-path writes outside the primitive.
- [ ] `npm run test:integration -- --grep "frontmatter-write|durability"` exits 0.

### 8.5. Phase 3: Records / memory / plugins audit + guards

**Goals.** Confirm `reconcilePluginDocuments` + `executeReconciliationActions` are concurrent-safe (or add a per-plugin advisory guard); wrap `unregister_plugin`'s multi-statement delete sequence in a per-plugin advisory lock or a single explicit transaction. This phase precedes table drop because Phase 4 removes the coarse `'records'` / `'plugins'` locks these subsystems currently hold.

**Depends on.** Phase 2 (any vault-write touches inside reconciliation flow now route through the consolidated primitive).

**Development work.**

- *Concurrency review note:* a short markdown checklist under `flashquery-product/Meta/Reviews/` (or attached to PR) walking each `reconcilePluginDocuments` write path and documenting whether concurrent runs are idempotent.
- *Files to modify (if review concludes not-idempotent):* `src/services/plugin-reconciliation.ts` — wrap the preamble in a `pg_advisory_lock(plugin_id_hash)` via `withPgClient`.
- *Files to modify:* `src/mcp/tools/records.ts` — remove `acquireLock('records', …)` and `releaseLock(…, 'records')` (lines 259, 376, 500, 593, 631, 883).
- *Files to modify:* `src/mcp/tools/memory.ts` — remove `acquireLock('memory', …)` and `releaseLock(…, 'memory')` (lines 248, 382). No replacement; the `fqc_memory_create_version` RPC remains the guard.
- *Files to modify:* `src/mcp/tools/plugins.ts:419` — wrap `unregister_plugin`'s delete sequence in either a per-plugin advisory lock or a Postgres transaction (`withPgClient` + `BEGIN`/`COMMIT`/`ROLLBACK`).

**Requirements implemented.** REQ-023.

**Tests required.** Test Plan §4.5.1 (records/memory/plugins coordination — memory updates under concurrent versioning; unregister_plugin under concurrent invocation).

**Definition of Done.**

- The concurrency review note exists and is referenced from the PR.
- No `acquireLock('records'|'memory'|'plugins', …)` literal remains in the codebase.
- `unregister_plugin` is transactional or per-plugin-locked; a test races two unregisters and asserts no half-state.

**Verification.**

- [ ] `grep -rn "acquireLock('records'\|'memory'\|'plugins'" src/` returns nothing.
- [ ] `npm run test:integration -- --grep "records|memory|unregister"` exits 0.

### 8.6. Phase 4: Tier 2 + retire `fqc_write_locks` + session-capable connection

**Goals.** Replace the temporary Tier 2 (legacy table) inside `document-lock.ts` with native `pg_advisory_lock` on `withPgClient`. Drop `fqc_write_locks` on startup. Add the session-capable-connection startup self-test. Remove the `acquireLock` / `releaseLock` / `isLocked` service module, the `flashquery unlock` CLI, and the legacy DDL and config keys.

**Depends on.** Phases 1, 2, 3.

**Development work.**

- *Files to modify:* `src/services/document-lock.ts` — Tier 2 swaps from `acquireLock` to `pg_advisory_lock(key)` / `pg_advisory_unlock(key)` on a `withPgClient` checkout, holding the same `PoolClient` across the wrapped fn.
- *Files to create:* `src/services/lock-startup.ts` — the startup self-test that takes a throwaway advisory lock on one `withPgClient` call, verifies it is visible from a second call, releases it, and fails loudly on misbehavior.
- *Files to modify:* `src/index.ts` — invoke `runLockStartupSelfTest()` before serving any requests; abort startup on failure.
- *Files to modify:* `src/storage/supabase.ts` — add the startup `DROP TABLE IF EXISTS fqc_write_locks` step (with a `debug` log line); remove the DDL at lines 521-546.
- *Files to remove:* `src/services/write-lock.ts`, `src/cli/commands/unlock.ts`.
- *Files to modify:* `src/config/loader.ts` — emit a `warn` log line once if `locking.ttl_seconds` is encountered; otherwise drop it.
- *Files to modify:* `flashquery.yml`, `flashquery.test.yml`, `.env.example` — remove `ttl_seconds`; add the commented-out `lock_timeout_seconds` (sets the stage for Phase 5).
- *Docs:* `README.md`, the Supabase setup guide, and inline `flashquery.yml` commentary updated to state the session-capable-connection requirement.

**Requirements implemented.** REQ-002, REQ-004, REQ-005.

**Tests required.** Test Plan §4.1.2 (two-tier behavior — Tier 1 in-process, Tier 2 cross-process), §4.1.4 (retire fqc_write_locks — drop-on-startup, no imports), §4.1.5 (session-capable self-test pass and fail).

**Definition of Done.**

- The startup self-test passes against a session-capable connection and fails clearly against a transaction-mode pooler.
- The `fqc_write_locks` table no longer exists after startup; no FlashQuery code references it.
- Two FlashQuery processes pointed at one vault serialize on `pg_advisory_lock` per file (cross-process integration test).
- The README and config commentary reflect the new requirement.

**Verification.**

- [ ] `grep -rn "fqc_write_locks\|src/services/write-lock" src/` returns nothing.
- [ ] `npm test -- --grep "advisory-lock|lock-startup"` exits 0.
- [ ] `npm run test:integration -- --grep "two-tier|fqc_write_locks-drop|session-capable"` exits 0.
- [ ] Building with the test `__setPgPoolFactoryForTesting` simulating a transaction-mode pooler causes startup to fail with the expected error message.

### 8.7. Phase 5: Lock-acquisition timeout + full canonical-key derivation

**Goals.** Make the bounded-wait timeout configurable in `flashquery.yml`; finish the canonical-key derivation work (REQ-003) — realpath for existing paths, realpath(parent)+basename for destinations, case-folding on case-insensitive filesystems, resource-namespace prefix.

**Depends on.** Phase 4.

**Development work.**

- *Files to modify:* `src/services/document-lock.ts` — replace Phase 1's basic key with the full REQ-003 derivation. Detect filesystem case-sensitivity at module init via one probe (create a temp dir, stat its case-variant path). Add the namespace prefix (`file:` / `dir:`). Hash via FNV-1a 64 (or another stable bigint hash).
- *Files to modify:* `src/services/document-lock.ts` — wire `lock_timeout_seconds` config (default 10) into Tier 2 acquire as `SET LOCAL lock_timeout = '${ms}ms'` then `pg_advisory_lock`, *or* `pg_try_advisory_lock` in a bounded retry loop. The choice is the dev agent's; document it in code comments.
- *Files to modify:* `src/config/loader.ts` — load and validate `locking.lock_timeout_seconds` (positive integer; default 10).

**Requirements implemented.** REQ-006, REQ-003 (full).

**Tests required.** Test Plan §4.1.3 (full canonical-key derivation — symlink unification, case-fold, destination keying), §4.1.6 (timeout — default 10 s, configurable, structured error).

**Definition of Done.**

- A case-variant path on a case-insensitive filesystem takes the same lock (unit test).
- Two writers contending the same file: the second writer times out at the configured value (integration test).

**Verification.**

- [ ] `npm test -- --grep "canonical-key|case-fold|symlink"` exits 0.
- [ ] `npm run test:integration -- --grep "lock-timeout"` exits 0.

### 8.8. Phase 6: Folder locks + `manage_directory` migration

**Goals.** Implement shared/exclusive advisory directory locks; have file writes take shared ancestor folder locks; migrate `manage_directory` onto exclusive folder locks; preserve the existing `lock_contention` envelope shape.

**Depends on.** Phase 4 (advisory-lock primitive).

**Development work.**

- *Files to modify:* `src/services/document-lock.ts` — add `withAncestorDirectoryLocksShared(filePath, fn)` and `withDirectoryLockExclusive(dirPath, fn)`. Use `pg_advisory_lock_shared` and `pg_advisory_lock` (exclusive) on `dir:`-namespaced keys. Composition: a file write does `withAncestorDirectoryLocksShared` outside its `withDocumentLock`.
- *Files to modify:* every documents/* and compound.ts write site — wrap the `withDocumentLock` call in `withAncestorDirectoryLocksShared`.
- *Files to modify:* `src/mcp/tools/files.ts:150` — `manage_directory` switches from `acquireLock('directory:…')` to `withDirectoryLockExclusive` with the same response-shaping on contention.

**Requirements implemented.** REQ-007, REQ-024.

**Tests required.** Test Plan §4.1.7 (folder-lock protocol — file write blocks rename; concurrent file writes don't block each other), §4.5.2 (`manage_directory` migration).

**Definition of Done.**

- Integration tests verify the shared/exclusive interactions in both directions.
- `manage_directory`'s response envelope is unchanged from the caller's perspective.

**Verification.**

- [ ] `npm run test:integration -- --grep "folder-lock|manage-directory"` exits 0.

### 8.9. Phase 7: Destination-path locks + EXDEV fallback

**Goals.** Add destination-path lock acquisition to `copy_document`, `move_document`, and create-mode `write_document`; ensure `move_document` takes both source and destination in sorted canonical-path order; replace the non-atomic EXDEV fallback with the standard atomic + durable sequence.

**Depends on.** Phase 4 (Tier 2), Phase 6 (folder locks for the composition).

**Development work.**

- *Files to modify:* `src/mcp/tools/documents/copy.ts` (`:131-155` destination flow) — take `withDocumentLock` on the destination canonical path before any work; preserve the existing `path_exists` `conflict` envelope as a fast-fail inside the lock.
- *Files to modify:* `src/mcp/tools/documents/move.ts` (`:128-154` destination flow + `:158-164` EXDEV) — take `withDocumentLocks([source, destination])` (sorted canonical order — INV-09); replace the EXDEV branch with a call into `writeVaultFile` against the destination directory followed by `unlink(source)` only after the destination is committed.
- *Files to modify:* create-mode `write_document` (`documents/write.ts`) — when the destination does not yet exist, derive the lock key per REQ-003 AC #2 and take the per-file lock on that key.

**Requirements implemented.** REQ-008, REQ-022.

**Tests required.** Test Plan §4.1.8 (destination-path locks; race-prevention), §4.4.3 (EXDEV fallback atomic + durable; crash-resilience).

**Definition of Done.**

- A test that races two `copy_document` calls to the same destination produces exactly one success and one `conflict` (`path_exists` or `lock_timeout`).
- An EXDEV-simulating test (mocked `rename` returning EXDEV) demonstrates the temp-fsync-rename-fsync path is used and the source is unlinked only after the destination is durable.

**Verification.**

- [ ] `npm run test:integration -- --grep "destination-lock|exdev"` exits 0.

### 8.10. Phase 8: Version-fingerprint check

**Goals.** Add `version_token` to `get_document` and to every write tool's success response; accept `expected_version` (and `if_match` alias) on every file-affecting tool; check inside the write lock against fresh disk bytes; ship the conflict envelope (REQ-015) with the per-tool targeted region; enforce the token = disk invariant (REQ-014); add the scanner zero-writes regression test (REQ-017).

**Depends on.** Phases 1, 2, 4 (lock helper, write primitive returning the post-write hash, retired fqc_write_locks).

**Development work.**

- *Files to modify:* `src/mcp/tools/documents/get.ts` and `src/mcp/utils/document-output.ts` — add `version_token` to the response envelope (REQ-011); ensure the value equals the hash returned by the (post-repair) write primitive when `targetedScan` writes a repair (REQ-014). Update the `fqc_documents.content_hash` upsert at `document-output.ts:465` to use the same post-write value.
- *Files to modify:* `src/mcp/utils/document-resolver-primitives.ts` — `targetedScan` returns the hash of the bytes it actually wrote (calling into `writeVaultFile`'s return value), not the pre-repair hash.
- *Files to modify:* every write tool — add `expected_version?: string` and `if_match?: string` to the Zod schema; in the handler, after acquiring the lock and re-reading the file, compute the hash and compare to the passed-in value; on mismatch, return the REQ-015 conflict envelope (with the per-tool targeted region); on match, proceed and include the post-write `version_token` in the success response.
- *Files to modify:* `src/mcp/tools/documents/get.ts` — surface `version_token` in `help: true` output.
- *Files to modify:* `src/services/scanner.ts` (and tests/scenarios) — add a regression test that two consecutive scans of an untouched vault produce zero file writes (REQ-017).
- *Documentation:* update `help: true` output for every affected tool to document `expected_version` (and `if_match`) and `version_token`.

**Requirements implemented.** REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017.

**Tests required.** Test Plan §4.2.1 – §4.2.7 (token in responses, opt-in check, check-inside-lock, token-equals-disk, refused-write envelope, whole-file hash, scanner zero-writes invariant).

**Definition of Done.**

- A `get_document` that triggers a `targetedScan` repair returns a token a subsequent no-op write accepts (regression test §4.2.4).
- Two consecutive scans on a small fixture vault produce zero writes (§4.2.7).
- Conflict envelope shape matches §7.4 exactly.

**Verification.**

- [ ] `npm test -- --grep "version-token|version-check"` exits 0.
- [ ] `npm run test:integration -- --grep "version-token|conflict-envelope|scanner-zero-writes"` exits 0.
- [ ] `python3 tests/scenarios/directed/run_suite.py --managed version_token_get` reports PASS.

### 8.11. Phase 9: Multi-file batch contract input + output shape

**Goals.** Widen every batch-capable tool's identifier parameter to the mixed `Array<string | { identifier, version_token }>` shape; emit the ordered per-item response envelope in the unified `succeeded | conflicted | failed` form; preserve full backward-compatibility for callers passing bare strings.

**Depends on.** Phase 8 (the per-item version check).

**Development work.**

- *Files to modify:* the Zod schemas for `remove_document.identifiers` (`documents/remove.ts:29-33`), `archive_document.identifiers` (`documents/archive.ts:25-31`), `insert_doc_link` source identifiers (`compound.ts:159-171`), `apply_tags` targets (`compound.ts:285-307`), and any future batch tool — `z.union([z.string(), z.array(z.union([z.string(), z.object({ identifier: z.string(), version_token: z.string() })]))])`.
- *Files to modify:* each batch handler — coerce a bare string element to `{ identifier, version_token: undefined }` internally; thread the per-item token into the per-item write path; build the per-item result entry in the unified shape (REQ-018, §7.3 batch-response envelope).
- *Help-text update:* document the mixed-array form in `help: true` output for every batch tool.

**Requirements implemented.** REQ-018, REQ-019.

**Tests required.** Test Plan §4.3.1 (per-item result envelope — succeeded / conflicted / failed mix), §4.3.2 (mixed-array input — bare strings + objects in one call).

**Definition of Done.**

- A batch with one bare string + one object element produces two entries in the array, in input order, with the object's version check honored and the bare string's skipped.
- All existing batch callers continue to work unchanged.

**Verification.**

- [ ] `npm run test:integration -- --grep "batch-envelope|batch-input-shape"` exits 0.
- [ ] `python3 tests/scenarios/integration/run_integration.py batch_version_tokens` reports PASS.

---

## 9. Open Questions for Developer

No open questions — ready for dev.

The few naming choices the spec author made (rather than escalate as OQs):

- The config key is `lock_timeout_seconds` (consistent with the retired `ttl_seconds`'s naming style); not `acquisition_timeout_seconds` or `timeout_seconds`.
- The precondition parameter is `expected_version` as the primary name, with `if_match` accepted as a backward-compatible HTTP-style alias. The response field is `version_token` (named for its use, not its implementation — Research §3.11).
- The advisory-lock-key namespace prefixes are `file:` and `dir:` per Research §3.16 OQ32.
- The single lock-helper module is recommended at `src/services/document-lock.ts`; the single write primitive at `src/storage/vault-write.ts`. The dev agent may rename if a better fit emerges, but the contracts in §7 are stable.

If during implementation the dev agent finds any decision genuinely underspecified, pause and ask before guessing.

---

## 10. Glossary

- **Tier 1.** The in-process striped registry of `async-mutex` locks keyed by canonical absolute path; serializes contention within one FlashQuery process. Microsecond cost, no I/O.
- **Tier 2.** The cross-process native Postgres advisory lock taken on a `PoolClient` checkout via `withPgClient`; serializes contention between separate FlashQuery processes sharing a vault. Session-scoped.
- **Canonical absolute path.** The path after `realpath` resolution (with the `realpath(parent)+basename` rule for not-yet-existing destinations), case-folded on case-insensitive filesystems, prefixed with the `file:` or `dir:` namespace before being hashed to the Tier 2 bigint key (REQ-003).
- **`version_token`.** The opaque SHA-256 hex of the file's on-disk bytes returned on read and write responses; a caller passes it back as `expected_version` on a write to opt into the version check (REQ-011, REQ-012). Equal by invariant to `fqc_documents.content_hash` and the file bytes at response time (INV-05).
- **Bounded wait.** The configurable lock-acquisition timeout (default 10 s) after which a contended writer fails with a structured `lock_timeout` envelope instead of blocking forever (REQ-006).
- **Best-effort batch.** A multi-file operation that processes each item under its own per-file lock and version check, returns an ordered per-item result array, and provides no atomicity across items (REQ-018).
- **Folder shared lock.** An advisory `pg_advisory_lock_shared` on a folder's canonical absolute path, taken by every file write on every ancestor folder up to the vault root (REQ-007); conflicts with the exclusive folder lock a structural folder operation takes.
- **Live defect.** The pre-existing condition that `insert_doc_link` and `apply_tags` take no write lock at all in the current code (Research §3.8); closed by REQ-010 in Phase 1.

---

## 11. Related

- **Research document:** [Vault Write Coherency Locking Research.md](./Vault%20Write%20Coherency%20Locking%20Research.md)
- **Test plan:** [Vault Write Coherency Locking Test Plan.md](./Vault%20Write%20Coherency%20Locking%20Test%20Plan.md)
- **Related research:** `Research/Multi-Vault.md` — the locking model becomes vault-scoped if Multi-Vault lands; the cross-instance defect closed by REQ-004 is load-bearing for that document.

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-001 | Phase 155 | Complete |
| REQ-002 | Phase 158 | Pending |
| REQ-003 | Phase 159 | Pending |
| REQ-004 | Phase 158 | Complete |
| REQ-005 | Phase 158 | Complete |
| REQ-006 | Phase 159 | Pending |
| REQ-007 | Phase 160 | Pending |
| REQ-008 | Phase 161 | Pending |
| REQ-009 | Phase 155 | Complete |
| REQ-010 | Phase 155 | Complete |
| REQ-011 | Phase 162 | Pending |
| REQ-012 | Phase 162 | Pending |
| REQ-013 | Phase 162 | Pending |
| REQ-014 | Phase 162 | Pending |
| REQ-015 | Phase 162 | Pending |
| REQ-016 | Phase 162 | Pending |
| REQ-017 | Phase 162 | Pending |
| REQ-018 | Phase 163 | Pending |
| REQ-019 | Phase 163 | Pending |
| REQ-020 | Phase 156 | Complete |
| REQ-021 | Phase 156 | Complete |
| REQ-022 | Phase 161 | Pending |
| REQ-023 | Phase 157 | Complete |
| REQ-024 | Phase 160 | Pending |
| REQ-025 | Phase 155 | Complete |

Coverage: 25/25 v3.9 requirements mapped exactly once.

## Review Notes

Recorded during the six-pass self-review (Step 7 of `fq-devspec`), 2026-05-25.

- **Pass 1 (Requirements coverage):** Found two omissions. (a) Research §3.13's "Atomic batches — reserved opt-in" was not captured as a deferred item — added as §3.3 #3. (b) Research §3.11 requirement #7 (the check is agnostic to *who* changed the file — it catches external writers) was implicit but not stated as acceptance criteria — added as REQ-013 AC #5. Every other resolved OQ and decided design point is captured as a REQ or marked deferred in §3.2 / §3.3.
- **Pass 2 (Codebase accuracy):** Spot-verified every file path and the load-bearing line numbers — `src/services/write-lock.ts`, `src/storage/vault.ts:220-222` (note: the research doc cites `:214-216` for the temp+rename block, but the current code has it at `:220-222` — the spec's number is current), `src/utils/pg-client.ts` (`withPgClient` confirmed at line ~65), `src/mcp/utils/document-output.ts:420/431/465`, `src/mcp/utils/document-resolver-primitives.ts:102-116/470`, `src/utils/frontmatter.ts:65-69`, the split `src/mcp/tools/documents/{write,get,archive,remove,copy,move}.ts`, `src/mcp/tools/compound.ts:154/280/1062/1237`, `tests/integration/archive-document-lock.test.ts`, `tests/scenarios/directed/testcases/test_batch_get_document.py`. Scanner inner-line numbers (`:1271`, `:684`, `:806`, `:950`, `:985`) come from the research doc; the dev agent should reconfirm exact lines when authoring scanner tests (this is also flagged in §5.1).
- **Pass 3 (Ambiguity):** Two minor hedges noted and left intentional. REQ-002 AC #3 says "recommended: 1024" stripes — the count is a tunable, not a contract; the dev agent picks. REQ-009 AC #5 phrases the no-export rule as "build-time error" — the enforcement mechanism (ESLint rule, no-direct-export pattern, equivalent) is the dev agent's call. Neither leaves a behavioral ambiguity for the dev agent.
- **Pass 4 (Self-consistency):** All cross-references resolve. REQ-NNN sequence 001–024 is gap-free; INV-NN sequence 01–10 is gap-free. Every REQ in §6 appears in exactly one phase in §8.2/§8.3+; no phase implements a non-existent REQ. Glossary terms used consistently throughout.
- **Pass 5 (Gap analysis, two rounds):** First round caught the §3.3 atomic-batch and REQ-013 AC #5 items already noted in Pass 1. Second round caught two test-coverage gaps in the Test Plan: INV-07 (reads don't lock) had no dedicated test, and REQ-008 AC #3 (create-mode `write_document` destination race) was not explicitly tested — both fixed in the Test Plan (T-U-037 and T-I-048).
- **Pass 6 (Per-phase tests):** Every phase in §8 has a non-empty "Tests required" line referencing real Test Plan sections, and the layer choices are appropriate to the work (unit for primitives and schemas, integration for cross-tool behaviors, directed scenario for highest-leverage MCP-surface verifications, integration scenario for cross-domain workflows).

### Post-review addendum — `call_macro` coverage (2026-05-25)

After the initial six-pass review, a conversation about `call_macro` and parallel-macro concurrency surfaced a question the original spec hadn't explicitly addressed: whether `call_macro` itself takes a macro-spanning lock or relies on the uniform per-file pattern at each step. The decision (Option A — uniform per-file pattern; macro-engine auto-threading of `version_token` and macro-level atomic execution both deferred — recorded in Research §3.17) was folded into this Requirements doc the same day:

- **REQ-025** added at §6.1.11 — explicit acceptance criteria covering the uniform pattern, the absence of any macro-spanning lock, the opt-in `version_token` stance for multi-step safety, and a `help: true` documentation update.
- **§3.3 #4 and #5** added — macro-engine auto-threading and macro atomic-execution opt-in formally deferred with reasoning.
- **§8.2 and §8.3 (Phase 1)** updated — REQ-025 added to Phase 1 since the per-file lock wiring already makes it true; the phase now also calls out the `src/mcp/tools/macro.ts` file explicitly as *files to **not** modify*, with the static-check test as the guard. The dev agent should keep this file lock-free even if convenience tempts otherwise.

The Test Plan was extended in lockstep — §4.1.11, the new `D-WCO-08` directed coverage ID, and the §5/§8 matrices and checklist all carry the new tests (T-U-038, T-I-049, T-I-050, T-I-051, T-S-008).
