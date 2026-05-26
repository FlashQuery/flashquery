# Phase 156: Atomic + Durable Write Primitive Consolidation - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Source:** User-supplied product requirements and test plan

<domain>
## Phase Boundary

Phase 156 delivers the single durable vault-write primitive for REQ-020 and REQ-021.
Users must never see torn vault files, and failed vault writes must surface as
caller-visible errors instead of being swallowed.

This phase is not responsible for native Postgres advisory locks, lock-table
retirement, full canonical lock-key derivation, folder locks, destination locks,
EXDEV fallback, or version-token preconditions. It must leave clear hooks for
those later phases, but the executable work here is the durable atomic write
primitive and migration of existing vault write paths onto it.
</domain>

<decisions>
## Implementation Decisions

### Canonical Inputs
- Downstream planning, implementation, and verification agents MUST read the
  supplied product requirements and test plan before asking scope questions.
- Requirements source:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
- Test plan source:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`

### Locked Scope
- Implement REQ-020 and REQ-021 only.
- Create a single primitive, recommended as `src/storage/vault-write.ts`, that
  writes bytes through a unique temp file in the destination directory, fsyncs
  the temp file, renames it into place, fsyncs the containing directory, and
  returns the SHA-256 hash of the committed bytes.
- Route existing vault-write paths through the primitive:
  `VaultManager.writeMarkdown`, scanner/frontmatter repair, document resolver
  repair writes, `atomicWriteFrontmatter`, and plugin reconciliation writes.
- Remove the current silent error swallowing in `atomicWriteFrontmatter`; failed
  write, fsync, or rename operations must propagate.
- Update `cleanStaleTempFiles()` to sweep the new unique temp-name pattern.
- Add an explicit write-path inventory/audit artifact or summary section that
  enumerates every `writeFile`, `appendFile`, and `rename` touching vault paths
  and records whether it routes through `writeVaultFile`.

### Deferred / Out of Scope
- Phase 158 owns native Postgres advisory locks and retirement of
  `fqc_write_locks`.
- Phase 159 owns full canonical key derivation and lock timeout semantics.
- Phase 160 owns shared/exclusive folder locks.
- Phase 161 owns destination locks and EXDEV fallback durability.
- Phase 162 owns `version_token` response/precondition semantics, though this
  phase's primitive must return `contentHash` so REQ-014 can build on it.

### the agent's Discretion
- The primitive may accept `Buffer` and `string` content, provided hashing uses
  the exact bytes written.
- Test-only injection points are acceptable when they keep production behavior
  simple and make failure, fsync, rename, and macOS durable-flush paths
  deterministic to test.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Requirements
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md` - Defines REQ-020, REQ-021, invariants INV-01 through INV-03, the Phase 2 implementation slice, and the current write-path inventory.
- `.planning/REQUIREMENTS.md` - Repo-local active copy of the v3.9 requirements.
- `.planning/ROADMAP.md` - Phase 156 goal, dependencies, success criteria, and test gate.

### Test Plan
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md` - Defines Test Plan §4.4.1 and §4.4.2, including T-U-028 through T-U-033 and T-I-039 through T-I-041.

### Prior Phase Context
- `.planning/phases/155-per-file-tier-1-live-defect-close/155-RESEARCH.md` - Documents Phase 155 lock facade boundaries and deferred durable-write scope.
- `.planning/phases/155-per-file-tier-1-live-defect-close/155-01-PLAN.md` - Shows established PLAN.md format and downstream-doc handoff pattern.
- `.planning/phases/155-per-file-tier-1-live-defect-close/155-02-PLAN.md` - Documents current document/compound lock migration expectations that Phase 156 must preserve.
- `.planning/phases/155-per-file-tier-1-live-defect-close/155-03-PLAN.md` - Shows final evidence and summary expectations for this milestone.
- `.planning/phases/155-per-file-tier-1-live-defect-close/155-REVIEW.md` - Records Phase 155 gap analysis findings and lock-contention fixes that Phase 156 must not regress.

### Relevant Code
- `src/storage/vault.ts` - Current temp-write + rename implementation and stale-temp cleanup.
- `src/utils/frontmatter.ts` - Current `atomicWriteFrontmatter` silent failure path that must be removed.
- `src/mcp/utils/document-resolver-primitives.ts` - Private markdown write helper used by targeted scan/repair flows.
- `src/services/scanner.ts` - Scanner frontmatter repair path; preserve zero-write-on-unchanged-files behavior.
- `src/services/plugin-reconciliation.ts` - Plugin reconciliation frontmatter write caller.
- `src/mcp/tools/documents/write.ts` - Representative MCP document write path that must continue to coordinate with Phase 155 locks.
- `src/mcp/tools/documents/archive.ts` and `src/mcp/tools/documents/remove.ts` - Phase 155 gap fixes map per-item `LockTimeoutError` to expected `conflict` / `lock_contention` envelopes; Phase 156 write-path migration must preserve these response shapes.
- `tests/unit/document-batch-lock-contention.test.ts` - Regression coverage for archive/remove lock contention envelopes.
- `tests/integration/vault-write-coherency-phase155-helpers.ts` - Fresh integration harness for Phase 155 vault-write coherency tests; Phase 156 integration routing tests may reuse its helper patterns if compatible.
- `src/mcp/utils/document-output.ts` - Later REQ-014 consumer of the primitive's returned content hash.
</canonical_refs>

<specifics>
## Specific Ideas

- Test Plan §4.4.1 requires:
  - T-U-028: `writeVaultFile` returns the SHA-256 of the bytes written.
  - T-U-029: simulated `writeFile` failure surfaces as a thrown error.
  - T-U-030: static check that vault writes do not bypass `writeVaultFile`.
  - T-I-039: `atomicWriteFrontmatter` propagates write errors.
  - T-I-040: representative MCP/tool writes originate from `writeVaultFile`.
- Test Plan §4.4.2 requires:
  - T-U-031: write/temp fsync/rename/dir fsync/close order.
  - T-U-032: unique temp filenames per call.
  - T-U-033: macOS durable flush behavior is intentionally handled or documented.
  - T-I-041: stale temp cleanup recognizes the unique-name pattern.
- Required evidence from ROADMAP:
  - `npm test -- tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts tests/unit/single-write-primitive.test.ts tests/unit/document-batch-lock-contention.test.ts`
  - `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/vault-write-durable.integration.test.ts`
</specifics>

<deferred>
## Deferred Ideas

- Do not remove `fqc_write_locks` or `flashquery unlock` in this phase.
- Do not implement full advisory lock Tier 2.
- Do not implement destination-path locks or EXDEV fallback changes.
- Do not add version-token schema changes, conflict envelopes, or batch contracts.
- Do not change scanner behavior beyond routing actual repair writes through the durable primitive; unchanged-file scans must remain write-free.
</deferred>

---

*Phase: 156-atomic-durable-write-primitive-consolidation*
*Context gathered: 2026-05-26 from supplied product docs*
