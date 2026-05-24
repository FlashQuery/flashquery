# Phase 149 Validation

**Status:** Complete  
**Created:** 2026-05-24  
**Updated:** 2026-05-24  
**Purpose:** Record final evidence for REQ-010 and REQ-011 cycle remediation.

## Policy

Phase 149 uses a targeted cycle gate. The passing automated gate is `npm test -- tests/unit/circular-deps.test.ts`, which must assert absence of the REQ-010 and REQ-011 forbidden cycle fragments.

Raw madge output from `npx --yes madge@8.0.0 src --extensions ts --circular` is required as evidence, but it is non-gating unless the project deliberately adopts a broader zero-cycle policy. If unrelated pre-existing cycles remain and raw madge exits nonzero, Plan 149-04 must record concise output and confirm the targeted test passed.

## Post-Phase 148 Gap-Fix Refresh

Reviewed after commit `d4ae221` (`Fix MCP shutdown registry cleanup`). That commit touches only `src/mcp/server.ts`, `src/server/shutdown.ts`, and `tests/integration/server/shutdown-mcp-drain.test.ts`.

Current Phase 149 assumptions still hold:

- REQ-010 document/plugin helper imports remain in scope: `src/services/scanner.ts`, `src/services/plugin-reconciliation.ts`, and `src/mcp/utils/resolve-document.ts` still import shared helpers from `src/mcp/tools/documents.ts`.
- REQ-011 macro helper imports remain in scope: macro helpers still import runtime types/errors from `src/macro/evaluator.ts`.
- `npx --yes madge@8.0.0 src --extensions ts --circular` still reports 42 cycles, including the same Phase 149 document/plugin and macro target clusters. The `mcp/server.ts > server/shutdown.ts` cycle remains unrelated Phase 148 lifecycle surface and is not a Phase 149 pass/fail target.

## Required Evidence

| Test ID | Required command/evidence | Status |
|---|---|---|
| T-U-021 | `npm test -- tests/unit/document-tools.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/resolve-document.test.ts tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts tests/unit/macro-cancellation.test.ts tests/unit/circular-deps.test.ts`; final `npm test` | Passed: 7 files, 129 tests; final full unit suite passed 145 files, 1986 tests |
| T-U-022 | `npm test -- tests/unit/circular-deps.test.ts` proves REQ-010 forbidden fragments are absent | Passed: 1 file, 2 tests |
| T-I-012 | `.env.test` direct Vitest command for legacy files excluded by integration config | Passed: 2 files, 11 tests; 1 file, 10 tests skipped |
| T-U-023 | Focused macro unit/helper tests from Plans 149-02 and 149-03; final `npm test` | Passed: 12 files, 178 tests; final full unit suite passed 145 files, 1986 tests |
| T-U-024 | `npm test -- tests/unit/circular-deps.test.ts` proves REQ-011 forbidden fragments are absent | Passed: 1 file, 2 tests |
| T-U-025 | `npm run test:macro-framework` | Passed: 1 file, 518 tests |
| Typecheck | `npm run typecheck` | Passed |
| Build | `npm run build` | Passed |
| Raw cycle evidence | `npx --yes madge@8.0.0 src --extensions ts --circular` captured as non-gating evidence | Evidence captured: 24 unrelated cycles remain; target clusters absent |

## T-I-012 Notes

The plan's requested command:

```bash
npm run test:integration -- tests/integration/plugin-propagation.integration.test.ts tests/integration/plugin-reconciliation.integration.test.ts tests/integration/identity-resolution.test.ts
```

currently exits before running because `tests/config/vitest.integration.config.ts` has a narrow `include` list that does not include those legacy files.

Equivalent `.env.test` command used for final evidence:

```bash
DOTENV_CONFIG_PATH=.env.test node -r dotenv/config ./node_modules/vitest/vitest.mjs run --root . --dir tests/integration --globals --testTimeout 30000 --no-file-parallelism --maxWorkers 1 --exclude '.claude/**' tests/integration/plugin-propagation.integration.test.ts tests/integration/plugin-reconciliation.integration.test.ts tests/integration/identity-resolution.test.ts
```

Result: `2 passed | 1 skipped (3)` files, `11 passed | 10 skipped (21)` tests.

`tests/integration/plugin-reconciliation.integration.test.ts` remains checked in with `describe.skip('plugin-reconciliation integration', ...)`, so its 10 tests are intentionally skipped. T-I-012 runnable evidence is covered by `plugin-propagation.integration.test.ts`, `identity-resolution.test.ts`, and unit reconciliation coverage in `tests/unit/plugin-reconciliation.test.ts`. Rerun command is the direct command above.

## Raw Madge Evidence

Command:

```bash
npx --yes madge@8.0.0 src --extensions ts --circular
```

Result: exit 1, evidence-only. Madge reports 24 remaining cycles. The remaining roots are unrelated baseline clusters:

- `config/loader.ts` / `llm/*` / `embedding/*` / `storage/supabase.ts`
- `llm/reference-resolver.ts` / `mcp/utils/document-output.ts` / `mcp/utils/resolve-document.ts` / plugin services, without a return edge through `mcp/tools/documents.ts`
- `mcp/server.ts > server/shutdown.ts`

Target REQ-010 fragments involving `mcp/tools/documents.ts` with resolver/scanner/plugin reconciliation are absent.
Target REQ-011 macro helper/evaluator fragments are absent.

## Notes

An initial direct Vitest run from repo root discovered duplicate integration tests under `.claude/worktrees` and caused DB contention. That run was aborted and superseded by the constrained direct command recorded above.

Code review found four issues. Three Phase-owned items were fixed in `fdbaf0c`: live shared cancellation tokens, madge execution validation, and order-insensitive markdown listing assertions. One broader pre-existing plugin reconciliation tenant-boundary issue remains documented in `149-REVIEW.md` for a dedicated follow-up phase.
