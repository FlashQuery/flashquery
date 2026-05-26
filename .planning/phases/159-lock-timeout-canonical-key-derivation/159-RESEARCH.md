# Phase 159: Lock Timeout + Canonical Key Derivation - Research

**Researched:** 2026-05-26  
**Domain:** FlashQuery document lock canonicalization, PostgreSQL advisory-lock timeout behavior, TypeScript/Vitest validation  
**Confidence:** HIGH for repo state and required behavior; MEDIUM for exact retry interval tuning

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### D-01: Canonical Source Documents
- Downstream planner, executor, checker, reviewer, and verifier agents MUST read these two source documents before making implementation decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`
- These external docs are canonical for phase requirements, acceptance criteria, test IDs, and known assumptions. If local `.planning/REQUIREMENTS.md` and these docs disagree, stop and surface the conflict.
- For implementation questions, consult those docs first. Ask the user only if the docs do not answer the question or conflict with current repo reality.

### D-02: REQ-003 Full Canonical Key Derivation
- Existing file lock keys MUST derive from `case_fold(realpath(path))` with a `file:` namespace prefix before hashing.
- Not-yet-existing destination file keys MUST derive from `case_fold(realpath(parent_dir) + '/' + basename)` with a `file:` namespace prefix before hashing.
- Directory lock keys MUST derive from `case_fold(realpath(dir))` with a `dir:` namespace prefix before hashing.
- The system MUST detect vault filesystem case sensitivity at startup or lock-service initialization using a one-time probe. On case-insensitive filesystems, case variants pointing at the same file must produce the same key; on case-sensitive filesystems, case folding is a no-op.
- The system MUST NOT key locks on `instance_id`, vault-relative paths, or un-namespaced hashes.
- Hard links and bind mounts that alias one physical file under two absolute paths remain unsupported per the requirements.

### D-03: REQ-006 Bounded Lock Acquisition
- Lock acquisition MUST be bounded. The default timeout is 10 seconds.
- `locking.lock_timeout_seconds` in `flashquery.yml` / config controls the timeout when present and must be validated as a positive integer.
- On timeout, write tools return a structured conflict/resource-busy response with `details.reason: "lock_timeout"` and a clear catchable message. The timeout must not bubble as an uncaught exception and must not hang.
- Tier 2 acquire MUST use either Postgres `lock_timeout` set per acquire on the checked-out `PoolClient`, or `pg_try_advisory_lock` with a bounded retry loop. The implementation choice is the dev agent's discretion, but it must be documented in code comments and covered by tests.
- Existing Phase 158 session ownership still applies: acquire and release run on the same `PoolClient`, and release happens in `finally`.

### D-04: Required Test Scope
- Unit tests MUST include Test Plan §4.1.3 and §4.1.6 cases `T-U-006`, `T-U-007`, `T-U-008`, `T-U-009`, `T-U-010`, `T-U-014`, and `T-U-015`.
- Integration tests MUST include `T-I-009` and `T-I-010`.
- Directed scenario coverage MUST include `T-S-002` / `D-WCO-02` when the environment supports case-insensitive path behavior.
- Required evidence commands from the roadmap are:
  - `npm test -- --grep "canonical-key|case-fold|symlink|lock-timeout"`
  - `npm run test:integration -- --grep "lock-timeout"`
  - directed scenario `D-WCO-02` when supported by the filesystem
- Plans should include exact test names/patterns and executable local fallbacks where needed because local Vitest usage may favor direct file targets or `--testNamePattern`.

### the agent's Discretion
- The exact stable bigint hash implementation remains discretionary if it preserves deterministic namespace-prefixed canonical key hashing and existing advisory-lock behavior.
- The implementation may keep key-derivation helpers internal or export narrow test-only helpers, provided lower-level lock primitives do not leak into unrelated call sites.
- The implementation may choose Postgres `lock_timeout` or a bounded `pg_try_advisory_lock` retry loop for Tier 2 timeout semantics.
- The exact helper names for case-sensitivity probing and canonicalization are discretionary, but tests must prove the public lock behavior and source-level invariants.

### Deferred Ideas (OUT OF SCOPE)

Folder shared/exclusive locks remain Phase 160. Destination-path lock acquisition and EXDEV fallback remain Phase 161. Version tokens remain Phase 162. Multi-file batch contracts remain Phase 163.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-003 | Canonical lock-key derivation for existing files, not-yet-existing destinations, and directories. | Current `document-lock.ts` still uses Phase 155's `path.normalize()` basic key and states full realpath/case-folding is deferred to Phase 159. [VERIFIED: codebase grep] Node `fsPromises.realpath()` resolves the actual path for existing paths. [CITED: https://nodejs.org/api/fs.html#fspromisesrealpathpath-options] |
| REQ-006 | Bounded lock acquisition with default 10 s, configurable positive integer timeout, and structured `details.reason: "lock_timeout"` conflict responses. | Current Tier 2 uses unbounded `SELECT pg_advisory_lock($1::bigint)`. [VERIFIED: codebase grep] PostgreSQL documents `pg_try_advisory_lock(bigint)` as immediate true/false without waiting. [CITED: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS] |
</phase_requirements>

## Summary

Phase 159 should be planned as a narrow lock-service/config/test phase. `src/services/document-lock.ts` is already the centralized facade for document writes and already holds PostgreSQL session advisory locks through `withPgClient`; the phase should replace the current `path.normalize()` key derivation and unbounded `pg_advisory_lock` call inside that module, not spread lock primitives into tool handlers. [VERIFIED: codebase grep]

Use `pg_try_advisory_lock` in a bounded retry loop for Tier 2 timeout semantics. [CITED: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS] This preserves Phase 158's session-scoped `PoolClient` ownership and avoids relying on transaction-local settings while no transaction is held across filesystem work. [VERIFIED: Phase 158 summaries; ASSUMED] Keep unlock in the existing `finally` path and only unlock keys recorded as acquired. [VERIFIED: codebase grep]

Canonical key derivation should become an async preprocessing step before Tier 1 stripe selection, burst-key grouping, sorted multi-lock ordering, and advisory hashing. Existing files need `realpath(file)`, not-yet-existing destinations need `realpath(parent) + basename`, directory keys need `realpath(dir)`, and the hashed resource string must use `file:` or `dir:` namespaces. [VERIFIED: 159-CONTEXT.md; CITED: Node fs docs]

**Primary recommendation:** Implement `deriveDocumentLockEntry(config, path, kind?)` plus a one-time vault filesystem case-sensitivity probe in `document-lock.ts`, add `locking.lockTimeoutSeconds` to config with default 10, and use a bounded `pg_try_advisory_lock` loop that throws `LockTimeoutError` with reason metadata convertible to `details.reason: "lock_timeout"`. [VERIFIED: codebase grep; CITED: PostgreSQL advisory-lock docs]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, and ESM imports only. [VERIFIED: AGENTS.md]
- Do not use CommonJS `require`; all project source is ESM. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- Use `async/await`; module boundaries should return typed errors rather than throw raw exceptions where callers need structured handling. [VERIFIED: AGENTS.md]
- MCP tool handlers catch internally and return JSON/text MCP responses; expected errors use structured envelopes. [VERIFIED: AGENTS.md; VERIFIED: codebase grep]
- Use Zod for external input validation such as `locking.lock_timeout_seconds`. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests live under `tests/integration/*.test.ts`; integration/E2E depend on `.env.test`. [VERIFIED: AGENTS.md]
- Local development should use `npm run dev` or built `node dist/index.js start --config ./flashquery.yml`; do not use `npm link`. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Canonical file/directory identity | API / Backend | Filesystem | The backend owns lock-key derivation; filesystem `realpath` and case behavior provide canonical path facts. [VERIFIED: codebase grep; CITED: Node fs docs] |
| Tier 1 same-process serialization | API / Backend | - | Existing `async-mutex` stripes serialize same-process contenders before Tier 2. [VERIFIED: codebase grep; CITED: Context7 `/dirtyhairy/async-mutex`] |
| Tier 2 cross-process timeout | API / Backend | Database / Storage | The backend controls retry deadline; PostgreSQL advisory lock state coordinates sessions. [CITED: PostgreSQL advisory-lock docs] |
| Lock timeout config | API / Backend config | CLI startup | `src/config/loader.ts` parses YAML and returns `FlashQueryConfig` consumed by lock helpers. [VERIFIED: codebase grep] |
| Structured lock-timeout responses | API / Backend MCP tools | Client / AI caller | Tool handlers convert `LockTimeoutError` to JSON expected-error envelopes consumed by MCP callers. [VERIFIED: codebase grep] |
| Directed case-variant scenario | Test harness | Filesystem | Scenario proves public-surface behavior only where the filesystem is case-insensitive; local probe reported case-insensitive. [VERIFIED: local command; VERIFIED: project skills] |

## Standard Stack

### Core

| Library / Feature | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| Node.js `node:fs/promises` | Runtime Node v24.7.0 locally; project requires >=20. [VERIFIED: local command; VERIFIED: package.json] | `realpath`, `mkdtemp`, `stat`, cleanup for canonicalization and case-sensitivity probe. | Built-in filesystem API; Node docs state `fsPromises.realpath()` returns the resolved path. [CITED: https://nodejs.org/api/fs.html#fspromisesrealpathpath-options] |
| `pg` | Installed/latest 8.21.0, modified 2026-05-18. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Checked-out `PoolClient` for session advisory locks. | Existing `withPgClient` wraps `pool.connect()` and releases in `finally`; Context7 confirms checked-out clients must be released. [VERIFIED: codebase grep; CITED: Context7 `/brianc/node-postgres`] |
| PostgreSQL advisory locks | PostgreSQL 18 current docs. [CITED: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS] | Cross-process mutual exclusion and nonblocking try-lock checks. | Session-level locks are application-defined, manually releasable, and auto-cleaned at session end. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS] |
| `async-mutex` | Installed/latest 0.5.0, modified 2024-03-11. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Tier 1 stripe mutexes. | Existing code already uses `Mutex.acquire()`; Context7 confirms `acquire()` returns a release callback. [VERIFIED: codebase grep; CITED: Context7 `/dirtyhairy/async-mutex`] |
| `zod` | Installed/latest 4.4.3, modified 2026-05-04. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Validate `locking.lock_timeout_seconds` as positive integer with default 10. | Existing config loader schemas use Zod for YAML parsing. [VERIFIED: codebase grep] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `vitest` | Installed 4.1.7; package range `^4.1.1`; latest 4.1.7 modified 2026-05-20. [VERIFIED: npm registry; VERIFIED: `npm ls`] | Unit and integration tests. | Use direct file targets and `--testNamePattern`; this local Vitest help has `--testNamePattern` and no `--grep` option. [VERIFIED: local command] |
| Python scenario framework | Python 3.12.3 locally. [VERIFIED: local command] | Directed `D-WCO-02` scenario. | Project scenario docs require `TestContext`, `TEST_NAME`, cleanup, and `enable_locking=True` for lock contention tests. [VERIFIED: project skills] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bounded `pg_try_advisory_lock` retry loop | `pg_advisory_lock` plus PostgreSQL `lock_timeout` | `lock_timeout` is documented for lock wait limits, but try-lock gives explicit application control and avoids depending on transaction/session GUC scope. [CITED: PostgreSQL lock_timeout docs; CITED: PostgreSQL advisory-lock docs; ASSUMED] |
| Internal test-only helpers | Public low-level lock primitives | Public primitives risk bypassing `withDocumentLock`; keep exports narrow. [VERIFIED: 159-CONTEXT.md] |
| Preserve `document:` namespace | Switch to `file:` / `dir:` namespaces | Phase 159 explicitly requires `file:` and `dir:` prefixes; existing `document:` is Phase 155/158 scaffolding. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md] |

**Installation:** No new package installation is recommended. [VERIFIED: package.json]

## Package Legitimacy Audit

No new external packages should be installed for Phase 159. [VERIFIED: package.json; VERIFIED: codebase grep] Existing packages used by this phase were checked for registry presence and slopcheck output. [VERIFIED: npm registry; VERIFIED: slopcheck]

| Package | Registry | Age / Currency | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|----------------|-----------|-------------|-----------|-------------|
| `pg` | npm | Latest 8.21.0 modified 2026-05-18. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/brianc/node-postgres`. [VERIFIED: npm registry] | OK. [VERIFIED: slopcheck] | Approved existing dependency; no install. |
| `async-mutex` | npm | Latest 0.5.0 modified 2024-03-11. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/DirtyHairy/async-mutex`. [VERIFIED: npm registry] | OK. [VERIFIED: slopcheck] | Approved existing dependency; no install. |
| `zod` | npm | Latest 4.4.3 modified 2026-05-04. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/colinhacks/zod`. [VERIFIED: npm registry] | OK. [VERIFIED: slopcheck] | Approved existing dependency; no install. |
| `vitest` | npm | Latest 4.1.7 modified 2026-05-20. [VERIFIED: npm registry] | Not collected. [ASSUMED] | `github.com/vitest-dev/vitest`. [VERIFIED: npm registry] | SUS: close to `vite`. [VERIFIED: slopcheck] | Existing dev dependency; no install or upgrade. |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]  
**Packages flagged as suspicious [SUS]:** `vitest`, existing dependency only. [VERIFIED: slopcheck; VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
MCP write tool
  -> validate/resolve vault path
  -> withDocumentLock(config, absolutePath, fn)
      -> derive canonical lock entries
          -> existing file: realpath(file)
          -> missing file destination: realpath(parent) + basename
          -> directory: realpath(dir)
          -> case-fold only if vault filesystem probe says insensitive
          -> prefix namespace: file: or dir:
          -> stable bigint hash
      -> sort/unique entries by canonical key
      -> acquire Tier 1 stripes
      -> withPgClient(databaseUrl, client)
          -> retry SELECT pg_try_advisory_lock($1::bigint) until acquired or deadline
          -> run queued burst callbacks
          -> SELECT pg_advisory_unlock($1::bigint) AS released in reverse order
      -> release Tier 1 stripes
  -> tool catches LockTimeoutError
      -> JSON expected error: { error: "conflict", details: { reason: "lock_timeout" } }
```

### Recommended Project Structure

```text
src/
├── services/
│   └── document-lock.ts       # Canonical key derivation, case probe, timeout retry loop, public lock facade.
├── config/
│   ├── loader.ts              # Zod parse/default/validate locking.lock_timeout_seconds.
│   └── types.ts               # Expose locking.lockTimeoutSeconds.
└── mcp/
    └── tools/documents/*.ts   # Keep call sites on withDocumentLock/withDocumentLocks; only update timeout reason mapping.

tests/
├── unit/
│   ├── lock-key-derivation.test.ts
│   └── lock-timeout.test.ts
├── integration/
│   └── lock-timeout.integration.test.ts
└── scenarios/directed/testcases/
    └── test_case_variant_path_locking.py
```

### Pattern 1: Async Canonical Lock Entries Before Tier 1

**What:** Convert each input path to a canonical, namespaced resource string before computing stripe index, burst key, sorted order, and advisory bigint. [VERIFIED: codebase grep]

**When to use:** Every `withDocumentLock` / `withDocumentLocks` call, including create/copy/move destination scaffolding. [VERIFIED: 159-CONTEXT.md]

```typescript
// Sources: Node fsPromises.realpath docs; 159-CONTEXT.md.
type LockResourceKind = 'file' | 'dir';

async function canonicalResource(
  vaultRoot: string,
  inputPath: string,
  kind: LockResourceKind
): Promise<string> {
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(vaultRoot, inputPath);
  const normalized = path.normalize(absolutePath);
  const resolved =
    kind === 'file' && !(await exists(normalized))
      ? path.join(await realpath(path.dirname(normalized)), path.basename(normalized))
      : await realpath(normalized);
  return `${kind}:${caseFoldIfNeeded(vaultRoot, resolved)}`;
}
```

### Pattern 2: Case-Sensitivity Probe Is Per Vault Root

**What:** Create one temporary probe file under the vault root, stat a case-variant path, cache the boolean, and clean up. [VERIFIED: 159-CONTEXT.md]

**When to use:** Lock-service initialization or first derivation for a given `config.instance.vault.path`. [VERIFIED: 159-CONTEXT.md]

```typescript
// Source: 159-CONTEXT.md; project local probe showed this workspace is case-insensitive.
async function detectCaseInsensitive(root: string): Promise<boolean> {
  const dir = await mkdtemp(path.join(root, '.fqc-case-probe-'));
  try {
    const probe = path.join(dir, 'ProbeCase.tmp');
    await writeFile(probe, 'x');
    await stat(path.join(dir, 'probecase.tmp'));
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

### Pattern 3: Bounded Try-Lock Loop on One Client

**What:** Keep the `PoolClient` checked out, attempt `pg_try_advisory_lock`, sleep briefly between attempts, and throw a typed timeout at the configured deadline. [CITED: PostgreSQL advisory-lock docs; CITED: Context7 `/brianc/node-postgres`]

**When to use:** Tier 2 acquire for each sorted advisory key. [VERIFIED: codebase grep]

```typescript
// Sources: PostgreSQL advisory lock docs; Context7 /brianc/node-postgres.
async function acquireAdvisoryWithTimeout(
  client: PoolClient,
  key: string,
  timeoutMs: number,
  resource: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [key]
    );
    if (result.rows[0]?.acquired === true) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new LockTimeoutError(resource, 'lock_timeout');
}
```

### Anti-Patterns to Avoid

- **Leaving `pg_advisory_lock` unbounded:** Current line 102 can wait indefinitely under cross-process contention. [VERIFIED: codebase grep; CITED: PostgreSQL advisory-lock docs]
- **Keying Tier 1 on pre-canonical paths:** If Tier 1 stripes use `path.normalize()` before `realpath` and case-folding, same-process symlink/case aliases can bypass the same burst group. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md]
- **Using `instance_id` in lock keys:** Requirement forbids it; lock identity is filesystem resource identity, not tenant metadata. [VERIFIED: 159-CONTEXT.md]
- **Testing case-fold only through OS behavior:** Linux CI may be case-sensitive; inject or mock the probe result so unit tests cover both branches. [VERIFIED: 159-CONTEXT.md]
- **Forgetting integration include list:** New integration files must be added to `tests/config/vitest.integration.config.ts`; the repo uses an explicit include list. [VERIFIED: codebase grep]
- **Returning stale `lock_contention` reason for timeout:** Phase 159 requires `details.reason: "lock_timeout"` for timeout responses, while current document tools map `LockTimeoutError` to `lock_contention`. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process mutual exclusion | Lock tables, lockfiles, manual TTL cleanup | PostgreSQL session advisory locks through existing `withPgClient` | Phase 158 retired `fqc_write_locks`; PostgreSQL session advisory locks auto-clean at session end. [VERIFIED: Phase 158 summaries; CITED: PostgreSQL explicit-locking docs] |
| Filesystem canonicalization | String-only normalization or regex path cleanup | Node `fsPromises.realpath()` plus parent-realpath rule | `path.normalize()` does not resolve symlinks; `realpath` resolves actual existing paths. [VERIFIED: codebase grep; CITED: Node fs docs] |
| Case sensitivity inference | Hard-code OS checks only | Runtime probe under vault root | APFS can be configured differently; a one-time probe tests actual filesystem behavior. [ASSUMED] |
| Lock acquisition timeout | Unbounded waits or global process timers | `pg_try_advisory_lock` bounded retry loop | Try-lock returns immediately; app deadline controls user-facing timeout. [CITED: PostgreSQL advisory-lock docs] |
| Tool response formatting | Bespoke JSON strings | Existing `jsonExpectedError` / `jsonRuntimeError` helpers | Existing helpers produce MCP text content with structured JSON envelopes. [VERIFIED: codebase grep] |

**Key insight:** The hard part is not hashing; it is ensuring every tier sees the same canonical, namespaced identity before any queueing, sorting, or advisory acquisition happens. [VERIFIED: 159-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Tier 1 Still Fragments Aliases
**What goes wrong:** Symlink or case variants produce separate in-process stripes before Tier 2 ever runs. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md]  
**Why it happens:** Current entry derivation calls `path.normalize()` synchronously. [VERIFIED: codebase grep]  
**How to avoid:** Make `uniqueSortedEntries` async and derive canonical resources first. [ASSUMED]  
**Warning signs:** Tests pass only for cross-process advisory locks but fail same-process symlink/case unit tests. [ASSUMED]

### Pitfall 2: Missing Destination File Calls `realpath(file)`
**What goes wrong:** `realpath` throws for a create/copy/move destination that does not exist. [CITED: Node fs docs; VERIFIED: 159-CONTEXT.md]  
**Why it happens:** Existing create/copy code locks the destination path before existence check. [VERIFIED: codebase grep]  
**How to avoid:** For file kind, if the file is absent, resolve `realpath(dirname(path))` and append `basename(path)`. [VERIFIED: 159-CONTEXT.md]  
**Warning signs:** Create-mode `write_document` fails before it can create a new file. [ASSUMED]

### Pitfall 3: Timeout Covers Only Tier 2
**What goes wrong:** Same-process contenders can wait on Tier 1 indefinitely even if Tier 2 is bounded. [VERIFIED: codebase grep; ASSUMED]  
**Why it happens:** Current Phase 158 architecture has an in-process burst queue and unbounded `Mutex.acquire()`. [VERIFIED: codebase grep]  
**How to avoid:** Planner should explicitly decide whether REQ-006 timeout applies to total helper acquisition or only Tier 2; product text says "lock acquisition" generally, so safest plan is bound total wait or document a scoped exception before execution. [VERIFIED: canonical requirements; ASSUMED]  
**Warning signs:** Unit tests mock Tier 2 timeout but same-process contention can still hang. [ASSUMED]

### Pitfall 4: Postgres Retry Loop Leaks Partial Acquisitions
**What goes wrong:** Multi-lock acquisition times out on key B after key A is held, leaving key A locked. [ASSUMED]  
**Why it happens:** Timeout thrown before `acquiredKeys` is fully released. [VERIFIED: codebase grep]  
**How to avoid:** Push each key into `acquiredKeys` only after successful try-lock and release all acquired keys in reverse in `finally`. [VERIFIED: codebase grep]  
**Warning signs:** Later tests see `pg_try_advisory_lock` false after a failed test. [ASSUMED]

### Pitfall 5: Evidence Command Uses Unsupported `--grep`
**What goes wrong:** Roadmap evidence command may not run as written under local Vitest. [VERIFIED: local command]  
**Why it happens:** Local `npx vitest --help` shows `--testNamePattern`, not `--grep`. [VERIFIED: local command]  
**How to avoid:** Plans should include roadmap strings for traceability and runnable fallbacks using file targets plus `--testNamePattern`. [VERIFIED: 159-CONTEXT.md]

## Code Examples

### Config Schema Addition

```typescript
// Source: src/config/loader.ts current LockingSchema and Zod conventions.
const LockingSchema = z
  .object({
    enabled: z.boolean().default(true),
    ttl_seconds: z.number().optional(),
    lock_timeout_seconds: z.number().int().positive().default(10),
  })
  .strip()
  .prefault({});
```

### Response Mapping

```typescript
// Source: src/mcp/tools/documents/write.ts current catch shape; 159-CONTEXT.md required reason.
if (err instanceof LockTimeoutError) {
  return jsonExpectedError({
    error: 'conflict',
    message: err.message,
    identifier: identifier ?? path,
    details: { reason: err.reason ?? 'lock_timeout' },
  });
}
```

### Integration Test Include

```typescript
// Source: tests/config/vitest.integration.config.ts explicit include list.
include: [
  // ...
  'tests/integration/lock-timeout.integration.test.ts',
]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fqc_write_locks` table with TTL/manual unlock | Session-scoped PostgreSQL advisory locks via `withPgClient` | Phase 158, 2026-05-26. [VERIFIED: Phase 158 summaries] | Phase 159 must preserve same-client acquire/release and not reintroduce table semantics. [VERIFIED: codebase grep] |
| Basic `path.normalize()` document key | Full `realpath` + case-fold + namespace canonical key | Phase 159 target. [VERIFIED: 159-CONTEXT.md] | Planner must schedule key derivation before tests relying on symlinks/case. [ASSUMED] |
| Unbounded `pg_advisory_lock` | Bounded wait with `pg_try_advisory_lock` loop or `lock_timeout` | Phase 159 target. [VERIFIED: 159-CONTEXT.md] | Contended writers return structured conflicts instead of hanging. [VERIFIED: canonical requirements] |
| `LockTimeoutError` maps to `lock_contention` | Timeout maps to `lock_timeout` | Phase 159 target. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md] | Existing tool catch blocks need coordinated update or reason metadata. [ASSUMED] |

**Deprecated/outdated:**
- `locking.ttl_seconds`: retired in Phase 158 and accepted only for deprecation warnings. [VERIFIED: codebase grep; VERIFIED: Phase 158 summaries]
- `document:` lock namespace: current scaffolding; Phase 159 requires `file:` / `dir:`. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md]
- `--grep` as a local Vitest option: roadmap-required for evidence traceability, but local fallback should use `--testNamePattern`. [VERIFIED: local command]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pg_try_advisory_lock` retry loop is preferable to PostgreSQL `lock_timeout` for this code because it avoids relying on transaction/session GUC scope while no transaction is held. | Summary, Alternatives, Pattern 3 | Planner may choose a different allowed implementation; tests still need to cover bounded behavior. |
| A2 | Case-sensitivity should be probed under the vault root rather than inferred from OS alone because filesystem options can vary. | Don't Hand-Roll, Pattern 2 | Case-folding may be applied incorrectly on unusual mounts. |
| A3 | REQ-006 should probably bound total helper acquisition, not only Tier 2, because product wording says "lock acquisition." | Common Pitfalls | If product intended Tier 2 only, same-process waits may remain unbounded but still pass scoped tests. |
| A4 | Retry interval of about 50 ms is acceptable for tests and production; exact value is discretionary. | Pattern 3 | Too-small intervals add DB churn; too-large intervals increase latency past configured timeout. |

## Open Questions

1. **Should Tier 1 wait count toward `lock_timeout_seconds`?**
   - What we know: REQ-006 says "writer waiting for a contended lock" and "lock acquisition MUST be bounded." [VERIFIED: canonical requirements]
   - What's unclear: Current Phase 158 burst queue waits on `async-mutex` before Tier 2; D-03 specifically calls out Tier 2 acquire options. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md]
   - Recommendation: Planner should include a checkpoint to decide explicitly; safest implementation bounds total `withDocumentLocks` acquisition. [ASSUMED]

2. **Should `withDocumentLock` accept vault-relative inputs after Phase 159?**
   - What we know: REQ-009 says helper accepts relative or absolute paths, while Phase 159 context says tests should cover rejection or canonicalization of vault-relative input. [VERIFIED: canonical requirements; VERIFIED: 159-CONTEXT.md]
   - What's unclear: Current implementation rejects relative paths. [VERIFIED: codebase grep]
   - Recommendation: Canonicalize relative paths against `config.instance.vault.path`; keep path traversal protection at call sites. [ASSUMED]

3. **Should directory-key helpers be exported now before Phase 160 uses them?**
   - What we know: Phase 159 success criteria require file and directory namespaces do not collide, but folder locking behavior is Phase 160. [VERIFIED: ROADMAP.md; VERIFIED: 159-CONTEXT.md]
   - What's unclear: No current production caller needs directory lock acquisition in Phase 159. [VERIFIED: codebase grep]
   - Recommendation: Implement/test directory key derivation without exposing directory lock acquire behavior yet. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | Project minimum is >=20. [VERIFIED: local command; VERIFIED: package.json] |
| npm | Scripts/package checks | yes | 11.5.1 | none. [VERIFIED: local command] |
| Python 3 | Directed scenario `D-WCO-02` | yes | 3.12.3 | none for directed runner. [VERIFIED: local command] |
| `.env.test` | Integration tests | yes | present | Tests skip some Supabase-dependent cases if incomplete. [VERIFIED: local command; VERIFIED: AGENTS.md] |
| `psql` CLI | Manual DB debugging only | no | - | Use node-postgres/Vitest helpers; not required by phase. [VERIFIED: local command] |
| Case-insensitive filesystem | `D-WCO-02` public scenario | yes | local temp probe says case-insensitive | Skip scenario clearly on case-sensitive filesystems. [VERIFIED: local command; VERIFIED: 159-CONTEXT.md] |
| Graphify | Graph context | no | disabled | Continue from code grep and planning docs. [VERIFIED: local command] |

**Missing dependencies with no fallback:** none. [VERIFIED: local command]  
**Missing dependencies with fallback:** `psql` CLI is missing; fallback is existing `pg`-based tests and helpers. [VERIFIED: local command]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 for unit/integration; Python directed scenario runner for `D-WCO-02`. [VERIFIED: npm registry; VERIFIED: project skills] |
| Config file | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`. [VERIFIED: package.json; VERIFIED: codebase grep] |
| Quick run command | `npm test -- tests/unit/lock-key-derivation.test.ts tests/unit/lock-timeout.test.ts --testNamePattern "canonical-key|case-fold|symlink|lock-timeout"` [VERIFIED: local command] |
| Full suite command | `npm test && npm run test:integration -- --testNamePattern "lock-timeout"` plus directed scenario command when added. [VERIFIED: package.json; VERIFIED: project skills] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-003 | Symlink and `.`/`..` aliases unify via realpath. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-006|canonical-key|symlink"` | no - Wave 0 |
| REQ-003 | Missing destination uses real parent plus basename. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-007|destination"` | no - Wave 0 |
| REQ-003 | Case-insensitive probe causes case variants to share key. | unit + directed | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-008|case-fold"`; `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_case_variant_path_locking` | no - Wave 0 |
| REQ-003 | File and directory namespaces do not collide. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-009|namespace"` | no - Wave 0 |
| REQ-003 | Vault-relative input is canonicalized or rejected, never used as raw key. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-010|vault-relative"` | no - Wave 0 |
| REQ-006 | Configured timeout controls Tier 2 retry deadline. | unit | `npm test -- tests/unit/lock-timeout.test.ts --testNamePattern "T-U-014|lock-timeout"` | no - Wave 0 |
| REQ-006 | Missing config defaults to 10 seconds. | unit | `npm test -- tests/unit/lock-timeout.test.ts --testNamePattern "T-U-015|default"` | no - Wave 0 |
| REQ-006 | Default timeout returns structured `lock_timeout` conflict. | integration | `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "T-I-009|lock-timeout"` | no - Wave 0 |
| REQ-006 | Configured 30 s waits long enough for 12 s holder. | integration | `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "T-I-010|lock-timeout"` | no - Wave 0 |

### Sampling Rate

- **Per task commit:** targeted unit file(s) plus `npm run typecheck`. [VERIFIED: package.json]
- **Per wave merge:** `npm test -- --testNamePattern "canonical-key|case-fold|symlink|lock-timeout"` and targeted integration file. [VERIFIED: local command]
- **Phase gate:** Roadmap evidence strings plus local fallbacks:
  - Roadmap: `npm test -- --grep "canonical-key|case-fold|symlink|lock-timeout"`; fallback: `npm test -- tests/unit/lock-key-derivation.test.ts tests/unit/lock-timeout.test.ts --testNamePattern "canonical-key|case-fold|symlink|lock-timeout"`. [VERIFIED: ROADMAP.md; VERIFIED: local command]
  - Roadmap: `npm run test:integration -- --grep "lock-timeout"`; fallback: `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "lock-timeout"`. [VERIFIED: ROADMAP.md; VERIFIED: local command]
  - Directed: `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_case_variant_path_locking` with skip on case-sensitive filesystems. [VERIFIED: project skills]

### Wave 0 Gaps

- [ ] `tests/unit/lock-key-derivation.test.ts` - covers `T-U-006` through `T-U-010`. [VERIFIED: test plan]
- [ ] `tests/unit/lock-timeout.test.ts` - covers `T-U-014` and `T-U-015`. [VERIFIED: test plan]
- [ ] `tests/integration/lock-timeout.integration.test.ts` - covers `T-I-009` and `T-I-010`; add to integration include list. [VERIFIED: test plan; VERIFIED: codebase grep]
- [ ] `tests/scenarios/directed/testcases/test_case_variant_path_locking.py` - covers `D-WCO-02` / `T-S-002` when filesystem supports it. [VERIFIED: test plan; VERIFIED: local command]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not change auth. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless; PostgreSQL backend sessions are infrastructure, not user sessions. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve existing vault path validation and do not weaken symlink/path traversal guards. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Validate `locking.lock_timeout_seconds` as positive integer with Zod; never interpolate lock keys into SQL. [VERIFIED: codebase grep; CITED: Context7 `/brianc/node-postgres`] |
| V6 Cryptography | yes | Hashing is deterministic key derivation, not cryptographic access control; use Node `crypto` only, do not add custom crypto dependency. [VERIFIED: codebase grep; ASSUMED] |
| V7 Error Handling | yes | Return structured expected-error envelopes for timeout, not uncaught exceptions or raw database errors. [VERIFIED: AGENTS.md; VERIFIED: 159-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection through advisory lock SQL | Tampering | Keep `$1::bigint` parameterized queries; never interpolate keys. [VERIFIED: codebase grep; CITED: Context7 `/brianc/node-postgres`] |
| Path traversal or symlink escape during canonicalization | Elevation of privilege | Continue validating tool inputs with `validateVaultPath`; canonicalization must not bless paths outside vault. [VERIFIED: codebase grep] |
| Denial of service via infinite lock wait | Denial of Service | Bounded retry loop and structured timeout. [VERIFIED: 159-CONTEXT.md; CITED: PostgreSQL advisory-lock docs] |
| Lock key collision between resource types | Tampering / DoS | Prefix `file:` and `dir:` before hashing. [VERIFIED: 159-CONTEXT.md] |
| Resource leak from unreleased advisory locks | Denial of Service | Release every acquired key in reverse order in `finally`; verify `pg_advisory_unlock` returned true. [VERIFIED: codebase grep; CITED: PostgreSQL advisory-lock docs] |

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` - project stack, test, MCP response, and no-web-UI constraints. [VERIFIED: AGENTS.md]
- `.planning/phases/159-lock-timeout-canonical-key-derivation/159-CONTEXT.md` - locked phase decisions and test scope. [VERIFIED: codebase grep]
- Canonical product requirements doc - REQ-003 and REQ-006 acceptance criteria. [VERIFIED: required reading]
- Canonical product test plan - `T-U-006` through `T-U-010`, `T-U-014`, `T-U-015`, `T-I-009`, `T-I-010`, `T-S-002`. [VERIFIED: required reading]
- `src/services/document-lock.ts`, `src/config/loader.ts`, `src/config/types.ts`, document tool handlers, and test configs. [VERIFIED: codebase grep]
- Context7 `/brianc/node-postgres` - checked-out client and release pattern. [CITED: Context7 `/brianc/node-postgres`]
- Context7 `/dirtyhairy/async-mutex` - `Mutex.acquire()` release callback and `withTimeout`. [CITED: Context7 `/dirtyhairy/async-mutex`]
- Node.js fs docs - `fsPromises.realpath`. [CITED: https://nodejs.org/api/fs.html#fspromisesrealpathpath-options]
- PostgreSQL advisory lock docs. [CITED: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS]
- PostgreSQL explicit locking docs. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS]
- PostgreSQL `lock_timeout` docs. [CITED: https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT]

### Secondary (MEDIUM confidence)

- Phase 158 summaries and research - shipped advisory-lock behavior, legacy retirement, and session-capable startup self-test. [VERIFIED: required reading]
- Project directed scenario skills and `WRITING_SCENARIOS.md` - directed scenario authoring and `enable_locking=True` convention. [VERIFIED: project skills]

### Tertiary (LOW confidence)

- None used as authoritative. [VERIFIED: source audit]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages are existing dependencies checked with `npm ls`, `npm view`, Context7, and slopcheck where relevant. [VERIFIED: npm registry; VERIFIED: slopcheck]
- Architecture: HIGH - current facade, config, and tests were inspected directly; phase decisions are explicit. [VERIFIED: codebase grep; VERIFIED: 159-CONTEXT.md]
- Pitfalls: MEDIUM - most are verified from current code; Tier 1 timeout scope remains an open planning decision. [VERIFIED: codebase grep; ASSUMED]

**Research date:** 2026-05-26  
**Valid until:** 2026-06-25 for repo-internal patterns; re-check package versions and PostgreSQL docs if planning happens later. [ASSUMED]
