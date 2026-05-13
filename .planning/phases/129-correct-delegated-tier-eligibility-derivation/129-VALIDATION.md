---
phase: 129
slug: correct-delegated-tier-eligibility-derivation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
---

# Phase 129 - Validation Strategy

> Per-phase validation contract for delegated tier eligibility derivation correction.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest plus FlashQuery Python scenario runners |
| **Config file** | `vitest.config.ts`, `vitest.integration.config.ts`, `vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/tool-exposure.test.ts` |
| **Full suite command** | `npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed foundation && python3 tests/scenarios/integration/run_integration.py --managed foundation && npm run build` |
| **Estimated runtime** | ~10-20 minutes, depending on integration/E2E prerequisites |

---

## Sampling Rate

- **After every task commit:** Run the task-specific quick command from the plan.
- **After every plan wave:** Run all unit/integration/E2E/scenario commands introduced or changed by the wave.
- **Before `$gsd-verify-work`:** Full suite command must be green or explicitly record environment-gated skips through existing helpers.
- **Max feedback latency:** Unit-layer feedback should stay under 60 seconds for metadata-only tasks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 129-01-01 | 01 | 1 | POST-01 / U-tier-1..U-tier-8 | T-129-01 | Broad delegated tiers are derived from metadata and exclude non-data/hard-excluded/removed/admin tools. | unit | `npm test -- tests/unit/tool-metadata.test.ts` | ✅ | ✅ green |
| 129-01-02 | 01 | 1 | POST-01 / U-tier-9 | T-129-02 | Expected tier diff is exactly `+list_vault`, `+copy_document`, `+insert_in_doc`, `+replace_doc_section`. | unit | `npm test -- tests/unit/tool-metadata.test.ts` | ✅ | ✅ green |
| 129-02-01 | 02 | 1 | POST-01 / I-tier-1..I-tier-5 | T-129-03 | Delegated registry expansion cannot bypass host catalog or hard exclusions. | integration | `npm test -- tests/unit/llm-tool-registry.test.ts && npm run test:integration -- tests/integration/tool-registry.test.ts` | ✅ | ✅ green |
| 129-03-01 | 03 | 2 | POST-01 / directed scenario | T-129-04 | Corrected delegated edit/list tools are accepted and dispatchable by delegated purpose workflows via `test_delegated_tier_eligibility.py`. | directed scenario | `python3 tests/scenarios/directed/run_suite.py --managed delegated_tier_eligibility` and `python3 tests/scenarios/directed/run_suite.py --managed foundation` | ✅ | ✅ green |
| 129-03-02 | 03 | 2 | POST-01 / integration scenario | T-129-04 | YAML workflow proves corrected delegated purpose metadata exposure and final-tool composition via `delegated_tier_eligibility.yml`; deterministic delegated dispatch is covered by directed/E2E evidence. | integration scenario | `python3 tests/scenarios/integration/run_integration.py --managed delegated_tier_eligibility` and `python3 tests/scenarios/integration/run_integration.py --managed foundation` | ✅ | ✅ green |
| 129-03-03 | 03 | 2 | POST-01 / docs and migration callout | T-129-05 | Documentation and PR notes explain the intentional four-tool delegated tier expansion. | docs/build | `npm run build` | ✅ | ✅ green |

*Status: ⬜ pending / ✅ green / ❌ red / ⚠ flaky*

---

## Wave 0 Requirements

- [x] Add or update `tests/integration/tool-registry.test.ts` if no existing integration file cleanly covers `assembleNativeToolRegistry` through purpose configs.
- [x] Add non-colliding metadata/tool-registry coverage rows in `tests/scenarios/directed/DIRECTED_COVERAGE.md`; avoid reusing an occupied prefix.
- [x] Add or update a runnable directed testcase for a delegated purpose using at least one corrected edit/list tool.
- [x] Add or update a YAML integration scenario for the corrected delegated purpose workflow.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PR migration callout | POST-01 | PR description is outside the codebase test runner. | Verify final PR text states that delegated `tier:read-only`/`tier:read-write` purposes may gain `list_vault`, `copy_document`, `insert_in_doc`, and `replace_doc_section`, and narrower deployments should use `excludedTools`. |

---

## Validation Sign-Off

- [x] All tasks have automated verification or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verification.
- [x] Wave 0 covers all missing files and scenario rows.
- [x] No watch-mode flags.
- [x] Feedback latency < 60 seconds for unit-layer feedback.
- [x] `nyquist_compliant: true` set in frontmatter when execution evidence is complete.

## Final Validation Command Set

- `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/tool-exposure.test.ts`
- `npm run test:integration -- tests/integration/tool-registry.test.ts`
- `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts`
- `python3 tests/scenarios/directed/run_suite.py --managed delegated_tier_eligibility`
- `python3 tests/scenarios/directed/run_suite.py --managed foundation`
- `python3 tests/scenarios/integration/run_integration.py --managed delegated_tier_eligibility`
- `python3 tests/scenarios/integration/run_integration.py --managed foundation`
- `npm run build`

**Approval:** Plan 129-03 directed, integration, docs, migration callout, and build evidence green.
