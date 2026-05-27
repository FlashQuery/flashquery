# Phase 161: Destination Locks + EXDEV Fallback - Research

**Researched:** 2026-05-27  
**Domain:** TypeScript MCP document write locking, Postgres advisory locks, durable filesystem moves  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01: Canonical Source Documents
- Downstream planner, executor, checker, reviewer, and verifier agents MUST read these two source documents before making implementation decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`
- These external docs are canonical for phase requirements, acceptance criteria, test IDs, required evidence, assumptions, and phase boundaries. If local `.planning/REQUIREMENTS.md` and these docs disagree, stop and surface the conflict.
- For implementation questions, consult those docs first. Ask the user only if the docs do not answer the question or conflict with current repo reality.

### D-02: REQ-008 Destination Locks
- `copy_document` must take the destination per-file lock for the operation duration before the authoritative destination existence check and write. A pre-lock existence check may remain only as a fast-fail; it is not the correctness guard.
- `move_document` must take both source and destination per-file locks using `withDocumentLocks([source, destination], ...)` or the current equivalent multi-lock facade, with acquisition sorted by canonical path per INV-09.
- Create-mode `write_document` for a not-yet-existing path must take the destination per-file lock derived per REQ-003 AC #2: `realpath(parent) + '/' + basename`, with case-folding when the vault filesystem requires it.
- Destination existence checks for create, copy, and move must happen inside the destination lock.
- Multi-lock behavior must compose with shared ancestor directory locks from Phase 160. For move, both source and destination parent chains need shared ancestor folder locks while the operation is in progress.
- The implementation must include the REQ-008 code-comment table documenting, per tool, which paths are locked and in what order.
- Caller-visible conflict behavior should preserve the existing structured `conflict` envelope shape, accepting either `path_exists` or `lock_timeout` where the test plan allows either.

### D-03: REQ-022 EXDEV Fallback
- `move_document` must replace the current direct `readFile(src) -> writeFile(dst) -> stat(dst) -> unlink(src)` EXDEV fallback with the durable atomic write primitive from Phase 156.
- The EXDEV path must write a unique temp file in the destination directory, fsync it, rename it into place, fsync the destination directory, and unlink the source only after the destination commit completes successfully.
- If the destination write/commit fails, the source must remain intact and must not be unlinked.
- The EXDEV fallback must not bypass the same destination/source lock coverage required by REQ-008.

### D-04: Required Test Scope
- Unit tests MUST include Test Plan §4.4.3 cases `T-U-034` and `T-U-035` in `tests/unit/move-exdev-fallback.test.ts`.
- Integration tests MUST include Test Plan §4.1.8 cases `T-I-014`, `T-I-015`, `T-I-016`, and `T-I-048` in `tests/integration/destination-lock.integration.test.ts`.
- Integration tests MUST include Test Plan §4.4.3 case `T-I-042` in `tests/integration/move-exdev-fallback.integration.test.ts`.
- Directed scenario coverage MUST include `T-S-003` / `D-WCO-03` in `tests/scenarios/directed/testcases/test_copy_destination_race.py` when the scenario lands.
- Required execution evidence from the roadmap is:
  - `npm test -- --grep "move-exdev-fallback"`
  - `npm run test:integration -- --grep "destination-lock|move-exdev"`
  - directed scenario `D-WCO-03` when it lands.
- If Vitest in this repo does not support literal `--grep`, use the repo's established equivalent selector such as `--testNamePattern`, but record the deviation in the execution summary.

### D-05: Current Repo Starting Point
- `src/services/document-lock.ts` is the expected lock facade. It should already expose per-file `withDocumentLock` / `withDocumentLocks`, canonical key derivation, timeout behavior, and Phase 160 shared/exclusive directory-lock helpers.
- `src/mcp/tools/documents/write.ts` already serializes normal document writes through the per-file lock path. Phase 161 must confirm create-mode destination locking covers not-yet-existing files before the authoritative existence check.
- `src/mcp/tools/documents/copy.ts` currently owns copy destination handling and must move the destination existence check inside the destination lock.
- `src/mcp/tools/documents/move.ts` currently owns destination checking, source/destination rename, and EXDEV fallback. This is the primary implementation target for source+destination multi-lock order and durable EXDEV fallback.
- `src/storage/vault.ts` / the current durable write primitive from Phase 156 is the expected write helper for EXDEV destination commits. Do not reintroduce a direct `writeFile(destAbsPath, content)` fallback.
- Phase 160 already wrapped document write paths in shared ancestor directory locks; Phase 161 must preserve those wrappers and add destination/source per-file locking without regressing folder coordination.

### the agent's Discretion
- Exact helper names and test-hook names are discretionary if they preserve the public facade boundary and do not expose low-level advisory primitives broadly.
- Tests may verify sorted lock acquisition through a helper-level trace hook, a scoped testing export, or another deterministic source assertion, but they must prove the acquisition order rather than relying on timing alone.
- The exact directed scenario implementation is discretionary, but it must prove two public MCP `copy_document` calls to the same destination produce exactly one success and one structured conflict.

### Deferred Ideas (OUT OF SCOPE)
Version-token expected-version checks remain Phase 162. Best-effort multi-file batch contracts remain Phase 163. Macro-specific semantics remain outside Phase 161.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-008 | Destination-path locks for create, copy, and move; move takes source and destination locks in sorted canonical order. | Current lock facade sorts canonical `file:` entries and current write/copy/move call sites already wrap destination paths; plan must add required trace/comment/test proof and close any gaps. [VERIFIED: codebase grep] [VERIFIED: product Requirements §6.1.8] |
| REQ-022 | Cross-device move fallback uses durable atomic write discipline and unlinks source only after destination commit. | Current `move_document` EXDEV branch calls `writeVaultFile(destAbsPath, content, { lockConfig: config })` before `unlink(sourceAbsPath)`; plan must add T-U-034/T-U-035/T-I-042 proof and harden EXDEV detection if needed. [VERIFIED: codebase grep] [VERIFIED: product Requirements §6.4.3] |
</phase_requirements>

## Summary

Phase 161 should be planned as a focused verification-and-hardening slice, not a rewrite. The current repo already has the core primitives this phase needs: `withDocumentLock`, `withDocumentLocks`, canonical destination keying for absent files, shared ancestor directory locks, and `writeVaultFile` with temp-write, file sync, rename, and directory sync. [VERIFIED: `src/services/document-lock.ts`] [VERIFIED: `src/storage/vault-write.ts`]

The implementation hotspots are still the right ones: `write.ts`, `copy.ts`, and `move.ts`. Create-mode `write_document` and `copy_document` currently perform destination existence checks inside the destination lock, while `move_document` currently wraps source and destination ancestor directory locks and uses `withDocumentLocks(config, [sourceAbsPath, normalizedDest], ...)`. [VERIFIED: codebase grep] The main plan work is to add the mandated REQ-008 code-comment table, add deterministic acquisition-order trace coverage, add race integration tests, and add EXDEV fallback tests that prove `writeVaultFile` succeeds before `unlink` can run. [VERIFIED: product Test Plan §4.1.8, §4.4.3]

**Primary recommendation:** Use the existing `document-lock.ts` and `writeVaultFile` facades; plan small code hardening plus a substantial test wave for destination races, sorted multi-lock order, and EXDEV failure ordering. [VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Destination-path serialization | API / Backend | Database / Storage | MCP tool handlers own when locks are taken; Postgres advisory locks provide cross-process exclusion. [VERIFIED: `src/mcp/tools/documents/*.ts`] [VERIFIED: `src/services/document-lock.ts`] |
| Canonical lock key derivation | API / Backend | Filesystem | `document-lock.ts` canonicalizes paths using realpath, parent+basename for absent files, case-fold probing, and `file:` / `dir:` namespaces. [VERIFIED: `src/services/document-lock.ts`] |
| Shared ancestor directory coordination | API / Backend | Database / Storage | Phase 160 helpers take advisory shared `dir:` locks for parent-through-root chains around file writes. [VERIFIED: Phase 160 summaries] |
| EXDEV fallback commit | Filesystem | API / Backend | `move_document` detects cross-device rename failure; `writeVaultFile` owns durable destination commit sequence. [VERIFIED: `src/mcp/tools/documents/move.ts`] [VERIFIED: `src/storage/vault-write.ts`] |
| Public conflict response shape | API / Backend | Client / MCP consumer | Tool handlers convert path conflicts and `LockTimeoutError` into JSON expected-error envelopes with `details.reason`. [VERIFIED: `src/mcp/tools/documents/*.ts`] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; this checkout currently runs Node v24.7.0 and npm 11.5.1. [VERIFIED: AGENTS.md] [VERIFIED: environment audit]
- Use TypeScript strict-mode ESM; do not use CommonJS `require`. [VERIFIED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- MCP tool handlers should catch internally and return human-readable `{ content: [{ type: "text", text }] }`; expected failures use structured JSON envelopes with `isError:false` in current utilities. [VERIFIED: AGENTS.md] [VERIFIED: `src/mcp/utils/response-formats.ts`]
- Use Zod for external input validation and preserve existing path validation helpers. [VERIFIED: AGENTS.md] [VERIFIED: codebase grep]
- Unit tests are under `tests/unit/*.test.ts`; integration tests are under `tests/integration/*.test.ts`; integration tests use `.env.test` and skip gracefully when required environment is missing or unsuitable. [VERIFIED: AGENTS.md] [VERIFIED: `tests/helpers/test-env.ts`]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fs/promises` | Runtime built-in | `rename`, `readFile`, `unlink`, `mkdir`, `open`, and `FileHandle.sync` for move and durable write primitives. | Official Node v20 docs describe `rename` and file sync APIs; no package install is needed. [CITED: Context7 `/websites/nodejs_latest-v20_x`] [VERIFIED: package.json engines] |
| `pg` | `^8.21.0` | Session-scoped advisory lock connection handling via `withPgClient`. | Existing Phase 158 lock service depends on Postgres advisory locks; no replacement is in scope. [VERIFIED: package.json] [VERIFIED: Phase 158 summaries] |
| `vitest` | `^4.1.1` | Unit and integration tests. | Existing repo scripts and configs use Vitest for this phase's required tests. [VERIFIED: package.json] |
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP tool registration. | Existing document tools register through this SDK; AGENTS.md forbids the nonexistent alternate package. [VERIFIED: package.json] [VERIFIED: AGENTS.md] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `gray-matter` | `^4.0.3` | Parse moved/copied markdown frontmatter. | Existing copy/move/write handlers depend on it for document metadata. [VERIFIED: package.json] [VERIFIED: codebase grep] |
| `uuid` | `^13.0.0` | Generate new document IDs for create/copy. | Keep existing ID behavior for create/copy tests. [VERIFIED: package.json] |
| `zod` | `^4.4.3` | MCP parameter schemas. | Continue existing external input validation pattern. [VERIFIED: package.json] [VERIFIED: AGENTS.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `withDocumentLocks` | New lock helper or direct advisory SQL | Reject. The phase explicitly requires composing with the current facade and keeping low-level primitives encapsulated. [VERIFIED: `161-CONTEXT.md`] |
| Existing `writeVaultFile` | Custom EXDEV temp-file code in `move.ts` | Reject. Phase 156 already owns durable atomic write semantics; duplicating it risks drift. [VERIFIED: `src/storage/vault-write.ts`] [VERIFIED: product Requirements §6.4.3] |
| Vitest `--grep` | `--testNamePattern` | Use `--testNamePattern` when literal `--grep` fails; Phase 160 already recorded that Vitest v4 in this repo does not support `--grep`. [VERIFIED: Phase 160 summary] |

**Installation:** No external packages should be installed for this phase. [VERIFIED: package.json] [VERIFIED: phase scope]

## Package Legitimacy Audit

No new external packages are recommended for Phase 161, so the package legitimacy gate does not apply. [VERIFIED: phase scope]

## Architecture Patterns

### System Architecture Diagram

```text
MCP write/copy/move request
  -> Zod/tool input validation
  -> resolve/validate source and destination paths
  -> shared ancestor dir locks
       create/copy: destination parent chain
       move: source parent chain + destination parent chain
  -> per-file document lock(s)
       create/copy: destination lock
       move: sorted canonical source + destination locks
  -> authoritative destination exists check inside lock
       exists -> JSON conflict(path_exists)
       lock wait expires -> JSON conflict(lock_timeout)
       clear -> write/rename
  -> same-device move: fs.rename(source, destination)
  -> EXDEV branch: read source -> writeVaultFile(destination) -> unlink(source)
  -> DB metadata update / embedding schedule / JSON response
```

### Recommended Project Structure

```text
src/
├── services/document-lock.ts          # canonical lock facade and optional test trace hook
├── mcp/tools/documents/write.ts       # create-mode destination lock proof/comment
├── mcp/tools/documents/copy.ts        # copy destination race prevention
├── mcp/tools/documents/move.ts        # source+destination multi-lock and EXDEV fallback
└── storage/vault-write.ts             # durable atomic destination commit primitive

tests/
├── unit/move-exdev-fallback.test.ts
├── integration/destination-lock.integration.test.ts
├── integration/move-exdev-fallback.integration.test.ts
└── scenarios/directed/testcases/test_copy_destination_race.py
```

### Pattern 1: Keep Existence Checks Inside Destination Locks

**What:** Validate/normalize paths before locks, then perform the authoritative destination `existsSync` check inside `withDocumentLock` or `withDocumentLocks`. [VERIFIED: product Requirements §6.1.8]  
**When to use:** Create-mode `write_document`, `copy_document`, and `move_document` destination handling. [VERIFIED: `161-CONTEXT.md`]

```typescript
// Source: current copy_document pattern, src/mcp/tools/documents/copy.ts
return await withAncestorDirectoryLocksShared(config, absPath, async () =>
  withDocumentLock(config, absPath, async () => {
    if (existsSync(absPath)) {
      return jsonExpectedError({
        error: 'conflict',
        message: `A file already exists at '${copyRelativePath}'. Choose a different destination or remove the existing file first.`,
        identifier: copyRelativePath,
        details: { reason: 'path_exists' },
      });
    }
    // write destination while destination lock is held
  })
);
```

### Pattern 2: Multi-Lock Move Uses the Facade

**What:** `move_document` should lock source and destination through `withDocumentLocks(config, [sourceAbsPath, normalizedDest], ...)`; the facade canonicalizes, deduplicates, sorts by `basicKey`, and releases in reverse advisory order. [VERIFIED: `src/services/document-lock.ts`]  
**When to use:** Any operation taking more than one per-file lock; Phase 161 only needs this for move. [VERIFIED: product Requirements §6.1.8]

```typescript
// Source: current move_document pattern, src/mcp/tools/documents/move.ts
return await withAncestorDirectoryLocksShared(config, sourceAbsPath, async () =>
  withAncestorDirectoryLocksShared(config, normalizedDest, async () =>
    withDocumentLocks(config, [sourceAbsPath, normalizedDest], async () => {
      if (existsSync(destAbsPath)) {
        return jsonExpectedError({
          error: 'conflict',
          identifier: destPath,
          details: { reason: 'path_exists' },
        });
      }
      await rename(sourceAbsPath, destAbsPath);
    })
  )
);
```

### Pattern 3: EXDEV Fallback Delegates to `writeVaultFile`

**What:** On cross-device rename failure, copy bytes through the durable primitive and unlink source only after that promise resolves. [VERIFIED: `src/mcp/tools/documents/move.ts`]  
**When to use:** `move_document` EXDEV branch only; broader trash EXDEV behavior exists in `vault.ts` but is outside REQ-022 for this phase. [VERIFIED: product Requirements §6.4.3] [VERIFIED: codebase grep]

```typescript
// Source: current move_document EXDEV branch, src/mcp/tools/documents/move.ts
const content = await readFile(sourceAbsPath, 'utf-8');
await writeVaultFile(destAbsPath, content, { lockConfig: config });
await unlink(sourceAbsPath);
```

### Anti-Patterns to Avoid

- **Direct `writeFile(destAbsPath, content)` in EXDEV:** bypasses temp-write/fsync/rename/dir-fsync and violates REQ-022. [VERIFIED: product Requirements §6.4.3]
- **Timing-only sorted-lock tests:** races can pass without proving canonical order; use helper-level advisory query traces, a test hook, or `__testing.deriveAdvisoryKey` assertions. [VERIFIED: `161-CONTEXT.md`]
- **New low-level advisory exports:** `lock-helper-only` guards the facade boundary; do not expose raw lock primitives for Phase 161. [VERIFIED: `tests/unit/lock-helper-only.test.ts`]
- **Adding integration files without config registration:** `tests/config/vitest.integration.config.ts` uses an explicit include list. [VERIFIED: integration config] [VERIFIED: Phase 158 summaries]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-file and multi-file locking | New mutex/advisory-lock service | `withDocumentLock` / `withDocumentLocks` | Existing facade already canonicalizes absent destinations, case-folds, sorts, times out, and maps ambient locks for write assertions. [VERIFIED: `src/services/document-lock.ts`] |
| Shared directory coordination | Custom parent traversal in tool handlers | `withAncestorDirectoryLocksShared` | Phase 160 already implemented canonical `dir:` shared advisory locks. [VERIFIED: Phase 160 summaries] |
| Durable destination commit | Bespoke temp file sequence in `move.ts` | `writeVaultFile` | Phase 156 primitive owns temp names, file sync, rename, directory sync, and cleanup. [VERIFIED: `src/storage/vault-write.ts`] |
| Cross-process lock assertions | Sleep-based integration tests only | Postgres advisory traces and deterministic hooks | Session advisory locks are observable through `pg_locks` when a session-capable DB is available. [VERIFIED: `tests/helpers/pg-locks.ts`] |

**Key insight:** Phase 161 should add missing evidence and narrow hardening around already-installed primitives, not create a second concurrency or durability stack. [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Existing Code Looks Done, But Required Evidence Is Missing
**What goes wrong:** Planner skips tests because current code already has destination locks and `writeVaultFile`. [VERIFIED: codebase grep]  
**Why it happens:** Phase 156/160 work partially implemented Phase 161-compatible behavior without claiming REQ-008/REQ-022 completion. [VERIFIED: phase summaries]  
**How to avoid:** Plan explicit T-U-034/T-U-035/T-I-014/T-I-015/T-I-016/T-I-042/T-I-048/T-S-003 coverage and a REQ-008 comment table. [VERIFIED: product Test Plan]  
**Warning signs:** No new `move-exdev-fallback` test file or no new `destination-lock.integration.test.ts`. [VERIFIED: product Test Plan]

### Pitfall 2: Testing Move Order Without Proving Canonical Order
**What goes wrong:** A test sees two locks but cannot prove source/destination order. [VERIFIED: product Test Plan §4.1.8]  
**Why it happens:** `withDocumentLocks` sorts derived canonical entries, not the raw array order; tests must observe derived keys or facade calls. [VERIFIED: `src/services/document-lock.ts`]  
**How to avoid:** Use `__testing.deriveAdvisoryKey`, fake pool query call order, or a scoped trace hook that records canonical resources before advisory acquisition. [VERIFIED: `tests/unit/with-document-lock.test.ts`]  
**Warning signs:** Assertions depend on `Promise.race` timing alone. [ASSUMED]

### Pitfall 3: Session-Capable DB Skips
**What goes wrong:** Integration tests that need real advisory lock visibility skip or fail under a transaction pooler. [VERIFIED: Phase 158 summaries]  
**Why it happens:** `.env.test` is present, but the current configured DB URL is classified by existing helpers as non-session-capable when it points at a Supabase transaction pooler. [VERIFIED: `tests/helpers/test-env.ts`] [VERIFIED: environment audit]  
**How to avoid:** Use `describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)` where tests require real `pg_locks`; use lock-facade unit tests for deterministic order independent of DB availability. [VERIFIED: existing integration tests]  
**Warning signs:** Tests pass locally as skipped but produce no real REQ-008 evidence. [ASSUMED]

### Pitfall 4: EXDEV Detection By Message Only
**What goes wrong:** A mocked or real cross-device error with `code: "EXDEV"` but a different message is not handled. [ASSUMED]  
**Why it happens:** Current `move.ts` checks `err.message` for `EXDEV` or `Invalid cross-device`. [VERIFIED: `src/mcp/tools/documents/move.ts`]  
**How to avoid:** Plan a tiny helper such as `isCrossDeviceRenameError(err)` that checks `(err as NodeJS.ErrnoException).code === 'EXDEV'` plus existing message fallback, then unit test it through T-U-034/T-U-035. [ASSUMED]  
**Warning signs:** Unit tests must craft the exact current message string to enter the fallback. [VERIFIED: codebase grep]

### Pitfall 5: Directed Scenario Concurrency Support
**What goes wrong:** `D-WCO-03` cannot express true parallel public MCP calls. [ASSUMED]  
**Why it happens:** Phase 160 summary carried forward a concurrency-runner prerequisite for in-flight scenarios, and current directed docs require `enable_locking=True` with managed server ownership for lock tests. [VERIFIED: Phase 160 summary] [VERIFIED: `tests/scenarios/directed/WRITING_SCENARIOS.md`]  
**How to avoid:** Plan `test_copy_destination_race.py` with a dedicated managed server and explicit parallel calls; if the framework lacks a helper, add the smallest local thread/future pattern in the test file. [ASSUMED]  
**Warning signs:** Scenario only performs sequential duplicate copy, which already exists in `test_document_copy_and_move.py` and does not prove a race. [VERIFIED: existing directed test]

## Code Examples

### Sorted Lock Assertion

```typescript
// Source: tests/unit/with-document-lock.test.ts
await withDocumentLocks(makeConfig(), ['/tmp/vault/b.md', '/tmp/vault/a.md'], async () => undefined);

expect(clients[0].calls.map((call) => call.sql)).toEqual([
  'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
  'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
  'SELECT pg_advisory_unlock($1::bigint) AS released',
  'SELECT pg_advisory_unlock($1::bigint) AS released',
]);
expect(clients[0].calls[0].params?.[0]).toBe(clients[0].calls[3].params?.[0]);
expect(clients[0].calls[1].params?.[0]).toBe(clients[0].calls[2].params?.[0]);
```

### Durable Write Operation Trace

```typescript
// Source: tests/unit/vault-write-durable.test.ts
const writeIndex = events.findIndex((event) =>
  event.startsWith('writeFile:/vault/project/note.md.fqc-tmp-')
);
const renameIndex = events.findIndex((event) =>
  event.startsWith('rename:/vault/project/note.md.fqc-tmp-') &&
  event.endsWith('->/vault/project/note.md')
);
const dirOpenIndex = events.indexOf('open:/vault/project');

expect(renameIndex).toBeGreaterThan(writeIndex);
expect(dirOpenIndex).toBeGreaterThan(renameIndex);
expect(events[dirOpenIndex + 1]).toBe('dir.sync');
```

### Session-Gated Advisory Integration Pattern

```typescript
// Source: tests/integration/folder-lock.integration.test.ts
describe.skipIf(!HAS_SESSION_CAPABLE_DATABASE_URL)('REQ-007 folder-lock integration', () => {
  afterAll(async () => {
    await closePgPools();
  });
  // real advisory-lock assertions here
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy `fqc_write_locks` table | Session-scoped Postgres advisory locks | Phase 158 | Phase 161 must use existing advisory facade and can assume startup rejects unsafe session setups. [VERIFIED: Phase 158 summaries] |
| Basic path keys | Canonical `file:` / `dir:` resources with absent-destination parent+basename rule | Phase 159 | Create/copy/move destination locks can key not-yet-existing paths correctly. [VERIFIED: Phase 159 summaries] |
| File writes only held per-file locks | File write paths also hold shared ancestor directory locks | Phase 160 | Phase 161 must preserve wrappers and add/prove destination file locks inside them. [VERIFIED: Phase 160 summaries] |
| Direct or fixed-temp writes | `writeVaultFile` unique temp, fsync, rename, directory fsync | Phase 156 | EXDEV fallback should delegate and not duplicate durable commit logic. [VERIFIED: Phase 156 research/code] |
| Vitest `--grep` evidence command | `--testNamePattern` fallback in this repo | Phase 160 validation | Record required command and actual equivalent if `--grep` fails. [VERIFIED: Phase 160 summary] |

**Deprecated/outdated:**
- Direct `writeFile` destination fallback in `move_document` is outdated and must not return. [VERIFIED: product Requirements §6.4.3]
- Sequential duplicate-copy scenario coverage does not satisfy D-WCO-03 race proof. [VERIFIED: existing directed test] [VERIFIED: product Test Plan]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A scoped `isCrossDeviceRenameError` helper should check `err.code === "EXDEV"` plus current message fallback. | Common Pitfalls | If the planner leaves message-only detection, real or mocked EXDEV variants may bypass fallback. |
| A2 | A directed scenario can use Python threading/futures if no framework helper exists for parallel MCP calls. | Common Pitfalls | If the framework forbids this pattern, D-WCO-03 may need a runner/framework prerequisite task. |
| A3 | Timing-only tests are insufficient for sorted-order proof. | Common Pitfalls | If accepted anyway, a deadlock-prone implementation could pass tests. |
| A4 | Some integration evidence may skip in the current environment because the DB URL is not session-capable. | Environment Availability | Planner may overstate integration coverage unless it records skip reasons and uses unit-level deterministic evidence. |

## Open Questions

1. **Should Phase 161 add a public or private lock trace hook?**
   - What we know: Existing `__testing` exports derive advisory keys but do not expose acquisition traces. [VERIFIED: `src/services/document-lock.ts`]
   - What's unclear: Whether T-I-015 should trace through the public `move_document` handler or accept a helper-level unit proof plus static call-site proof. [ASSUMED]
   - Recommendation: Add the narrowest test-only trace hook in `document-lock.ts`, reset it in `afterEach`, and keep production advisory primitives private. [ASSUMED]

2. **Can `D-WCO-03` land in this phase without scenario framework work?**
   - What we know: Directed docs support `enable_locking=True`; Phase 160 noted scenario concurrency limitations. [VERIFIED: directed docs] [VERIFIED: Phase 160 summary]
   - What's unclear: Whether current `fqc_client` is thread-safe for simultaneous tool calls. [ASSUMED]
   - Recommendation: Planner should include a small spike/task to inspect or locally implement safe parallel calls in `test_copy_destination_race.py`. [ASSUMED]

3. **Should `moveMarkdownToTrash` EXDEV behavior be touched?**
   - What we know: `vault.ts` has a similar EXDEV branch using `writeVaultFile`, but Phase 161's locked requirement names `move_document`. [VERIFIED: codebase grep] [VERIFIED: `161-CONTEXT.md`]
   - What's unclear: Whether reviewers will expect consistency hardening in trash moves. [ASSUMED]
   - Recommendation: Keep trash moves out of scope unless tests/static guards fail; do not expand Phase 161 acceptance beyond REQ-008/REQ-022. [VERIFIED: `161-CONTEXT.md`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | Project supports >=20; no fallback needed. [VERIFIED: environment audit] [VERIFIED: package.json] |
| npm | Test scripts | yes | 11.5.1 | None. [VERIFIED: environment audit] |
| Python 3 | Directed scenarios and macOS full-fsync adapter tests | yes | 3.12.3 | None for directed scenarios. [VERIFIED: environment audit] |
| gsd-sdk | Phase metadata/commit docs | yes | 1.42.3 | Manual file write if unavailable. [VERIFIED: environment audit] |
| `.env.test` | Integration tests | yes | present | Session-capable advisory tests skip when DB URL is unsuitable. [VERIFIED: environment audit] [VERIFIED: `tests/helpers/test-env.ts`] |
| Session-capable Postgres URL | Real advisory-lock integration proof | no/uncertain | Current helper likely classifies configured pooler URL as not session-capable. | Use unit/fake-pool proof and record skipped integration evidence until direct/session URL is configured. [VERIFIED: `tests/helpers/test-env.ts`] [VERIFIED: Phase 158 summaries] |

**Missing dependencies with no fallback:**
- None for planning and unit test implementation. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- Session-capable Postgres URL for real advisory integration evidence; fallback is deterministic unit tests plus skip-aware integration registration. [VERIFIED: existing integration pattern]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1`; directed scenarios use Python runner. [VERIFIED: package.json] [VERIFIED: directed docs] |
| Config file | `tests/config/vitest.unit.config.ts` via `npm test`; `tests/config/vitest.integration.config.ts` via `npm run test:integration`. [VERIFIED: package.json] [VERIFIED: integration config] |
| Quick run command | `npm test -- tests/unit/move-exdev-fallback.test.ts tests/unit/with-document-lock.test.ts --testNamePattern "move-exdev-fallback|T-U-034|T-U-035|T-U-017"` [VERIFIED: Vitest config] |
| Full suite command | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "destination-lock|move-exdev|T-I-014|T-I-015|T-I-016|T-I-042|T-I-048"` [VERIFIED: integration config] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-008 | Concurrent `copy_document` to same destination yields one success and one conflict/timeout. | integration | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts --testNamePattern "T-I-014"` | No - Wave 0 [VERIFIED: product Test Plan] |
| REQ-008 | `move_document` locks source and destination in sorted canonical order. | unit/integration/static | `npm test -- tests/unit/with-document-lock.test.ts --testNamePattern "T-U-017"` plus new `T-I-015` | Partial - existing helper test; public move test missing [VERIFIED: codebase grep] |
| REQ-008 | Concurrent moves into same destination yield one success and one conflict/timeout. | integration | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts --testNamePattern "T-I-016"` | No - Wave 0 [VERIFIED: product Test Plan] |
| REQ-008 | Concurrent create-mode writes to same absent destination yield one success and one conflict/timeout. | integration | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts --testNamePattern "T-I-048"` | No - Wave 0 [VERIFIED: product Test Plan] |
| REQ-008 | Public directed `copy_document` destination race. | scenario | `python3 tests/scenarios/directed/testcases/test_copy_destination_race.py --managed --json` | No - Wave 0 [VERIFIED: product Test Plan] |
| REQ-022 | EXDEV fallback calls `writeVaultFile` before source unlink. | unit | `npm test -- tests/unit/move-exdev-fallback.test.ts --testNamePattern "T-U-034"` | No - Wave 0 [VERIFIED: product Test Plan] |
| REQ-022 | EXDEV fallback does not unlink source if durable destination write fails. | unit | `npm test -- tests/unit/move-exdev-fallback.test.ts --testNamePattern "T-U-035"` | No - Wave 0 [VERIFIED: product Test Plan] |
| REQ-022 | Simulated EXDEV fallback crash leaves no partial destination. | integration | `npm run test:integration -- tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "T-I-042"` | No - Wave 0 [VERIFIED: product Test Plan] |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/move-exdev-fallback.test.ts tests/unit/document-tool-lock-call-sites.test.ts --testNamePattern "move-exdev-fallback|destination lock|lock call sites"` [ASSUMED]
- **Per wave merge:** `npm run test:integration -- tests/integration/destination-lock.integration.test.ts tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "destination-lock|move-exdev"` [ASSUMED]
- **Phase gate:** Record required `--grep` commands and actual `--testNamePattern` equivalents; run directed `D-WCO-03` when landed. [VERIFIED: `161-CONTEXT.md`] [VERIFIED: Phase 160 summary]

### Wave 0 Gaps

- [ ] `tests/unit/move-exdev-fallback.test.ts` for T-U-034/T-U-035. [VERIFIED: product Test Plan]
- [ ] `tests/integration/destination-lock.integration.test.ts` for T-I-014/T-I-015/T-I-016/T-I-048; add it to `tests/config/vitest.integration.config.ts`. [VERIFIED: product Test Plan] [VERIFIED: integration config]
- [ ] `tests/integration/move-exdev-fallback.integration.test.ts` for T-I-042; add it to `tests/config/vitest.integration.config.ts`. [VERIFIED: product Test Plan] [VERIFIED: integration config]
- [ ] `tests/scenarios/directed/testcases/test_copy_destination_race.py` for T-S-003 / D-WCO-03 and a `DIRECTED_COVERAGE.md` row if required by the scenario conventions. [VERIFIED: product Test Plan] [VERIFIED: directed docs]
- [ ] REQ-008 code-comment table in implementation files or one shared comment near the tool lock sites. [VERIFIED: `161-CONTEXT.md`]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | MCP stdio subprocess auth is outside this phase. [VERIFIED: AGENTS.md] |
| V3 Session Management | no | AGENTS.md says MCP is stateless and server-side session state must not be added. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve existing vault path validation and plugin read-only folder warning behavior; do not add bypass paths. [VERIFIED: `write.ts`, `copy.ts`, `move.ts`] |
| V5 Input Validation | yes | Use existing Zod schemas and `validateVaultPath` before lock acquisition. [VERIFIED: codebase grep] |
| V6 Cryptography | no | No new cryptography; existing SHA-256 content hashing in `writeVaultFile` is not an auth/security primitive. [VERIFIED: `src/storage/vault-write.ts`] |

### Known Threat Patterns for TypeScript MCP Filesystem Writes

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Destination overwrite race | Tampering | Destination per-file lock plus inside-lock existence check. [VERIFIED: product Requirements §6.1.8] |
| Deadlock from multi-lock acquisition | Denial of Service | Sorted canonical lock acquisition through `withDocumentLocks`. [VERIFIED: `src/services/document-lock.ts`] |
| Torn destination after cross-device move | Tampering | `writeVaultFile` temp-write/fsync/rename/dir-fsync and unlink source only after commit. [VERIFIED: product Requirements §6.4.3] |
| Path traversal to lock/write outside vault | Elevation of Privilege | Existing `validateVaultPath` and canonical path derivation. [VERIFIED: codebase grep] |
| Advisory lock pooler mismatch | Tampering/DoS | Startup self-test and session-capable DB gating for integration evidence. [VERIFIED: Phase 158 summaries] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/161-destination-locks-exdev-fallback/161-CONTEXT.md` - locked decisions, phase scope, required tests. [VERIFIED: local file]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` - REQ-008, REQ-022, INV-09, Phase 7 scope. [VERIFIED: local file]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` - T-U-034/T-U-035/T-I-014/T-I-016/T-I-042/T-I-048/T-S-003. [VERIFIED: local file]
- `src/services/document-lock.ts` - canonical lock facade, sorted entries, shared directory locks, test exports. [VERIFIED: codebase grep]
- `src/mcp/tools/documents/write.ts`, `copy.ts`, `move.ts` - current call sites and EXDEV fallback. [VERIFIED: codebase grep]
- `src/storage/vault-write.ts` - durable atomic write primitive. [VERIFIED: codebase grep]
- Context7 `/websites/nodejs_latest-v20_x` - Node fs `rename` and `FileHandle.sync` API docs. [CITED: Context7 `/websites/nodejs_latest-v20_x`]

### Secondary (MEDIUM confidence)

- Phase 156/158/159/160 summaries - shipped behavior and validation caveats. [VERIFIED: local summaries]
- `tests/scenarios/directed/WRITING_SCENARIOS.md` - directed scenario conventions and `enable_locking`. [VERIFIED: local file]
- `tests/helpers/test-env.ts` and `tests/helpers/pg-locks.ts` - session-capable DB gating and advisory lock observation helpers. [VERIFIED: local file]

### Tertiary (LOW confidence)

- Assumptions around Python thread/future safety in the directed MCP client. [ASSUMED]
- Recommendation to add a scoped EXDEV detection helper rather than only adjusting tests. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing project stack and no new packages. [VERIFIED: package.json]
- Architecture: HIGH - current code and canonical requirements align on facade boundaries. [VERIFIED: codebase grep] [VERIFIED: product docs]
- Pitfalls: MEDIUM - test strategy is clear, but directed scenario concurrency and current DB session capability may need executor validation. [ASSUMED]

**Research date:** 2026-05-27  
**Valid until:** 2026-06-03 for test/tooling details; core architecture valid through this milestone unless Phase 162 changes lock contracts. [ASSUMED]
