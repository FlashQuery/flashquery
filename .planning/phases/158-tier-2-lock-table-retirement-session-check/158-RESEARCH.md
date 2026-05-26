# Phase 158: Tier 2 + Lock-table Retirement + Session Check - Research

**Researched:** 2026-05-26  
**Domain:** PostgreSQL session advisory locks, FlashQuery startup/schema retirement, TypeScript/Vitest validation  
**Confidence:** HIGH for implementation hotspots and PostgreSQL semantics; MEDIUM for transaction-pooler simulation details

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### D-01: Canonical Source Documents
- Downstream planner, executor, checker, reviewer, and verifier agents MUST read these two source documents before making implementation decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`
- These external docs are canonical for phase requirements, acceptance criteria, test IDs, and known assumptions. If local `.planning/REQUIREMENTS.md` and these docs disagree, stop and surface the conflict.

#### D-02: REQ-002 Native Tier 2 Locking
- Replace any temporary or legacy-table Tier 2 behavior in `src/services/document-lock.ts` with native session-scoped Postgres advisory locks.
- Tier 2 MUST use `pg_advisory_lock(bigint)` / `pg_advisory_unlock(bigint)` through `withPgClient` from `src/utils/pg-client.ts`, preserving acquire and release on the same checked-out `PoolClient`.
- Tier 1 remains the in-process `async-mutex` striped registry from Phase 155. Same-process same-file contention must collapse before Tier 2 so a burst of in-process contenders results in one Tier 2 acquire/release pair.
- Transaction-scoped advisory locks, filesystem lock files, and `fqc_write_locks` MUST NOT be used for cross-process file exclusion.

#### D-03: REQ-004 Legacy Lock-table Retirement
- FlashQuery startup MUST run `DROP TABLE IF EXISTS fqc_write_locks` and log one debug-level removal line.
- Remove the legacy `src/services/write-lock.ts` service and all `acquireLock`, `releaseLock`, and `isLocked` imports or symbol uses.
- Remove the `flashquery unlock` command from the CLI surface because crashed advisory locks release with the database session.
- Remove legacy `fqc_write_locks` DDL from `src/storage/supabase.ts`.
- Keep legacy `locking.ttl_seconds` config load-compatible: ignore it, emit one warn-level deprecation line, and do not recreate table TTL semantics.

#### D-04: REQ-005 Session-capable Connection Self-test
- Add startup self-test code, expected at `src/services/lock-startup.ts`, that acquires a throwaway session-scoped advisory lock on one `withPgClient` checkout, verifies visibility through `pg_locks` from a second checkout, releases it, and returns a typed success/failure result.
- Startup MUST fail non-zero with a clear error naming suspected transaction-mode pooler behavior when the self-test cannot prove session capability.
- Documentation MUST be updated so README, `.env.example`, `flashquery.yml` commentary, and Supabase onboarding docs state the session-capable `DATABASE_URL` requirement and transaction-pooler failure mode.

#### D-05: Required Test Scope
- Unit tests MUST include Test Plan §4.1.2, §4.1.4, and §4.1.5 cases `T-U-003`, `T-U-004`, `T-U-005`, `T-U-011`, `T-U-012`, and `T-U-013`.
- Integration tests MUST include `T-I-003`, `T-I-004`, `T-I-005`, `T-I-006`, `T-I-007`, and `T-I-008`.
- Required evidence commands are:
  - `npm test -- --grep "advisory-lock|lock-startup|legacy-write-lock"`
  - `npm run test:integration -- --grep "two-tier|fqc-write-locks-drop|lock-startup|session-capable"`
- Plans should include these exact test names/patterns so execution and verification can trace back to the external Test Plan.

### the agent's Discretion
- Exact bigint hash implementation details are the agent's discretion as long as they are deterministic, operate on the canonical lock key from earlier phases, and preserve REQ-002 behavior.
- The exact shape of typed self-test return values and lock errors is the agent's discretion as long as MCP/tool/startup callers can convert them into clear human-readable failures.
- The exact static-check implementation for no legacy imports is the agent's discretion, but it must fail if source code keeps `write-lock`, `acquireLock`, `releaseLock`, `isLocked`, or unauthorized `fqc_write_locks` references.

### Deferred Ideas (OUT OF SCOPE)
None for this phase. Folder locks, destination-path locks, version tokens, batch contracts, and later macro semantics remain outside Phase 158 unless they are already required by the completed dependencies.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-002 | Two-tier write lock: in-process `async-mutex` Tier 1 plus native session-scoped PostgreSQL advisory lock Tier 2. | `src/services/document-lock.ts` already owns the facade and must replace only its legacy Tier 2 functions with `withPgClient` + `pg_advisory_lock`/`pg_advisory_unlock`. [VERIFIED: codebase grep] PostgreSQL session advisory locks are held until explicit unlock or session end. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS] |
| REQ-004 | Retire `fqc_write_locks`, legacy service, TTL semantics, and `flashquery unlock`. | Legacy DDL, schema verification, CLI registration, service code, docs, and tests still reference `fqc_write_locks` and need coordinated removal. [VERIFIED: codebase grep] |
| REQ-005 | Require session-capable PostgreSQL and fail startup when self-test cannot prove session behavior. | `withPgClient` checks out a `PoolClient`, and node-postgres requires releasing checked-out clients when finished. [CITED: Context7 `/brianc/node-postgres`] Supavisor transaction mode assigns a server connection only for a transaction, while session mode assigns it for the client connection. [CITED: https://supabase.github.io/supavisor/configuration/pool_modes/] |
</phase_requirements>

## Summary

Phase 158 is a replacement and retirement phase, not a broad redesign. The planner should keep the existing `withDocumentLock` / `withDocumentLocks` facade and swap `document-lock.ts`'s temporary table-backed Tier 2 for a native PostgreSQL session advisory lock held on one checked-out `PoolClient`. [VERIFIED: codebase grep] Do not move lock logic into MCP tool call sites; Phase 155 already centralized document write locking. [VERIFIED: `.planning/phases/155-per-file-tier-1-live-defect-close/155-VERIFICATION.md`]

The retirement work must be planned as a startup/schema change, a CLI surface change, a config compatibility change, and a test/docs cleanup. `initSupabase()` currently creates and verifies `fqc_write_locks`, `schema-verify.ts` marks it required, `index.ts` imports/registers `unlockCommand`, and multiple tests still mock/import `write-lock`. [VERIFIED: codebase grep] Removing only `src/services/write-lock.ts` will break build/test before the schema and tests are updated. [VERIFIED: codebase grep]

The session self-test should live in a small `src/services/lock-startup.ts` module and be called during startup after config/logger are available and before accepting MCP traffic. [VERIFIED: 158-CONTEXT.md] It should acquire a throwaway advisory lock on one `withPgClient` checkout, query `pg_locks` from a second checkout, release the first lock on the original client, and return a typed result that startup converts to a clear non-zero failure. [CITED: PostgreSQL docs; VERIFIED: 158-CONTEXT.md]

**Primary recommendation:** Keep `document-lock.ts` as the only document lock API, add a Postgres-advisory Tier 2 helper plus startup self-test, then remove all legacy table/CLI/schema/test/doc references in the same phase. [VERIFIED: codebase grep]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, and ESM imports only. [VERIFIED: AGENTS.md]
- Do not use CommonJS `require` except existing project-approved patterns such as package metadata loading in `src/index.ts`. [VERIFIED: AGENTS.md; VERIFIED: codebase grep]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- Use `async/await`; module boundaries should return typed errors rather than throw raw exceptions where callers need structured handling. [VERIFIED: AGENTS.md]
- MCP tool handlers must catch internally and return `{ content: [{ type: "text", text: "..." }], isError: true }` on failure. [VERIFIED: AGENTS.md]
- Use Zod for external input validation. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests live under `tests/integration/*.test.ts`; integration/E2E depend on `.env.test`. [VERIFIED: AGENTS.md]
- Local development should use `npm run dev` or built `node dist/index.js start --config ./flashquery.yml`; do not use `npm link`. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Tier 1 same-process file serialization | API / Backend | Browser / Client: none | FlashQuery handlers run in the server process; the in-process `async-mutex` registry belongs in `src/services/document-lock.ts`. [VERIFIED: codebase grep] |
| Tier 2 cross-process file exclusion | API / Backend | Database / Storage | The application derives lock keys and controls critical sections; PostgreSQL stores session advisory lock state. [CITED: PostgreSQL advisory lock docs] |
| Legacy `fqc_write_locks` table retirement | API / Backend | Database / Storage | Startup owns schema initialization and can run `DROP TABLE IF EXISTS`; database stores the obsolete object. [VERIFIED: codebase grep] |
| `flashquery unlock` removal | CLI | Database / Storage | The CLI currently deletes table rows, but session advisory locks auto-release when the backend session ends. [VERIFIED: codebase grep; CITED: PostgreSQL advisory lock docs] |
| Session-capability self-test | API / Backend startup | Database / Storage | Startup must prove the configured `DATABASE_URL` preserves backend sessions before serving tools. [VERIFIED: 158-CONTEXT.md; CITED: Supavisor pool modes docs] |
| Documentation updates | Documentation | CLI / Config | README, `.env.example`, `flashquery.yml`, and onboarding docs must explain the session-capable `DATABASE_URL` requirement. [VERIFIED: 158-CONTEXT.md] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | Installed 8.21.0; package range `^8.20.0`; registry latest 8.21.0 modified 2026-05-18. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Raw PostgreSQL `PoolClient` checkouts for session advisory locks and startup self-test. | Existing `src/utils/pg-client.ts` exposes `withPgClient`, `queryPgPool`, and test pool injection. [VERIFIED: codebase grep] |
| `async-mutex` | Installed 0.5.0; registry latest 0.5.0 modified 2024-03-11. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Tier 1 in-process mutex striping. | Existing `document-lock.ts` uses `Mutex.acquire()` and bounded 1024 stripes. [VERIFIED: codebase grep] Context7 confirms `acquire()` returns a release callback that must be called. [CITED: Context7 `/dirtyhairy/async-mutex`] |
| PostgreSQL advisory locks | PostgreSQL server feature, current docs PostgreSQL 18. [CITED: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS] | Session-level cross-process mutual exclusion with `pg_advisory_lock(bigint)` and `pg_advisory_unlock(bigint)`. | Session locks are application-defined, avoid lock-table bloat, and are cleaned up at session end. [CITED: PostgreSQL explicit locking docs] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `@supabase/supabase-js` | Installed/latest 2.106.2; registry modified 2026-05-26. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Existing runtime data operations through Supabase REST client. | Keep for normal data operations; do not use it for advisory-lock session semantics. [VERIFIED: codebase grep] |
| `vitest` | Installed 4.1.7; package range `^4.1.1`; registry latest 4.1.7 modified 2026-05-20. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Unit/integration tests. | Use file-targeted tests or `--testNamePattern`; this repo's Vitest help shows no `--grep` flag. [VERIFIED: `npx vitest --help`] |
| `commander` | Package range/latest 14.0.3; registry modified 2026-05-12. [VERIFIED: npm registry; VERIFIED: package.json] | CLI command surface. | Remove `unlockCommand` import and `program.addCommand(unlockCommand)` from `src/index.ts`. [VERIFIED: codebase grep] |
| `zod` | Package range `^4.3.6`; registry latest 4.4.3 modified 2026-05-04. [VERIFIED: npm registry; VERIFIED: package.json] | Config schema compatibility for `locking.ttl_seconds`. | Keep legacy key parse-compatible and add deprecation metadata. [VERIFIED: 158-CONTEXT.md; VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg_advisory_lock(bigint)` | `pg_try_advisory_lock(bigint)` retry loop | Phase 158 decisions require blocking `pg_advisory_lock`; bounded timeout is Phase 159 / REQ-006. [VERIFIED: 158-CONTEXT.md; VERIFIED: `.planning/ROADMAP.md`] |
| Session advisory locks | Transaction advisory locks | Forbidden because transaction locks release at transaction end and would require holding a DB transaction over filesystem work. [VERIFIED: 158-CONTEXT.md; CITED: PostgreSQL functions docs] |
| Advisory locks | `fqc_write_locks` table | Forbidden because Phase 158 retires the table and removes TTL/manual unlock semantics. [VERIFIED: 158-CONTEXT.md] |
| Raw `PoolClient` | Supabase REST client | Supabase REST calls do not preserve a checked-out PostgreSQL backend session for the file critical section. [VERIFIED: codebase grep; ASSUMED] |

**Installation:** No new package installation is recommended for Phase 158. [VERIFIED: package.json; VERIFIED: codebase grep]

## Package Legitimacy Audit

No new external package should be installed. [VERIFIED: codebase grep] Existing packages used by this phase were checked to avoid slopsquat drift. [VERIFIED: slopcheck]

| Package | Registry | Age / Currency | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|----------------|-----------|-------------|-----------|-------------|
| `pg` | npm | Registry latest 8.21.0 modified 2026-05-18. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/brianc/node-postgres`. [VERIFIED: npm registry] | OK. [VERIFIED: slopcheck] | Approved existing dependency. |
| `async-mutex` | npm | Registry latest 0.5.0 modified 2024-03-11. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/DirtyHairy/async-mutex`. [VERIFIED: npm registry] | OK. [VERIFIED: slopcheck] | Approved existing dependency. |
| `@supabase/supabase-js` | npm | Registry latest 2.106.2 modified 2026-05-26. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/supabase/supabase-js`. [VERIFIED: npm registry] | OK. [VERIFIED: slopcheck] | Approved existing dependency. |
| `vitest` | npm | Registry latest 4.1.7 modified 2026-05-20. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/vitest-dev/vitest`. [VERIFIED: npm registry] | SUS, flagged as close to `vite`. [VERIFIED: slopcheck] | Existing project test dependency; no install or upgrade recommended. Planner need not add human install checkpoint unless changing versions. |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]  
**Packages flagged as suspicious [SUS]:** `vitest`, but it is an existing dependency and not a Phase 158 install. [VERIFIED: slopcheck; VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
MCP document write tool
  -> existing withDocumentLock(config, absolutePath, fn)
      -> Tier 1: striped async-mutex acquire by current basic absolute key
      -> Tier 2: withPgClient(config.supabase.databaseUrl, client => ...)
          -> SELECT pg_advisory_lock($1::bigint)
          -> run file critical section while same PoolClient remains checked out
          -> SELECT pg_advisory_unlock($1::bigint)
      -> release Tier 1
  -> durable write primitive from Phase 156
```

```text
flashquery start
  -> loadConfig + initLogger
  -> emit deprecation warning for legacy locking.ttl_seconds if present
  -> initVault + clean temp files
  -> initSupabase
      -> run normal DDL without creating fqc_write_locks
      -> DROP TABLE IF EXISTS fqc_write_locks
      -> verify schema without fqc_write_locks as required
  -> run lock-startup self-test
      -> connection A: pg_advisory_lock(test_key)
      -> connection B: SELECT pg_locks WHERE reconstructed_key = test_key
      -> connection A: pg_advisory_unlock(test_key)
      -> fail startup if not observed or release false
  -> init MCP server
```

### Recommended Project Structure

```text
src/
├── services/
│   ├── document-lock.ts       # Keep public file-lock facade; replace legacy Tier 2 internals.
│   └── lock-startup.ts        # New startup session-capability self-test and legacy drop helper if not placed in storage.
├── utils/
│   └── pg-client.ts           # Existing PoolClient checkout and test-injection point.
├── storage/
│   ├── supabase.ts            # Remove fqc_write_locks DDL; run/drop legacy table during startup.
│   └── schema-verify.ts       # Remove fqc_write_locks from required tables.
├── config/
│   ├── loader.ts              # Preserve ttl_seconds parse compatibility and attach one deprecation warning.
│   └── types.ts               # Remove ttlSeconds from effective config, or keep optional legacy metadata only.
└── cli/
    └── commands/
        └── unlock.ts          # Delete and unregister.
```

### Pattern 1: Hold Advisory Lock on One Checked-Out Client

**What:** Use `withPgClient` to check out one `PoolClient`, acquire a session advisory lock on that client, run the critical section inside the callback, then unlock before the callback returns. [CITED: Context7 `/brianc/node-postgres`; CITED: PostgreSQL advisory lock docs]

**When to use:** Tier 2 file critical sections and the connection-A side of startup self-test. [VERIFIED: 158-CONTEXT.md]

**Example:**

```typescript
// Sources: Context7 /brianc/node-postgres; PostgreSQL advisory lock functions docs.
await withPgClient(config.supabase.databaseUrl, async (client) => {
  await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
  try {
    return await fn();
  } finally {
    const result = await client.query<{ released: boolean }>(
      'SELECT pg_advisory_unlock($1::bigint) AS released',
      [lockKey]
    );
    if (result.rows[0]?.released !== true) {
      throw new Error(`advisory lock release failed for ${lockKey}`);
    }
  }
});
```

### Pattern 2: Query `pg_locks` by Reconstructed Bigint

**What:** PostgreSQL displays a `bigint` advisory key in `pg_locks` as high bits in `classid`, low bits in `objid`, and `objsubid = 1`; reconstruct with `(classid::bigint << 32) | objid::bigint`. [CITED: https://www.postgresql.org/docs/current/view-pg-locks.html]

**When to use:** Startup self-test and integration evidence that a lock is visible from another session. [VERIFIED: 158-CONTEXT.md]

**Example:**

```sql
-- Source: PostgreSQL pg_locks docs.
SELECT EXISTS (
  SELECT 1
  FROM pg_locks
  WHERE locktype = 'advisory'
    AND objsubid = 1
    AND granted = true
    AND ((classid::bigint << 32) | objid::bigint) = $1::bigint
) AS visible;
```

### Pattern 3: Config Deprecation via Existing Metadata

**What:** Keep accepting `locking.ttl_seconds` but attach a deprecation warning through the existing `getDeprecationWarnings(config)` startup flow. [VERIFIED: codebase grep]

**When to use:** REQ-004 compatibility. [VERIFIED: 158-CONTEXT.md]

**Example:**

```typescript
// Source: src/config/loader.ts existing deprecation-warning pattern.
const locking = (raw as { locking?: { ttl_seconds?: unknown } }).locking;
if (locking && Object.hasOwn(locking, 'ttl_seconds')) {
  deprecationWarnings.push("locking.ttl_seconds is deprecated; advisory locks do not use TTL and this key is safe to remove.");
}
```

### Anti-Patterns to Avoid

- **Unlocking on a different client:** Session advisory locks must be released by the owning session; using `queryPgPool` for release can hit a different backend. [CITED: PostgreSQL advisory lock docs; VERIFIED: codebase grep]
- **Dropping the table before removing schema verification:** `schema-verify.ts` currently requires `fqc_write_locks`, so a drop-only change will make startup verification fail. [VERIFIED: codebase grep]
- **Leaving `unlockCommand` registered:** Removing `src/cli/commands/unlock.ts` without editing `src/index.ts` breaks TypeScript import resolution. [VERIFIED: codebase grep]
- **Relying on Vitest `--grep`:** Vitest 4 help in this repo exposes `--testNamePattern`, not `--grep`; required evidence commands are a product/test-plan conflict to preserve but execute with fallback if needed. [VERIFIED: `npx vitest --help`; VERIFIED: 158-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process exclusion | A lock table, TTL cleanup, orphan unlock CLI, or filesystem lock files | PostgreSQL session advisory locks | PostgreSQL automatically cleans session advisory locks at session end and exposes them via `pg_locks`. [CITED: PostgreSQL explicit locking docs] |
| Same-process queuing | Custom Promise queues | Existing `async-mutex` striped registry | `async-mutex` already provides acquire/release semantics and Phase 155 verified the registry. [CITED: Context7 `/dirtyhairy/async-mutex`; VERIFIED: 155-VERIFICATION.md] |
| PostgreSQL session checkout | Manual global clients hidden in service state | Existing `withPgClient` | It centralizes pool creation, client release, and test injection. [VERIFIED: codebase grep] |
| Session-capability detection | Port/hostname heuristics for Supabase pooler mode | Live acquire/observe/release self-test | Supabase port/mode conventions are useful docs, but behavior is what matters for self-hosted and future poolers. [CITED: Supavisor docs; ASSUMED] |
| Legacy reference audit | Manual review only | Static tests that scan source for forbidden imports/symbols/strings | Phase 158 requires all `write-lock` / `acquireLock` / `releaseLock` / `isLocked` / unauthorized `fqc_write_locks` references to fail tests. [VERIFIED: 158-CONTEXT.md] |

**Key insight:** Session advisory locks are the standard primitive because the database owns cross-process lock state and releases it when the backend session ends; FlashQuery should only coordinate acquisition/release around filesystem critical sections. [CITED: PostgreSQL explicit locking docs]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Existing deployments may have a `public.fqc_write_locks` table with ephemeral rows. [VERIFIED: `src/storage/supabase.ts`; VERIFIED: requirements] | Startup must run `DROP TABLE IF EXISTS fqc_write_locks`; this is a schema/data migration, not just code deletion. [VERIFIED: 158-CONTEXT.md] |
| Live service config | Supabase dashboard may expose direct, session pooler, and transaction pooler connection strings outside git. [CITED: Supabase connection docs] | Docs and startup error must tell operators to use direct or session-capable `DATABASE_URL`; no repo-only edit can fix external dashboard config. [VERIFIED: 158-CONTEXT.md] |
| OS-registered state | No OS-level registration of `fqc_write_locks` or `flashquery unlock` was found in repo code. [VERIFIED: codebase grep] | None for OS state; CLI users may have shell aliases/scripts outside git, but that is not discoverable here. [ASSUMED] |
| Secrets/env vars | `.env.example`, README, and `flashquery.yml` reference `DATABASE_URL`; `.env.test` exists locally for integration tests. [VERIFIED: codebase grep] | Update examples/comments to state session-capable URL; do not rename the env var. [VERIFIED: 158-CONTEXT.md] |
| Build artifacts | `dist/` exists and still contains built output from prior code. [VERIFIED: `ls`] | Run `npm run build` after source changes; do not edit `dist` manually. [VERIFIED: AGENTS.md] |

**Nothing found in category:** No graph context was available; `.planning/graphs/graph.json` was absent or graph status returned no output. [VERIFIED: command output]

## Common Pitfalls

### Pitfall 1: Treating `Pool.query` as Session-Stable
**What goes wrong:** Acquire and release run on different backend sessions, so unlock can fail or release nothing. [CITED: PostgreSQL advisory lock docs]  
**Why it happens:** `queryPgPool` does not expose a single checked-out `PoolClient`. [VERIFIED: codebase grep]  
**How to avoid:** Only use `withPgClient` for lock acquire/release spans. [VERIFIED: 158-CONTEXT.md]  
**Warning signs:** Tier 2 helper has separate `queryPgPool` calls for acquire and unlock. [VERIFIED: codebase grep]

### Pitfall 2: Self-Test Deadlocks or Leaks Its Probe Lock
**What goes wrong:** Startup hangs or leaves a session-level probe lock stacked on a pooled client. [CITED: PostgreSQL functions docs]  
**Why it happens:** `pg_advisory_lock` waits if contended, and session lock requests stack. [CITED: PostgreSQL functions docs]  
**How to avoid:** Use a deterministic but phase-specific throwaway key unlikely to collide, always unlock in `finally`, and assert `pg_advisory_unlock` returns `true`. [CITED: PostgreSQL functions docs; ASSUMED]  
**Warning signs:** Self-test returns success without checking unlock result. [ASSUMED]

### Pitfall 3: Startup Drop Recreates the Legacy Table
**What goes wrong:** `DROP TABLE IF EXISTS fqc_write_locks` runs but `initSupabase()` DDL creates it again. [VERIFIED: codebase grep]  
**Why it happens:** `src/storage/supabase.ts` currently contains both create-table DDL and migration recreation block. [VERIFIED: codebase grep]  
**How to avoid:** Remove DDL and schema verification requirement before adding the drop hook. [VERIFIED: codebase grep]  
**Warning signs:** Startup logs still say `fqc_write_locks: verified`. [VERIFIED: codebase grep]

### Pitfall 4: Phase 159 Scope Creep
**What goes wrong:** Planner tries to complete canonical realpath/case-folding/timeout behavior in Phase 158. [VERIFIED: `.planning/ROADMAP.md`]  
**Why it happens:** REQ-002 references canonical keys, but Phase 159 owns REQ-003 and REQ-006. [VERIFIED: `.planning/ROADMAP.md`]  
**How to avoid:** Hash the current basic absolute key from `document-lock.ts`, preserving deterministic behavior, and leave full canonical derivation to Phase 159. [VERIFIED: 158-CONTEXT.md]  
**Warning signs:** Plans modify symlink/case-folding probes or `lock_timeout_seconds` beyond legacy TTL deprecation. [VERIFIED: `.planning/ROADMAP.md`]

### Pitfall 5: Test Gate Command Mismatch
**What goes wrong:** Required `--grep` evidence commands fail before running tests. [VERIFIED: `npx vitest --help`; VERIFIED: 157-VERIFICATION.md]  
**Why it happens:** Vitest 4 in this repo exposes `-t, --testNamePattern`; prior Phase 157 noted `--grep` rejection. [VERIFIED: command output; VERIFIED: 157-VERIFICATION.md]  
**How to avoid:** Preserve the required command strings in plan/evidence traceability, but add executable fallback commands using file targets or `--testNamePattern`. [VERIFIED: 158-CONTEXT.md; VERIFIED: command output]  
**Warning signs:** Verification claims `--grep` passed without showing actual command behavior. [ASSUMED]

## Code Examples

### Advisory Lock Key Hash

```typescript
// Source: agent discretion in 158-CONTEXT.md; Node crypto is built-in.
import { createHash } from 'node:crypto';

export function advisoryBigintForLockKey(lockKey: string): string {
  const bytes = createHash('sha256').update(lockKey).digest();
  return bytes.readBigInt64BE(0).toString();
}
```

### Startup Self-Test Shape

```typescript
// Sources: PostgreSQL advisory lock docs, pg_locks docs, Context7 node-postgres.
export type LockStartupResult =
  | { ok: true }
  | { ok: false; reason: 'session_not_stable' | 'release_failed' | 'query_failed'; message: string };

export async function verifySessionAdvisoryLocks(databaseUrl: string): Promise<LockStartupResult> {
  const testKey = '-158000000000000000';
  try {
    return await withPgClient(databaseUrl, async (owner) => {
      await owner.query('SELECT pg_advisory_lock($1::bigint)', [testKey]);
      try {
        const observed = await withPgClient(databaseUrl, async (observer) =>
          observer.query<{ visible: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_locks
               WHERE locktype = 'advisory'
                 AND objsubid = 1
                 AND granted = true
                 AND ((classid::bigint << 32) | objid::bigint) = $1::bigint
             ) AS visible`,
            [testKey]
          )
        );
        if (observed.rows[0]?.visible !== true) {
          return { ok: false, reason: 'session_not_stable', message: 'Session advisory lock was not visible from a second checkout.' };
        }
      } finally {
        const released = await owner.query<{ released: boolean }>(
          'SELECT pg_advisory_unlock($1::bigint) AS released',
          [testKey]
        );
        if (released.rows[0]?.released !== true) {
          return { ok: false, reason: 'release_failed', message: 'Startup advisory lock probe could not release its lock.' };
        }
      }
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, reason: 'query_failed', message: error instanceof Error ? error.message : String(error) };
  }
}
```

### Static Legacy Guard

```typescript
// Source: 158-CONTEXT.md static-check discretion; codebase already has similar static tests.
const forbidden = [
  /from ['"].*services\/write-lock\.js['"]/,
  /\bacquireLock\b/,
  /\breleaseLock\b/,
  /\bisLocked\b/,
  /fqc_write_locks/,
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Table-backed `fqc_write_locks` with TTL and manual unlock | PostgreSQL session advisory locks via `pg_advisory_lock`/`pg_advisory_unlock` | Phase 158 / v3.9. [VERIFIED: `.planning/ROADMAP.md`] | Removes orphan-row recovery path and makes crash cleanup database-session-driven. [CITED: PostgreSQL explicit locking docs] |
| `flashquery unlock` CLI | No unlock command for write locks | Phase 158 / v3.9. [VERIFIED: 158-CONTEXT.md] | Operators no longer manually clear lock rows because there are no lock rows. [VERIFIED: 158-CONTEXT.md] |
| `locking.ttl_seconds` active setting | Legacy accepted/deprecated no-op | Phase 158 / v3.9. [VERIFIED: 158-CONTEXT.md] | Existing configs keep loading, but TTL no longer controls lock recovery. [VERIFIED: 158-CONTEXT.md] |
| Supabase transaction pooler accepted silently | Startup self-test fails if session capability cannot be proven | Phase 158 / v3.9. [VERIFIED: 158-CONTEXT.md] | Misconfigured `DATABASE_URL` fails early with a clear operator message. [VERIFIED: 158-CONTEXT.md] |

**Deprecated/outdated:**
- `src/services/write-lock.ts`, `src/cli/commands/unlock.ts`, and `fqc_write_locks` DDL are obsolete in Phase 158. [VERIFIED: 158-CONTEXT.md]
- Tests that directly import `write-lock.ts` need replacement with advisory-lock and retirement tests. [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase REST client cannot provide a stable backend session for advisory lock critical sections. | Alternatives Considered | Low; planner might need a more precise citation, but locked decisions already require raw `pg`/`withPgClient`. |
| A2 | External shell aliases or scripts may still call `flashquery unlock`, but they are outside repo discovery. | Runtime State Inventory | Low; docs/release notes should communicate removal. |
| A3 | The throwaway self-test advisory key can be a fixed phase-specific bigint if it is unlikely to collide. | Common Pitfalls / Code Examples | Medium; planner may prefer hashing a string namespace for clearer collision avoidance. |
| A4 | Live behavior self-test is better than hostname/port heuristics for transaction pooler detection. | Don't Hand-Roll | Low; this aligns with locked decisions but is still an architectural inference. |

## Open Questions

1. **Should `FlashQueryConfig.locking` remove `ttlSeconds` or keep it as optional legacy metadata?**
   - What we know: Context requires `locking.ttl_seconds` load-compatible, ignored, and warned once. [VERIFIED: 158-CONTEXT.md]
   - What's unclear: Whether downstream code/tests should still see `config.locking.ttlSeconds`.
   - Recommendation: Planner should include a small config plan that either removes `ttlSeconds` from public type after updating fixtures, or keeps it optional/internal with no runtime effect. [ASSUMED]

2. **Where exactly should legacy table drop live?**
   - What we know: Startup must run `DROP TABLE IF EXISTS fqc_write_locks`. [VERIFIED: 158-CONTEXT.md]
   - What's unclear: Whether to place it in `storage/supabase.ts` near schema setup or in new `services/lock-startup.ts`.
   - Recommendation: Put DDL retirement near schema initialization in `storage/supabase.ts`, and keep `lock-startup.ts` focused on session-capability self-test. [ASSUMED]

3. **How should required `--grep` evidence be handled with Vitest 4?**
   - What we know: Phase context requires `--grep` strings, but local Vitest help lacks `--grep` and Phase 157 observed rejection. [VERIFIED: 158-CONTEXT.md; VERIFIED: command output; VERIFIED: 157-VERIFICATION.md]
   - What's unclear: Whether the orchestrator expects literal command execution or traceable equivalent commands.
   - Recommendation: Plans should list the required evidence commands verbatim and add executable fallback commands using `--testNamePattern` or explicit files. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript build/test/runtime | ✓ | v24.7.0. [VERIFIED: command output] | Project requires Node >=20; current runtime satisfies. [VERIFIED: AGENTS.md] |
| npm | package scripts and registry checks | ✓ | 11.5.1. [VERIFIED: command output] | None needed. |
| Python 3 | Scenario helpers if planner adds scenario evidence | ✓ | 3.12.3. [VERIFIED: command output] | Not required for Phase 158 unit/integration gate. [VERIFIED: 158-CONTEXT.md] |
| `pg` package | Advisory lock Tier 2 | ✓ | Installed 8.21.0. [VERIFIED: `npm ls`] | No fallback; required by locked decision. |
| Supabase/PostgreSQL test DB | Integration tests T-I-003 through T-I-008 | Likely ✓ | `.env.test` exists locally. [VERIFIED: `ls`; VERIFIED: AGENTS.md] | Integration tests skip when env incomplete per project convention. [VERIFIED: AGENTS.md] |
| Vitest | Unit/integration tests | ✓ | Installed 4.1.7. [VERIFIED: `npm ls`] | Use explicit files or `--testNamePattern` instead of `--grep`. [VERIFIED: command output] |
| `slopcheck` | Package legitimacy audit | ✓ | 0.6.1. [VERIFIED: command output] | No fallback needed. |

**Missing dependencies with no fallback:** none detected. [VERIFIED: command output]  
**Missing dependencies with fallback:** `psql` did not print a version in the environment probe; Phase 158 can use `pg`/Vitest helpers instead. [VERIFIED: command output; ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7. [VERIFIED: `npm ls`] |
| Config file | `tests/config/vitest.unit.config.ts` and `tests/config/vitest.integration.config.ts`. [VERIFIED: Test Plan §2] |
| Quick run command | `npm test -- --testNamePattern "advisory-lock|lock-startup|legacy-write-lock"` as executable fallback; required trace command remains `npm test -- --grep "advisory-lock|lock-startup|legacy-write-lock"`. [VERIFIED: command output; VERIFIED: 158-CONTEXT.md] |
| Full suite command | `npm run typecheck && npm run build && npm test`. [VERIFIED: AGENTS.md; VERIFIED: prior verification files] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-002 | Tier 1 contention, Tier 2 acquire/release, one Tier 2 pair per same-process burst. | unit | `npm test -- tests/unit/document-lock-tier1.test.ts tests/unit/document-lock-tier2.test.ts` | ❌ Wave 0 |
| REQ-002 | Two simulated processes serialize through advisory lock and crash/client destroy releases lock. | integration | `npm run test:integration -- tests/integration/two-tier-lock.integration.test.ts` | ❌ Wave 0 |
| REQ-004 | Startup drops `fqc_write_locks`; legacy TTL warns once; no legacy imports/symbols remain. | unit/integration/static | `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts && npm run test:integration -- tests/integration/fqc-write-locks-drop.integration.test.ts` | ❌ Wave 0 |
| REQ-005 | Startup self-test passes on session-capable DB and fails on simulated transaction-mode pooler. | unit/integration | `npm test -- tests/unit/lock-startup-self-test.test.ts && npm run test:integration -- tests/integration/lock-startup.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Run the relevant new unit test file plus `npm run typecheck`. [ASSUMED]
- **Per wave merge:** Run all Phase 158 unit/integration files and `npm run build`. [ASSUMED]
- **Phase gate:** Run executable equivalents of both required evidence selectors, `npm run typecheck`, and `npm run build`; record the `--grep` mismatch if still present. [VERIFIED: 158-CONTEXT.md; VERIFIED: command output]

### Wave 0 Gaps

- [ ] `tests/unit/document-lock-tier1.test.ts` — covers T-U-003. [VERIFIED: Test Plan §4.1.2]
- [ ] `tests/unit/document-lock-tier2.test.ts` — covers T-U-004/T-U-005. [VERIFIED: Test Plan §4.1.2]
- [ ] `tests/unit/no-legacy-write-lock-imports.test.ts` — covers T-U-011. [VERIFIED: Test Plan §4.1.4]
- [ ] `tests/unit/lock-startup-self-test.test.ts` — covers T-U-012/T-U-013. [VERIFIED: Test Plan §4.1.5]
- [ ] `tests/integration/two-tier-lock.integration.test.ts` — covers T-I-003/T-I-004. [VERIFIED: Test Plan §4.1.2]
- [ ] `tests/integration/fqc-write-locks-drop.integration.test.ts` — covers T-I-005/T-I-006. [VERIFIED: Test Plan §4.1.4]
- [ ] `tests/integration/lock-startup.integration.test.ts` — covers T-I-007/T-I-008. [VERIFIED: Test Plan §4.1.5]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not change MCP auth. [VERIFIED: phase scope] |
| V3 Session Management | yes, database sessions only | Do not store MCP session state; preserve database session only within `withPgClient` critical sections. [VERIFIED: AGENTS.md; CITED: node-postgres docs] |
| V4 Access Control | no | Phase does not change authorization or record ownership. [VERIFIED: phase scope] |
| V5 Input Validation | yes | Keep Zod config parsing for legacy `locking.ttl_seconds` compatibility. [VERIFIED: AGENTS.md; VERIFIED: codebase grep] |
| V6 Cryptography | yes, hashing only | Use built-in `crypto` for deterministic lock-key hashing; do not add custom crypto. [ASSUMED] |

### Known Threat Patterns for Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection in advisory-lock SQL | Tampering | Parameterize bigint key with `$1::bigint`; never interpolate lock key. [CITED: node-postgres docs; ASSUMED] |
| Denial of service through held advisory lock | Denial of Service | Always unlock in `finally`; later Phase 159 adds bounded timeout. [CITED: PostgreSQL advisory lock docs; VERIFIED: ROADMAP] |
| Transaction-pooler silently breaking mutual exclusion | Tampering / DoS | Startup acquire/observe/release self-test fails non-zero with clear message. [VERIFIED: 158-CONTEXT.md; CITED: Supavisor pool modes docs] |
| Legacy unlock command deleting unrelated rows | Tampering | Remove CLI and table. [VERIFIED: 158-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- Context7 `/brianc/node-postgres` — `pool.connect`, checked-out client release, session-style operations.  
- Context7 `/dirtyhairy/async-mutex` — `Mutex.acquire()` and release callback semantics.  
- PostgreSQL 18 docs — advisory lock behavior, `pg_advisory_lock`, `pg_advisory_unlock`, `pg_locks` key display.  
  - https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
  - https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
  - https://www.postgresql.org/docs/current/view-pg-locks.html
- Supavisor pool modes docs — transaction mode vs session mode.  
  - https://supabase.github.io/supavisor/configuration/pool_modes/
- Supabase connection docs — direct/session/transaction pooler connection guidance.  
  - https://supabase.com/docs/guides/database/connecting-to-postgres

### Secondary (MEDIUM confidence)

- Local codebase grep and file reads for `src/services/document-lock.ts`, `src/utils/pg-client.ts`, `src/index.ts`, `src/storage/supabase.ts`, `src/storage/schema-verify.ts`, `src/config/loader.ts`, tests, docs, and examples. [VERIFIED: codebase grep]
- Phase dependency verifications 155, 156, and 157. [VERIFIED: local planning files]
- `npm view`, `npm ls`, `npx vitest --help`, `slopcheck`. [VERIFIED: command output]

### Tertiary (LOW confidence)

- Runtime state outside git, such as user shell aliases or dashboard-selected Supabase URLs, cannot be fully inspected from the repo. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing packages and official docs verified in-session.  
- Architecture: HIGH — phase decisions are locked and code hotspots were inspected directly.  
- Pitfalls: HIGH for code/test/schema pitfalls; MEDIUM for exact transaction-mode simulation design because it depends on fake pool behavior.  
- Runtime state: MEDIUM — repo/runtime files were inspected, but external Supabase dashboard state is outside local visibility.

**Research date:** 2026-05-26  
**Valid until:** 2026-06-25 for codebase findings; 2026-06-02 for Supabase/pooler documentation details.
