---
phase: 125
slug: unified-search-memory-consolidation
status: planned
nyquist_compliant: true
wave_0_complete: pending
created: 2026-05-12
---

# Phase 125 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest plus Python directed/YAML scenario runners |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/write-memory.test.ts tests/unit/search.test.ts tests/unit/get-memory.test.ts tests/unit/tool-metadata.test.ts` |
| **Full suite command** | `npm run build && npm test && npm run test:integration && npm run test:e2e` plus focused directed/YAML scenario commands |
| **Estimated runtime** | ~300 seconds for focused phase gates; full suite depends on Supabase and embedding availability |

## Sampling Rate

- **After every task commit:** Run the focused unit file for the primitive being changed plus `tests/unit/tool-metadata.test.ts` when metadata changes.
- **After every plan wave:** Run focused unit + integration + E2E commands for touched tools.
- **Before `$gsd-verify-work`:** Full focused Phase 125 suite must be green, or skips must be explicitly dependency-gated.
- **Max feedback latency:** 300 seconds for focused gates.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 125-01-01 | 01 | 1 | SRCH-01..06, MEM-01..04 | — | Traceability exists before implementation and maps every requirement to five-layer evidence. | docs | `test -f .planning/phases/125-unified-search-memory-consolidation/TRACEABILITY.md` | pending | pending |
| 125-01-02 | 01 | 1 | MEM-01, MEM-02, MEM-04, SRCH-05 | T-125-01/T-125-02 | Memory schema exposes `is_latest` and `archived_at`; DDL is idempotent and backfills existing chains. | unit/schema | `npm test -- tests/unit/supabase.test.ts tests/unit/schema-migration.test.ts` | pending | pending |
| 125-02-01 | 02 | 2 | MEM-01, MEM-02 | T-125-03/T-125-04 | `write_memory` validates mode, rejects generated fields, updates latest chain atomically, and returns JSON. | unit/integration | `npm test -- tests/unit/write-memory.test.ts && npm run test:integration -- tests/integration/write-memory.integration.test.ts` | pending | pending |
| 125-02-02 | 02 | 2 | MEM-03, MEM-04 | T-125-02/T-125-05 | `get_memory` and `archive_memory` use ordered batch JSON envelopes and expected errors with `isError:false`. | unit/integration | `npm test -- tests/unit/get-memory.test.ts tests/unit/memory-tools.test.ts && npm run test:integration -- tests/integration/write-memory.integration.test.ts` | pending | pending |
| 125-03-01 | 03 | 3 | SRCH-01..06 | T-125-06/T-125-07 | `search` validates mode/list intent, resolves enabled entity types, and returns structured JSON. | unit | `npm test -- tests/unit/search.test.ts tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts` | pending | pending |
| 125-04-01 | 04 | 4 | SRCH-01..06, MEM-01..04 | T-125-06/T-125-08 | Unified search composes with write/get/archive memory and Phase 124 document write/search paths through integration/E2E paths. | integration/e2e | `npm run test:integration -- tests/integration/write-document.integration.test.ts tests/integration/search.integration.test.ts tests/integration/write-memory.integration.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | pending | pending |
| 125-05-01 | 05 | 5 | SRCH-01..06, MEM-01..04 | — | Directed and integration scenario ledgers are updated before scenario files. | scenario-ledger | `grep -n "search(" tests/scenarios/directed/DIRECTED_COVERAGE.md && grep -n "write_memory" tests/scenarios/integration/INTEGRATION_COVERAGE.md` | pending | pending |
| 125-06-01 | 06 | 6 | SRCH-01..06, MEM-01..04 | — | Final focused gates and build pass, or dependency-gated skips are documented. | final | `npm run build` plus focused phase commands | pending | pending |

*Status: pending / green / red / flaky*

## Wave 0 Requirements

- [ ] `.planning/phases/125-unified-search-memory-consolidation/TRACEABILITY.md` maps SRCH-01 through SRCH-06 and MEM-01 through MEM-04 to unit, integration, E2E, directed scenario, and integration scenario evidence.
- [ ] Memory schema migration tests prove `is_latest` and `archived_at`.
- [ ] `tests/unit/write-memory.test.ts` covers final create/update validation and JSON output.
- [ ] `tests/unit/search.test.ts` covers final search validation, merge/dedupe/sort/limit, disabled-domain behavior, and fallback semantics.
- [ ] Scenario coverage ledger updates precede Python/YAML scenario file edits.

## Manual-Only Verifications

All core phase behaviors require automated verification. Integration, E2E, and scenario commands may skip gracefully when external Supabase or embedding dependencies are unavailable; any skip must be recorded in the plan summary with the exact missing dependency.

## Validation Sign-Off

- [x] All planned tasks have automated verify commands or dependency-gated scenario commands.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all Phase 125 requirement IDs.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true` set in frontmatter.
