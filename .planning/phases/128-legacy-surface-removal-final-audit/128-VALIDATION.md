---
phase: 128
slug: legacy-surface-removal-final-audit
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-12
---

# Phase 128 - Validation Strategy

> Pre-execution Nyquist validation contract for Phase 128. Final execution evidence should be appended here by the final validation plan.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration/E2E; Python scenario runners for directed and YAML integration workflows |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/config.test.ts tests/unit/compound-tools.test.ts` |
| **Full suite command** | `npm run lint && npm test && npm run test:integration && npm run test:e2e && npm run build` plus directed and YAML scenario suites |
| **Estimated runtime** | ~5 minutes focused; full preflight depends on Supabase and scenario runtime |

## Sampling Rate

- **After every task commit:** Run focused unit tests for the touched surface plus a targeted `rg` audit on the relevant legacy-name subset.
- **After every plan wave:** Run the focused integration, E2E, or scenario command named by that plan.
- **Before `$gsd-verify-work`:** Lint, unit, integration, E2E, directed scenarios, YAML integration scenarios, build, and classified legacy-reference audits must be green or explicitly skipped by existing environment guards.
- **Max feedback latency:** 5 minutes for focused gates.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 128-01-01 | 01 | 1 | DOC-10/MEM-05/SYS-04/SYS-05/SYS-06/TEST-07/TEST-08 | T-128-01-* | Traceability and source inventory exist before cleanup edits | audit/unit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts` plus focused legacy `rg` inventory | yes | pending |
| 128-02-01 | 02 | 2 | DOC-10/MEM-05/SYS-05/TEST-07 | T-128-02-* | Removed/dead tool names are absent from active metadata, registration, host listTools, delegated assembly, and config aliases | unit/e2e | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/config.test.ts tests/unit/llm-config.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes | pending |
| 128-03-01 | 03 | 3 | TEST-07 | T-128-03-* | Docs, skills, scenarios, and coverage ledgers no longer instruct active use of removed names | audit/scenario | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup <phase128-directed-subset>` and `python3 tests/scenarios/integration/run_integration.py --managed <phase128-integration-subset>` plus docs/skills `rg` audit | runner exists | pending |
| 128-04-01 | 04 | 4 | DOC-10/MEM-05/SYS-05/SYS-06/TEST-07 | T-128-04-* | Directed scenario ledgers/cases no longer call removed names except classified transitional/evidence references | directed scenario/audit | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup legacy_surface` plus broad `tests/scenarios/**` legacy-name audit for helper-wrapper calls | yes | pending |
| 128-05-01 | 05 | 5 | DOC-10/MEM-05/SYS-05/TEST-07 | T-128-05-* | YAML integration scenarios no longer call removed names except classified transitional/evidence references | integration scenario/audit | `python3 tests/scenarios/integration/run_integration.py --managed legacy_surface_final_audit` plus YAML `tool/action/op/operation/name` legacy-name audit | yes | pending |
| 128-06-01 | 06 | 6 | DOC-10/MEM-05/SYS-05/SYS-06/TEST-07 | T-128-06-* | Docs and skills no longer instruct active use of removed names | docs/audit | `rg` gates over `docs .agents/skills .claude/skills` excluding worktrees and allowing only migration/removed/historical/transitional evidence | yes | pending |
| 128-07-01 | 07 | 4 | SYS-04/SYS-06 | T-128-07-* | Reference tools remain unchanged; transitional legacy tools are structured, gated, and not final primitives | unit/integration/e2e | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-usage-tool.test.ts tests/unit/compound-tools.test.ts tests/unit/get-briefing.test.ts && npm run test:integration -- tests/integration/compound-tools.integration.test.ts && npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/protocol.test.ts` | yes | pending |
| 128-08-01 | 08 | 7 | TEST-08 | T-128-08-* | Final milestone validation records exact commands, results, and classified remaining legacy references | full/audit | `npm run lint && npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup && python3 tests/scenarios/integration/run_integration.py --managed && npm run build` plus final classified `rg` audits | yes | pending |

*Status: pending, green, red, flaky*

## Wave 0 Requirements

- [ ] `.planning/phases/128-legacy-surface-removal-final-audit/TRACEABILITY.md` - map `DOC-10`, `MEM-05`, `SYS-04`, `SYS-05`, `SYS-06`, `TEST-07`, and `TEST-08` to unit, integration, E2E, directed scenario, integration scenario, and final audit evidence.
- [ ] Focused Phase 128 directed and YAML integration scenario subset names - planner should either create phase-specific subsets or explicitly use existing current-surface suites plus audit commands.
- [ ] Final audit command list - planner should define exact `rg` scopes and allowed classifications for removed names, transitional legacy tools, migration suggestions, and historical planning artifacts.

## Manual-Only Verifications

All phase behaviors should have automated verification or classified audit evidence. User review is only needed if a legacy reference cannot be classified from the product docs, phase artifacts, or existing migration suggestion rules.

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 300s for focused gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-12 for pre-execution planning gate
