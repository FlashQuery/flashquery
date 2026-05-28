# Phase 164: Close gap: document repair and plugin reconciliation lock contract - Research

**Researched:** 2026-05-27
**Domain:** Vault write coherency, document repair, plugin reconciliation, ambient lock assertions
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01: Mandatory source documents
- Downstream agents MUST read the source requirements and source test plan listed in `<canonical_refs>` before implementation or verification.
- If this context conflicts with the source requirements or source test plan, the source documents win.

### D-02: Preserve read-lock-free `get_document`
- Pure `get_document` reads MUST NOT call `withDocumentLock`, document-lock primitives, or directory-lock helpers.
- The existing or updated `T-U-037` static/build-time check must remain green.

### D-03: Lock only the repair-write path
- `get_document` may enter the document write lock contract only when `targetedScan`/frontmatter repair will actually write to the vault file.
- The repair-write path must acquire shared ancestor directory locks and the per-file `withDocumentLock` before the write reaches `writeVaultFile`.

### D-04: Keep token/hash/disk bytes mutually consistent after repair
- After a read-triggered repair, the returned `version_token`, `fqc_documents.content_hash`, and SHA-256 of on-disk bytes MUST all match the post-repair bytes.
- The planner must preserve and extend coverage for `T-I-026`, `T-I-027`, `T-I-028`, and directed scenario `D-WCO-06` where applicable.

### D-05: Plugin reconciliation frontmatter writes use the document-path lock contract
- `src/services/plugin-reconciliation.ts` paths that call `atomicWriteFrontmatter` must acquire the document-path lock contract before the frontmatter write reaches `writeVaultFile`.
- Existing plugin coordination locks remain in place for reconciliation sequencing, but they do not replace per-document file locking.

### D-06: `writeVaultFile` stays primitive-only
- `writeVaultFile` must continue to assert ambient locks rather than acquiring document or directory locks itself.
- Callers are responsible for acquiring the correct document and ancestor directory lock contract before invoking the primitive.

### D-07: Regression coverage is part of scope
- The plan must include tests aligned to Test Plan sections 4.1.1, 4.1.7, 4.1.9, 4.2.4, 4.4.1, and 4.5.1.
- Required execution evidence includes `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts` plus focused integration coverage for token-equals-disk, atomic-write-frontmatter, and records reconciliation.

### the agent's Discretion
- Exact helper extraction, function signatures, and test-file placement are left to the implementation agent, provided they follow the existing locking and test patterns from phases 155 through 163.
- If the directed `D-WCO-06` scenario is no longer applicable because equivalent focused integration coverage supersedes it, the agent may document that reason in the plan and verification output.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- No new macro-level lock behavior.
- No change to the opt-in version-token model beyond preserving post-repair token correctness.
- No new server-side session state.
- No rewrite of the lock subsystem beyond the specific repair/reconciliation gaps in this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-001 | Per-file document writes serialize by canonical file path, not a coarse documents lock. | Existing `withDocumentLock` is the document-file facade; Phase 164 should reuse it for read-triggered repair and plugin frontmatter writes rather than adding lock primitives. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.1.1] [VERIFIED: src/services/document-lock.ts:404] |
| REQ-007 | File writes hold shared locks on ancestor directories while structural folder operations take exclusive directory locks. | Existing normal document writes compose `withAncestorDirectoryLocksShared` outside `withDocumentLock`; Phase 164 should mirror that order for repair/reconciliation writes. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.1.7] [VERIFIED: src/mcp/tools/documents/write.ts:138] |
| REQ-009 | Document-touching call sites use `withDocumentLock` / `withDocumentLocks`; lower lock primitives stay encapsulated. | The planner should add a small wrapper or call-site composition around side-effect writes, not export lower lock internals. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.1.9] [VERIFIED: src/services/document-lock.ts:404] |
| REQ-014 | `version_token`, `fqc_documents.content_hash`, and disk SHA-256 agree after every read/write path, including repair. | `targetedScan` already returns the post-write `contentHash` when it writes; the missing contract is holding locks before that write. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.2.4] [VERIFIED: src/mcp/utils/document-resolver-primitives.ts:470] |
| REQ-020 | All vault writes route through the single durable `writeVaultFile` primitive. | `writeVaultFile` asserts an ambient document lock under `FQC_LOCK_ASSERT=true` and must not start acquiring locks internally. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.4.1] [VERIFIED: src/storage/vault-write.ts:83] |
| REQ-023 | Records/memory/plugins coordination remains correct after coarse locks are retired. | Existing plugin reconciliation sequencing is separate from document-file locks; Phase 164 must add document-path locking only around vault frontmatter writes and preserve records reconciliation behavior. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1] [VERIFIED: src/services/plugin-reconciliation.ts:380] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- Use Node.js >= 20, TypeScript strict mode, ESM modules, and Vitest. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- Do not use CommonJS `require`; do not use `@modelcontextprotocol/server`; use `@modelcontextprotocol/sdk` where MCP SDK is needed. [VERIFIED: AGENTS.md]
- MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }` and use `isError: true` on errors. [VERIFIED: AGENTS.md]
- Use async/await, typed errors at module boundaries, and Zod for external input validation. [VERIFIED: AGENTS.md]
- Testing conventions: unit tests in `tests/unit`, integration tests in `tests/integration`, E2E in `tests/e2e`, and scenario tests in `tests/scenarios`. [VERIFIED: AGENTS.md]
- Do not use `npm link`; local development uses `npm run dev` or built `node dist/index.js start --config ./flashquery.yml`. [VERIFIED: AGENTS.md]

## Summary

Phase 164 is a focused lock-contract closure: the existing vault coherency primitives are already present, but two side-effect write paths need to join the same caller-owned lock contract as normal document writes. [VERIFIED: codebase grep] The read-triggered `get_document` path calls `targetedScan` when the stored hash is missing or stale; `targetedScan` can write frontmatter through `writeMarkdownFile` and then `writeVaultFile`, but the current `document-output.ts` caller does not wrap the repair write in shared ancestor directory locks plus `withDocumentLock`. [VERIFIED: src/mcp/utils/document-output.ts:437] [VERIFIED: src/mcp/utils/document-resolver-primitives.ts:472]

The second gap is plugin reconciliation: `executeReconciliationActions` writes ownership/type frontmatter via `atomicWriteFrontmatter(toAbsolutePath(doc.path), ...)`, and `atomicWriteFrontmatter` delegates to `writeVaultFile` with an optional lock config but does not acquire the document-path lock itself. [VERIFIED: src/services/plugin-reconciliation.ts:380] [VERIFIED: src/utils/frontmatter.ts:38] Existing records/plugin sequencing must stay intact; plugin coordination serialization and document-file locking solve different problems. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1]

**Primary recommendation:** Add a narrow document-write-contract wrapper for side-effect frontmatter repair/reconciliation writes: `withAncestorDirectoryLocksShared(config, absPath, () => withDocumentLock(config, absPath, () => write...))`, and keep pure `get_document` cache-hit reads lock-free. [VERIFIED: src/mcp/tools/documents/write.ts:138] [VERIFIED: tests/unit/get-document-no-lock.test.ts]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read-triggered frontmatter repair locking | API / Backend | Database / Storage | `get_document` handler resolves/reads documents in backend code, but the lock state is enforced by document-lock service plus Postgres advisory locks and `writeVaultFile`. [VERIFIED: src/mcp/tools/documents/get.ts] [VERIFIED: src/services/document-lock.ts:290] |
| Pure `get_document` read path | API / Backend | Database / Storage | Reads must stay lock-free and rely on atomic rename visibility; only the repair write branch may acquire locks. [CITED: Vault Write Coherency Locking Requirements.md INV-07] [VERIFIED: tests/unit/get-document-no-lock.test.ts] |
| Plugin reconciliation frontmatter writes | API / Backend | Database / Storage | Reconciliation logic classifies records in `src/services/plugin-reconciliation.ts`; the file mutation is a storage write that must satisfy the document-path lock contract. [VERIFIED: src/services/plugin-reconciliation.ts:365] [VERIFIED: src/utils/frontmatter.ts:52] |
| Ambient durable write assertion | Database / Storage | API / Backend | `writeVaultFile` owns durable bytes and lock assertion only; callers own lock acquisition. [VERIFIED: src/storage/vault-write.ts:83] |
| Regression verification | API / Backend | Database / Storage | Unit/static checks prove no lock on pure read and no primitive bypass; integration tests prove disk/DB/token and plugin reconciliation behavior. [CITED: Vault Write Coherency Locking Test Plan.md Sec. 4.2.4, Sec. 4.4.1, Sec. 4.5.1] |

## Standard Stack

### Core
| Library / Module | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| Node.js | >=20 required; local `v24.7.0` | Runtime for CLI/MCP server and tests. | Project engine requires Node >=20 and local runtime satisfies it. [VERIFIED: package.json] [VERIFIED: node --version] |
| TypeScript ESM | `type: module`; TypeScript `^6.0.2` | Strict ESM source and test code. | Project is ESM and AGENTS forbids CommonJS. [VERIFIED: package.json] [VERIFIED: AGENTS.md] |
| Vitest | `^4.1.1` | Unit and integration test runner. | Existing test scripts use Vitest configs for unit/integration. [VERIFIED: package.json] |
| `src/services/document-lock.ts` | local module | Per-file locks, shared/exclusive directory advisory locks, ambient lock tracking. | Existing normal document writers already use it; Phase 164 should reuse it. [VERIFIED: src/services/document-lock.ts:378] |
| `src/storage/vault-write.ts` | local module | Single durable atomic write primitive and lock assertion point. | REQ-020 requires a single primitive; current module implements `FQC_LOCK_ASSERT=true` ambient-lock assertion. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.4.1] [VERIFIED: src/storage/vault-write.ts:91] |

### Supporting
| Library / Module | Version | Purpose | When to Use |
|------------------|---------|---------|-------------|
| `gray-matter` | `^4.0.3` | Parse/stringify markdown frontmatter. | Already used by repair and `atomicWriteFrontmatter`; do not replace. [VERIFIED: package.json] [VERIFIED: src/utils/frontmatter.ts:4] |
| `pg` | `^8.21.0` | Postgres advisory-lock and plugin reconciliation SQL access. | Existing document-lock and plugin reconciliation modules rely on Postgres clients. [VERIFIED: package.json] [VERIFIED: src/services/document-lock.ts:12] |
| `@supabase/supabase-js` | `^2.106.2` | DB row updates for `fqc_documents` and plugin state. | Existing `document-output.ts` and reconciliation code use Supabase client access. [VERIFIED: package.json] [VERIFIED: src/mcp/utils/document-output.ts:18] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Caller-owned lock wrapper | Make `writeVaultFile` acquire locks internally | Rejected by locked decision D-06; primitive must remain an ambient assertion point so path-specific lock composition stays explicit. [VERIFIED: 164-CONTEXT.md] |
| Locking all `get_document` calls | Wrap the whole read flow in `withDocumentLock` | Rejected by INV-07 and D-02; cache-hit/pure reads must not acquire write locks. [CITED: Vault Write Coherency Locking Requirements.md INV-07] |
| Replacing plugin coordination with document locks | Use only `withDocumentLock` in reconciliation | Rejected by REQ-023; plugin reconciliation sequencing and document-file mutual exclusion are separate responsibilities. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1] |

**Installation:**
```bash
# No new external packages are recommended for Phase 164. [VERIFIED: package.json]
```

**Version verification:** Existing stack versions were verified from `package.json` and local runtime commands; no registry install is needed for this phase. [VERIFIED: package.json] [VERIFIED: node --version]

## Package Legitimacy Audit

No new external packages are required or recommended for Phase 164, so the package legitimacy gate has no package list to audit. [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | - | - | - | - | not applicable | Approved: no install |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
get_document request
  |
  v
resolveDocumentIdentifier -> read disk bytes -> compute SHA-256
  |
  +--> DB hash matches current bytes
  |       |
  |       v
  |   build response without document/directory locks
  |
  +--> DB hash missing/stale
          |
          v
      targetedScan decides whether frontmatterChanged
          |
          +--> no repair write needed -> return snapshot/hash without locks beyond existing scan mutex
          |
          +--> repair write needed
                  |
                  v
              shared ancestor directory locks
                  |
                  v
              withDocumentLock(file)
                  |
                  v
              writeVaultFile -> post-write hash -> response version_token + DB content_hash

plugin reconciliation
  |
  v
reconcilePluginDocuments / executeReconciliationActions
  |
  v
shouldWriteFrontmatter?
  |
  +--> no -> DB/plugin row updates only
  |
  +--> yes -> shared ancestor directory locks -> withDocumentLock(file)
                -> atomicWriteFrontmatter -> writeVaultFile
```

### Recommended Project Structure

```text
src/
|-- mcp/utils/document-output.ts              # keep pure read path lock-free; wrap only repair-write branch
|-- mcp/utils/document-resolver-primitives.ts # targetedScan repair implementation and post-write hash propagation
|-- services/document-lock.ts                 # existing lock facade; add only narrow helpers if needed
|-- services/plugin-reconciliation.ts         # wrap atomicWriteFrontmatter document writes
|-- utils/frontmatter.ts                      # frontmatter write helper; optionally accept required lockConfig
`-- storage/vault-write.ts                    # durable primitive; assertion only, no lock acquisition
tests/
|-- unit/get-document-no-lock.test.ts
|-- unit/single-write-primitive.test.ts
|-- integration/token-equals-disk.integration.test.ts
|-- integration/atomic-write-frontmatter.integration.test.ts
`-- integration/records-reconciliation.integration.test.ts
```

### Pattern 1: Normal Document Write Contract
**What:** Existing document tools wrap file writes in shared ancestor directory locks and then `withDocumentLock`. [VERIFIED: src/mcp/tools/documents/write.ts:138]
**When to use:** Any FlashQuery-mediated vault-file write, including side-effect writes that originate from read-triggered repair or plugin reconciliation. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.1.7]
**Example:**
```typescript
// Source: src/mcp/tools/documents/write.ts:138
return await withAncestorDirectoryLocksShared(config, absolutePath, async () =>
  withDocumentLock(config, absolutePath, async () => {
    // read/recompute/write using writeVaultFile downstream
  })
);
```

### Pattern 2: Primitive Assertion, Not Primitive Locking
**What:** `writeVaultFile` checks `FQC_LOCK_ASSERT=true` and throws if no ambient document lock is held. [VERIFIED: src/storage/vault-write.ts:96]
**When to use:** Tests should enable `FQC_LOCK_ASSERT=true` to expose missing lock wrappers without changing production primitive behavior. [VERIFIED: src/storage/vault-write.ts:83]
**Example:**
```typescript
// Source: src/storage/vault-write.ts:96
if (process.env.FQC_LOCK_ASSERT === 'true') {
  if (!options.lockConfig || !(await isDocumentLockHeldForPath(options.lockConfig, absPath))) {
    throw new Error(`writeVaultFile(${absPath}) called without holding withDocumentLock for that path`);
  }
}
```

### Pattern 3: Post-Repair Hash Propagation
**What:** `targetedScan` initializes snapshot hash from pre-read bytes and replaces it with `writeVaultFile`'s returned `contentHash` if a repair write occurs. [VERIFIED: src/mcp/utils/document-resolver-primitives.ts:470]
**When to use:** Preserve this path; Phase 164 should add locks around the write, not rehash in response builders. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.2.4]
**Example:**
```typescript
// Source: src/mcp/utils/document-resolver-primitives.ts:470
let snapshotContentHash = newContentHash;
if (frontmatterChanged) {
  snapshotContentHash = await writeMarkdownFile(config, resolved.absPath, parsed.data, parsed.content);
}
```

### Anti-Patterns to Avoid

- **Locking pure reads:** Do not import `document-lock` into `src/mcp/tools/documents/get.ts`; existing `T-U-037` explicitly rejects this. [VERIFIED: tests/unit/get-document-no-lock.test.ts]
- **Adding locks inside `writeVaultFile`:** This contradicts D-06 and hides lock ordering from callers. [VERIFIED: 164-CONTEXT.md]
- **Calling `atomicWriteFrontmatter` without lock context from reconciliation:** This reaches `writeVaultFile` without ambient document lock under `FQC_LOCK_ASSERT=true`. [VERIFIED: src/services/plugin-reconciliation.ts:381] [VERIFIED: src/utils/frontmatter.ts:53]
- **Using plugin coordination as a substitute for file locks:** Plugin reconciliation ordering does not protect against concurrent normal document writes to the same markdown file. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1]
- **Rehashing in `document-output.ts` after repair instead of using the primitive hash:** REQ-014 requires propagating the post-write primitive hash as the single source of truth. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.2.4]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-file mutual exclusion | New mutex maps or direct advisory-lock SQL in call sites | `withDocumentLock` / `withDocumentLocks` | Existing helper owns canonicalization, Tier 1/Tier 2 acquisition, timeout, ordering, and ambient lock tracking. [VERIFIED: src/services/document-lock.ts:404] |
| Directory coordination | New folder lock implementation | `withAncestorDirectoryLocksShared` | Existing helper derives ancestor `dir:` advisory-lock keys and shared-lock mode. [VERIFIED: src/services/document-lock.ts:378] |
| Durable writes | Direct `writeFile`, `rename`, or temp-file helpers | `writeVaultFile` via existing helpers | REQ-020 requires a single durable primitive; `T-U-030` guards bypasses. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.4.1] [VERIFIED: tests/unit/single-write-primitive.test.ts] |
| Frontmatter parsing/stringifying | Custom YAML parsing | `gray-matter` through existing `writeMarkdownFile` / `atomicWriteFrontmatter` patterns | Existing code already normalizes frontmatter through `gray-matter`; changing parser is unrelated risk. [VERIFIED: src/utils/frontmatter.ts:4] |
| Plugin sequencing | New global records/plugins coarse lock | Existing REQ-023 reconciliation coordination plus document locks only around file writes | Coarse locks were retired; records/plugin sequencing and markdown-file exclusion are separate. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1] |

**Key insight:** This phase should make bypassing impossible at the two missing call sites, not redesign locking. The implementation surface is smaller and safer if it composes the shipped helpers around the existing write calls. [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Accidentally Locking Every `get_document`
**What goes wrong:** A wrapper around `resolveAndBuildDocument` or the `get_document` handler makes all reads acquire write locks. [VERIFIED: tests/unit/get-document-no-lock.test.ts]
**Why it happens:** The repair write is nested inside a read flow, so a broad lock wrapper looks simpler. [VERIFIED: src/mcp/utils/document-output.ts:418]
**How to avoid:** Gate the lock to the branch where `targetedScan` will actually write, likely inside `targetedScan` or a new repair-write helper. [VERIFIED: src/mcp/utils/document-resolver-primitives.ts:469]
**Warning signs:** `src/mcp/tools/documents/get.ts` imports `document-lock`, or `T-U-037` fails. [VERIFIED: tests/unit/get-document-no-lock.test.ts]

### Pitfall 2: Holding File Lock Without Ancestor Directory Locks
**What goes wrong:** A repair write is serialized against same-file writers but can still race a folder rename/move. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.1.7]
**Why it happens:** The existing ambient assertion only checks document locks, not directory locks. [VERIFIED: src/storage/vault-write.ts:96]
**How to avoid:** Always compose `withAncestorDirectoryLocksShared` outside `withDocumentLock`, matching normal document write call sites. [VERIFIED: src/mcp/tools/documents/write.ts:138]
**Warning signs:** Tests pass with `FQC_LOCK_ASSERT=true` but folder-lock integration would not observe shared ancestor locks for repair/reconciliation writes. [VERIFIED: src/services/document-lock.ts:378]

### Pitfall 3: Plugin Reconciliation Lock Confusion
**What goes wrong:** The plan assumes records/plugin reconciliation coordination covers markdown frontmatter writes. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1]
**Why it happens:** `executeReconciliationActions` has DB-oriented sequencing concerns and also performs file writes. [VERIFIED: src/services/plugin-reconciliation.ts:365]
**How to avoid:** Keep existing REQ-023 behavior and add document-path locks only around `atomicWriteFrontmatter`. [VERIFIED: src/services/plugin-reconciliation.ts:380]
**Warning signs:** `records-reconciliation.integration.test.ts` changes unrelated behavior or plugin coordination tests regress. [VERIFIED: tests/integration/records-reconciliation.integration.test.ts]

### Pitfall 4: Breaking Token/Hash Consistency While Adding Locks
**What goes wrong:** The implementation re-reads or re-hashes the wrong bytes after repair and returns a stale `version_token`. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.2.4]
**Why it happens:** Adding wrappers can accidentally move the initial raw-content parse outside the authoritative write result. [VERIFIED: src/mcp/utils/document-output.ts:426]
**How to avoid:** Preserve `writeVaultFile`'s returned `contentHash` as the post-repair snapshot hash. [VERIFIED: src/mcp/utils/document-resolver-primitives.ts:472]
**Warning signs:** `T-I-026` or `T-I-027` fails. [VERIFIED: tests/integration/token-equals-disk.integration.test.ts]

### Pitfall 5: Static Single-Primitive Guard False Positives
**What goes wrong:** A mechanical helper extraction introduces new direct `writeFile` / `rename` patterns that fail `T-U-030`. [VERIFIED: tests/unit/single-write-primitive.test.ts]
**Why it happens:** The guard scans source text, so even narrow helper rewrites need to route through existing primitive calls. [VERIFIED: tests/unit/single-write-primitive.test.ts]
**How to avoid:** Keep actual bytes commits in `writeVaultFile`; wrapper helpers should only acquire locks and call existing write functions. [VERIFIED: src/storage/vault-write.ts:91]
**Warning signs:** `npm test -- tests/unit/single-write-primitive.test.ts` reports a new direct write offender. [VERIFIED: tests/unit/single-write-primitive.test.ts]

## Code Examples

Verified patterns from current source:

### Side-Effect Repair Write Wrapper
```typescript
// Source pattern: src/services/scanner.ts:1336 and src/mcp/tools/documents/write.ts:138
await withAncestorDirectoryLocksShared(config, absolutePath, async () =>
  withDocumentLock(config, absolutePath, async () => {
    const postWriteHash = await writeMarkdownFile(config, absolutePath, frontmatter, body);
    return postWriteHash;
  })
);
```

### Plugin Reconciliation Frontmatter Write Wrapper
```typescript
// Source gap: src/services/plugin-reconciliation.ts:380 currently calls atomicWriteFrontmatter directly.
await withAncestorDirectoryLocksShared(config, toAbsolutePath(doc.path), async () =>
  withDocumentLock(config, toAbsolutePath(doc.path), async () =>
    atomicWriteFrontmatter(toAbsolutePath(doc.path), {
      [FM.OWNER]: pluginId,
      [FM.TYPE]: doc.typeId,
    }, config)
  )
);
```

### Lock Assertion Test Command
```bash
# Source: 164-CONTEXT.md D-07
FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multiple write helpers and swallowed frontmatter write failures | `writeVaultFile` durable primitive returns `contentHash` and surfaces errors | Phase 156 | Phase 164 must not create another write path. [VERIFIED: 156-CONTEXT.md] [VERIFIED: src/storage/vault-write.ts:91] |
| Coarse `documents` lock / no lock for some compound paths | `withDocumentLock` keyed by canonical file path | Phase 155 | Side-effect writes should use the same helper, not old coarse locks. [VERIFIED: 164-CONTEXT.md] |
| File writes without ancestor directory coordination | `withAncestorDirectoryLocksShared` around document writes | Phase 160 | Repair/reconciliation file writes need the same shared ancestor lock envelope. [VERIFIED: 160-CONTEXT.md] [VERIFIED: src/mcp/tools/documents/write.ts:138] |
| Version token derived from read bytes even if repair changed the file | Post-write hash from `writeVaultFile` is propagated to token and DB row | Phase 162 | Lock changes must preserve `T-I-026` through `T-I-028`. [VERIFIED: 162-CONTEXT.md] [VERIFIED: tests/integration/token-equals-disk.integration.test.ts] |
| Coarse records/memory/plugins lock | Memory uses DB RPC; records/plugins use scoped coordination where needed | Phase 157 | Phase 164 should not reopen records/memory/plugin lock strategy except for file writes. [VERIFIED: 157-CONTEXT.md] |

**Deprecated/outdated:**
- `fqc_write_locks` / coarse resource locks are not the solution for this phase. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1]
- Direct write helpers outside `writeVaultFile` are guarded by `T-U-030`. [VERIFIED: tests/unit/single-write-primitive.test.ts]
- Macro-level or session-level locks are deferred and out of scope. [VERIFIED: 164-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `targetedScan` is the only `get_document` path that can perform a read-triggered vault-file repair write. [ASSUMED] | Summary / Architecture Patterns | Planner may miss another read-triggered repair call path; mitigate with `rg writeVaultFile src/mcp src/services src/utils` during Wave 0. |
| A2 | Adding a lock wrapper inside `targetedScan` or a local repair helper is safer than locking in `document-output.ts` because it can be conditional on `frontmatterChanged`. [ASSUMED] | Primary recommendation | If helper signatures make that awkward, planner can wrap only a new `repairWriteMarkdownFile` call site while preserving pure read tests. |

## Open Questions

1. **Where should the narrow wrapper live?**
   - What we know: `writeMarkdownFile` in `document-resolver-primitives.ts` is private and already returns the post-write hash. [VERIFIED: src/mcp/utils/document-resolver-primitives.ts:102]
   - What's unclear: Whether the implementation should wrap inside `writeMarkdownFile` or split a `writeMarkdownFileLocked` helper to avoid locking non-repair uses.
   - Recommendation: Prefer the smallest helper that locks only when `frontmatterChanged` is true; add a unit/static test if the branch is easy to isolate. [ASSUMED]

2. **Should `atomicWriteFrontmatter` require `lockConfig`?**
   - What we know: The helper currently accepts optional `lockConfig` and passes it to `writeVaultFile`. [VERIFIED: src/utils/frontmatter.ts:38]
   - What's unclear: Making it required may touch more tests/callers than necessary.
   - Recommendation: Keep the signature compatible, but make plugin reconciliation pass config and acquire the ambient lock before calling. [ASSUMED]

3. **Is `D-WCO-06` still required as a directed scenario?**
   - What we know: Existing integration tests cover `T-I-026` and `T-I-027` for the same repair-token regression. [VERIFIED: tests/integration/token-equals-disk.integration.test.ts]
   - What's unclear: Whether the directed scenario exists and is stable in this repo.
   - Recommendation: Planner may accept equivalent focused integration coverage only if the plan records why `D-WCO-06` is superseded, per D-07 discretion. [VERIFIED: 164-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, unit tests, integration tests | yes | v24.7.0 | Node >=20 required. [VERIFIED: node --version] |
| npm | Test scripts | yes | 11.5.1 | none needed. [VERIFIED: npm --version] |
| Python 3 | Directed scenario runner if `D-WCO-06` is used | yes | 3.12.3 | Focused Vitest integration coverage may supersede if documented. [VERIFIED: python3 --version] [VERIFIED: 164-CONTEXT.md] |
| Supabase test env | Integration tests | conditional | `.env.test` driven | Tests skip when missing/incomplete per AGENTS. [VERIFIED: AGENTS.md] |
| slopcheck | Package audit | yes | 0.6.1 | Not needed because no new packages. [VERIFIED: slopcheck --version] |

**Missing dependencies with no fallback:** none found during research. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Supabase credentials may be absent; integration tests skip gracefully when `.env.test` is missing or incomplete, but phase evidence should include real integration runs when available. [VERIFIED: AGENTS.md]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` for unit/integration; Python scenario framework for directed tests. [VERIFIED: package.json] [CITED: Vault Write Coherency Locking Test Plan.md Sec. 2] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`. [VERIFIED: package.json] |
| Quick run command | `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts` [VERIFIED: 164-CONTEXT.md] |
| Full suite command | `npm test && npm run test:integration` [VERIFIED: package.json] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-001 | Side-effect document writes use per-file document lock. | unit/integration | `FQC_LOCK_ASSERT=true npm test -- tests/unit/single-write-primitive.test.ts` plus focused integration exercising repair/reconciliation writes. | existing guard yes; focused additions Wave 0 |
| REQ-007 | Side-effect writes hold shared ancestor directory locks. | integration | `npm run test:integration -- --grep "folder-lock|atomic-write-frontmatter|token-equals-disk"` | partial existing; add/extend Wave 0 |
| REQ-009 | Side-effect writes use helper facade, not lower primitives. | unit/static | `npm test -- tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts` | existing from prior phases likely yes; verify in Wave 0 |
| REQ-014 | Repair returns post-repair token accepted by follow-up write; DB/disk/token agree. | integration | `npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts` | yes |
| REQ-020 | No vault write bypasses `writeVaultFile`; missing ambient lock fails under assertion. | unit/integration | `FQC_LOCK_ASSERT=true npm test -- tests/unit/single-write-primitive.test.ts` and `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts` | yes |
| REQ-023 | Records/plugin reconciliation behavior does not regress while file writes gain document locks. | integration | `npm run test:integration -- tests/integration/records-reconciliation.integration.test.ts` | yes |

### Sampling Rate
- **Per task commit:** `FQC_LOCK_ASSERT=true npm test -- tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts` [VERIFIED: 164-CONTEXT.md]
- **Per wave merge:** focused integration tests for `token-equals-disk`, `atomic-write-frontmatter`, and `records-reconciliation`. [VERIFIED: 164-CONTEXT.md]
- **Phase gate:** Required D-07 evidence plus any added focused repair/reconciliation lock tests green before `$gsd-verify-work`. [VERIFIED: 164-CONTEXT.md]

### Wave 0 Gaps
- [ ] Add or extend a test that proves `targetedScan` repair writes run under document lock with `FQC_LOCK_ASSERT=true`; existing token tests prove hash correctness but not necessarily ambient lock coverage. [VERIFIED: tests/integration/token-equals-disk.integration.test.ts]
- [ ] Add or extend `atomic-write-frontmatter` / plugin reconciliation coverage so reconciliation calls `atomicWriteFrontmatter` under document lock and shared ancestor locks. [VERIFIED: tests/integration/atomic-write-frontmatter.integration.test.ts] [VERIFIED: tests/integration/records-reconciliation.integration.test.ts]
- [ ] Keep `T-U-037` source guard current if implementation moves repair wrapper code near read utilities. [VERIFIED: tests/unit/get-document-no-lock.test.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth/session changes in this phase. [VERIFIED: 164-CONTEXT.md] |
| V3 Session Management | no | MCP remains stateless; no server-side session state. [VERIFIED: AGENTS.md] [VERIFIED: 164-CONTEXT.md] |
| V4 Access Control | limited | Preserve existing plugin ownership checks before reconciliation frontmatter writes. [VERIFIED: src/services/plugin-reconciliation.ts:373] |
| V5 Input Validation | limited | No new external inputs expected; existing handlers keep current Zod validation. [VERIFIED: AGENTS.md] |
| V6 Cryptography | yes | Continue using SHA-256 content hash as version token; do not invent alternate hashing. [VERIFIED: src/storage/vault-write.ts:104] |

### Known Threat Patterns for FlashQuery Vault Writes

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Lost update from side-effect write racing normal write | Tampering | Shared ancestor directory lock plus per-file `withDocumentLock` before `writeVaultFile`. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.1.7] |
| Stale version token after repair | Tampering / Repudiation | Propagate `writeVaultFile` post-write `contentHash` to response token and DB row. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.2.4] |
| Partial/torn file | Tampering | Preserve single durable temp-write/fsync/rename/dir-fsync primitive. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.4.1] |
| Plugin reconciliation double application | Tampering | Preserve REQ-023 reconciliation guard/idempotence coverage while adding file locks only where markdown is written. [CITED: Vault Write Coherency Locking Requirements.md Sec. 6.5.1] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/164-close-gap-document-repair-and-plugin-reconciliation-lock-con/164-CONTEXT.md` - locked decisions, scope, required evidence.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` - REQ-001, REQ-007, REQ-009, REQ-014, REQ-020, REQ-023, INV-02, INV-05, INV-07.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` - T-U-037, T-I-026, T-I-027, T-I-028, T-I-040, T-U-030, T-I-044, D-WCO-06.
- `AGENTS.md` - project constraints, stack, testing rules.
- Current code grep/read: `src/services/document-lock.ts`, `src/storage/vault-write.ts`, `src/mcp/utils/document-output.ts`, `src/mcp/utils/document-resolver-primitives.ts`, `src/services/plugin-reconciliation.ts`, `src/utils/frontmatter.ts`, `src/services/scanner.ts`.
- Existing tests: `tests/unit/get-document-no-lock.test.ts`, `tests/unit/single-write-primitive.test.ts`, `tests/integration/token-equals-disk.integration.test.ts`, `tests/integration/atomic-write-frontmatter.integration.test.ts`, `tests/integration/records-reconciliation.integration.test.ts`.

### Secondary (MEDIUM confidence)
- Prior phase contexts: `156-CONTEXT.md`, `157-CONTEXT.md`, `160-CONTEXT.md`, `162-CONTEXT.md` for shipped design intent and phase boundaries.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified from `package.json`, AGENTS, and local runtime commands.
- Architecture: HIGH - verified from current source code and mandatory source requirements.
- Pitfalls: HIGH - directly tied to required tests and current gap call sites.

**Research date:** 2026-05-27
**Valid until:** 2026-06-26, assuming no lock subsystem refactor lands before planning.
