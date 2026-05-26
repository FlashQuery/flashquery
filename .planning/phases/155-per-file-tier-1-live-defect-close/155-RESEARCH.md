# Phase 155: Per-file Tier 1 + Live-defect Close - Research

**Researched:** 2026-05-26  
**Domain:** FlashQuery vault document write locking, same-process concurrency, macro dispatch  
**Confidence:** HIGH

## User Constraints

No `155-CONTEXT.md` exists for this phase. [VERIFIED: `gsd-sdk query init.phase-op 155`]

Downstream agents MUST consult these product docs before asking scope questions: [VERIFIED: user prompt]

1. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
2. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`

Phase 155 implements REQ-001, REQ-009, REQ-010, and REQ-025. Full REQ-003 canonical key derivation remains Phase 159, and native Postgres advisory Tier 2 remains Phase 158. [VERIFIED: `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, product Requirements]

## Summary

Phase 155 should introduce a single document-lock helper module and route document mutations through it, but the helper should only make same-process locking fine-grained in this phase. [VERIFIED: `.planning/REQUIREMENTS.md` §8.3] The helper should use a bounded striped `async-mutex` Tier 1 keyed by a basic file key, then delegate the cross-process tier to the existing `src/services/write-lock.ts` table lock as a temporary pass-through. [VERIFIED: `.planning/REQUIREMENTS.md` §8.3; CITED: Context7 `/dirtyhairy/async-mutex`]

The live defect is in `src/mcp/tools/compound.ts`: `insert_doc_link` and document-side `apply_tags` read, modify, and write vault files without any lock, while `insert_in_doc` and `replace_doc_section` already use the coarse `'documents'` lock. [VERIFIED: codebase grep] The planner should prioritize wrapping those two handlers after adding the helper, then migrate existing coarse document locks in `documents/write.ts`, `archive.ts`, `remove.ts`, `copy.ts`, `move.ts`, and compound section tools. [VERIFIED: product Requirements §6.1.10, §8.3]

**Primary recommendation:** Plan one implementation wave for `src/services/document-lock.ts`, one wave for tool call-site migration and the `apply_tags`/`insert_doc_link` defect, and one wave for targeted tests/static checks. [ASSUMED]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >=20, TypeScript strict mode, ESM only; do not use CommonJS. [VERIFIED: `AGENTS.md`, `package.json`]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: `AGENTS.md`]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: `AGENTS.md`]
- MCP tool handlers should catch internally and return human-readable MCP text results; expected errors use `isError`-compatible response helpers rather than thrown exceptions across tool boundaries. [VERIFIED: `AGENTS.md`, codebase grep]
- Use Zod for external input validation. [VERIFIED: `AGENTS.md`]
- Tests: unit via `npm test`; integration via `npm run test:integration`; integration/E2E require `.env.test` and skip when incomplete. [VERIFIED: `AGENTS.md`, `tests/helpers/test-env.ts`]
- Do not use `npm link` for local development. [VERIFIED: `AGENTS.md`]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-001 | Per-file write locking replaces the global `'documents'` lock for vault file writes. | Use `withDocumentLock` around each file mutation, with same-file serialization and unrelated-file concurrency tests. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| REQ-009 | Provide a single `withDocumentLock` / `withDocumentLocks` helper. | Implement in `src/services/document-lock.ts`; do not export lower-level primitives outside that module. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| REQ-010 | Close unlocked `insert_doc_link` / `apply_tags` lost-update defect. | Wrap document read-modify-write sections and re-read inside each lock. [VERIFIED: codebase grep, product Requirements] |
| REQ-025 | `call_macro` uses called tools' per-file locks; no macro-spanning lock. | Add static checks for no lock imports/calls in `src/mcp/tools/macro.ts` and `src/macro/evaluator.ts`; update help output only. [VERIFIED: product Requirements, Test Plan] |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Same-process per-file serialization | API / Backend | Filesystem | MCP handlers perform vault mutation orchestration; filesystem only commits bytes. [VERIFIED: codebase grep] |
| Temporary cross-process pass-through | API / Backend | Database | Phase 155 keeps `fqc_write_locks` via helper internals only; real advisory locks are Phase 158. [VERIFIED: `.planning/REQUIREMENTS.md` §8.3] |
| Compound document mutation safety | API / Backend | Filesystem | `apply_tags` and `insert_doc_link` currently perform read-modify-write in tool handlers. [VERIFIED: `src/mcp/tools/compound.ts`] |
| Macro concurrency semantics | API / Backend | MCP broker | Macro evaluator dispatches tool calls; locking belongs to called tool handlers, not macro lifetime. [VERIFIED: `src/macro/dispatcher.ts`, `src/macro/registry.ts`] |

## Standard Stack

No new external package should be installed in Phase 155. [VERIFIED: `package.json`, `.planning/REQUIREMENTS.md`]

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `async-mutex` | 0.5.0 installed; npm registry latest 0.5.0, modified 2024-03-11 | Tier 1 in-process mutexes | Already a project dependency and scanner uses `Mutex`; Context7 documents `acquire()`, `runExclusive()`, `withTimeout()`. [VERIFIED: npm registry; CITED: Context7 `/dirtyhairy/async-mutex`] |
| Vitest | 4.1.1 installed; npm registry latest observed 4.1.7, modified 2026-05-20 | Unit/integration tests | Existing project test framework. [VERIFIED: `package.json`, npm registry] |

**Installation:** none. [VERIFIED: `package.json`]

## Package Legitimacy Audit

No new package install is recommended. [VERIFIED: `package.json`, phase scope]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `async-mutex` | npm | Existing dependency; latest modified 2024-03-11 | Not checked | `github.com/DirtyHairy/async-mutex` | no output from local `slopcheck install async-mutex --json` | Approved as existing dependency; no install task |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no new packages recommended]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no new packages recommended]

## Current Code Call Sites

| File | Current Behavior | Planning Action |
|------|------------------|-----------------|
| `src/services/write-lock.ts` | Exposes table-backed `acquireLock`, `releaseLock`, `isLocked`; default timeout 10s and TTL 30s. [VERIFIED: codebase grep] | Keep as internal temporary Tier 2 pass-through called only by `document-lock.ts`; do not retire in Phase 155. |
| `src/mcp/tools/documents/write.ts` | Acquires coarse `'documents'` before create/update; update re-reads at line 215 inside current coarse lock. [VERIFIED: codebase grep] | For update: resolve first enough to get path, then lock, then re-resolve/re-read inside the lock. For create: lock destination path after `validateVaultPath` and before existence/write. |
| `src/mcp/tools/documents/archive.ts` | Coarse lock wraps whole handler; batch loop processes IDs under one global lock. [VERIFIED: codebase grep] | Move lock inside per-item mutation after resolving each ID; preserve batch per-item envelopes. |
| `src/mcp/tools/documents/remove.ts` | Coarse lock wraps whole handler; archive/write/remove rollback path mutates files. [VERIFIED: codebase grep] | Lock each source document around archive + remove/move-to-trash mutation. Destination trash locking is Phase 161, so do not expand scope. |
| `src/mcp/tools/documents/copy.ts` | Coarse lock wraps source read, destination existence check, and destination write. [VERIFIED: codebase grep] | Phase 155 should lock the destination file key for the created copy enough to avoid same-process same-destination races; full destination-lock contract remains Phase 161. |
| `src/mcp/tools/documents/move.ts` | Coarse lock wraps source resolution, destination check, rename, DB update, and EXDEV fallback. [VERIFIED: codebase grep] | Use `withDocumentLocks([source, destination])` if touched; avoid refactoring EXDEV/durable semantics because Phase 161/156 own that. |
| `src/mcp/tools/compound.ts` `insert_doc_link` | No lock; each source resolves, reads, modifies frontmatter, calls `targetedScan`, writes. [VERIFIED: codebase grep] | Highest-priority defect fix: lock every source document in sorted key order and re-read inside lock. |
| `src/mcp/tools/compound.ts` `apply_tags` | No lock for document targets; memory targets update DB only. [VERIFIED: codebase grep] | Lock only document targets around read-modify-write; leave memory path alone for Phase 157. |
| `src/mcp/tools/compound.ts` `insert_in_doc`, `replace_doc_section` | Coarse `'documents'` lock around read-modify-write. [VERIFIED: codebase grep] | Migrate to `withDocumentLock` and preserve inside-lock re-read. |
| `src/services/scanner.ts` `repairFrontmatter` | Writes via `vaultManager.writeMarkdown` outside `scanMutex`. [VERIFIED: codebase grep] | Treat as adjacent risk. Product docs mention scanner per-document writes should adopt per-file lock, but Phase 155 success criteria focus document mutations; planner should include a scoped decision/checkpoint. [VERIFIED: product Requirements; ASSUMED planning boundary] |
| `src/mcp/tools/macro.ts`, `src/macro/evaluator.ts` | No direct write-lock imports found; macro dispatch calls tool functions. [VERIFIED: codebase grep] | Do not add lock imports/calls; update help text for semantics and add static guard. |

## Architecture Patterns

### Helper Shape

Use one module, `src/services/document-lock.ts`, as the only public locking facade for vault document write call sites. [VERIFIED: `.planning/REQUIREMENTS.md` §6.1.9]

```ts
// Source: product Requirements §7.1, adapted for Phase 155
export async function withDocumentLock<T>(
  config: FlashQueryConfig,
  filePath: string,
  fn: () => Promise<T>
): Promise<T>;

export async function withDocumentLocks<T>(
  config: FlashQueryConfig,
  filePaths: string[],
  fn: () => Promise<T>
): Promise<T>;
```

For Phase 155, derive a stable basic key from the validated absolute path where available, with enough scaffolding to swap in full REQ-003 realpath/case-folding later. [VERIFIED: `.planning/REQUIREMENTS.md` §8.3] Do not claim full canonical-key completion. [VERIFIED: `.planning/STATE.md`, `.planning/ROADMAP.md`]

### Lock Acquisition

`async-mutex` `acquire()` returns a release function that must be called in `finally`, and `runExclusive()` releases automatically after callback completion. [CITED: Context7 `/dirtyhairy/async-mutex`] Use explicit acquire/release if the helper must compose Tier 1 release after temporary Tier 2 release. [ASSUMED]

### System Flow

```text
MCP write tool
  -> validate input / resolve enough path context
  -> withDocumentLock(s)
      -> derive Phase-155 basic file key
      -> acquire Tier 1 striped Mutex
      -> acquire legacy write-lock table as temporary Tier 2 pass-through
      -> re-resolve or re-read current file bytes inside lock
      -> mutate vault + DB metadata
      -> release legacy pass-through
      -> release Tier 1 Mutex
  -> return existing MCP response shape
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-process async serialization | Custom queues/promises | `async-mutex` `Mutex` | Existing dependency, documented release semantics. [CITED: Context7 `/dirtyhairy/async-mutex`] |
| Macro lifetime locking | Macro-spanning lock manager | Called tool handlers' `withDocumentLock` | REQ-025 forbids macro-level locks in Phase 155. [VERIFIED: product Requirements] |
| Full canonical path/case/symlink derivation | Complete REQ-003 implementation | Basic key scaffolding only | Phase 159 owns full canonical derivation. [VERIFIED: `.planning/ROADMAP.md`] |
| Native Postgres advisory locks | New `pg_advisory_lock` tier | Existing `write-lock.ts` pass-through | Phase 158 owns native advisory locks and table retirement. [VERIFIED: `.planning/ROADMAP.md`] |

## Existing Test Patterns to Reuse

| Test | Useful Pattern | Phase 155 Use |
|------|----------------|---------------|
| `tests/integration/archive-document-lock.test.ts` | Builds `FlashQueryConfig`, registers document handlers, parses MCP text JSON, uses random instance IDs. [VERIFIED: codebase grep] | Replace held global-lock assertions with per-file same/different document concurrency checks. |
| `tests/integration/macro-write-lock.integration.test.ts` | Uses real MCP `Client` + `InMemoryTransport` and `call_macro` invoking `fq.write_document`. [VERIFIED: codebase grep] | Adapt for T-I-049/T-U-038; update away from legacy `acquireLock('documents')` assumptions. |
| `tests/unit/apply-tags.test.ts` | Static source assertions for `apply_tags` contract. [VERIFIED: codebase grep] | Add static or behavior tests proving document target uses `withDocumentLock` and memory target does not. |
| `tests/integration/write-document.integration.test.ts` | Registers document + compound tools against temp vault and Supabase, then validates file bytes and `content_hash`. [VERIFIED: codebase grep] | Extend for `apply_tags` no-lost-update and `insert_doc_link` racing `write_document`. |
| `tests/unit/scanner.test.ts` | Existing scanner tests assert `repairFrontmatter` write behavior and `runScanOnce` no-write invariants. [VERIFIED: codebase grep] | Use only if planner decides scanner repair is in Phase 155; otherwise leave for Phase 156/162. |

Required Phase 155 test IDs from product Test Plan: `T-U-001`, `T-U-002`, `T-U-016` through `T-U-019`, `T-U-038`, `T-I-001`, `T-I-002`, `T-I-017`, `T-I-018`, `T-I-049` through `T-I-051`, `T-S-001`, `T-S-004`, `T-S-008`. [VERIFIED: product Test Plan]

## Common Pitfalls

### Locking Too Early

Resolving an identifier before a lock may read stale metadata, but locking cannot happen without a path key. [VERIFIED: codebase grep] The safe pattern is: resolve enough to identify the candidate file, enter `withDocumentLock`, then re-resolve and/or re-read inside the lock before mutation. [VERIFIED: product Requirements INV-10]

### Keeping Batch Tools Under One Lock

`archive_document`, `remove_document`, `apply_tags`, and `insert_doc_link` have batch shapes. [VERIFIED: codebase grep] Holding one global lock across the whole batch preserves the current contention bug; plan per-item/per-file locking while preserving ordered result arrays. [VERIFIED: product Requirements §6.3]

### Accidentally Implementing Later Phases

Destination lock races, EXDEV fallback, durable fsync, full canonical keys, advisory locks, timeout envelopes, and version-token semantics are later phases. [VERIFIED: `.planning/ROADMAP.md`] Phase 155 can add scaffolding and static checks but should not widen acceptance criteria. [ASSUMED]

### Macro Lock Leakage

Adding `withDocumentLock` to `call_macro` would violate REQ-025 and create macro-spanning semantics users are explicitly not getting yet. [VERIFIED: product Requirements] Static checks should fail if `src/mcp/tools/macro.ts` or `src/macro/evaluator.ts` imports lock primitives. [VERIFIED: product Test Plan]

## Risk Boundaries

- **In scope:** same-process per-file Tier 1, helper API, existing document write call-site migration, live defect closure, macro no-lock guard/help text. [VERIFIED: `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`]
- **Out of scope:** replacing `fqc_write_locks`, `flashquery unlock` removal, native advisory locks, session-capability startup checks. [VERIFIED: `.planning/ROADMAP.md`]
- **Out of scope:** durable atomic primitive consolidation and write failure surfacing beyond preserving current behavior. [VERIFIED: `.planning/ROADMAP.md`]
- **Out of scope:** opt-in `version_token` / `expected_version` behavior except macro help text may mention explicit threading as future/opt-in model. [VERIFIED: product Requirements REQ-025]
- **Potential ambiguity:** scanner `repairFrontmatter` is a vault writer and product docs say scanner per-document writes should adopt per-file lock, but Phase 155 success criteria name user-facing document mutations. Planner should either include a narrow scanner lock task or add an explicit defer note. [VERIFIED: product Requirements; ASSUMED planning recommendation]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 installed; npm latest observed 4.1.7. [VERIFIED: `package.json`, npm registry] |
| Unit config | `tests/config/vitest.unit.config.ts` [VERIFIED: `package.json`] |
| Integration config | `tests/config/vitest.integration.config.ts`; skips when Supabase env is unavailable. [VERIFIED: `package.json`, `tests/helpers/test-env.ts`] |
| Quick run command | `npm test -- --grep "document-lock|with-document-lock|macro-no-lock"` [VERIFIED: `.planning/ROADMAP.md`] |
| Integration command | `npm run test:integration -- --grep "per-file|apply-tags|insert-doc-link|call-macro-per-step"` [VERIFIED: `.planning/ROADMAP.md`] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-001 | Different files do not share global lock; same file serializes. | unit/integration | `npm test -- --grep "document-lock"`; `npm run test:integration -- --grep "per-file"` | No - Wave 0 |
| REQ-009 | Helper acquires/releases, sorts multi-lock paths, hides primitives. | unit/static | `npm test -- --grep "with-document-lock|lock-helper-only"` | No - Wave 0 |
| REQ-010 | Concurrent `apply_tags` / `insert_doc_link` do not lose updates. | integration/directed | `npm run test:integration -- --grep "apply-tags|insert-doc-link"` | No - Wave 0 |
| REQ-025 | Macro has no macro-spanning lock; per-step tools lock. | unit/integration | `npm test -- --grep "macro-no-lock"`; `npm run test:integration -- --grep "call-macro-per-step"` | Partial - legacy macro lock tests exist |

### Wave 0 Gaps

- `tests/unit/document-lock-registry.test.ts` for T-U-001/T-U-002. [VERIFIED: product Test Plan]
- `tests/unit/with-document-lock.test.ts` for T-U-016 through T-U-018. [VERIFIED: product Test Plan]
- `tests/unit/lock-helper-only.test.ts` and `tests/unit/macro-no-lock-imports.test.ts` static checks. [VERIFIED: product Test Plan]
- `tests/integration/per-file-lock.test.ts`, `tests/integration/apply-tags-concurrent.integration.test.ts`, `tests/integration/insert-doc-link-race.integration.test.ts`, `tests/integration/call-macro-per-step-lock.integration.test.ts`. [VERIFIED: product Test Plan]

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth surface change. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless per AGENTS.md. [VERIFIED: `AGENTS.md`] |
| V4 Access Control | yes | Preserve existing host tool exposure and plugin read-only folder checks. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Keep existing Zod schemas and `validateVaultPath` use; lock helper must not bypass path validation. [VERIFIED: codebase grep] |
| V6 Cryptography | no | No new cryptographic primitive in Phase 155. [VERIFIED: phase scope] |

Known threat pattern: path traversal or symlink escape if lock keys are derived from unvalidated caller strings. Mitigation: validate/resolve paths with existing helpers before deriving lock paths. [VERIFIED: `src/mcp/tools/documents/write.ts`, `src/mcp/tools/documents/move.ts`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript/Vitest | yes | v24.7.0 local; project requires >=20 | none needed |
| npm | scripts/package metadata | yes | 11.5.1 | none needed |
| Supabase `.env.test` | integration tests | unknown from research | env-dependent | tests skip via `HAS_SUPABASE` |
| `gsd-sdk` | phase metadata/commit | yes | 1.42.3 | manual file write |
| graphify | graph context | disabled | n/a | code grep used |

**Missing dependencies with no fallback:** none identified. [VERIFIED: local probes]  
**Missing dependencies with fallback:** graphify disabled; direct grep/file reads covered needed relationships. [VERIFIED: graphify command]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Planner should use three implementation waves. | Summary | Plan granularity may be adjusted without affecting technical approach. |
| A2 | Use explicit acquire/release in helper if composing temporary Tier 2 pass-through. | Architecture Patterns | Could use `runExclusive`; correctness depends on release order tests. |
| A3 | Scanner repair should be a planner checkpoint rather than automatic Phase 155 work. | Risk Boundaries | Missing scanner lock could leave a same-process writer outside the new helper. |

## Open Questions

1. **Should Phase 155 include `repairFrontmatter` under `withDocumentLock`?**
   - What we know: `repairFrontmatter` writes vault files outside `scanMutex`, and product docs mention scanner per-document writes adopting per-file locks. [VERIFIED: codebase grep, product Requirements]
   - What's unclear: Phase 155 success criteria focus document mutations and live compound defects. [VERIFIED: `.planning/ROADMAP.md`]
   - Recommendation: Planner should include a small checkpoint task to decide; if included, keep it to wrapping `repairFrontmatter` writes only. [ASSUMED]

2. **How much destination locking belongs in `copy_document` / create-mode `write_document` now?**
   - What we know: Phase 161 owns destination locks, but Phase 155 includes `copy.ts`/`move.ts` call-site migration. [VERIFIED: `.planning/REQUIREMENTS.md` §8.3, §8.9]
   - What's unclear: Whether same-process destination races must be fully closed before Phase 161. [ASSUMED]
   - Recommendation: Add only enough lock-key scaffolding for current call-site migration; reserve full destination race acceptance for Phase 161. [ASSUMED]

## Sources

### Primary (HIGH confidence)

- `.planning/STATE.md` - current milestone, decisions, Phase 155 status. [VERIFIED: codebase grep]
- `.planning/ROADMAP.md` - Phase 155 scope, success criteria, test gate, later phase boundaries. [VERIFIED: codebase grep]
- `.planning/REQUIREMENTS.md` - REQ-001, REQ-009, REQ-010, REQ-025, implementation sequence. [VERIFIED: codebase grep]
- Product Requirements and Test Plan paths listed under User Constraints. [VERIFIED: user prompt, file reads]
- Context7 `/dirtyhairy/async-mutex` - Mutex acquire/release/runExclusive/withTimeout API. [CITED: Context7]

### Secondary (MEDIUM confidence)

- npm registry checks for `async-mutex` and `vitest` versions. [VERIFIED: npm registry]
- Local environment probes for Node/npm/gsd-sdk. [VERIFIED: local command]

### Tertiary (LOW confidence)

- None used for core recommendations.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new package, existing dependency/docs verified.
- Architecture: HIGH - product docs and current call sites agree.
- Pitfalls: HIGH - based on current code and explicit phase boundaries.

**Research date:** 2026-05-26  
**Valid until:** 2026-06-25
