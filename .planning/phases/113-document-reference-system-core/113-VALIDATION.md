---
phase: 113
slug: document-reference-system-core
status: green
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-05
---

# Phase 113 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration; Python directed scenario runner for public MCP scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`; `tests/scenarios/directed/run_suite.py` |
| **Quick run command** | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts` |
| **Full suite command** | `npm run build && npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_reference_system_core` |
| **Estimated runtime** | ~180 seconds for focused unit + integration + directed scenario, excluding environmental skips |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts`
- **After every plan wave:** Run `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts`
- **Before `$gsd-verify-work`:** Focused build, unit, integration, and directed scenario commands must pass or record explicit environmental skips
- **Max feedback latency:** 180 seconds for focused automated checks

**Nyquist note:** Individual implementation tasks use focused unit, integration, or directed scenario commands for feedback. The longer chained command is intentionally reserved for the final Phase 113 traceability gate in `113-04` Task 3, after implementation is complete and before requirements are marked done; it is not the per-edit feedback loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 113-W0-01 | 113-01 | 0 | REF-01..REF-08, VAL-113 | T-113-01 / T-113-02 | Locks reference grammar, escape, failure taxonomy, metadata, host-only scan expectations before implementation | unit | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts` | present | green |
| 113-I-01 | 113-04 | 4 | REF-01, REF-04, REF-07, REF-08, VAL-113 | T-113-03 | Proves real vault identifier resolution, ambiguity, metadata, and non-recursive behavior | integration | `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` | present | green |
| 113-DS-01 | 113-04 | 4 | REF-01..REF-08, VAL-113 | T-113-01 / T-113-02 / T-113-03 | Proves public `call_model` reference behavior and metadata through MCP surface | directed | `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_reference_system_core` | present | green |
| 113-FINAL-01 | 113-04 | 4 | REF-01..REF-08, VAL-113 | T-113-01 / T-113-02 / T-113-03 / T-113-04 | Final traceability gate after all focused checks pass; intentionally long-running and not used for task-local feedback | phase gate | `npm run build && npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_reference_system_core` | present | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `src/constants/reference-failures.ts` - runtime `ReferenceFailureReason` array and TypeScript union.
- [x] `tests/unit/reference-resolver.test.ts` - parser/escape/failure mapper tests for ATL-U-02, ATL-U-03, ATL-U-04, ATL-U-07, and related Phase 113 rows.
- [x] `tests/unit/llm-tool.test.ts` - handler tests for no-dispatch on failures, host-only scan, literal `{{id:...}}`, and `failed_references[].detail`.
- [x] `tests/unit/resolve-document.test.ts` - ambiguity guard if helper behavior changes.
- [x] `tests/integration/reference-resolver.integration.test.ts` - real vault identifier/ambiguity/metadata checks.
- [x] `tests/scenarios/directed/testcases/test_call_model_reference_system_core.py` - public scenario coverage for ATL-DS-02 and ATL-DS-03.
- [x] Coverage matrix updates for accepted directed/integration ATL rows.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None expected | VAL-113 | All Phase 113 behavior should be automatable through unit, integration, or directed scenarios | N/A |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing reference-system tests
- [x] No watch-mode flags
- [x] Feedback latency under 180 seconds for focused checks
- [x] `nyquist_compliant: true` set in frontmatter after plans satisfy validation coverage

**Approval:** passed 2026-05-05
