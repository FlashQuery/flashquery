# Phase 156: Atomic + Durable Write Primitive Consolidation - Research

**Researched:** 2026-05-26  
**Domain:** Node.js filesystem durability, FlashQuery vault write consolidation  
**Confidence:** HIGH for scope and call-site inventory; MEDIUM for macOS full-flush implementation detail

## User Constraints

### Locked Decisions

#### Canonical Inputs
- Downstream planning, implementation, checker, and verification agents MUST read these product docs before asking scope questions. [VERIFIED: `156-CONTEXT.md`]
- Requirements source: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` [VERIFIED: `156-CONTEXT.md`]
- Test plan source: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` [VERIFIED: `156-CONTEXT.md`]

#### Locked Scope
- Implement REQ-020 and REQ-021 only. [VERIFIED: `156-CONTEXT.md`, `.planning/ROADMAP.md`]
- Create a single primitive, recommended as `src/storage/vault-write.ts`, that writes bytes through a unique temp file in the destination directory, fsyncs the temp file, renames it into place, fsyncs the containing directory, and returns the SHA-256 hash of the committed bytes. [VERIFIED: `156-CONTEXT.md`, product Requirements §6.4]
- Route existing vault-write paths through the primitive: `VaultManager.writeMarkdown`, scanner/frontmatter repair, document resolver repair writes, `atomicWriteFrontmatter`, and plugin reconciliation writes. [VERIFIED: `156-CONTEXT.md`, codebase grep]
- Remove silent error swallowing in `atomicWriteFrontmatter`; failed write, fsync, or rename operations must propagate. [VERIFIED: `156-CONTEXT.md`, `src/utils/frontmatter.ts`]
- Update `cleanStaleTempFiles()` to sweep the new unique temp-name pattern. [VERIFIED: `156-CONTEXT.md`, `src/storage/vault.ts`]
- Add an explicit write-path inventory/audit artifact or summary section enumerating every `writeFile`, `appendFile`, and `rename` touching vault paths and whether it routes through `writeVaultFile`. [VERIFIED: `156-CONTEXT.md`, product Requirements §6.4]

### the agent's Discretion
- The primitive may accept `Buffer` and `string` content, provided hashing uses the exact bytes written. [VERIFIED: `156-CONTEXT.md`]
- Test-only injection points are acceptable when they keep production behavior simple and make failure, fsync, rename, and macOS durable-flush paths deterministic to test. [VERIFIED: `156-CONTEXT.md`]

### Deferred Ideas (OUT OF SCOPE)
- Do not implement Tier 2 advisory locks, lock-table retirement, full canonical key derivation, folder locks, destination locks, EXDEV fallback completeness, version-token schemas, conflict envelopes, or batch contracts. [VERIFIED: `156-CONTEXT.md`, `.planning/ROADMAP.md`]
- Phase 162 owns `version_token` response/precondition semantics; this phase only returns `contentHash` from `writeVaultFile` as a later hook. [VERIFIED: `156-CONTEXT.md`, product Requirements §8.4]

## Summary

Phase 156 should create one `writeVaultFile(absPath, content, options?)` primitive and route all current vault-content write helpers through it. [VERIFIED: product Requirements §6.4, codebase grep] The durable sequence should be `open/write temp -> filehandle.sync() -> close -> rename(temp, dest) -> open containing directory -> dirHandle.sync() -> close`, with temp cleanup on error best-effort but error propagation to the caller unchanged. [CITED: Context7 `/websites/nodejs_latest-v20_x`; VERIFIED: product Requirements §6.4]

The highest-risk planning item is macOS `F_FULLFSYNC`: Apple documents that plain `fsync()` may not force drive cache flushes, while Node.js documents `filehandle.sync()` but does not document an exposed `F_FULLFSYNC` API in the Node v20 fs docs retrieved by Context7. [CITED: Apple fsync(2) man page; CITED: Context7 `/websites/nodejs_latest-v20_x`] Plan a small injectable `durableFileSync(fileHandle)` adapter so T-U-033 can assert the macOS branch, and add a checkpoint to decide whether this phase accepts documented `filehandle.sync()` fallback or introduces a native/platform adapter later. [ASSUMED]

**Primary recommendation:** Implement `src/storage/vault-write.ts` with dependency injection for fs operations and durable flush, then migrate `vault.ts`, `frontmatter.ts`, `document-resolver-primitives.ts`, scanner repair callers through those helpers, and add the static write-path audit as a first-class test/summary artifact. [VERIFIED: codebase grep; ASSUMED planning shape]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >=20, TypeScript strict mode, ESM only; do not use CommonJS. [VERIFIED: `AGENTS.md`, `package.json`]
- FlashQuery is CLI + MCP only; do not build a web UI or server-side session state. [VERIFIED: `AGENTS.md`]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: `AGENTS.md`]
- Use async/await throughout; module-boundary failures should return typed errors or be converted by MCP handlers. [VERIFIED: `AGENTS.md`]
- MCP tools return `{ content: [{ type: "text", text: "..." }] }`; on unexpected handler failures use `isError: true`. [VERIFIED: `AGENTS.md`]
- Use Zod for external input validation. [VERIFIED: `AGENTS.md`]
- Tests are Vitest unit tests under `tests/unit` and integration tests under `tests/integration`; integration tests require `.env.test` and skip when incomplete. [VERIFIED: `AGENTS.md`, `tests/helpers/test-env.ts`]
- Do not use `npm link` for local development. [VERIFIED: `AGENTS.md`]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-020 | All vault writes route through one durable atomic write primitive and errors surface. | Current direct vault writes are in `src/storage/vault.ts`, `src/utils/frontmatter.ts`, `src/mcp/utils/document-resolver-primitives.ts`, and `src/mcp/tools/documents/move.ts`; plan migration plus static audit. [VERIFIED: codebase grep] |
| REQ-021 | Atomic + durable sequence with unique temp names, temp fsync, rename, directory fsync, macOS full-flush handling, and stale-temp cleanup. | Use Node `FileHandle` APIs and `rename`; update `cleanStaleTempFiles` for `.fqc-tmp-${pid}-${counter}`. [CITED: Context7 `/websites/nodejs_latest-v20_x`; VERIFIED: product Requirements §6.4] |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Durable vault file commit | Filesystem | API / Backend | Atomic rename and fsync are filesystem responsibilities; FlashQuery API code owns sequencing and error surfacing. [VERIFIED: product Requirements §6.4] |
| Write primitive API | API / Backend | Filesystem | Callers should use one storage helper, not duplicate temp-write logic. [VERIFIED: codebase grep] |
| Content hash hook | API / Backend | Filesystem | `contentHash` must hash the exact bytes passed to the primitive and returned for later REQ-014 use. [VERIFIED: product Requirements §7.5] |
| MCP error visibility | API / Backend | MCP transport | Low-level errors propagate out of helpers; handlers convert to existing MCP response patterns. [VERIFIED: AGENTS.md, codebase grep] |
| Stale temp recovery | API / Backend | Filesystem | Startup calls `cleanStaleTempFiles(config.instance.vault.path)` after vault init. [VERIFIED: `dist/index.js.map`, source grep] |

## Standard Stack

No new external package should be installed for Phase 156 unless the macOS `F_FULLFSYNC` checkpoint explicitly authorizes a native adapter. [ASSUMED]

### Core

| Library/API | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Node.js `node:fs/promises` | Project requires >=20; local v24.7.0 | `open`, `FileHandle.writeFile`, `FileHandle.sync`, `FileHandle.close`, `rename` | Built-in API; Node docs define `FileHandle`, `sync`, `close`, and `rename` behavior. [VERIFIED: `package.json`; CITED: Context7 `/websites/nodejs_latest-v20_x`] |
| Node.js `node:crypto` | Built-in | SHA-256 hash of committed bytes | Existing code already uses `createHash('sha256')` for content hashes. [VERIFIED: codebase grep] |
| Vitest | 4.1.1 in `package.json` | Unit/integration tests | Existing project framework and configured scripts. [VERIFIED: `package.json`, test configs] |

### Supporting

| Library/API | Version | Purpose | When to Use |
|-------------|---------|---------|-------------|
| `gray-matter` | 4.0.3 in `package.json` | Serialize markdown frontmatter | Existing write helpers use it; keep serialization behavior while changing commit primitive. [VERIFIED: `package.json`, codebase grep] |
| `src/services/document-lock.ts` | Phase 155 local module | Existing per-file lock facade | Callers may already be inside `withDocumentLock`; Phase 156 should not expand lock scope beyond using the existing call paths. [VERIFIED: Phase 155 plans, codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node built-ins only | `fs-ext` native package for `fcntl` | Could expose platform fcntl calls, but it adds a native dependency and was not confirmed via official docs in this session; package name remains `[ASSUMED]` and should not be planned without human approval. [ASSUMED; CITED: npm package page only] |
| Returning only `void` from writes | Return `{ contentHash }` | Returning the hash is required as the REQ-014 hook. [VERIFIED: product Requirements §7.5] |
| Re-reading file after commit to hash | Hash exact input bytes before write | Requirement says hash bytes actually committed; if the primitive writes exactly one normalized `Buffer`, hashing that buffer avoids encoding drift. [VERIFIED: product Requirements §7.5; ASSUMED implementation detail] |

**Installation:** none. [VERIFIED: `package.json`, phase scope]

## Package Legitimacy Audit

No new external package install is recommended for this phase, so the package legitimacy gate is not applicable. [VERIFIED: phase scope, `package.json`]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | — | No install |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no package recommendation]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no package recommendation]

## Current Write-Path Inventory

| Path | Current Write | Phase 156 Action |
|------|---------------|------------------|
| `src/storage/vault.ts` | `writeMarkdown` writes `<abs>.fqc-tmp` then `rename`; `cleanStaleTempFiles` only removes names ending `.fqc-tmp`. [VERIFIED: codebase grep] | Delegate to `writeVaultFile`; update cleanup to also remove `.fqc-tmp-${pid}-${counter}`. |
| `src/utils/frontmatter.ts` | `atomicWriteFrontmatter` writes fixed temp, renames, catches every error, logs debug, and returns. [VERIFIED: codebase grep] | Delegate to `writeVaultFile`; remove catch-and-swallow so caller sees failure. |
| `src/mcp/utils/document-resolver-primitives.ts` | Private `writeMarkdownFile` writes fixed temp then rename for targeted scan/repair. [VERIFIED: codebase grep] | Delete helper or rewrite as serialization wrapper returning `writeVaultFile` result. |
| `src/services/scanner.ts` | `repairFrontmatter` calls `vaultManager.writeMarkdown` inside `withDocumentLock`. [VERIFIED: codebase grep] | No direct scanner algorithm change; inherited durable behavior via `vaultManager.writeMarkdown`. |
| `src/services/plugin-reconciliation.ts` | Calls `atomicWriteFrontmatter`. [VERIFIED: codebase grep] | Inherits surfaced errors; ensure no caller catches and swallows them silently. |
| `src/mcp/tools/documents/move.ts` | Primary path uses `rename`; EXDEV fallback reads source, writes destination, stats, unlinks source. [VERIFIED: codebase grep] | Important boundary: REQ-022/Phase 161 owns EXDEV fallback completeness. If touched in Phase 156, only delegate direct destination write to `writeVaultFile` without claiming full destination-lock or EXDEV acceptance. [VERIFIED: `156-CONTEXT.md`; ASSUMED planning caution] |
| `dist/` | Built artifact still contains old `.fqc-tmp`/frontmatter code. [VERIFIED: local grep] | Run `npm run build` after source changes; do not edit `dist` manually. |

## Architecture Patterns

### System Architecture Diagram

```text
MCP/document/scanner/plugin write caller
  -> existing path validation + Phase-155 lock facade where already present
  -> serializer (gray-matter for markdown/frontmatter)
  -> writeVaultFile(absPath, Buffer|string)
       -> normalize content to exact Buffer
       -> contentHash = sha256(buffer)
       -> mkdir(parent)
       -> unique temp in same directory
       -> open temp for write
       -> write buffer
       -> durableFileSync(temp handle)
       -> close temp handle
       -> rename(temp, destination)
       -> open destination directory
       -> sync directory handle
       -> close directory handle
       -> return { contentHash }
  -> caller updates DB / response using existing behavior or later REQ-014 hook
```

### Recommended Project Structure

```text
src/
├── storage/
│   ├── vault-write.ts    # new durable atomic primitive and test injection hooks
│   └── vault.ts          # VaultManager delegates writeMarkdown and temp cleanup
├── utils/
│   └── frontmatter.ts    # serialization wrapper delegates to writeVaultFile
└── mcp/utils/
    └── document-resolver-primitives.ts # targeted repair delegates and can return contentHash
```

### Pattern 1: Normalize Bytes Once

**What:** Convert `string | Buffer` to a `Buffer` once, hash that buffer, and write that same buffer to the temp file. [ASSUMED]

**When to use:** Always inside `writeVaultFile`; callers that need UTF-8 should pass strings and let the primitive normalize. [ASSUMED]

```ts
// Source: product Requirements §7.5 and existing createHash usage
const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
const contentHash = createHash('sha256').update(bytes).digest('hex');
```

### Pattern 2: Close File Handles in Finally

**What:** Use `fs.promises.open()` and explicitly close `FileHandle`s in `finally`. [CITED: Context7 `/websites/nodejs_latest-v20_x`]

```ts
// Source: Node.js FileHandle docs via Context7
let handle: FileHandle | undefined;
try {
  handle = await fs.open(tempPath, 'w');
  await handle.writeFile(bytes);
  await durableFileSync(handle);
} finally {
  await handle?.close();
}
```

### Pattern 3: Testable FS Dependency

**What:** Keep production imports simple, but expose a test-only setter or internal options object for fs operations and `platform`. [ASSUMED]

**When to use:** Required for T-U-029/T-U-031/T-U-032/T-U-033 to deterministically simulate write, fsync, rename, and macOS branches. [VERIFIED: product Test Plan §4.4]

### Anti-Patterns to Avoid

- **Fixed temp filename:** Fixed `<path>.fqc-tmp` can collide under concurrent writers and is explicitly replaced by unique names. [VERIFIED: product Requirements §6.4]
- **Catching storage errors in helpers:** `atomicWriteFrontmatter` currently swallows failures; INV-03 forbids this. [VERIFIED: `src/utils/frontmatter.ts`, product Requirements]
- **Static check that bans all rename blindly:** `rename` is still valid inside `writeVaultFile` and may remain for non-vault operations; T-U-030 should distinguish vault-path writes from unrelated filesystem use. [ASSUMED]
- **Claiming REQ-022:** Cross-device move fallback is a separate phase; do not close it in this plan. [VERIFIED: `156-CONTEXT.md`, `.planning/ROADMAP.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hashing | Custom hash/checksum | Node `createHash('sha256')` | Existing project pattern and standard crypto API. [VERIFIED: codebase grep] |
| Markdown frontmatter serialization | Manual YAML string concatenation | `gray-matter` plus existing sanitizers | Existing project behavior handles frontmatter preservation and Date coercion. [VERIFIED: codebase grep] |
| Atomic file replacement | Direct `writeFile(dest)` | Temp file in destination directory plus `rename` | Direct destination writes can expose partial files; rename is the commit point. [VERIFIED: product Requirements §6.4] |
| Directory durability | Only temp file fsync | Directory handle sync after rename | Product requirement explicitly calls for directory fsync after rename. [VERIFIED: product Requirements §6.4] |
| Mac full-flush native binding | New native dependency by default | Explicit checkpoint/injectable adapter | Node docs retrieved here do not show `F_FULLFSYNC`; adding native packages needs human approval. [CITED: Context7 `/websites/nodejs_latest-v20_x`; ASSUMED] |

**Key insight:** Phase 156 is about consolidating commit semantics, not expanding concurrency semantics; use existing Phase-155 locks where already installed and keep destination/advisory/version work deferred. [VERIFIED: `156-CONTEXT.md`]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — this phase changes source write mechanics, not DB schemas or rows. Verified by REQ-020/REQ-021 scope. [VERIFIED: product Requirements §8.4] | None. |
| Live service config | None — no config key changes are in Phase 156. [VERIFIED: `156-CONTEXT.md`] | None. |
| OS-registered state | None — no launchd/systemd/pm2 registrations are affected. [ASSUMED] | None. |
| Secrets/env vars | None — no secret or env var names change. [VERIFIED: phase scope] | None. |
| Build artifacts | `dist/` exists and contains the old compiled `.fqc-tmp` and swallowed-error implementation. [VERIFIED: local grep] | Run `npm run build` after source changes if producing executable evidence; never edit `dist` manually. |

## Common Pitfalls

### Pitfall 1: Hashing a Different Representation Than Was Written

**What goes wrong:** `contentHash` is computed from a string before serialization or encoding, while the primitive writes different bytes. [ASSUMED]  
**Why it happens:** Multiple helpers serialize markdown/frontmatter today. [VERIFIED: codebase grep]  
**How to avoid:** The primitive hashes its normalized `Buffer` and writes that same `Buffer`. [ASSUMED]  
**Warning signs:** Tests compare hash of expected string but do not read bytes or inspect primitive input. [ASSUMED]

### Pitfall 2: Leaking File Handles on Error

**What goes wrong:** Write or sync failure leaves temp or directory file descriptors open. [ASSUMED]  
**Why it happens:** The durable sequence adds two `FileHandle`s. [VERIFIED: product Requirements §6.4]  
**How to avoid:** Use `finally` closes for temp and directory handles. [CITED: Context7 `/websites/nodejs_latest-v20_x`]  
**Warning signs:** T-U-031 only checks happy-path order and not close-on-error. [ASSUMED]

### Pitfall 3: Directory Sync Fails on Some Platforms

**What goes wrong:** `fs.open(dir)` or `fd.sync()` may fail for directory handles on some platforms/filesystems. [ASSUMED]  
**Why it happens:** Directory fsync support is OS/filesystem-specific. [ASSUMED]  
**How to avoid:** Surface the failure per success criterion #3; do not log-and-ignore unless a platform-specific requirement explicitly says so. [VERIFIED: `.planning/ROADMAP.md`]  
**Warning signs:** Tests mock directory sync failure but expect success. [ASSUMED]

### Pitfall 4: Static Audit False Positives

**What goes wrong:** T-U-030 flags non-vault writes, test files, planning docs, or build artifacts. [ASSUMED]  
**Why it happens:** `rg "writeFile|rename"` has many legitimate matches. [VERIFIED: local grep]  
**How to avoid:** Scope the check to production source directories and maintain an allowlist with reasons. [ASSUMED]

### Pitfall 5: macOS Full-Flush Ambiguity

**What goes wrong:** The implementation claims `F_FULLFSYNC` while only calling Node `filehandle.sync()`. [ASSUMED]  
**Why it happens:** Apple documents `F_FULLFSYNC`, but Node v20 docs retrieved here only document `sync()`/`fsync`. [CITED: Apple fsync(2); CITED: Context7 `/websites/nodejs_latest-v20_x`]  
**How to avoid:** Make the macOS branch explicit and documented; gate any native dependency behind human approval. [ASSUMED]

## Code Examples

### Durable Primitive Shape

```ts
// Source: product Requirements §7.5; Node FileHandle docs via Context7
export async function writeVaultFile(
  absPath: string,
  content: Buffer | string
): Promise<{ contentHash: string }> {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const tempPath = makeTempPath(absPath);
  const dir = dirname(absPath);

  await mkdir(dir, { recursive: true });
  let file: FileHandle | undefined;
  try {
    file = await open(tempPath, 'w');
    await file.writeFile(bytes);
    await durableFileSync(file);
  } finally {
    await file?.close();
  }

  await rename(tempPath, absPath);
  await syncDirectory(dir);
  return { contentHash };
}
```

### Frontmatter Wrapper Pattern

```ts
// Source: current src/utils/frontmatter.ts behavior, changed to propagate errors
const rawContent = await readFile(absolutePath, 'utf-8');
const parsed = matter(rawContent);
const updatedContent = matter.stringify(parsed.content, mergedFrontmatter);
await writeVaultFile(absolutePath, updatedContent);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed `.fqc-tmp` then rename, no fsync | Unique temp, temp fsync, rename, directory fsync | Phase 156 target, 2026-05-26 planning | Prevents torn visible destination and improves crash durability. [VERIFIED: product Requirements §6.4] |
| `atomicWriteFrontmatter` logs debug and returns on failure | Storage failures propagate | Phase 156 target | Callers can report failed vault writes instead of silent divergence. [VERIFIED: product Requirements §6.4] |
| Helpers return `void` | Primitive returns `{ contentHash }` | Phase 156 target | Later REQ-014 can tie responses to bytes committed. [VERIFIED: product Requirements §7.5] |

**Deprecated/outdated:**
- Fixed `.fqc-tmp` helper implementations in `vault.ts`, `frontmatter.ts`, and `document-resolver-primitives.ts` are outdated after REQ-020. [VERIFIED: codebase grep]
- Swallowed frontmatter write failures are explicitly forbidden by INV-03. [VERIFIED: product Requirements]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Use one implementation wave for primitive, one migration wave, one validation/audit wave. | Summary | Plan granularity may need adjustment. |
| A2 | No new package should be installed unless macOS full-flush is explicitly approved. | Standard Stack | If strict `F_FULLFSYNC` is required now, Node built-ins may be insufficient. |
| A3 | Hashing the normalized input buffer is acceptable as "bytes actually committed." | Patterns | If writes transform bytes later, hash could mismatch disk. |
| A4 | OS-registered state is unaffected. | Runtime State Inventory | If a globally installed binary runs stale `dist`, rebuild/reinstall may be needed. |
| A5 | Directory fsync may be platform/filesystem-sensitive. | Common Pitfalls | Planner may need a platform fallback decision. |

## Open Questions (RESOLVED)

1. **How should Phase 156 satisfy macOS `F_FULLFSYNC` without a native dependency?**
   - What we know: Apple documents `F_FULLFSYNC` for stronger durability than `fsync`; Node v20 docs retrieved here document `FileHandle.sync()` but not `F_FULLFSYNC`. [CITED: Apple fsync(2); CITED: Context7 `/websites/nodejs_latest-v20_x`]
   - RESOLVED for planning: Phase 156 uses a checkpoint-gated strategy. The default execution path is an injectable `durableFileSync` adapter with a documented Node `FileHandle.sync()` fallback and an explicit/testable darwin branch. No native/platform adapter may be introduced unless the executor obtains explicit human approval and performs package legitimacy checks first. [VERIFIED: `156-01-PLAN.md`]

2. **Should the EXDEV fallback delegate to `writeVaultFile` in this phase?**
   - What we know: REQ-020 acceptance names the EXDEV branch, but `156-CONTEXT.md` says EXDEV fallback is out of scope and Phase 161 owns it. [VERIFIED: product Requirements §6.4; VERIFIED: `156-CONTEXT.md`]
   - RESOLVED for planning: Phase 156 must not claim EXDEV fallback completeness or REQ-022. Any mention in Phase 156 is limited to write-path inventory/audit labeling and deferred-boundary documentation; Phase 161 owns EXDEV fallback implementation and acceptance. [VERIFIED: `156-CONTEXT.md`; VERIFIED: `156-03-PLAN.md`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/tests/fs API | yes | v24.7.0 local; project requires >=20 | none |
| npm | scripts | yes | 11.5.1 | none |
| Vitest | unit/integration tests | yes | 4.1.1 in `package.json` | none |
| `.env.test` | integration tests | yes locally | present | tests still skip if values incomplete via `HAS_SUPABASE` |
| `gsd-sdk` | phase metadata/commit | yes | 1.42.3 | manual docs commit |
| graphify | graph context | no graph output observed | — | code grep used |

**Missing dependencies with no fallback:** none identified. [VERIFIED: local probes]  
**Missing dependencies with fallback:** graph context unavailable/empty; direct grep covered code relationships. [VERIFIED: local probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 in `package.json`. [VERIFIED: `package.json`] |
| Config file | `tests/config/vitest.unit.config.ts`; integration config `tests/config/vitest.integration.config.ts`. [VERIFIED: test config files] |
| Quick run command | `npm test -- --grep "vault-write|atomic-write|durable"` [VERIFIED: `.planning/ROADMAP.md`] |
| Full suite command | `npm run test:integration -- --grep "frontmatter-write|vault-write-durable|atomic-write"` [VERIFIED: `.planning/ROADMAP.md`] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-020 | `writeVaultFile` returns SHA-256; write failures surface; all vault writes route through primitive. | unit/integration/static | `npm test -- --grep "vault-write|single-write-primitive"`; `npm run test:integration -- --grep "atomic-write-frontmatter"` | No - Wave 0 |
| REQ-021 | Temp fsync, rename, directory fsync order; unique temp names; macOS durable branch; stale cleanup. | unit/integration | `npm test -- --grep "vault-write-durable"`; `npm run test:integration -- --grep "vault-write-durable"` | No - Wave 0 |

### Required Test IDs

| Test ID | Requirement | Planned File | Behavior |
|---------|-------------|--------------|----------|
| T-U-028 | REQ-020 | `tests/unit/vault-write-primitive.test.ts` | `writeVaultFile` returns SHA-256 of bytes. [VERIFIED: product Test Plan] |
| T-U-029 | REQ-020 | `tests/unit/vault-write-primitive.test.ts` | Simulated write failure throws/surfaces. [VERIFIED: product Test Plan] |
| T-U-030 | REQ-020 | `tests/unit/single-write-primitive.test.ts` | Static source check for no vault write bypass. [VERIFIED: product Test Plan] |
| T-U-031 | REQ-021 | `tests/unit/vault-write-durable.test.ts` | Write/sync/rename/dir-sync/close order. [VERIFIED: product Test Plan] |
| T-U-032 | REQ-021 | `tests/unit/vault-write-durable.test.ts` | Unique temp names per call. [VERIFIED: product Test Plan] |
| T-U-033 | REQ-021 | `tests/unit/vault-write-durable.test.ts` | macOS durable flush branch. [VERIFIED: product Test Plan] |
| T-I-039 | REQ-020 | `tests/integration/atomic-write-frontmatter.integration.test.ts` | Frontmatter write errors propagate. [VERIFIED: product Test Plan] |
| T-I-040 | REQ-020 | `tests/integration/atomic-write-frontmatter.integration.test.ts` | Representative MCP writes originate from primitive. [VERIFIED: product Test Plan] |
| T-I-041 | REQ-021 | `tests/integration/vault-write-durable.integration.test.ts` | Startup cleanup removes unique temp files. [VERIFIED: product Test Plan] |

### Sampling Rate

- **Per task commit:** `npm test -- --grep "vault-write|atomic-write|durable"` [VERIFIED: `.planning/ROADMAP.md`]
- **Per wave merge:** `npm run test:integration -- --grep "frontmatter-write|vault-write-durable|atomic-write"` [VERIFIED: `.planning/ROADMAP.md`]
- **Phase gate:** targeted unit and integration evidence green before `$gsd-verify-work`. [ASSUMED]

### Wave 0 Gaps

- [ ] `tests/unit/vault-write-primitive.test.ts` for T-U-028/T-U-029. [VERIFIED: product Test Plan]
- [ ] `tests/unit/vault-write-durable.test.ts` for T-U-031/T-U-032/T-U-033. [VERIFIED: product Test Plan]
- [ ] `tests/unit/single-write-primitive.test.ts` for T-U-030. [VERIFIED: product Test Plan]
- [ ] `tests/integration/atomic-write-frontmatter.integration.test.ts` for T-I-039/T-I-040; must be added to `tests/config/vitest.integration.config.ts` include list. [VERIFIED: integration config]
- [ ] `tests/integration/vault-write-durable.integration.test.ts` for T-I-041; must be added to integration include list. [VERIFIED: integration config]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface change. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Preserve existing vault path validation and plugin folder boundaries; primitive accepts absolute paths only from trusted internal callers. [VERIFIED: codebase grep; ASSUMED absolute-path contract] |
| V5 Input Validation | yes | Keep existing path validation in callers; do not make `writeVaultFile` a raw user-path API. [VERIFIED: codebase grep; ASSUMED design] |
| V6 Cryptography | yes | Use Node SHA-256 for integrity identifier only; do not hand-roll hashing. [VERIFIED: codebase grep] |

### Known Threat Patterns for Vault Writes

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Torn file visible to readers | Tampering | Temp file in same directory plus atomic `rename`. [VERIFIED: product Requirements §6.4] |
| Silent write failure causing DB/file divergence | Repudiation/Tampering | Propagate write, fsync, and rename errors to caller. [VERIFIED: product Requirements §6.4] |
| Path traversal into non-vault files | Elevation of Privilege | Existing callers must resolve/validate before passing absolute paths; static audit should not create new user-facing path entry. [VERIFIED: codebase grep; ASSUMED] |
| Stale temp files consumed by scanner/search | Availability/Integrity | Startup cleanup recognizes fixed and unique temp patterns; scanner already ignores temp-like files in historical research. [VERIFIED: `src/storage/vault.ts`; ASSUMED scanner behavior from prior docs] |

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` - REQ-020/REQ-021, invariants, Phase 2 scope. [VERIFIED: local file]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` - T-U-028 through T-U-033 and T-I-039 through T-I-041. [VERIFIED: local file]
- `.planning/phases/156-atomic-durable-write-primitive-consolidation/156-CONTEXT.md` - locked scope and deferred boundaries. [VERIFIED: local file]
- `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` - phase success criteria and repo-local requirements copy. [VERIFIED: local file]
- Context7 `/websites/nodejs_latest-v20_x` - Node `fs/promises`, `FileHandle`, `sync`, `rename`, `open`, and constants docs. [CITED: Context7]
- Apple `fsync(2)` / `fcntl(2)` documentation - macOS `F_FULLFSYNC` rationale. [CITED: developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html]

### Secondary (MEDIUM confidence)

- npm `fs-ext` package page - existence of native fcntl package only; not recommended for install. [CITED: npmjs.com/package/fs-ext]

### Tertiary (LOW confidence)

- None used for recommendations. [VERIFIED: source review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; Node/Vitest/gray-matter are already installed and documented. [VERIFIED: `package.json`; CITED: Context7]
- Architecture: HIGH - product docs and codebase agree on the write paths to consolidate. [VERIFIED: codebase grep]
- Pitfalls: MEDIUM - macOS full-flush specifics require a planner checkpoint because Node docs retrieved here do not expose `F_FULLFSYNC`. [CITED: Context7; CITED: Apple docs]

**Research date:** 2026-05-26  
**Valid until:** 2026-06-25 for phase scope; revisit macOS durability dependency decision within 7 days if implementation starts later. [ASSUMED]
