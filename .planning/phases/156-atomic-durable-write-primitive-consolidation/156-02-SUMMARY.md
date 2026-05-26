---
phase: 156-atomic-durable-write-primitive-consolidation
plan: 02
subsystem: storage
tags: [vault-write, frontmatter, resolver, plugin-reconciliation, scanner]
requires:
  - phase: 156-atomic-durable-write-primitive-consolidation
    provides: writeVaultFile durable atomic write primitive
provides:
  - VaultManager.writeMarkdown delegation to writeVaultFile
  - atomicWriteFrontmatter delegation to writeVaultFile with surfaced errors
  - document resolver repair writes routed through writeVaultFile
  - stale temp cleanup support for legacy and unique temp names
affects: [vault, frontmatter, document-resolver, scanner, plugin-reconciliation]
tech-stack:
  added: []
  patterns:
    - Durable write primitive as the only normal markdown commit path
    - Unit tests mock writeVaultFile at resolver boundaries instead of fs.writeFile internals
key-files:
  created:
    - tests/integration/atomic-write-frontmatter.integration.test.ts
  modified:
    - src/storage/vault.ts
    - src/utils/frontmatter.ts
    - src/mcp/utils/document-resolver-primitives.ts
    - tests/config/vitest.integration.config.ts
    - tests/unit/resolve-document.test.ts
key-decisions:
  - "atomicWriteFrontmatter now throws filesystem/writeVaultFile errors to callers instead of logging and swallowing them."
  - "Plugin reconciliation required no local catch narrowing; its added-document path awaits atomicWriteFrontmatter and now inherits surfaced durable write failures."
patterns-established:
  - "Caller modules should preserve serialization/path validation and delegate only the filesystem commit to writeVaultFile."
requirements-completed:
  - REQ-020
  - REQ-021
duration: 18min
completed: 2026-05-26
---

# Phase 156 Plan 02: Caller Migration Summary

**VaultManager, frontmatter repair, resolver repair, scanner-inherited writes, and plugin reconciliation now route normal vault writes through writeVaultFile**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-26T17:45:00Z
- **Completed:** 2026-05-26T18:03:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Replaced `VaultManager.writeMarkdown` fixed `.fqc-tmp` write/rename logic with `writeVaultFile`.
- Replaced `atomicWriteFrontmatter` fixed-temp write/rename logic with `writeVaultFile` and removed the swallow-on-error branch.
- Replaced document resolver targeted repair writes with `writeVaultFile`.
- Updated stale temp cleanup to remove both legacy `.fqc-tmp` files and new unique `.fqc-tmp-<pid>-<counter>-<uuid>` files.
- Added T-I-039 coverage proving `atomicWriteFrontmatter` propagates durable write failures.

## Task Commits

1. **Task 156-02-01: Migrate VaultManager and stale temp cleanup** - `a98d0aa`
2. **Task 156-02-02: Migrate frontmatter and resolver repair writes** - `a98d0aa`
3. **Task 156-02-03: Preserve plugin reconciliation error visibility** - `a98d0aa`

**Plan metadata:** pending docs commit.

## Files Created/Modified

- `src/storage/vault.ts` - Normal markdown writes delegate to `writeVaultFile`; stale temp cleanup uses the shared temp-name recognizer.
- `src/utils/frontmatter.ts` - Frontmatter serialization delegates to `writeVaultFile` and propagates errors.
- `src/mcp/utils/document-resolver-primitives.ts` - Targeted repair writes delegate to `writeVaultFile`.
- `tests/integration/atomic-write-frontmatter.integration.test.ts` - T-I-039 failure propagation coverage.
- `tests/config/vitest.integration.config.ts` - Includes the new integration file.
- `tests/unit/resolve-document.test.ts` - Mocks the durable primitive boundary for resolver unit assertions.

## Decisions Made

- Plugin reconciliation already awaited `atomicWriteFrontmatter` without a local swallow/catch path. After the wrapper migration, the call path is:
  `reconcilePluginData(...)` -> `atomicWriteFrontmatter(...)` -> `writeVaultFile(...)`.
- Existing `moveMarkdownToTrash` EXDEV fallback remains intentionally deferred to Phase 161 / REQ-022.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated resolver unit mock boundary**
- **Found during:** Task 156-02-02 verification
- **Issue:** `resolve-document.test.ts` asserted the old private `fs.writeFile` implementation after resolver repair writes moved to `writeVaultFile`.
- **Fix:** Mocked `src/storage/vault-write.ts` and asserted serialized markdown at the durable primitive boundary.
- **Files modified:** `tests/unit/resolve-document.test.ts`
- **Verification:** Targeted resolver test passed, then full caller migration unit set passed.
- **Committed in:** `a98d0aa`

---

**Total deviations:** 1 auto-fixed blocking test-boundary update.
**Impact on plan:** No scope expansion; unit tests now match the new durable primitive contract.

## Issues Encountered

- The first T-I-039 RED run hit an uninitialized logger before the intended assertion; the test now initializes the logger, and RED correctly showed `atomicWriteFrontmatter` resolving instead of rejecting before the implementation change.

## Verification

- `npm run test:integration -- tests/integration/atomic-write-frontmatter.integration.test.ts` - passed.
- `npm test -- tests/unit/vault.test.ts tests/unit/scanner.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/vault-write-primitive.test.ts tests/unit/vault-write-durable.test.ts tests/unit/document-batch-lock-contention.test.ts tests/unit/resolve-document.test.ts` - passed, 174 tests.
- `npm run typecheck` - passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 156-03 static guard, representative routing evidence, stale unique-temp integration coverage, and final write-path inventory.

## Self-Check: PASSED

- Key files exist on disk.
- `atomicWriteFrontmatter` no longer swallows write failures.
- Caller migration stayed within REQ-020/REQ-021 and did not implement REQ-022 EXDEV fallback completeness.

---
*Phase: 156-atomic-durable-write-primitive-consolidation*
*Completed: 2026-05-26*
