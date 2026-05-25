---
phase: 151-quick-localized-cleanup
plan: 01
subsystem: storage
tags: [embedding, vault, plugin-reconciliation, audit-remediation]
requires: []
provides:
  - Explicit OpenAI and OpenRouter embedding apiKey validation
  - Public VaultManager vault-relative absolute path resolver
  - Plugin reconciliation frontmatter reads through VaultManager public API
affects: [embedding, vault, plugin-reconciliation, phase-151]
tech-stack:
  added: []
  patterns:
    - Provider-specific config validation before provider construction
    - Vault-root containment checks through resolve/relative normalization
key-files:
  created: []
  modified:
    - src/embedding/provider.ts
    - src/storage/vault.ts
    - src/services/plugin-reconciliation.ts
    - tests/unit/embedding.test.ts
    - tests/unit/vault.test.ts
key-decisions:
  - "Named the new public vault API resolveVaultPath to mirror the existing resolvePath convention while making the relative-path contract explicit."
  - "Rejected vault-relative traversal by reusing the existing vault containment helper instead of adding string-only checks."
patterns-established:
  - "OpenAI-compatible embedding providers validate required apiKey synchronously at factory construction time."
  - "Plugin reconciliation resolves disk paths through VaultManager rather than concrete implementation fields."
requirements-completed:
  - REQ-001
  - REQ-002
duration: 3 min
completed: 2026-05-25
---

# Phase 151 Plan 01: Embedding and Vault Reconciliation Cleanup Summary

**Provider apiKey validation and vault-owned absolute path resolution for plugin reconciliation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-25T15:58:13Z
- **Completed:** 2026-05-25T16:00:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added synchronous OpenAI/OpenRouter apiKey validation that rejects missing, empty, and whitespace-only keys while preserving Ollama no-key construction.
- Added `VaultManager.resolveVaultPath()` with vault-root containment protection for nested vault-relative paths.
- Updated plugin reconciliation to use the public vault API instead of casting to the private `rootPath` implementation field.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement explicit embedding provider apiKey validation** - `6ccc7c0` (test), `88894be` (feat)
2. **Task 2: Add public VaultManager path API and use it in plugin reconciliation** - `130e3a5` (test), `196e9c1` (feat)

**Plan metadata:** pending in this docs commit.

## Files Created/Modified

- `src/embedding/provider.ts` - Adds provider-specific `apiKey` validation for OpenAI-compatible embedding providers.
- `src/storage/vault.ts` - Adds public `resolveVaultPath()` with vault containment enforcement.
- `src/services/plugin-reconciliation.ts` - Resolves disk reads through `vaultManager.resolveVaultPath()`.
- `tests/unit/embedding.test.ts` - Covers T-U-001, T-U-002, and T-U-003.
- `tests/unit/vault.test.ts` - Covers T-U-005 and T-U-006.

## Decisions Made

- Used lowercase provider names in missing-key errors so tests and user-facing diagnostics directly name `openai` and `openrouter`.
- Kept `resolvePath()` unchanged and added a separate method for vault-relative paths to avoid widening the existing area/project/filename contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npm run test:integration -- tests/integration/plugin-reconciliation.integration.test.ts --bail=1` did not execute because `tests/config/vitest.integration.config.ts` does not include that legacy file in its `include` list.
- Direct Vitest invocation of `tests/integration/plugin-reconciliation.integration.test.ts` completed with skipped tests because the suite is currently declared with `describe.skip`.

## Verification

- `npm test -- tests/unit/embedding.test.ts --bail=1` - passed, 27 tests.
- `npm test -- tests/unit/vault.test.ts --bail=1` - passed, 50 tests.
- `npm test -- tests/unit/embedding.test.ts tests/unit/vault.test.ts --bail=1` - passed, 77 tests.
- `! rg -n "config\\.apiKey!" src/embedding/provider.ts` - passed.
- `! rg -n "vaultManager as unknown as \\{ rootPath: string \\}" src/services/plugin-reconciliation.ts` - passed.
- `npm run test:integration -- tests/integration/plugin-reconciliation.integration.test.ts --bail=1` - blocked by integration config include list.
- `npx vitest run tests/integration/plugin-reconciliation.integration.test.ts --root . --bail=1` - completed with skipped tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 151-02 can add static guards for the forbidden REQ-001/REQ-002 patterns and continue with seeder removal, pg cleanup logging, and package metadata cleanup.

---
*Phase: 151-quick-localized-cleanup*
*Completed: 2026-05-25*
